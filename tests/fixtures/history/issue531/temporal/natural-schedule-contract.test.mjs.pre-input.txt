import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileControl, typeCheckControl, parseControl, ControlCompileError } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));

const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url))).cases;
const fixture = id => cases.find(entry => entry.id === id);
const code = id => {
  const entry = fixture(id);
  return extractLiterate(entry.source, { filename: entry.filename }).code;
};

test('Solar reference policy retains trigger and common admission contract', () => {
  const descriptor = typeCheckControl(code('REF-03-042')).manifest.schedules[0];
  assert.equal(descriptor.kind, 'solar');
  assert.equal(descriptor.name, 'dawn');
  assert.equal(descriptor.event, 'rise');
  assert.equal(descriptor.offsetMs, 1_800_000);
  assert.deepEqual(descriptor.policy, { basis: 'pulse', when: 'true', clock: 'trusted_only', gapMs: 60_000, recovery: 'baseline', fallback: 'skip' });
});

test('WorkCalendar day rule retains logical provider binding', () => {
  const manifest = typeCheckControl(code('REF-03-059')).manifest;
  assert.deepEqual(manifest.calendars, [{ name: 'workers', type: 'WorkCalendar' }]);
  assert.equal(manifest.schedules[0].day.kind, 'workday');
  assert.equal(manifest.schedules[0].day.calendar, 'workers');
});

test('Tide reference policy retains stable logical provider and event offset', () => {
  const manifest = typeCheckControl(code('REF-03-060')).manifest;
  assert.deepEqual(manifest.providers, [{ name: 'harbor_tides', type: 'TidePredictions' }]);
  const schedule = manifest.schedules[0];
  assert.equal(schedule.kind, 'tide');
  assert.equal(schedule.name, 'high');
  assert.equal(schedule.source, 'harbor_tides');
  assert.equal(schedule.event, 'high');
  assert.equal(schedule.offsetMs, -1_800_000);
  assert.deepEqual(schedule.policy, {
    basis: { kind: 'run', durationMs: 600_000, admission: { kind: 'within', durationMs: 300_000 } },
    when: 'true', cancelWhen: ['or', 'input.stop', 'input.unsafe_level'],
    clock: 'trusted_only', gapMs: 60_000, recovery: 'baseline', fallback: 'skip',
  });
});

test('Tide rejects a classification tag as an occurrence event', () => {
  assert.throws(() => typeCheckControl(code('REF-03-061')), /Tide event must be high or low/);
});

for (const [id, tag, event, offsetMs] of [
  ['REF-03-042', 'sun', 'rise', 1_800_000],
  ['REF-03-042', 'sun', 'set', -1_800_000],
  ['REF-03-060', 'tide', 'high', -1_800_000],
  ['REF-03-060', 'tide', 'low', 1_800_000],
]) {
  test(`${tag} ${event}: canonical source retains event, offset and declaration identity`, async () => {
    const entry = fixture(id);
    const literal = `${tag}\`${event} ${offsetMs < 0 ? '-' : '+'} 30min\``;
    const source = entry.source.replace(new RegExp(`${tag}\`[^\`]+\``), literal);
    const extracted = extractLiterate(source, { filename: entry.filename }).code;
    const ast = parseControl(extracted, { filename: entry.filename });
    const schedule = ast.body.find(node => node.kind === 'schedule');
    assert.equal(schedule.at.event, event);
    assert.equal(schedule.at.offsetMs, offsetMs);
    if (tag === 'tide') assert.equal(extracted.slice(schedule.at.loc.offset, schedule.at.loc.endOffset), literal);
    const compiled = await compileSource(source, { filename: entry.filename });
    const descriptor = compiled.manifest.schedules.find(item => item.site === schedule.id);
    assert.equal(descriptor.event, event);
    assert.equal(descriptor.offsetMs, offsetMs);
    assert.equal(descriptor.policy.fallback, 'skip');
    const mapped = compiled.sourceMap.find(node => node.id === descriptor.site);
    assert.equal(mapped.kind, 'schedule');
    assert.equal(mapped.line, source.split('\n').findIndex(line => line.includes(`schedule ${schedule.name}:`)) + 1);
    assert.equal(mapped.extracted.line, schedule.loc.line);
  });
}

for (const id of ['REF-03-042', 'REF-03-060']) {
  for (const [label, replacement, message] of [
    ['missing fallback', '', /schedule requires fallback/],
    ['Bool fallback', 'fallback = false;', /fallback must be skip/],
    ['Duration fallback', 'fallback = 5min;', /fallback must be skip/],
    ['self-dependent fallback', id === 'REF-03-042' ? 'fallback = dawn.due;' : 'fallback = high.active;', /fallback must be skip/],
    ['fallback without required terminal', 'fallback = fixed_time(time`06:00`);', id === 'REF-03-042' ? /terminal.*skip/ : /fallback must be skip/],
  ]) {
    test(`${id}: public compilation rejects ${label} at its authored location`, async () => {
      const entry = fixture(id);
      const source = entry.source.replace('fallback = skip;', replacement);
      await assert.rejects(() => compileSource(source, { filename: entry.filename }), error => {
        assert.ok(error instanceof ControlCompileError);
        assert.match(error.message, message);
        const lineText = replacement || `schedule ${id === 'REF-03-042' ? 'dawn' : 'high'}:`;
        assert.equal(error.line, source.split('\n').findIndex(line => line.includes(lineText)) + 1);
        return true;
      });
    });
  }
}

test('Tide compilation rejects unavailable or incompatible logical provider prerequisites', async () => {
  const entry = fixture('REF-03-060');
  for (const declaration of ['', 'provider harbor_tides: LunarEphemeris;']) {
    const source = entry.source.replace('provider harbor_tides: TidePredictions;', declaration);
    await assert.rejects(() => compileSource(source, { filename: entry.filename }), /Tide source must name a TidePredictions provider/);
  }
});

test('Solar policy remains executable through the native solar runtime path', () => {
  assert.doesNotThrow(() => compileControl(code('REF-03-042')));
});

for (const id of ['REF-03-059', 'REF-03-060']) {
  test(`${id} emits GFB11 but requires provider admission bindings at activation`, async () => {
    const entry = fixture(id);
    const artifact = await compileSource(entry.source, { filename: entry.filename });
    assert.equal(artifact.bytes.subarray(0, 4).toString(), 'GFB1');
    assert.equal(artifact.bytes.readUInt16LE(4), 11);
    await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact), /context activation profile is required/);
    await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact, {
      context: { bootEpoch: 7, terminalCapacity: 8, bindings: [] },
    }), /missing declared provider binding/);
  });
}
