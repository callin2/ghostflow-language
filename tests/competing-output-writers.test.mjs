import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { softwareQualityObservations } from './helpers/software-quality-observations.mjs';
import { compileSource } from '../tools/compile-source.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const doc = code => `# Exclusive output intent\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const relay = doc('control Relay { input start: Bool; output pump: Bool; pump <- start |> recover(false); }');
const pin = `import Relay from "./relay.ghost.md" revision "relay-input-v2" sha256 "${sha256Hex(relay)}";`;
const closure = [{filename:'relay.ghost.md',revision:'relay-input-v2',text:relay}];
const compile = source => compileSource(source,{filename:'writers.ghost.md',sourceClosure:closure});
const declarations = ['instance east: Relay;','instance west: Relay;'];

test('REF-06-014 competing instance direct writers reject before activation and identify both endpoints in either order', async () => {
  for (const [first,second] of [['east','west'],['west','east']]) {
    for (const instances of [declarations,[...declarations].reverse()]) {
      const source = doc(`${pin}\ncontrol Farm {\ninput east_start, west_start: Bool;\noutput pump: Bool;\n${instances.join('\n')}\nconnect east.start <- east_start;\nconnect west.start <- west_start;\nconnect pump <- ${first}.pump;\nconnect pump <- ${second}.pump;\n}`);
      const secondLine = source.split('\n').findIndex(line => line === `connect pump <- ${second}.pump;`) + 1;
      await assert.rejects(() => compile(source), error => {
        assert.equal(error.name,'ControlCompileError');
        assert.equal(error.filename,'writers.ghost.md');
        assert.equal(error.line,secondLine,'the conflict must point to the second authored writer');
        assert.equal(error.column,9);
        assert.match(error.message,/duplicate supplier for port pump/);
        assert.ok(error.message.includes(`${first}.pump`),'first writer identity must be present');
        assert.ok(error.message.includes(`${second}.pump`),'second writer identity must be present');
        assert.equal(error.diagnosticEnvelope.source.sha256,sha256Hex(source));
        assert.equal(error.diagnosticEnvelope.diagnostics[0].code,'GF_SEMANTIC');
        assert.equal(error.diagnosticEnvelope.diagnostics[0].span.start.line,secondLine);
        return true;
      });
    }
  }
});

test('REF-06-014 root expression and instance connection writer conflicts retain both authored origins', async () => {
  for (const writers of [
    ['connect pump <- east.pump;','pump <- false;'],
    ['pump <- false;','connect pump <- east.pump;'],
  ]) {
    const source = doc(`${pin}\ncontrol Farm {\ninput start: Bool;\noutput pump: Bool;\ninstance east: Relay;\nconnect east.start <- start;\n${writers.join('\n')}\n}`);
    await assert.rejects(() => compile(source), error => {
      assert.match(error.message,/duplicate supplier for (port|output) pump/);
      assert.ok(error.message.includes('east.pump'),'instance connection writer must be named');
      assert.ok(error.message.includes('output expression pump'),'root expression writer must be distinguished');
      assert.equal(error.diagnosticEnvelope.source.sha256,sha256Hex(source));
      return true;
    });
  }
});

test('REF-06-014 distinct authoritative channels preserve each writer value with complete native framed WASM parity', async t => {
  const source = doc(`${pin}\ncontrol Farm {\ninput east_start, west_start: Bool;\noutput east_on, west_on: Bool;\n${declarations.join('\n')}\nconnect east.start <- east_start;\nconnect west.start <- west_start;\nconnect east_on <- east.pump;\nconnect west_on <- west.pump;\n}`);
  const artifact = await compile(source);
  assert.deepEqual(artifact.sourceClosure.instances.map(item=>item.instance),['east','west']);
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm',import.meta.url));
  const runtime = softwareQualityObservations(await ControlRuntime.instantiateFramed(wasm,artifact));
  t.after(()=>runtime.dispose());
  const frames=[],outcomes=[],dispatch=runtime.runtime.dispatch.bind(runtime.runtime);
  runtime.runtime.dispatch = frame=>{frames.push(structuredClone(frame));dispatch(frame);outcomes.push(structuredClone(runtime.runtime.outcome));};
  runtime.step({nowMs:0,inputs:{east_start:true,west_start:false}});
  runtime.step({nowMs:1,inputs:{east_start:true,west_start:false}});
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ghostflow-writer-channels-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const modulePath=path.join(directory,'farm.gfb'),tapePath=path.join(directory,'frames.tsv');
  fs.writeFileSync(modulePath,artifact.bytes);
  fs.writeFileSync(tapePath,frames.map(frame=>[frame.scanId,frame.logicalTimeMs,
    ...frame.inputs.flatMap(input=>[input.name,input.type==='Bool'?'b':'n',input.value])].join('\t')).join('\n')+'\n');
  const nativePath=fileURLToPath(new URL('../target/release/examples/scan_tape'+(process.platform==='win32'?'.exe':''),import.meta.url));
  const native=spawnSync(nativePath,[modulePath,tapePath],{encoding:'utf8',timeout:10_000});
  assert.equal(native.status,0,native.error?.message??native.stderr);
  const rows=native.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,frames.length,'each frame requires a native receipt');
  assert.ok(rows.every(row=>row.accepted));
  assert.deepEqual(rows.map(row=>row.outcome),outcomes);
  assert.deepEqual(outcomes.map(row=>row.trace.safe),[{east_on:true,west_on:false},{east_on:true,west_on:false}]);
});
