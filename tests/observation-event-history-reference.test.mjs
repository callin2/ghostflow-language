import { softwareQualityRails } from './helpers/software-quality-observations.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compileSource} from '../tools/compile-source.mjs';
import {FramedGhostFlowRuntime} from '../runtimes/wasm/framed-runtime.mjs';
import {prepareObservationEventHistory} from '../tools/observation-event-history.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, 'target/release/examples/scan_tape' + (process.platform === 'win32' ? '.exe' : ''));
const source = '# Explicit observation history\n\n<!-- ghostflow:anchor id=GF-EVENT-HISTORY kind=intent status=confirmed origin=user -->\n'
  + 'Observe completed decisions; retain explicit events separately from current values.\n\n```ghost\ncontrol EventProbe {\n'
  + 'input enabled: Bool;\n// ghostflow:link id=GF-EVENT-HISTORY relation=implements\nstate seen: Bool = false;\n'
  + '// ghostflow:link id=GF-EVENT-HISTORY relation=implements\nstate tally: Int = 0;\n'
  + "seen' = enabled |> recover(false); tally' = tally + 1; output result: Bool; result <- seen';\n}\n```\n";
const compilation = await compileSource(source, {filename: 'event-history.ghost.md',
  interactionSourceIdentity: {documentId: 'document.event-history', revisionId: 'revision.event-history.1'}});
const scans = Array.from({length: 14}, (_, scanId) => ({scanId, logicalTimeMs: scanId * 100,
  inputs: Object.entries(softwareQualityRails(compilation, { enabled: scanId % 2 === 0 })).map(([name, value]) => ({ name, type: typeof value === 'boolean' ? 'Bool' : 'Number', value }))}));
async function wasmRun() {
  const runtime = await FramedGhostFlowRuntime.instantiate(wasm);
  try {
    runtime.load(compilation.bytes);runtime.addCapability('actuator', 'result', 'bool');runtime.activate();
    return scans.map(scan => runtime.scan(scan));
  } finally {runtime.dispose();}
}
function nativeRun() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-event-history-'));
  try {
    fs.writeFileSync(path.join(directory, 'module.gfb'), compilation.bytes);
    fs.writeFileSync(path.join(directory, 'tape.tsv'), scans.map(s => [s.scanId, s.logicalTimeMs,
      ...s.inputs.flatMap(i => [i.name, i.type === 'Bool' ? 'b' : 'n', i.value])].join('\t')).join('\n') + '\n');
    const run = spawnSync(nativePath, [path.join(directory, 'module.gfb'), path.join(directory, 'tape.tsv')],
      {encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024});
    assert.equal(run.status, 0, run.error?.message ?? run.stderr);
    const rows = run.stdout.trim().split('\n').map(JSON.parse);
    assert.ok(rows.every(row => row.accepted));return rows.map(row => row.outcome);
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
}
const outcomes = await wasmRun();
const completion = i => ({kind: 'completed-scan', scanId: scans[i].scanId, logicalTimeMs: scans[i].logicalTimeMs});
const make = options => prepareObservationEventHistory({compilation, runId: 'run.event-history', ...options});
const publish = (host, i, events = [{kind: 'decision-observed', payload: {requested: outcomes[i].trace.requested.result,
  safe: outcomes[i].trace.safe.result}}]) => host.publish({completion: completion(i), trace: outcomes[i].trace, events});
function unchanged(host, attempt, pattern) {const before = host.read();assert.throws(attempt, pattern);assert.deepEqual(host.read(), before);}

test('REF-05-022 production native and WASM events report exactly missing sequence 11 to 13 after cursor 10 without snapshot reconstruction', async () => {
  assert.deepEqual(nativeRun(), outcomes, 'complete production framed outcomes');
  assert.deepEqual(await wasmRun(), outcomes, 'fresh complete WASM replay');
  assert.deepEqual(nativeRun(), outcomes, 'fresh complete native replay');
  function execute(rows) {
    const host = make({capacity: 1});let cursor;
    for (let i = 0; i < rows.length; i++) {
      host.publish({completion: completion(i), trace: rows[i].trace,
        events: [{kind: 'decision-observed', payload: {requested: rows[i].trace.requested.result, safe: rows[i].trace.safe.result}}]});
      if (i === 9) cursor = host.read().nextCursor;
    }
    const batch = host.read({cursor});
    assert.equal(cursor.afterSequence, 10);assert.deepEqual(batch.gaps, [{from: 11, to: 13, reason: 'retention'}]);
    assert.deepEqual(batch.events.map(e => e.sequence), [14]);assert.deepEqual(batch.events[0].payload, {requested: false, safe: false});
    assert.deepEqual(batch.snapshot.observations.map(o => [o.descriptorId, o.value]), [['state.seen', false], ['state.tally', 14]]);
    assert.equal(batch.snapshot.completion.scanId, 13);assert.equal(batch.nextCursor.afterSequence, 14);
    assert.deepEqual(host.read({cursor: batch.nextCursor}).events, []);assert.deepEqual(host.read({cursor: batch.nextCursor}).gaps, []);
    return batch;
  }
  assert.deepEqual(execute(nativeRun()), execute(outcomes), 'complete source-bound host batches agree across target traces');
  assert.deepEqual(execute(outcomes), execute(outcomes), 'fresh journal replay includes exact gaps, IDs, snapshots and cursor');
});

test('REF-05-022 exact retention boundary and resumed delivery preserve every retained event in sequence', () => {
  const host = make({capacity: 4});let cursor;
  for (let i = 0; i < 14; i++) {publish(host, i);if (i === 9) cursor = host.read().nextCursor;}
  const complete = host.read({cursor});assert.deepEqual(complete.gaps, []);assert.deepEqual(complete.events.map(e => e.sequence), [11, 12, 13, 14]);
  const late = host.read({cursor: {...cursor, afterSequence: 9}});assert.deepEqual(late.gaps, [{from: 10, to: 10, reason: 'retention'}]);
  assert.deepEqual(late.events, complete.events);assert.deepEqual(host.read({cursor}), complete, 'unacknowledged replay identifies duplicates with unchanged run/sequence');
  assert.equal(new Set(complete.events.map(e => `${e.identity.runId}:${e.sequence}`)).size, 4);
});

test('REF-05-022 scans with no explicit events update snapshots without inventing intermediate events or gaps', () => {
  const host = make({capacity: 1});publish(host, 0);const cursor = host.read().nextCursor;
  publish(host, 1, []);publish(host, 2, []);
  const batch = host.read({cursor});assert.deepEqual(batch.events, []);assert.deepEqual(batch.gaps, []);
  assert.equal(batch.nextCursor.afterSequence, 1);assert.equal(batch.snapshot.completion.scanId, 2);
  assert.equal(batch.snapshot.observations.find(o => o.descriptorId === 'state.tally').value, 3);
  const empty = make().read();assert.equal(empty.snapshot, null);assert.deepEqual(empty.events, []);assert.deepEqual(empty.gaps, []);
});

test('REF-05-022 malformed batch duplicate scan and clock regression reject atomically and same-scan valid retry preserves history', () => {
  const host = make({capacity: 2, maxEventsPerScan: 2});publish(host, 0);
  unchanged(host, () => publish(host, 1, [{kind: 'valid', payload: true}, {kind: '__gf_private', payload: false}]), /event kind/);
  unchanged(host, () => publish(host, 1, [{kind: 'oversized', payload: 'x'.repeat(16385)}]), /capacity/);
  unchanged(host, () => publish(host, 1, [{kind: 'bad', payload: {value: NaN}}]), /finite/);
  unchanged(host, () => publish(host, 1, [{kind: 'bad', payload: {value: Number.MAX_SAFE_INTEGER + 1}}]), /safe range/);
  unchanged(host, () => publish(host, 1, [{kind: 'bad', payload: true, injected: true}]), /fields/);
  unchanged(host, () => publish(host, 1, new Array(1)), /sparse/);
  unchanged(host, () => publish(host, 1, [{kind: ' ', payload: true}]), /event kind/);
  unchanged(host, () => publish(host, 1, [{kind: 'broken\nkind', payload: true}]), /event kind/);
  unchanged(host, () => host.publish({completion: completion(1), trace: {...outcomes[1].trace, module: '0000000000000000'}, events: []}), /observation/);
  const retried = publish(host, 1);assert.equal(retried.published[0].sequence, 2);
  unchanged(host, () => publish(host, 1), /duplicate/);
  unchanged(host, () => host.publish({completion: {...completion(2), logicalTimeMs: 0}, trace: outcomes[2].trace, events: []}), /out-of-order/);
  assert.equal(publish(host, 2).published[0].sequence, 3);
});

test('REF-05-022 cursors bind exact source Program schema and run identity and never convert cross-run loss into an ordinary sequence gap', () => {
  const host = make();publish(host, 0);const cursor = host.read().nextCursor;
  for (const key of ['runId', 'moduleFingerprint', 'moduleBytecodeSha256', 'sourceRevisionId', 'sourceSha256', 'schemaSha256']) {
    const foreign = structuredClone(cursor);foreign.identity[key] += '-foreign';
    unchanged(host, () => host.read({cursor: foreign}), /identity mismatch/);
  }
  for (const afterSequence of [-1, 1.5, 2, Number.MAX_SAFE_INTEGER + 1]) unchanged(host, () => host.read({cursor: {...cursor, afterSequence}}), /sequence/);
  const newRun = make({runId: 'run.event-history.restarted'});publish(newRun, 0);
  assert.throws(() => newRun.read({cursor}), /identity mismatch/);assert.equal(newRun.read().events[0].sequence, 1);
  assert.notDeepEqual(newRun.read().events[0].identity, host.read().events[0].identity);
});

test('REF-05-022 owned event payloads snapshots and activation metadata resist caller mutation without changing current or replayed receipts', () => {
  const artifact = structuredClone(compilation);const host = prepareObservationEventHistory({compilation: artifact, runId: 'run.owned', capacity: 2});
  artifact.sourceDocument.text += 'tampered';artifact.interactionSchema.descriptors[0].name = 'tampered';
  const events = [{kind: 'explicit', payload: {value: false, nested: [0]}}];
  const published = host.publish({completion: completion(0), trace: outcomes[0].trace, events});const before = host.read();
  events[0].payload.value = true;events[0].payload.nested.push(2);
  assert.throws(() => {published.published[0].payload.value = true;}, TypeError);
  assert.throws(() => {before.snapshot.observations[0].value = true;}, TypeError);
  assert.deepEqual(host.read(), before);assert.equal(before.events[0].payload.value, false);
  const corrupt = structuredClone(compilation);corrupt.sourceDocument.text += 'tampered';
  assert.throws(() => prepareObservationEventHistory({compilation: corrupt, runId: 'run.bad'}), /interaction schema/);
});

test('REF-05-022 multi-event scan retention reports loss by event sequence while preserving the completed scan and bounded capacity', () => {
  for (const capacity of [0, -1, 1.5, 4097]) assert.throws(() => make({capacity}), /capacity/);
  const host = make({capacity: 1, maxEventsPerScan: 2});
  const original = host.read().nextCursor;
  unchanged(host, () => publish(host, 0, Array.from({length: 3}, () => ({kind: 'event', payload: null}))), /batch/);
  const accepted = publish(host, 0, [{kind: 'first', payload: false}, {kind: 'second', payload: 0}]);
  assert.deepEqual(accepted.published.map(e => e.sequence), [1, 2]);assert.equal(accepted.published[0].completion.scanId, accepted.published[1].completion.scanId);
  const delivery = host.read({cursor: original});assert.deepEqual(delivery.gaps, [{from: 1, to: 1, reason: 'retention'}]);
  assert.deepEqual(delivery.events.map(e => [e.sequence, e.kind, e.payload]), [[2, 'second', 0]]);
});
