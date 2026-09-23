import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileControl, typeCheckControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';

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

test('Solar policy remains executable through the native solar runtime path', () => {
  assert.doesNotThrow(() => compileControl(code('REF-03-042')));
});

for (const id of ['REF-03-059', 'REF-03-060']) {
  test(`${id} execution remains fail-closed without provider and native admission bindings`, () => {
    assert.throws(() => compileControl(code(id)), /policy execution requires verified occurrence provider and native admission bindings/);
  });
}
