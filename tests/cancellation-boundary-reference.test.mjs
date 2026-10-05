import { softwareQualityObservations } from './helpers/software-quality-observations.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {compileSource} from '../tools/toolchain.mjs';
import {sha256Hex} from '../tools/sha256.mjs';
import {ControlRuntime} from '../runtimes/wasm/control-runtime.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
// This authored policy requests closing both valves before waiting for externally
// supplied home feedback. Logical intent does not assert physical closure/motion.
const source='# REF-08-001 cancellation boundary\n\n```ghost\n'+`control SequentialIrrigation {
  input start, cancel, next_zone, home_confirmed: Bool;
  type Phase = Idle | ZoneOne | ZoneTwo | Returning;
  state phase: Phase = Idle;
  phase' = case start { ok(observed_start) => case cancel { ok(observed_cancel) => case next_zone { ok(observed_next_zone) => case home_confirmed { ok(observed_home_confirmed) => case phase {
    Idle => if observed_cancel then Idle else if observed_start then ZoneOne else Idle;
    ZoneOne => if observed_cancel then Returning else if observed_next_zone then ZoneTwo else ZoneOne;
    ZoneTwo => if observed_cancel then Returning else ZoneTwo;
    Returning => if observed_home_confirmed then Idle else Returning;
  }; fault(_) => phase; }; fault(_) => phase; }; fault(_) => phase; }; fault(_) => phase; };
  output valve_one, valve_two, request_home, idle: Bool;
  valve_one <- phase' == ZoneOne;
  valve_two <- phase' == ZoneTwo;
  request_home <- phase' == Returning;
  idle <- phase' == Idle;
}
`+'```\n';
const wasm=fs.readFileSync(root+'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const inputs=(overrides={})=>({start:false,cancel:false,next_zone:false,home_confirmed:false,...overrides});
// The portable trace encodes the declared enum members as ordered integer tags.
const Phase={Idle:0,ZoneOne:1,ZoneTwo:2,Returning:3};
async function compile(){
 const original=JSON.parse(fs.readFileSync(root+'tests/reference/cases/03-settings-boundaries.json')).cases.find(c=>c.id==='REF-08-001');
 assert.equal(original.issue,'https://github.com/callin2/ghostflow-language/issues/318');assert.equal(original.status,'specified');
 const artifact=await compileSource(source,{filename:'ref-08-001-cancellation-input-v2.ghost.md'});assert.equal(artifact.sourceDocument.text,source);assert.equal(artifact.sourceDocument.sha256,sha256Hex(source));return artifact;
}
async function framesFor(artifact,rows){
 const runtime=await ControlRuntime.instantiateFramed(wasm,artifact),frames=[];
 softwareQualityObservations(runtime);
 const dispatch=runtime.runtime.dispatch.bind(runtime.runtime);
 runtime.runtime.dispatch=frame=>{frames.push(structuredClone(frame));return dispatch(frame);};
 try{rows.forEach((values,i)=>runtime.step({nowMs:i,inputs:inputs(values)}));return frames;}finally{runtime.dispose();}
}
async function compare(t,artifact,frames){
 const runtime=await ControlRuntime.instantiateFramed(wasm,artifact);t.after(()=>runtime.dispose());
 const rows=frames.map(frame=>{try{runtime.runtime.dispatch(frame);return {accepted:true,outcome:structuredClone(runtime.runtime.outcome)};}catch(error){return {accepted:false,outcome:structuredClone(runtime.runtime.outcome),error:error.message};}});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ref-08-001-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const module=path.join(dir,'module.gfb'),tape=path.join(dir,'frames.tsv');fs.writeFileSync(module,artifact.bytes);
 fs.writeFileSync(tape,frames.map(f=>[f.scanId,f.logicalTimeMs,...f.inputs.flatMap(v=>[v.name,v.type==='Bool'?'b':'n',v.value])].join('\t')).join('\n')+'\n');
 const runner=root+'target/release/examples/scan_tape'+(process.platform==='win32'?'.exe':'');
 const native=()=>execFileSync(runner,[module,tape],{encoding:'utf8',timeout:10000}).trim().split('\n').map(JSON.parse);
 const actual=native();assert.deepEqual(actual.map(({accepted,outcome})=>({accepted,outcome})),rows.map(({accepted,outcome})=>({accepted,outcome})));assert.deepEqual(native(),actual,'fresh native replay must retain complete outcomes');
 for(const [i,row] of rows.entries())if(!row.accepted){assert.match(row.error,/input|type|logical|time|snapshot/i);assert.match(actual[i].error,/input|type|logical|time|snapshot/i);}
 return rows;
}

test('REF-08-001 existing enum state and case close sequential valve intents on cancellation then wait for supplied home feedback before Idle', async t => {
 const artifact=await compile(),frames=await framesFor(artifact,[{}, {start:true}, {next_zone:true}, {cancel:true,next_zone:true,home_confirmed:true}, {start:true}, {}, {home_confirmed:true}]);
 const rows=await compare(t,artifact,frames);assert.ok(rows.every(r=>r.accepted));
 assert.deepEqual(rows.map(r=>r.outcome.trace.stateAfter.phase),[Phase.Idle,Phase.ZoneOne,Phase.ZoneTwo,Phase.Returning,Phase.Returning,Phase.Returning,Phase.Idle]);
 assert.deepEqual(rows.map(r=>r.outcome.trace.safe),[
  {valve_one:false,valve_two:false,request_home:false,idle:true},
  {valve_one:true,valve_two:false,request_home:false,idle:false},
  {valve_one:false,valve_two:true,request_home:false,idle:false},
  ...Array.from({length:3},()=>({valve_one:false,valve_two:false,request_home:true,idle:false})),
  {valve_one:false,valve_two:false,request_home:false,idle:true}]);
 for(const row of rows){assert.deepEqual(row.outcome.trace.requested,row.outcome.trace.safe);assert.equal('applied' in row.outcome.trace,false);assert.equal('confirmed' in row.outcome.trace,false);}
 assert.equal(rows[3].outcome.trace.inputs[artifact.manifest.sensors.find(sensor=>sensor.name==='home_confirmed').valueInput],true,'already-high feedback cannot skip the authored Returning stage');
});

test('REF-08-001 cancellation priority applies independently in each watering stage without introducing a cancellation keyword or hidden Driver sequence', async t => {
 const artifact=await compile();
 for(const second of [false,true]){
  const values=[{}, {start:true}, ...(second?[{next_zone:true}]:[]), {cancel:true,next_zone:true,start:true}, {cancel:true,start:true}, {home_confirmed:true}, {cancel:true,start:true}];
  const rows=await compare(t,artifact,await framesFor(artifact,values));assert.ok(rows.every(r=>r.accepted));
  const offset=second?3:2;assert.equal(rows[offset].outcome.trace.stateAfter.phase,Phase.Returning);
  assert.deepEqual(rows[offset].outcome.trace.safe,{valve_one:false,valve_two:false,request_home:true,idle:false});
  assert.equal(rows[offset+1].outcome.trace.stateAfter.phase,Phase.Returning);assert.equal(rows.at(-1).outcome.trace.stateAfter.phase,Phase.Idle);
 }
});

test('REF-08-001 missing or mistyped home feedback and backward time reject atomically and valid retry matches clean native WASM replay', async t => {
 const artifact=await compile(),clean=await framesFor(artifact,[{}, {start:true}, {cancel:true}, {}, {home_confirmed:true}]);
 const homeInput=artifact.manifest.sensors.find(sensor=>sensor.name==='home_confirmed').valueInput;
 const missing=structuredClone(clean[3]);missing.inputs=missing.inputs.filter(i=>i.name!==homeInput);
 const mistyped=structuredClone(clean[3]);Object.assign(mistyped.inputs.find(i=>i.name===homeInput),{type:'Number',value:1});
 const backward={...structuredClone(clean[3]),logicalTimeMs:1};
 const rows=await compare(t,artifact,[...clean.slice(0,3),missing,mistyped,backward,...clean.slice(3)]);
 assert.deepEqual(rows.map(r=>r.accepted),[true,true,true,false,false,false,true,true]);
 for(const row of rows.slice(3,6))assert.deepEqual(row.outcome,rows[2].outcome,'rejection must preserve the complete committed state and intent');
 const baseline=await compare(t,artifact,clean);assert.deepEqual(rows.filter(r=>r.accepted),baseline);
});
