import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileControl, ControlCompileError } from '../tools/control.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const filename = 'examples/irrigation.ghost.md';
const source = fs.readFileSync(new URL('../examples/irrigation.ghost.md', import.meta.url), 'utf8');
const compilation = await compileSource(source, { filename });
assert.equal(compilation.bytes.subarray(0, 4).toString(), 'GFB1');
assert.ok(compilation.bytes.length < 4096, `example bytecode is unexpectedly large: ${compilation.bytes.length}`);

test('prior compiler fixture excerpts remain pinned historical evidence', () => {
  const bytes = fs.readFileSync(new URL('./fixtures/history/compiler-fixtures-before-input-531.json', import.meta.url));
  const digest = value => createHash('sha256').update(value).digest('hex');
  assert.equal(digest(bytes), 'ccead3a6a5b5d64b03e11c8dcb50ed9943ae8f8d2ab677e63dcb111d86e65692');
  const snapshot = JSON.parse(bytes);
  assert.equal(snapshot.base, 'c8a5d37');
  for (const file of snapshot.files) for (const excerpt of file.excerpts) {
    assert.equal(digest(excerpt.source), excerpt.sha256, `${file.path}:${excerpt.startLine}`);
  }
});

await assert.rejects(
  () => compileSource('control Broken { output pump: Bool; pump <- missing; }', { filename: 'broken.ghost' }),
  /requires a canonical .ghost.md literate source/,
);

console.log(`compiler tests passed (${compilation.bytes.length} byte module)`);

for (const declaration of ['input x: Bool = false;', 'input x, y: Bool = true;', 'input count: Int = 1 + 2;']) {
  test(`rejects input initializer at its equals token: ${declaration}`, () => {
    assert.throws(() => compileControl(`control InputInitializer {\n  ${declaration}\n  output ready: Bool; ready <- true;\n}`, { filename: 'input.ghost' }), error => {
      assert.ok(error instanceof ControlCompileError);
      assert.equal(error.filename, 'input.ghost');
      assert.equal(error.line, 2);
      assert.equal(error.column, declaration.indexOf('=') + 3);
      assert.match(error.message, /input declarations are type-only; the host supplies typed quality samples/);
      return true;
    });
  });
}

for (const eol of ['\n', '\r\n']) {
  test(`input initializer diagnostic maps to canonical Markdown (${JSON.stringify(eol)})`, async () => {
    const source = [
      '# Host inputs', '', '```ghost', 'control InputInitializer {', '```', '',
      'Inputs come from the host.', '', '```ghost', '  input x: Bool = false;',
      '  output ready: Bool; ready <- x;', '}', '```', '',
    ].join(eol);
    await assert.rejects(() => compileSource(source, { filename: 'input.ghost.md' }), error => {
      assert.ok(error instanceof ControlCompileError);
      assert.equal(error.filename, 'input.ghost.md');
      assert.equal(error.line, 10);
      assert.equal(error.column, 17);
      assert.match(error.message, /input declarations are type-only; the host supplies typed quality samples/);
      return true;
    });
  });
}

test('canonical host inputs remain type-only alongside initialized state and connected outputs', async () => {
  const source = ['# Host inputs', '', '```ghost', 'control Valid {',
    '  input x, y: Bool;', '  state active: Bool = false;', "  active' = (x |> recover(false)) && (y |> recover(false));",
    '  output ready: Bool;', "  ready <- active';", '}', '```', '',
  ].join('\n');
  const result = await compileSource(source, { filename: 'valid-input.ghost.md' });
  assert.deepEqual(result.manifest.inputs, []);
  assert.deepEqual(result.manifest.sensors.map(({ name, type }) => ({ name, type })), [{ name: 'x', type: 'Bool' }, { name: 'y', type: 'Bool' }]);
  assert.deepEqual(result.manifest.outputs, [{ name: 'ready', type: 'Bool' }]);
  assert.equal(result.bytes.subarray(0, 4).toString(), 'GFB1');
  assert.throws(() => compileControl('control OutputInitializer { output ready: Bool = false; }'),
    /output declarations are type-only; connect each output/);
});
