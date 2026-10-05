import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AccountingRuntime } from '../runtimes/wasm/accounting-runtime.mjs';
import { compileSource } from '../tools/compile-source.mjs';
import { verifyArtifactSourceMap } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const config = { maxIntervals: 256, maxEvents: 8, maxReservations: 8, maxRollingWindowMs: 86_400_000n };
const id = value => { const bytes=new Uint8Array(16);new DataView(bytes.buffer).setBigUint64(0,BigInt(value),true);return bytes; };
const wasmBytes = readFileSync(wasmPath);

const source = '# REF-03-048 local-day applied accounting\n\n```ghost\ncontrol SeoulAppliedPumpLedger {\n'
  + '  resource pump1: BoolActuator;\n'
  + '  account pump_applied = on_time(pump1, stage: applied, persistence: durable);\n'
  + '  constraints PumpBudgets {\n'
  + '    limit used(pump_applied, rolling(24h)) <= 24h { reserve = 1ms; on_unknown = block; }\n'
  + '  }\n'
  + '  output ready: Bool; ready <- false;\n}\n```\n';
const filename = 'ref-03-048-local-day.ghost.md';

test('REF-03-048: Seoul midnight applied pump interval is split per local day and unioned once across overlapping controls', async t => {
  const original = JSON.parse(readFileSync(resolve(root, 'tests/reference/cases/02-time-control.json'), 'utf8'))
    .cases.find(entry => entry.id === 'REF-03-048');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/227');
  assert.equal(original.status, 'specified');
  assert.match(original.rule, /local-day budget/);
  assert.match(original.given, /23:50~00:10/);

  const artifact = await compileSource(source, { filename });
  verifyArtifactSourceMap({ format: 'GhostFlow/source-map-v1', bytecodeSha256: artifact.manifest.bytecodeSha256,
    sourceDocument: artifact.sourceDocument, nodes: artifact.sourceMap, lines: artifact.extractionMap,
    traceMetadata: artifact.traceMetadata, interactionSchema: null, interactionSourceIdentity: null }, artifact.bytes,
  { manifest: artifact.manifest });
  const binding = artifact.manifest.accounting.bindings.find(item => item.name === 'pump_applied');
  assert.deepEqual(binding.evidenceBinding, { kind: 'applied_interval', target: 'pump1', stage: 'applied', identity: 'receipt_id' });
  const rollingLimit = artifact.manifest.accounting.constraints[0].limits[0];
  assert.deepEqual([rollingLimit.account, rollingLimit.basis.kind, rollingLimit.basis.durationMs], ['pump_applied', 'rolling', 86_400_000]);

  // The trusted test host resolves Asia/Seoul local midnight once and supplies
  // caller-validated final applied physical intervals. It does not implement a
  // production timezone provider, Driver receipt validator, or physical proof.
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const civil=wall=>Object.fromEntries(formatter.formatToParts(wall).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  const localDay=wall=>{const p=civil(wall);return Math.floor(Date.UTC(p.year,p.month-1,p.day)/86_400_000);};
  const startWall=Date.parse('2026-10-03T14:50:00Z'),endWall=Date.parse('2026-10-03T15:10:00Z');
  assert.deepEqual(civil(startWall),{year:2026,month:10,day:3,hour:23,minute:50});
  assert.deepEqual(civil(endWall),{year:2026,month:10,day:4,hour:0,minute:10});
  const boundaryCandidates=[];for(let wall=startWall;wall<=endWall;wall+=60_000)if(civil(wall).hour===0&&civil(wall).minute===0)boundaryCandidates.push(wall);
  assert.equal(boundaryCandidates.length,1);const midnightWall=boundaryCandidates[0];
  const originWall=startWall-400_000;
  const seoulDay20261003 = localDay(startWall);
  const seoulDay20261004 = localDay(endWall);
  const midnightMs = BigInt(midnightWall-originWall);
  const beforeMidnightStartMs = midnightMs - 600_000n;
  const afterMidnightEndMs = midnightMs + 600_000n;
  const segments = [
    { receiptId: id(1), resourceId: 7, startMs: beforeMidnightStartMs, endMs: midnightMs, localDay: seoulDay20261003, source: 'control-A-final-applied' },
    { receiptId: id(2), resourceId: 7, startMs: beforeMidnightStartMs + 300_000n, endMs: midnightMs, localDay: seoulDay20261003, source: 'control-B-overlap-final-applied' },
    { receiptId: id(3), resourceId: 7, startMs: midnightMs, endMs: afterMidnightEndMs, localDay: seoulDay20261004, source: 'control-A-final-applied' },
    { receiptId: id(4), resourceId: 7, startMs: midnightMs, endMs: afterMidnightEndMs - 300_000n, localDay: seoulDay20261004, source: 'control-B-overlap-final-applied' },
  ];
  assert.equal(Number((midnightMs - beforeMidnightStartMs) + (afterMidnightEndMs - midnightMs)), 1_200_000);
  assert.equal(segments.reduce((sum, segment) => sum + Number(segment.endMs - segment.startMs), 0), 1_800_000,
    'per-control addition would double count the overlapping physical ON evidence');

  // Two independent compiled controls request the same host-bound resource.
  // These are logical requests; the separately supplied applied receipts above
  // are not inferred as physical facts from the requested/safe values.
  execFileSync('cargo',['build','--locked','--offline','--release','-p','ghostflow-core','--example','scan_tape'],{cwd:root,stdio:'inherit'});
  for(const [name,demand] of [['Automatic',[true,true,true,true,false]],['Manual',[false,true,true,false,false]]]){
    const requestSource='# Independent '+name+' pump request\n\n```ghost\ncontrol '+name+' { input request: Bool; output pump: Bool; pump <- request; }\n```\n';
    const controlArtifact=await compileSource(requestSource,{filename:name.toLowerCase()+'-pump.ghost.md'});
    assert.equal(controlArtifact.sourceDocument.text,requestSource);
    const hostBinding=Object.freeze({control:name,port:'pump',physicalResourceId:7,logicalResource:'pump1'});
    assert.equal(hostBinding.physicalResourceId,segments[0].resourceId);
    const control=await ControlRuntime.instantiateFramed(wasmBytes,controlArtifact);t.after(()=>control.dispose());
    const frames=[],outcomes=[],dispatch=control.runtime.dispatch.bind(control.runtime);
    control.runtime.dispatch=frame=>{frames.push(structuredClone(frame));dispatch(frame);outcomes.push(structuredClone(control.runtime.outcome));};
    demand.forEach((request,i)=>control.step({nowMs:Number(beforeMidnightStartMs)+i*300_000,inputs:{request}}));
    assert.deepEqual(outcomes.map(o=>o.trace.requested.pump),demand);assert.deepEqual(outcomes.map(o=>o.trace.safe.pump),demand);
    const dir=mkdtempSync(join(tmpdir(),'ref-03-048-control-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
    const module=join(dir,'module.gfb'),tape=join(dir,'frames.tsv');writeFileSync(module,controlArtifact.bytes);
    writeFileSync(tape,frames.map(f=>[f.scanId,f.logicalTimeMs,...f.inputs.flatMap(v=>[v.name,'b',v.value])].join('\t')).join('\n')+'\n');
    const runner=resolve(root,'target/release/examples/scan_tape'+(process.platform==='win32'?'.exe':''));
    const native=()=>execFileSync(runner,[module,tape],{encoding:'utf8',timeout:10_000}).trim().split('\n').map(JSON.parse);
    const rows=native();assert.ok(rows.every(r=>r.accepted));assert.deepEqual(rows.map(r=>r.outcome),outcomes);assert.deepEqual(native(),rows);
  }

  const persist = async bytes => { assert(bytes.length > 0); return true; };
  const runtime = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: 'pump_applied', resourceId: 7, config });
  t.after(() => runtime.dispose());
  assert.equal(runtime.source.text, source);
  assert.equal(runtime.source.sha256, artifact.sourceDocument.sha256);
  assert.equal(runtime.source.artifactSha256, artifact.manifest.bytecodeSha256);
  assert.equal(runtime.source.target, 'pump1');
  assert.equal(runtime.source.stage, 'applied');
  await runtime.initializeEmpty(persist);
  let snapshot;
  const wasmRecords=[];
  const capture=()=>[...runtime.snapshot().bytes];
  for (const segment of segments) {
    const before=capture();const status=await runtime.recordAppliedSegment(segment, async (bytes, revision) => { snapshot = { bytes: bytes.slice(), revision }; return true; });
    wasmRecords.push({receiptId:new DataView(segment.receiptId.buffer).getBigUint64(0,true).toString(),status,snapshotBefore:before,snapshotAfter:capture()});
  }
  const expectedDays = [
    { localDay: seoulDay20261003, usedMs: 600_000n },
    { localDay: seoulDay20261004, usedMs: 600_000n },
  ];
  assert.deepEqual(expectedDays.map(({ localDay, usedMs }) => ({ localDay, usedMs: runtime.usedLocalDay(7, localDay) })), expectedDays);
  assert.equal(runtime.usedRolling(7, afterMidnightEndMs, 86_400_000n), 1_200_000n,
    'rolling 24h remains a separate basis over the full physical interval');
  assert.throws(() => runtime.explainRolling({ nowMs: afterMidnightEndMs, windowMs: 60_000n, limitMs: 86_400_000n, reserveMs: 1n }),
    /bound source constraint/, 'source-bound admission/explanation does not silently substitute an unbound rolling window');
  const wrongResourceBefore=runtime.snapshot();let wrongResourcePersistCalls=0;
  await assert.rejects(runtime.recordAppliedSegment({ receiptId: id(9), resourceId: 8,
    startMs: midnightMs, endMs: midnightMs + 1n, localDay: seoulDay20261004 }, ()=>{wrongResourcePersistCalls++;return true;}), /bound resource ID/);
  assert.deepEqual(runtime.snapshot(),wrongResourceBefore);assert.equal(wrongResourcePersistCalls,0);
  assert.deepEqual(expectedDays.map(({ localDay, usedMs }) => ({ localDay, usedMs: runtime.usedLocalDay(7, localDay) })), expectedDays,
    'the source adapter rejects the wrong bound resource before invoking the C ABI');

  const restored = await AccountingRuntime.instantiateSource(wasmBytes, source, { filename, account: 'pump_applied', resourceId: 7, config });
  t.after(() => restored.dispose());
  restored.restore(snapshot.bytes);
  assert.deepEqual([...restored.snapshot().bytes],capture());
  assert.deepEqual(expectedDays.map(({ localDay, usedMs }) => ({ localDay, usedMs: restored.usedLocalDay(7, localDay) })), expectedDays);
  assert.equal(restored.usedRolling(7, afterMidnightEndMs, 86_400_000n), 1_200_000n);

  execFileSync('cargo', ['build', '--locked', '--offline', '--release', '-p', 'ghostflow-core', '--example', 'accounting_tape'], { cwd: root, stdio: 'inherit' });
  const directory = mkdtempSync(join(tmpdir(), 'ref-03-048-accounting-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'module.gfb');
  const tapePath = join(directory, 'tape.json');
  writeFileSync(modulePath, artifact.bytes);
  const request = { moduleFingerprint: artifact.traceMetadata.moduleFingerprint, manifest: artifact.manifest,
    account: 'pump_applied', target: 'pump1', resourceId: 7, windowMs: 86_400_000, maxRollingWindowMs: 86_400_000,
    recordCheckpoints:true,frames: [{ nowMs: Number(afterMidnightEndMs), query: true, dayQueries: [seoulDay20261003, seoulDay20261004],
      segments: segments.map((segment, index) => ({ receiptId: index + 1, resourceId: segment.resourceId,
        startMs: Number(segment.startMs), endMs: Number(segment.endMs), localDay: segment.localDay })) }] };
  const runNative = tape => {
    writeFileSync(tapePath, JSON.stringify(tape));
    return JSON.parse(execFileSync(resolve(root, 'target/release/examples/accounting_tape' + (process.platform === 'win32' ? '.exe' : '')),
      [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000 }));
  };
  const native = runNative(request);
  const {recordObservations,...observations}=native;
  assert.deepEqual(recordObservations.map(r=>({...r,receiptId:String(r.receiptId)})),wasmRecords,'complete native/WASM record results and before/after checkpoints must agree');
  assert.deepEqual(observations, { moduleFingerprint: artifact.traceMetadata.moduleFingerprint,
    account: 'pump_applied', target: 'pump1', stage: 'applied', resourceId: 7,
    observations: [{ nowMs: Number(afterMidnightEndMs), usedMs: 1_200_000 }],
    dayObservations: [
      { nowMs: Number(afterMidnightEndMs), localDay: seoulDay20261003, usedMs: 600_000 },
      { nowMs: Number(afterMidnightEndMs), localDay: seoulDay20261004, usedMs: 600_000 },
    ] });
  assert.deepEqual(runNative(request), native, 'fresh native replay/dedupe is deterministic');
  const duplicateRequest=structuredClone(request);duplicateRequest.frames.push({...structuredClone(request.frames[0]),nowMs:Number(afterMidnightEndMs)+1});
  const duplicateNative=runNative(duplicateRequest);
  const restoredBefore=[...restored.snapshot().bytes],revisionBefore=restored.snapshot().revision;
  for(const segment of segments)assert.equal(await restored.recordAppliedSegment(segment,()=>{assert.fail('duplicate persisted again');}),'Duplicate');
  assert.deepEqual([...restored.snapshot().bytes],restoredBefore);assert.equal(restored.snapshot().revision,revisionBefore);
  assert.ok(duplicateNative.recordObservations.slice(4).every(r=>r.status==='Duplicate'));
  for(const r of duplicateNative.recordObservations.slice(4)){assert.deepEqual(r.snapshotBefore,restoredBefore);assert.deepEqual(r.snapshotAfter,restoredBefore);}
  const rejectedRequest=structuredClone(request),bad={receiptId:9,resourceId:7,startMs:Number(midnightMs),endMs:Number(midnightMs),localDay:seoulDay20261004};
  rejectedRequest.frames.push({nowMs:Number(afterMidnightEndMs)+1,query:true,dayQueries:[seoulDay20261003,seoulDay20261004],segments:[bad,{...bad,endMs:bad.startMs+1},{...bad,endMs:bad.startMs+1}]});
  const rejectedNative=runNative(rejectedRequest);let persistCalls=0;
  const rejectedBefore=[...restored.snapshot().bytes],rejectedRevision=restored.snapshot().revision;
  await assert.rejects(restored.recordAppliedSegment({...bad,receiptId:id(9),startMs:BigInt(bad.startMs),endMs:BigInt(bad.endMs)},()=>{persistCalls++;return true;}),/interval|duration/i);
  assert.equal(persistCalls,0);assert.equal(restored.usedLocalDay(7,seoulDay20261004),null,'invalid applied evidence makes the production ABI conservatively Unknown');assert.ok(restored.snapshot().revision>rejectedRevision);
  restored.restore(new Uint8Array(rejectedBefore));
  const valid={...bad,receiptId:id(9),startMs:BigInt(bad.startMs),endMs:BigInt(bad.startMs+1)};
  assert.equal(await restored.recordAppliedSegment(valid,persist),'Inserted');const retryAfter=[...restored.snapshot().bytes];
  assert.equal(await restored.recordAppliedSegment(valid,()=>{assert.fail('duplicate persisted again');}),'Duplicate');
  const attempts=rejectedNative.recordObservations.slice(4);assert.match(attempts[0].status,/^Rejected:InvalidInterval/);
  assert.deepEqual(attempts[0].snapshotBefore,rejectedBefore);assert.deepEqual(attempts[0].snapshotAfter,rejectedBefore);
  assert.deepEqual(attempts[1],{receiptId:9,status:'Inserted',snapshotBefore:rejectedBefore,snapshotAfter:retryAfter});
  assert.deepEqual(attempts[2],{receiptId:9,status:'Duplicate',snapshotBefore:retryAfter,snapshotAfter:retryAfter});
  const cleanRetry=structuredClone(rejectedRequest);cleanRetry.frames[1].segments.shift();assert.deepEqual(runNative(cleanRetry).recordObservations.at(-1),attempts[2]);
  // The production C ABI adds conservative invalid-evidence handling beyond
  // the primitive ledger. Compare that exact owner on both native and WASM.
  execFileSync('cargo',['build','--locked','--offline','--release','-p','ghostflow-wasm','--example','accounting_local_day_tape'],{cwd:root,stdio:'inherit'});
  const abi=await AccountingRuntime.instantiateSource(wasmBytes,source,{filename,account:'pump_applied',resourceId:7,config});t.after(()=>abi.dispose());
  await abi.initializeEmpty(persist);
  const queryNow=Number(afterMidnightEndMs)+1;
  const steps=[...request.frames[0].segments,...request.frames[0].segments,bad,{restoreLastTrusted:true},{...bad,endMs:bad.startMs+1},{...bad,endMs:bad.startMs+1}].map(s=>({...s,nowMs:queryNow}));
  const abiSnapshot=()=>{const s=abi.snapshot();return {status:1,bytes:[...s.bytes],revision:Number(s.revision)};};
  let lastTrusted=abi.snapshot().bytes.slice();const abiRecords=[];
  for(const step of steps){
    const before=abiSnapshot();let status;
    if(step.restoreLastTrusted){abi.restore(lastTrusted);status=1;}else{
      try{const result=await abi.recordAppliedSegment({...step,receiptId:id(step.receiptId),startMs:BigInt(step.startMs),endMs:BigInt(step.endMs)},persist);status=result==='Inserted'?1:2;}
      catch(error){assert.match(error.message,/interval|duration/i);status=0;}
    }
    if(status===1)lastTrusted=abi.snapshot().bytes.slice();
    const value=n=>n===null?null:Number(n);
    abiRecords.push({status,before,after:abiSnapshot(),rolling:value(abi.usedRolling(7,BigInt(queryNow),86_400_000n)),days:[seoulDay20261003,seoulDay20261004].map(d=>value(abi.usedLocalDay(7,d)))});
  }
  assert.deepEqual(abiRecords.map(r=>r.status),[1,1,1,1,2,2,2,2,0,1,1,2]);
  assert.deepEqual(abiRecords[8].days,[null,null]);assert.equal(abiRecords[8].rolling,null);
  assert.ok(abiRecords[8].after.revision>abiRecords[8].before.revision);
  assert.deepEqual(abiRecords[9].days,[600_000,600_000]);
  const abiRequest={moduleFingerprint:artifact.traceMetadata.moduleFingerprint,manifest:artifact.manifest,account:'pump_applied',target:'pump1',resourceId:7,windowMs:86_400_000,days:[seoulDay20261003,seoulDay20261004],steps};
  writeFileSync(tapePath,JSON.stringify(abiRequest));
  const abiRunner=resolve(root,'target/release/examples/accounting_local_day_tape'+(process.platform==='win32'?'.exe':''));
  const nativeAbi=()=>JSON.parse(execFileSync(abiRunner,[modulePath,tapePath],{encoding:'utf8',timeout:10_000}));
  const abiExpected={moduleFingerprint:artifact.traceMetadata.moduleFingerprint,account:'pump_applied',target:'pump1',resourceId:7,records:abiRecords};
  assert.deepEqual(nativeAbi(),abiExpected,'complete C ABI status, revisions, checkpoints and known/Unknown results must agree');assert.deepEqual(nativeAbi(),abiExpected,'fresh native C ABI replay');
  for (const [mutate, reason] of [
    [tape => { tape.frames[0].segments[0].resourceId = 8; }, /wrong bound resource ID/],
    [tape => { tape.frames[0].segments[0].startMs = tape.frames[0].segments[0].endMs; }, /InvalidInterval|positive duration/],
    [tape => { tape.frames[0].segments[0].endMs = tape.frames[0].nowMs + 1; }, /future applied evidence/],
    [tape => { tape.frames[0].segments[0].localDay = 'not-a-day'; }, /invalid local day/],
    [tape => { tape.frames[0].dayQueries = 'not-an-array'; }, /invalid or oversized day queries/],
    [tape => { tape.frames[0].dayQueries = Array(129).fill(seoulDay20261003); }, /invalid or oversized day queries/],
    [tape => { tape.maxRollingWindowMs = 60_000; }, /window exceeds declared/],
    [tape => { tape.maxRollingWindowMs = 'not-a-window'; }, /invalid exact integer/],
  ]) {
    const invalid = structuredClone(request);
    invalid.recordCheckpoints=false;
    mutate(invalid);
    assert.throws(() => runNative(invalid), reason);
  }
  t.diagnostic(JSON.stringify({ sourceSha256: artifact.sourceDocument.sha256, artifactSha256: artifact.manifest.bytecodeSha256,
    seoulLocalDayUsedMs: expectedDays.map(item => ({ localDay: item.localDay, usedMs: String(item.usedMs) })),
    rolling24hUsedMs: '1200000' }));
});
