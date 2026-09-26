import assert from 'node:assert/strict';
import test from 'node:test';
import { compile, CompileError, parse, tokenize } from '../tools/gfb1.mjs';

const encode = source => compile(parse(tokenize(source)));

const inputs = `
  (input __gf_now_ms number)
  (input __gf_time_epoch number)
  (input root_a_present bool)
  (input root_a_epoch number)
  (input root_a_id number)
  (input root_a_timestamp number)
  (input root_b_present bool)
  (input root_b_epoch number)
  (input root_b_id number)
  (input root_b_timestamp number)
  (input selected_ok bool)
  (input selected_number number)
  (input selected_int int)
  (input selected_fault number)
  (input selected_origin number)
  (input selected_quality number)
  (input selected_tag number)`;

const temporalHeader = `
  (temporal-context __gf_now_ms __gf_time_epoch)
  (temporal-root 11 root_a root_a_present root_a_epoch root_a_id root_a_timestamp)
  (temporal-root 22 root_b root_b_present root_b_epoch root_b_id root_b_timestamp)`;

const averageWindow = `(window 101 mean average number 1000 500
      (roots 11 22)
      (source input.selected_ok input.selected_number input.selected_fault input.selected_origin input.selected_quality input.selected_tag))`;
const minimumIntWindow = `(window 102 lowest min int 1000 500
      (roots 11)
      (source input.selected_ok input.selected_int input.selected_fault input.selected_origin input.selected_quality input.selected_tag))`;
const rateWindow = `(window 103 slope rate number 1000 500
      (roots 11 22)
      (source (window-read 0 ok) (window-read 0 value) (window-read 0 fault)
        (window-read 0 origin) (window-read 0 quality) input.selected_tag))`;

function canonicalModule({ windows = [averageWindow, minimumIntWindow, rateWindow], beforeWindows = '', afterWindows = '', states = '(state count int 0)' } = {}) {
  return `(module WindowModule
  (version 7)${inputs}
  ${states}${temporalHeader}
  (strategy main 0
    (device true)
    ${beforeWindows}
    ${windows.join('\n    ')}
    ${afterWindows}
    (next count (window-read 1 value))
    (intent average_ok (window-read 0 ok))
    (intent average_value (window-read 0 value))
    (intent average_fault (window-read 0 fault))
    (intent average_origin (window-read 0 origin))
    (intent average_revision (window-read 0 revision))
    (intent average_timestamp (window-read 0 timestamp))
    (intent average_count (window-read 0 count))
    (intent average_quality (window-read 0 quality))
    (intent minimum_value (window-read 1 value))
    (intent rate_value (window-read 2 value))))`;
}

class Reader {
  constructor(bytes) { this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.at = 0; }
  raw(size) { const out = this.bytes.slice(this.at, this.at + size); this.at += size; return out; }
  u8() { const value = this.view.getUint8(this.at); this.at += 1; return value; }
  u16() { const value = this.view.getUint16(this.at, true); this.at += 2; return value; }
  u32() { const value = this.view.getUint32(this.at, true); this.at += 4; return value; }
  i32() { const value = this.view.getInt32(this.at, true); this.at += 4; return value; }
  u64() { const value = this.view.getBigUint64(this.at, true); this.at += 8; return value; }
  string() { return new TextDecoder().decode(this.raw(this.u16())); }
  blob() { return this.raw(this.u32()); }
}

function decodeCanonical(bytes) {
  const r = new Reader(bytes);
  assert.equal(new TextDecoder().decode(r.raw(4)), 'GFB1');
  const format = r.u16(), moduleName = r.string(), moduleVersion = r.u32();
  const inputCount = r.u16(), decodedInputs = [];
  for (let index = 0; index < inputCount; index++) decodedInputs.push({ name: r.string(), type: r.u8() });
  const stateCount = r.u16(), states = [];
  for (let index = 0; index < stateCount; index++) {
    const name = r.string(), type = r.u8();
    states.push({ name, type, value: type === 1 ? r.u8() : type === 3 ? r.i32() : r.raw(8) });
  }
  const nowInput = r.u16(), timeEpochInput = r.u16(), rootCount = r.u16(), roots = [];
  for (let index = 0; index < rootCount; index++) roots.push({
    tag: r.u32(), name: r.string(), present: r.u16(), epoch: r.u16(), id: r.u16(), timestamp: r.u16(),
  });
  const strategyCount = r.u16(), strategies = [];
  for (let strategyIndex = 0; strategyIndex < strategyCount; strategyIndex++) {
    const name = r.string(), priority = r.i32(), query = r.blob(), windowCount = r.u16(), windows = [];
    for (let index = 0; index < windowCount; index++) {
      const site = r.u32(), windowName = r.string(), operation = r.u8(), payloadType = r.u8();
      const overMs = r.u64(), maxAgeMs = r.u64(), rootRefCount = r.u16(), rootRefs = [];
      for (let root = 0; root < rootRefCount; root++) rootRefs.push(r.u16());
      windows.push({ site, name: windowName, operation, payloadType, overMs, maxAgeMs, rootRefs,
        source: Array.from({ length: 6 }, () => r.blob()) });
    }
    const transitionCount = r.u16(), transitions = [];
    for (let index = 0; index < transitionCount; index++) transitions.push({ state: r.u16(), expression: r.blob() });
    const intentCount = r.u16(), intents = [];
    for (let index = 0; index < intentCount; index++) intents.push({ name: r.string(), type: r.u8(), expression: r.blob() });
    strategies.push({ name, priority, query, windows, transitions, intents });
  }
  const constraintCount = r.u16();
  assert.equal(r.at, bytes.length);
  return { format, moduleName, moduleVersion, decodedInputs, states, nowInput, timeEpochInput, roots, strategies, constraintCount };
}

test('non-window modules retain their exact GFB1 to GFB3 bytes', () => {
  const fixtures = [
    ['(module Legacy (version 1) (input enabled bool) (strategy main 0 (device true) (intent ready input.enabled)))',
      '47464231010006004c65676163790100000001000700656e61626c6564010000010004006d61696e00000000020000000501000001000500726561647901030000000300000000'],
    ['(module LegacyInt (version 1) (input count int) (strategy main 0 (device true) (intent value input.count)))',
      '47464231020009004c6567616379496e740100000001000500636f756e74030000010004006d61696e0000000002000000050100000100050076616c756503030000000300000000'],
    ['(module LegacyV3 (version 1) (input value number) (strategy main 0 (device true) (intent out (check-duration input.value))))',
      '47464231030008004c65676163795633010000000100050076616c7565020000010004006d61696e000000000200000005010000010003006f75740204000000030000360000'],
  ];
  for (const [source, hex] of fixtures) assert.equal(Buffer.from(encode(source)).toString('hex'), hex);
});

test('GFB4 encodes temporal context, canonical roots, descriptors, and all projection types', () => {
  const decoded = decodeCanonical(encode(canonicalModule()));
  assert.deepEqual({ format: decoded.format, name: decoded.moduleName, version: decoded.moduleVersion }, { format: 4, name: 'WindowModule', version: 7 });
  assert.equal(decoded.nowInput, 0); assert.equal(decoded.timeEpochInput, 1);
  assert.deepEqual(decoded.roots, [
    { tag: 11, name: 'root_a', present: 2, epoch: 3, id: 4, timestamp: 5 },
    { tag: 22, name: 'root_b', present: 6, epoch: 7, id: 8, timestamp: 9 },
  ]);
  const strategy = decoded.strategies[0];
  assert.deepEqual(strategy.windows.map(window => ({
    site: window.site, name: window.name, operation: window.operation, payloadType: window.payloadType,
    overMs: window.overMs, maxAgeMs: window.maxAgeMs, rootRefs: window.rootRefs,
  })), [
    { site: 101, name: 'mean', operation: 0, payloadType: 2, overMs: 1000n, maxAgeMs: 500n, rootRefs: [0, 1] },
    { site: 102, name: 'lowest', operation: 1, payloadType: 3, overMs: 1000n, maxAgeMs: 500n, rootRefs: [0] },
    { site: 103, name: 'slope', operation: 3, payloadType: 2, overMs: 1000n, maxAgeMs: 500n, rootRefs: [0, 1] },
  ]);
  assert.deepEqual([...strategy.windows[2].source[0]], [57, 0, 0, 0]);
  assert.deepEqual([...strategy.windows[2].source[1]], [57, 0, 0, 1]);
  assert.deepEqual(strategy.transitions, [{ state: 0, expression: Uint8Array.from([57, 1, 0, 1]) }]);
  assert.deepEqual(strategy.intents.map(intent => intent.type), [1, 2, 2, 2, 2, 2, 2, 2, 3, 2]);
  assert.deepEqual(strategy.intents.slice(0, 8).map(intent => [...intent.expression]),
    Array.from({ length: 8 }, (_, field) => [57, 0, 0, field]));
});

test('GFB4 requires one exact temporal context, canonical roots, and at least one window', () => {
  const cases = [
    [canonicalModule().replace('(temporal-context __gf_now_ms __gf_time_epoch)', ''), 'temporal module requires one temporal-context'],
    [canonicalModule().replace('(temporal-context __gf_now_ms __gf_time_epoch)', '(temporal-context __gf_time_epoch __gf_now_ms)'), 'invalid temporal clock input'],
    [canonicalModule().replace('(temporal-root 11 root_a root_a_present root_a_epoch root_a_id root_a_timestamp)', '(temporal-root 0 root_a root_a_present root_a_epoch root_a_id root_a_timestamp)'), 'invalid temporal root tag'],
    [canonicalModule().replace('(temporal-root 22 root_b root_b_present root_b_epoch root_b_id root_b_timestamp)', '(temporal-root 11 root_b root_b_present root_b_epoch root_b_id root_b_timestamp)'), 'invalid temporal root tag'],
    [canonicalModule().replace(
      '(temporal-root 22 root_b root_b_present root_b_epoch root_b_id root_b_timestamp)',
      '(temporal-root 22 root_b root_b_present root_b_epoch root_b_id root_b_id)'), 'duplicate temporal input binding'],
    [`(module NoWindow
      (input __gf_now_ms number) (input __gf_time_epoch number)
      (input present bool) (input epoch number) (input id number) (input timestamp number)
      (temporal-context __gf_now_ms __gf_time_epoch)
      (temporal-root 1 sensor present epoch id timestamp)
      (strategy main 0 (device true) (intent ready true)))`, 'temporal module requires at least one window'],
  ];
  for (const [source, message] of cases) assert.throws(() => encode(source), error => error instanceof CompileError && error.message === message, message);
});

test('GFB4 rejects invalid operations, payload types, durations, and root references', () => {
  const cases = [
    [averageWindow.replace('average number', 'toString number'), 'invalid temporal operation'],
    [averageWindow.replace('average number', 'constructor number'), 'invalid temporal operation'],
    [averageWindow.replace('average number', 'average int'), 'invalid temporal payload type'],
    [rateWindow.replace('rate number', 'rate int'), 'invalid temporal payload type'],
    [minimumIntWindow.replace('min int', 'min bool'), 'invalid temporal payload type'],
    [averageWindow.replace('1000 500', '0 500'), 'invalid temporal duration'],
    [averageWindow.replace('1000 500', '9007199254740992 500'), 'invalid temporal duration'],
    [averageWindow.replace('(roots 11 22)', '(roots 22 11)'), 'invalid temporal window roots'],
    [averageWindow.replace('(roots 11 22)', '(roots 11 99)'), 'invalid temporal window roots'],
  ];
  for (const [window, message] of cases) {
    const source = canonicalModule({ windows: [window, minimumIntWindow, rateWindow] });
    assert.throws(() => encode(source), error => error instanceof CompileError && error.message === message, message);
  }
});

test('GFB4 validates descriptor identity, source blob types, and declaration order', () => {
  const duplicateSite = minimumIntWindow.replace('102 lowest', '101 lowest');
  const duplicateName = minimumIntWindow.replace('102 lowest', '102 mean');
  const wrongOk = averageWindow.replace('(source input.selected_ok', '(source input.selected_number');
  const nextInSource = averageWindow.replace('input.selected_number input.selected_fault', 'next.count input.selected_fault');
  const cases = [
    [canonicalModule({ windows: [averageWindow, duplicateSite, rateWindow] }), 'invalid temporal window site'],
    [canonicalModule({ windows: [averageWindow, duplicateName, rateWindow] }), 'duplicate temporal window name'],
    [canonicalModule({ windows: [wrongOk, minimumIntWindow, rateWindow] }), 'temporal source expression type mismatch'],
    [canonicalModule({ windows: [nextInSource, minimumIntWindow, rateWindow] }), 'next.* is allowed only in intents'],
    [canonicalModule({ beforeWindows: '(next count (int 0))' }), 'window declarations must precede transitions and intents'],
  ];
  for (const [source, message] of cases) assert.throws(() => encode(source), error => error instanceof CompileError && error.message === message, message);
});

test('window projections allow only prior slots in sources and existing slots in outputs', () => {
  const forward = averageWindow.replace('input.selected_number', '(window-read 1 value)');
  const invalidField = canonicalModule().replace('(intent average_value (window-read 0 value))', '(intent average_value (window-read 0 unknown))');
  const invalidSlot = canonicalModule().replace('(intent rate_value (window-read 2 value))', '(intent rate_value (window-read 3 value))');
  const queryRead = canonicalModule().replace('(device true)', '(device (window-read 0 ok))');
  const cases = [
    [canonicalModule({ windows: [forward, minimumIntWindow, rateWindow] }), 'temporal projection index'],
    [invalidField, 'temporal projection field'],
    [invalidSlot, 'temporal projection index'],
    [queryRead, 'unknown device query window-read'],
    ['(module Bad (input value number) (strategy main 0 (device true) (intent value (window-read 0 value))))', 'window-read requires GFB format 4'],
  ];
  for (const [source, message] of cases) assert.throws(() => encode(source), error => error instanceof CompileError && error.message === message, message);
});

test('each strategy preserves the shared 128 scalar-state and window limit', () => {
  const states = count => Array.from({ length: count }, (_, index) => `(state state_${index} bool false)`).join('\n  ');
  const oneWindow = [averageWindow];
  assert.doesNotThrow(() => encode(canonicalModule({ windows: oneWindow, states: states(127) })
    .replace('(next count (window-read 1 value))', '(next state_0 false)')
    .replace('(intent minimum_value (window-read 1 value))', '(intent minimum_value false)')
    .replace('(intent rate_value (window-read 2 value))', '(intent rate_value false)')));
  const invalid = canonicalModule({ windows: oneWindow, states: states(128) })
    .replace('(next count (window-read 1 value))', '(next state_0 false)')
    .replace('(intent minimum_value (window-read 1 value))', '(intent minimum_value false)')
    .replace('(intent rate_value (window-read 2 value))', '(intent rate_value false)');
  assert.throws(() => encode(invalid), error => error instanceof CompileError && error.message === 'temporal state limit exceeded');
});
