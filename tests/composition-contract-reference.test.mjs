import { softwareQualityObservations } from './helpers/software-quality-observations.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {compileSource} from '../tools/toolchain.mjs';
import {sha256Hex} from '../tools/sha256.mjs';
import {ControlRuntime} from '../runtimes/wasm/control-runtime.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const doc=code=>'# Composition contract oracle\n\n```ghost\n'+code+'\n```\n';
const child=doc('control Relay { input start: Bool; output pump: Bool; pump <- start |> recover(false); }');
const revision='relay-r301-input-v1',digest=sha256Hex(child),filename='ref-06-015-contract.ghost.md';
const pin=`import Relay from "./relay.ghost.md" revision "${revision}" sha256 "${digest}";`;
const candidate=(conflict=false)=>doc(pin+`\ncontrol Farm {
 input east_start, west_start: Bool;
 output pump, west_pump: Bool;
 instance east: Relay; instance west: Relay;
 connect east.start <- east_start; connect west.start <- west_start;
 connect pump <- east.pump;
 connect ${conflict?'pump':'west_pump'} <- west.pump;
}`);
const closure=[{filename:'relay.ghost.md',revision,text:child}];
async function rejected(source,sourceClosure) {
 try {await compileSource(source,{filename,sourceClosure});assert.fail('invalid candidate must not produce an activatable artifact');}
 catch(error) {assert.notEqual(error.code,'ERR_ASSERTION');assert.equal(error.diagnosticEnvelope.format,'GhostFlow/diagnostics-v1');
  assert.equal(error.diagnosticEnvelope.source.sha256,sha256Hex(source));
  assert.equal(error.diagnosticEnvelope.diagnostics.length,1);return error;}
}

test('REF-06-015 missing pinned dependency reports definition instances ports expected actual and evidence revision before activation', async () => {
 const original=JSON.parse(fs.readFileSync(root+'tests/reference/cases/03-settings-boundaries.json')).cases.find(e=>e.id==='REF-06-015');
 assert.equal(original.issue,'https://github.com/callin2/ghostflow-language/issues/301');
 assert.equal(original.scope,'tooling');assert.equal(original.status,'specified');
 const source=candidate(),error=await rejected(source,[]),diagnostic=error.diagnosticEnvelope.diagnostics[0];
 assert.equal(diagnostic.code,'GF_IMPORT');assert.match(diagnostic.message,/missing imported document/);
 for(const detail of ['definition Relay','east.start','west.start','east.pump','west.pump',`expected revision ${revision}`,`sha256 ${digest}`,'actual missing','supply the exact pinned dependency'])assert.ok(diagnostic.message.includes(detail),detail);
 assert.equal(diagnostic.span.file,filename);
 assert.ok(source.split('\n')[diagnostic.span.start.line-1].includes('import Relay'));
 const wrong=await rejected(source,[{...closure[0],revision:'other-revision'}]);
 assert.match(wrong.message,/import revision mismatch/);
 for(const detail of [`expected revision ${revision}`,'actual revision other-revision','east.start','west.pump'])assert.ok(wrong.message.includes(detail),detail);
});

test('REF-06-015 conflicting output ownership names both definitions instances ports and pinned evidence without choosing a writer', async () => {
 const source=candidate(true),error=await rejected(source,[]),diagnostic=error.diagnosticEnvelope.diagnostics[0];
 assert.match(diagnostic.message,/duplicate supplier for port pump: writers east.pump and west.pump/);
 for(const detail of ['definition Farm','Relay/east/pump','Relay/west/pump','expected one supplier','actual 2',revision,digest,'choose one supplier'])assert.ok(diagnostic.message.includes(detail),detail);
 assert.ok(source.split('\n')[diagnostic.span.start.line-1].includes('connect pump <- west.pump'));
 // Same invalid source with a complete closure still rejects ownership.
 const withDependency=await rejected(source,closure);assert.equal(withDependency.message,error.message);
 const renamedChild=child.replace('control Relay', 'control ActualRelay');
 const aliased=await rejected(source.replace(digest,sha256Hex(renamedChild)), [{...closure[0],text:renamedChild}]);
 assert.match(aliased.message,/import alias Relay\/east\/pump/);
 assert.match(aliased.message,/import alias Relay\/west\/pump/);
 assert.equal(aliased.message.includes('definition Relay'),false,'unresolved import alias must not claim an actual definition identity');
 // Repair ownership only: its independent missing dependency must still reject.
 assert.match((await rejected(candidate(),[])).message,/missing imported document/);
});

test('REF-06-015 repaired pinned composition activates unchanged native and WASM with independent output channels and complete replay',async t=>{
 const source=candidate(),artifact=await compileSource(source,{filename,sourceClosure:closure});
 assert.equal(artifact.sourceDocument.text,source);assert.equal(artifact.sourceDocument.sha256,sha256Hex(source));
 assert.deepEqual(artifact.sourceClosure.documents, [{...closure[0],sha256:digest}]);
 assert.deepEqual(artifact.sourceClosure.instances.map(x=>[x.definition,x.instance]),[['Relay','east'],['Relay','west']]);
 const wasm=fs.readFileSync(root+'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
 const runtime=softwareQualityObservations(await ControlRuntime.instantiateFramed(wasm,artifact));t.after(()=>runtime.dispose());
 const frames=[],outcomes=[],dispatch=runtime.runtime.dispatch.bind(runtime.runtime);
 runtime.runtime.dispatch=frame=>{frames.push(structuredClone(frame));dispatch(frame);outcomes.push(structuredClone(runtime.runtime.outcome));};
 for(const [index,[east_start,west_start]] of [[false,false],[true,false],[false,true],[true,true]].entries())runtime.step({nowMs:index,inputs:{east_start,west_start}});
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ref-06-015-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const module=path.join(directory,'module.gfb'),tape=path.join(directory,'frames.tsv');fs.writeFileSync(module,artifact.bytes);
 fs.writeFileSync(tape,frames.map(frame=>[frame.scanId,frame.logicalTimeMs,...frame.inputs.flatMap(input=>[input.name,input.type==='Bool'?'b':'n',input.value])].join('\t')).join('\n')+'\n');
 const runner=root+'target/release/examples/scan_tape'+(process.platform==='win32'?'.exe':'');
 const native=()=>execFileSync(runner,[module,tape],{encoding:'utf8',timeout:10000}).trim().split('\n').map(JSON.parse);
 const rows=native();assert.ok(rows.every(row=>row.accepted));assert.deepEqual(rows.map(row=>row.outcome),outcomes);assert.deepEqual(native(),rows);
 assert.deepEqual(outcomes.map(o=>o.trace.safe),[{pump:false,west_pump:false},{pump:true,west_pump:false},{pump:false,west_pump:true},{pump:true,west_pump:true}]);
});
