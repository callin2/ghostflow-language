import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {chmod, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {proofOutcome, verify} from '../experiments/elapsed-clock-bounds/verify.mjs';

test('clock proof infrastructure failure replaces a previous success before probing Lean', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clock-bounds-receipt-'));
  try {
    const path = join(directory, 'verification.json');
    await writeFile(path, JSON.stringify({status: 'passed', results: [{passed: true}]}));
    const report = await verify({lean: join(directory, 'missing-lean'), evidenceDir: directory});
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(receipt.status, 'failed');
    assert.deepEqual(receipt.results, []);
    assert.ok(receipt.startedAt);
    assert.ok(receipt.finishedAt);
    assert.match(receipt.error.message, /Lean version probe failed/);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('external version probe observes running receipt and cannot preserve stale success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clock-bounds-version-'));
  try {
    const path = join(directory, 'verification.json'), marker = join(directory, 'observed-status');
    const probe = join(directory, 'version-failure-probe');
    await writeFile(path, JSON.stringify({status: 'passed', results: [{passed: true}]}));
    await writeFile(probe, `#!/usr/bin/env node\nconst fs=require('node:fs');\nfs.writeFileSync(${JSON.stringify(marker)},JSON.parse(fs.readFileSync(${JSON.stringify(path)},'utf8')).status);\nprocess.exit(1);\n`);
    await chmod(probe, 0o700);
    const result = spawnSync(process.execPath, [resolve('experiments/elapsed-clock-bounds/verify.mjs'),
      '--lean', probe, '--evidence-dir', directory], {encoding: 'utf8', timeout: 30000});
    assert.equal(result.status, 1);
    assert.equal(result.signal, null);
    assert.equal(result.error, undefined);
    assert.equal(await readFile(marker, 'utf8'), 'running');
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(receipt.status, 'failed');
    assert.deepEqual(receipt.results, []);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('targeted proposition rejection refuses timeout, foreign errors and proof escapes', () => {
  const intended = "case.lean:17:40: error: tactic 'decide' proved that the proposition\n  False\nis false";
  const failure = {status: 1, signal: null};
  assert.equal(proofOutcome(failure, intended, false, 17), true);
  assert.equal(proofOutcome({...failure, signal: 'SIGTERM'}, intended, false, 17), false);
  assert.equal(proofOutcome({...failure, error: new Error('ETIMEDOUT')}, intended, false, 17), false);
  assert.equal(proofOutcome(failure, intended.replace(':17:', ':16:'), false, 17), false);
  assert.equal(proofOutcome(failure, `${intended}\ncase.lean:8:2: error: unknown identifier`, false, 17), false);
  assert.equal(proofOutcome(failure, `${intended}\ndeclaration uses 'sorry'`, false, 17), false);
  assert.equal(proofOutcome({status: 0, signal: null}, intended, false, 17), false);
});
