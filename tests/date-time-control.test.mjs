// Explicit temporal fixture revision: issue531-quality-temporal-v1; predecessor retained in fixtures/history/issue531/temporal.
import assert from 'node:assert/strict';
import { softwareQualityObservations, softwareQualityRails } from './helpers/software-quality-observations.mjs';
const ControlRuntime = {
  instantiate: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiate(...args)),
  instantiateFramed: async (...args) => softwareQualityObservations(await BaseControlRuntime.instantiateFramed(...args)),
};

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { ControlRuntime as BaseControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileControl, ControlCompileError } from '../tools/control.mjs';
import { emitCompletedScanSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { buildPortablePackage, PortablePackageError, verifyPortablePackage } from '../tools/portable-package.mjs';
import { compileSource } from './helpers/literate-compile.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const maxDateTime = 253_402_300_799_999;
const encoder = new TextEncoder();

test('temporal quality revisions retain exact predecessor tests and source fixtures', () => {
  const history = JSON.parse(fs.readFileSync(new URL('./fixtures/history/issue531/temporal/programs.json', import.meta.url), 'utf8'));
  assert.equal(history.snapshots.length, 18);
  for (const record of [...history.snapshots, ...history.retainedPredecessors]) {
    const bytes = fs.readFileSync(new URL(`../${record.snapshot ?? record.source}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, record.source);
  }
});

function hexBytes(value) { return Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16)); }
function concatBytes(...parts) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
async function packageKey() {
  return {
    keyId: 'datetime-test-key',
    privateKey: await crypto.subtle.importKey('pkcs8', concatBytes(hexBytes('302e020100300506032b657004220420'), hexBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60')), 'Ed25519', false, ['sign']),
    publicKey: await crypto.subtle.importKey('spki', concatBytes(hexBytes('302a300506032b6570032100'), hexBytes('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a')), 'Ed25519', false, ['verify']),
  };
}
async function digest(bytes) { return Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex'); }
async function resign(value, key) {
  const payload = encoder.encode(canonicalJson(value.payload));
  value.payloadSha256 = await digest(payload);
  value.signatures = [{ algorithm: 'Ed25519', keyId: key.keyId, signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', key.privateKey, payload)).toString('base64') }];
}

test('compiler admits canonical time scalars, settings grids, and DateTime arithmetic', () => {
  const compiled = compileControl(`control CalendarValues {
    input observed_now: DateTime;
    state previous_now: DateTime = datetime\`1970-01-01T00:00:00Z\`;
    let now = case observed_now { ok(value) => value; fault(_) => previous_now; };
    previous_now' = now;
    state day: Date = date\`1970-01-01\`;
    config deadline: DateTime = datetime\`2026-09-22T06:30:00+09:00\` {
      min = datetime\`2026-09-21T00:00:00Z\`;
      max = datetime\`2026-09-23T00:00:00Z\`;
      step = 30min;
      access = operator;
    }
    config opening: TimeOfDay = time\`06:30\` {
      min = time\`06:00\`; max = time\`07:00\`; step = 15min; access = designer;
    }
    config planting_day: Date = date\`2026-09-22\` {
      min = date\`2026-09-01\`; max = date\`2026-09-30\`; step = 1; access = designer;
    }
    output shifted: DateTime;
    output ordered: Bool;
    let previous = now - 1ms;
    shifted <- now + 1ms;
    ordered <- case opening {
      ok(opening_value) => case deadline {
        ok(deadline_value) => opening_value < time\`07:00\` && previous < now && now <= deadline_value && day == date\`1970-01-01\`;
        fault(_) => false;
      };
      fault(_) => false;
    };
  }`, { filename: 'calendar-values.ghost' });
  assert.deepEqual(compiled.manifest.inputs, []);
  assert.deepEqual(compiled.manifest.sensors.map(({ name, type }) => ({ name, type })), [{ name: 'observed_now', type: 'DateTime' }]);
  assert.deepEqual(compiled.manifest.outputs, [
    { name: 'shifted', type: 'DateTime' }, { name: 'ordered', type: 'Bool' },
  ]);
  assert.deepEqual(compiled.manifest.configs.map(config => ({
    name: config.name, type: config.type, value: config.value, settings: config.settings,
    hasCanonicalUnit: Object.hasOwn(config, 'canonicalUnit'),
  })), [
    { name: 'deadline', type: 'DateTime', value: 1_790_026_200_000, settings: {
      min: 1_789_948_800_000, max: 1_790_121_600_000, step: 1_800_000, access: 'operator', stepType: 'Duration',
    }, hasCanonicalUnit: false },
    { name: 'opening', type: 'TimeOfDay', value: 23_400_000, settings: {
      min: 21_600_000, max: 25_200_000, step: 900_000, access: 'designer', stepType: 'Duration',
    }, hasCanonicalUnit: false },
    { name: 'planting_day', type: 'Date', value: 20_718, settings: {
      min: 20_697, max: 20_726, step: 1, access: 'designer', stepType: 'Int',
    }, hasCanonicalUnit: false },
  ]);
});

test('compiler rejects invalid tagged forms and undefined time arithmetic or ordering', () => {
  const rejected = [
    ['offsetless', 'let bad = datetime\`2026-09-22T06:30:00\`;', /datetime|offset|invalid/],
    ['bad date', 'let bad = date\`2026-02-29\`;', /date|range|invalid/],
    ['bad time', 'let bad = time\`24:00\`;', /time|range|invalid/],
    ['Date order', 'let bad = date\`2026-01-01\` < date\`2026-01-02\`;', /Date|ordered|operator|numeric/],
    ['DateTime difference', 'let bad = datetime\`2026-01-02T00:00:00Z\` - datetime\`2026-01-01T00:00:00Z\`;', /DateTime|not defined/],
    ['negative DateTime difference', 'let bad = datetime\`2026-01-01T00:00:00Z\` - datetime\`2026-01-02T00:00:00Z\`;', /DateTime|not defined/],
    ['TimeOfDay addition', 'let bad = time\`23:00\` + 2h;', /TimeOfDay|not defined/],
    ['reverse addition', 'let bad = 1h + datetime\`2026-01-01T00:00:00Z\`;', /Duration|DateTime|not defined/],
    ['cross compare', 'let bad = time\`06:00\` == datetime\`2026-01-01T06:00:00Z\`;', /same type/],
  ];
  for (const [name, statement, pattern] of rejected) {
    assert.throws(
      () => compileControl(`control Rejected { ${statement} }`, { filename: `${name}.ghost` }),
      error => error instanceof ControlCompileError && pattern.test(error.message),
      name,
    );
  }
  for (const [name, config, pattern] of [
    ['Date duration step', 'config bad: Date = date`2026-01-01` { min = date`2026-01-01`; max = date`2026-01-02`; step = 1ms; access = operator; }', /Int setting|step/],
    ['zero time step', 'config bad: TimeOfDay = time`06:00` { min = time`06:00`; max = time`07:00`; step = 0ms; access = operator; }', /positive step/],
    ['misaligned time max', 'config bad: TimeOfDay = time`06:00` { min = time`06:00`; max = time`06:10`; step = 7min; access = operator; }', /max.*aligned|step/],
  ]) {
    assert.throws(() => compileControl(`control RejectedSettings { ${config} }`, { filename: `${name}.ghost` }), pattern, name);
  }
});

test('legacy and framed actual WASM accept boundary rollover and reject overflow atomically', async () => {
  const compiled = await compileSource(`control DateTimeRuntime {
    input base: DateTime;
    input offset: Duration;
    state committed: DateTime = datetime\`1970-01-01T00:00:00Z\`;
    committed' = case base { ok(value) => case offset { ok(delta) => value + delta; fault(_) => committed; }; fault(_) => committed; };
    output shifted: DateTime;
    shifted <- committed';
  }`, { filename: 'datetime-runtime-control.ghost' });

  const legacy = await ControlRuntime.instantiate(wasm, compiled);
  try {
    assert.equal(legacy.step({ nowMs: 1, inputs: { base: maxDateTime - 1, offset: 1 } }).vm.safe.shifted, maxDateTime);
    assert.throws(() => legacy.step({ nowMs: 2, inputs: { base: maxDateTime, offset: 1 } }), /datetime-out-of-range/);
    assert.equal(legacy.runtime.trace.stateAfter.committed, maxDateTime);
  } finally { legacy.dispose(); }

  const framed = await ControlRuntime.instantiateFramed(wasm, compiled);
  try {
    framed.step({ nowMs: 1, inputs: { base: maxDateTime - 1, offset: 1 } });
    const committed = structuredClone(framed.lastFrameOutcome);
    assert.throws(() => framed.step({ nowMs: 2, inputs: { base: maxDateTime, offset: 1 } }), /datetime-out-of-range/);
    assert.deepEqual(framed.lastFrameOutcome, committed);
  } finally { framed.dispose(); }
});

test('runtime classifies noninteger and out-of-range time samples as Invalid and rejects metadata loss', async () => {
  const compiled = await compileSource(`control TimeBoundary {
    input day: Date;
    input time: TimeOfDay;
    input instant: DateTime;
    let epoch = datetime\`1970-01-01T00:00:00Z\`;
    output same: Bool;
    same <- case instant { ok(value) => value == epoch; fault(_) => false; };
  }`, { filename: 'time-boundary.ghost' });
  const runtime = await ControlRuntime.instantiate(wasm, compiled);
  try {
    assert.doesNotThrow(() => runtime.step({ nowMs: 0, inputs: { day: 2_932_896, time: 86_399_999, instant: maxDateTime } }));
    for (const [field, value] of [['day', -1], ['day', 2_932_897], ['time', 0.5], ['time', 86_400_000], ['instant', maxDateTime + 1]]) {
      const inputs = { day: 0, time: 0, instant: 0, [field]: value };
      assert.equal(runtime.step({ nowMs: 1, inputs }).sensors[field].quality, 'Invalid');
    }
  } finally { runtime.dispose(); }
  const framed = await ControlRuntime.instantiateFramed(wasm, compiled);
  try {
    for (const [field, value] of [['day', -1], ['time', 86_400_000], ['instant', maxDateTime + 1]]) {
      assert.equal(framed.step({ nowMs: 0, inputs: { day: 0, time: 0, instant: 0, [field]: value } }).sensors[field].quality, 'Invalid');
    }
  } finally { framed.dispose(); }
  await assert.rejects(() => ControlRuntime.instantiate(wasm, {
    ...compiled,
    manifest: { ...compiled.manifest, sensors: [{ ...compiled.manifest.sensors[0], canonicalUnit: 'day' }, ...compiled.manifest.sensors.slice(1)] },
  }), /canonicalUnit.*forbidden|unknown key/);
});

test('time settings stream updates the same artifact and interaction snapshots validate bounds', async () => {
  const source = `<!-- ghostflow:anchor id=GF-INT-DATETIME-SETTING kind=intent status=confirmed origin=user -->
Set the deadline.

\`\`\`ghost
control DateTimeSetting {
  // ghostflow:link id=GF-INT-DATETIME-SETTING relation=implements
  config deadline: DateTime = datetime\`2026-09-22T00:00:00Z\` {
    min = datetime\`2026-09-22T00:00:00Z\`; max = datetime\`2026-09-23T00:00:00Z\`; step = 1h; access = operator;
  }
  // ghostflow:link id=GF-INT-DATETIME-SETTING relation=implements
  config opening: TimeOfDay = time\`06:30\` {
    min = time\`06:00\`; max = time\`07:00\`; step = 15min; access = operator;
  }
  // ghostflow:link id=GF-INT-DATETIME-SETTING relation=implements
  config planting_day: Date = date\`2026-09-22\` {
    min = date\`2026-09-01\`; max = date\`2026-09-30\`; step = 1; access = operator;
  }
  output applied: DateTime;
  output settings_fault: Bool;
  applied <- case deadline { ok(value) => value; fault(_) => datetime\`1970-01-01T00:00:00Z\`; };
  settings_fault <- case deadline { ok(_) => false; fault(_) => true; };
}
\`\`\`
`;
  const compilation = await compileSource(source, {
    filename: 'datetime-setting.ghost.md',
    interactionSourceIdentity: { documentId: 'source.datetime-setting', revisionId: 'revision.datetime-setting-v1' },
  });
  assert.deepEqual(compilation.interactionSchema.descriptors[0].sourceType, { kind: 'builtin', name: 'DateTime', unit: null });
  const runtime = await ControlRuntime.instantiate(wasm, compilation,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  let trace;
  let settingsState;
  try {
    const fingerprint = runtime.contextSnapshot().state.programFingerprint;
    trace = runtime.step({ nowMs: 0, contextFacts: {
      clock: { monotonicMs: 0, bootEpoch: 1, wallMs: 0, uncertaintyMs: 0, trusted: true,
        unknownReason: null, sourceRevision: 'datetime-test-clock' },
      natural: [], schedules: [], settings: {
        programFingerprint: fingerprint, eventId: 'datetime-settings-1', baseRevision: 0, position: 1,
        origin: 'operatorEdit', changes: [
          { configId: compilation.manifest.configs[0].id, result: { ok: true, type: 'DateTime', value: 1_790_038_800_000 } },
          { configId: compilation.manifest.configs[1].id, result: { ok: true, type: 'TimeOfDay', value: 24_300_000 } },
          { configId: compilation.manifest.configs[2].id, result: { ok: true, type: 'Date', value: 20_719 } },
        ],
      },
    } }).vm;
    assert.equal(trace.safe.applied, 1_790_038_800_000);
    assert.equal(trace.safe.settings_fault, false);
    settingsState = runtime.contextSnapshot().state;
  }
  finally { runtime.dispose(); }
  const snapshot = emitCompletedScanSnapshot({
    compilation,
    runId: 'run.datetime-setting',
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 },
    trace,
    settingsState,
  });
  assert.equal(validateInteraction(compilation.interactionSchema, snapshot).valid, true);
  const invalid = structuredClone(snapshot);
  invalid.observations[0].value = maxDateTime + 1;
  assert.equal(validateInteraction(compilation.interactionSchema, invalid).valid, false);
});

test('signed portable package admits time config metadata and rejects a re-signed wrong step type', async () => {
  const source = `# Date setting\n\n\`\`\`ghost\ncontrol PackagedDate {\n  config day: Date = date\`2026-09-22\` { min = date\`2026-09-01\`; max = date\`2026-09-30\`; step = 1; access = operator; }\n}\n\`\`\`\n`;
  const compilation = await compileSource(source, { filename: 'packaged-date.ghost.md' });
  const key = await packageKey();
  const identity = {
    compilerRevision: 'datetime-test', runtimeSemantics: 'GhostFlow/runtime-semantics-v1', runtimeAbi: 'GhostFlow/context-scan-abi-v5',
    requiredCapabilities: [], bindingRevision: 'datetime-test-binding',
  };
  const packageValue = await buildPortablePackage(compilation, identity, {
    signers: [{ keyId: key.keyId, privateKey: key.privateKey }],
    verifyCompilation: (text, options) => compileSource(text, options),
  });
  const options = {
    trustedKeys: [{ keyId: key.keyId, publicKey: key.publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision, supportedRuntimeSemantics: [identity.runtimeSemantics],
    supportedRuntimeAbis: [identity.runtimeAbi], supportedManifestFormats: ['GhostFlow/control-v10'],
    availableCapabilities: [], expectedBindingRevision: identity.bindingRevision, verifyBytecode: async () => true,
  };
  const verified = await verifyPortablePackage(packageValue, options);
  assert.equal(verified.manifest.configs[0].settings.stepType, 'Int');

  const changed = structuredClone(packageValue);
  const manifest = JSON.parse(Buffer.from(changed.payload.manifest.contentBase64, 'base64').toString('utf8'));
  manifest.configs[0].settings.stepType = 'Duration';
  const manifestBytes = encoder.encode(canonicalJson(manifest));
  changed.payload.manifest.contentBase64 = Buffer.from(manifestBytes).toString('base64');
  changed.payload.manifest.sha256 = await digest(manifestBytes);
  await resign(changed, key);
  await assert.rejects(() => verifyPortablePackage(changed, options), error => error instanceof PortablePackageError && error.code === 'manifest-mismatch');
});
