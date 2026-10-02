import assert from 'node:assert/strict';
import test from 'node:test';
import { runNodeCli } from './helpers/cli-process.mjs';

test('async CLI preserves rejection exit and separate output streams', async () => {
  const result = await runNodeCli(['-e', 'process.stdout.write("out"); process.stderr.write("diagnostic\\n"); process.exitCode = 1;']);
  assert.deepEqual(result, { status: 1, signal: null, stdout: 'out', stderr: 'diagnostic\n', error: null });
});

test('async CLI captures successful output through process exit', async () => {
  const result = await runNodeCli(['-e', 'setTimeout(() => process.stdout.write("complete"), 10);']);
  assert.deepEqual(result, { status: 0, signal: null, stdout: 'complete', stderr: '', error: null });
});

test('async CLI treats timeout and output overflow as infrastructure failures', async () => {
  const timeout = await runNodeCli(['-e', 'setInterval(() => {}, 1000);'], { timeout: 1000 });
  assert.equal(timeout.status, null);
  assert.ok(timeout.error);
  const overflow = await runNodeCli(['-e', 'process.stdout.write("x".repeat(4096));'], { maxBuffer: 128 });
  assert.equal(overflow.status, null);
  assert.match(overflow.error, /maxBuffer/);
});
