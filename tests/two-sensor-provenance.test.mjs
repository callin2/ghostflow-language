import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {compileEvidence,locate,theoremInput,witnessInput} from '../experiments/two-sensor-provenance/bridge.mjs';

const filename='experiments/two-sensor-provenance/fixtures/two-recover.ghost.md';
const source=await readFile(new URL(`../${filename}`,import.meta.url),'utf8');
test('actual two-output artifact retains independent six-rail routing and source identities',()=>{
  const e=compileEvidence(source,filename);
  assert.deepEqual(e.projection,[{sensor:'left',output:'left_out',origin:1,site:7},{sensor:'right',output:'right_out',origin:2,site:12}]);
  assert.deepEqual(e.located.inputs.map(i=>i.type),[1,1,2,1,1,2]);
  assert.deepEqual(e.located.outputs.map(o=>[o.name,o.bytes.length]),[['left_out',45],['right_out',45]]);
  for (const [i,o] of e.located.outputs.entries()) {
    assert.deepEqual(o.bytes.slice(0,3),[3,i?4:1,0]);
    assert.deepEqual(o.bytes.slice(6,9),[3,i?3:0,0]);
    assert.deepEqual(o.bytes.slice(24,27),[3,i?5:2,0]);
    assert.deepEqual(o.bytes.slice(39),[i?34:33,56,i?12:7,0,0,0]);
  }
});
for (const [label,edit] of [
  ['crossed source reference',s=>s.replace('left_out <- left','left_out <- right')],
  ['changed fallback',s=>s.replace('recover(false)','recover(true)')],
  ['different sensor type',s=>s.replace('input right: Bool','input right: Number')],
  ['additional statement',s=>s.replace('output left_out: Bool;','output left_out: Bool; output extra: Bool;')],
]) test(`trusted projection refuses ${label}`,()=>assert.throws(()=>compileEvidence(edit(source),filename)));
test('metadata certificate expectation derives from source projection despite a colluding compiled descriptor',()=>{
  const e=compileEvidence(source,filename); e.metadata.resultSites[0].origins[0]={tag:2,nodeId:2,kind:'sensor',name:'right'};
  const input=theoremInput(e);
  assert.notEqual(input.match(/def actualMetadata : Metadata := (.*)/)[1],input.match(/def expectedMetadata : Metadata := (.*)/)[1]);
});
test('byte locator preserves full module framing for semantic mutants',()=>{
  const e=compileEvidence(source,filename),bytes=[...e.bytes];bytes[e.located.outputs[0].start+41]=12;
  assert.equal(locate(bytes).outputs[0].bytes[41],12);
  const input=witnessInput(bytes,false);
  assert.match(input,/theorem structurallyParsed/);assert.match(input,/theorem targetedEquality : SensorMachine.run/);
  assert.throws(()=>locate([...bytes,0]));
});
test('runtime verification replaces a stale passed receipt when its reused build input is missing',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ghostflow-two-sensor-stale-receipt-'));
  try {
    const sibling=join(directory,'sibling'),evidence=join(directory,'evidence');
    await mkdir(join(sibling,'build/evidence/build183'),{recursive:true});
    const receipt=join(evidence,'runtime-verification.json');
    await mkdir(evidence,{recursive:true});
    await writeFile(receipt,JSON.stringify({status:'passed',at:'old'}));
    const result=spawnSync(process.execPath,[resolve('experiments/two-sensor-provenance/runtime.mjs'),sibling,evidence],
      {encoding:'utf8',timeout:30000});
    assert.notEqual(result.status,0);
    const current=JSON.parse(await readFile(receipt,'utf8'));
    assert.equal(current.status,'failed');
    assert.match(current.error,/verification\.json/);
    assert.match(current.finishedAt,/Z$/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
