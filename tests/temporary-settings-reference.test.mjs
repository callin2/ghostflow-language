import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compileSource} from './helpers/literate-compile.mjs';
import {TemporarySettingsHost} from '../runtimes/wasm/temporary-settings-host.mjs';
import {canonicalJson} from '../tools/canonical-json.mjs';
import {sha256Hex} from '../tools/sha256.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const wasm=fs.readFileSync(path.join(root,'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const native=path.join(root,`target/release/examples/context_tape${process.platform==='win32'?'.exe':''}`);
const build=spawnSync('cargo',['build','--locked','--offline','--release','-p','ghostflow-core','--example','context_tape'],{cwd:root,encoding:'utf8',timeout:120000});
assert.equal(build.status,0,build.stderr);
const source=`control P {
 config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; }
 config duty: Percent = 50% { min = 0%; max = 100%; step = 10%; access = operator; }
 input den: Int;
 state count: Int = 0;
 count' = count + 1;
 state active: Bool = true;
 timer age = elapsed(active);
 output duration_ms, age_ms: Duration;
 output duty_pct: Percent;
 output counter, quotient: Int;
 duration_ms <- case duration { ok(v) => v; fault(_) => 0ms; };
 duty_pct <- case duty { ok(v) => v; fault(_) => 0%; };
 age_ms <- age; counter <- count'; quotient <- 10 div den;
}`;
const artifact=await compileSource(source,{filename:'temporary-program-p.ghost'});
const config=(a,name)=>a.manifest.configs.find(c=>c.name===name);
const typed=(a,name,value)=>({configId:config(a,name).id,result:{ok:true,type:config(a,name).type,value}});
const ordinaryValue=(h,name)=>h.snapshot().ordinary.find(c=>c.configId===config(artifact,name).id).result.value;
const grants=a=>({operator:a.manifest.configs.map(c=>c.id)});
async function create(a=artifact,{runId='run-p',boot=1,...options}={}){
 return TemporarySettingsHost.instantiate(wasm,a,{runId,grants:grants(a),historyCapacity:128,
  context:{bootEpoch:boot,terminalCapacity:128,bindings:[]},...options});
}
function packet(at,wall=at,{boot=1,trusted=true,den=1}={}){
 return {nowMs:at,inputs:{den},contextFacts:{clock:{monotonicMs:at,bootEpoch:boot,wallMs:trusted?wall:null,
  uncertaintyMs:trusted?0:null,trusted,unknownReason:trusted?null:'ClockUnknown',sourceRevision:'temporary-fixture-clock-v1'},natural:[],schedules:[],settings:null}};
}
function event(h,kind,id,changes,extra={}){
 const s=h.snapshot();return {kind,eventId:id,programFingerprint:s.programFingerprint,sourceSha256:s.sourceSha256,
  runId:s.runId,baseRevision:s.core.state.settingsRevision,actor:'operator',reason:'explicit operator fixture',
  ...(changes?{changes}:{}),...extra};
}
function unchanged(h,fn,pattern){const before=h.snapshot();assert.throws(fn,pattern);assert.deepEqual(h.snapshot(),before);}
function nativeRun(a,tape,{boot=1,checkpoint=null}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gf-temporary-parity-'));
 try{
  fs.writeFileSync(path.join(dir,'module.gfb'),a.bytes);
  let scanId=0;
  fs.writeFileSync(path.join(dir,'tape.json'),JSON.stringify({profile:'context-settings-civil-v1',activation:{bootEpoch:boot,terminalCapacity:128,bindings:[]},
   ...(checkpoint?{checkpoint}:{}),steps:tape.map(({p,r})=>({scanId:r.accepted?scanId++:scanId,logicalTimeMs:p.nowMs,
    inputs:a.manifest.inputs.filter(x=>x.name==='den').map(x=>({name:x.name,value:p.inputs.den})),
    ...p.contextFacts,settings:r.coreEvent??r.attemptedCoreEvent??null}))}));
  const result=spawnSync(native,[path.join(dir,'module.gfb'),path.join(dir,'tape.json')],{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim().split('\n').map(l=>JSON.parse(l));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function compareNative(a,tape,options){
 const rows=nativeRun(a,tape,options);assert.deepEqual(nativeRun(a,tape,options),rows,'independent fresh native replay');
 rows.forEach((n,i)=>{const w=tape[i].r;assert.equal(n.accepted,w.accepted);assert.deepEqual(w.snapshot.core.state,n.settings);
  assert.equal(w.snapshot.core.checkpoint,n.checkpoint);
  const committed=w.snapshot.lastOutcome;
  const actual=n.accepted?n.outcome:n.lastOutcome;
  assert.deepEqual(committed,actual,'complete latest committed outcome, including rejected return');
  if(w.accepted){assert.deepEqual(w.outcome.vm,n.outcome.trace);assert.deepEqual(w.outcome.frame,{scanId:n.outcome.scanId,logicalTimeMs:n.outcome.logicalTimeMs});}});
}

test('REF-05-018 actual Run overlay is Program-bound and Q revalidates type range permissions lifetime with atomic rejection and fresh replay', async () => {
 async function execute(){
  const p=await create();const tape=[];
  try{
   let at=0;const step=(e)=>{const q=packet(at++);const r=p.step(q,e);assert.equal(r.accepted,true);tape.push({p:q,r});return r;};
   step(null);step(event(p,'ordinary','ordinary-seven',[typed(artifact,'duration',420000)]));
   const applied=step(event(p,'temporary','temporary-p',[typed(artifact,'duration',600000)],{lifetime:{kind:'Run'}}));
   assert.equal(applied.outcome.vm.safe.duration_ms,600000);assert.equal(ordinaryValue(p,'duration'),420000);
   assert.deepEqual(applied.snapshot.overlays[0].changes[0].returnResult,{ok:true,type:'Duration',value:420000});
   assert.equal(applied.snapshot.overlays[0].lifetime.kind,'Run');compareNative(artifact,tape);
   return {checkpoint:p.checkpoint(),tape};
  }finally{p.dispose();}
 }
 const first=await execute();assert.deepEqual(await execute(),first,'complete fresh host/core replay');
 for(const [label,type,initial,bounds,validValue,invalid] of [
  ['type','Int','3','min = 1; max = 5; step = 1; access = operator;',4,600000],
  ['range','Duration','1min','min = 1min; max = 2min; step = 1min; access = operator;',120000,600000],
  ['permission','Duration','1min','min = 1min; max = 20min; step = 1min; access = designer;',120000,120000],
 ]){
  const q=await compileSource(`control Q { config duration: ${type} = ${initial} { ${bounds} }
   output selected: ${type}; selected <- case duration { ok(v) => v; fault(_) => ${type==='Int'?'0':'0ms'}; }; }`,{filename:`temporary-q-${label}.ghost`});
  await assert.rejects(create(q,{runId:'run-q',boot:2,checkpoint:first.checkpoint,restoreApproved:true}),/identity/);
  const host=await create(q,{runId:'run-q',boot:2});
  const qPacket=()=>({...packet(0,0,{boot:2}),inputs:{}});
  try{
   assert.equal(host.snapshot().overlays.length,0);assert.equal(host.snapshot().core.state.settingsRevision,0);
   const pEvent=event(host,'temporary','p-cannot-transfer',[typed(q,'duration',validValue)],{lifetime:{kind:'Run'},programFingerprint:first.checkpoint.body.programFingerprint});
   unchanged(host,()=>host.step(qPacket(),pEvent),/identity/);
   unchanged(host,()=>host.step(qPacket(),event(host,'temporary','missing-lifetime',[typed(q,'duration',validValue)])),/envelope|lifetime|permission/);
   const invalidResult={configId:config(q,'duration').id,result:{ok:true,type:label==='type'?'Duration':type,value:invalid}};
   unchanged(host,()=>host.step(qPacket(),event(host,'temporary','q-invalid',[invalidResult],{lifetime:{kind:'Run'}})),/type|range|permission/);
   if(label!=='permission'){
    const r=host.step(qPacket(),event(host,'temporary','q-approved',[typed(q,'duration',validValue)],{lifetime:{kind:'Run'}}));
    assert.equal(r.outcome.vm.safe.selected,validValue);assert.equal(r.snapshot.overlays[0].programFingerprint,r.snapshot.programFingerprint);
    compareNative(q,[{p:qPacket(),r}],{boot:2});
   }
  }finally{host.dispose();}
 }
});

test('REF-05-018 Until overlay survives approved same-Program restart and expires before first decision while Run overlay returns on run boundary', async () => {
 const p=await create();let saved;
 try{
  p.step(packet(0),event(p,'ordinary','ordinary-eight',[typed(artifact,'duration',480000)]));
  const r=p.step(packet(1,1000),event(p,'temporary','until-original',[typed(artifact,'duration',600000)],{lifetime:{kind:'Until',dateTimeMs:5000}}));
  assert.equal(r.outcome.vm.safe.duration_ms,600000);saved=p.checkpoint();
  await assert.rejects(create(artifact,{runId:'run-next',checkpoint:saved}),/approval/);
  await assert.rejects(create(artifact,{runId:'run-p',checkpoint:saved,restoreApproved:true}),/identity/);
 }finally{p.dispose();}
 for(const [wall,expected,active] of [[4999,600000,1],[5000,480000,0],[5001,480000,0]]){
  const restarted=await create(artifact,{runId:'run-next',boot:2,checkpoint:saved,restoreApproved:true});
  try{
   const q=packet(0,wall,{boot:2}),r=restarted.step(q);assert.equal(r.accepted,true,r.snapshot.unavailableReason);
   assert.equal(r.outcome.vm.safe.duration_ms,expected);assert.equal(r.outcome.vm.safe.age_ms,0);
   assert.equal(r.outcome.vm.safe.counter,1,'VM state is fresh in new run');assert.equal(r.snapshot.overlays.length,active);
   if(!active){assert.equal(r.snapshot.history.at(-1).effects[0].overlayId,'until-original');assert.equal(r.snapshot.history.at(-1).effects[0].kind,'expiry');}
   compareNative(artifact,[{p:q,r}],{boot:2,checkpoint:saved.body.core.checkpoint});
  }finally{restarted.dispose();}
 }
 const run=await create();let runSaved;
 try{
  run.step(packet(0),event(run,'ordinary','ordinary-nine',[typed(artifact,'duration',540000)]));
  run.step(packet(1),event(run,'temporary','run-only',[typed(artifact,'duration',600000)],{lifetime:{kind:'Run'}}));runSaved=run.checkpoint();
  const ended=run.endRun(packet(2));assert.equal(ended.outcome.vm.safe.duration_ms,540000);assert.equal(ended.snapshot.ended,true);
  assert.equal(ended.snapshot.history.at(-1).effects[0].overlayId,'run-only');assert.throws(()=>run.step(packet(3)),/run ended/);
 }finally{run.dispose();}
 const restarted=await create(artifact,{runId:'different-run',boot:2,checkpoint:runSaved,restoreApproved:true});
 try{const r=restarted.step(packet(0,0,{boot:2}));assert.equal(r.outcome.vm.safe.duration_ms,540000);assert.equal(r.snapshot.overlays.length,0);}
 finally{restarted.dispose();}
});

test('REF-05-018 temporary group rejects nesting and partial ordinary replacement then cancels original group and applies new ordinary value atomically', async () => {
 const h=await create();const tape=[];let at=0;
 const step=e=>{const p=packet(at++),r=h.step(p,e);assert.equal(r.accepted,true);tape.push({p,r});return r;};
 try{
  step(event(h,'temporary','group-original',[typed(artifact,'duration',600000),typed(artifact,'duty',80)],{lifetime:{kind:'Until',dateTimeMs:5000}}));
  unchanged(h,()=>h.step(packet(at),event(h,'temporary','nested',[typed(artifact,'duration',660000)],{lifetime:{kind:'Run'}})),/nesting/);
  unchanged(h,()=>h.step(packet(at),event(h,'ordinary','partial',[typed(artifact,'duration',420000)])),/entire temporary group/);
  unchanged(h,()=>h.step(packet(at),event(h,'cancel','wrong-id',null,{cancelOverlayIds:['other']})),/identity/);
  const replaced=step(event(h,'ordinary','cancel-and-new',[typed(artifact,'duration',420000)],{cancelOverlayIds:['group-original']}));
  assert.deepEqual([replaced.outcome.vm.safe.duration_ms,replaced.outcome.vm.safe.duty_pct],[420000,50]);assert.equal(replaced.snapshot.overlays.length,0);
  const afterExpiry={p:packet(5000),r:h.step(packet(5000))};tape.push(afterExpiry);
  assert.equal(afterExpiry.r.outcome.vm.safe.duration_ms,420000,'late old expiry cannot overwrite newer ordinary setting');
  assert.equal(afterExpiry.r.snapshot.core.state.settingsRevision,2);compareNative(artifact,tape);
 }finally{h.dispose();}
});

test('REF-05-018 unavailable trusted time blocks Until decisions and failed return preserves checkpoint until valid cancellation retry', async () => {
 const h=await create();
 try{
  unchanged(h,()=>h.step(packet(0,0,{trusted:false}),event(h,'temporary','unknown-until',[typed(artifact,'duration',600000)],{lifetime:{kind:'Until',dateTimeMs:5000}})),/trusted time/);
  const startPacket=packet(0),startResult=h.step(startPacket,event(h,'temporary','original',[typed(artifact,'duration',600000)],{lifetime:{kind:'Until',dateTimeMs:5000}}));
  const before=h.snapshot(),blocked=h.step(packet(1,0,{trusted:false}));assert.equal(blocked.accepted,false);assert.equal(blocked.outcome,null);
  assert.equal(blocked.snapshot.validity,'unavailable');assert.deepEqual(blocked.snapshot.core,before.core);assert.deepEqual(blocked.snapshot.overlays,before.overlays);
  const cancel=event(h,'cancel','cancel-retry',null,{cancelOverlayIds:['original']});
  const failed=h.step(packet(2,0,{trusted:false,den:0}),cancel);assert.equal(failed.accepted,false);assert.equal(failed.snapshot.validity,'unavailable');
  assert.deepEqual(failed.snapshot.core,before.core);assert.equal(failed.snapshot.overlays[0].overlayId,'original');
  const retry=h.step(packet(2,0,{trusted:false}),cancel);assert.equal(retry.accepted,true);assert.equal(retry.snapshot.validity,'available');
  assert.equal(retry.outcome.vm.safe.duration_ms,300000);assert.equal(retry.snapshot.overlays.length,0);
  const completed=h.checkpoint();
  for(const mutate of [r=>{delete r.cancelOverlayIds;},r=>{r.cancelOverlayIds=['forged-overlay'];}]){
   const bad=structuredClone(completed);mutate(bad.body.history.at(-1).request);bad.sha256=sha256Hex(canonicalJson(bad.body));
   await assert.rejects(create(artifact,{runId:'cancel-restore',boot:2,checkpoint:bad,restoreApproved:true}),/cancel|binding/);
  }
  const restored=await create(artifact,{runId:'completed-cancel',boot:2,checkpoint:completed,restoreApproved:true});restored.dispose();
  const goodBefore=h.snapshot();unchanged(h,()=>h.step(packet(3),cancel),/stale|duplicate/);assert.deepEqual(h.snapshot(),goodBefore);
  compareNative(artifact,[{p:startPacket,r:startResult},{p:packet(2,0,{trusted:false,den:0}),r:failed},{p:packet(2,0,{trusted:false}),r:retry}]);
 }finally{h.dispose();}
});

test('REF-05-018 corrupt checkpoint and unapproved return provenance reject without creating a new Program overlay', async () => {
 const h=await create();let saved;
 try{h.step(packet(0),event(h,'temporary','stored-overlay',[typed(artifact,'duration',600000)],{lifetime:{kind:'Until',dateTimeMs:5000}}));saved=h.checkpoint();}
 finally{h.dispose();}
 for(const change of [c=>{c.body.overlays[0].changes[0].returnResult.value=1;},c=>{c.body.core.checkpoint='00';},c=>{c.body.sourceSha256='a'.repeat(64);}]){
  const invalid=structuredClone(saved);change(invalid);await assert.rejects(create(artifact,{runId:'fresh-run',boot:2,checkpoint:invalid,restoreApproved:true}),/digest/);
 }
});

test('REF-05-018 uncertain expiry and restored actor permission block decisions until explicit whole-overlay recovery', async () => {
 const h=await create();let saved;
 try{
  h.step(packet(0),event(h,'temporary','uncertain-until',[typed(artifact,'duration',600000)],{lifetime:{kind:'Until',dateTimeMs:5000}}));saved=h.checkpoint();
  const uncertain=packet(1,4999);uncertain.contextFacts.clock.uncertaintyMs=100;
  const before=h.snapshot(),blocked=h.step(uncertain);assert.equal(blocked.accepted,false);assert.match(blocked.snapshot.unavailableReason,/uncertainty/);
  assert.deepEqual(blocked.snapshot.core,before.core);assert.deepEqual(blocked.snapshot.overlays,before.overlays);
  const proved=packet(2,5100);proved.contextFacts.clock.uncertaintyMs=100;
  const returned=h.step(proved);assert.equal(returned.accepted,true);assert.equal(returned.outcome.vm.safe.duration_ms,300000);assert.equal(returned.snapshot.overlays.length,0);
 }finally{h.dispose();}
 const restored=await create(artifact,{runId:'new-run',boot:2,checkpoint:saved,restoreApproved:true,grants:{operator:[],admin:artifact.manifest.configs.map(c=>c.id)}});
 try{
  const before=restored.snapshot(),blocked=restored.step(packet(0,1000,{boot:2}));assert.equal(blocked.accepted,false);
  assert.match(blocked.snapshot.unavailableReason,/permission/);assert.deepEqual(blocked.snapshot.core,before.core);
  const recovery=event(restored,'ordinary','admin-recovery',[typed(artifact,'duration',420000)],{actor:'admin',cancelOverlayIds:['uncertain-until']});
  const r=restored.step(packet(0,1000,{boot:2}),recovery);assert.equal(r.accepted,true);assert.equal(r.outcome.vm.safe.duration_ms,420000);assert.equal(r.snapshot.overlays.length,0);
  compareNative(artifact,[{p:packet(0,1000,{boot:2}),r}],{boot:2,checkpoint:saved.body.core.checkpoint});
 }finally{restored.dispose();}
});

test('REF-05-018 invalid ordinary replacement removes the entire overlay atomically with SettingsInvalid and forged source or actor reject', async () => {
 const forged=structuredClone(artifact);forged.sourceDocument.text+='\n';await assert.rejects(create(forged),/source\/artifact identity/);
 const h=await create();
 try{
  h.step(packet(0),event(h,'temporary','compound-group',[typed(artifact,'duration',600000),typed(artifact,'duty',80)],{lifetime:{kind:'Run'}}));
  unchanged(h,()=>h.step(packet(1),event(h,'temporary','nested-cancel',[typed(artifact,'duration',660000)],{lifetime:{kind:'Run'},cancelOverlayIds:['compound-group']})),/cancel first/);
  unchanged(h,()=>h.step(packet(1),event(h,'cancel','forged-actor',null,{actor:'unknown',cancelOverlayIds:['compound-group']})),/permission/);
  const before=h.snapshot(),invalid=h.step(packet(1),event(h,'ordinary','invalid-return',[typed(artifact,'duration',1)],{cancelOverlayIds:['compound-group']}));
  assert.equal(invalid.accepted,true);assert.equal(invalid.snapshot.overlays.length,0);assert.equal(invalid.snapshot.core.state.settingsRevision,before.core.state.settingsRevision+1);
  assert.ok(invalid.snapshot.core.state.settings.every(c=>c.result.ok===false&&c.result.fault==='SettingsInvalid'));
  assert.equal(invalid.snapshot.history.at(-1).effects[0].returnDisposition,'fault-emission');
  assert.deepEqual([invalid.outcome.vm.safe.duration_ms,invalid.outcome.vm.safe.duty_pct],[0,0]);
  const faultRestore=await create(artifact,{runId:'fault-restore',boot:2,checkpoint:h.checkpoint(),restoreApproved:true});
  try{assert.ok(faultRestore.snapshot().ordinary.every(c=>!c.result.ok));
   const recovered=faultRestore.step(packet(0,0,{boot:2}),event(faultRestore,'ordinary','restored-fault-recovery',[typed(artifact,'duration',420000),typed(artifact,'duty',50)]));
   assert.deepEqual([recovered.outcome.vm.safe.duration_ms,recovered.outcome.vm.safe.duty_pct],[420000,50]);
  }finally{faultRestore.dispose();}
  unchanged(h,()=>h.step(packet(2),event(h,'temporary','fault-return',[typed(artifact,'duration',420000)],{lifetime:{kind:'Run'}})),/envelope|return validity/);
  const retry=h.step(packet(2),event(h,'ordinary','valid-ordinary-recovery',[typed(artifact,'duration',420000),typed(artifact,'duty',50)]));
  assert.equal(retry.accepted,true);assert.deepEqual([retry.outcome.vm.safe.duration_ms,retry.outcome.vm.safe.duty_pct],[420000,50]);assert.equal(retry.snapshot.core.state.settingsRevision,3);
 }finally{h.dispose();}
});

test('REF-05-018 approved digest-correct restore revalidates every overlay provenance field and repeated restart preserves revision and run-local position', async () => {
 const h=await create();let saved;
 try{
  h.step(packet(0),event(h,'ordinary','ordinary-both',[typed(artifact,'duration',420000),typed(artifact,'duty',60)]));
  h.step(packet(1),event(h,'temporary','full-provenance',[typed(artifact,'duration',600000)],{lifetime:{kind:'Until',dateTimeMs:5000}}));saved=h.checkpoint();
 }finally{h.dispose();}
 for(const change of [o=>{delete o.permissions;},o=>{o.permissions=[];},o=>{o.createdAt.monotonicMs=-1;},o=>{o.expiry.dateTimeMs=6000;},o=>{o.rollbackProvenance.returnTarget=[];},o=>{o.rollbackProvenance.ordinaryRevision=99;},o=>{o.creationEvent='forged-event';}]){
  const invalid=structuredClone(saved);change(invalid.body.overlays[0]);invalid.sha256=sha256Hex(canonicalJson(invalid.body));
  await assert.rejects(create(artifact,{runId:'new-run',boot:2,checkpoint:invalid,restoreApproved:true}),/provenance|permission|envelope|binding/);
 }
 for(const change of [b=>{b.overlays[0].permissions.reverse();},b=>{b.history[0].actor='';},b=>{b.history[0].reason=42;},b=>{b.history[0].settingsRevision=99;},b=>{b.history[0].applicationPosition=99;},b=>{b.history[0].effects=[{kind:'forged'}];},b=>{b.history[0].effects[0].targets=[999];},b=>{b.history[1].effects[0].grantSnapshot=[];},b=>{delete b.history[1].request.lifetime;},b=>{b.history[1].request.lifetime.dateTimeMs=6000;},b=>{b.history[1].request.changes[0].result.value=660000;},b=>{b.history[0].request.changes[0].result.value=480000;},b=>{b.history[0].request.changes[0].result.value=480000;b.history[0].effects[0].requestedChanges[0].result.value=480000;},b=>{b.history[0].request.changes[0].result.value=480000;b.history[0].effects[0].requestedChanges[0].result.value=480000;b.history[0].effects[0].committedChanges[0].result.value=480000;}]){
  const invalid=structuredClone(saved);change(invalid.body);invalid.sha256=sha256Hex(canonicalJson(invalid.body));
  await assert.rejects(create(artifact,{runId:'new-run',boot:2,checkpoint:invalid,restoreApproved:true}),/provenance|permission|envelope|binding|identity/);
 }
 const second=await create(artifact,{runId:'second-run',boot:2,checkpoint:saved,restoreApproved:true});let secondSaved;
 try{const r=second.step(packet(0,5000,{boot:2}));assert.equal(r.outcome.vm.safe.duration_ms,420000);assert.equal(r.outcome.vm.safe.duty_pct,60);secondSaved=second.checkpoint();}
 finally{second.dispose();}
 const live=await create(artifact,{runId:'live-new-run',boot:2,checkpoint:saved,restoreApproved:true});let contradictory;
 try{live.step(packet(0,1000,{boot:2}),event(live,'ordinary','later-ordinary',[typed(artifact,'duty',60)]));contradictory=live.checkpoint();}finally{live.dispose();}
 contradictory.body.history.at(-1).effects=structuredClone(secondSaved.body.history.at(-1).effects);
 contradictory.sha256=sha256Hex(canonicalJson(contradictory.body));
 await assert.rejects(create(artifact,{runId:'contradiction',boot:3,checkpoint:contradictory,restoreApproved:true}),/active overlay binding|request effect binding|payload binding/);
 const duplicate=structuredClone(secondSaved);duplicate.body.history.at(-1).effects.push(structuredClone(duplicate.body.history.at(-1).effects[0]));
 duplicate.sha256=sha256Hex(canonicalJson(duplicate.body));
 await assert.rejects(create(artifact,{runId:'duplicate-return',boot:3,checkpoint:duplicate,restoreApproved:true}),/duplicate return binding/);
 for(const change of [b=>{b.history[2].effects[0].creationEvent='unknown';},b=>{b.history[2].effects[0].returnDisposition='fault-emission';},b=>{b.history[2].effects[0].returnDisposition='superseded-by-ordinary';},b=>{b.history[2].effects[0].returnDisposition='superseded-by-ordinary';b.history[2].effects.push({kind:'ordinary',targets:[config(artifact,'duration').id]});},b=>{b.history[2].effects[0].returnValues[0].value=1;},b=>{const e=b.history[2].effects[0];e.returnTarget=[config(artifact,'duty').id];e.returnValues=[{ok:true,type:'Percent',value:60}];e.effectiveResults=[{configId:config(artifact,'duty').id,result:{ok:true,type:'Percent',value:60}}];}]){
  const invalid=structuredClone(secondSaved);change(invalid.body);invalid.sha256=sha256Hex(canonicalJson(invalid.body));
  await assert.rejects(create(artifact,{runId:'third-run',boot:3,checkpoint:invalid,restoreApproved:true}),/provenance|binding|range/);
 }
 const third=await create(artifact,{runId:'third-run',boot:3,checkpoint:secondSaved,restoreApproved:true});
 try{const r=third.step(packet(0,5001,{boot:3}));assert.equal(r.outcome.vm.safe.duration_ms,420000);assert.equal(r.outcome.vm.safe.duty_pct,60);assert.equal(r.outcome.vm.safe.counter,1);}
 finally{third.dispose();}
});

test('REF-05-018 TimeSlots temporary return preserves ordinary row identities and rejects unknown or unallocated keys', async () => {
 const a=await compileSource('control S { config slots: TimeSlots<15min,3> = [time`06:00`] { access = operator; } output y: Bool; y <- false; }',{filename:'temporary-slot-return.ghost'});
 const h=await create(a);const tape=[];
 const p=at=>({...packet(at),inputs:{}});
 try{
  const original=h.snapshot().ordinary[0].result.value;
  unchanged(h,()=>h.step(p(0),event(h,'temporary','bad-key',[typed(a,'slots',{kind:'slots',entries:[{key:99,minuteOfDay:480}]})],{lifetime:{kind:'Run'}})),/key identity/);
  const changed=h.step(p(0),event(h,'temporary','slot-overlay',[typed(a,'slots',{kind:'slots',entries:[{key:0,minuteOfDay:480}]})],{lifetime:{kind:'Run'}}));tape.push({p:p(0),r:changed});
  const returned=h.step(p(1),event(h,'cancel','return-slots',null,{cancelOverlayIds:['slot-overlay']}));tape.push({p:p(1),r:returned});
  assert.equal(returned.accepted,true);assert.deepEqual(returned.snapshot.core.state.settings[0].result.value,original,'temporary absence is not ordinary row deletion');
  compareNative(a,tape);
 }finally{h.dispose();}
});
