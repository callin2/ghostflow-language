import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { TextEncoder } from 'node:util';
import vm from 'node:vm';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';

const MAX = 9007199254740991n;
const source = `(module browser_window
  (input __gf_now_ms number)
  (input __gf_time_epoch number)
  (input present bool)
  (input epoch number)
  (input id number)
  (input timestamp number)
  (temporal-context __gf_now_ms __gf_time_epoch)
  (temporal-root 1 temperature present epoch id timestamp)
  (strategy basic 0
    (device true)
    (window 1 average_window average number ${MAX} ${MAX} (roots 1) (source true 1 0 0 1 1))
    (intent result (window-read 0 value))))`;

function browserCompile() {
  const modulePath = new URL('../tools/gfb1.mjs', import.meta.url);
  const irSource = fs.readFileSync(new URL('../tools/core-ir.mjs', import.meta.url), 'utf8')
    .replace('export class CompileError', 'class CompileError')
    .replace('export function lowerExpression', 'function lowerExpression');
  const moduleSource = fs.readFileSync(modulePath, 'utf8')
    .replace("import { CompileError, lowerExpression } from './core-ir.mjs';", '')
    .replace(
    'export { tokenize, parse, compile, CompileError, lowerCoreModule, emitGfb };',
    'globalThis.__gfb1 = { tokenize, parse, compile };',
  );
  const context = vm.createContext({ TextEncoder, Uint8Array, DataView, Map, Set, Array, Object, JSON, Number, String, RegExp, Error, BigInt });
  vm.runInContext(`${irSource}\n${moduleSource}`, context, { filename: modulePath.pathname });
  assert.equal(vm.runInContext('typeof Buffer', context), 'undefined');
  return vm.runInContext(`__gfb1.compile(__gfb1.parse(__gfb1.tokenize(${JSON.stringify(source)})))`, context);
}

function readWindowDurations(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 6;
  const string = () => { const length = view.getUint16(at, true); at += 2 + length; };
  string(); at += 4;
  const inputs = view.getUint16(at, true); at += 2;
  for (let index = 0; index < inputs; index += 1) { string(); at += 1; }
  assert.equal(view.getUint16(at, true), 0); at += 2;
  at += 6;
  at += 4; string(); at += 8;
  assert.equal(view.getUint16(at, true), 1); at += 2;
  string(); at += 4;
  const queryLength = view.getUint32(at, true); at += 4 + queryLength;
  assert.equal(view.getUint16(at, true), 1); at += 2 + 4;
  string(); at += 2;
  return [view.getBigUint64(at, true), view.getBigUint64(at + 8, true)];
}

test('GFB4 temporal window encoding is byte-identical in Node and Buffer-less browser VM', () => {
  const nodeBytes = compile(parse(tokenize(source)));
  const browserBytes = browserCompile();
  assert.equal(nodeBytes.constructor.name, 'Uint8Array');
  assert.equal(browserBytes.constructor.name, 'Uint8Array');
  assert.equal(Buffer.isBuffer(browserBytes), false);
  assert.deepEqual(browserBytes, nodeBytes);
  assert.equal(new DataView(nodeBytes.buffer, nodeBytes.byteOffset, nodeBytes.byteLength).getUint16(4, true), 4);
  assert.deepEqual(readWindowDurations(nodeBytes), [MAX, MAX]);
  assert.deepEqual(readWindowDurations(browserBytes), [MAX, MAX]);
});
