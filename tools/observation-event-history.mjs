import {canonicalJson} from './canonical-json.mjs';
import {prepareCompletedScanSnapshot} from './interaction-runtime-snapshot.mjs';

const clone = value => structuredClone(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.isWellFormed()
  && value.trim().length > 0 && new TextEncoder().encode(value).length <= 128
  && !/[\u0000-\u001f\u007f]/u.test(value) && !value.startsWith('__gf_');
const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
const fail = message => {throw new Error(`observation event history: ${message}`);};
function shape(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || fields.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !fields.includes(key))) fail('unknown or missing fields');
}
function owned(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) owned(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Source-bound reference observation journal, separate from snapshot v0 and
 * from the execution environment's final event serialization/transport. The
 * trusted producer supplies explicit events and already-completed Rust traces;
 * this adapter does not evaluate expressions or infer events from snapshots.
 */
export function prepareObservationEventHistory({compilation, schema, runId, capacity = 256, maxEventsPerScan = 256}) {
  if (!integer(capacity) || capacity < 1 || capacity > 4096
    || !integer(maxEventsPerScan) || maxEventsPerScan < 1 || maxEventsPerScan > 4096) fail('invalid capacity');
  const producer = prepareCompletedScanSnapshot({compilation, schema, runId});
  const identity = owned(clone(producer.expected));
  let sequence = 0, records = [], snapshot = null;

  function cursorAfter(afterSequence) {
    return {identity: clone(identity), afterSequence};
  }
  function read({cursor = null} = {}) {
    let afterSequence = 0;
    if (cursor !== null) {
      shape(cursor, ['identity', 'afterSequence']);
      if (!equal(cursor.identity, identity)) fail('cursor execution identity mismatch');
      afterSequence = cursor.afterSequence;
      if (!integer(afterSequence) || afterSequence > sequence) fail('cursor sequence out of range');
    }
    const events = records.filter(record => record.sequence > afterSequence);
    const firstSequence = records[0]?.sequence ?? null;
    const gaps = firstSequence !== null && afterSequence + 1 < firstSequence
      ? [{from: afterSequence + 1, to: firstSequence - 1, reason: 'retention'}] : [];
    return owned(clone({identity, events, gaps, snapshot,
      retained: {firstSequence, lastSequence: records.at(-1)?.sequence ?? null},
      nextCursor: cursorAfter(sequence)}));
  }

  function publish({completion, trace, settingsState, events}) {
    // Stage the complete batch before changing sequence, retention or snapshot.
    // Failed validation permits a valid retry at the same completed scan.
    if (!Array.isArray(events) || events.length > maxEventsPerScan) fail('invalid event batch');
    canonicalJson(events, {rejectSparseArrays: true, rejectUnsafeIntegers: true});
    const explicit = clone(events).map(event => {
      shape(event, ['kind', 'payload']);
      if (!text(event.kind)) fail('invalid public event kind');
      const encoded = canonicalJson(event.payload, {rejectSparseArrays: true, rejectUnsafeIntegers: true});
      if (new TextEncoder().encode(encoded).length > 16384) fail('event payload capacity');
      return clone(event);
    });
    const completed = clone(producer.emit({completion, trace, settingsState}));
    if (snapshot !== null && (completed.completion.scanId <= snapshot.completion.scanId
      || completed.completion.logicalTimeMs < snapshot.completion.logicalTimeMs)) fail('duplicate or out-of-order completed scan');
    if (!integer(sequence + explicit.length)) fail('event sequence capacity');
    const appended = explicit.map((event, index) => ({identity: clone(identity), sequence: sequence + index + 1,
      completion: clone(completed.completion), ...event}));
    const nextRecords = [...records, ...appended].slice(-capacity);
    sequence += explicit.length;
    records = nextRecords;
    snapshot = completed;
    return owned(clone({published: appended, snapshot, nextCursor: cursorAfter(sequence)}));
  }

  return Object.freeze({identity, publish, read});
}
