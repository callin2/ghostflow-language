import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {GhostFlowRuntime} from '../../runtimes/wasm/ghostflow-runtime.mjs';
import {FramedGhostFlowRuntime} from '../../runtimes/wasm/framed-runtime.mjs';
import {ControlRuntime} from '../../runtimes/wasm/control-runtime.mjs';
import {observeSourceTrace,RESULT_FAULT_MEMBERS} from '../../tools/source-trace.mjs';
import {compileEvidence,sha256} from './bridge.mjs';

const [sibling,evidence]=process.argv.slice(2),directory=resolve(evidence??'build/elapsed-epoch-validation/runtime');await mkdir(directory,{recursive:true});
const reportPath=join(directory,'runtime-verification.json');
let report={status:'running',startedAt:new Date().toISOString(),productionCorrespondenceProof:false};
const publish=async()=>{await writeFile(`${reportPath}.tmp`,JSON.stringify(report,null,2)+'\n');await rename(`${reportPath}.tmp`,reportPath);};
await publish();
try {
const receiptBytes=await readFile(join(resolve(sibling),'build/evidence/build183/verification.json')),receipt=JSON.parse(receiptBytes);
assert.equal(receipt.passed,true);
const rust=Object.entries(receipt.sourceSha256).filter(([p])=>/\.rs$|(^|\/)Cargo\.(toml|lock)$/.test(p));assert.equal(rust.length,100);
for(const[p,h]of rust)assert.equal(sha256(await readFile(p)),h,`runtime source mismatch: ${p}`);
const wasmPath=join(directory,'runtime.wasm'),nativePath=join(directory,'native-run');
await copyFile(join(resolve(sibling),'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'),wasmPath);
await copyFile(join(resolve(sibling),'target/release/examples/run'),nativePath);
const wasm=await readFile(wasmPath),native=await readFile(nativePath);
assert.equal(sha256(wasm),receipt.wasm.sha256);assert.equal(sha256(native),receipt.native.sha256);
await writeFile(join(directory,'reused-receipt.json'),receiptBytes);
const filename='experiments/elapsed-epoch-validation/fixtures/elapsed-toggle.ghost.md',source=await readFile(filename,'utf8'),e=compileEvidence(source,filename);
const {compileSourceSync}=await import('../../tools/compile-source.mjs'),compiled=compileSourceSync(source,{filename});
const sensor=compiled.manifest.sensors[0],state=e.projection.state,output=e.projection.output;
const sinceName=`__gf_timer_since_${e.projection.timer}`,initName=`__gf_timer_initialized_${e.projection.timer}`;
const choices=[...[false,true].map(payload=>({payload,ok:true,fault:0})),...[0,1,2,3].flatMap(fault=>[false,true].map(payload=>({payload,ok:false,fault})))];
const histories=choices.flatMap(a=>choices.map(b=>[{...a,now:100},{...b,now:200}]))
  .concat([[{payload:false,ok:true,fault:0,now:100},{payload:true,ok:true,fault:0,now:100},{payload:false,ok:false,fault:1,now:200}]]);
const wrappers={};for(const p of ['runtimes/wasm/ghostflow-runtime.mjs','runtimes/wasm/framed-runtime.mjs','runtimes/wasm/control-runtime.mjs',
  'tools/source-trace.mjs','tools/compile-source.mjs','experiments/elapsed-epoch-validation/bridge.mjs',
  'experiments/bool-sensor-state-validation/bridge.mjs','experiments/elapsed-epoch-validation/runtime.mjs'])wrappers[p]=sha256(await readFile(p));
const observed=[];let nativeInvocations=0;
function expected(history){let held=false,since=0,initialized=false;return history.map(r=>{const next=r.ok&&r.payload?!held:held;
  const started=!initialized||next!==held?r.now:since,event={site:7,choice:r.ok?0:r.fault+1,origin:r.ok?0:1};
  const observation={before:{[state]:held,[sinceName]:since,[initName]:initialized},after:{[state]:next,[sinceName]:started,[initName]:true},requested:{[output]:next},events:initialized?[event,event]:[event]};
  held=next;since=started;initialized=true;return observation;});}
function check(runtime,historyIndex,index,row,want,trace){
  assert.deepEqual(trace.stateBefore,want.before);assert.deepEqual(trace.stateAfter,want.after);
  assert.deepEqual(trace.requested,want.requested);assert.deepEqual(trace.safe,want.requested);assert.deepEqual(trace.resultTrace,want.events);
  const events=observeSourceTrace(compiled.traceMetadata,trace).resultEvents;assert.equal(events.length,want.events.length);
  events.forEach(event=>{assert.equal(event.fault,row.ok?null:RESULT_FAULT_MEMBERS.SensorFault[row.fault]);assert.equal(event.originDescriptor?.name??null,row.ok?null:sensor.name);});
  observed.push({runtime,history:historyIndex,index,row,stateBefore:trace.stateBefore,stateAfter:trace.stateAfter,requested:trace.requested,events:trace.resultTrace});
}
await writeFile(join(directory,'module.gfb'),compiled.bytes);
try { for(const[historyIndex,history]of histories.entries()){
  const want=expected(history),csvPath=join(directory,`history-${historyIndex}.csv`);
  await writeFile(csvPath,[sensor.valueInput,sensor.okInput,sensor.faultInput,'__gf_now_ms'].join(',')+'\n'+history.map(r=>[r.payload,r.ok,r.fault,r.now].join(',')).join('\n')+'\n');
  const result=spawnSync(nativePath,[join(directory,'module.gfb'),csvPath,'--outcomes'],{encoding:'utf8',timeout:30000});nativeInvocations++;
  await writeFile(join(directory,`native-${historyIndex}.log`),(result.stdout??'')+(result.stderr??''));assert.equal(result.status,0,result.stderr??result.error?.message);
  const rows=result.stdout.trim().split('\n').map(JSON.parse);assert.equal(rows.length,history.length);rows.forEach((r,i)=>check('native',historyIndex,i,history[i],want[i],r.trace));
  for(const Runtime of [GhostFlowRuntime,FramedGhostFlowRuntime]){
    const rt=await Runtime.instantiate(wasm);try{rt.load(compiled.bytes);rt.addCapability('actuator',output,'bool');rt.activate();
      for(const[i,r]of history.entries()){let trace;if(Runtime===GhostFlowRuntime){rt.setBool(sensor.valueInput,r.payload);rt.setBool(sensor.okInput,r.ok);rt.setNumber(sensor.faultInput,r.fault);rt.setNumber('__gf_now_ms',r.now);rt.tick();trace=rt.trace;}
        else trace=rt.scan({scanId:i,logicalTimeMs:r.now,inputs:[{name:sensor.valueInput,value:r.payload},{name:sensor.okInput,value:r.ok},{name:sensor.faultInput,value:r.fault}]}).trace;
        check(Runtime===GhostFlowRuntime?'wasm':'framed-wasm',historyIndex,i,r,want[i],trace);}
    }finally{rt.dispose();}}
  for(const framed of [false,true]){const rt=await(framed?ControlRuntime.instantiateFramed:ControlRuntime.instantiate).call(ControlRuntime,wasm,compiled);
    try{for(const[i,r]of history.entries()){const id=i+1;check(framed?'canonical-framed':'canonical-wasm',historyIndex,i,r,want[i],rt.step({nowMs:r.now,samples:{[sensor.name]:{epoch:1,id,timestampMs:r.now,quality:r.ok?'Good':RESULT_FAULT_MEMBERS.SensorFault[r.fault],value:r.payload}}}).vm);}}finally{rt.dispose();}}
} } catch(error) { await writeFile(join(directory,'runtime-failure.json'),JSON.stringify({status:'failed',at:new Date().toISOString(),error:{name:error.name,message:error.message,stack:error.stack},observed},null,2)+'\n');throw error; }
for(const[p,h]of Object.entries(wrappers))assert.equal(sha256(await readFile(p)),h,`wrapper changed: ${p}`);
report={...report,status:'passed',at:new Date().toISOString(),histories:histories.length,executions:observed.length,nativeInvocations,sourceSha256:e.source.sha256,artifactSha256:e.bytecodeSha256,
  productionCorrespondenceProof:false,provenance:{reused:true,builtByThisRun:false,checkedRustCargoFiles:rust.length,receiptSha256:sha256(receiptBytes),sourceSHA:receipt.buildIdentity.sourceSHA,wasmSha256:sha256(wasm),nativeSha256:sha256(native)},wrappers,observed};
await publish();console.log(JSON.stringify({...report,observed:undefined}));
} catch(error) {report={...report,status:'failed',finishedAt:new Date().toISOString(),error:{name:error.name,message:error.message}};await publish();console.error(error.stack??error.message);process.exitCode=1;}
