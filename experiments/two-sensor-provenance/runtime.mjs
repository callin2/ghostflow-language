import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileSourceSync } from '../../tools/compile-source.mjs';
import { GhostFlowRuntime } from '../../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../../runtimes/wasm/framed-runtime.mjs';
import { ControlRuntime } from '../../runtimes/wasm/control-runtime.mjs';
import { observeSourceTrace, RESULT_FAULT_MEMBERS } from '../../tools/source-trace.mjs';
import { sha256 } from './bridge.mjs';

const [sibling, evidence] = process.argv.slice(2), directory = resolve(evidence);
await mkdir(directory, {recursive:true});
const reportPath=join(directory,'runtime-verification.json');
const report={status:'running',startedAt:new Date().toISOString(),productionCorrespondenceProof:false};
const publish=async()=>{const temporary=`${reportPath}.tmp`;await writeFile(temporary,JSON.stringify(report,null,2)+'\n');await rename(temporary,reportPath);};
await publish();
try {
const receiptPath = join(resolve(sibling),'build/evidence/build183/verification.json');
const receiptBytes = await readFile(receiptPath), receipt = JSON.parse(receiptBytes);
assert.equal(receipt.passed,true);
const files = Object.entries(receipt.sourceSha256).filter(([p])=>p.endsWith('.rs') || /(^|\/)Cargo\.(toml|lock)$/.test(p));
assert.equal(files.length,100);
for (const [p,hash] of files) assert.equal(sha256(await readFile(p)),hash,`runtime source drift: ${p}`);
const wasmPath=join(directory,'ghostflow_wasm.wasm'), nativePath=join(directory,'run');
await copyFile(join(resolve(sibling),'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'),wasmPath);
await copyFile(join(resolve(sibling),'target/release/examples/run'),nativePath);
await writeFile(join(directory,'reused-build183-verification.json'),receiptBytes);
const wasm=await readFile(wasmPath),native=await readFile(nativePath);
assert.equal(sha256(wasm),receipt.wasm.sha256);assert.equal(sha256(native),receipt.native.sha256);
const filename='experiments/two-sensor-provenance/fixtures/two-recover.ghost.md';
const source=await readFile(filename,'utf8'), compiled=compileSourceSync(source,{filename});
const sensors=compiled.manifest.sensors, outputs=compiled.manifest.outputs.map(o=>o.name);
const choices=[... [false,true].map(payload=>({payload,ok:true,fault:0})),
  ...[0,1,2,3].flatMap(fault=>[false,true].map(payload=>({payload,ok:false,fault})))];
const rows=choices.flatMap(left=>choices.map(right=>[left,right]));
const fields=sensors.flatMap(s=>[s.valueInput,s.okInput,s.faultInput]);
await writeFile(join(directory,'module.gfb'),compiled.bytes);
await writeFile(join(directory,'rails.csv'),fields.join(',')+'\n'+rows.map(rs=>rs.flatMap(r=>[r.payload,r.ok,r.fault]).join(',')).join('\n')+'\n');
const observed=[];
const wrapperFiles = {};
for (const path of ['runtimes/wasm/ghostflow-runtime.mjs','runtimes/wasm/framed-runtime.mjs',
  'runtimes/wasm/control-runtime.mjs','tools/source-trace.mjs','tools/compile-source.mjs',
  'experiments/two-sensor-provenance/runtime.mjs']) wrapperFiles[path]=sha256(await readFile(path));
function check(runtime,rs,trace) {
  const requested=Object.fromEntries(rs.map((r,i)=>[outputs[i],r.ok?r.payload:false]));
  assert.deepEqual(trace.requested,requested);assert.deepEqual(trace.safe,requested);
  const expected=rs.map((r,i)=>({site:compiled.traceMetadata.resultSites[i].site,choice:r.ok?0:r.fault+1,origin:r.ok?0:i+1}));
  assert.deepEqual(trace.resultTrace,expected);
  const events=observeSourceTrace(compiled.traceMetadata,trace).resultEvents;
  events.forEach((event,i)=>{assert.equal(event.fault,rs[i].ok?null:RESULT_FAULT_MEMBERS.SensorFault[rs[i].fault]);
    assert.equal(event.originDescriptor?.name??null,rs[i].ok?null:sensors[i].name);});
  observed.push({runtime,rails:rs,requested,resultTrace:trace.resultTrace});
}
const result=spawnSync(nativePath,[join(directory,'module.gfb'),join(directory,'rails.csv'),'--outcomes'],{encoding:'utf8',timeout:30000});
await writeFile(join(directory,'native.log'),(result.stdout??'')+(result.stderr??''));
assert.equal(result.status,0,result.stderr??result.error?.message);
const nativeRows=result.stdout.trim().split('\n').map(JSON.parse);assert.equal(nativeRows.length,rows.length);
nativeRows.forEach((r,i)=>check('reused-native',rows[i],r.trace));
for (const Runtime of [GhostFlowRuntime,FramedGhostFlowRuntime]) {
  const rt=await Runtime.instantiate(wasm);
  try {
    rt.load(compiled.bytes);outputs.forEach(o=>rt.addCapability('actuator',o,'bool'));rt.activate();
    for (const [scanId,rs] of rows.entries()) {
      let trace;
      if (Runtime===GhostFlowRuntime) {
        rs.forEach((r,i)=>{rt.setBool(sensors[i].valueInput,r.payload);rt.setBool(sensors[i].okInput,r.ok);rt.setNumber(sensors[i].faultInput,r.fault);});
        rt.tick();trace=rt.trace;
      } else trace=rt.scan({scanId,logicalTimeMs:scanId,inputs:rs.flatMap((r,i)=>[
        {name:sensors[i].valueInput,value:r.payload},{name:sensors[i].okInput,value:r.ok},{name:sensors[i].faultInput,value:r.fault}])}).trace;
      check(Runtime===GhostFlowRuntime?'reused-wasm':'reused-framed-wasm',rs,trace);
    }
  } finally {rt.dispose();}
}
for (const framed of [false,true]) {
  const rt=await (framed?ControlRuntime.instantiateFramed:ControlRuntime.instantiate).call(ControlRuntime,wasm,compiled);
  try {
    for (const [index,rs] of rows.entries()) {
      const id=index+1,samples=Object.fromEntries(rs.map((r,i)=>[sensors[i].name,{epoch:1,id,timestampMs:id,
        quality:r.ok?'Good':RESULT_FAULT_MEMBERS.SensorFault[r.fault],value:r.payload}]));
      check(framed?'reused-canonical-framed':'reused-canonical-wasm',rs,rt.step({nowMs:id,samples}).vm);
    }
  } finally {rt.dispose();}
}
Object.assign(report,{status:'passed',at:new Date().toISOString(),sourceRows:rows.length,executions:observed.length,
  sourceSha256:sha256(source),artifactSha256:sha256(compiled.bytes),nativeExitCode:result.status,productionCorrespondenceProof:false,
  provenance:{reused:true,builtByThisRun:false,receiptSha256:sha256(receiptBytes),sourceSHA:receipt.buildIdentity.sourceSHA,
    checkedRustCargoFiles:files.length,wasmSha256:sha256(wasm),nativeSha256:sha256(native)},wrapperFiles,observed});
for (const [path,hash] of Object.entries(wrapperFiles)) assert.equal(sha256(await readFile(path)),hash,`wrapper changed: ${path}`);
await publish();
console.log(JSON.stringify({...report,observed:undefined}));
} catch(error) {
  Object.assign(report,{status:'failed',finishedAt:new Date().toISOString(),error:error?.stack??String(error)});
  await publish();
  throw error;
}
