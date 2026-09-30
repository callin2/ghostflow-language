import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';

// Leave room for the other files in Node's test runner. Small CI runners use
// one or two fixture workers; larger development hosts never exceed four.
export const cliConcurrency = Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2)));

export function runNodeCli(args, { cwd, timeout, maxBuffer = 1024 * 1024 } = {}) {
  return new Promise(resolve => {
    execFile(process.execPath, args, { cwd, timeout, maxBuffer, encoding: 'utf8' }, (error, stdout, stderr) => {
      // A compiler rejection is a normal exit, distinct from a timeout,
      // signal, launch failure or output-limit failure.
      const normalExit = !error || (Number.isInteger(error.code) && !error.signal && !error.killed);
      resolve({
        status: normalExit ? (error?.code ?? 0) : null,
        signal: error?.signal ?? null,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        error: normalExit ? null : error.message,
      });
    });
  });
}
