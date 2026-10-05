import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Bool input validity bounds reject before emitting an unusable acquisition manifest', () => {
  for (const range of ['false .. true', 'true .. true', '0 .. 1']) {
    assert.throws(() => compileSourceSync(`# Invalid Bool bounds\n\n\`\`\`ghost\ncontrol Bounds { input button: Bool { valid = ${range}; } output lamp: Bool; lamp <- button |> recover(false); }\n\`\`\`\n`, { filename: 'bounds.ghost.md' }), /Bool input does not support valid ranges/);
  }
});
import { compileSourceSync } from '../tools/compile-source.mjs';
import { compileControl } from '../tools/control.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';

const document = code => `# Explicit input revision\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const compile = code => compileSourceSync(document(code), { filename: 'input.ghost.md' });
const wasm = () => readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const sample = (id, timestampMs, quality, value, epoch = 1) => ({ epoch, id, timestampMs, quality, value });
const hash = text => createHash('sha256').update(text).digest('hex');
const parity = `control InputParity {
  input request: Bool; input reading: Number;
  output enabled: Bool; output value: Number;
  enabled <- request |> recover(true); value <- reading |> recover(42);
}`;

for (const [type, fallback, min, max] of [
  ['Int', '-7', -2147483648, 2147483647],
  ['Duration', '7ms', 0, Number.MAX_SAFE_INTEGER],
  ['Date', 'date`2000-01-01`', 0, 2932896],
  ['TimeOfDay', 'time`00:00:07`', 0, 86399999],
  ['DateTime', 'datetime`2000-01-01T00:00:00Z`', 0, 253402300799999],
]) {
  for (const framed of [false, true]) test(`${type}: exact quality payloads (${framed ? 'framed' : 'plain'} WASM)`, async () => {
    const artifact = compile(`control Exact { input reading: ${type}; output value: ${type}; value <- reading |> recover(${fallback}); }`);
    const runtime = await (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm(), artifact);
    try {
      const unavailable = runtime.step({ nowMs: 0 });
      assert.equal(unavailable.sensors.reading.quality, 'NotReady');
      const recovered = unavailable.vm.safe.value;
      let id = 0;
      for (const value of [min, 0, max]) {
        const result = runtime.step({ nowMs: ++id, samples: { reading: sample(id, id, 'Good', value) } });
        assert.equal(result.sensors.reading.quality, 'Good');
        assert.equal(result.vm.safe.value, value);
      }
      for (const value of [0.5, min - 1, max + 1, NaN, Infinity]) {
        const result = runtime.step({ nowMs: ++id, samples: { reading: sample(id, id, 'Good', value) } });
        assert.equal(result.sensors.reading.quality, 'Invalid');
        assert.equal(result.vm.safe.value, recovered);
      }
      for (const quality of ['NotReady', 'Disconnected', 'Stale', 'Invalid']) {
        const result = runtime.step({ nowMs: ++id, samples: { reading: sample(id, id, quality, 0) } });
        assert.equal(result.sensors.reading.quality, quality);
        assert.equal(result.vm.safe.value, recovered);
      }
      assert.throws(() => runtime.step({ nowMs: id + 1, samples: { reading: sample(id + 1, id + 1, 'Good', '0') } }), /must be numeric/);
    } finally { runtime.dispose(); }
    assert.throws(() => compile(`control Exact { input reading: ${type} { filter = median(3); } }`), /numeric filtering/);
    const forged = structuredClone(artifact.manifest);
    Object.assign(forged.sensors[0], { filter: 'moving_average', window: 3 });
    await assert.rejects(() => ControlRuntime.instantiate(wasm(), { ...artifact, manifest: forged }), /filtering requires/);
  });
}

test('canonical input retains existing sensor bytecode and wire descriptor compatibility', () => {
  const artifact = compile(parity);
  // Captured from the existing sensor lowering at unchanged repository
  // 8ed7960 in the prior clean reference worktree, before this change.
  // This is a new migration oracle; historical benchmark records are untouched.
  assert.equal(createHash('sha256').update(artifact.bytes).digest('hex'),
    '8c1ed670eb643cd6651995299666924049b6ae3fafb95270fa140dd872f0d2d8');
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v1');
  assert.deepEqual(artifact.manifest.inputs, []);
  assert.deepEqual(artifact.manifest.sensors.map(({ name, type, valueInput, okInput, faultInput }) =>
    ({ name, type, valueInput, okInput, faultInput })), [
    { name: 'request', type: 'Bool', valueInput: '__gf_sensor_value_request', okInput: '__gf_sensor_ok_request', faultInput: '__gf_sensor_fault_request' },
    { name: 'reading', type: 'Number', valueInput: '__gf_sensor_value_reading', okInput: '__gf_sensor_ok_reading', faultInput: '__gf_sensor_fault_reading' },
  ]);
});

for (const [type, lower, upper, fallback, absent] of [
  ['Int', '0', '10', '-7', '-9'],
  ['Duration', '0ms', '10ms', '7ms', '9ms'],
]) for (const framed of [false, true]) test(`${type}: optional availability, typed range and sample recovery (${framed ? 'framed' : 'plain'})`, async () => {
  const artifact = compile(`fn identity(value: ${type}) -> ${type} { value }
    fn pass(value: ${type}) -> Result<${type}, SensorFault> { ok(value) }
    control OptionalExact {
      input reading?: ${type} { valid = ${lower} .. ${upper}; stale_after = 10ms; recover_after = 2 samples; }
      output value: ${type};
      adapt policy {
        strategy Present priority 1 match (reading: sensor<${type}>) {
          value <- reading |> map(identity) |> and_then(pass) |> recover(${fallback});
        }
        strategy Absent priority 0 match always { value <- ${absent}; }
      }
    }`);
  const instantiate = framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate;
  for (const present of [false, true]) {
    const runtime = await instantiate.call(ControlRuntime, wasm(), artifact, {
      capabilities: present ? [{ kind: 'sensor', name: 'reading', type }] : [],
    });
    try {
      assert.equal(runtime.step({ nowMs: 0 }).vm.safe.value, present ? Number(fallback.replace('ms', '')) : Number(absent.replace('ms', '')));
      if (!present) continue;
      assert.equal(runtime.step({ nowMs: 0, samples: { reading: sample(0, 0, 'NotReady', 0) } }).sensors.reading.quality, 'NotReady');
      const observed = sample(1, 1, 'Good', 0);
      assert.equal(runtime.step({ nowMs: 1, samples: { reading: observed } }).sensors.reading.quality, 'NotReady');
      assert.equal(runtime.step({ nowMs: 2, samples: { reading: observed } }).sensors.reading.quality, 'NotReady', 'duplicate delivery does not satisfy recovery');
      assert.equal(runtime.step({ nowMs: 3, samples: { reading: sample(2, 3, 'Good', 0) } }).vm.safe.value, 0);
      assert.equal(runtime.step({ nowMs: 12 }).sensors.reading.quality, 'Good');
      assert.equal(runtime.step({ nowMs: 13 }).sensors.reading.quality, 'Stale');
      const invalid = runtime.step({ nowMs: 14, samples: { reading: sample(3, 14, 'Good', 11) } });
      assert.equal(invalid.sensors.reading.quality, 'Invalid', 'typed valid range applies before recovery');
      assert.equal(invalid.vm.safe.value, Number(fallback.replace('ms', '')));
      assert.equal(runtime.step({ nowMs: 15, samples: { reading: sample(4, 15, 'Good', 10) } }).sensors.reading.quality, 'NotReady');
      assert.equal(runtime.step({ nowMs: 16, samples: { reading: sample(5, 16, 'Good', 10) } }).vm.safe.value, 10);
      assert.equal(runtime.step({ nowMs: 17, samples: { reading: sample(1, 17, 'Good', 0, 2) } }).vm.safe.value, 0, 'a new producer epoch resets the existing conditioner');
      assert.deepEqual(runtime.sensors.get('reading').conditioner.sampleIdentity(), { epoch: 2, id: 1, timestampMs: 17 });
    } finally { runtime.dispose(); }
  }
});

test('migration without a source fault policy fails without rewriting the original', () => {
  const original = document('control Follow { input switch_on: Bool; output lamp: Bool; lamp <- switch_on; }');
  const before = hash(original);
  assert.throws(() => compileSourceSync(original, { filename: 'unreviewed.ghost.md' }), /output lamp must be Bool/);
  assert.equal(hash(original), before);
  assert.throws(() => compile('control BadRange { input reading: Int { valid = 0.5 .. 10; } }'), /Int|constant/);
  assert.throws(() => compile('control BadRange { input reading: Duration { valid = 0 .. 10; } }'), /Duration|constant/);
});

for (const framed of [false, true]) test(`Bool valid metadata rejects numeric interpolation (${framed ? 'framed' : 'plain'})`, async () => {
  const artifact = compile(parity);
  const manifest = structuredClone(artifact.manifest);
  Object.assign(manifest.sensors[0], { validMin: 0.2, validMax: 0.8 });
  const instantiate = framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate;
  await assert.rejects(() => instantiate.call(ControlRuntime, wasm(), { ...artifact, manifest }), /Bool sensor does not support numeric valid bounds/);
});

for (const framed of [false, true]) test(`malformed acquisition batches preserve accepted identity and permit corrected retry (${framed ? 'framed' : 'plain'})`, async () => {
  const instantiate = framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate;
  const runtime = await instantiate.call(ControlRuntime, wasm(), compile(parity));
  try {
    runtime.step({ nowMs: 0, samples: { request: sample(1, 0, 'Good', false), reading: sample(1, 0, 'Good', 0) } });
    for (const [patch, message] of [
      [{ epoch: -1 }, /epoch/], [{ id: 1.5 }, /id/],
      [{ timestampMs: 2 }, /future/], [{ quality: 5 }, /quality/],
      [{ value: '1' }, /numeric/], [{ inventedProducer: 'board' }, /unknown|unexpected|unsupported/],
    ]) {
      assert.throws(() => runtime.step({ nowMs: 1, samples: {
        request: sample(2, 1, 'Good', true), reading: { ...sample(2, 1, 'Good', 1), ...patch },
      } }), message);
      for (const name of ['request', 'reading']) assert.deepEqual(runtime.sensors.get(name).conditioner.sampleIdentity(), { epoch: 1, id: 1, timestampMs: 0 });
    }
    const corrected = runtime.step({ nowMs: 1, samples: { request: sample(2, 1, 'Good', true), reading: sample(2, 1, 'Good', 1) } });
    assert.deepEqual(corrected.vm.safe, { enabled: true, value: 1 });
    assert.deepEqual(runtime.sensors.get('reading').conditioner.sampleIdentity(), { epoch: 1, id: 2, timestampMs: 1 });
  } finally { runtime.dispose(); }
});

test('plain use sites and old sensor declaration require explicit migration', () => {
  for (const body of [
    'input request: Bool; output drive: Bool; drive <- request && true;',
    'input reading: Number; output value: Number; value <- reading + 1;',
    'input moisture: Percent; output dry: Bool; dry <- moisture < 30%;',
  ]) assert.throws(() => compile(`control BadInput { ${body} }`), /cannot use Result directly/);
  assert.throws(() => compile('control Old { sensor request: Bool; }'), /removed sensor declaration; use input/);
  assert.throws(() => compileControl('control Old { sensor request: Bool; }'), /removed sensor declaration/);
  assert.throws(() => compile('control BadInput { input request: Bool = false; }'), /host supplies typed quality samples/);
  assert.throws(() => compile('control BadInput { input count: Result<Int, SensorFault>; }'), /input type must be/);
});

test('grouped inputs, let calculation, state memory and output roles remain distinct', () => {
  const result = compile(`control State {
    input x, y: Bool; state active: Bool = false;
    let ready = (x |> recover(false)) && (y |> recover(false));
    active' = ready; output enabled: Bool; enabled <- active';
  }`);
  assert.deepEqual(result.manifest.sensors.map(x => x.name), ['x', 'y']);
  assert.deepEqual(result.manifest.outputs, [{ name: 'enabled', type: 'Bool' }]);
});

test('declaration modules also use canonical quality input with no sensor fallback', () => {
  const result = compile('input reading: Number;');
  assert.equal(result.manifest.sensors[0].name, 'reading');
  assert.throws(() => compile('sensor reading: Number;'), /removed sensor declaration/);
});

test('quantity conditioning and invalid options retain strict types and ranges', () => {
  const artifact = compile(`control Condition {
    input temperature: Temperature {
      sample = 1s; valid = 0°C .. 100°C; filter = median(3);
      stale_after = 3s; recover_after = 2 samples;
    }
    output value: Temperature; value <- temperature |> recover(25°C);
  }`);
  const input = artifact.manifest.sensors[0];
  assert.equal(input.type, 'Temperature');
  assert.equal(input.sampleMs, 1000);
  assert.equal(input.window, 3);
  assert.equal(input.staleMs, 3000);
  assert.equal(input.recoverSamples, 2);
  for (const [filter, kind, window] of [['moving_average(3)', 'moving_average', 3], ['ema(alpha: 0.25)', 'ema', 1]]) {
    const filtered = compile(`control Filter { input reading: Number { filter = ${filter}; } }`).manifest.sensors[0];
    assert.equal(filtered.filter, kind);
    assert.equal(filtered.window, window);
    if (kind === 'ema') assert.equal(filtered.alpha, 0.25);
  }
  for (const config of ['filter = median(2);', 'sample = 0s;', 'valid = 100°C .. 0°C;',
    'valid = 0% .. 100%;', 'recover_after = 0 samples;', 'stale_after = 1s; stale_after = 2s;']) {
    assert.throws(() => compile(`control BadInput { input t: Temperature { ${config} } }`), /median window|durations must be positive|range is inverted|constant Temperature|recover_after|duplicate input option/);
  }
  assert.throws(() => compile('control BadInput { input x: Bool { filter = median(3); } }'), /numeric filtering/);
});

for (const framed of [false, true]) {
  const mode = framed ? 'framed WASM' : 'WASM';
  const instantiate = (artifact, options) => (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate)
    .call(ControlRuntime, wasm(), artifact, options);

  test(`${mode}: healthy false/zero and all four faults preserve explicit control policy`, async () => {
    const runtime = await instantiate(compile(parity));
    try {
      const startup = runtime.step({ nowMs: 0 });
      assert.equal(startup.sensors.request.quality, 'NotReady');
      assert.equal(startup.vm.safe.enabled, true, 'the source explicitly chooses true on fault');
      assert.equal(startup.vm.safe.value, 42);
      const good = runtime.step({ nowMs: 1, samples: {
        request: sample(1, 1, 'Good', false), reading: sample(1, 1, 'Good', 0),
      } });
      assert.equal(good.sensors.request.ok, true);
      assert.equal(good.sensors.request.value, false);
      assert.equal(good.vm.safe.enabled, false);
      assert.equal(good.sensors.reading.ok, true);
      assert.equal(good.vm.safe.value, 0);
      for (const [index, quality] of ['NotReady', 'Disconnected', 'Stale', 'Invalid'].entries()) {
        const at = index + 2;
        const result = runtime.step({ nowMs: at, samples: {
          request: sample(at, at, quality, false), reading: sample(at, at, quality, 0),
        } });
        assert.equal(result.sensors.request.quality, quality);
        assert.equal(result.sensors.request.ok, false);
        assert.equal(result.sensors.reading.quality, quality);
        assert.equal(result.vm.safe.enabled, true);
        assert.equal(result.vm.safe.value, 42);
      }
      assert.throws(() => runtime.step({ nowMs: 10, inputs: { request: false, reading: 0 } }), /unknown input|unsupported|unexpected/);
      assert.throws(() => runtime.step({ nowMs: 10, samples: { request: { quality: 'Good', value: false } } }), /epoch/);
    } finally { runtime.dispose(); }
  });

  test(`${mode}: real observation identity governs filtering, freshness and recovery`, async () => {
    const runtime = await instantiate(compile(`control Fresh {
      input reading: Number { filter = median(3); stale_after = 3s; recover_after = 2 samples; }
      output value: Number; value <- reading |> recover(-1);
    }`));
    try {
      const first = sample(1, 0, 'Good', 0);
      assert.equal(runtime.step({ nowMs: 0, samples: { reading: first } }).sensors.reading.quality, 'NotReady');
      assert.equal(runtime.step({ nowMs: 1, samples: { reading: first } }).sensors.reading.quality, 'NotReady');
      assert.equal(runtime.step({ nowMs: 2, samples: { reading: sample(2, 2, 'Good', 10) } }).sensors.reading.quality, 'NotReady');
      assert.equal(runtime.step({ nowMs: 3, samples: { reading: sample(3, 3, 'Good', 20) } }).vm.safe.value, 10);
      assert.equal(runtime.step({ nowMs: 3002 }).sensors.reading.quality, 'Good');
      assert.equal(runtime.step({ nowMs: 3003 }).sensors.reading.quality, 'Stale');
      assert.equal(runtime.step({ nowMs: 3004, samples: { reading: sample(1, 3004, 'Good', 30, 2) } }).sensors.reading.quality, 'NotReady');
      assert.equal(runtime.step({ nowMs: 3005, samples: { reading: sample(2, 3005, 'Good', 40, 2) } }).sensors.reading.quality, 'NotReady');
      assert.equal(runtime.step({ nowMs: 3006, samples: { reading: sample(3, 3006, 'Good', 50, 2) } }).vm.safe.value, 40);
    } finally { runtime.dispose(); }
  });

  test(`${mode}: optional capability absence is separate from installed faults and healthy false`, async () => {
    const artifact = compile(`control Optional {
      input observation?: Bool; output enabled: Bool;
      adapt policy {
        strategy Present priority 1 match (observation: sensor<Bool>) {
          enabled <- observation |> recover(true);
        }
        strategy Absent priority 0 match always { enabled <- false; }
      }
    }`);
    for (const present of [false, true]) {
      const runtime = await instantiate(artifact, { capabilities: present ? [{ kind: 'sensor', name: 'observation', type: 'Bool' }] : [] });
      try {
        const startup = runtime.step({ nowMs: 0 });
        assert.equal(startup.sensors.observation.quality, 'NotReady');
        assert.equal(startup.vm.safe.enabled, present);
        if (present) {
          assert.equal(runtime.step({ nowMs: 1, samples: { observation: sample(1, 1, 'Good', false) } }).vm.safe.enabled, false);
          const fault = runtime.step({ nowMs: 2, samples: { observation: sample(2, 2, 'Disconnected', false) } });
          assert.equal(fault.vm.safe.enabled, true);
          assert.equal(fault.sensors.observation.quality, 'Disconnected');
        }
      } finally { runtime.dispose(); }
    }
    assert.throws(() => compile('control BadInput { input observation?: Bool; output x: Bool; x <- observation |> recover(false); }'), /optional sensor/);
  });
}

test('compiler migration leaves original text intact and identifies distinct replacement source bytes', () => {
  const original = document('control Stored { sensor request: Bool; output drive: Bool; drive <- request |> recover(true); }');
  const retained = original;
  const replacement = document('control Stored { input request: Bool; output drive: Bool; drive <- request |> recover(true); }');
  assert.throws(() => compileSourceSync(original, { filename: 'stored.ghost.md' }), /new source revision/);
  const artifact = compileSourceSync(replacement, { filename: 'stored.ghost.md' });
  assert.equal(original, retained);
  assert.notEqual(createHash('sha256').update(original).digest('hex'), createHash('sha256').update(replacement).digest('hex'));
  assert.deepEqual(artifact.manifest.inputs, []);
  assert.equal(artifact.manifest.sensors[0].name, 'request');
});

test('grouped quality inputs preserve independent fault observations and recovery choices', async () => {
  const runtime = await ControlRuntime.instantiate(wasm(), compile(`control Group {
    input first, second: Bool; output a, b: Bool;
    a <- first |> recover(true); b <- second |> recover(false);
  }`));
  try {
    const result = runtime.step({ nowMs: 1, samples: {
      first: sample(1, 1, 'Good', false), second: sample(7, 1, 'Disconnected', false, 2),
    } });
    assert.equal(result.sensors.first.ok, true);
    assert.equal(result.sensors.first.value, false);
    assert.equal(result.sensors.second.quality, 'Disconnected');
    assert.deepEqual(result.vm.safe, { a: false, b: false });
    assert.deepEqual(runtime.sensors.get('first').conditioner.sampleIdentity(), { epoch: 1, id: 1, timestampMs: 1 });
  } finally { runtime.dispose(); }
});

test('canonical input composition routes one root observation to a pinned private instance', async () => {
  const child = document('control Child { input reading: Bool; output enabled: Bool; enabled <- reading |> recover(true); }');
  const root = document(`import Child from "./child.ghost.md" revision "child-input-r1" sha256 "${hash(child)}";
    control Root { input observation: Bool; output enabled: Bool; instance child: Child;
      connect child.reading <- observation; connect enabled <- child.enabled;
    }`);
  const closure = [{ filename: 'child.ghost.md', revision: 'child-input-r1', text: child }];
  const before = structuredClone(closure);
  const artifact = compileSourceSync(root, { filename: 'root.ghost.md', sourceClosure: closure });
  assert.deepEqual(closure, before);
  assert.equal(artifact.manifest.sensors[0].name, 'observation');
  assert.equal(artifact.manifest.sensorInstances[0].sourceSensor, 'observation');
  const runtime = await ControlRuntime.instantiateFramed(wasm(), artifact);
  try {
    assert.equal(runtime.step({ nowMs: 0 }).vm.safe.enabled, true);
    assert.equal(runtime.step({ nowMs: 1, samples: { observation: sample(1, 1, 'Good', false) } }).vm.safe.enabled, false);
    assert.equal(runtime.step({ nowMs: 2, samples: { observation: sample(2, 2, 'Disconnected', false) } }).vm.safe.enabled, true);
  } finally { runtime.dispose(); }
});

test('signed portable package retains quality input capabilities, source and WASM admission', async t => {
  const artifact = compile(parity.replace('input request: Bool;', 'input count: Int; output total: Int; total <- count |> recover(-7); input request: Bool;'));
  const keys = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  const identity = {
    compilerRevision: 'issue531-candidate', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/framed-scan-abi-v1', bindingRevision: 'explicit-quality-input-v1',
    requiredCapabilities: [
      { kind: 'sensor', name: 'request', type: 'bool' }, { kind: 'sensor', name: 'reading', type: 'number' },
      { kind: 'sensor', name: 'count', type: 'int' }, { kind: 'actuator', name: 'total', type: 'int' },
      { kind: 'actuator', name: 'enabled', type: 'bool' }, { kind: 'actuator', name: 'value', type: 'number' },
    ],
  };
  const packageValue = await buildPortablePackage(artifact, identity, {
    signers: [{ keyId: 'ephemeral-test-key', privateKey: keys.privateKey }],
    verifyCompilation: (source, options) => compileSourceSync(source, options),
  });
  let loaderCalls = 0;
  const options = {
    trustedKeys: [{ keyId: 'ephemeral-test-key', publicKey: keys.publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: [artifact.manifest.format], expectedBindingRevision: identity.bindingRevision,
    availableCapabilities: identity.requiredCapabilities,
    verifyBytecode: async (bytes, context) => {
      loaderCalls++;
      const runtime = await ControlRuntime.instantiateFramed(wasm(), { bytes, manifest: context.manifest });
      try {
        assert.equal(runtime.step({ nowMs: 0 }).vm.safe.enabled, true);
        assert.equal(runtime.step({ nowMs: 1, samples: { count: sample(1, 1, 'Good', 2147483647) } }).vm.safe.total, 2147483647);
        return true;
      }
      finally { runtime.dispose(); }
    },
  };
  const verified = await verifyPortablePackage(packageValue, options);
  assert.deepEqual([...verified.bytecode.copy()], [...artifact.bytes]);
  assert.deepEqual(verified.manifest.sensors, artifact.manifest.sensors);
  await assert.rejects(() => verifyPortablePackage(packageValue, { ...options,
    availableCapabilities: identity.requiredCapabilities.filter(x => x.name !== 'request'),
  }), /capabilit/);
  await assert.rejects(() => verifyPortablePackage(packageValue, { ...options,
    availableCapabilities: identity.requiredCapabilities.map(x => x.name === 'count' ? { ...x, type: 'number' } : x),
  }), /capabilit/);
  for (const [name, sensorName, patch] of [
    ['fractional Int bound', 'count', { validMin: 0.5, validMax: 10 }],
    ['filtered exact Int', 'count', { filter: 'median', window: 3 }],
    ['changed recovery', 'count', { recoverSamples: 2 }],
    ['changed cadence', 'count', { sampleMs: 100 }],
    ['changed stale bound', 'reading', { staleMs: 100 }],
    ['Bool numeric bounds', 'request', { validMin: 0.2, validMax: 0.8 }],
    ['changed optional installation', 'request', { optional: true }],
  ]) await t.test(name, async () => {
    const changed = structuredClone(packageValue);
    const manifest = JSON.parse(Buffer.from(changed.payload.manifest.contentBase64, 'base64').toString('utf8'));
    Object.assign(manifest.sensors.find(item => item.name === sensorName), patch);
    const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
    changed.payload.manifest.contentBase64 = Buffer.from(manifestBytes).toString('base64');
    changed.payload.manifest.sha256 = createHash('sha256').update(manifestBytes).digest('hex');
    const payload = new TextEncoder().encode(canonicalJson(changed.payload));
    changed.payloadSha256 = createHash('sha256').update(payload).digest('hex');
    changed.signatures = [{ algorithm: 'Ed25519', keyId: 'ephemeral-test-key',
      signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', keys.privateKey, payload)).toString('base64') }];
    const before = loaderCalls;
    await assert.rejects(() => verifyPortablePackage(changed, options), error => {
      assert.equal(error.code, 'source-map-mismatch');
      assert.match(error.cause?.message, /sensors typed quality descriptors do not match canonical source lowering/);
      return true;
    });
    assert.equal(loaderCalls, before, 'a valid signature cannot bypass the canonical acquisition contract');
  });
});
