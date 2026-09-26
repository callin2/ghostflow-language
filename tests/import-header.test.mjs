import assert from 'node:assert/strict';
import test from 'node:test';
import { parseControl } from '../tools/control.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const digest = '0123456789abcdef'.repeat(4);
const pin = `import Relay from "./relay.ghost.md" revision "relay-r1" sha256 "${digest}";`;
const control = 'control Farm { output pump: Bool; pump <- false; }';
const filename = 'import-header.ghost.md';
const document = code => `# Imports\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;

test('pinned import AST retains exact locator, revision, digest and source positions', () => {
  const ast = parseControl(`${pin}\n${control}`, { filename });
  assert.equal(ast.imports.length, 1);
  const entry = ast.imports[0];
  assert.equal(entry.kind, 'import');
  assert.equal(entry.name, 'Relay');
  assert.equal(entry.locator, './relay.ghost.md');
  assert.equal(entry.revision, 'relay-r1');
  assert.equal(entry.sha256, digest);
  assert.equal(entry.loc.line, 1); assert.equal(entry.loc.column, 1);
  assert.equal(entry.locatorLoc.column, pin.indexOf('"./relay') + 1);
  assert.equal(entry.revisionLoc.column, pin.indexOf('"relay-r1"') + 1);
  assert.equal(entry.digestLoc.column, pin.indexOf(`"${digest}"`) + 1);
  assert.ok(ast.sourceNodes.some(node => node.id === entry.id && node.kind === 'import'));
});

test('valid import remains explicitly unavailable to public executable compilation', async () => {
  await assert.rejects(() => compileSource(document(`${pin}\n${control}`), { filename }), {
    name: 'ControlCompileError', filename, line: 4, column: 1,
    message: `${filename}:4:1: import execution requires a verified source closure and composition lowering, which are not yet supported`,
  });
});

for (const [label, declaration, marker, message] of [
  ['missing revision', pin.replace('revision "relay-r1" ', ''), 'sha256', 'import requires an immutable revision'],
  ['missing digest', pin.replace(`sha256 "${digest}"`, ''), ';', 'import requires a SHA-256 digest'],
  ['short digest', pin.replace(digest, 'abc'), '"abc"', 'import sha256 must be a lowercase 64-character hex digest'],
  ['invalid digest', pin.replace(digest, 'g'.repeat(64)), `"${'g'.repeat(64)}"`, 'import sha256 must be a lowercase 64-character hex digest'],
  ['empty revision', pin.replace('"relay-r1"', '""'), '""', 'import revision must be a non-empty immutable revision'],
  ['latest revision', pin.replace('"relay-r1"', '"latest"'), '"latest"', 'import revision cannot be latest'],
  ['raw source locator', pin.replace('./relay.ghost.md', './relay.ghost'), '"./relay.ghost"', 'import locator must name a relative canonical .ghost.md document'],
  ['absolute locator', pin.replace('./relay.ghost.md', '/relay.ghost.md'), '"/relay.ghost.md"', 'import locator must name a relative canonical .ghost.md document'],
  ['network locator', pin.replace('./relay.ghost.md', 'https://example.invalid/relay.ghost.md'), '"https:', 'import locator must name a relative canonical .ghost.md document'],
  ['missing from', pin.replace(' from ', ' '), '"./relay', 'expected from after import alias'],
]) test(`import diagnoses ${label} at the authored token`, async () => {
  const column = declaration.indexOf(marker) + 1;
  assert.ok(column > 0);
  await assert.rejects(() => compileSource(document(`${declaration}\n${control}`), { filename }), {
    name: 'ControlCompileError', filename, line: 4, column,
    message: `${filename}:4:${column}: ${message}`,
  });
});

test('duplicate import aliases are rejected at the second alias', async () => {
  await assert.rejects(() => compileSource(document(`${pin}\n${pin}\n${control}`), { filename }), {
    name: 'ControlCompileError', filename, line: 5, column: 8,
    message: `${filename}:5:8: duplicate import alias Relay`,
  });
});

test('relative parent locators and separate aliases preserve independent pinned identities', () => {
  const other = pin.replace('Relay from', 'Other from').replace('./relay', '../shared/relay').replace('relay-r1', 'relay-r2');
  const ast = parseControl(`${pin}\n${other}\n${control}`, { filename });
  assert.deepEqual(ast.imports.map(({ name, locator, revision }) => ({ name, locator, revision })), [
    { name: 'Relay', locator: './relay.ghost.md', revision: 'relay-r1' },
    { name: 'Other', locator: '../shared/relay.ghost.md', revision: 'relay-r2' },
  ]);
});
