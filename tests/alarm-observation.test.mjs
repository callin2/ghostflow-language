import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { prepareAlarmObservation, parseAlarmDescriptor, encodeAlarmQuery } from '../tools/alarm-observation.mjs';
import { interactionSchemaSha256 } from '../contracts/interaction-v0/validate.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { AlarmObservationRuntime } from '../runtimes/wasm/alarm-observation.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { softwareQualityRails } from './helpers/software-quality-observations.mjs';

const root = new URL('../', import.meta.url).pathname;
const filename = 'contracts/alarm-v1/examples/temperature.ghost.md';
const source = readFileSync(join(root, filename), 'utf8');
const wasm = readFileSync(join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const executable = join(root, 'target/release/examples/alarm_tape');
const identity = { runId: 'run.temperature.1', streamId: 'stream.alarms.1' };
function compile(text = source) { return compileSourceSync(text, { filename,
  interactionSourceIdentity: { documentId: 'source.alarm-temperature', revisionId: 'revision.alarm-temperature.v1' } }); }
function descriptor(a, capacity = 8) {
  const schema = a.interactionSchema, p = schema.descriptors[0].provenance;
  return structuredClone({ format: 'GhostFlow/alarm-descriptor-v1', version: 1,
    schema: { format: schema.format, version: schema.version, sha256: interactionSchemaSha256(schema) }, module: schema.module, source: schema.source,
    retention: { capacity, policy: 'drop-oldest-report-gap' }, alarms: [{ id: 'alarm.temperature', kind: 'alarm',
      condition: { descriptorId: 'state.hot', activeWhen: true },
      severity: { code: 'attention', meaning: 'This software condition needs attention.' },
      meaning: { raised: 'The authored hot condition became true.', cleared: 'The authored hot condition became false.' },
      provenance: { sourceNodeId: p.sourceNode.id, intentAnchorIds: p.intentAnchorIds } }] });
}
function frame(a, scanId, temperature, divisor = 1, logicalTimeMs = 50) {
  return { scanId, logicalTimeMs, inputs: Object.entries(softwareQualityRails(a, { temperature, divisor }, scanId + 1, logicalTimeMs)).map(([name, value]) => ({ name, value })) };
}
async function raw(t, a) {
  const runtime = await FramedGhostFlowRuntime.instantiate(wasm); t.after(() => runtime.dispose());
  runtime.load(a.bytes); for (const out of a.manifest.outputs) runtime.addCapability('actuator', out.name, out.type === 'Bool' ? 'bool' : 'number'); runtime.activate(); return runtime;
}
function native(t, a, binding, actions) {
  const dir = mkdtempSync(join(tmpdir(), 'alarm-owner-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, value] of [['program.gfb', a.bytes], ['binding.bin', binding.bytes], ['tape.json', JSON.stringify({ actions })]]) writeFileSync(join(dir, name), value);
  return spawnSync(executable, [join(dir, 'program.gfb'), join(dir, 'binding.bin'), binding.sha256, join(dir, 'tape.json')], { encoding: 'utf8' });
}
function execute(runtime, actions) {
  return actions.map(action => {
    if (action.frame) { try { return { accepted: true, ...runtime.scan(action.frame) }; } catch (error) { return { accepted: false, error: error.message }; } }
    try { return runtime.queryAlarms(Uint8Array.from(action.query)); } catch (error) { return { error: error.message }; }
  });
}
async function parity(t, a, d, actions) {
  const binding = prepareAlarmObservation(a, d).bind(identity), runtime = await raw(t, a);
  runtime.activateAlarms(binding.bytes, binding.sha256);
  const actual = execute(runtime, actions(binding));
  const result = native(t, a, binding, actions(binding));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(actual, result.stdout.trim().split('\n').map(JSON.parse));
  return { actual, runtime, binding };
}
const query = (binding, cursor = null) => ({ query: [...encodeAlarmQuery(binding, cursor)] });

test('GF-TEST-alarm-source-provenance: matching forged metadata, schema digest and descriptor cannot invent an anchor', () => {
  const a = compile(), anchorId = 'GF-ABSENT-FROM-SOURCE';
  const provenance = a.interactionSchema.descriptors.find(state => state.id === 'state.hot').provenance;
  assert.equal(source.includes(anchorId), false);
  a.traceMetadata.intentLinks.filter(link => link.nodeId === provenance.sourceNode.id)
    .forEach(link => { link.anchorId = anchorId; });
  provenance.intentAnchorIds = [anchorId];
  const d = descriptor(a);
  assert.equal(d.schema.sha256, interactionSchemaSha256(a.interactionSchema));
  assert.deepEqual(d.alarms[0].provenance.intentAnchorIds, [anchorId]);
  assert.throws(() => prepareAlarmObservation(a, d), /traceMetadata.*canonical.*replay/);
});

test('GF-TEST-alarm-profile-provenance: admitted profile source prepares alarms without an external profile closure', () => {
  const definition = { kind: 'board', connections: {}, defaults: {}, channels: { RO1: { role: 'output', type: 'Number' } } };
  const text = `---\nprofile: example-board@1\nbindings:\n  temperature: software:temperature\n  divisor: software:divisor\n  ratio: board.RO1\n---\n${source}`;
  const a = compileSourceSync(text, { filename,
    hardwareProfiles: [{ ref: 'example-board@1', definition, sha256: sha256Hex(canonicalJson(definition)) }],
    interactionSourceIdentity: { documentId: 'source.alarm-profile', revisionId: 'revision.alarm-profile.v1' } });
  const { hardwarePlan: _plan, ...persisted } = a;
  const d = descriptor(a);
  assert.equal(persisted.sourceDocument.text, text);
  assert.equal(persisted.interactionSchema.source.sha256, sha256Hex(text));
  assert.ok(prepareAlarmObservation(persisted, d).bind(identity).bytes.length > 0);
  const provenance = persisted.interactionSchema.descriptors.find(state => state.id === 'state.hot').provenance;
  persisted.traceMetadata.intentLinks.filter(link => link.nodeId === provenance.sourceNode.id)
    .forEach(link => { link.anchorId = 'GF-ABSENT-FROM-PROFILE-SOURCE'; });
  provenance.intentAnchorIds = ['GF-ABSENT-FROM-PROFILE-SOURCE'];
  assert.throws(() => prepareAlarmObservation(persisted, descriptor(persisted)), /traceMetadata.*canonical.*replay/);
});

test('GF-TEST-alarm-provenance: explicit metadata binds exact source, module, Bool node and intent anchors', () => {
  const a = compile(), d = descriptor(a);
  assert.deepEqual(parseAlarmDescriptor(canonicalJson(d)), d);
  assert.throws(() => parseAlarmDescriptor(canonicalJson(d).replace('"version":1', '"version":1,"version":1')), /canonical/);
  let reads = 0; const captured = descriptor(a);
  Object.defineProperty(captured.alarms[0].provenance, 'sourceNodeId', { enumerable: true, get() { reads++; return a.interactionSchema.descriptors[0].provenance.sourceNode.id; } });
  prepareAlarmObservation(a, captured).bind(identity); assert.equal(reads, 1, 'descriptor properties are captured once before validation');
  const prepared = prepareAlarmObservation(a, d), before = prepared.bind(identity);
  d.alarms[0].provenance.intentAnchorIds[0] = 'tampered';
  assert.deepEqual(prepared.bind(identity), before, 'capture owns all descriptor fields');
  assert.throws(() => { prepared.descriptor.alarms[0].meaning.raised = 'mutated'; }, TypeError);
  for (const mutate of [
    d => { d.alarm = {}; }, d => { d.version = 2; }, d => { d.source.sha256 = '0'.repeat(64); },
    d => { d.module.bytecodeSha256 = '0'.repeat(64); }, d => { d.schema.sha256 = '0'.repeat(64); },
    d => { d.alarms[0].provenance.sourceNodeId++; }, d => { d.alarms[0].provenance.intentAnchorIds = []; },
    d => { d.alarms[0].condition.descriptorId = 'state.observed'; }, d => { d.alarms[0].condition.descriptorId = 'ratio'; },
    d => { d.alarms[0].condition.activeWhen = false; }, d => { d.alarms[0].condition.expression = 'hot'; },
    d => { d.alarms.push(structuredClone(d.alarms[0])); }, d => { d.alarms[0].severity.meaning = ''; },
    d => { d.retention.capacity = 0; }, d => { d.retention.policy = 'block-control'; },
  ]) { const invalid = descriptor(a); mutate(invalid); assert.throws(() => prepareAlarmObservation(a, invalid)); }
  const revised = compile(source.replace('value > 30', 'value > 40'));
  assert.throws(() => prepareAlarmObservation(revised, descriptor(a)), /identity mismatch/);
  const forged = { ...a, bytes: revised.bytes };
  assert.throws(() => prepareAlarmObservation(forged, descriptor(a)), /canonical literate source replay/);
  assert.throws(() => new AlarmObservationRuntime({}, {}), /instantiate/);
});

test('GF-TEST-alarm-short-episode: native/WASM completed false-true-false retains raised and cleared after last scan', async t => {
  const a = compile();
  const { actual, runtime, binding } = await parity(t, a, descriptor(a), b => [
    { frame: frame(a, 0, 20) }, { frame: frame(a, 1, 40) }, { frame: frame(a, 2, 20) }, query(b),
  ]);
  const report = actual.at(-1);
  assert.equal(report.format, 'GhostFlow/alarm-report-v1');
  assert.equal(report.current.alarms[0].state, 'inactive');
  assert.deepEqual(report.events.map(e => [e.transition, e.sequence, e.episodeSequence, e.scanId, e.logicalTimeMs]),
    [['raised', 0, 0, 1, 50], ['cleared', 1, 0, 2, 50]]);
  assert.deepEqual(report.context, { bytecodeSha256: a.interactionSchema.module.bytecodeSha256,
    moduleFingerprint: a.interactionSchema.module.moduleFingerprint, moduleId: a.manifest.name,
    sourceSha256: a.interactionSchema.source.sha256, documentId: a.interactionSchema.source.documentId, revisionId: a.interactionSchema.source.revisionId,
    schemaSha256: interactionSchemaSha256(a.interactionSchema), descriptorSha256: prepareAlarmObservation(a, descriptor(a)).descriptorSha256,
    ...identity, bindingSha256: binding.sha256 });
  const original = structuredClone(report); report.events[0].intentAnchorIds[0] = 'changed'; report.current.alarms[0].state = 'active';
  assert.deepEqual(runtime.queryAlarms(encodeAlarmQuery(binding)), original, 'returned records cannot mutate Rust owner');
  assert.equal(runtime.scan(frame(a, 3, 20)).scanId, 3, 'reads did not advance scans');
  assert.equal(runtime.queryAlarms(encodeAlarmQuery(binding)).events.length, 2);
});

test('GF-TEST-alarm-history: repeats, new episodes, bounded gaps, reconnect and cursor identities agree in native/WASM', async t => {
  const a = compile();
  const { actual } = await parity(t, a, descriptor(a, 2), b => [
    { frame: frame(a, 0, 40) }, { frame: frame(a, 1, 40) }, { frame: frame(a, 2, 20) },
    { frame: frame(a, 3, 40) }, { frame: frame(a, 4, 20) }, query(b), query(b), query(b, 0), query(b, 2), query(b, 3),
    query({ ...b, runId: 'different-run' }), query({ ...b, streamId: 'different-stream' }), query({ ...b, sha256: '0'.repeat(64) }), query(b, 4),
  ]);
  const report = actual[5];
  assert.deepEqual(report.events.map(e => [e.sequence, e.episodeSequence, e.transition]), [[2, 2, 'raised'], [3, 2, 'cleared']]);
  assert.deepEqual(report.coverage, { capacity: 2, oldestSequence: 2, latestSequence: 3, gap: { reason: 'retention-overflow', fromSequence: 0, toSequence: 1 } });
  assert.deepEqual(actual[5], actual[6]);
  assert.deepEqual(actual[7].coverage.gap, { reason: 'retention-overflow', fromSequence: 1, toSequence: 1 });
  assert.equal(actual[8].coverage.gap, null); assert.deepEqual(actual[8].events.map(e => e.sequence), [3]);
  assert.deepEqual(actual[9].events, []);
  for (const row of actual.slice(10)) assert.match(row.error, /cursor/);
});

test('GF-TEST-alarm-atomicity: rejected evaluation, stale scans and reverse clocks do not create a baseline or transitions', async t => {
  const a = compile();
  const { actual } = await parity(t, a, descriptor(a), b => [query(b), { frame: frame(a, 0, 40, 0) }, query(b),
    { frame: frame(a, 0, 20) }, query(b), { frame: frame(a, 1, 40, 0) }, query(b),
    { frame: frame(a, 1, 40) }, query(b), { frame: frame(a, 1, 20) }, query(b),
    { frame: frame(a, 2, 20, 1, 49) }, query(b), { frame: frame(a, 2, 20) }, query(b)]);
  assert.equal(actual[0].current.alarms[0].state, 'unobserved'); assert.equal(actual[0].current.scanId, null);
  assert.deepEqual(actual[0], actual[2]); assert.deepEqual(actual[4], actual[6]);
  assert.deepEqual(actual[8], actual[10]); assert.deepEqual(actual[8], actual[12]);
  assert.deepEqual(actual.at(-1).events.map(e => e.transition), ['raised', 'cleared']);
  for (const index of [1, 5, 9, 11]) assert.equal(actual[index].accepted, false);
});

test('GF-TEST-alarm-initial-condition: initial true stays unobserved until a committed scan and authored fault recovery owns condition', async t => {
  const a = compile(source.replace('state hot: Bool = false', 'state hot: Bool = true'));
  const missing = frame(a, 0, 0); missing.inputs.find(input => input.name === a.manifest.sensors[0].okInput).value = false;
  const { actual } = await parity(t, a, descriptor(a), b => [query(b), { frame: missing }, query(b),
    { frame: { ...missing, scanId: 1 } }, query(b)]);
  assert.equal(actual[0].current.alarms[0].state, 'unobserved');
  assert.equal(actual[2].current.alarms[0].state, 'active'); assert.equal(actual[2].events.length, 1);
  assert.equal(actual[4].events.length, 1, 'fault retention follows authored condition; no fabricated clear');
});

function replaceWireText(bytes, before, after) {
  const from = Buffer.from(before), index = Buffer.from(bytes).indexOf(from);
  assert.ok(index >= 2); const encoded = Buffer.from(after), length = Buffer.alloc(2); length.writeUInt16LE(encoded.length);
  return Uint8Array.from(Buffer.concat([Buffer.from(bytes.slice(0, index - 2)), length, encoded, Buffer.from(bytes.slice(index + from.length))]));
}
test('GF-TEST-alarm-activation: Rust rejects module/type/packet tamper before observation and keeps ordinary control executable', async t => {
  const a = compile(), binding = prepareAlarmObservation(a, descriptor(a)).bind(identity);
  const bad = binding.bytes.slice(); bad[bad.length - 1] ^= 1;
  const runtime = await raw(t, a);
  assert.throws(() => runtime.activateAlarms(bad, binding.sha256), /digest mismatch/);
  assert.equal(runtime.scan(frame(a, 0, 40)).trace.stateAfter.hot, true, 'failed observer activation does not block control');
  assert.throws(() => runtime.activateAlarms(binding.bytes, binding.sha256), /fresh run/);
  for (const bytes of [replaceWireText(binding.bytes, 'hot', 'observed'),
    replaceWireText(binding.bytes, a.interactionSchema.module.bytecodeSha256, '0'.repeat(64)),
    replaceWireText(binding.bytes, a.interactionSchema.module.moduleFingerprint, '0'.repeat(16)),
    replaceWireText(binding.bytes, a.manifest.name, 'Different'), Uint8Array.from([...binding.bytes, 0])]) {
    const candidate = { ...binding, bytes, sha256: sha256Hex(bytes) }, other = await raw(t, a);
    assert.throws(() => other.activateAlarms(bytes, candidate.sha256), /state mismatch|identity mismatch|trailing/);
    const result = native(t, a, candidate, []); assert.notEqual(result.status, 0); assert.match(result.stderr, /state mismatch|identity mismatch|trailing/);
    other.activateAlarms(binding.bytes, binding.sha256);
    assert.throws(() => other.activateAlarms(binding.bytes, binding.sha256), /once/);
    assert.equal(other.scan(frame(a, 0, 40)).trace.stateAfter.hot, true);
  }
});

test('GF-TEST-alarm-consumer: bound facade rejects reconnect cursors from other runs and does not expose reset', async t => {
  const a = compile(), d = descriptor(a);
  const runtime = await AlarmObservationRuntime.instantiate(wasm, a, d, identity); t.after(() => runtime.dispose());
  const initial = runtime.query(); assert.deepEqual(runtime.query(initial.cursor), initial);
  runtime.scan(frame(a, 0, 40)); const report = runtime.query();
  assert.deepEqual(runtime.query(report.cursor).events, []);
  assert.throws(() => runtime.query({ ...report.cursor, runId: 'other' }), /cursor identity/);
  assert.throws(() => runtime.query({ ...report.cursor, extra: 1 }), /cursor identity/);
  assert.throws(() => runtime.query({ ...report.cursor, bindingSha256: '0'.repeat(64) }), /cursor identity/);
  assert.equal(runtime.reset, undefined);
  const fresh = await AlarmObservationRuntime.instantiate(wasm, a, d, { runId: 'run.temperature.2', streamId: 'stream.alarms.2' }); t.after(() => fresh.dispose());
  assert.throws(() => fresh.query(report.cursor), /cursor identity/); assert.equal(fresh.query().current.alarms[0].state, 'unobserved');
});

// Exercise every keyword used by these two closed schema documents against real owner records.
function conforms(schema, value) {
  if (schema.oneOf && schema.oneOf.filter(s => conforms(s, value)).length !== 1) return false;
  if (Object.hasOwn(schema, 'const') && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'integer' && !Number.isSafeInteger(value)) return false;
  if (schema.type === 'string' && typeof value !== 'string') return false;
  if (schema.type === 'array' && !Array.isArray(value)) return false;
  if (schema.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) return false;
  if (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) return false;
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
  if (schema.minLength !== undefined && [...value].length < schema.minLength || schema.maxLength !== undefined && [...value].length > schema.maxLength) return false;
  if (schema.type === 'array') {
    if (value.length < schema.minItems || value.length > schema.maxItems || !value.every(v => conforms(schema.items, v))) return false;
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) return false;
  }
  if (schema.type === 'object') {
    if (schema.required.some(key => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false;
    if (!Object.entries(schema.properties).every(([key, shape]) => conforms(shape, value[key]))) return false;
  }
  return true;
}
function schemaIsClosed(schema) {
  const supported = new Set(['$schema', '$id', 'title', 'type', 'additionalProperties', 'required', 'properties', 'const', 'enum', 'oneOf', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'items']);
  for (const key of Object.keys(schema)) assert.ok(supported.has(key), `extend conformance test for schema keyword ${key}`);
  if (schema.type === 'object') { assert.equal(schema.additionalProperties, false); assert.deepEqual(schema.required, Object.keys(schema.properties)); Object.values(schema.properties).forEach(schemaIsClosed); }
  if (schema.items) schemaIsClosed(schema.items); schema.oneOf?.forEach(schemaIsClosed);
}
test('GF-TEST-alarm-schema: published closed schemas conform to source descriptor and every native/WASM lifecycle record', async t => {
  const descriptorSchema = JSON.parse(readFileSync(join(root, 'contracts/alarm-v1/descriptor.schema.json')));
  const reportSchema = JSON.parse(readFileSync(join(root, 'contracts/alarm-v1/report.schema.json')));
  schemaIsClosed(descriptorSchema); schemaIsClosed(reportSchema);
  const a = compile(), d = descriptor(a, 1); assert.ok(conforms(descriptorSchema, d));
  assert.equal(conforms(descriptorSchema, { ...d, extra: 0 }), false);
  const { actual } = await parity(t, a, d, b => [query(b), { frame: frame(a, 0, 40) }, query(b), { frame: frame(a, 1, 20) }, query(b)]);
  for (const row of actual.filter(row => row.format === 'GhostFlow/alarm-report-v1')) {
    assert.ok(conforms(reportSchema, row));
    for (const path of [[], ['context'], ['cursor'], ['current'], ['current', 'alarms', 0], ['coverage'], ...(row.events.length ? [['events', 0]] : [])]) {
      const bad = structuredClone(row); path.reduce((value, key) => value[key], bad).extra = true; assert.equal(conforms(reportSchema, bad), false);
    }
    const bad = structuredClone(row); bad.cursor.sequence = 9007199254740992; assert.equal(conforms(reportSchema, bad), false);
  }
});
