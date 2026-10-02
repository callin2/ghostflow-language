import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJson } from '../tools/canonical-json.mjs';

// CONTRACT MODEL ONLY. Explicit fixture evidence arrives after authored domain
// arbitration. This is no host workflow, approved schema or production API.
const base = { run: 'run.1', source: 'source.1', module: 'module.1', binding: 'binding.1' };
const clone = value => structuredClone(value);
const canonical = value => canonicalJson(value, { rejectSparseArrays: true, rejectUnsafeIntegers: true });
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const terminal = new Set(['rejected', 'completed', 'cancelled', 'failed']);
const req = (id = 'p', kind = 'Process', payload = { duration: 10 }, context = base) => ({ id, kind, payload, context: clone(context) });
const failed = { code: 'domain.failed', message: 'Fixture failure.' };

function model({ capacity = 4, cancellationCapacity = 2 } = {}) {
  let context = clone(base), entries = new Map(), cancels = new Map();
  let nextSequence = 0;
  const events = [], facts = [], history = [], runs = new Set([context.run]);
  const checkContext = value => { if (canonical(value) !== canonical(context)) throw new Error('stale-context'); };
  const emit = (entry, state, evidence, reason) => {
    if (nextSequence >= 128) throw new Error('record-capacity');
    events.push(clone({ sequence: nextSequence++, identity: entry.request, digest: entry.digest,
      state, evidence, ...(reason ? { reason } : {}) }));
  };
  const receive = value => {
    const request = clone(value), hash = digest(request), old = entries.get(request.id);
    if (old) {
      if (old.digest !== hash) throw new Error('conflicting-admission');
      return clone(old);
    }
    checkContext(request.context);
    if (!['Command', 'Process', 'Message'].includes(request.kind)) throw new Error('kind-has-no-request-lifecycle');
    if (entries.size >= capacity || nextSequence + 4 > 128) throw new Error('admission-capacity');
    const entry = { request, digest: hash, state: 'received', cancellationPending: false };
    emit(entry, 'received', 'host.receipt'); entries.set(request.id, entry); return clone(entry);
  };
  const transition = (id, next, evidence, reason, suppliedContext = context) => {
    checkContext(suppliedContext); const entry = entries.get(id);
    if (!entry) throw new Error('unknown-request');
    const wanted = { started: 'domain.started', completed: entry.request.kind === 'Message' ? 'transport.delivered' : 'domain.completed',
      cancelled: 'domain.cancelled', failed: 'domain.failed', rejected: 'domain.rejected' }[next];
    if (!wanted || wanted !== evidence) throw new Error('undeclared-evidence');
    if (['rejected', 'failed'].includes(next) && !reason) throw new Error('reason-required');
    if (['started', 'completed'].includes(next) && reason) throw new Error('reason-forbidden');
    if (reason && (!['domain.failed', 'cancel.before-start', 'policy.denied'].includes(reason.code)
      || typeof reason.message !== 'string' || !reason.message)) throw new Error('invalid-reason');
    if (terminal.has(entry.state)) return 'terminal-unchanged';
    if (!(entry.state === 'received' ? ['rejected', 'started'] : ['completed', 'cancelled', 'failed']).includes(next)) throw new Error('invalid-transition');
    emit(entry, next, evidence, reason); entry.state = next; return clone(entry);
  };
  const cancel = (id, target, suppliedContext = context) => {
    checkContext(suppliedContext); const request = { id, target, context: clone(suppliedContext) }, hash = digest(request);
    if (cancels.has(id)) {
      if (cancels.get(id) !== hash) throw new Error('conflicting-cancel');
      return 'duplicate';
    }
    const entry = entries.get(target);
    if (!entry || terminal.has(entry.state)) throw new Error('inactive-target');
    if (cancels.size >= cancellationCapacity) throw new Error('cancel-capacity');
    cancels.set(id, hash); entry.cancellationPending = true;
    facts.push(clone({ kind: 'internal-cancel-request', request })); return clone(entry);
  };
  const restart = run => {
    if (runs.has(run)) throw new Error('run-reuse');
    history.push(clone([...entries.values()]));
    for (const entry of entries.values()) if (!terminal.has(entry.state)) facts.push(clone({ kind: 'incomplete-history', request: entry.request }));
    context = { ...context, run }; runs.add(run); entries = new Map(); cancels = new Map(); nextSequence = 0;
  };
  return { receive, transition, cancel, restart, events, facts, history,
    get: id => clone(entries.get(id)), get context() { return clone(context); } };
}

test('GF-TEST-effect-kinds: continued intent and read-only rendering do not implicitly start requests or prove delivery', () => {
  const desired = [0, 1].map(scan => ({ kind: 'DesiredState', context: base, scan, target: true }));
  const m = model();
  for (const kind of ['DesiredState', 'Render']) assert.throws(() => m.receive(req(kind, kind)), /no-request-lifecycle/);
  for (const kind of ['Command', 'Process', 'Message']) m.receive(req(kind, kind));
  assert.deepEqual(m.events.map(e => e.state), ['received', 'received', 'received']);
  m.transition('Message', 'started', 'domain.started');
  assert.throws(() => m.transition('Message', 'completed', 'transport.accepted'), /evidence/);
  assert.throws(() => m.transition('Command', 'started', 'driver.accepted'), /evidence/);
  const before = clone(m.events), render = { projection: clone(desired[1]), status: 'rendered' };
  render.projection.target = false;
  assert.deepEqual(desired.map(d => d.target), [true, true]); assert.deepEqual(m.events, before);
  m.transition('Message', 'completed', 'transport.delivered'); assert.equal(m.get('Message').state, 'completed');
});

test('GF-TEST-effect-dedup: exact retry/current status never starts twice and conflicts preserve original identity', () => {
  const m = model(), request = req(); m.receive(request); request.payload.duration = 99;
  m.transition('p', 'started', 'domain.started'); assert.equal(m.receive(req()).state, 'started');
  assert.equal(m.receive({ context: { binding: base.binding, module: base.module, source: base.source, run: base.run },
    payload: { duration: 10 }, kind: 'Process', id: 'p' }).state, 'started');
  assert.throws(() => m.receive(req('malformed', 'Process', { duration: Infinity })), /non-finite/);
  const original = m.get('p'); assert.equal(original.request.payload.duration, 10);
  for (const conflict of [req('p', 'Process', { duration: 11 }), req('p', 'Command'), req('p', 'Process', { duration: 10 }, { ...base, binding: 'binding.2' })]) {
    assert.throws(() => m.receive(conflict), /conflicting/); assert.deepEqual(m.get('p'), original);
  }
  m.transition('p', 'completed', 'domain.completed'); m.receive(req());
  assert.deepEqual(m.events.map(e => e.state), ['received', 'started', 'completed']);
});

test('GF-TEST-effect-cancel: prestart and pending poststart cancellation require domain evidence, never physical OFF', () => {
  const m = model(); m.receive(req('before')); m.cancel('c.before', 'before');
  assert.equal(m.get('before').state, 'received');
  assert.throws(() => m.transition('before', 'cancelled', 'domain.cancelled'), /transition/);
  m.transition('before', 'rejected', 'domain.rejected', { code: 'cancel.before-start', message: 'Fixture honored cancel.' });
  m.receive(req('after')); m.transition('after', 'started', 'domain.started'); m.cancel('c.after', 'after');
  assert.equal(m.cancel('c.after', 'after'), 'duplicate');
  assert.throws(() => m.cancel('c.after', 'before'), /conflicting/);
  assert.equal(m.get('after').state, 'started'); assert.equal(m.get('after').cancellationPending, true);
  assert.deepEqual(m.events.filter(e => e.identity.id === 'after').map(e => e.state), ['received', 'started']);
  m.transition('after', 'cancelled', 'domain.cancelled');
  assert.deepEqual(m.events.filter(e => e.identity.id === 'after').map(e => e.state), ['received', 'started', 'cancelled']);
  assert.ok(m.events.every(e => !Object.hasOwn(e, 'physicalOff')));
});

test('GF-TEST-effect-races: fixture-serialized valid terminal evidence has one immutable winner', () => {
  // This orders qualified domain records, NOT competing guards in one snapshot.
  for (const order of [['completed', 'cancelled'], ['cancelled', 'completed'], ['failed', 'completed']]) {
    const m = model(); m.receive(req()); m.transition('p', 'started', 'domain.started'); m.cancel('c', 'p');
    for (const next of order) m.transition('p', next, `domain.${next}`, next === 'failed' ? failed : undefined);
    assert.equal(m.get('p').state, order[0]);
    assert.deepEqual(m.events.map(e => e.state), ['received', 'started', order[0]]);
    assert.deepEqual(m.events.map(e => e.sequence), [0, 1, 2]);
  }
});

test('GF-TEST-effect-failure: valid start and declared reasons are required, completion forbids reasons', () => {
  const m = model(); m.receive(req());
  assert.throws(() => m.transition('p', 'failed', 'domain.failed', failed), /transition/);
  assert.throws(() => m.transition('p', 'rejected', 'domain.rejected'), /required/);
  assert.throws(() => m.transition('p', 'started', 'domain.started', failed), /forbidden/);
  m.transition('p', 'started', 'domain.started');
  for (const reason of [{ code: 'invented', message: 'error' }, { code: 'domain.failed', message: '' },
    { code: 'domain.failed', message: 1 }]) assert.throws(() => m.transition('p', 'failed', 'domain.failed', reason), /reason/);
  assert.throws(() => m.transition('p', 'completed', 'domain.completed', failed), /forbidden/);
  m.transition('p', 'failed', 'domain.failed', failed);
  assert.deepEqual(m.events.map(e => e.state), ['received', 'started', 'failed']);
  assert.equal(Object.hasOwn(m.events[2], 'logicalRollback'), false);
});

test('GF-TEST-effect-restart: preserve terminal/incomplete history, require explicit new identity and reject old feedback', () => {
  const m = model(); m.receive(req('done')); m.transition('done', 'started', 'domain.started'); m.transition('done', 'completed', 'domain.completed');
  m.receive(req('interrupted')); m.transition('interrupted', 'started', 'domain.started');
  const before = clone(m.events); m.restart('run.2');
  assert.deepEqual(m.events, before); assert.deepEqual(m.history[0].map(e => e.state), ['completed', 'started']);
  assert.equal(m.facts.at(-1).kind, 'incomplete-history'); assert.equal(m.get('interrupted'), undefined);
  assert.throws(() => m.receive(req('interrupted')), /stale/);
  m.receive(req('follow-up', 'Process', { duration: 10 }, m.context));
  assert.throws(() => m.transition('follow-up', 'started', 'domain.started', undefined, base), /stale/);
  m.transition('follow-up', 'started', 'domain.started'); assert.equal(m.get('follow-up').request.context.run, 'run.2');
  assert.deepEqual(m.events.filter(e => e.identity.context.run === 'run.2').map(e => e.sequence), [0, 1]);
  assert.throws(() => m.restart('run.1'), /reuse/);
});

test('GF-TEST-effect-bounds: admission and cancellation reject exhaustion without terminal dedup eviction', () => {
  const m = model({ capacity: 1 }); m.receive(req()); m.transition('p', 'started', 'domain.started'); m.transition('p', 'completed', 'domain.completed');
  assert.throws(() => m.receive(req('second')), /capacity/); assert.equal(m.receive(req()).state, 'completed');
  assert.deepEqual(m.events.map(e => e.state), ['received', 'started', 'completed']);
  const c = model({ cancellationCapacity: 1 }); c.receive(req()); c.transition('p', 'started', 'domain.started'); c.cancel('c1', 'p');
  assert.throws(() => c.cancel('c2', 'p'), /capacity/); assert.equal(c.get('p').state, 'started');
});
