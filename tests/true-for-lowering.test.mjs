import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { typeCheckControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';

const filename = 'true-for-certified.ghost.md';
const document = fs.readFileSync(new URL(`./fixtures/${filename}`, import.meta.url), 'utf8');
const code = extractLiterate(document, { filename }).code;
test('true_for type checking retains the certified Bool contract without claiming executable support', () => {
  const checked = typeCheckControl(code, { filename });
  const sensor = checked.sourceMap.find(node => node.kind === 'sensor');
  const signal = checked.sourceMap.find(node => node.kind === 'signal');
  assert.deepEqual(checked.manifest.signals, [{
    kind: 'true-for', name: 'sustained', site: signal.id, slot: 0,
    payloadType: 'Bool', errorType: 'SensorFault', quality: 'measured', durationMs: 300_000,
    clockInput: '__gf_now_ms', timeEpochInput: '__gf_time_epoch',
    sources: [{ name: 'hot', tag: sensor.id }],
    intervalInputs: Object.fromEntries(['present', 'epoch', 'id', 'start', 'end', 'value', 'quality', 'fault']
      .map(field => [field, `__gf_interval_${field}_hot`])),
  }]);
});
for (const [label, before, after, diagnostic] of [
  ['zero duration', '5min', '0ms', /positive constant Duration/],
  ['negative duration', '5min', '-1ms', /positive constant Duration/],
  ['wrong quality', 'quality: measured', 'quality: held', /quality must be measured/],
  ['duplicate duration', 'duration: 5min', 'duration: 5min, duration: 6min', /duplicate true_for argument duration/],
  ['numeric source', 'sensor hot: Bool', 'sensor hot: Number', /declared Bool sensor/],
  ['derived source', 'true_for(hot,', 'true_for(hot |> recover(false),', /directly declared Bool sensor/],
]) test(`true_for rejects ${label} during type checking`, () => {
  assert.throws(() => typeCheckControl(code.replace(before, after), { filename }), diagnostic);
});

const fixture = `(module Certified (version 1)
  (input __gf_now_ms number) (input __gf_time_epoch number)
  (input present bool) (input epoch number) (input id number)
  (input start number) (input end number) (input value bool)
  (input quality number) (input fault number)
  (temporal-context __gf_now_ms __gf_time_epoch)
  (strategy control 0 (device true)
    (true-for 17 sustained 7 hot 300000 (interval-inputs present epoch id start end value quality fault))
    (intent alarm (if (true-for-read 0 ok) (true-for-read 0 value) false))))`;
const encode = source => compile(parse(tokenize(source)));
test('GFB6 encodes a separate fixed-width certified interval prelude and Bool projections', () => {
  const bytes = encode(fixture);
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(4, true), 6);
  const descriptor = Buffer.from('021100000009007375737461696e6564070000000300686f74e09304000000000002000300040005000600070008000900', 'hex');
  assert.ok(Buffer.from(bytes).includes(descriptor), 'tag 2, site 17, source 7, duration 300000 and u16 input indices');
  assert.ok(Buffer.from(bytes).includes(Buffer.from([59, 0, 0, 0])), 'Bool ok projection');
  assert.ok(Buffer.from(bytes).includes(Buffer.from([59, 0, 0, 1])), 'Bool payload projection');
});
for (const [label, before, after, diagnostic] of [
  ['unbound input', 'interval-inputs present', 'interval-inputs missing', /invalid certified interval input/],
  ['wrong Bool type', '(input value bool)', '(input value number)', /invalid certified interval input/],
  ['aliased identity fields', 'present epoch id start', 'present epoch epoch start', /duplicate certified interval input binding/],
  ['zero duration', 'hot 300000', 'hot 0', /invalid true_for duration/],
  ['zero root', 'sustained 7 hot', 'sustained 0 hot', /invalid certified source tag/],
  ['invalid projection', 'true-for-read 0 value', 'true-for-read 0 unknown', /true_for projection field/],
  ['out of range slot', 'true-for-read 0 value', 'true-for-read 1 value', /true_for projection index/],
]) test(`GFB6 rejects ${label}`, () => assert.throws(() => encode(fixture.replace(before, after)), diagnostic));

test('GFB6 permits independent durations over the exact same certified root', () => {
  const extra = '(true-for 18 longer 7 hot 600000 (interval-inputs present epoch id start end value quality fault))';
  assert.doesNotThrow(() => encode(fixture.replace('(intent alarm', `${extra}\n    (intent alarm`)));
});
test('GFB6 rejects rebinding a certified source across strategies', () => {
  const extra = '(strategy other 0 (device true) (true-for 18 longer 7 other 600000 (interval-inputs present epoch id start end value quality fault)))';
  assert.throws(() => encode(fixture.slice(0, -1) + extra + ')'), /certified source binding mismatch/);
});
test('GFB6 rejects a certified prelude declared after an executable intent', () => {
  assert.throws(() => encode(fixture.replace('(true-for 17', '(intent early true) (true-for 17')), /stateful prelude declarations must precede/);
});
