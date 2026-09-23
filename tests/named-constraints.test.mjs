import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileControl, parseControl, typeCheckControl } from '../tools/control.mjs';

const station = `resource station: Station;
resource pump1: BoolActuator;
constraints StationRules for station {
  exclusive at admission { automatic, manual, configuring };
  require at safe_output count_on({ pump1 }) <= 1;
  require at safe_output any_on({ pump1 });
}`;

test('named constraints retain resource identity, stage, and finite set in the checked manifest', () => {
  const { manifest } = typeCheckControl(station);
  assert.deepEqual(manifest.resources, [
    { name: 'station', type: 'Station' },
    { name: 'pump1', type: 'BoolActuator' },
  ]);
  assert.deepEqual(manifest.constraints, [{ name: 'StationRules', target: 'station', rules: [
    { kind: 'exclusive', stage: 'admission', members: ['automatic', 'manual', 'configuring'] },
    { kind: 'require', stage: 'safe_output', predicate: { kind: 'compare', op: '<=', left: { kind: 'count_on', resources: ['pump1'] }, right: { kind: 'Int', value: 1 } } },
    { kind: 'require', stage: 'safe_output', predicate: { kind: 'any_on', resources: ['pump1'] } },
  ] }]);
  assert.throws(() => compileControl(station), /named constraints require resource binding and runtime enforcement/);
});

test('empty finite sets preserve count_on=0 and any_on=false semantics', () => {
  const { manifest } = typeCheckControl(`resource station: Station;
constraints EmptySetRules for station {
  require at safe_output count_on({}) == 0;
  require at safe_output any_on({}) == false;
}`);
  assert.deepEqual(manifest.constraints[0].rules.map(rule => rule.predicate), [
    { kind: 'compare', op: '==', left: { kind: 'count_on', resources: [], constant: 0 }, right: { kind: 'Int', value: 0 } },
    { kind: 'compare', op: '==', left: { kind: 'any_on', resources: [], constant: false }, right: { kind: 'Bool', value: false } },
  ]);
});

test('named constraints reject missing resource, wrong resource type, duplicate finite items, and unsupported stage', () => {
  const base = 'resource station: Station; resource pump1: BoolActuator; constraints R for station { require at safe_output any_on({ pump1 }); }';
  assert.throws(() => typeCheckControl(base.replace('pump1 });', 'missing });')), /unknown resource missing/);
  assert.throws(() => typeCheckControl(base.replace('pump1 });', 'station });')), /BoolActuator/);
  assert.throws(() => typeCheckControl(base.replace('pump1 });', 'pump1, pump1 });')), /duplicate resource pump1/);
  assert.throws(() => typeCheckControl(base.replace('safe_output', 'admission')), /safe_output/);
  assert.equal(parseControl(base).kind, 'resource-policy');
});

test('safe_output implication keeps the final candidate resource reference', () => {
  const source = `resource station: Station;
resource pump1: BoolActuator;
resource valve1: BoolActuator;
constraints R for station { require at safe_output pump1.on => any_on({ valve1 }); }`;
  assert.deepEqual(typeCheckControl(source).manifest.constraints[0].rules[0].predicate, {
    kind: 'implies', op: '=>', left: { kind: 'resource-on', resource: 'pump1' },
    right: { kind: 'any_on', resources: ['valve1'] },
  });
});
