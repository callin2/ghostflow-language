import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';
import { compileSource } from './helpers/literate-compile.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const code = ({ duration = '5min', start = '((enabled |> recover(false)) && dawn.due)', comparator = '<', output = "active'" } = {}) => `control DawnDemo {
  config enabled: Bool = true { access = operator; }
  schedule dawn: Solar { timezone = "Asia/Seoul"; latitude = 37.5665; longitude = 126.978; at = sun\`rise\`; basis = pulse; when = true; clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip; }
  state active: Bool = false;
  timer elapsedActive = elapsed(active);
  active' = if active then elapsedActive ${comparator} ${duration} else ${start};
  output running: Bool;
  running <- ${output};
}`;
const expectedPattern = {
  kind: 'scheduled-timed-latch', outputName: 'running', stateName: 'active',
  timerId: 'elapsedActive', durationMs: 300_000, scheduleId: 'dawn',
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('the installed Solar timed latch gets source-derived monitoring metadata without changing GFB', async () => {
  const compiled = await compileSource(code(), { filename: 'solar-five-minute.ghost' });
  assert.deepEqual(compiled.manifest.monitoring, {
    schema: 'GhostFlow/monitoring-plan-v1', patterns: [expectedPattern],
  });
  assert.equal(digest(compiled.bytes), '8ab8eb6222b3b50a3b0ed34a581add4de451ce21904279aeb85238bfe2715e60');

  const changed = await compileSource(code({ duration: '7min' }), { filename: 'solar-five-minute.ghost' });
  assert.equal(changed.manifest.monitoring.patterns[0].durationMs, 420_000);
  assert.notEqual(digest(changed.bytes), digest(compiled.bytes));
});

test('only a positive required schedule conjunction and a direct post-state output are covered', async () => {
  const unsupported = [
    code({ start: '((enabled |> recover(false)) || dawn.due)' }),
    code({ start: '((enabled |> recover(false)) && !dawn.due)' }),
    code({ start: 'if dawn.due then (enabled |> recover(false)) else false' }),
    code({ comparator: '<=' }),
    code({ output: '!active\'' }),
    code().replace('state active: Bool = false;', 'let cutoff = 5min;\n  state active: Bool = false;')
      .replace('elapsedActive < 5min', 'elapsedActive < cutoff'),
  ];
  for (const candidate of unsupported) {
    const compiled = await compileSource(candidate, { filename: 'unsupported.ghost' });
    assert.deepEqual(compiled.manifest.monitoring?.patterns ?? [], []);
  }
});

test('portable package replay rejects a substituted monitoring plan', async () => {
  const compiled = await compileSource(code(), { filename: 'solar-five-minute.ghost' });
  const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const identity = {
    compilerRevision: 'monitoring-test', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/context-scan-abi-v5', bindingRevision: 'monitoring-binding',
    requiredCapabilities: [{ kind: 'actuator', name: 'running', type: 'bool' }],
  };
  const packageValue = await buildPortablePackage(compiled, identity, {
    signers: [{ keyId: 'monitoring-test', privateKey: key.privateKey }],
    verifyCompilation: (source, { filename }) => compileSource(source, { filename }),
    onDiagnostic: () => {},
  });
  const verifyOptions = {
    trustedKeys: [{ keyId: 'monitoring-test', publicKey: key.publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: ['GhostFlow/control-v15'],
    availableCapabilities: identity.requiredCapabilities, expectedBindingRevision: identity.bindingRevision,
    verifyBytecode: () => true,
  };
  const accepted = await verifyPortablePackage(packageValue, verifyOptions);
  assert.deepEqual(accepted.manifest.monitoring.patterns, [expectedPattern]);

  const changed = structuredClone(packageValue);
  const manifest = JSON.parse(Buffer.from(changed.payload.manifest.contentBase64, 'base64').toString('utf8'));
  manifest.monitoring.patterns[0].scheduleId = 'forged';
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  changed.payload.manifest.contentBase64 = manifestBytes.toString('base64');
  changed.payload.manifest.sha256 = digest(manifestBytes);
  const payloadBytes = Buffer.from(canonicalJson(changed.payload));
  changed.payloadSha256 = digest(payloadBytes);
  changed.signatures[0].signatureBase64 = Buffer.from(await crypto.subtle.sign('Ed25519', key.privateKey, payloadBytes)).toString('base64');
  await assert.rejects(verifyPortablePackage(changed, verifyOptions), /monitoring plan does not match canonical source lowering|does not match declared output/);
});

test('configured timed outputs expose the direct Duration setting and enum order', async () => {
  const source = `control Settings {\n  config watering: Duration = 10s { min = 1s; max = 60s; step = 1s; access = operator; }\n  type Phase = First | Second;\n  state phase: Phase = First;\n  timer age = elapsed(phase);\n  let phase_limit = watering |> recover(0ms);\n  phase' = case phase { First => if age >= phase_limit then Second else First; Second => if age >= phase_limit then First else Second; };\n  output valve_a, valve_b: Bool;\n  valve_a <- phase' == First;\n  valve_b <- phase' == Second;\n}`;
  const compiled = await compileSource(source, { filename: 'configured.ghost' });
  const cycle = [{ value: 0, configName: 'watering' }, { value: 1, configName: 'watering' }];
  assert.deepEqual(compiled.manifest.monitoring.patterns, [
    { kind: 'configured-timed-output', outputName: 'valve_a', stateName: 'phase', timerId: 'age', configName: 'watering', activeValue: 0, cycle },
    { kind: 'configured-timed-output', outputName: 'valve_b', stateName: 'phase', timerId: 'age', configName: 'watering', activeValue: 1, cycle },
  ]);

  const inputGated = source.replace('output valve_a', 'input interlock: Bool; output valve_a')
    .replace("valve_a <- phase' == First;", "valve_a <- (phase' == First) && (interlock |> recover(false));");
  assert.deepEqual((await compileSource(inputGated, { filename: 'interlocked.ghost' })).manifest.monitoring.patterns
    .map(pattern => pattern.outputName), ['valve_b']);

  const wrongDirection = source.replace('if age >= phase_limit then Second', 'if age < phase_limit then Second');
  const earlyPatterns = (await compileSource(wrongDirection, { filename: 'early-transition.ghost' })).manifest.monitoring.patterns;
  assert.deepEqual(earlyPatterns.map(pattern => pattern.outputName), ['valve_b']);
  assert.equal(earlyPatterns[0].cycle, undefined);
});

const finiteSequence = `\`\`\`ghost
  control Finite {
    config first_time: Duration = 10s { min = 1s; max = 60s; step = 1s; access = operator; }
    config second_time: Duration = 20s { min = 1s; max = 60s; step = 1s; access = operator; }
    config rest_time: Duration = 5s { min = 1s; max = 60s; step = 1s; access = operator; }
    type Phase = Idle | First | Second | Rest;
    state phase: Phase = Idle;
    timer age = elapsed(phase);
    let first = first_time |> recover(0ms); let second = second_time |> recover(0ms); let rest = rest_time |> recover(0ms);
    input start: Bool;
    phase' = case phase { Idle => if (start |> recover(false)) then First else Idle; First => if age >= first then Second else First; Second => if age >= second then Rest else Second; Rest => if age >= rest then Idle else Rest; };
    output valve_a, valve_b: Bool;
    valve_a <- phase' == First; valve_b <- phase' == Second;
  }
  \`\`\``;

function externallyCancelledSequence(guard = '(stop |> recover(false))', reset = 'Idle') {
  return finiteSequence.replace('input start: Bool;', 'input start, stop: Bool;')
    .replace("phase' = case phase", `phase' = if ${guard} then ${reset} else case phase`);
}

function edgeTriggeredSequence() {
  return externallyCancelledSequence().replace('input start, stop: Bool;', `input start, stop: Bool;
    state start_held: Bool = false;
    let start_pressed = start |> recover(false);
    let start_edge = start_pressed && !start_held;
    start_held' = start_pressed;`)
    .replace('Idle => if (start |> recover(false))', 'Idle => if start_edge');
}

test('finite timed sequences expose all stages while repeating cycles stay cycles', async () => {
  const finite = finiteSequence;
  const patterns = (await compileSource(finite, { filename: 'finite.ghost.md' })).manifest.monitoring.patterns;
  const sequence = [{ value: 1, configName: 'first_time' }, { value: 2, configName: 'second_time' }, { value: 3, configName: 'rest_time' }];
  assert.deepEqual(patterns.map(pattern => pattern.sequence), [sequence, sequence]);
  assert.equal(patterns[0].cycle, undefined);

  const repeating = finite.replace('Rest => if age >= rest then Idle', 'Rest => if age >= rest then First');
  const repeatingPatterns = (await compileSource(repeating, { filename: 'repeating.ghost.md' })).manifest.monitoring.patterns;
  assert.equal(repeatingPatterns[0].sequence, undefined);
  assert.equal(repeatingPatterns[0].cycle, undefined);
});

test('external cancellation to the waiting boundary preserves finite sequence metadata and execution bytes', async () => {
  const compiled = await compileSource(externallyCancelledSequence(), { filename: 'cancelled-finite.ghost.md' });
  assert.equal(digest(compiled.bytes), 'aca7fd957e636b3d280a759b3def62d91c3723db1cc9b02d2c7e32c039d60c9e');
  const sequence = [{ value: 1, configName: 'first_time' }, { value: 2, configName: 'second_time' }, { value: 3, configName: 'rest_time' }];
  assert.deepEqual(compiled.manifest.monitoring.patterns.map(pattern => pattern.sequence), [sequence, sequence]);
  assert.ok(compiled.manifest.monitoring.patterns.every(pattern => pattern.kind === 'configured-timed-output' && !pattern.cycle));
});

test('immutable external Bool aliases and pure Bool composition retain a finite plan', async () => {
  const guards = [
    'external_stop', '!(!external_stop)', 'external_stop || external_stop',
    'external_stop && true', 'external_stop == true', 'external_stop != false',
    'if external_stop then true else false', 'raw_stop |> recover(false)',
  ];
  for (const guard of guards) {
    const source = externallyCancelledSequence(guard).replace('input start, stop: Bool;',
      'input start, stop: Bool; let raw_stop = stop; let external_stop = raw_stop |> recover(false);');
    const patterns = (await compileSource(source, { filename: 'external-alias.ghost.md' })).manifest.monitoring.patterns;
    assert.equal(patterns.length, 2, guard);
    assert.ok(patterns.every(pattern => pattern.sequence.length === 3 && !pattern.cycle), guard);
  }
});

test('a three-state finite sequence and positive Duration output gates retain the same contract', async () => {
  const source = externallyCancelledSequence().replace('Idle | First | Second | Rest', 'Idle | First | Second')
    .replace('Second => if age >= second then Rest else Second; Rest => if age >= rest then Idle else Rest;',
      'Second => if age >= second then Idle else Second;')
    .replace("valve_a <- phase' == First;", "valve_a <- (first > 0ms) && (phase' == First);");
  const patterns = (await compileSource(source, { filename: 'finite-three-state.ghost.md' })).manifest.monitoring.patterns;
  assert.deepEqual(patterns.map(pattern => pattern.sequence), Array(2).fill([
    { value: 1, configName: 'first_time' }, { value: 2, configName: 'second_time' },
  ]));
});

test('state, time, settings and unproven cancellation paths never acquire guarded finite metadata', async () => {
  const guards = [
    ['true', ''],
    ['age >= 1s', ''],
    ['internal_stop', 'state internal_stop: Bool = false;'],
    ['hidden_stop', 'let hidden_stop = phase == First;'],
    ['(stop |> recover(false)) || hidden_stop', 'let hidden_stop = age >= 1s;'],
    ['stop |> recover(internal_stop)', 'state internal_stop: Bool = false;'],
    ['setting_stop |> recover(false)', 'config setting_stop: Bool = false { access = operator; }'],
    ['threshold_stop', 'let threshold_stop = age >= (first_time |> recover(0ms));'],
  ];
  for (const [guard, declaration] of guards) {
    const source = externallyCancelledSequence(guard).replace('input start, stop: Bool;', `input start, stop: Bool; ${declaration}`);
    const compiled = await compileSource(source, { filename: 'unsupported-cancel.ghost.md' });
    assert.deepEqual(compiled.manifest.monitoring?.patterns ?? [], [], guard);
  }
  for (const source of [
    externallyCancelledSequence('(stop |> recover(false))', 'First'),
    externallyCancelledSequence('(stop |> recover(false))', 'Rest'),
    externallyCancelledSequence().replace('Rest => if age >= rest then Idle', 'Rest => if age >= rest then First'),
    externallyCancelledSequence().replace('Rest => if age >= rest then Idle', 'Rest => if (start |> recover(false)) then Idle'),
  ]) {
    assert.deepEqual((await compileSource(source, { filename: 'unproven-boundary.ghost.md' })).manifest.monitoring?.patterns ?? [], []);
  }
});

test('edge-triggered waiting stays a finite boundary and Duration settings remain live references', async () => {
  const source = edgeTriggeredSequence();
  for (const candidate of [source, source.replace('first_time: Duration = 10s', 'first_time: Duration = 15s')]) {
    const compiled = await compileSource(candidate, { filename: 'finite-edge.ghost.md' });
    assert.ok(compiled.manifest.monitoring.patterns.every(pattern => !pattern.cycle && pattern.sequence.length === 3));
    assert.deepEqual(compiled.manifest.monitoring.patterns[0].sequence.map(stage => stage.configName), ['first_time', 'second_time', 'rest_time']);
  }
});

test('external stop, held stop, new start and live Duration retain their runtime behavior', async () => {
  const artifact = await compileSource(edgeTriggeredSequence(), { filename: 'finite-runtime.ghost.md' });
  const wasm = readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiate(wasm, artifact, { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  let sampleId = 0;
  const step = (nowMs, start, stop, settings = null) => {
    sampleId++;
    const result = runtime.step({ nowMs,
      samples: Object.fromEntries(Object.entries({ start, stop }).map(([name, value]) => [name,
        { epoch: 1, id: sampleId, timestampMs: nowMs, quality: 'Good', value }])),
      contextFacts: { clock: { monotonicMs: nowMs, bootEpoch: 1, wallMs: nowMs, uncertaintyMs: 0,
        trusted: true, unknownReason: null, sourceRevision: 'finite-test' }, natural: [], schedules: [], settings },
    });
    return [result.vm.safe.valve_a, result.vm.safe.valve_b];
  };
  try {
    assert.deepEqual(step(0, false, false), [false, false]);
    assert.deepEqual(step(1, true, false), [true, false]);
    assert.deepEqual(step(1001, true, true), [false, false]);
    assert.deepEqual(step(2001, true, true), [false, false]);
    assert.deepEqual(step(3001, true, false), [false, false]);
    assert.deepEqual(step(4001, false, false), [false, false]);
    assert.deepEqual(step(5001, true, false), [true, false]);
    const initial = runtime.contextSnapshot().state;
    assert.deepEqual(step(6001, true, false, {
      programFingerprint: initial.programFingerprint, eventId: 'shorten-first', baseRevision: 0,
      position: sampleId + 1, origin: 'operatorEdit', changes: [{ configId: artifact.manifest.configs[0].id,
        result: { ok: true, type: 'Duration', value: 2000 } }],
    }), [true, false]);
    assert.deepEqual(step(7001, true, false), [false, true]);
    assert.deepEqual(step(27001, true, false), [false, false]);
    assert.deepEqual(step(32001, true, false), [false, false]);
    assert.deepEqual(step(33001, true, false), [false, false]);
    assert.equal(runtime.contextSnapshot().state.settingsRevision, 1);
  } finally { runtime.dispose(); }
});

test('portable replay verifies a guarded finite sequence and rejects a resigned stage substitution', async () => {
  const compiled = await compileSource(externallyCancelledSequence(), { filename: 'portable-finite.ghost.md' });
  const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const identity = {
    compilerRevision: 'guarded-finite-test', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/context-scan-abi-v5', bindingRevision: 'finite-binding',
    requiredCapabilities: [
      ...['valve_a', 'valve_b'].map(name => ({ kind: 'actuator', name, type: 'bool' })),
      ...['start', 'stop'].map(name => ({ kind: 'sensor', name, type: 'bool' })),
    ],
  };
  const artifact = await buildPortablePackage(compiled, identity, {
    signers: [{ keyId: 'finite-test', privateKey: key.privateKey }],
    verifyCompilation: (source, { filename }) => compileSource(source, { filename }), onDiagnostic: () => {},
  });
  const options = {
    trustedKeys: [{ keyId: 'finite-test', publicKey: key.publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: [compiled.manifest.format],
    availableCapabilities: identity.requiredCapabilities, expectedBindingRevision: identity.bindingRevision,
    verifyBytecode: () => true,
  };
  assert.deepEqual((await verifyPortablePackage(artifact, options)).manifest.monitoring, compiled.manifest.monitoring);
  const changed = structuredClone(artifact);
  const manifest = JSON.parse(Buffer.from(changed.payload.manifest.contentBase64, 'base64').toString('utf8'));
  manifest.monitoring.patterns[0].sequence.reverse();
  const bytes = Buffer.from(canonicalJson(manifest));
  changed.payload.manifest.contentBase64 = bytes.toString('base64');
  changed.payload.manifest.sha256 = digest(bytes);
  const payload = Buffer.from(canonicalJson(changed.payload));
  changed.payloadSha256 = digest(payload);
  changed.signatures[0].signatureBase64 = Buffer.from(await crypto.subtle.sign('Ed25519', key.privateKey, payload)).toString('base64');
  await assert.rejects(verifyPortablePackage(changed, options), error => {
    assert.equal(error.code, 'source-map-mismatch');
    assert.equal(error.cause?.message, 'monitoring plan does not match canonical source lowering');
    return true;
  });
});
