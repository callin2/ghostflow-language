import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';

// Structural wire integration. This suite does not claim schedule execution:
// valid modules must reach the explicit missing-runtime-bindings rejection.
const nativePath = fileURLToPath(new URL('../target/release/examples/run', import.meta.url));
const solar = (when = 'true') => `(solar-pulse 1 dawn Asia/Seoul 37.5665 126.978 rise -86400000 pulse trusted_only 60000 baseline skip ${when})`;
const window = (payload = '1') => `(window 2 mean average number 1000 500 (roots 1) (source true ${payload} 0 0 1 1))`;
function encode(entries, withRoot = false) {
  return compile(parse(tokenize(`(module ScheduleWire
    (input __gf_now_ms number) (input __gf_time_epoch number)
    ${withRoot ? '(input present bool) (input epoch number) (input id number) (input timestamp number)' : ''}
    (temporal-context __gf_now_ms __gf_time_epoch)
    ${withRoot ? '(temporal-root 1 probe present epoch id timestamp)' : ''}
    (strategy main 0 (device true) ${entries}
      (intent due (schedule-read 0 due))))`)));
}

function native(t, bytes) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-schedule-wire-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'schedule.gfb');
  const inputPath = path.join(directory, 'inputs.csv');
  fs.writeFileSync(modulePath, bytes);
  fs.writeFileSync(inputPath, '__gf_now_ms,__gf_time_epoch\n0,7\n');
  return execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' })
    .trim().split('\n').map(line => JSON.parse(line));
}

for (const [label, entries, withRoot] of [
  ['schedule-only with no physical roots', solar(), false],
  ['window before its schedule predicate', `${window()} ${solar('(window-read 0 ok)')}`, true],
  ['schedule before its window consumer', `${solar()} ${window('(if (schedule-read 0 due) 1 0)')}`, true],
]) test(`GFB5 JS→native loader: ${label}`, t => {
  const bytes = encode(entries, withRoot);
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(4, true), 5);
  assert.deepEqual(native(t, bytes), [{
    status: 'ERROR', phase: 'activate',
    error: 'schedule activation requires runtime bindings', journalLength: 0,
  }]);
});

test('GFB5 JS→native loader rejects truncation before activation', t => {
  const bytes = encode(solar());
  assert.deepEqual(native(t, bytes.subarray(0, bytes.length - 1)), [{
    status: 'ERROR', phase: 'load', error: 'truncated bytecode', journalLength: 0,
  }]);
});
