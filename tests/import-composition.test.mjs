import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { parseControl } from '../tools/control.mjs';

const document = code => `# Composition\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const pin = `import Relay from "./relay.ghost.md" revision "relay-r1" sha256 "${'a'.repeat(64)}";`;
const compile = code => compileSource(document(code), { filename: 'composition.ghost.md' });

test('parameter defaults compile as typed immutable values, independently of operator settings', async () => {
  const result = await compile('control Relay { parameter enabled: Bool = true; output pump: Bool; pump <- enabled; }');
  assert.deepEqual(result.manifest.parameters, [{ name: 'enabled', type: 'Bool', value: true }]);
  assert.deepEqual(result.manifest.configs, []);
  const literal = await compile('control Relay { output pump: Bool; pump <- true; }');
  assert.deepEqual(result.bytes, literal.bytes);
  assert.equal(result.sourceDocument.text, document('control Relay { parameter enabled: Bool = true; output pump: Bool; pump <- enabled; }'));
});

test('parameter defaults resolve independently of declaration order', async () => {
  const result = await compile('control Relay { output pump: Bool; parameter ready: Bool = enabled; parameter enabled: Bool = true; pump <- ready; }');
  assert.equal(result.manifest.parameters.find(item => item.name === 'ready').value, true);
});

for (const [label, body, message] of [
  ['wrong type', 'parameter enabled: Bool = 1;', /parameter default must be a constant of the declared type/],
  ['dynamic value', 'input start: Bool; parameter enabled: Bool = start;', /parameter default.*constant/],
  ['mutable setting', 'config setting: Bool = true; parameter enabled: Bool = setting;', /parameter default.*constant/],
  ['setting collision', 'parameter enabled: Bool = true; config enabled: Bool = true;', /duplicate.*enabled/],
  ['cycle', 'parameter left: Bool = right; parameter right: Bool = left;', /cyclic parameter/],
]) test(`parameter rejects ${label}`, async () => {
  await assert.rejects(() => compile(`control Relay { ${body} }`), message);
});

test('pinned composition AST preserves named specialization and endpoint source positions', () => {
  const code = `${pin}\ncontrol Farm {\n input start: Bool; output pump: Bool;\n instance east: Relay(duration = 10min, enabled = true);\n connect east.start <- start;\n connect pump <- east.pump;\n}`;
  const ast = parseControl(code, { filename: 'composition.ghost.md' });
  const instance = ast.body.find(item => item.kind === 'instance');
  assert.equal(instance.name, 'east');
  assert.equal(instance.alias, 'Relay');
  assert.deepEqual(instance.arguments.map(item => item.name), ['duration', 'enabled']);
  assert.equal(instance.arguments[0].value.raw, '10min');
  const connections = ast.body.filter(item => item.kind === 'connect');
  assert.deepEqual(connections.map(item => [item.sink.path, item.source.path]), [['east.start', 'start'], ['pump', 'east.pump']]);
  assert.equal(connections[0].sink.loc.line, 5);
  assert.ok(ast.sourceNodes.some(item => item.kind === 'instance' && item.id === instance.id));
});

for (const [label, body, message] of [
  ['duplicate input supplier', 'instance east: Relay; connect east.start <- start; connect east.start <- start;', /duplicate supplier for port east.start/],
  ['connect and expression writer', 'instance east: Relay; connect pump <- east.pump; pump <- false;', /duplicate supplier for output pump/],
  ['expression and connect writer', 'instance east: Relay; pump <- false; connect pump <- east.pump;', /duplicate supplier for port pump/],
  ['unknown import alias', 'instance east: Unknown;', /unknown import alias Unknown/],
  ['unknown instance', 'connect missing.start <- start;', /unknown instance missing/],
  ['root input as sink', 'instance east: Relay; connect start <- east.pump;', /connect sink must be an instance input or root output/],
  ['root output as source', 'instance east: Relay; connect east.start <- pump;', /connect source must be a root input, root sensor or instance output/],
  ['duplicate specialization', 'instance east: Relay(duration = 5min, duration = 10min);', /duplicate instance argument duration/],
  ['positional specialization', 'instance east: Relay(10min);', /expected named instance argument/],
  ['instance declaration collision', 'instance start: Relay;', /duplicate declaration start/],
  ['output expression in connect', 'instance east: Relay; connect pump <- east.pump && start;', /expected ; after port connection/],
]) test(`composition rejects ${label}`, async () => {
  await assert.rejects(() => compile(`${pin}\ncontrol Farm { input start: Bool; output pump: Bool; ${body} }`), message);
});

test('valid local composition remains unavailable without verified imported port contracts', async () => {
  await assert.rejects(() => compile(`${pin}\ncontrol Farm { input start: Bool; output pump: Bool; instance east: Relay; connect east.start <- start; connect pump <- east.pump; }`),
    /import execution requires a verified source closure and composition lowering/);
});

test('duplicate supplier diagnostic retains the second authored literate endpoint', async () => {
  await assert.rejects(() => compile(`${pin}\ncontrol Farm {\n input start: Bool;\n instance east: Relay;\n connect east.start <- start;\n connect east.start <- start;\n}`), error => {
    assert.equal(error.name, 'ControlCompileError');
    assert.equal(error.line, 9);
    assert.equal(error.column, 10);
    assert.match(error.message, /duplicate supplier for port east.start/);
    return true;
  });
});
