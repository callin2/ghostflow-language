import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile, parse, tokenize, CompileError } from '../tools/ghostc.mjs';

const source = fs.readFileSync(new URL('../examples/irrigation.ghost', import.meta.url), 'utf8');
const binary = compile(parse(tokenize(source)));
assert.equal(binary.subarray(0, 4).toString(), 'GFB1');
assert.ok(binary.length < 4096, `example bytecode is unexpectedly large: ${binary.length}`);

assert.throws(() => compile(parse(tokenize(`
  (module broken
    (input x bool)
    (state y bool false)
    (strategy only 0
      (device (has sensor x bool))
      (next y input.missing)))
`))), CompileError);

assert.throws(() => compile(parse(tokenize(`
  (module unsafe
    (input x bool)
    (state y bool false)
    (strategy a 0 (device (has actuator pump bool)) (intent pump true))
    (strategy b 1 (device (has sensor x bool)) (intent valve true))
    (requires pump valve))
`))), CompileError);

assert.throws(() => compile(parse(tokenize(`
  (module broken
    (input x number)
    (state y bool false)
    (strategy only 0
      (device (has sensor x number))
      (next y input.x)))
`))), CompileError);

console.log(`compiler tests passed (${binary.length} byte module)`);
