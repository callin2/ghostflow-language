import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { TextEncoder } from 'node:util';
import vm from 'node:vm';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';

const source = `(module browser_portable
  (input start bool)
  (state running bool false)
  (strategy basic 0
    (device true)
    (next running input.start)
    (intent pump state.running)))`;

test('GFB1 compiles in a browser-like VM realm without Buffer', () => {
  const modulePath = new URL('../tools/gfb1.mjs', import.meta.url);
  const moduleSource = fs.readFileSync(modulePath, 'utf8').replace(
    'export { tokenize, parse, compile, CompileError };',
    'globalThis.__gfb1 = { tokenize, parse, compile, CompileError };',
  );
  const context = vm.createContext({ TextEncoder, Uint8Array, DataView, Map, Set, Array, Object, JSON, Number, String, RegExp, Error });
  vm.runInContext(moduleSource, context, { filename: modulePath.pathname });
  assert.equal(vm.runInContext('typeof Buffer', context), 'undefined');
  const browserBytes = vm.runInContext(`__gfb1.compile(__gfb1.parse(__gfb1.tokenize(${JSON.stringify(source)})))`, context);
  const nodeBytes = compile(parse(tokenize(source)));
  assert.equal(browserBytes.constructor.name, 'Uint8Array');
  assert.equal(Buffer.isBuffer(browserBytes), false);
  assert.equal(Buffer.isBuffer(nodeBytes), true);
  assert.deepEqual(Buffer.from(browserBytes), nodeBytes);
  assert.deepEqual(Buffer.from(browserBytes.subarray(0, 4)), Buffer.from('GFB1'));
});
