import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { EstimateEvidenceRuntime, encodeEstimateConfig, encodeEstimateEvaluation, ESTIMATE_MAX_PACKET } from '../runtimes/wasm/estimate-evidence.mjs';
const context = { identities: Array.from({ length: 7 }, (_, i) => (i + 1).toString(16).padStart(2, '0').repeat(32)), run: '18446744073709551615', timeEpoch: '2', sourceEpoch: '3' };
const reference = { context, establishedMs: '10', initialSequence: '0', uncertainty: { meaning: 'ab'.repeat(32), bound: null } };
const config = { reference, basis: 'AcknowledgedWrites', capacity: 4 };
const origin = { boot:context.identities[0],program:context.identities[5],binding:context.identities[6],run:context.run,timeEpoch:context.timeEpoch,sourceEpoch:context.sourceEpoch };
const ack = { origin, sequence: '1', identity: '18446744073709551615', atMs: '10', target: 1, result: 'Acknowledged' };
const evaluation = (nowMs, records = [ack], changes = {}) => ({ context, nowMs, sourceFault: null,
  history: { initialSequence: '0', currentSequence: String(records.length), observedFromMs: '10', observedThroughMs: nowMs, complete: true, records }, ...changes });
async function compare(config, attempts) {
  const packets = attempts.map(a => a instanceof Uint8Array ? a : encodeEstimateEvaluation(a));
  const native = spawnSync(fileURLToPath(new URL(`../target/release/examples/estimate_evidence${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url)), [], {
    input: [encodeEstimateConfig(config), ...packets].map(b => Buffer.from(b).toString('hex')).join('\n') + '\n', encoding: 'utf8', timeout: 10000,
  });
  assert.equal(native.status, 0, native.stderr);
  const expected = native.stdout.trim().split('\n').map(JSON.parse);
  const runtime = await EstimateEvidenceRuntime.instantiate(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)), config);
  try {
    assert.deepEqual(runtime.snapshot, expected.shift());
    const actual = packets.map(packet => { try { return { accepted: true, snapshot: runtime.evaluatePacket(packet) }; }
      catch (error) { return { accepted: false, error: error.message, snapshot: runtime.snapshot }; } });
    assert.deepEqual(actual, expected); return actual;
  } finally { runtime.dispose(); }
}
test('estimate basis native/WASM preserve exact u64s, cached ACK identity, coverage and unknown uncertainty', async () => {
  const rows = await compare(config, [evaluation('10'), evaluation('20')]);
  for (const row of rows) { assert.equal(row.snapshot.verdict, 'admitted'); assert.equal(row.snapshot.temporalAdmission, false);
    assert.deepEqual(row.snapshot.reference, reference); assert.deepEqual(row.snapshot.records, [ack]); }
  assert.equal(rows[1].snapshot.coverage.observedThroughMs, '20');
});
test('rewritten cache, malformed packet, wrong basis and overflow reject atomically', async () => {
  const good = evaluation('10'); const bytes = encodeEstimateEvaluation(good);
  const tooMany = Array.from({ length: 5 }, (_, i) => ({ ...ack, sequence: String(i + 1), identity: String(i), atMs: '10' }));
  const rows = await compare(config, [good,
    evaluation('12', [{ ...ack, atMs: '11' }]), bytes.slice(0, -1),
    evaluation('12', [{ ...ack, result: 'Requested' }]), evaluation('12', tooMany), evaluation('13')]);
  for (const row of rows.slice(1, 5)) { assert.equal(row.accepted, false); assert.deepEqual(row.snapshot, rows[0].snapshot); }
  assert.equal(rows[5].snapshot.verdict, 'admitted');
});
test('missing, gapped, stale and context changes invalidate until explicit re-establishment', async () => {
  for (const [attempt, cause, verdict] of [
    [evaluation('11', [], { history: null }), 'MissingHistory', 'unavailable'],
    [evaluation('11', [ack], { history: { ...evaluation('11').history, currentSequence: '2' } }), 'Gap', 'unavailable'],
    [evaluation('11', [ack], { history: { ...evaluation('11').history, observedThroughMs: '10' } }), 'Gap', 'unavailable'],
    [evaluation('11', [ack], { context: { ...context, sourceEpoch: '4' } }), 'ContextChanged', 'unavailable'],
    [evaluation('11', [ack], { sourceFault: 'Stale' }), 'Stale', 'fault'],
    [evaluation('9', [], { history: null }), 'ClockBackward', 'fault'],
  ]) {
    const rows = await compare(config, [evaluation('10'), attempt, evaluation('12')]);
    assert.equal(rows[1].snapshot.cause, cause); assert.equal(rows[1].snapshot.verdict, verdict);
    assert.equal(rows[2].snapshot.cause, cause); assert.equal(rows[2].snapshot.verdict, verdict);
  }
  const missing = await compare({ ...config, reference: null }, [evaluation('10')]);
  assert.equal(missing[0].snapshot.cause, 'MissingReference');
});
test('failed or uncertain newer writes survive and an old ACK cannot conceal them', async () => {
  for (const [result, cause] of [['WriteFailed', 'WriteFailed'], ['Unknown', 'UncertainApplication']]) {
    const records = [ack, { ...ack, sequence: '2', identity: '8', atMs: '11', result }];
    const rows = await compare(config, [evaluation('10'), evaluation('11', records), evaluation('12')]);
    assert.equal(rows[1].snapshot.cause, cause); assert.deepEqual(rows[1].snapshot.records, records);
    assert.equal(rows[2].snapshot.cause, cause); assert.deepEqual(rows[2].snapshot.records, records);
  }
});
test('requested basis and known uncertainty remain declared assumptions, never temporal permission', async () => {
  const declared = { ...config, basis: 'Requested', reference: { ...reference, uncertainty: { meaning: 'ab'.repeat(32), bound: 0.25 } } };
  const rows = await compare(declared, [evaluation('10', [{ ...ack, result: 'Requested' }])]);
  assert.equal(rows[0].snapshot.verdict, 'admitted'); assert.equal(rows[0].snapshot.temporalAdmission, false);
  assert.deepEqual(rows[0].snapshot.reference, declared.reference);
});
test('transport rejects absent declarations, unsupported profiles, guessed or malformed uncertainty', () => {
  for (const bound of [-1, NaN, Infinity, undefined]) assert.throws(() => encodeEstimateConfig({ ...config, reference: { ...reference, uncertainty: { meaning: 'ab'.repeat(32), bound } } }));
  for (const capacity of [0, 65, undefined]) assert.throws(() => encodeEstimateConfig({ ...config, capacity }));
  assert.throws(() => encodeEstimateEvaluation(evaluation(Number.MAX_SAFE_INTEGER + 1)), /exact/);
  assert.throws(() => encodeEstimateEvaluation(evaluation('10', [ack], { context: { ...context, run: '18446744073709551616' } })), /range/);
});
test('reference re-establishment permits old seed only within exact execution origin', async()=>{
  const revisedContext={...context,identities:context.identities.map((d,i)=>i===1 || i===3?'ee'.repeat(32):d)};
  const seed={...ack,atMs:'8'};
  const attempt=evaluation('10',[seed],{context:revisedContext,history:{...evaluation('10',[seed]).history,observedFromMs:'8'}});
  const rows=await compare({...config,reference:{...reference,context:revisedContext}},[attempt]);
  assert.equal(rows[0].snapshot.verdict,'admitted'); assert.deepEqual(rows[0].snapshot.records,[seed]);
  for(const changed of [{...context,run:'4'},{...context,timeEpoch:'4'},{...context,identities:context.identities.map((d,i)=>i===0?'ee'.repeat(32):d)}]) {
    const rows=await compare({...config,reference:{...reference,context:changed}},[evaluation('10',[ack],{context:changed})]);
    assert.equal(rows[0].snapshot.cause,'HistoryContextChanged');assert.deepEqual(rows[0].snapshot.records,[ack]);
  }
  const delayed={...ack,atMs:'11'};
  const delayedRows=await compare(config,[evaluation('12',[delayed],{history:{...evaluation('12',[delayed]).history,observedFromMs:'11'}})]);
  assert.equal(delayedRows[0].snapshot.cause,'Gap');
});
test('new time epoch with reset clock reports context change, original supplied faults survive',async()=>{
  const rows=await compare(config,[evaluation('10'),evaluation('1',[],{context:{...context,timeEpoch:'4'},history:null})]);
  assert.equal(rows[1].snapshot.cause,'ContextChanged');
  for(const sourceFault of ['NotReady','Disconnected','Invalid','SourceChanged','ClockBackward','FutureTimestamp']) {
    const rows=await compare(config,[evaluation('10'),evaluation('1',[],{context:{...context,timeEpoch:'4'},history:null,sourceFault})]);
    assert.equal(rows[1].snapshot.verdict,'fault');assert.equal(rows[1].snapshot.cause,sourceFault);
  }
});
test('full declared capacity64 fits packet and retains every record, capacity+1 never evicts',async()=>{
  const records=Array.from({length:64},(_,i)=>({...ack,sequence:String(i+1),identity:String(i),atMs:String(i+10)}));
  const full=evaluation('73',records);assert.equal(encodeEstimateEvaluation(full).length,ESTIMATE_MAX_PACKET);
  const rows=await compare({...config,capacity:64},[full]);
  assert.equal(rows[0].snapshot.verdict,'admitted');assert.deepEqual(rows[0].snapshot.records,records);
  assert.throws(()=>encodeEstimateEvaluation(evaluation('74',[...records,{...ack,sequence:'65',identity:'65',atMs:'74'}])),/capacity/);
  const overflow=encodeEstimateEvaluation(full);overflow[297]=65;
  const bad=await compare({...config,capacity:64},[full,overflow]);assert.equal(bad[1].accepted,false);
  assert.equal(bad[1].error,'Capacity');assert.deepEqual(bad[1].snapshot,bad[0].snapshot);
});
test('public evidence adapter evaluates through Rust and closes explicitly',async()=>{
  const runtime=await EstimateEvidenceRuntime.instantiate(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm',import.meta.url)),config);
  assert.equal(runtime.evaluate(evaluation('10')).verdict,'admitted');
  assert.throws(()=>runtime.evaluatePacket(new Uint8Array(ESTIMATE_MAX_PACKET+1)),/packet/);
  runtime.dispose();runtime.dispose();
  assert.throws(()=>runtime.evaluate(evaluation('11')),/disposed/);
  assert.throws(()=>runtime.snapshot,/disposed/);
});
