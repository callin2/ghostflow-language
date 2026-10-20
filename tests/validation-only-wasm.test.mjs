import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const lifecycle = `type RestartReason = PowerOn | Brownout | Watchdog | Software | Unknown;
input restart_reason: RestartReason; input restart_event: Bool;`;
const civil = restart => compileSourceSync('```ghost\ncontrol ValidationOnly {\n'+(restart?lifecycle:'')+`
schedule watering: DailySlots<15min> {
 timezone = "Asia/Seoul"; selected = [22:00]; dst_missing = skip; dst_repeated = first;
 basis = range(7h); when = true; cancel_when = false;
 clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip;
}
output pump: Bool; pump <- watering.active;
}\n`+'```\n');

for (const restart of [false,true]) test(`validation-only admits GFB${restart?22:21} without activating or initializing restart`, async () => {
  const artifact = civil(restart), runtime = await FramedGhostFlowRuntime.instantiate(wasm);
  try {
    runtime.load(artifact.bytes); runtime.addCapability('actuator','pump','bool');
    runtime.validate(); runtime.validate();
    assert.throws(()=>runtime.dispatch({scanId:0,logicalTimeMs:0,inputs:[]}),/active|activated/);
    if (restart) {
      assert.throws(()=>runtime.activate(),/restart lifecycle initialization is required/);
      assert.throws(()=>runtime.restartEventPending,/not active/);
      runtime.initializeRestart(4,true);
    } else assert.throws(()=>runtime.activate(),/schedule activation requires runtime bindings/);
    runtime.activateContext({bootEpoch:1,terminalCapacity:8,bindings:[]});
    if (restart) assert.equal(runtime.restartEventPending,true);
    assert.throws(()=>runtime.validate(),/configuring runtime/);
  } finally { runtime.dispose(); }
});

test('validation-only preserves capability rejection and does not select an active strategy', async () => {
  const bytes=compile(parse(tokenize('(module ValidationCaps (strategy run 0 (device (has actuator pump bool)) (intent pump true)))')));
  const runtime=await FramedGhostFlowRuntime.instantiate(wasm);
  try {
    assert.throws(()=>runtime.validate(),/no module installed/);
    runtime.load(bytes);
    assert.throws(()=>runtime.validate(),/no device strategy matches capabilities/);
    runtime.addCapability('actuator','pump','number');
    assert.throws(()=>runtime.validate(),/no device strategy matches capabilities/);
  } finally {runtime.dispose();}
  const accepted=await FramedGhostFlowRuntime.instantiate(wasm);
  try {
    accepted.load(bytes); accepted.addCapability('actuator','pump','bool');
    accepted.validate(); accepted.validate();
    assert.throws(()=>accepted.dispatch({scanId:0,logicalTimeMs:0,inputs:[]}),/active|activated/);
    accepted.activate();
    accepted.dispatch({scanId:0,logicalTimeMs:0,inputs:[]});
    assert.equal(accepted.outcome.trace.tick,1);
  } finally {accepted.dispose();}
  const ambiguous=await FramedGhostFlowRuntime.instantiate(wasm);
  try {
    ambiguous.load(compile(parse(tokenize('(module Ambiguous (strategy first 0 (device true) (intent pump true)) (strategy second 0 (device true) (intent pump false)))'))));
    assert.throws(()=>ambiguous.validate(),/ambiguous winning device strategies/);
  } finally {ambiguous.dispose();}
});
