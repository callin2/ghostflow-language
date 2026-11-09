import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectSourceChanges } from '../tools/source-changes.mjs';

const cli = fileURLToPath(new URL('../tools/ghostdiff.mjs', import.meta.url));
const document = '# Pump\n\n```ghost\ncontrol Pump {\n config duration: Duration = 5s { min = 1s; max = 30s; step = 1s; access = operator; }\n input start: Bool;\n output pump: Bool;\n pump <- start |> recover(false);\n}\n```\n';
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

function files(t, after = document.replace('= 5s', '= 8s')) {
  const dir = mkdtempSync(join(tmpdir(), 'ghostdiff-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const beforePath = join(dir, 'before.ghost.md'), afterPath = join(dir, 'after.ghost.md');
  writeFileSync(beforePath, document); writeFileSync(afterPath, after);
  return { beforePath, afterPath };
}

test('no parameters and --help describe the same safe read-only command', () => {
  for (const args of [[], ['--help']]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /before\.ghost\.md.*after\.ghost\.md/);
    assert.match(result.stdout, /--json/);
    assert.match(result.stdout, /읽기 전용/);
  }
});

test('CLI JSON has exactly the shared comparison result and never edits input files', t => {
  const after = document.replace('= 5s', '= 8s');
  const { beforePath, afterPath } = files(t, after);
  const result = run(['--json', beforePath, afterPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), inspectSourceChanges(document, after));
  assert.equal(readFileSync(beforePath, 'utf8'), document);
  assert.equal(readFileSync(afterPath, 'utf8'), after);
});

test('readable output always reports each of the five categories', t => {
  const { beforePath, afterPath } = files(t);
  const result = run([beforePath, afterPath]);
  assert.equal(result.status, 0, result.stderr);
  for (const label of ['설정 기본값', '설정 정의', '제어 규칙', '논리 입력·출력', '장치·배선']) assert.ok(result.stdout.includes(label), label);
  assert.match(result.stdout, /duration/);
  assert.match(result.stdout, /설정 기본값: 1/);
  assert.match(result.stdout, /장치·배선: 0/);
});

test('identical input reports zero changes and succeeds', t => {
  const { beforePath, afterPath } = files(t, document);
  const result = run(['--json', beforePath, afterPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).changes, []);
});

test('invalid syntax, missing file and invalid UTF-8 are errors, never no-change reports', t => {
  const { beforePath, afterPath } = files(t, '```ghost\ncontrol Bad { let x = ; }\n```');
  for (const path of [afterPath, afterPath + '.missing']) {
    const result = run(['--json', beforePath, path]);
    assert.equal(result.status, 2);
    const error = JSON.parse(result.stdout);
    assert.equal(error.ok, false);
    assert.equal(error.format, 'GhostFlow/source-changes-error-v1');
    assert.equal(Object.hasOwn(error, 'changes'), false);
    assert.ok(error.message);
  }
  writeFileSync(afterPath, Buffer.from([0xff]));
  const result = run([beforePath, afterPath]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /UTF-8/);
});

test('missing arguments and unknown options cannot be mistaken for a completed check', t => {
  const { beforePath, afterPath } = files(t);
  for (const args of [[beforePath], ['--unknown', beforePath, afterPath], ['--json']]) {
    const result = run(args);
    assert.equal(result.status, 2, JSON.stringify(args));
  }
});
