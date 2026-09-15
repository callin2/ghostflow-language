import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileControl } from '../tools/control.mjs';
import { compileLessonBundle, canonicalLessonJson } from '../tools/lesson.mjs';
import { compileSource } from './helpers/literate-compile.mjs';
import { observeRuntimeValues, observeSourceTrace } from '../tools/source-trace.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const nativePath = path.join(root, 'target/release/examples/run');

const source = [
  'control TraceFixture {',
  '  input cascade, anyGate, anyAllowed: Bool;',
  '  state latched: Bool = false;',
  "  latched' = cascade;",
  '  output a, b, c, permit, anyTarget, anyA, anyB, mutexA, mutexB: Bool;',
  '  a <- cascade;',
  '  b <- cascade;',
  '  c <- cascade;',
  '  permit <- false;',
  '  anyTarget <- anyGate;',
  '  anyA <- anyAllowed;',
  '  anyB <- false;',
  '  mutexA <- cascade;',
  '  mutexB <- cascade;',
  '  require a => b;',
  '  require b => c;',
  '  require c => permit;',
  '  require anyTarget => (anyA || anyB);',
  '  mutex (mutexA, mutexB);',
  '}',
].join('\n');

const fields = ['cascade', 'anyGate', 'anyAllowed'];
const rows = [
  { cascade: true, anyGate: true, anyAllowed: true },
  { cascade: true, anyGate: true, anyAllowed: false },
  { cascade: false, anyGate: false, anyAllowed: false },
];
const outputs = ['a', 'b', 'c', 'permit', 'anyTarget', 'anyA', 'anyB', 'mutexA', 'mutexB'];

const timerSource = [
  'control TimerTraceFixture {',
  '  input command: Bool;',
  '  state running: Bool = false;',
  "  running' = command;",
  '  timer age = elapsed(running);',
  '  output pump: Bool;',
  '  pump <- running;',
  '}',
].join('\n');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourceTraceShape(trace) {
  return trace.safetyTrace.constraints.map(({ index, kind, names, firstViolation, final }) => ({
    index, kind, names, firstViolation, final,
  }));
}

async function runNativeAndWasm(t, bytes) {
  assert.ok(fs.existsSync(wasmPath), `missing built WASM runtime: ${wasmPath}`);
  assert.ok(fs.existsSync(nativePath), `missing built native runner: ${nativePath}`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-source-trace-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const modulePath = path.join(temporary, 'module.gfb');
  const csvPath = path.join(temporary, 'inputs.csv');
  fs.writeFileSync(modulePath, bytes);
  fs.writeFileSync(csvPath, `${fields.join(',')}\n${rows.map(row => fields.map(name => row[name]).join(',')).join('\n')}\n`);

  const native = execFileSync(nativePath, [modulePath, csvPath, '--outcomes'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(wasmPath));
  t.after(() => runtime.dispose());
  runtime.load(bytes);
  for (const name of outputs) runtime.addCapability('actuator', name, 'bool');
  runtime.activate();
  const wasm = [];
  for (const row of rows) {
    runtime.clearInputs();
    for (const [name, value] of Object.entries(row)) runtime.setBool(name, value);
    runtime.tick();
    wasm.push({ status: 'OK', trace: runtime.trace });
  }
  assert.deepEqual(wasm, native, 'native and WASM must agree on the complete source-trace observation');
  return wasm.map(outcome => outcome.trace);
}

function lessonBundle(markdown) {
  const bundle = {
    format: 'ghostflow-lesson-v1',
    lessonId: 'source-trace', revision: 'r1', title: 'Source trace', locale: 'en',
    source: { text: markdown, sha256: sha256(markdown), mediaType: 'text/markdown; profile=ghostflow-literate' },
    playback: { durationMs: 1000, checkpoints: [{ atMs: 0, sourceSpan: { startLine: 4, endLine: 4 }, narration: '', scenarioId: 'trace' }] },
    scenarios: [{ id: 'trace', title: 'Trace', frames: [{ atMs: 0, inputs: {} }] }],
    toolchain: { compilerId: 'ghostflow-control', compilerRevision: 'test', runtimeId: 'ghostflow', runtimeRevision: 'test', abiVersion: 1 },
  };
  return { ...bundle, bundleSha256: sha256(canonicalLessonJson(bundle)) };
}

test('source trace records actual compiler nodes, bindings, ordered constraint kinds, and byte fingerprint', async t => {
  const compiled = await compileSource(source, { filename: 'trace.ghost' });
  const direct = compileControl(source, { filename: 'trace.ghost' });
  const signature = trace => ({
    moduleFingerprint: trace.moduleFingerprint,
    bindings: trace.bindings.map(({ nodeId, kind, name, fields }) => ({ nodeId, kind, name, fields })),
    dependencies: trace.dependencies,
    constraints: trace.constraints.map(({ index, kind, names, nodeId }) => ({ index, kind, names, nodeId })),
  });
  const { sourceDocumentSha256, bytecodeSha256 } = compiled.traceMetadata;
  assert.deepEqual(signature(compiled.traceMetadata), signature(direct.traceMetadata));
  assert.equal(sourceDocumentSha256, compiled.sourceDocument.sha256);
  assert.equal(bytecodeSha256, compiled.manifest.bytecodeSha256);
  assert.equal(compiled.traceMetadata.format, 'GhostFlow/source-trace-v1');

  assert.deepEqual(compiled.traceMetadata.bindings.map(({ kind, name, fields }) => ({ kind, name, fields })), [
    { kind: 'input', name: 'cascade', fields: ['inputs'] },
    { kind: 'input', name: 'anyGate', fields: ['inputs'] },
    { kind: 'input', name: 'anyAllowed', fields: ['inputs'] },
    { kind: 'state', name: 'latched', fields: ['stateBefore', 'stateAfter'] },
    { kind: 'next', name: 'latched', fields: ['stateAfter'] },
    { kind: 'connection', name: 'a', fields: ['requested', 'safe'] },
    { kind: 'connection', name: 'b', fields: ['requested', 'safe'] },
    { kind: 'connection', name: 'c', fields: ['requested', 'safe'] },
    { kind: 'connection', name: 'permit', fields: ['requested', 'safe'] },
    { kind: 'connection', name: 'anyTarget', fields: ['requested', 'safe'] },
    { kind: 'connection', name: 'anyA', fields: ['requested', 'safe'] },
    { kind: 'connection', name: 'anyB', fields: ['requested', 'safe'] },
    { kind: 'connection', name: 'mutexA', fields: ['requested', 'safe'] },
    { kind: 'connection', name: 'mutexB', fields: ['requested', 'safe'] },
  ]);
  for (const entry of [...compiled.traceMetadata.bindings, ...compiled.traceMetadata.constraints]) {
    const node = compiled.sourceMap.find(candidate => candidate.id === entry.nodeId);
    assert.ok(node, `metadata node ${entry.nodeId} exists in the compiler source map`);
    assert.equal(node.kind, entry.kind === 'requires' || entry.kind === 'requires-any' ? 'require' : entry.kind);
    assert.deepEqual({ filename: entry.source.filename, line: entry.source.line, column: entry.source.column }, {
      filename: node.filename, line: node.line, column: node.column,
    });
  }
  assert.deepEqual(compiled.traceMetadata.constraints.map(({ index, kind, names }) => ({ index, kind, names })), [
    { index: 0, kind: 'requires', names: ['a', 'b'] },
    { index: 1, kind: 'requires', names: ['b', 'c'] },
    { index: 2, kind: 'requires', names: ['c', 'permit'] },
    { index: 3, kind: 'requires-any', names: ['anyTarget', 'anyA', 'anyB'] },
    { index: 4, kind: 'mutex', names: ['mutexA', 'mutexB'] },
  ]);

  const traces = await runNativeAndWasm(t, compiled.bytes);
  for (const trace of traces) assert.equal(trace.module, compiled.traceMetadata.moduleFingerprint);
});

test('source trace remaps extracted and lesson literate locations while retaining extracted coordinates', async () => {
  const markdown = ['# Trace lesson', '', '```ghost', source, '```', ''].join('\n');
  const direct = await compileSource(markdown, { filename: 'trace.ghost.md' });
  const input = direct.traceMetadata.bindings.find(entry => entry.name === 'cascade');
  assert.equal(input.source.filename, 'trace.ghost.md');
  assert.equal(input.source.line, input.extractedSource.line + 3);
  assert.equal(input.extractedSource.filename, 'trace.ghost.md');

  const compiledLesson = await compileLessonBundle(JSON.stringify(lessonBundle(markdown)));
  const lessonInput = compiledLesson.compilation.traceMetadata.bindings.find(entry => entry.name === 'cascade');
  assert.equal(lessonInput.source.filename, 'source-trace@r1.ghost.md');
  assert.equal(lessonInput.source.line, lessonInput.extractedSource.line + 3);
  assert.equal(compiledLesson.compilation.traceMetadata.moduleFingerprint, direct.traceMetadata.moduleFingerprint);
});

test('each authored timer binds its two generated runtime states to the timer declaration', async () => {
  const direct = await compileSource(timerSource, { filename: 'timer-trace.ghost' });
  const timerNode = direct.sourceMap.find(node => node.kind === 'timer');
  assert.ok(timerNode, 'the authored timer AST node exists in the compiler source map');
  const timerBindings = direct.traceMetadata.bindings.filter(entry => entry.kind === 'timer');
  assert.deepEqual(timerBindings.map(({ kind, name, fields, generated }) => ({ kind, name, fields, generated })), [
    {
      kind: 'timer', name: '__gf_timer_since_age', fields: ['stateBefore', 'stateAfter'],
      generated: { declaration: 'age', role: 'since' },
    },
    {
      kind: 'timer', name: '__gf_timer_initialized_age', fields: ['stateBefore', 'stateAfter'],
      generated: { declaration: 'age', role: 'initialized' },
    },
  ]);
  for (const binding of timerBindings) {
    assert.equal(binding.nodeId, timerNode.id);
    assert.deepEqual(
      { filename: binding.source.filename, line: binding.source.line, column: binding.source.column },
      { filename: timerNode.filename, line: timerNode.line, column: timerNode.column },
    );
  }

  const markdown = ['# Timer trace', '', '```ghost', timerSource, '```', ''].join('\n');
  const literate = await compileSource(markdown, { filename: 'timer-trace.ghost.md' });
  const literateTimer = literate.sourceMap.find(node => node.kind === 'timer');
  for (const binding of literate.traceMetadata.bindings.filter(entry => entry.kind === 'timer')) {
    assert.equal(binding.nodeId, literateTimer.id);
    assert.deepEqual(binding.source, { filename: 'timer-trace.ghost.md', line: literateTimer.line, column: literateTimer.column });
    assert.deepEqual(
      { filename: binding.extractedSource.filename, line: binding.extractedSource.line, column: binding.extractedSource.column },
      { filename: 'timer-trace.ghost.md', line: literateTimer.extracted.line, column: literateTimer.extracted.column },
    );
  }

  const observed = observeSourceTrace(direct.traceMetadata, {
    module: direct.traceMetadata.moduleFingerprint,
    inputs: {},
    stateBefore: { __gf_timer_since_age: 1000, __gf_timer_initialized_age: true },
    stateAfter: { __gf_timer_since_age: 2000, __gf_timer_initialized_age: true },
    requested: {}, safe: {},
    safetyTrace: { format: 'GhostFlow/safety-trace-v1', constraints: [] },
  });
  assert.deepEqual(observed.bindings.filter(entry => entry.kind === 'timer').map(entry => entry.observations), [
    [
      { field: 'stateBefore', observed: true, value: 1000 },
      { field: 'stateAfter', observed: true, value: 2000 },
    ],
    [
      { field: 'stateBefore', observed: true, value: true },
      { field: 'stateAfter', observed: true, value: true },
    ],
  ]);

  assert.deepEqual(observeRuntimeValues(direct.traceMetadata, {
    module: direct.traceMetadata.moduleFingerprint,
    inputs: { __gf_now_ms: 301_000 },
    stateAfter: { running: true, __gf_timer_since_age: 1000, __gf_timer_initialized_age: true },
  }), {
    format: 'GhostFlow/runtime-values-v1',
    moduleFingerprint: direct.traceMetadata.moduleFingerprint,
    values: [
      { kind: 'state', name: 'running', valueType: 'Bool', value: true },
      { kind: 'timer', name: 'age', valueType: 'Duration', unit: 'ms', value: 300_000 },
    ],
  });
});

test('runtime values preserve false and zero and never expose generated timer storage', async () => {
  const direct = await compileSource(timerSource, { filename: 'timer-values.ghost' });
  const trace = {
    module: direct.traceMetadata.moduleFingerprint,
    inputs: { __gf_now_ms: 0 },
    stateAfter: { running: false, __gf_timer_since_age: 0, __gf_timer_initialized_age: true },
  };
  const observed = observeRuntimeValues(direct.traceMetadata, trace);
  assert.deepEqual(observed.values, [
    { kind: 'state', name: 'running', valueType: 'Bool', value: false },
    { kind: 'timer', name: 'age', valueType: 'Duration', unit: 'ms', value: 0 },
  ]);
  assert.equal(JSON.stringify(observed).includes('__gf_'), false);

  delete trace.stateAfter.__gf_timer_since_age;
  assert.deepEqual(observeRuntimeValues(direct.traceMetadata, trace).values, [
    { kind: 'state', name: 'running', valueType: 'Bool', value: false },
  ]);
  assert.throws(() => observeRuntimeValues(direct.traceMetadata, { ...trace, module: 'stale' }), /identity mismatch/);
});

test('source observations bind state, next, requested, safe, and exact safety outcomes', async t => {
  const compiled = await compileSource(source, { filename: 'trace.ghost' });
  const [trace] = await runNativeAndWasm(t, compiled.bytes);
  const observed = observeSourceTrace(compiled.traceMetadata, trace);
  assert.equal(observed.sourceDocumentSha256, compiled.sourceDocument.sha256);
  assert.equal(observed.bytecodeSha256, compiled.manifest.bytecodeSha256);
  const binding = name => observed.bindings.find(entry => entry.name === name);
  assert.deepEqual(binding('cascade').observations, [{ field: 'inputs', observed: true, value: true }]);
  assert.deepEqual(binding('latched').observations, [
    { field: 'stateBefore', observed: true, value: false },
    { field: 'stateAfter', observed: true, value: true },
  ]);
  assert.deepEqual(observed.bindings.filter(entry => entry.kind === 'next').map(entry => entry.observations), [[
    { field: 'stateAfter', observed: true, value: true },
  ]]);
  assert.deepEqual(binding('a').observations, [
    { field: 'requested', observed: true, value: true },
    { field: 'safe', observed: true, value: false },
  ]);
  assert.deepEqual(binding('permit').observations, [
    { field: 'requested', observed: true, value: false },
    { field: 'safe', observed: true, value: false },
  ]);
  const missingInputTrace = structuredClone(trace);
  delete missingInputTrace.inputs.cascade;
  const missingInput = observeSourceTrace(compiled.traceMetadata, missingInputTrace)
    .bindings.find(entry => entry.name === 'cascade');
  assert.deepEqual(missingInput.observations, [{ field: 'inputs', observed: false }]);
});

test('native and WASM safety traces match independent cascade, requires-any, mutex, and satisfied expectations', async t => {
  const compiled = await compileSource(source, { filename: 'trace.ghost' });
  const traces = await runNativeAndWasm(t, compiled.bytes);
  assert.deepEqual({ a: traces[0].requested.a, b: traces[0].requested.b, c: traces[0].requested.c }, { a: true, b: true, c: true });
  assert.deepEqual({ a: traces[0].safe.a, b: traces[0].safe.b, c: traces[0].safe.c }, { a: false, b: false, c: false });
  assert.deepEqual(traces[0].faults, [
    'mutex:mutexA,mutexB', 'requires:a:b', 'requires:b:c', 'requires:c:permit',
  ]);
  assert.deepEqual({ a: traces[1].requested.a, b: traces[1].requested.b, c: traces[1].requested.c }, { a: true, b: true, c: true });
  assert.deepEqual({ a: traces[1].safe.a, b: traces[1].safe.b, c: traces[1].safe.c }, { a: false, b: false, c: false });
  assert.deepEqual(traces[1].faults, [
    'mutex:mutexA,mutexB', 'requires:a:b', 'requires:anyTarget:anyA|anyB', 'requires:b:c', 'requires:c:permit',
  ]);
  assert.deepEqual(sourceTraceShape(traces[0]), [
    { index: 0, kind: 'requires', names: ['a', 'b'], firstViolation: { round: 2, values: { a: true, b: false }, blocked: ['a'] }, final: { round: 3, values: { a: false, b: false }, satisfied: true } },
    { index: 1, kind: 'requires', names: ['b', 'c'], firstViolation: { round: 1, values: { b: true, c: false }, blocked: ['b'] }, final: { round: 3, values: { b: false, c: false }, satisfied: true } },
    { index: 2, kind: 'requires', names: ['c', 'permit'], firstViolation: { round: 0, values: { c: true, permit: false }, blocked: ['c'] }, final: { round: 3, values: { c: false, permit: false }, satisfied: true } },
    { index: 3, kind: 'requires-any', names: ['anyTarget', 'anyA', 'anyB'], firstViolation: null, final: { round: 3, values: { anyTarget: true, anyA: true, anyB: false }, satisfied: true } },
    { index: 4, kind: 'mutex', names: ['mutexA', 'mutexB'], firstViolation: { round: 0, values: { mutexA: true, mutexB: true }, blocked: ['mutexA', 'mutexB'] }, final: { round: 3, values: { mutexA: false, mutexB: false }, satisfied: true } },
  ]);
  assert.deepEqual(sourceTraceShape(traces[1]), [
    { index: 0, kind: 'requires', names: ['a', 'b'], firstViolation: { round: 2, values: { a: true, b: false }, blocked: ['a'] }, final: { round: 3, values: { a: false, b: false }, satisfied: true } },
    { index: 1, kind: 'requires', names: ['b', 'c'], firstViolation: { round: 1, values: { b: true, c: false }, blocked: ['b'] }, final: { round: 3, values: { b: false, c: false }, satisfied: true } },
    { index: 2, kind: 'requires', names: ['c', 'permit'], firstViolation: { round: 0, values: { c: true, permit: false }, blocked: ['c'] }, final: { round: 3, values: { c: false, permit: false }, satisfied: true } },
    { index: 3, kind: 'requires-any', names: ['anyTarget', 'anyA', 'anyB'], firstViolation: { round: 0, values: { anyTarget: true, anyA: false, anyB: false }, blocked: ['anyTarget'] }, final: { round: 3, values: { anyTarget: false, anyA: false, anyB: false }, satisfied: true } },
    { index: 4, kind: 'mutex', names: ['mutexA', 'mutexB'], firstViolation: { round: 0, values: { mutexA: true, mutexB: true }, blocked: ['mutexA', 'mutexB'] }, final: { round: 3, values: { mutexA: false, mutexB: false }, satisfied: true } },
  ]);
  assert.deepEqual(sourceTraceShape(traces[2]), [
    { index: 0, kind: 'requires', names: ['a', 'b'], firstViolation: null, final: { round: 0, values: { a: false, b: false }, satisfied: true } },
    { index: 1, kind: 'requires', names: ['b', 'c'], firstViolation: null, final: { round: 0, values: { b: false, c: false }, satisfied: true } },
    { index: 2, kind: 'requires', names: ['c', 'permit'], firstViolation: null, final: { round: 0, values: { c: false, permit: false }, satisfied: true } },
    { index: 3, kind: 'requires-any', names: ['anyTarget', 'anyA', 'anyB'], firstViolation: null, final: { round: 0, values: { anyTarget: false, anyA: false, anyB: false }, satisfied: true } },
    { index: 4, kind: 'mutex', names: ['mutexA', 'mutexB'], firstViolation: null, final: { round: 0, values: { mutexA: false, mutexB: false }, satisfied: true } },
  ]);
  const falseTarget = traces[2].safetyTrace.constraints[2];
  assert.equal(falseTarget.final.satisfied, true);
  assert.equal(falseTarget.final.values.c, false);
  assert.equal(falseTarget.final.values.permit, false);
});

test('observeSourceTrace fails closed for unknown, identity, index, and name mismatches', async t => {
  const compiled = await compileSource(source, { filename: 'trace.ghost' });
  const [trace] = await runNativeAndWasm(t, compiled.bytes);
  assert.throws(() => observeSourceTrace(undefined, trace), /module identity mismatch/);
  assert.throws(() => observeSourceTrace({ ...compiled.traceMetadata, format: 'unknown' }, trace), /module identity mismatch/);
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, { ...trace, module: '0000000000000000' }), /module identity mismatch/);
  const badIndex = structuredClone(trace);
  badIndex.safetyTrace.constraints[0].index = 99;
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, badIndex), /mapping mismatch/);
  const badNames = structuredClone(trace);
  badNames.safetyTrace.constraints[0].names = ['forged', 'b'];
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, badNames), /mapping mismatch/);
  const badFormat = structuredClone(trace);
  badFormat.safetyTrace.format = 'unknown';
  assert.throws(() => observeSourceTrace(compiled.traceMetadata, badFormat), /safety trace unavailable/);
});
