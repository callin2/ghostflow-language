import assert from 'node:assert/strict';
import test from 'node:test';
import { stringify } from 'yaml';
import { parseHardwareFrontMatter } from '../tools/hardware-frontmatter.mjs';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

const pin = id => ({ id, revision: 'r1', sha256: 'a'.repeat(64) });
const fixture = () => ({
  schema: 'GhostFlow/hardware-v1', profile: pin('ess3h32'),
  modules: { meter: pin('jsy-mk'), other: pin('temperature-probe'), relay: pin('relay-bank') },
  buses: { serial: { service: 'modbus-rtu', config: { port: 1, settings: { baud: 9600, parity: 'none' }, retry: [10, 20] } } },
  instances: {
    power: { module: 'meter', role: 'input', config: { bus: 'serial', address: 1 } },
    temperature: { module: 'other', role: 'input', config: { calibration: { slope: 1.2, offset: null } } },
    panel: { module: 'relay', role: 'output', config: { channels: [{ pin: 3, inverted: false }] } },
  },
  bindings: { inputs: { current: { instance: 'power', channel: 'current' }, ambient: { instance: 'temperature', channel: 'value' } }, outputs: { pump: { instance: 'panel', channel: 'relay1' } } },
});
const code = 'control Demo { input current, ambient: Number; output pump: Bool; pump <- (current |> recover(0.0)) > (ambient |> recover(0.0)); }';
const document = (hardware = fixture(), body = code) => `---\n${stringify({ title: 'Farm', hardware })}---\n# Farm\n\n\`\`\`ghost\n${body}\n\`\`\`\n`;

test('source-bound general plans preserve independent same-type drivers and nested provider parameters', () => {
  const source = document();
  const plan = parseHardwareFrontMatter(source, { filename: 'farm.ghost.md' });
  assert.equal(plan.format, 'GhostFlow/hardware-plan-v1');
  assert.deepEqual(plan.source, { filename: 'farm.ghost.md', sha256: sha256Hex(source) });
  assert.deepEqual(plan.hardware, fixture());
  assert.equal(plan.hardware.bindings.inputs.current.instance, 'power');
  assert.equal(plan.hardware.bindings.inputs.ambient.instance, 'temperature');
  const address = plan.locations['/hardware/instances/power/config/address'];
  assert.equal(source.split('\n')[address.line - 1].slice(address.column - 1), '1');
  assert.ok(plan.locations['/hardware/profile'].line > 1);
  assert.equal(parseHardwareFrontMatter(source.replaceAll('\n', '\r\n')).hardware.schema, plan.hardware.schema);
  assert.notEqual(parseHardwareFrontMatter(source.replaceAll('\n', '\r\n')).source.sha256, plan.source.sha256);
});

test('compiler exposes optional plan without modifying executable bytes or source authority', () => {
  const source = document();
  const result = compileSourceSync(source, { filename: 'farm.ghost.md' });
  const plain = compileSourceSync(`\`\`\`ghost\n${code}\n\`\`\`\n`);
  assert.deepEqual(result.bytes, plain.bytes);
  assert.equal(Object.hasOwn(plain, 'hardwarePlan'), false);
  assert.equal(result.sourceDocument.text, source);
  assert.equal(result.hardwarePlan.source.sha256, result.sourceDocument.sha256);
  assert.equal(result.hardwarePlan.hardware.instances.panel.role, 'output');
});

test('ordinary front matter remains untouched', () => {
  for (const prefix of ['', '---\ntitle: Farm\n---\n', '---\n```ghost\ncontrol Hidden {}\n```\n---\n']) {
    assert.equal(parseHardwareFrontMatter(prefix + '# Prose'), null);
    assert.equal(Object.hasOwn(compileSourceSync(`${prefix}\`\`\`ghost\n${code}\n\`\`\`\n`), 'hardwarePlan'), false);
  }
});

for (const [name, mutate, pattern] of [
  ['schema', h => { h.schema = 'unknown'; }, /hardware schema/],
  ['profile digest', h => { h.profile.sha256 = 'bad'; }, /invalid hardware string/],
  ['floating revision', h => { h.modules.meter.revision = 'latest'; }, /must be pinned/],
  ['missing module', h => { h.instances.power.module = 'missing'; }, /missing hardware module/],
  ['missing instance', h => { h.bindings.inputs.current.instance = 'missing'; }, /missing hardware instance/],
  ['wrong role', h => { h.bindings.inputs.current.instance = 'panel'; }, /requires input instance/],
  ['unknown field', h => { h.instances.power.baud = 9600; }, /unknown hardware field/],
  ['duplicate channel', h => { h.bindings.inputs.ambient = { ...h.bindings.inputs.current }; }, /duplicate hardware instance\/channel/],
  ['missing bindings', h => { delete h.bindings; }, /missing hardware field bindings/],
]) test(`rejects ${name} with canonical diagnostic identity`, () => {
  const hardware = fixture(); mutate(hardware); const source = document(hardware);
  assert.throws(() => compileSourceSync(source, { filename: 'bad.ghost.md' }), error => {
    assert.match(error.message, pattern);
    assert.equal(error.diagnosticEnvelope.source.sha256, sha256Hex(source));
    assert.equal(error.diagnosticEnvelope.diagnostics[0].code, 'GF_HARDWARE');
    assert.ok(error.line > 1 && error.column > 0);
    return true;
  });
});

test('rejects duplicate YAML keys, aliases, anchors, explicit tags, merges and non-JSON scalars', () => {
  for (const [from, to] of [
    ['  schema:', '  schema: duplicate\n  schema:'],
    ['title: Farm', 'title: &title Farm'],
    ['title: Farm', 'title: *missing'],
    ['title: Farm', 'title: !!str Farm'],
    ['title: Farm', 'title: { <<: {} }'],
    ['port: 1', 'port: .inf'],
  ]) assert.throws(() => parseHardwareFrontMatter(document().replace(from, to)), /YAML|JSON-compatible/);
});

test('schema diagnostics retain exact canonical line/column across line endings', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = document().replace('schema: GhostFlow/hardware-v1', 'schema: invalid').replaceAll('\n', newline);
    const lines = source.split(newline);
    const line = lines.findIndex(value => value.includes('schema: invalid'));
    assert.throws(() => parseHardwareFrontMatter(source), error => {
      assert.equal(error.line, line + 1);
      assert.equal(error.column, lines[line].indexOf('invalid') + 1);
      assert.equal(error.diagnosticEnvelope.source.sha256, sha256Hex(source));
      return true;
    });
  }
});

test('hardware configuration nesting and identifiers are bounded', () => {
  const hardware = fixture();
  let nested = hardware.instances.power.config;
  for (let i = 0; i < 70; i++) nested = nested.child = {};
  assert.throws(() => parseHardwareFrontMatter(document(hardware)), /structure limit/);
  hardware.instances.power.config = {};
  hardware.profile.id = 'x'.repeat(257);
  assert.throws(() => parseHardwareFrontMatter(document(hardware)), /invalid hardware string/);
});

test('rejects missing logical ports and declared output as input binding', () => {
  for (const group of ['inputs', 'outputs']) {
    const hardware = fixture();
    hardware.bindings[group].missing = hardware.bindings[group][group === 'inputs' ? 'current' : 'pump'];
    delete hardware.bindings[group][group === 'inputs' ? 'current' : 'pump'];
    assert.throws(() => compileSourceSync(document(hardware)), /does not name a declared logical/);
  }
  const hardware = fixture();
  hardware.bindings.inputs.pump = hardware.bindings.inputs.current;
  delete hardware.bindings.inputs.current;
  assert.throws(() => compileSourceSync(document(hardware)), /declared logical input/);
});

test('hardware compositions fail explicitly in root and imported documents', () => {
  const child = document();
  const importLine = `import Child from "./child.ghost.md" revision "r1" sha256 "${sha256Hex(child)}";`;
  assert.throws(() => compileSourceSync(document(fixture(), `${importLine}\n${code}`)), /hardware declarations in executable import composition/);
  const root = `\`\`\`ghost\n${importLine}\ncontrol Root { output pump: Bool; instance child: Child; connect pump <- child.pump; }\n\`\`\`\n`;
  assert.throws(() => compileSourceSync(root, { filename: 'root.ghost.md', sourceClosure: [{ filename: 'child.ghost.md', revision: 'r1', text: child }] }), error => {
    assert.match(error.message, /hardware declarations in executable import composition/);
    assert.equal(error.filename, 'child.ghost.md');
    assert.equal(error.diagnosticEnvelope.source.sha256, sha256Hex(child));
    return true;
  });
});
