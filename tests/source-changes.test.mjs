import assert from 'node:assert/strict';
import test from 'node:test';
import { stringify } from 'yaml';
import { readFileSync } from 'node:fs';
import { inspectSourceChanges, sourceChangeInventory } from '../tools/source-changes.mjs';
import { planSourceUpdate, verifySourceUpdate } from '../tools/update-request.mjs';
import { typeCheckControl } from '../tools/control.mjs';

const doc = body => `# Control\n\n\`\`\`ghost\n${body}\n\`\`\`\n`;
const body = `control Demo {
  input start, spare: Bool;
  output pump, lamp: Bool;
  config delay: Duration = 5s { min = 1s; max = 10s; step = 1s; access = operator; }
  let active = start |> recover(false);
  timer elapsed = delay_on(active, 3s);
  pump <- active;
  lamp <- false;
}`;
const before = doc(body);
const changes = after => inspectSourceChanges(before, after).changes;
const target = (kind, name, part = 'declaration') => ({ kind, name, part });

test('existing config default is independent of definition and source metadata', () => {
  const report = inspectSourceChanges(before, before.replace('= 5s', '= 6s'));
  assert.equal(report.format, 'GhostFlow/source-changes-v1');
  assert.match(report.beforeSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(report.beforeSha256, report.afterSha256);
  assert.equal(report.documentChanged, true);
  assert.deepEqual(report.changes.map(({ category, target }) => ({ category, target })), [
    { category: 'config-default', target: target('config', 'delay', 'default') },
  ]);
  assert.equal(Object.hasOwn(report, 'settingsEvent'), false);
  assert.deepEqual(changes(before.replace('= 5s', '= 6s').replace('max = 10s', 'max = 20s')).map(c => c.category).sort(), ['config-default', 'config-definition']);
});

test('all five categories use field-specific targets', () => {
  const compact = '---\nprofile: ess3@r1\nbindings:\n  start: board.DI1\n---\n';
  const old = compact + before;
  const next = old.replace('= 5s', '= 6s').replace('max = 10s', 'max = 20s')
    .replace('3s)', '4s)').replace('input start, spare: Bool;', 'input start, spare: Bool; input extra: Bool;')
    .replace('board.DI1', 'board.DI2');
  const result = inspectSourceChanges(old, next).changes;
  assert.deepEqual([...new Set(result.map(c => c.category))].sort(), ['config-default', 'config-definition', 'control-rule', 'hardware', 'logical-io']);
  assert.ok(result.some(c => c.category === 'control-rule' && c.target.kind === 'timer' && c.target.name === 'elapsed'));
  assert.ok(result.some(c => c.category === 'logical-io' && c.target.name === 'extra'));
  assert.ok(result.some(c => c.category === 'hardware' && c.target.name === 'hardware'));
});

test('prose, comments, positions, grouping, declaration order and AST ids do not change targets', () => {
  const moved = body.replace('input start, spare: Bool;', 'input spare: Bool; // grouped differently\n input start: Bool;')
    .replace('output pump, lamp: Bool;', 'output lamp: Bool; output pump: Bool;');
  assert.deepEqual(changes(doc(moved).replace('# Control', '# New prose\n\nMore explanation')), []);
  assert.equal(inspectSourceChanges(before, before).documentChanged, false);
  const multiFence = before.replace('  let active', '```\n\nExplanation\n\n```ghost\n  let active');
  assert.deepEqual(changes(multiFence), []);
});

test('config add, remove, rename and metadata edit are definitions', () => {
  for (const next of [before.replace('delay:', 'duration:'), before.replace('access = operator', 'access = designer'),
    before.replace('config delay:', 'config delay:' ).replace('  let active', '  config enabled: Bool = true;\n  let active'),
    before.replace(/  config delay:[^\n]+\n/, '')]) {
    assert.ok(changes(next).length > 0);
    assert.ok(changes(next).every(c => c.category === 'config-definition'));
  }
  const addition = changes(before.replace('  let active', '  config enabled: Bool = true;\n  let active'))[0];
  assert.equal(addition.operation, 'add');
  assert.deepEqual(addition.after.value, { kind: 'literal', raw: 'true' });
});

test('inventory reports actual AST references, transitive input use and newly used existing inputs', () => {
  const initial = sourceChangeInventory(before);
  assert.deepEqual(initial.declaredInputNames, ['spare', 'start']);
  assert.deepEqual(initial.usedInputNames, ['start']);
  assert.ok(initial.targets.some(t => t.target.kind === 'let' && t.target.name === 'active' && t.referencedNames.includes('start')));
  const next = before.replace('pump <- active;', 'pump <- (spare |> recover(false)) && active;');
  assert.deepEqual(sourceChangeInventory(next).usedInputNames, ['spare', 'start']);
  assert.deepEqual(changes(next)[0].target, target('connection', 'pump'));
  const unknown = before.replace('pump <- active;', 'pump <- new_sensor |> recover(false);');
  assert.ok(sourceChangeInventory(unknown).unresolvedReferenceNames.includes('new_sensor'));
  assert.ok(changes(unknown).some(c => c.category === 'control-rule'));
});

test('function parameters and case pattern bindings shadow input names', () => {
  const source = doc(`fn identity(spare: Bool) -> Bool { spare }
    control Scoped {
      input spare, start: Bool;
      let active = case start { ok(spare) => spare; err(reason) => false; };
      output pump: Bool;
      pump <- identity(active);
    }`);
  const inventory = sourceChangeInventory(source);
  assert.deepEqual(inventory.usedInputNames, ['start']);
  assert.ok(!inventory.unresolvedReferenceNames.includes('reason'));
  assert.ok(inventory.targets.some(entry => entry.target.kind === 'function' && entry.referencedNames.length === 0));
  assert.ok(inventory.targets.find(entry => entry.target.kind === 'connection').referencedNames.includes('identity'));
});

test('state updates, schedules, output expressions and unresolved members remain control rules', () => {
  const source = doc(`control More {
    state count: Int = 0;
    count' = count + 1;
    schedule every: Periodic { every = 10s; }
    output pump: Bool;
    pump <- count > 0;
  }`);
  for (const [from, to, kind] of [["count + 1", "count + 2", 'next'], ['every = 10s', 'every = 20s', 'schedule'], ['count > 0', 'count > 1', 'connection']]) {
    const result = inspectSourceChanges(source, source.replace(from, to)).changes;
    assert.equal(result.length, 1);
    assert.equal(result[0].category, 'control-rule');
    assert.equal(result[0].target.kind, kind);
  }
  assert.ok(sourceChangeInventory(source.replace('count > 0', 'new_sensor.value')).unresolvedReferenceNames.includes('new_sensor'));
});

test('control identity, imports and connection endpoints cannot disappear', () => {
  assert.ok(changes(before.replace('control Demo', 'control Other')).every(c => c.category === 'control-rule'));
  assert.equal(changes(before.replace('control Demo', 'control Other')).length, 2);
  const imported = `import Unit from "unit.ghost.md" revision "r1" sha256 "${'a'.repeat(64)}";\n`;
  const first = doc(imported + body);
  assert.ok(inspectSourceChanges(first, first.replace('revision "r1"', 'revision "r2"')).changes.some(c => c.target.kind === 'import'));
  const connected = doc('control Demo { input source: Bool; output sink: Bool; connect sink <- source; }');
  assert.ok(sourceChangeInventory(connected).usedInputNames.includes('source'));
});

test('expanded hardware is compared without source identity/location noise', () => {
  const pin = { id: 'test', revision: 'r1', sha256: 'a'.repeat(64) };
  const hardware = { schema: 'GhostFlow/hardware-v1', profile: pin, modules: {}, buses: {}, instances: {}, bindings: { inputs: {}, outputs: {} } };
  const source = `---\n${stringify({ hardware })}---\n${before}`;
  assert.deepEqual(inspectSourceChanges(source, source.replace('# Control', '# Other')).changes, []);
  assert.deepEqual(inspectSourceChanges(source, source.replace('revision: r1', 'revision: r2')).changes.map(c => c.category), ['hardware']);
});

test('malformed, duplicate or ambiguous source fails explicitly', () => {
  assert.throws(() => sourceChangeInventory('plain prose'), /no executable ghost code/);
  assert.throws(() => sourceChangeInventory(doc('control X { let a = ; }')));
  for (const code of ['control X { input a, a: Bool; }', 'control X { let a = true; let a = false; }', 'control X { input a: Bool; let a = true; }']) {
    assert.throws(() => sourceChangeInventory(doc(code)), /duplicate|ambiguous/i);
  }
  assert.throws(() => sourceChangeInventory(doc('resource pump: Bool; constraints {}')), /unsupported|control/i);
});

test('existing schedule corpus ignores token positions after executable comments', () => {
  for (const file of ['scheduled-watering.ghost.md', 'korean-calendar.ghost.md']) {
    const source = readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8');
    assert.deepEqual(inspectSourceChanges(source, source.replace('```ghost\n', '```ghost\n// Added comment\n')).changes, [], file);
  }
});

test('strategy locals shadow globals and capability matching uses its input', () => {
  const scoped = doc(`control X { input spare: Bool; output out: Bool;
    adapt p { strategy S priority 0 match always { let spare = true; out <- spare; } }
  }`);
  assert.deepEqual(sourceChangeInventory(scoped).usedInputNames, []);
  const source = readFileSync(new URL('../examples/optional-feedback-timer.ghost.md', import.meta.url), 'utf8');
  assert.deepEqual(sourceChangeInventory(source).usedInputNames, ['observation', 'run_request']);
});

test('non-expression dependencies include schedule tokens, config, degraded branches and enum members', () => {
  const source = doc(`control More {
    input backup: Temperature;
    calendar holidays: HolidayCalendar;
    config slots: TimeSlots<15min, 8> = [time\`06:00\`] { access = operator; }
    schedule daily: DailySlots<15min> { timezone = "Asia/Seoul"; selected = slots; }
    schedule morning: Daily { timezone = "Asia/Seoul"; at = time\`06:00\`; calendar = holidays; }
    type Phase = Idle | Running;
    state phase: Phase = Idle;
    degraded Fallback for primary {
      branch Backup priority 1 when backup quality in { measured }
        use objective secondary authority automatic_degraded output 0% .. 30%;
      otherwise disable;
      resume = require_start;
    }
  }`);
  const inventory = sourceChangeInventory(source);
  assert.deepEqual(inventory.usedInputNames, ['backup', 'holidays']);
  assert.ok(inventory.targets.find(t => t.target.name === 'daily').referencedNames.includes('slots'));
  assert.ok(inventory.targets.find(t => t.target.name === 'morning').referencedNames.includes('holidays'));
  assert.ok(!inventory.unresolvedReferenceNames.includes('Idle'));
});

test('schema schedule choices are not unresolved variables and when remains an expression', () => {
  const source = readFileSync(new URL('../examples/solar-live-config.ghost.en.md', import.meta.url), 'utf8');
  assert.deepEqual(sourceChangeInventory(source).unresolvedReferenceNames, []);
  const predicate = source.replace('config enabled:', 'input baseline: Bool;\n  config enabled:')
    .replace('when = case enabled { ok(v) => v; fault(_) => false; };', 'when = baseline |> recover(false);');
  assert.deepEqual(sourceChangeInventory(predicate).usedInputNames, ['baseline']);
  assert.ok(sourceChangeInventory(source.replace('recovery = baseline', 'recovery = unknown_policy')).unresolvedReferenceNames.includes('unknown_policy'));
});

test('enum references cannot admit a newly used optional input through simple editor scope', () => {
  const code = 'control X { input spare?: Bool; type Phase = spare | Busy; state phase: Phase = spare; output out: Bool; out <- false; }';
  const next = code.replace('out <- false;', 'adapt p { strategy S priority 0 match (spare: sensor<Bool>) { out <- true; } strategy B priority -1 match always { out <- false; } }');
  assert.doesNotThrow(() => typeCheckControl(code));
  assert.doesNotThrow(() => typeCheckControl(next));
  const before = doc(code), after = doc(next), inventory = sourceChangeInventory(before);
  assert.deepEqual(inventory.usedInputNames, []);
  assert.deepEqual(sourceChangeInventory(after).usedInputNames, ['spare']);
  const request = { format: 'GhostFlow/update-request-v1', sourceSha256: inventory.sha256, items: [{
    id: 'rule', summary: 'rule', requires: [], usesInputs: ['spare'], changes: [
      { operation: 'remove', target: target('connection', 'out') },
      { operation: 'add', target: target('adapt', 'p') },
    ],
  }] };
  assert.deepEqual(planSourceUpdate(before, request, { editor: 'simple' }).apply, []);
  const undeclaredUse = { ...request, items: [{ ...request.items[0], usesInputs: [] }] };
  const check = verifySourceUpdate(before, after, undeclaredUse, { editor: 'simple', approved: ['rule'] });
  assert.equal(check.ok, false);
  assert.deepEqual(check.newInputNames, ['spare']);
});

test('calendar and provider declarations are logical inputs, including schema references shadowed by enum members', () => {
  const code = `control X {
    calendar days: HolidayCalendar;
    provider lunar: LunarEphemeris;
    provider unused: TidePredictions;
    type Names = days | lunar;
    output out: Bool;
    out <- (calendar_is(days, day\`holiday\`) |> recover(false)) && (moon_is(lunar, moon\`full\`) |> recover(false));
  }`;
  assert.doesNotThrow(() => typeCheckControl(code));
  const source = doc(code), inventory = sourceChangeInventory(source);
  assert.deepEqual(inventory.declaredInputNames, ['days', 'lunar', 'unused']);
  assert.deepEqual(inventory.usedInputNames, ['days', 'lunar']);
  for (const name of ['days', 'lunar', 'unused']) assert.equal(inventory.targets.find(t => t.target.name === name && t.target.kind !== 'enum').category, 'logical-io');
  assert.deepEqual(inspectSourceChanges(source, source.replace('provider unused: TidePredictions;', 'provider unused: LunarEphemeris;')).changes.map(c => c.category), ['logical-io']);
  const tide = code.replace('output out: Bool;', `schedule tide: Tide {
    source = unused; timezone = "UTC"; at = tide\`high\`;
    basis = pulse; when = true; clock = trusted_only;
    gap = skip_after(60s); recovery = baseline; fallback = skip;
  } output out: Bool;`);
  assert.doesNotThrow(() => typeCheckControl(tide));
  assert.deepEqual(sourceChangeInventory(doc(tide)).usedInputNames, ['days', 'lunar', 'unused']);
});

test('direct sensor selectors retain input use when an enum member shares the name', () => {
  const code = `control X { input spare: Number; type Phase = spare | Busy;
    state phase: Phase = spare; output out: Bool; out <- false; }`;
  const next = code.replace('out <- false;', `signal low = hysteresis(spare, on_below: 1, off_above: 2, initial: false);
    out <- low |> recover(false);`);
  assert.doesNotThrow(() => typeCheckControl(code));
  assert.doesNotThrow(() => typeCheckControl(next));
  assert.deepEqual(sourceChangeInventory(doc(code)).usedInputNames, []);
  assert.deepEqual(sourceChangeInventory(doc(next)).usedInputNames, ['spare']);
  const objective = `control X { input spare: Temperature; type Phase = spare | Busy;
    config target: Temperature = 25°C { min = 10°C; max = 40°C; step = 1Δ°C; access = operator; }
    resource heater: ContinuousActuator<Percent>;
    objective warmth { measure = spare; target = target; manipulate = heater.position;
      output = 0% .. 80%; controller = hysteresis {} }
  }`;
  assert.doesNotThrow(() => typeCheckControl(objective));
  assert.deepEqual(sourceChangeInventory(doc(objective)).usedInputNames, ['spare']);
});
