import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { compileControl } from '../tools/control.mjs';
import { previewLegacyScalarMigration, inspectLegacyAdmissionSource, assertLegacyAdmissionTarget,
  validateLegacyAdmission, preflightLegacyAdmission } from '../tools/legacy-admission.mjs';
import { ControlRuntime, selectControlRuntimeEntry } from '../runtimes/wasm/control-runtime.mjs';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';
import { verifyArtifactSourceMap } from '../tools/toolchain.mjs';

const source = '# Preserved intent\n\n```ghost\ncontrol latch {\n input start, stop: Bool;\n state running: Bool = false;\n output pump: Bool;\n running\' = if stop then false else running || start;\n pump <- running\';\n}\n```\n\nOriginal history stays unchanged.\n';
const preview = previewLegacyScalarMigration(source);
const artifact = compileSourceSync(preview.document);
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const rejects = (action, code = 'legacy_admission_invalid') => assert.throws(action, error => error.code === code && error.diagnosticCode === 'GF_SEMANTIC' && error.status === 422);
const clone = value => JSON.parse(JSON.stringify(value));

test('deterministic preview preserves exact original bytes and binds acyclic strict receipt', () => {
  assert.ok(preview.document.startsWith(source));
  assert.deepEqual(preview, previewLegacyScalarMigration(source, { filename: 'other.ghost.md' }));
  const { previewSha256, ...body } = preview.receipt;
  assert.equal(previewSha256, sha256Hex(canonicalJson(body)));
  assert.equal(body.originalSourceSha256, sha256Hex(source));
  assert.equal(body.convertedSourceSha256, sha256Hex(preview.document));
  assert.equal(body.contractSha256, artifact.manifest.legacyAdmission.sha256);
  assert.deepEqual(validateLegacyAdmission(artifact), preview.legacyAdmission);
  assert.deepEqual(inspectLegacyAdmissionSource(preview.document,{bound:true}),preview.legacyAdmission);
  assert.deepEqual(artifact.manifest.inputs, [{name:'start',type:'Bool'},{name:'stop',type:'Bool'}]);
  assert.deepEqual(artifact.manifest.sensors, []);
});

test('source exports and signed packages replay the guarded compiler without losing admission', async () => {
  const map={format:'GhostFlow/source-map-v1',bytecodeSha256:artifact.manifest.bytecodeSha256,
    sourceDocument:artifact.sourceDocument,nodes:artifact.sourceMap,lines:artifact.extractionMap,
    traceMetadata:artifact.traceMetadata,interactionSchema:artifact.interactionSchema,interactionSourceIdentity:artifact.interactionSourceIdentity};
  assert.deepEqual(verifyArtifactSourceMap(map,artifact.bytes,{manifest:artifact.manifest}),artifact.sourceDocument);
  const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const identity={compilerRevision:'test-legacy-admission-v1',runtimeSemantics:'GhostFlow/runtime-semantics-v1',
    runtimeAbi:'GhostFlow/framed-scan-abi-v1',bindingRevision:'test-binding-v1',requiredCapabilities:[
      {kind:'input',name:'start',type:'bool'},{kind:'input',name:'stop',type:'bool'},{kind:'actuator',name:'pump',type:'bool'}]};
  const signed=await buildPortablePackage(artifact,identity,{signers:[{keyId:'legacy-test',privateKey:keys.privateKey}],
    verifyCompilation:(text,options)=>compileSourceSync(text,options),onDiagnostic:()=>{}});
  let loaded=false;
  const verified=await verifyPortablePackage(signed,{trustedKeys:[{keyId:'legacy-test',publicKey:keys.publicKey}],revokedKeyIds:[],
    expectedCompilerRevision:identity.compilerRevision,supportedRuntimeSemantics:[identity.runtimeSemantics],supportedRuntimeAbis:[identity.runtimeAbi],
    supportedManifestFormats:['GhostFlow/control-v1'],availableCapabilities:identity.requiredCapabilities,expectedBindingRevision:identity.bindingRevision,
    verifyBytecode:async(bytes,{manifest})=>{const runtime=await ControlRuntime.instantiateFramed(wasm,{bytes,manifest});runtime.dispose();loaded=true;return true;}});
  assert.ok(loaded);assert.deepEqual(verified.manifest.legacyAdmission,preview.legacyAdmission);
});

test('normal input semantics remain Result and typed programs do not migrate', () => {
  assert.throws(() => compileSourceSync(source));
  const typed = source.replace('if stop then','if (stop |> recover(true)) then').replace('running || start','running || (start |> recover(false))');
  const result = compileSourceSync(typed);
  assert.equal(validateLegacyAdmission(result),null);
  rejects(() => previewLegacyScalarMigration(typed),'legacy_migration_not_required');
  rejects(() => previewLegacyScalarMigration(preview.document),'legacy_migration_not_required');
  rejects(() => previewLegacyScalarMigration(source.replace('start, stop: Bool','start, stop: Number')),'legacy_admission_unsupported');
  rejects(() => previewLegacyScalarMigration(source.replace('start, stop: Bool','start?, stop: Bool')),'legacy_admission_unsupported');
});

test('known legacy origin explicitly preserves required unused Bool ports', async () => {
  const unused='```ghost\ncontrol unused { input unused_port: Bool; state scans: Bool = false; output lamp: Bool; scans\' = !scans; lamp <- scans\'; }\n```\n';
  assert.ok(compileSourceSync(unused));
  rejects(()=>previewLegacyScalarMigration(unused),'legacy_migration_not_required');
  rejects(()=>previewLegacyScalarMigration(unused,{sourceInputContract:'invented'}),'legacy_admission_unsupported');
  const migrated=previewLegacyScalarMigration(unused,{sourceInputContract:'required-current-bool-snapshot'});
  const compiled=compileSourceSync(migrated.document);
  assert.deepEqual(compiled.manifest.inputs,[{name:'unused_port',type:'Bool'}]);
  const runtime=await ControlRuntime.instantiateFramed(wasm,compiled);
  try {
    const before=Buffer.from(runtime.exports.memory.buffer);
    rejects(()=>runtime.step({nowMs:1,inputs:{}}),'legacy_admission_frame_rejected');
    assert.deepEqual(Buffer.from(runtime.exports.memory.buffer),before);
    assert.equal(runtime.lastNowMs,null);
    assert.equal(runtime.step({nowMs:1,inputs:{unused_port:false}}).vm.safe.lamp,true);
  } finally {runtime.dispose();}
});

test('reference entry selection retains non-context Solar without an error fallback', () => {
  assert.equal(selectControlRuntimeEntry({format:'GhostFlow/control-v3',schedules:[{kind:'solar'}]}),'legacy');
  assert.equal(selectControlRuntimeEntry({format:'GhostFlow/control-v12',schedules:[{kind:'solar'}]}),'legacy');
  assert.equal(selectControlRuntimeEntry({format:'GhostFlow/control-v15',schedules:[{kind:'solar'}]}),'framed');
  assert.equal(selectControlRuntimeEntry({format:'GhostFlow/control-v21',schedules:[{kind:'civil-range'}]}),'framed');
  assert.equal(selectControlRuntimeEntry(artifact.manifest),'framed');
  assert.equal(selectControlRuntimeEntry({...artifact.manifest,objectives:[{name:'native-objective'}]}),'legacy');
});

test('source directives fail closed and physical targets reject before compiler selection', () => {
  assert.equal(inspectLegacyAdmissionSource(source),null);
  assert.ok(inspectLegacyAdmissionSource(preview.document));
  assertLegacyAdmissionTarget(preview.document,{supported:true});
  rejects(() => assertLegacyAdmissionTarget(preview.document,{supported:false}),'legacy_admission_unsupported');
  rejects(() => compileSourceSync(preview.document.replace('admission-v1 {','admission-v2 {')));
  rejects(() => compileSourceSync(preview.document.replace('"contractVersion":1','"contractVersion":2')));
  rejects(() => compileSourceSync(preview.document.replace('"contractVersion":1','"unexpected":0,"contractVersion":1')));
  rejects(() => compileSourceSync(preview.document.replace('input start, stop: Bool','input renamed, stop: Bool')));
  rejects(() => compileSourceSync(preview.document + preview.document.slice(preview.document.indexOf('<!--'), preview.document.indexOf('-->')+3)));
  const fenced = '```text\n'+preview.document.slice(preview.document.indexOf('<!--'),preview.document.indexOf('-->')+3)+'\n```\n';
  assert.equal(inspectLegacyAdmissionSource(fenced),null);
  const events=[];
  rejects(()=>compileSourceSync(preview.document.replace('"contractVersion":1','"contractVersion":2'),{onTelemetry:event=>events.push(event)}));
  assert.deepEqual(events.filter(event=>event.event==='compiler.diagnostic'),[
    {event:'compiler.diagnostic',code:'GF_SEMANTIC',category:'validation',count:1,truncated:false},
  ]);
});

test('metadata, marker, bytes and source cannot be independently removed or mutated', async () => {
  const manifest = clone(artifact.manifest); delete manifest.legacyAdmission;
  rejects(() => validateLegacyAdmission({...artifact,manifest}));
  const changed = clone(artifact.manifest); changed.legacyAdmission.inputs[0].name='renamed';
  rejects(() => validateLegacyAdmission({...artifact,manifest:changed}));
  rejects(() => validateLegacyAdmission({...artifact,sourceDocument:preview.document+'changed'}));
  const bytes = artifact.bytes.slice(); bytes[bytes.length-1]^=1;
  rejects(() => validateLegacyAdmission({...artifact,bytes}));
  const text = new TextDecoder().decode(artifact.bytes);
  const marker = text.indexOf('__gf_legacy_admission_v1_');
  assert.ok(marker>0);
  const changedMarker = artifact.bytes.slice(); changedMarker[marker+25]^=1;
  rejects(() => validateLegacyAdmission({...artifact,bytes:changedMarker,manifest:{...artifact.manifest,bytecodeSha256:sha256Hex(changedMarker)}}));
  // Historical unmarked raw GFB remains supported; source replay is the product authority.
  const raw = compileControl('control raw { input start: Bool; output pump: Bool; pump <- start; }',{rawSnapshotInputs:['start']});
  raw.manifest.bytecodeSha256=sha256Hex(raw.bytes);
  assert.equal(validateLegacyAdmission(raw),null);
  rejects(() => validateLegacyAdmission({...raw,sourceDocument:preview.document}));
  await assert.rejects(ControlRuntime.instantiateFramed(wasm,{...artifact,manifest}), {code:'legacy_admission_invalid'});
});

test('pure admission normalizes Good samples without adding acquisition freshness policy', () => {
  const contract = validateLegacyAdmission(artifact);
  const frame={nowMs:100,inputs:{stop:false},samples:{start:{epoch:0,id:0,timestampMs:1,quality:'Good',value:true}},due:{}};
  const before=clone(frame), normalized=preflightLegacyAdmission(contract,frame);
  assert.deepEqual(frame,before); assert.deepEqual(normalized.inputs,{stop:false,start:true}); assert.deepEqual(normalized.samples,{});
  assert.deepEqual(preflightLegacyAdmission(contract,frame),normalized); // repeated valid identity accepted
  for (const quality of ['NotReady','Disconnected','Stale','Invalid','Bad',0,2,3,4,99]) {
    rejects(()=>preflightLegacyAdmission(contract,{...frame,samples:{start:{...frame.samples.start,quality}}}),'legacy_admission_frame_rejected');
  }
  for (const sample of [{...frame.samples.start,timestampMs:101},{...frame.samples.start,epoch:-1},{...frame.samples.start,id:NaN},{...frame.samples.start,value:1},{...frame.samples.start,extra:1}])
    rejects(()=>preflightLegacyAdmission(contract,{...frame,samples:{start:sample}}),'legacy_admission_frame_rejected');
  rejects(()=>preflightLegacyAdmission(contract,{...frame,inputs:{start:true,stop:false}}),'legacy_admission_frame_rejected');
  let reads=0;
  const getters={nowMs:100,inputs:{get start(){reads++;return reads===1?true:1;},stop:false}};
  assert.deepEqual(preflightLegacyAdmission(contract,getters).inputs,{start:true,stop:false});
  assert.equal(reads,1);
});

for (const framed of [false,true]) test(`${framed?'framed':'legacy'} runtime rejects before all state and clock mutation; next healthy scan matches untouched control`, async () => {
  const instantiate=(framed?ControlRuntime.instantiateFramed:ControlRuntime.instantiate).bind(ControlRuntime);
  const runtime=await instantiate(wasm,artifact), control=await instantiate(wasm,artifact);
  try {
    assert.deepEqual(runtime.legacyAdmission,preview.legacyAdmission);
    const frame={nowMs:1,inputs:{start:true,stop:false}};
    assert.deepEqual(runtime.step(frame),control.step(frame));
    const snapshot=()=>({memory:Buffer.from(runtime.exports.memory.buffer),time:runtime.lastNowMs,outcome:runtime.lastFrameOutcome});
    const before=snapshot();
    for (const invalid of [
      {inputs:{stop:false}}, {inputs:{start:1,stop:false}},
      {inputs:{stop:false},samples:{start:{epoch:1,id:2,timestampMs:2,quality:'Invalid',value:true}}},
      {inputs:{start:true,stop:false},samples:{start:{epoch:1,id:2,timestampMs:2,quality:'Good',value:true}}},
    ]) {
      rejects(()=>runtime.step({nowMs:2,...invalid}),'legacy_admission_frame_rejected');
      assert.deepEqual(snapshot(),before);
    }
    assert.throws(()=>{ runtime.legacyAdmission=null; },TypeError);
    const healthy={nowMs:10000,inputs:{start:false,stop:true}};
    assert.deepEqual(runtime.step(healthy),control.step(healthy));
  } finally {runtime.dispose();control.dispose();}
});
