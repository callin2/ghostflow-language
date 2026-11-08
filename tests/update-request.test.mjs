import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceChangeInventory } from '../tools/source-changes.mjs';
import { planSourceUpdate, verifySourceUpdate } from '../tools/update-request.mjs';

const document = '# Watering\n```ghost\ncontrol Farm {\n input start, spare: Bool;\n output valve: Bool;\n config duration: Duration = 5s { min = 1s; max = 30s; step = 1s; access = operator; }\n let ready = start |> recover(false);\n valve <- ready;\n}\n```\n';
const target = (kind, name, part = 'declaration') => ({ kind, name, part });
const edit = (target, operation = 'modify') => ({ target, operation });
const item = (id, changes, requires = [], usesInputs = []) => ({ id, summary: id, changes, requires, usesInputs });
const request = items => ({ format: 'GhostFlow/update-request-v1', sourceSha256: sourceChangeInventory(document).sha256, items });
const duration = item('duration', [edit(target('config', 'duration', 'default'))]);
const sensor = item('sensor', [edit(target('input', 'rain'), 'add')]);
const rainRule = item('rain-rule', [edit(target('connection', 'valve'))], ['sensor'], ['rain']);

test('simple editor partitions before modification and preserves independent eligible change', () => {
  const plan = planSourceUpdate(document, request([duration, sensor, rainRule]), { editor: 'simple' });
  assert.deepEqual(plan.apply, ['duration']);
  assert.deepEqual(plan.deferred.map(entry => entry.id), ['sensor', 'rain-rule']);
  assert.ok(plan.deferred.find(entry => entry.id === 'sensor').reasons.includes('outside-editor-scope'));
  assert.ok(plan.deferred.find(entry => entry.id === 'rain-rule').reasons.includes('deferred-dependency'));
  assert.equal(plan.sourceSha256, sourceChangeInventory(document).sha256);
  assert.equal(Object.hasOwn(plan, 'document'), false, 'preflight does not modify the programme');
});

test('full editor permits the same request regardless of the client device type', () => {
  const plan = planSourceUpdate(document, request([duration, sensor, rainRule]), { editor: 'full' });
  assert.deepEqual(plan.apply, ['duration', 'sensor', 'rain-rule']);
  assert.deepEqual(plan.deferred, []);
  assert.throws(() => planSourceUpdate(document, request([duration]), { editor: 'ipad' }), /editor/);
});

test('config definition and control rules remain allowed with existing used input', () => {
  const rule = item('start-rule', [edit(target('connection', 'valve'))], [], ['start']);
  const definition = item('range', [edit(target('config', 'duration', 'definition'))]);
  assert.deepEqual(planSourceUpdate(document, request([duration, definition, rule]), { editor: 'simple' }).apply,
    ['duration', 'range', 'start-rule']);
});

test('a connected but unused input cannot enter a simple rule edit', () => {
  const rule = item('spare-rule', [edit(target('connection', 'valve'))], [], ['spare']);
  const plan = planSourceUpdate(document, request([duration, rule]), { editor: 'simple' });
  assert.deepEqual(plan.apply, ['duration']);
  assert.deepEqual(plan.deferred[0].reasons, ['input-not-in-use']);
});

test('item with allowed and forbidden targets is indivisible; transitive dependants are deferred', () => {
  const mixed = item('mixed', [...duration.changes, ...sensor.changes]);
  const dependent = item('dependent', [edit(target('connection', 'valve'))], ['mixed']);
  const second = item('second', [edit(target('let', 'ready'))], ['dependent']);
  assert.deepEqual(planSourceUpdate(document, request([mixed, dependent, second]), { editor: 'simple' }).deferred.map(x => x.id),
    ['mixed', 'dependent', 'second']);
});

test('request schema rejects stale base, duplicate edits, cycles, unknown fields and invented targets', () => {
  const invalid = [
    { ...request([duration]), sourceSha256: 'a'.repeat(64) },
    request([duration, { ...duration }]),
    request([duration, { ...duration, id: 'duplicate-target' }]),
    request([{ ...duration, requires: ['missing'] }]),
    request([{ ...duration, requires: ['duration'] }]),
    request([{ ...duration, ignored: true }]),
    request([item('unknown', [edit(target('not-a-kind', 'x'), 'add')])]),
    request([item('missing', [edit(target('timer', 'not-present'))])]),
    request([item('overwrite', [edit(target('input', 'start'), 'add')])]),
    request([item('wrong-part', [edit(target('config', 'duration', 'anything'))])]),
  ];
  for (const value of invalid) assert.throws(() => planSourceUpdate(document, value, { editor: 'simple' }));
  const a = { ...duration, requires: ['b'] };
  const b = item('b', [edit(target('connection', 'valve'))], ['duration']);
  assert.throws(() => planSourceUpdate(document, request([a, b]), { editor: 'simple' }), /cycle/);
});

test('only the approved targets may change, even if the provider labels everything settings', () => {
  const plan = request([duration]);
  assert.equal(verifySourceUpdate(document, document.replace('= 5s', '= 8s'), plan,
    { editor: 'simple', approved: ['duration'] }).ok, true);
  const sneaky = document.replace('= 5s', '= 8s').replace('valve <- ready', 'valve <- false');
  const result = verifySourceUpdate(document, sneaky, plan, { editor: 'simple', approved: ['duration'] });
  assert.equal(result.ok, false);
  assert.ok(result.unexpectedChanges.some(change => change.target.kind === 'connection'));
  assert.equal(verifySourceUpdate(document, document.replace('max = 30s', 'max = 60s'), plan,
    { editor: 'simple', approved: ['duration'] }).ok, false);
});

test('post-check catches undeclared new input dependency and does not certify syntax errors', () => {
  const req = request([item('rule', [edit(target('connection', 'valve'))])]);
  for (const input of ['spare', 'missing_sensor']) {
    const candidate = document.replace('valve <- ready', `valve <- ${input} |> recover(false)`);
    const result = verifySourceUpdate(document, candidate, req, { editor: 'simple', approved: ['rule'] });
    assert.equal(result.ok, false);
    assert.ok(result.newInputNames.includes(input));
  }
  assert.throws(() => verifySourceUpdate(document, '```ghost\ncontrol Bad {\n```', req, { editor: 'simple', approved: ['rule'] }));
});

test('approval cannot include deferred items or omit another selected item prerequisite', () => {
  const req = request([duration, sensor, rainRule]);
  assert.throws(() => verifySourceUpdate(document, document, req, { editor: 'simple', approved: ['sensor'] }), /approval/);
  assert.throws(() => verifySourceUpdate(document, document, req, { editor: 'full', approved: ['rain-rule'] }), /dependency/);
});

test('external calendar and provider declarations belong to the full editor', () => {
  const req = request([
    duration,
    item('calendar', [edit(target('calendar', 'holidays'), 'add')]),
    item('provider', [edit(target('provider', 'tides'), 'add')]),
  ]);
  const simple = planSourceUpdate(document, req, { editor: 'simple' });
  assert.deepEqual(simple.apply, ['duration']);
  assert.deepEqual(simple.deferred.map(({ id }) => id), ['calendar', 'provider']);
  assert.deepEqual(planSourceUpdate(document, req, { editor: 'full' }).apply, ['duration', 'calendar', 'provider']);
});
