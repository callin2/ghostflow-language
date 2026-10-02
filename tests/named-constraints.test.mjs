import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileControl, compileComposedControl, parseControl, typeCheckControl } from '../tools/control.mjs';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

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

const inline = `control Shared {
  resource station: Station;
  resource pump: BoolActuator;
  resource valve: BoolActuator;
  output requested: Bool; requested <- true;
  constraints Contract for station {
    exclusive at admission { automatic, manual };
    require at safe_output pump.on => any_on({ valve });
    safe { pump = false; valve = true; }
  }
}`;
const literate = code => `# Shared contract\n\nThis source describes a checked resource policy.\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;

test('one-control shared contracts retain finite identities and authored safe values without claiming execution', () => {
  const checked = typeCheckControl(inline);
  const group = checked.manifest.sharedResourceConstraints[0];
  assert.equal(group.scope, 'shared_resource');
  assert.deepEqual(group.modes, ['automatic', 'manual']);
  assert.deepEqual(group.outputs, ['pump', 'valve']);
  assert.deepEqual(group.safe.map(({resource,value}) => ({resource,value})), [{resource:'pump',value:false},{resource:'valve',value:true}]);
  for (const node of [group, ...group.rules, ...group.safe]) {
    assert.ok(checked.sourceMap.some(source => source.id === node.source.nodeId));
  }
  assert.throws(() => compileControl(inline), /shared resource constraints require resource binding and runtime enforcement/);
  assert.throws(() => compileControl(inline, {emitBytecode:false}), /resource binding and runtime enforcement/);
  assert.throws(() => compileComposedControl(parseControl(inline), 'shared'), /resource binding and runtime enforcement/);
  const source = literate(inline), artifact = compileSourceSync(source, {filename:'shared.ghost.md'});
  assert.equal(artifact.manifest.format, 'GhostFlow/control-policy-descriptor-v1');
  assert.equal(artifact.manifest.executable, false);
  assert.equal(artifact.manifest.sourceDocumentSha256, sha256Hex(source));
  const bytes = JSON.parse(new TextDecoder().decode(artifact.bytes));
  assert.equal(bytes.executable, false);
  assert.equal(bytes.sourceDocument.text, source);
  assert.equal(bytes.sourceDocument.filename, 'shared.ghost.md');
  assert.equal(bytes.sourceDocument.sha256, sha256Hex(source));
  assert.equal(bytes.controlSource.includes('constraints Contract for station'), true);
  assert.equal(new TextDecoder().decode(artifact.bytes).startsWith('GFB1'), false);
  assert.ok(artifact.sourceMap.some(node => node.kind === 'shared-constraints' && node.line === 11));
  assert.equal(artifact.manifest.control.sharedResourceConstraints[0].source.line, 11);
  assert.equal(bytes.manifest.control.sharedResourceConstraints[0].source.line, 11);
});

test('shared resource policies in pinned composition reject instead of disappearing from executable control', () => {
  const imported = literate(inline);
  const parent = literate(`import Shared from "./shared.ghost.md" revision "r1" sha256 "${sha256Hex(imported)}";
control Farm { output requested: Bool; instance policy: Shared; connect requested <- policy.requested; }`);
  assert.throws(() => compileSourceSync(parent, { filename:'farm.ghost.md',
    sourceClosure:[{filename:'shared.ghost.md', revision:'r1', text:imported}] }), /composition of resource requires its instance contract/);
});

test('shared BoolActuator targets require exact target and predicate safe coverage', () => {
  const target = inline.replace('for station', 'for pump').replace('pump.on => any_on({ valve })', 'any_on({ valve })');
  assert.deepEqual(typeCheckControl(target).manifest.sharedResourceConstraints[0].outputs, ['pump','valve']);
  assert.throws(() => typeCheckControl(target.replace('pump = false;', '')), /missing protected resource pump/);
  assert.throws(() => typeCheckControl(inline.replace('valve = true;', '')), /missing protected resource valve/);
  assert.throws(() => typeCheckControl(inline.replace('safe { pump = false; valve = true; }', '')), /authored safe vector/);
  assert.throws(() => typeCheckControl(inline.replace('pump = false;', 'pump = false; pump = true;')), /duplicate safe resource pump/);
  assert.throws(() => typeCheckControl(inline.replace('safe {', 'safe { station = false;')), /safe resource station must be a BoolActuator/);
  assert.throws(() => typeCheckControl(inline.replace('safe {', 'safe { missing = false;')), /unknown safe resource missing/);
  assert.throws(() => typeCheckControl(inline.replace('resource valve:', 'resource unused: BoolActuator; resource valve:').replace('safe {', 'safe { unused = false;')), /outside the protected finite output set/);
  assert.throws(() => typeCheckControl(inline.replace('valve = true', 'valve = 1')), /literal Bool/);
  assert.throws(() => typeCheckControl(inline.replace('for station', 'for absent')), /unknown resource absent/);
  assert.throws(() => typeCheckControl(inline.replace('station: Station', 'station: ContinuousActuator')), /Station or BoolActuator/);
});

test('authored safe vectors must satisfy every mandatory finite predicate, including non-OFF contracts', () => {
  const neededOn = inline.replace('pump.on => any_on({ valve })', 'any_on({ valve })').replace('pump = false;', '');
  assert.throws(() => typeCheckControl(neededOn.replace('valve = true', 'valve = false')), /does not satisfy every mandatory require/);
  assert.equal(typeCheckControl(neededOn).manifest.sharedResourceConstraints[0].safe[0].value, true);
  assert.throws(() => typeCheckControl(neededOn.replace('safe {', 'require at safe_output any_on({ valve }) == false; safe {')), /does not satisfy every mandatory require/);
  const empty = 'control Empty { resource station: Station; constraints EmptySet for station { require at safe_output count_on({}) == 0; require at safe_output any_on({}) == false; safe {} } }';
  assert.deepEqual(typeCheckControl(empty).manifest.sharedResourceConstraints[0].safe, []);
  assert.throws(() => typeCheckControl(empty.replace('count_on({}) == 0', 'false')), /does not satisfy every mandatory require/);
});

test('named shared grammar rejects empty, duplicate, missing-stage and advisory contracts explicitly', () => {
  const group = 'constraints Contract for station { exclusive at admission { automatic, manual }; safe {} }';
  const shell = value => `control Named { resource station: Station; ${value} }`;
  assert.throws(() => typeCheckControl(shell('constraints Contract for station { safe {} }')), /requires at least one rule/);
  assert.throws(() => typeCheckControl(shell(group + group)), /duplicate name Contract/);
  assert.throws(() => typeCheckControl(shell(group.replace('automatic, manual', 'automatic, automatic'))), /duplicate exclusive mode automatic/);
  assert.throws(() => typeCheckControl(shell(group.replace('automatic, manual', ''))), /at least two modes/);
  assert.throws(() => typeCheckControl(shell(group.replace('exclusive at admission { automatic, manual }', 'exclusive(automatic, manual)'))), /exclusive requires a stage/);
  assert.throws(() => typeCheckControl(shell(group.replace('at admission', 'at safe_output'))), /exclusive stage must be admission/);
  assert.throws(() => typeCheckControl(shell(group.replace('safe {}', 'safe {} safe {}'))), /duplicate authored safe vector/);
  for (const word of ['warn', 'monitor', 'check']) assert.throws(() => typeCheckControl(shell(group.replace('exclusive at admission { automatic, manual };', `${word} true;`))), new RegExp(`unsupported named constraint ${word}`));
  for (const replacement of ['require any_on({ valve });', 'require at admission any_on({ valve });']) {
    assert.throws(() => typeCheckControl(inline.replace('require at safe_output pump.on => any_on({ valve });', replacement)), /require requires a stage|stage must be safe_output/);
  }
});

test('local named output groups lower existing safety rules and retain group and rule provenance', () => {
  const code = `control Local {
    output pump, valve, heater: Bool;
    pump <- true; valve <- false; heater <- true;
    constraints LocalSafety { require at safe_output pump => valve; mutex(pump, heater); }
  }`;
  const compilation = compileControl(code), group = compilation.manifest.localConstraints[0];
  assert.equal(new TextDecoder().decode(compilation.bytes.slice(0,4)), 'GFB1');
  assert.equal(group.scope, 'local_output');
  assert.deepEqual(group.rules.map(rule => rule.lowered), [[['requires','pump','valve']],[['mutex','pump','heater']]]);
  assert.ok(compilation.sourceMap.some(source => source.id === group.source.nodeId));
  assert.equal(compilation.manifest.sharedResourceConstraints, undefined);
  assert.deepEqual(compileControl(code.replace('require at safe_output', 'require')).bytes, compilation.bytes);
  const negated = code.replace('pump => valve', '!(pump && valve)');
  assert.deepEqual(typeCheckControl(negated).manifest.localConstraints[0].rules[0].lowered, [['mutex','pump','valve']]);
});

test('local groups reject wrong bindings, empty groups, duplicate names and unsupported grammar without accounting reinterpretation', () => {
  const shell = group => `control Local { input enabled: Bool; output pump, valve: Bool; output amount: Percent; pump <- true; valve <- false; amount <- 0%; ${group} }`;
  assert.throws(() => compileControl(shell('constraints LocalSafety {}')), /local constraints block requires at least one rule/);
  assert.throws(() => compileControl(shell('constraints R { mutex(pump, pump); }')), /duplicate local mutex output/);
  assert.throws(() => compileControl(shell('constraints R { require pump => enabled; }')), /Bool output/);
  assert.throws(() => compileControl(shell('constraints R { mutex(pump, amount); }')), /Bool output/);
  assert.throws(() => compileControl(shell('constraints R { require at admission pump => valve; }')), /local require stage must be safe_output/);
  assert.throws(() => compileControl(shell('constraints R { mutex(pump,valve); } constraints R { mutex(pump,valve); }')), /duplicate name R/);
  for (const rule of ['exclusive(pump, valve);', 'exclusive at admission { pump, valve };', 'warn true;', 'monitor true;', 'check true;', 'mutex(pump,valve); limit used(pump, rolling(1h)) <= 1h {}']) {
    assert.throws(() => compileControl(shell(`constraints R { ${rule} }`)), /unsupported local constraint/);
  }
  const account = 'control Accounting { resource pump: BoolActuator; account usedPump = on_time(pump, stage: applied, persistence: durable); constraints Budget { limit used(usedPump, rolling(24h)) <= 1h { reserve = 1min; on_unknown = block; } } }';
  assert.ok(typeCheckControl(account).manifest.accountingConstraints);
  assert.throws(() => typeCheckControl(account.replace('on_unknown = block; }', 'on_unknown = block; } require pump => pump;')), /accounting constraints only support limit rules/);
});
