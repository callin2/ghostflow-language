import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { TextEncoder } from 'node:util';
import vm from 'node:vm';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';

const offsets = [-86400000, 0, 86400000];

function sourceFor(offset) {
  return `(module browser_schedule
  (input __gf_now_ms number)
  (input __gf_time_epoch number)
  (temporal-context __gf_now_ms __gf_time_epoch)
  (strategy basic 0
    (device true)
    (solar-pulse 1 dawn Asia/Seoul 37.5665 126.978 rise ${offset} pulse trusted_only 60000 baseline skip true)
    (intent due (schedule-read 0 due))))`;
}

function browserCompile(source) {
  const modulePath = new URL('../tools/gfb1.mjs', import.meta.url);
  const irSource = fs.readFileSync(new URL('../tools/core-ir.mjs', import.meta.url), 'utf8')
    .replace('export class CompileError', 'class CompileError')
    .replace('export function lowerExpression', 'function lowerExpression');
  const moduleSource = fs.readFileSync(modulePath, 'utf8')
    .replace("import { CompileError, lowerExpression } from './core-ir.mjs';", '')
    .replace(
    'export { tokenize, parse, compile, CompileError };',
    'globalThis.__gfb1 = { tokenize, parse, compile };',
  );
  const context = vm.createContext({ TextEncoder, Uint8Array, DataView, Map, Set, Array, Object, JSON, Number, String, RegExp, Error, BigInt });
  vm.runInContext(`${irSource}\n${moduleSource}`, context, { filename: modulePath.pathname });
  assert.equal(vm.runInContext('typeof Buffer', context), 'undefined');
  return vm.runInContext(`__gfb1.compile(__gfb1.parse(__gfb1.tokenize(${JSON.stringify(source)})))`, context);
}

for (const offset of offsets) {
  test(`GFB5 solar schedule offset ${offset} is byte-identical in Node and Buffer-less browser VM`, () => {
    const source = sourceFor(offset);
    const nodeBytes = compile(parse(tokenize(source)));
    const browserBytes = browserCompile(source);
    assert.equal(nodeBytes.constructor.name, 'Uint8Array');
    assert.equal(browserBytes.constructor.name, 'Uint8Array');
    assert.equal(Buffer.isBuffer(browserBytes), false);
    assert.deepEqual(browserBytes, nodeBytes);
    assert.equal(new DataView(nodeBytes.buffer, nodeBytes.byteOffset, nodeBytes.byteLength).getUint16(4, true), 5);
  });
}
