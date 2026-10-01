import assert from 'node:assert/strict';
import test from 'node:test';

// Executable CONTRACT MODEL ONLY. These fictional receipt/boundary objects are
// not production host APIs, approved schemas, command descriptors or VM input
// grammar. This fixture explicitly finalizes failed batches; it never retries
// requests automatically. Continuation after effect failure is opt-in policy.
const context = Object.freeze({ run: 'run.1', source: 'source.rev.1', module: 'module.1', binding: 'binding.1' });
const frozenCopy = value => {
  const copy = structuredClone(value);
  const freeze = item => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
    return item;
  };
  return freeze(copy);
};

function host({ continueAfterEffectFailure = false, capacity = 8 } = {}) {
  let nextReceipt = 0, nextAttempt = 0, nextScan = 0, busy = false, halted = false;
  let pending = [], state = frozenCopy({ count: 0, blocked: false });
  const records = [];
  const record = (kind, data = {}) => records.push(frozenCopy({ kind, ...data }));
  const receive = payload => {
    if (pending.length >= capacity) throw new Error('ingress-capacity-rejected-before-acceptance');
    const receipt = frozenCopy({ context, receiptSequence: nextReceipt, payload });
    nextReceipt++;
    pending.push(receipt); record('received', { receipt });
    return receipt;
  };
  const decide = (evaluate, effect = () => ({ outcome: 'accepted' })) => {
    if (halted) throw new Error('host-policy-halted');
    if (busy) throw new Error('overlapping-evaluation');
    busy = true;
    const batch = frozenCopy({ context, attemptId: nextAttempt++, scanId: nextScan, receipts: pending });
    pending = [];
    record('latched', { batch });
    let candidate;
    try {
      record('evaluating', { attemptId: batch.attemptId });
      candidate = evaluate(state, batch);
      if (!Number.isSafeInteger(candidate.state.count) || typeof candidate.state.blocked !== 'boolean'
          || typeof candidate.safe !== 'boolean') throw new Error('invalid-fixture-candidate');
    } catch (error) {
      record('evaluation-failed', { batch, reason: error.message });
      // Explicit model policy: close with failed disposition, retaining every
      // receipt. This is not successful handling or authorization to replay it.
      record('failed-batch-finalized', { attemptId: batch.attemptId, disposition: 'failed-no-replay' });
      busy = false;
      return { committed: false, batch };
    }
    state = frozenCopy(candidate.state);
    const origin = frozenCopy({ context, attemptId: batch.attemptId, scanId: nextScan++, effectId: `effect.${batch.attemptId}.0` });
    record('committed', { origin, state, safe: candidate.safe });
    record('dispatching', { origin, safe: candidate.safe });
    let result;
    try { result = effect({ origin, state, safe: candidate.safe }); }
    catch (error) { result = { outcome: 'failed', reason: error.message }; }
    let receipt;
    try { receipt = receive({ ...result, kind: 'effect-result', origin }); }
    catch (error) {
      // A full queue cannot erase a result of an already committed effect.
      // Keep separate failure evidence without inventing an accepted receipt.
      record('effect-result-admission-failed', { origin, result, reason: error.message });
      halted = true; record('halted', { origin });
      busy = false;
      return { committed: true, batch, origin };
    }
    record('effect-result-recorded', { receipt });
    if (result.outcome === 'failed' && !continueAfterEffectFailure) {
      halted = true; record('halted', { origin });
    }
    busy = false;
    return { committed: true, batch, origin };
  };
  return { receive, decide, records, get state() { return state; }, get pending() { return frozenCopy(pending); } };
}

// Explicit fictional typed projection: requests increment count; correlated
// failure receipts block the next requested effect. No name-based inference.
function fixtureDecision(previous, batch) {
  const count = previous.count + batch.receipts.filter(r => r.payload.kind === 'fixture-add').length;
  const blocked = previous.blocked || batch.receipts.some(r => r.payload.kind === 'effect-result' && r.payload.outcome === 'failed');
  return { state: { count, blocked }, safe: !blocked };
}

test('GF-TEST-host-order-normal: expected transcript puts committed evidence before effects and result ingress', () => {
  const h = host();
  h.receive({ kind: 'fixture-add', receivedAt: 10 });
  const outcome = h.decide(fixtureDecision, effect => {
    assert.deepEqual(h.state, { count: 1, blocked: false });
    assert.equal(h.records.at(-2).kind, 'committed');
    assert.equal(effect.safe, true);
    assert.deepEqual(effect.origin.context, context);
    assert.ok(Object.isFrozen(effect.origin));
    return { outcome: 'accepted', evidence: 'register-write-only' };
  });
  assert.deepEqual(h.records.map(r => r.kind), ['received', 'latched', 'evaluating', 'committed', 'dispatching', 'received', 'effect-result-recorded']);
  assert.deepEqual(outcome.batch.receipts.map(r => r.receiptSequence), [0]);
  assert.equal(h.pending[0].receiptSequence, 1);
  assert.equal(h.pending[0].payload.origin.scanId, 0);
  assert.equal(h.pending[0].payload.evidence, 'register-write-only');
  assert.equal(Object.hasOwn(h.pending[0].payload, 'confirmed'), false);
});

test('GF-TEST-host-order-ties: receipt sequence preserves ties and late producer timestamps without class priority', () => {
  const h = host();
  const payload = { kind: 'fixture-add', receivedAt: 50, producerAt: 100, detail: { value: 1 } };
  h.receive(payload); payload.detail.value = 99;
  h.receive({ kind: 'fixture-add', receivedAt: 50, producerAt: 1 });
  h.receive({ kind: 'fixture-sample', receivedAt: 50, producerAt: 0 });
  const { batch } = h.decide((previous, batch) => {
    assert.deepEqual(batch.receipts.map(r => r.receiptSequence), [0, 1, 2]);
    assert.deepEqual(batch.receipts.map(r => r.payload.producerAt), [100, 1, 0]);
    assert.equal(batch.receipts[0].payload.detail.value, 1);
    assert.throws(() => batch.receipts.reverse(), TypeError);
    assert.throws(() => { batch.receipts[0].payload.detail.value = 9; }, TypeError);
    return fixtureDecision(previous, batch);
  });
  assert.equal(batch.receipts.length, 3);
  assert.equal(h.state.count, 2);
});

test('GF-TEST-host-order-late: evaluation and dispatch arrivals appear only in the next contiguous batch', () => {
  const h = host(); h.receive({ kind: 'fixture-add' });
  const first = h.decide((previous, batch) => {
    h.receive({ kind: 'fixture-add', producerAt: -10 });
    assert.throws(() => h.decide(fixtureDecision), /overlapping/);
    assert.deepEqual(batch.receipts.map(r => r.receiptSequence), [0]);
    return fixtureDecision(previous, batch);
  }, () => { h.receive({ kind: 'fixture-add' }); return { outcome: 'accepted' }; });
  assert.equal(h.state.count, 1);
  const second = h.decide(fixtureDecision);
  assert.deepEqual(first.batch.receipts.map(r => r.receiptSequence), [0]);
  assert.deepEqual(second.batch.receipts.map(r => r.receiptSequence), [1, 2, 3]);
  assert.equal(h.state.count, 3);
  assert.equal(second.origin.scanId, 1);
});

test('GF-TEST-host-order-evaluation-fault: failed batch retains evidence without commit, effects or silent replay', () => {
  const h = host(); h.receive({ kind: 'fixture-add' });
  const failed = h.decide((_previous, batch) => {
    assert.equal(batch.scanId, 0); h.receive({ kind: 'fixture-add' });
    throw new Error('fixture-evaluation-fault');
  }, () => assert.fail('failed candidate must never dispatch'));
  assert.equal(failed.committed, false);
  assert.deepEqual(h.state, { count: 0, blocked: false });
  assert.deepEqual(h.records.map(r => r.kind), ['received', 'latched', 'evaluating', 'received', 'evaluation-failed', 'failed-batch-finalized']);
  assert.deepEqual(h.records.at(-2).batch.receipts.map(r => r.receiptSequence), [0]);
  assert.equal(h.records.at(-1).disposition, 'failed-no-replay');
  const next = h.decide(fixtureDecision);
  assert.equal(next.batch.scanId, 0);
  assert.equal(next.batch.attemptId, 1);
  assert.deepEqual(next.batch.receipts.map(r => r.receiptSequence), [1]);
  assert.equal(h.state.count, 1);
});

test('GF-TEST-host-order-effect-fault: explicitly permitted continuation uses correlated failure only in the next decision', () => {
  const h = host({ continueAfterEffectFailure: true }); h.receive({ kind: 'fixture-add' });
  const first = h.decide(fixtureDecision, () => { throw new Error('write-failed'); });
  assert.deepEqual(h.state, { count: 1, blocked: false });
  assert.equal(h.records.find(r => r.kind === 'committed').safe, true);
  assert.equal(h.pending[0].payload.outcome, 'failed');
  assert.deepEqual(h.pending[0].payload.origin, first.origin);
  assert.equal(h.pending[0].payload.reason, 'write-failed');
  const second = h.decide(fixtureDecision);
  assert.deepEqual(second.batch.receipts.map(r => r.receiptSequence), [1]);
  assert.deepEqual(h.state, { count: 1, blocked: true });
  assert.equal(h.records.filter(r => r.kind === 'committed')[1].safe, false);
  assert.equal(h.records.filter(r => r.kind === 'committed')[0].safe, true);
});

test('GF-TEST-host-order-halt: effect failure preserves origin and refuses automatic next scan', () => {
  const h = host(); h.receive({ kind: 'fixture-add' });
  const committed = h.decide(fixtureDecision, () => { throw new Error('driver-fault'); });
  assert.equal(committed.committed, true);
  assert.deepEqual(h.state, { count: 1, blocked: false });
  assert.equal(h.records.at(-1).kind, 'halted');
  assert.equal(h.pending[0].payload.origin.scanId, 0);
  assert.throws(() => h.decide(fixtureDecision), /host-policy-halted/);
  assert.equal(h.records.filter(r => r.kind === 'committed').length, 1);
});

test('GF-TEST-host-order-bounds: admission overflow allocates no sequence and drops no accepted receipt', () => {
  const h = host({ capacity: 2 });
  h.receive({ kind: 'fixture-add' }); h.receive({ kind: 'fixture-add' });
  assert.throws(() => h.receive({ kind: 'fixture-add' }), /capacity/);
  assert.deepEqual(h.pending.map(r => r.receiptSequence), [0, 1]);
  h.decide(fixtureDecision);
  assert.equal(h.pending[0].receiptSequence, 2);
  assert.equal(h.state.count, 2);
});

test('GF-TEST-host-order-result-overflow: late arrivals cannot erase a committed effect failure or fabricate receipt identity', () => {
  const h = host({ capacity: 1, continueAfterEffectFailure: true });
  h.receive({ kind: 'fixture-add' });
  const first = h.decide(fixtureDecision, () => {
    h.receive({ kind: 'fixture-add' });
    throw new Error('write-failed-after-queue-filled');
  });
  assert.equal(first.committed, true);
  assert.deepEqual(h.state, { count: 1, blocked: false });
  assert.deepEqual(h.pending.map(r => r.receiptSequence), [1]);
  const failure = h.records.find(r => r.kind === 'effect-result-admission-failed');
  assert.deepEqual(failure.origin, first.origin);
  assert.equal(failure.result.reason, 'write-failed-after-queue-filled');
  assert.equal(Object.hasOwn(failure, 'receiptSequence'), false);
  assert.equal(h.records.at(-1).kind, 'halted');
  assert.throws(() => h.decide(fixtureDecision), /host-policy-halted/);
});
