import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { compile as compileGfb, parse as parseGfb, tokenize as tokenizeGfb } from '../tools/gfb1.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = path.join(root, 'tests/fixtures');
const sourceName = 'gfb2-int-golden-v1.ghost.md';
const artifactName = 'gfb2-int-golden-v1.gfb';
const metadataName = 'gfb2-int-golden-v1.json';
const nativePath = path.join(root, `target/release/examples/run${process.platform === 'win32' ? '.exe' : ''}`);
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const sha256 = value => createHash('sha256').update(value).digest('hex');

// These conformance rows are identified healthy observations. Encoding their
// generated rails is an explicit fixture adapter, never a production fallback.
function goodRails(artifact, values) {
  const rails = {};
  for (const sensor of artifact.manifest.sensors) {
    const name = sensor.name.replace(/^raw_/, '');
    if (!Object.hasOwn(values, name)) continue;
    rails[sensor.valueInput] = values[name];
    rails[sensor.okInput] = true;
    rails[sensor.faultInput] = 0;
  }
  if (Object.hasOwn(values, '__gf_now_ms')) rails.__gf_now_ms = values.__gf_now_ms;
  return rails;
}
function goodFrame(artifact, nowMs, values) {
  return { nowMs, samples: Object.fromEntries(artifact.manifest.sensors.map(sensor => {
    const name = sensor.name.replace(/^raw_/, '');
    assert.ok(Object.hasOwn(values, name), `missing known fixture observation ${name}`);
    return [sensor.name, { epoch: 1, id: nowMs + 1, timestampMs: nowMs,
      value: values[name], quality: 'Good' }];
  })) };
}
function writeGoodCsv(filename, artifact, observations) {
  const rows = observations.map(values => goodRails(artifact, values));
  const names = Object.keys(rows[0]);
  fs.writeFileSync(filename, `${names.join(',')}\n${rows.map(row => names.map(name => row[name]).join(',')).join('\n')}\n`);
}
function setGood(runtime, artifact, name, value) {
  const sensor = artifact.manifest.sensors.find(item => item.name.replace(/^raw_/, '') === name);
  assert.ok(sensor, `missing fixture producer ${name}`);
  const set = sensor.type === 'Bool' ? 'setBool' : sensor.type === 'Int' ? 'setInt' : 'setNumber';
  runtime[set](sensor.valueInput, value);
  runtime.setBool(sensor.okInput, true);
  runtime.setNumber(sensor.faultInput, 0);
}

test('GF-TEST-gfb3-pc10-budget: full curriculum fits the unchanged budget and replays fault/reset on native and WASM', async t => {
  const filename = 'examples/curriculum/pc-10-fault-alarm-reset.ghost.md';
  const artifact = await compileSource(fs.readFileSync(path.join(root, filename), 'utf8'), { filename });
  assert.equal(artifact.bytes.readUInt16LE(4), 3);
  const healthy = { start_request: false, reset_request: false, stop_ok: true, emergency_stop_ok: true,
    overload_ok: true, source_water_ok: true, valve_drive_ok: true, open_limit: false, close_limit: true };
  const opened = { open_limit: true, close_limit: false };
  const frames = [
    [0, {}, 0, 0],
    [1, { start_request: true }, 1, 0],
    [2, opened, 2, 0],
    [2002, opened, 3, 0],
    [2003, { ...opened, source_water_ok: false }, 6, 3],
    [2004, { ...opened, source_water_ok: false }, 7, 3],
    [2005, { source_water_ok: false }, 8, 3],
    [2006, {}, 8, 3],
    [2007, { reset_request: true }, 0, 0],
  ];
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-pc10-branch-budget-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'pc10.gfb');
  const inputPath = path.join(temporary, 'pc10.csv');
  fs.writeFileSync(modulePath, artifact.bytes);
  writeGoodCsv(inputPath, artifact, frames.map(([nowMs, overrides]) => ({ ...healthy, ...overrides, __gf_now_ms: nowMs })));
  const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
  const host = await ControlRuntime.instantiateFramed(fs.readFileSync(wasmPath), artifact);
  t.after(() => host.dispose());
  for (const [index, [nowMs, overrides, phase, faultCause]] of frames.entries()) {
    const wasm = host.step(goodFrame(artifact, nowMs, { ...healthy, ...overrides })).vm;
    assert.equal(native[index].status, 'OK');
    assert.deepEqual(wasm.stateAfter, native[index].trace.stateAfter);
    assert.equal(wasm.stateAfter.phase, phase);
    assert.equal(wasm.stateAfter.fault_cause, faultCause);
    const expected = { valve_open_contactor: phase === 1, valve_close_contactor: phase === 7,
      pump_contactor: phase === 3, alarm: [6, 7, 8].includes(phase) };
    assert.deepEqual(wasm.safe, expected);
    assert.deepEqual(native[index].trace.safe, expected);
  }
});

test('GF-TEST-gfb3-compact-number: every small literal keeps Number identity on native and WASM', async t => {
  const intents = Array.from({ length: 16 }, (_, value) => `(intent value_${value} (if input.guard ${value}.0 input.fallback))`).join(' ');
  const bytes = Buffer.from(compileGfb(parseGfb(tokenizeGfb(
    `(module CompactNumbers (input guard bool) (input fallback number) (strategy control 0 (device true) ${intents}))`,
  ))));
  for (let value = 0; value <= 15; value++) {
    assert.notEqual(bytes.indexOf(Buffer.from([3, 0, 0, 30, 4, 0, 32 + value, 31, 3, 0, 3, 1, 0])), -1);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-compact-numbers-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'numbers.gfb');
  const inputPath = path.join(temporary, 'numbers.csv');
  fs.writeFileSync(modulePath, bytes);
  fs.writeFileSync(inputPath, 'guard,fallback\ntrue,2.5\nfalse,2.5\n');
  const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
  const host = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => host.dispose());
  host.load(bytes);
  for (let value = 0; value < 16; value++) host.addCapability('actuator', `value_${value}`, 'number');
  host.activate();
  for (const [index, guard] of [true, false].entries()) {
    const expected = Object.fromEntries(Array.from({ length: 16 }, (_, value) => [`value_${value}`, guard ? value : 2.5]));
    host.setBool('guard', guard); host.setNumber('fallback', 2.5); host.tick();
    assert.deepEqual(native[index].trace.safe, expected);
    assert.deepEqual(host.trace.safe, expected);
  }
});

test('GF-TEST-gfb3-negative-zero: compact literals never erase the Number negative-zero sign', async t => {
  const bytes = Buffer.from(compileGfb(parseGfb(tokenizeGfb(
    '(module NegativeZero (input guard bool) (strategy control 0 (device true) (intent result (if input.guard -0 16))))',
  ))));
  const negativeZero = Buffer.alloc(9); negativeZero[0] = 2; negativeZero.writeDoubleLE(-0, 1);
  assert.notEqual(bytes.indexOf(negativeZero), -1);
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(bytes); runtime.addCapability('actuator', 'result', 'number'); runtime.activate();
  runtime.setBool('guard', true); runtime.tick();
  assert.ok(Object.is(runtime.intentNumber('result'), -0));
  runtime.setBool('guard', false); runtime.tick();
  assert.equal(runtime.intentNumber('result'), 16);
});

test('GF-TEST-gfb2-int-golden: historical MIN, zero and MAX identities remain fixed while plain source rejects', async () => {
  const source = fs.readFileSync(path.join(fixtures, sourceName), 'utf8');
  const tracked = fs.readFileSync(path.join(fixtures, artifactName));
  const metadata = JSON.parse(fs.readFileSync(path.join(fixtures, metadataName), 'utf8'));
  assert.deepEqual(metadata, {
    format: 'GhostFlow/gfb2-int-golden-v1', source: sourceName,
    sourceSha256: 'a7fcb289b9100dc53bbbf6ac487c03147f09b3763b94c955a891a8e3b24de44a',
    artifact: artifactName, gfbSha256: 'bb1f8b1063bd795f64a791c76e47f1d158fd9009f6eb8f5bcd3bfe33fb098526',
  });
  assert.equal(new DataView(tracked.buffer, tracked.byteOffset).getUint16(4, true), 2);
  assert.equal(sha256(source), 'a7fcb289b9100dc53bbbf6ac487c03147f09b3763b94c955a891a8e3b24de44a');
  assert.equal(sha256(tracked), 'bb1f8b1063bd795f64a791c76e47f1d158fd9009f6eb8f5bcd3bfe33fb098526');
  await assert.rejects(() => compileSource(source, { filename: sourceName }), /output selected_out must be Int/);
  assert.equal(sha256(source), metadata.sourceSha256);
  assert.equal(sha256(tracked), metadata.gfbSha256);
});

test('GF-TEST-gfb2-int-boundary: native and WASM exchange every i32 boundary exactly', async t => {
  const bytes = fs.readFileSync(path.join(fixtures, artifactName));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-gfb2-int-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'integer.gfb');
  const inputPath = path.join(temporary, 'integer.csv');
  fs.writeFileSync(modulePath, bytes);
  fs.writeFileSync(inputPath, 'selected\n-2147483648\n0\n2147483647\n');
  const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(native.map(row => row.trace.safe.selected_out), [-2147483648, 0, 2147483647]);
  assert.deepEqual(native[0].trace.stateAfter, { maximum: 2147483647, minimum: -2147483648, zero: 0 });

  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(bytes);
  for (const name of ['selected_out', 'minimum_out', 'zero_out', 'maximum_out']) runtime.addCapability('actuator', name, 'int');
  runtime.activate();
  const observed = [];
  for (const value of [-2147483648, 0, 2147483647]) {
    runtime.setInt('selected', value);
    runtime.tick();
    observed.push(runtime.intentInt('selected_out'));
  }
  assert.deepEqual(observed, [-2147483648, 0, 2147483647]);
  assert.equal(runtime.stateInt('minimum'), -2147483648);
  assert.equal(runtime.stateInt('maximum'), 2147483647);
  assert.throws(() => runtime.setInt('selected', 1.5), /i32/);
  assert.throws(() => runtime.setInt('selected', -2147483649), /i32/);
  assert.throws(() => runtime.setInt('selected', 2147483648), /i32/);
});

test('GF-TEST-gfb2-input-golden: separately pinned Int quality revision retains exact boundaries through faults', async t => {
  const name = 'gfb2-int-golden-input-v1';
  const source = fs.readFileSync(path.join(fixtures, `${name}.ghost.md`), 'utf8');
  const tracked = fs.readFileSync(path.join(fixtures, `${name}.gfb`));
  const metadata = JSON.parse(fs.readFileSync(path.join(fixtures, `${name}.json`), 'utf8'));
  assert.deepEqual(metadata, {
    format: 'GhostFlow/input-quality-golden-v1', source: `${name}.ghost.md`,
    sourceSha256: '9d997aa2612d8ba3952bca1088bbc41fb938186e5506ef65f4c91219d0fa49e7',
    artifact: `${name}.gfb`, gfbSha256: '54d06aba2e7d4b7757240fc047a952c73c5b535cee094240176d3444b80523b5',
    gfbFormat: 3, sourceRevision: 'canonical-input-quality-v1',
  });
  assert.equal(sha256(source), '9d997aa2612d8ba3952bca1088bbc41fb938186e5506ef65f4c91219d0fa49e7');
  assert.equal(sha256(tracked), '54d06aba2e7d4b7757240fc047a952c73c5b535cee094240176d3444b80523b5');
  assert.equal(metadata.sourceSha256, sha256(source));
  assert.equal(metadata.gfbSha256, sha256(tracked));
  assert.equal(metadata.sourceRevision, 'canonical-input-quality-v1');
  const artifact = await compileSource(source, { filename: `${name}.ghost.md` });
  assert.deepEqual(artifact.bytes, tracked);
  assert.equal(artifact.manifest.sensors[0].type, 'Int');
  assert.deepEqual(artifact.manifest.inputs, []);
  const rows = [[-2147483648, 'Good', -2147483648], [0, 'Disconnected', -2147483648],
    [0, 'Good', 0], [1.5, 'Good', 0], [2147483647, 'Good', 2147483647],
    [0, 'Stale', 2147483647], [0, 'NotReady', 2147483647], [-2147483648, 'Good', -2147483648]];
  const captures = [];
  for (const create of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const runtime = await create.call(ControlRuntime, fs.readFileSync(wasmPath), artifact);
    t.after(() => runtime.dispose());
    const traces = rows.map(([value, quality, expected], index) => {
      const result = runtime.step({ nowMs: index, samples: { selected: {
        epoch: 1, id: index + 1, timestampMs: index, value, quality,
      } } });
      assert.equal(result.vm.safe.selected_out, expected);
      assert.equal(result.vm.inputs.__gf_sensor_ok_selected, quality === 'Good' && Number.isInteger(value));
      return result.vm;
    });
    captures.push(traces);
  }
  assert.deepEqual(captures[0].map(trace => trace.safe), captures[1].map(trace => trace.safe));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-int-input-golden-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const module = path.join(temporary, 'quality.gfb'), csv = path.join(temporary, 'quality.csv');
  const fields = Object.keys(captures[0][0].inputs);
  fs.writeFileSync(module, tracked);
  fs.writeFileSync(csv, `${fields.join(',')}\n${captures[0].map(trace => fields.map(field => trace.inputs[field]).join(',')).join('\n')}\n`);
  const native = execFileSync(nativePath, [module, csv, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  assert.deepEqual(native.map(row => row.trace.safe.selected_out), rows.map(([, , expected]) => expected));
  assert.deepEqual(native.map(row => row.trace.safe), captures[0].map(trace => trace.safe));
});

test('GF-TEST-gfb2-int-rejection: versions and type tags fail closed', async () => {
  const v1 = fs.readFileSync(path.join(fixtures, 'gfb1-golden-v1.gfb'));
  const v2 = fs.readFileSync(path.join(fixtures, artifactName));
  const cases = [];
  const oldAsNew = Buffer.from(v1); oldAsNew.writeUInt16LE(2, 4); cases.push([oldAsNew, /format 2 without Int/]);
  const newAsOld = Buffer.from(v2); newAsOld.writeUInt16LE(1, 4); cases.push([newAsOld, /invalid type/]);
  const unknownVersion = Buffer.from(v2); unknownVersion.writeUInt16LE(255, 4); cases.push([unknownVersion, /unsupported GFB format/]);
  const invalidType = Buffer.from(v2);
  const nameLength = invalidType.readUInt16LE(6);
  const inputTypeOffset = 6 + 2 + nameLength + 4 + 2 + 2 + 'selected'.length;
  invalidType[inputTypeOffset] = 4;
  cases.push([invalidType, /invalid type/]);
  const numberImmediate = Buffer.from(compileGfb(parseGfb(tokenizeGfb(
    '(module NumberImmediate (strategy control 0 (device true) (intent result 6)))',
  ))));
  assert.equal(numberImmediate.readUInt16LE(4), 1);
  assert.notEqual(numberImmediate.indexOf(Buffer.from([2, 0, 0, 0, 0, 0, 0, 24, 64])), -1,
    'the Number constant payload must contain integer opcode byte 24');
  numberImmediate.writeUInt16LE(2, 4);
  cases.push([numberImmediate, /format 2 without Int/]);

  const wasmBytes = fs.readFileSync(wasmPath);
  for (const [bytes, expected] of cases) {
    const runtime = await GhostFlowRuntime.instantiate(wasmBytes);
    try { assert.throws(() => runtime.load(bytes), expected); }
    finally { runtime.dispose(); }
  }
});

test('GF-TEST-framed-v2-int: tag 3 carries signed i32 values without Number inference', async t => {
  const runtime = await FramedGhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(fs.readFileSync(path.join(fixtures, artifactName)));
  for (const name of ['selected_out', 'minimum_out', 'zero_out', 'maximum_out']) runtime.addCapability('actuator', name, 'int');
  runtime.activate();
  for (const [scanId, value] of [-2147483648, 0, 2147483647].entries()) {
    const outcome = runtime.scan({ scanId, logicalTimeMs: scanId, inputs: [{ name: 'selected', type: 'Int', value }] });
    assert.equal(outcome.trace.inputs.selected, value);
    assert.equal(outcome.trace.safe.selected_out, value);
  }
  assert.throws(() => runtime.scan({ scanId: 3, logicalTimeMs: 3, inputs: [{ name: 'selected', type: 'Int', value: 1.5 }] }), /i32/);
  assert.throws(() => runtime.scan({ scanId: 3, logicalTimeMs: 3, inputs: [{ name: 'selected', type: 'Int', value: -2147483649 }] }), /i32/);
  assert.throws(() => runtime.scan({ scanId: 3, logicalTimeMs: 3, inputs: [{ name: 'selected', type: 'Int', value: 2147483648 }] }), /i32/);
});

test('GF-TEST-control-v4-int: manifest-selected legacy and framed hosts preserve Int identity', async t => {
  const source = fs.readFileSync(path.join(fixtures, 'gfb2-int-golden-input-v1.ghost.md'), 'utf8');
  const artifact = await compileSource(source, { filename: 'gfb2-int-golden-input-v1.ghost.md' });
  const wasm = fs.readFileSync(wasmPath);
  for (const create of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const runtime = await create.call(ControlRuntime, wasm, artifact);
    t.after(() => runtime.dispose());
    const result = runtime.step(goodFrame(artifact, 0, { selected: -2147483648 }));
    assert.equal(result.vm.safe.selected_out, -2147483648);
  }
  const runtime = await ControlRuntime.instantiate(wasm, artifact);
  t.after(() => runtime.dispose());
  const invalid = runtime.step(goodFrame(artifact, 0, { selected: 1.5 }));
  assert.equal(invalid.sensors.selected.quality, 'Invalid');
  assert.equal(invalid.vm.safe.selected_out, 0, 'invalid producer payload retains initialized source display');
});

test('GF-TEST-gfb2-int-internal: native and WASM execute Int intermediates without an Int boundary', async t => {
  const artifact = await compileSource(`# Internal integer calculation

\`\`\`ghost
control InternalIntegerCalculation {
  input raw_tick: Bool;
  state remembered_tick: Bool = false;
  let tick = case raw_tick { ok(value) => value; fault(_) => remembered_tick };
  remembered_tick' = tick;
  let quotient = -7 div 3;
  let remainder = -7 % 3;
  output valid: Bool;
  valid <- tick && quotient == -2 && remainder == -1;
}
\`\`\`
`, { filename: 'internal-integer-calculation.ghost.md' });
  assert.equal(new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset).getUint16(4, true), 3);
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v4');
  assert.ok(![...artifact.manifest.inputs, ...artifact.manifest.outputs, ...artifact.manifest.configs]
    .some(item => item.type === 'Int'));

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-gfb2-int-internal-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'internal.gfb');
  const inputPath = path.join(temporary, 'internal.csv');
  fs.writeFileSync(modulePath, artifact.bytes);
  writeGoodCsv(inputPath, artifact, [{ tick: true }]);
  const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(native.map(row => row.status), ['OK']);
  assert.equal(native[0].trace.safe.valid, true);

  const runtime = await ControlRuntime.instantiate(fs.readFileSync(wasmPath), artifact);
  t.after(() => runtime.dispose());
  const result = runtime.step(goodFrame(artifact, 0, { tick: true }));
  assert.equal(result.vm.safe.valid, true);
});

const integerOperations = [
  ['addition', 'a + b', [
    [2147483647, 0, 2147483647],
    [2147483647, 1, 'integer-overflow'],
  ]],
  ['subtraction', 'a - b', [
    [-2147483648, 0, -2147483648],
    [-2147483648, 1, 'integer-overflow'],
  ]],
  ['multiplication', 'a * b', [
    [46340, 46340, 2147395600],
    [46341, 46341, 'integer-overflow'],
  ]],
  ['negation', '-a', [
    [-2147483647, 0, 2147483647],
    [-2147483648, 0, 'integer-overflow'],
  ]],
  ['division', 'a div b', [
    [7, 3, 2],
    [-7, 3, -2],
    [7, -3, -2],
    [-7, -3, 2],
    [1, 0, 'integer-division-by-zero'],
    [-2147483648, -1, 'integer-overflow'],
  ]],
  ['remainder', 'a % b', [
    [7, 3, 1],
    [-7, 3, -1],
    [-2147483648, -1, 0],
    [1, 0, 'integer-division-by-zero'],
  ]],
];

test('REF-01-062 REF-01-064: native and WASM preserve i32 arithmetic boundaries and exact faults', async suite => {
for (const [name, expression, rows] of integerOperations) {
  await suite.test(`GF-TEST-gfb2-int-runtime-${name}: native and WASM produce the exact i32 results and faults`, async t => {
    const wasmBytes = fs.readFileSync(wasmPath);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-gfb2-int-edges-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const artifact = await compileSource(`# ${name}\n\n\`\`\`ghost\ncontrol Integer${name[0].toUpperCase()}${name.slice(1)} {\n  input raw_a: Int;\n  state remembered_a: Int = 0;\n  let a = case raw_a { ok(value) => value; fault(_) => remembered_a };\n  remembered_a' = a;\n  input raw_b: Int;\n  state remembered_b: Int = 0;\n  let b = case raw_b { ok(value) => value; fault(_) => remembered_b };\n  remembered_b' = b;\n  output result: Int;\n  result <- ${expression};\n}\n\`\`\`\n`, {
      filename: `integer-${name}.ghost.md`,
    });
    const modulePath = path.join(temporary, `${name}.gfb`);
    const inputPath = path.join(temporary, `${name}.csv`);
    fs.writeFileSync(modulePath, artifact.bytes);
    writeGoodCsv(inputPath, artifact, rows.map(([a, b]) => ({ a, b })));
    const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' })
      .trim().split('\n').map(line => JSON.parse(line));
    assert.equal(native.length, rows.length);
    const nativeResults = native.map(outcome => outcome.status === 'OK' ? outcome.trace.safe.result : outcome.error);

    const runtime = await GhostFlowRuntime.instantiate(wasmBytes);
    const wasmResults = [];
    try {
      runtime.load(artifact.bytes);
      runtime.addCapability('actuator', 'result', 'int');
      runtime.activate();
      let lastAccepted;
      for (const [index, [a, b]] of rows.entries()) {
        setGood(runtime, artifact, 'a', a);
        setGood(runtime, artifact, 'b', b);
        try {
          runtime.tick();
          lastAccepted = runtime.intentInt('result');
          wasmResults.push(lastAccepted);
        } catch (error) {
          wasmResults.push(error.message);
          if (lastAccepted !== undefined) assert.equal(runtime.intentInt('result'), lastAccepted,
            `${name} rejected WASM row ${index} must not commit`);
        }
      }
    } finally {
      runtime.dispose();
    }
    const expectedResults = rows.map(([, , expected]) => expected);
    assert.deepEqual(
      { native: nativeResults, wasm: wasmResults },
      { native: expectedResults, wasm: expectedResults },
      `${name} exact semantics`,
    );
  });
}
});

test('GF-TEST-gfb2-int-fault-atomicity: rejected intent arithmetic preserves state, intent, and tick', async t => {
  const artifact = await compileSource(`# Integer fault atomicity

\`\`\`ghost
control IntegerFaultAtomicity {
  input raw_numerator: Int;
  state remembered_numerator: Int = 0;
  let numerator = case raw_numerator { ok(value) => value; fault(_) => remembered_numerator };
  remembered_numerator' = numerator;
  input raw_divisor: Int;
  state remembered_divisor: Int = 0;
  let divisor = case raw_divisor { ok(value) => value; fault(_) => remembered_divisor };
  remembered_divisor' = divisor;
  state accepted: Int = 0;
  accepted' = accepted + 1;
  output result: Int;
  result <- numerator div divisor;
}
\`\`\`
`, { filename: 'integer-fault-atomicity.ghost.md' });
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  runtime.addCapability('actuator', 'result', 'int');
  runtime.activate();

  setGood(runtime, artifact, 'numerator', 8);
  setGood(runtime, artifact, 'divisor', 2);
  runtime.tick();
  assert.deepEqual(
    { tick: runtime.trace.tick, journalLength: runtime.journalLength, state: runtime.stateInt('accepted'), intent: runtime.intentInt('result') },
    { tick: 1, journalLength: 1, state: 1, intent: 4 },
  );

  setGood(runtime, artifact, 'numerator', 9);
  setGood(runtime, artifact, 'divisor', 0);
  assert.throws(() => runtime.tick(), /integer-division-by-zero/);
  assert.deepEqual(
    { tick: runtime.trace.tick, journalLength: runtime.journalLength, state: runtime.stateInt('accepted'), intent: runtime.intentInt('result') },
    { tick: 1, journalLength: 1, state: 1, intent: 4 },
  );

  setGood(runtime, artifact, 'divisor', 3);
  runtime.tick();
  assert.deepEqual(
    { tick: runtime.trace.tick, journalLength: runtime.journalLength, state: runtime.stateInt('accepted'), intent: runtime.intentInt('result') },
    { tick: 2, journalLength: 2, state: 2, intent: 3 },
  );
});

const shortCircuitCases = [
  ['if', 'if guard then 7 else 1 div divisor', true, false, 'int', 7],
  ['and', 'guard && (1 div divisor > 0)', false, true, 'bool', false],
  ['or', 'guard || (1 div divisor > 0)', true, false, 'bool', true],
];

test('GF-TEST-gfb3-number-branches: nested Number and Boolean branches preserve order and stack values', async t => {
  const artifact = await compileSource(`# Number branches

\`\`\`ghost
control NumberBranches {
  input raw_guard: Bool;
  state remembered_guard: Bool = false;
  let guard = case raw_guard { ok(value) => value; fault(_) => remembered_guard };
  remembered_guard' = guard;
  input raw_nested: Bool;
  state remembered_nested: Bool = false;
  let nested = case raw_nested { ok(value) => value; fault(_) => remembered_nested };
  remembered_nested' = nested;
  input raw_divisor: Number;
  state remembered_divisor: Number = 0;
  let divisor = case raw_divisor { ok(value) => value; fault(_) => remembered_divisor };
  remembered_divisor' = divisor;
  output result: Number;
  output decision: Bool;
  result <- 2.0 + (if guard then (if nested then 7.0 else 1.0 / divisor) else 9.0);
  decision <- (guard && (nested || 1.0 / divisor > 0.0)) || (if guard then nested else true);
}
\`\`\`
`, { filename: 'number-branches.ghost.md' });
  assert.equal(artifact.bytes.readUInt16LE(4), 3);
  assert.deepEqual(artifact.manifest.sensors.map(sensor => sensor.type), ['Bool', 'Bool', 'Number']);
  const rows = [
    [false, false, 0, 11, true],
    [true, true, 0, 9, true],
    [true, false, 2, 2.5, true],
    [true, false, -2, 1.5, false],
    [true, false, 0, 'division by zero'],
  ];
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-number-branches-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'branch.gfb');
  const inputPath = path.join(temporary, 'branch.csv');
  fs.writeFileSync(modulePath, artifact.bytes);
  writeGoodCsv(inputPath, artifact, rows.map(([guard, nested, divisor]) => ({ guard, nested, divisor })));
  const native = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(native.map(row => row.error ?? [row.trace.safe.result, row.trace.safe.decision]),
    rows.map(row => typeof row[3] === 'string' ? row[3] : row.slice(3)));
  for (const create of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const host = await create.call(ControlRuntime, fs.readFileSync(wasmPath), artifact);
    t.after(() => host.dispose());
    for (const [nowMs, [guard, nested, divisor, result, decision]] of rows.entries()) {
      const step = () => host.step(goodFrame(artifact, nowMs, { guard, nested, divisor }));
      if (typeof result === 'string') assert.throws(step, /division by zero/);
      else assert.deepEqual(step().vm.safe, { result, decision });
    }
  }
});

test('GF-TEST-gfb3-loader: native and WASM reject malformed branches and retired eager opcodes', async t => {
  const valid = Buffer.from(compileGfb(parseGfb(tokenizeGfb(
    '(module Branch (input guard bool) (strategy control 0 (device true) (intent result (if input.guard true false))))',
  ))));
  const expression = Buffer.from([3, 0, 0, 30, 5, 0, 1, 1, 31, 2, 0, 1, 0]);
  const at = valid.indexOf(expression);
  assert.notEqual(at, -1);
  assert.equal(valid.indexOf(expression, at + 1), -1);
  assert.equal(valid.readUInt16LE(4), 3);
  function replace(code, format = 3) {
    const prefix = Buffer.from(valid.subarray(0, at));
    prefix.writeUInt16LE(format, 4);
    prefix.writeUInt32LE(code.length, at - 4);
    return Buffer.concat([prefix, Buffer.from(code), valid.subarray(at + expression.length)]);
  }
  const cases = [
    [replace([1, 1, 30]), /truncated/],
    [replace([1, 1, 30, 0, 0]), /jump must advance/],
    [replace([1, 1, 30, 255, 255]), /outside expression/],
    [replace([1, 1, 30, 1, 0, 1, 1]), /instruction boundary/],
    [replace([1, 1, 30, 5, 0, 1, 1, 31, 1, 0, 255]), /unknown expression opcode/],
    [replace([1, 1, 30, 5, 0, 1, 1, 31, 4, 0, 1, 1, 1, 0]), /branch stack mismatch/],
    [replace(expression, 1), /requires GFB format 3/],
    [replace(expression, 2), /requires GFB format 3/],
  ];
  for (const format of [1, 2, 3]) {
    for (const code of [[1, 1, 1, 0, 11], [1, 1, 1, 0, 12], [1, 1, 1, 1, 1, 0, 18]]) {
      cases.push([replace(code, format), /unknown expression opcode/]);
    }
  }
  for (const format of [1, 2]) {
    for (let opcode = 32; opcode <= 47; opcode++) {
      cases.push([replace([opcode], format), /compact Number opcode requires GFB format 3/]);
    }
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-branch-loader-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'branch.gfb');
  const inputPath = path.join(temporary, 'branch.csv');
  fs.writeFileSync(inputPath, 'guard\ntrue\n');
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  for (const [bytes, expected] of cases) {
    fs.writeFileSync(modulePath, bytes);
    const native = JSON.parse(execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim());
    assert.equal(native.phase, 'load');
    assert.match(native.error, expected);
    assert.throws(() => runtime.load(bytes), expected);
  }
});

test('REF-01-086: if, and, and or short-circuit faulting branches on native and WASM', async suite => {
for (const [name, expression, safeGuard, faultGuard, outputType, expected] of shortCircuitCases) {
  for (const [branch, guard] of [['unselected', safeGuard], ['selected', faultGuard]]) {
  await suite.test(`GF-TEST-gfb2-int-short-circuit-${name}-${branch}: ${branch} faulting branch follows its evaluation contract`, async t => {
    const artifact = await compileSource(`# Integer ${name} short circuit

\`\`\`ghost
control Integer${name[0].toUpperCase()}${name.slice(1)}ShortCircuit {
  input raw_guard: Bool;
  state remembered_guard: Bool = false;
  let guard = case raw_guard { ok(value) => value; fault(_) => remembered_guard };
  remembered_guard' = guard;
  input raw_divisor: Int;
  state remembered_divisor: Int = 0;
  let divisor = case raw_divisor { ok(value) => value; fault(_) => remembered_divisor };
  remembered_divisor' = divisor;
  output result: ${outputType === 'int' ? 'Int' : 'Bool'};
  result <- ${expression};
}
\`\`\`
`, { filename: `integer-${name}-short-circuit.ghost.md` });
    assert.equal(artifact.bytes.readUInt16LE(4), 3);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-short-circuit-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const modulePath = path.join(temporary, 'branch.gfb');
    const inputPath = path.join(temporary, 'branch.csv');
    fs.writeFileSync(modulePath, artifact.bytes);
    writeGoodCsv(inputPath, artifact, [{ guard, divisor: 0 }]);
    const native = JSON.parse(execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim());
    if (branch === 'selected') assert.equal(native.error, 'integer-division-by-zero');
    else assert.equal(native.trace.safe.result, expected);

    for (const create of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
      const host = await create.call(ControlRuntime, fs.readFileSync(wasmPath), artifact);
      t.after(() => host.dispose());
      if (branch === 'selected') assert.throws(() => host.step(goodFrame(artifact, 0, { guard, divisor: 0 })), /integer-division-by-zero/);
      else assert.equal(host.step(goodFrame(artifact, 0, { guard, divisor: 0 })).vm.safe.result, expected);
    }
    const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
    t.after(() => runtime.dispose());
    runtime.load(artifact.bytes);
    runtime.addCapability('actuator', 'result', outputType);
    runtime.activate();

    setGood(runtime, artifact, 'guard', guard);
    setGood(runtime, artifact, 'divisor', 0);
    if (branch === 'selected') {
      assert.throws(() => runtime.tick(), /integer-division-by-zero/);
    } else {
      runtime.tick();
      assert.equal(outputType === 'int' ? runtime.intentInt('result') : runtime.intentBool('result'), expected);
      assert.equal(runtime.trace.tick, 1);
    }
  });
  }
}
});

test('GF-TEST-gfb2-int-rounding: native and WASM preserve ties-to-even on both signs', async t => {
  const artifact = await compileSource(`# Integer rounding\n\n\`\`\`ghost\ncontrol IntegerRounding {\n  input raw_run: Bool;\n  state remembered_run: Bool = false;\n  let run = case raw_run { ok(value) => value; fault(_) => remembered_run };\n  remembered_run' = run;\n  output valid: Bool;\n  valid <- run\n    && int_nearest_even(1.5) == 2\n    && int_nearest_even(2.5) == 2\n    && int_nearest_even(-1.5) == -2\n    && int_nearest_even(-2.5) == -2;\n}\n\`\`\`\n`, { filename: 'integer-rounding.ghost.md' });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-gfb2-int-rounding-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'rounding.gfb');
  const inputPath = path.join(temporary, 'rounding.csv');
  fs.writeFileSync(modulePath, artifact.bytes);
  writeGoodCsv(inputPath, artifact, [{ run: true }]);
  const native = JSON.parse(execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim());
  assert.equal(native.trace.safe.valid, true);

  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(artifact.bytes);
  runtime.addCapability('actuator', 'valid', 'bool');
  runtime.activate();
  setGood(runtime, artifact, 'run', true);
  runtime.tick();
  assert.equal(runtime.intentBool('valid'), true);
});
