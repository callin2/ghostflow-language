import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compileEvidence,locate} from '../experiments/elapsed-epoch-validation/bridge.mjs';

const filename='experiments/elapsed-epoch-validation/fixtures/elapsed-toggle.ghost.md';
const source=await readFile(new URL(`../${filename}`,import.meta.url),'utf8');
test('actual unused elapsed declaration retains clock and three state transitions',()=>{
  const e=compileEvidence(source,filename),l=e.located;
  assert.deepEqual(l.inputs.map(i=>[i.name,i.type]),[
    ['__gf_sensor_value_trigger',1],['__gf_sensor_ok_trigger',1],['__gf_sensor_fault_trigger',2],['__gf_now_ms',2]]);
  assert.deepEqual(l.states.map(s=>[s.name,s.type,s.initial]),[
    ['held',1,[0]],['__gf_timer_since_age',2,[0,0,0,0,0,0,0,0]],['__gf_timer_initialized_age',1,[0]]]);
  assert.deepEqual(l.transitions.map(t=>[t.target,t.bytes.length]),[[0,58],[1,87],[2,2]]);
  assert.deepEqual(l.transitions[1].bytes.slice(13,71),l.transitions[0].bytes);
  assert.equal(l.transitions[1].bytes[74],13);assert.deepEqual(l.transitions[2].bytes,[1,1]);
});
test('source-derived profile retains elapsed state and timer identities after renaming',()=>{
  const e=compileEvidence(source.replace('timer age =','timer epoch ='),filename);
  assert.equal(e.projection.timer,'epoch');assert.equal(e.projection.timerNode,18);
  assert.equal(e.located.states[1].name,'__gf_timer_since_epoch');
  assert.equal(e.manifest.timers[0].state,'held');
});
test('source projection refuses elapsed on an input',()=>assert.throws(()=>compileEvidence(source.replace('elapsed(held)','elapsed(trigger)'),filename)));
test('complete byte locator retains framing under a typed clock-selection mutant',()=>{
  const e=compileEvidence(source,filename),bytes=[...e.bytes],at=e.located.transitions[1].start;
  bytes[at+7]=4;bytes[at+8]=1;
  assert.deepEqual(locate(bytes).transitions[1].bytes.slice(7,10),[4,1,0]);
  assert.throws(()=>locate([...bytes,0]));
});
test('runtime failure replaces an earlier passed receipt before provenance reads',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'epoch-stale-receipt-'));
  try{
    const path=join(directory,'runtime-verification.json');await writeFile(path,JSON.stringify({status:'passed',executions:999}));
    const result=spawnSync(process.execPath,[resolve('experiments/elapsed-epoch-validation/runtime.mjs'),join(directory,'missing-runtime'),directory],{encoding:'utf8',timeout:30000});
    assert.equal(result.status,1);assert.equal(result.signal,null);assert.equal(result.error,undefined);
    const receipt=JSON.parse(await readFile(path,'utf8'));assert.equal(receipt.status,'failed');assert.equal(receipt.executions,undefined);
    assert.match(receipt.error.message,/ENOENT/);assert.ok(receipt.startedAt);assert.ok(receipt.finishedAt);
  }finally{await rm(directory,{recursive:true,force:true});}
});
