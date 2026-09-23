import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';

const nativePath = fileURLToPath(new URL('../target/release/examples/run', import.meta.url));
const encode = () => compile(parse(tokenize(`(module Certified
  (input __gf_now_ms number) (input __gf_time_epoch number)
  (input present bool) (input epoch number) (input id number)
  (input start number) (input end number) (input value bool)
  (input quality number) (input fault number)
  (temporal-context __gf_now_ms __gf_time_epoch)
  (strategy control 0 (device true)
    (true-for 17 sustained 7 hot 300000 (interval-inputs present epoch id start end value quality fault))
    (intent alarm (if (true-for-read 0 ok) (true-for-read 0 value) false))))`)));
function native(t, bytes) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-certified-wire-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'certified.gfb');
  const inputPath = path.join(directory, 'inputs.csv');
  fs.writeFileSync(modulePath, bytes);
  fs.writeFileSync(inputPath, '__gf_now_ms,__gf_time_epoch,present,epoch,id,start,end,value,quality,fault\n0,7,false,11,0,0,0,false,1,0\n');
  return execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
}
test('GFB6 JS writer and Rust loader agree, with execution still explicitly unavailable', t => {
  assert.deepEqual(native(t, encode()), [{ status: 'ERROR', phase: 'activate',
    error: 'true_for activation requires runtime bindings', journalLength: 0 }]);
});
test('GFB6 Rust loader rejects corrupted certified binding before activation', t => {
  const bytes = Buffer.from(encode());
  const marker = Buffer.concat([Buffer.from([2, 17, 0, 0, 0, 9, 0]), Buffer.from('sustained')]);
  const prelude = bytes.indexOf(marker);
  assert.notEqual(prelude, -1);
  const bindings = prelude + 1 + 4 + 2 + 9 + 4 + 2 + 3 + 8;
  bytes.writeUInt16LE(0, bindings + 2); // source epoch aliases the VM clock
  assert.deepEqual(native(t, bytes), [{ status: 'ERROR', phase: 'load',
    error: 'duplicate certified interval input binding', journalLength: 0 }]);
});
