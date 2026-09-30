import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { extractLiterate } from '../tools/literate.mjs';

const filename = 'examples/optional-feedback-timer.ghost.md';

test('optional observation timer example compiles from one canonical source', () => {
  const source = fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
  const translation = fs.readFileSync(new URL('../examples/optional-feedback-timer.ghost.ko.md', import.meta.url), 'utf8');
  assert.equal(extractLiterate(source).code, extractLiterate(translation).code);
  const artifact = compileSourceSync(source, { filename });
  assert.deepEqual(artifact.manifest.outputs, [{ name: 'drive', type: 'Bool' }]);
  assert.deepEqual(artifact.manifest.timers, [{ name: 'age', state: 'run', clockInput: '__gf_now_ms' }]);
  assert.equal(artifact.manifest.sensors[0].name, 'observation');
  assert.equal(artifact.manifest.strategies.length, 2);
});
