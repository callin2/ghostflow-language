import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, writeFile, mkdtemp, rm, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compileEvidence, fixture, locate, replaceDuration} from '../experiments/elapsed-duration-output/bridge.mjs';
import {verify} from '../experiments/elapsed-duration-output/verify.mjs';

const source = await readFile(new URL(`../${fixture}`, import.meta.url), 'utf8');

test('canonical duration output uses old timer slots and preserves both typed output entries', () => {
  const e = compileEvidence(source), l = e.located;
  assert.deepEqual(e.manifest.outputs, [{name:'relay',type:'Bool'}, {name:'age_ms',type:'Duration'}]);
  assert.deepEqual(l.outputs.map(o => [o.name,o.type]), [['relay',1],['age_ms',2]]);
  assert.deepEqual(l.outputs[1].bytes, [4,2,0,30,10,0,3,3,0,4,1,0,20,31,1,0,32]);
  const reads = e.metadata.dependencies.find(d => d.target.name === 'age_ms').reads;
  assert.deepEqual(reads, [{field:'stateBefore',name:'__gf_timer_initialized_age'},
    {field:'inputs',name:'__gf_now_ms'}, {field:'stateBefore',name:'__gf_timer_since_age'}]);
});

test('length-changing output mutation preserves complete module framing', () => {
  const e = compileEvidence(source), code = e.located.outputs[1].bytes;
  const changed = replaceDuration(e, [...code.slice(0,3),10,...code.slice(3)]);
  const parsed = locate(changed.bytes);
  assert.equal(changed.bytes.length, e.bytes.length + 1);
  assert.deepEqual(parsed.transitions, e.located.transitions);
  assert.deepEqual(parsed.outputs[0], e.located.outputs[0]);
  assert.equal(parsed.outputs[1].bytes.length, 18);
  assert.throws(() => locate([...changed.bytes,0]));
});

test('missing proof tool replaces a stale successful receipt with failed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'duration-output-receipt-'));
  try {
    const path = join(directory,'verification.json');
    await writeFile(path, JSON.stringify({status:'passed',results:[{passed:true}]}));
    const report = await verify({lean:join(directory,'missing-lean'),evidenceDir:directory});
    assert.equal(report.status,'failed');
    const receipt = JSON.parse(await readFile(path,'utf8'));
    assert.equal(receipt.status,'failed'); assert.deepEqual(receipt.results,[]);
    assert.ok(receipt.startedAt); assert.ok(receipt.finishedAt);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('external version failure observes running before it can leave stale success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'duration-output-probe-'));
  try {
    const path=join(directory,'verification.json'), marker=join(directory,'observed-status'), probe=join(directory,'version-failure');
    await writeFile(path,JSON.stringify({status:'passed',results:[{passed:true}]}));
    await writeFile(probe,`#!/usr/bin/env node\nconst fs=require('node:fs');\nfs.writeFileSync(${JSON.stringify(marker)},JSON.parse(fs.readFileSync(${JSON.stringify(path)},'utf8')).status);\nprocess.exit(1);\n`);
    await chmod(probe,0o700);
    const result=spawnSync(process.execPath,[resolve('experiments/elapsed-duration-output/verify.mjs'),'--lean',probe,'--evidence-dir',directory],{encoding:'utf8',timeout:30000});
    assert.equal(result.status,1); assert.equal(result.signal,null); assert.equal(result.error,undefined);
    assert.equal(await readFile(marker,'utf8'),'running');
    assert.equal(JSON.parse(await readFile(path,'utf8')).status,'failed');
  } finally {await rm(directory,{recursive:true,force:true});}
});
