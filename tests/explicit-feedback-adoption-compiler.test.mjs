import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractLiterate } from '../tools/literate.mjs';
import { compileSourceSync } from '../tools/compile-source.mjs';

test('authored feedback policy compiles from its canonical document and matching reading translation', () => {
  const filename = 'examples/explicit-feedback-adoption.ghost.md';
  const source = fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
  const translation = fs.readFileSync(new URL('../examples/explicit-feedback-adoption.ghost.ko.md', import.meta.url), 'utf8');
  assert.equal(extractLiterate(source).code, extractLiterate(translation).code);
  const artifact = compileSourceSync(source, { filename });
  assert.equal(artifact.manifest.sensors[0].name, 'observation');
  assert.notEqual(artifact.manifest.sensors[0].optional, true);
  assert.deepEqual(artifact.manifest.timers, [{ name: 'age', state: 'run', clockInput: '__gf_now_ms' }]);
  assert.deepEqual(artifact.manifest.outputs, [{ name: 'drive', type: 'Bool' }]);
});
