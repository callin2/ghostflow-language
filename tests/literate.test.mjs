import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractLiterate, mapSourcePosition, MAX_INPUT_LINES } from '../tools/literate.mjs';

const plain = fs.readFileSync(new URL('../examples/scheduled-watering.ghost', import.meta.url), 'utf8');
const literate = fs.readFileSync(new URL('../examples/scheduled-watering.ghost.md', import.meta.url), 'utf8');
const extracted = extractLiterate(literate, { filename: 'scheduled-watering.ghost.md' });

assert.equal(extracted.code, plain);
assert.equal(extracted.warnings.length, 0);
const mapped = extractLiterate([
  '```ghost',
  'control Demo {',
  '  output pump: Bool;',
  '  require pump => ;',
  '}',
  '```',
].join('\n'), { filename: 'error.ghost.md' });
assert.deepEqual(mapSourcePosition(mapped.sourceMap, 3, 19), {
  file: 'error.ghost.md',
  line: 4,
  column: 19,
});

const document = [
  '```ghost',
  'control Demo {',
  '  output pump: Bool;',
  '  require pump => ;',
  '}',
  '```',
  '',
  '- ```ghost',
  '  control Listed { }',
  '  ```',
  '',
  '> ```ghost',
  '> control Quoted { }',
  '> ```',
  '',
  '````markdown',
  '```ghost',
  'control Outer { }',
  '```',
  '````',
].join('\n') + '\n';
const result = extractLiterate(document, { filename: 'nested.md' });
assert.match(result.code, /control Demo/);
assert.doesNotMatch(result.code, /Listed|Quoted|Outer/);
assert.ok(result.warnings.some((warning) => warning.includes('item')));
assert.ok(result.warnings.some((warning) => warning.includes('block_quote')));

const errorPosition = mapSourcePosition(result.sourceMap, 3, 19);
assert.deepEqual(errorPosition, { file: 'nested.md', line: 4, column: 19 });
assert.equal(mapSourcePosition(result.sourceMap, 2, 100), null);

assert.throws(() => extractLiterate([
  '```ghost title=demo',
  'control Unsupported { }',
  '```',
  '',
  '~~~ghost-python',
  'control Unknown { }',
  '~~~',
  '',
  '```ghost',
  'control Unclosed { }',
].join('\n')), /attributes/);
assert.throws(() => extractLiterate('~~~ghost-python\ncontrol Unknown {}\n~~~'), /unknown ghost tag/);
assert.throws(() => extractLiterate('```ghost\ncontrol Unclosed {}'), /unclosed ghost fence/);

assert.throws(() => extractLiterate('```ghost\n```\n'), /no executable/);

const hidden = extractLiterate('---\n```ghost\ncontrol FrontMatter {}\n```\n---\n\n<!--\n```ghost\ncontrol Comment {}\n```\n-->\n\n<script>\n```ghost\ncontrol Html {}\n```\n</script>\n\n```ghost\ncontrol Real {}\n```');
assert.equal(hidden.code, 'control Real {}\n');
const indented = extractLiterate('   ~~~ghost\n    control Indented {}\n   ~~~\n');
assert.equal(indented.code, '    control Indented {}\n');
const serializedMap = JSON.parse(JSON.stringify(mapped.sourceMap));
assert.deepEqual(mapSourcePosition(serializedMap, 3, 19), {file:'error.ghost.md',line:4,column:19});

assert.throws(
  () => extractLiterate(Array(MAX_INPUT_LINES + 1).fill('x').join('\n')),
  RangeError,
);

console.log('literate tests passed');
