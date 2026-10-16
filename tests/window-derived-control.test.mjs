import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { compile as compileGfb, CompileError, parse, tokenize } from '../tools/gfb1.mjs';

const document = code => `# Derived window control\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const compile = code => compileSource(document(code), { filename: 'window-derived-control.ghost.md' });
const windows = artifact => artifact.manifest.signals.filter(signal => signal.kind === 'window');
const hasBytes = (bytes, expected) => bytes.some((_, start) => expected.every((value, offset) => bytes[start + offset] === value));

test('nested average and minimum retain derived evidence and transitive physical roots', async () => {
  const artifact = await compile(`control NestedWindows {
    input temperature: Temperature;
    signal inner = window_average(temperature, over: 2s, quality: measured, max_age: 1s);
    signal outer = window_min(inner, over: 10s, quality: measured, max_age: 2s);
    output low: Bool;
    low <- outer |> map(below(280K)) |> recover(false);
  }`);
  const [inner, outer] = windows(artifact);
  assert.equal(new DataView(artifact.bytes.buffer, artifact.bytes.byteOffset).getUint16(4, true), 4);
  assert.deepEqual(outer.sources, inner.sources);
  assert.deepEqual(outer.upstreamWindows, [{ name: 'inner', site: inner.site, slot: 0 }]);
  assert.ok(!Object.hasOwn(inner, 'upstreamWindows'), 'physical-only descriptors remain unchanged');
  assert.ok(hasBytes([...artifact.bytes], [57, 0, 0, 7]), 'the outer quality blob marks slot 0 derived evidence');
});

test('a case over two derived Results preserves both ordered evidence dependencies', async () => {
  const artifact = await compile(`control CaseSelectedWindows {
    type Side = Inside | Outside;
    state selected: Side = Inside;
    input inside: Temperature;
    input outside: Temperature;
    signal inside_average = window_average(inside, over: 2s, quality: measured, max_age: 1s);
    signal outside_average = window_average(outside, over: 2s, quality: measured, max_age: 1s);
    signal selected_maximum = window_max(case selected { Inside => inside_average; Outside => outside_average; },
      over: 10s, quality: measured, max_age: 2s);
    output high: Bool;
    high <- selected_maximum |> map(below(320K)) |> recover(false);
  }`);
  const [inside, outside, selected] = windows(artifact);
  assert.deepEqual(selected.upstreamWindows, [
    { name: 'inside_average', site: inside.site, slot: 0 },
    { name: 'outside_average', site: outside.site, slot: 1 },
  ]);
  assert.deepEqual(selected.sources.map(source => source.name), ['inside', 'outside']);
});

test('a selected physical or derived branch records only the derived dependency and all physical roots', async () => {
  const artifact = await compile(`control MixedWindowBranch {
    input use_inner: Bool;
    input inside: Temperature;
    input outside: Temperature;
    signal inner = window_average(inside, over: 2s, quality: measured, max_age: 1s);
    signal outer = window_max(case use_inner { ok(use) => if use then inner else outside; fault(reason) => fault(reason); }, over: 10s, quality: measured, max_age: 2s);
    output high: Bool;
    high <- outer |> map(below(320K)) |> recover(false);
  }`);
  const [inner, outer] = windows(artifact);
  assert.deepEqual(outer.upstreamWindows, [{ name: 'inner', site: inner.site, slot: 0 }]);
  assert.deepEqual(outer.sources.map(source => source.name), ['inside', 'outside']);
});

test('a constant map preserves the upstream derived evidence marker', async () => {
  const artifact = await compile(`fn constant_temperature(value: Temperature) -> Temperature { 300K }
  control ConstantMappedWindow {
    input temperature: Temperature;
    signal inner = window_average(temperature, over: 2s, quality: measured, max_age: 1s);
    signal outer = window_average(inner |> map(constant_temperature), over: 10s, quality: measured, max_age: 2s);
    output warm: Bool;
    warm <- outer |> map(below(301K)) |> recover(false);
  }`);
  const [inner, outer] = windows(artifact);
  assert.deepEqual(outer.upstreamWindows, [{ name: 'inner', site: inner.site, slot: 0 }]);
  assert.deepEqual(outer.sources, inner.sources);
});

test('pure and_then preserves selected derived evidence through its Result constructor', async () => {
  const artifact = await compile(`fn pass(value: Temperature) -> Result<Temperature, SensorFault> { ok(value) }
  control ChainedWindow {
    input temperature: Temperature;
    signal inner = window_average(temperature, over: 2s, quality: measured, max_age: 1s);
    signal outer = window_max(inner |> and_then(pass), over: 10s, quality: measured, max_age: 2s);
    output high: Bool;
    high <- outer |> map(below(320K)) |> recover(false);
  }`);
  const [inner, outer] = windows(artifact);
  assert.deepEqual(outer.upstreamWindows, [{ name: 'inner', site: inner.site, slot: 0 }]);
  assert.deepEqual(outer.sources, inner.sources);
});

test('recover followed by ok cannot launder a derived value into measured evidence', async () => {
  await assert.rejects(() => compile(`fn constructed(value: Temperature) -> Result<Temperature, SensorFault> { ok(value) }
    control LaunderedWindow {
      input temperature: Temperature;
      signal inner = window_average(temperature, over: 2s, quality: measured, max_age: 1s);
      signal outer = window_max(constructed(inner |> recover(0K)), over: 10s, quality: measured, max_age: 2s);
    }`), error => {
    assert.match(error.message, /window_max measured source requires physical sample lineage/);
    return true;
  });
});

test('GFB4 encoder requires every evidence dependency transitive root in the consumer descriptor', () => {
  const source = `(module DerivedRoots
    (input __gf_now_ms number) (input __gf_time_epoch number)
    (input a_present bool) (input a_epoch number) (input a_id number) (input a_timestamp number)
    (input b_present bool) (input b_epoch number) (input b_id number) (input b_timestamp number)
    (input ok bool) (input value number) (input fault number) (input origin number)
    (temporal-context __gf_now_ms __gf_time_epoch)
    (temporal-root 11 a a_present a_epoch a_id a_timestamp)
    (temporal-root 22 b b_present b_epoch b_id b_timestamp)
    (strategy main 0 (device true)
      (window 101 inner average number 1000 500 (roots 11)
        (source input.ok input.value input.fault input.origin 1 11))
      (window 102 outer min number 1000 500 (roots 22)
        (source (window-read 0 ok) (window-read 0 value) (window-read 0 fault)
          (window-read 0 origin) (window-read 0 quality) 101))
      (intent value (window-read 1 value))))`;
  assert.throws(() => compileGfb(parse(tokenize(source))), error =>
    error instanceof CompileError && error.message === 'temporal window evidence roots are incomplete');
});
