import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {compileSource} from '../tools/toolchain.mjs';
import {solarContextEvidence} from '../runtimes/wasm/context-abi.mjs';
import {SolarEvidenceRuntime} from '../runtimes/wasm/solar-evidence-runtime.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const document=fs.readFileSync(path.join(root,'tests/fixtures/issue-145-solar-config.ghost.md'),'utf8');
const wasm=fs.readFileSync(path.join(root,'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const activation={bootEpoch:7,terminalCapacity:32,bindings:[]};
async function fixture(t) {
  const artifact=await compileSource(document,{filename:'solar-admitted-evidence.ghost.md'});
  const recorder=await SolarEvidenceRuntime.instantiate(wasm,artifact,{context:activation,runId:'run.ref-03-028.1'});
  t.after(()=>recorder.dispose());
  return{artifact,recorder};
}
function frame(artifact,nowMs,wallMs,{provider='prediction.r1',context='site.r4',planned=1000,available=true}={}) {
  return{nowMs,inputs:{divisor:1},contextFacts:{clock:{monotonicMs:nowMs,wallMs,bootEpoch:7,
    uncertaintyMs:0,trusted:true,unknownReason:null,sourceRevision:'clock.r3'},natural:[],schedules:[],settings:null,
    solars:artifact.manifest.schedules.map(d=>solarContextEvidence(d,{site:d.site,coverageFromWallMs:0,
      coverageToWallMs:86_400_000,rows:[{sourceDay:0,scheduledWallMs:available?planned:null,available,
        ...(available?{}:{unavailableReason:4}),providerRevision:provider,contextRevision:context}]}))}};
}
function native(t,artifact,frames) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ghostflow-solar-evidence-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const module=path.join(dir,'source.gfb'),tape=path.join(dir,'facts.json');
  fs.writeFileSync(module,artifact.bytes);
  fs.writeFileSync(tape,JSON.stringify({profile:'context-solar-v1',activation,steps:frames.map((f,scanId)=>({
    scanId,logicalTimeMs:f.nowMs,inputs:[{name:'divisor',value:f.inputs.divisor}],...f.contextFacts}))}));
  return execFileSync(path.join(root,'target/release/examples/context_tape'+(process.platform==='win32'?'.exe':'')),
    [module,tape],{encoding:'utf8'}).trim().split('\n').map(l=>JSON.parse(l));
}

test('REF-03-028 accepted due false scans bind AlreadyAdmitted occurrence and current revisions to actual native WASM evidence',async t=>{
  const original=JSON.parse(fs.readFileSync(path.join(root,'tests/reference/cases/02-time-control.json'),'utf8'))
    .cases.find(c=>c.id==='REF-03-028');
  assert.equal(original.issue,'https://github.com/callin2/ghostflow-language/issues/217');
  assert.equal(original.status,'specified');assert.equal(original.scope,'host');
  const{artifact,recorder}=await fixture(t);
  const frames=[frame(artifact,0,900),frame(artifact,100,1000),frame(artifact,101,1001),
    frame(artifact,102,1002,{provider:'prediction.r2',context:'site.r5',planned:999})];
  const rows=frames.map(f=>recorder.step(f)),records=native(t,artifact,frames);
  assert.ok(records.every(r=>r.accepted));
  assert.deepEqual(rows.map(r=>r.outcome),records.map(r=>r.outcome));
  assert.deepEqual(rows.map(r=>r.checkpoint),records.map(r=>r.checkpoint));
  assert.deepEqual(rows.map(r=>r.outcome.trace.safe.due),[false,true,false,false]);
  for(const d of artifact.manifest.schedules) {
    const admission=rows[1].observations.find(r=>r.site===d.site&&r.disposition==='Due');
    assert.ok(admission);assert.equal(admission.booleanProjection,true);
    const repeated=rows[2].observations.find(r=>r.site===d.site&&r.disposition==='AlreadyAdmitted');
    assert.ok(repeated);assert.equal(repeated.booleanProjection,false);
    assert.equal(repeated.occurrenceId,admission.occurrenceId);
    assert.equal(repeated.admission.admissionScanId,1);assert.equal(repeated.sourceDay,0);
    assert.equal(repeated.plannedWallMs,1000);assert.equal(repeated.providerRevision,'prediction.r1');
    assert.equal(repeated.coverageStartMs,0);assert.equal(repeated.coverageEndMs,86_400_000);
    assert.equal(repeated.contextRevision,'site.r4');assert.equal(repeated.scheduleId,d.name);
    assert.deepEqual(rows[2].frame,{scanId:2,logicalTimeMs:101});
    assert.equal(rows[2].runId,'run.ref-03-028.1');assert.equal(rows[2].sourceSha256,artifact.sourceDocument.sha256);
    assert.equal(rows[2].artifactSha256,artifact.manifest.bytecodeSha256);
    assert.equal(rows[2].clock.sourceRevision,'clock.r3');
    const revised=rows[3].observations.find(r=>r.site===d.site&&r.disposition==='AlreadyAdmitted');
    assert.equal(revised.occurrenceId,admission.occurrenceId);assert.equal(revised.plannedWallMs,999);
    assert.equal(revised.providerRevision,'prediction.r2');assert.equal(revised.contextRevision,'site.r5');
    assert.equal(revised.admission.providerRevision,'prediction.r1');
    assert.equal(revised.admission.plannedWallMs,1000,'admission metadata and current prediction remain distinct');
  }
  const replay=await SolarEvidenceRuntime.instantiate(wasm,artifact,{context:activation,runId:'run.ref-03-028.1'});
  t.after(()=>replay.dispose());assert.deepEqual(frames.map(f=>replay.step(f)),rows,'fresh activation deterministically replays recorded facts');
  const multi=await SolarEvidenceRuntime.instantiate(wasm,artifact,{context:activation,runId:'run.multi'});
  t.after(()=>multi.dispose());
  const multiFrames=[frame(artifact,0,900),frame(artifact,100,1000),frame(artifact,200,86_400_900),
    frame(artifact,300,86_401_000)];
  for(const f of multiFrames)for(const solar of f.contextFacts.solars) {
    solar.coverageEndMs=259_200_000;
    solar.rows.push({...structuredClone(solar.rows[0]),sourceDay:1,scheduledWallMs:86_401_000});
  }
  const multiRows=multiFrames.map(f=>multi.step(f));
  assert.deepEqual(multiRows.map(r=>r.outcome),native(t,artifact,multiFrames).map(r=>r.outcome));
  assert.equal(multiRows[3].outcome.trace.safe.due,true);
  for(const d of artifact.manifest.schedules) {
    const current=multiRows[3].observations.filter(r=>r.site===d.site);
    assert.ok(current.some(r=>r.disposition==='Due'));
    const prior=current.find(r=>r.disposition==='AlreadyAdmitted');assert.ok(prior);
    assert.equal(prior.booleanProjection,true,'same-scan schedule Bool includes the next occurrence');
    assert.equal(prior.occurrenceDue,false,'the retained old occurrence is not readmitted');
  }
});

test('REF-03-028 rejected evidence and missed boot occurrences never manufacture admitted provenance',async t=>{
  const{artifact,recorder}=await fixture(t);
  const atBoot=recorder.step(frame(artifact,0,1100));
  assert.equal(atBoot.outcome.trace.safe.due,false);
  const later=recorder.step(frame(artifact,1,1101));
  assert.ok(!later.observations.some(r=>r.disposition==='AlreadyAdmitted'),'terminalized boot miss is not an admission');
  const before=recorder.observe(),checkpoint=recorder.contextSnapshot();
  const invalid=frame(artifact,2,1102);invalid.contextFacts.solars[0].latitude=37;
  assert.throws(()=>recorder.step(invalid),/binding|context|Solar/i);
  assert.deepEqual(recorder.observe(),before);assert.deepEqual(recorder.contextSnapshot(),checkpoint);
  const retried=recorder.step(frame(artifact,2,1102));assert.equal(retried.frame.scanId,2);
  const exported=recorder.observe();exported[0].runId='mutated';exported[0].observations.splice(0);
  assert.notEqual(recorder.observe()[0].runId,'mutated');
  const stale=recorder.step(frame(artifact,3,1103,{available:false,provider:'prediction.stale'}));
  assert.ok(stale.observations.some(r=>r.unavailableReason===4&&r.providerRevision==='prediction.stale'));
  assert.ok(!stale.observations.some(r=>r.disposition==='AlreadyAdmitted'));
  await assert.rejects(SolarEvidenceRuntime.instantiate(wasm,artifact,{context:activation}),/run identity/);
  for (const corrupt of [
    a=>{a.traceMetadata.moduleFingerprint='0'.repeat(16);},
    a=>{a.traceMetadata.sourceDocumentSha256='f'.repeat(64);},
    a=>{a.traceMetadata.bytecodeSha256='e'.repeat(64);},
    a=>{a.manifest.schedules[0].name='forged_dawn';},
  ]) {
    const forged=structuredClone(artifact);corrupt(forged);
    await assert.rejects(SolarEvidenceRuntime.instantiate(wasm,forged,{context:activation,runId:'forged'}),/source|trace|fingerprint|revision/i);
  }
});
