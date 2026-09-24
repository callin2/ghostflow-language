import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileControl, typeCheckControl } from '../tools/control.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { extractLiterate } from '../tools/literate.mjs';

const filename = 'after-event-evidence.ghost.md';
const document = fs.readFileSync(new URL(`./fixtures/${filename}`, import.meta.url), 'utf8');
const code = extractLiterate(document, { filename }).code;
const descriptorCode = code.replace('after_event_any(opened) |> recover(false)', 'false');
const descriptorDocument = document.replace('after_event_any(opened) |> recover(false)', 'false');

test('after_event_any explicitly aggregates overlapping event identities', () => {
  const checked = typeCheckControl(code, { filename });
  assert.equal(checked.manifest.signals[0].kind, 'after-event');
  assert.deepEqual(checked.manifest.signals[0].projections, ['any']);
});

test('after_event_all is an explicit aggregation and bare signal reads are rejected', () => {
  const all = typeCheckControl(code.replace('after_event_any', 'after_event_all'), { filename });
  assert.deepEqual(all.manifest.signals[0].projections, ['all']);
  assert.throws(() => typeCheckControl(code.replace('after_event_any(opened)', 'opened'), { filename }),
    /requires after_event_for, after_event_any, or after_event_all/);
});

test('after_event type checking preserves the identified Event and measured Bool predicate', () => {
  const checked = typeCheckControl(descriptorCode, { filename });
  const event = checked.sourceMap.find(node => node.kind === 'event');
  const sensor = checked.sourceMap.find(node => node.kind === 'sensor');
  const signal = checked.sourceMap.find(node => node.kind === 'signal');
  assert.deepEqual(checked.manifest.signals, [{
    kind: 'after-event', name: 'opened', site: signal.id,
    payloadType: 'Bool', errorType: 'SensorFault', quality: 'measured', windowMs: 10_000,
    event: { name: 'started', tag: event.id }, predicate: { name: 'valve_open', tag: sensor.id },
  }]);
});

for (const [label, before, after, diagnostic] of [
  ['nonpositive window', 'window: 10s', 'window: 0ms', /positive constant Duration/],
  ['wrong quality', 'quality: measured', 'quality: held', /quality must be measured/],
  ['numeric predicate', 'sensor valve_open: Bool', 'sensor valve_open: Number', /directly declared Bool sensor/],
  ['unknown event', 'after_event(started,', 'after_event(missing,', /declared Event/],
  ['duplicate window', 'window: 10s', 'window: 10s, window: 5s', /duplicate after_event argument window/],
]) test(`after_event rejects ${label} at type checking`, () => {
  assert.throws(() => typeCheckControl(descriptorCode.replace(before, after), { filename }), diagnostic);
});

test('explicit after_event projections lower to private Result channels', () => {
  const compiled = compileControl(code, { filename });
  assert.match(compiled.manifest.format, /^GhostFlow\/control-v[1-6]$/);
  assert.deepEqual(compiled.manifest.signals[0].projectionInputs, {
    any: {
      value: '__gf_after_event_any_value_opened',
      ok: '__gf_after_event_any_ok_opened',
      fault: '__gf_after_event_any_fault_opened',
    },
  });
  assert.deepEqual(compiled.manifest.inputs, []);
});

test('direct lowering rejects an after_event site without an explicit projection', () => {
  assert.throws(() => compileControl(descriptorCode, { filename }),
    /after_event requires an explicit after_event_any or after_event_all projection/);
});

test('canonical literate compilation emits executable control only for explicit projections', async () => {
  const artifact = await compileSource(document, { filename });
  assert.match(artifact.manifest.format, /^GhostFlow\/control-v[1-6]$/);
  const descriptor = await compileSource(descriptorDocument, { filename });
  assert.equal(descriptor.manifest.format, 'GhostFlow/temporal-descriptor-v1');
  assert.equal(descriptor.manifest.control.signals[0].kind, 'after-event');
});
