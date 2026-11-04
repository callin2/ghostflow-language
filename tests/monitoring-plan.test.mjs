import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';
import { compileSource } from './helpers/literate-compile.mjs';

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
