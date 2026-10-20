import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from './helpers/literate-compile.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { NativeDispatchError } from '../runtimes/wasm/native-dispatch.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const artifact = await compileSource(`control Recovery {
  input resume: Bool;
  output pump, valve, alarm, acknowledged: Bool;
  state stopped: Bool = false;
  let resume_requested = resume |> recover(false);
  stopped' = if resume_requested then false else stopped || output_fault(pump) == OutputTimeout;
  pump <- !stopped';
  valve <- true;
  alarm <- output_health(pump) == OutputFaulted;
  acknowledged <- output_status(pump) == OutputCompleted && output_completion(pump) == DeviceAck;
}`);
const observation = (output, requestId, status, health, completion, fault) => ({ runId:'run',output,requestId,status,health,completion,fault });
const good = (nowMs, value) => ({epoch:1,id:nowMs+1,timestampMs:nowMs,quality:'Good',value});

test('compiled source continues pending, observes faults and resumes only by its own state rule', async () => {
  let observations = [observation('pump',0,0,1,0,0)];
  const runtime = await ControlRuntime.instantiateFramed(wasm, artifact, {
    outputRunId:'run', outputObservationProvider: () => observations,
  });
  try {
    assert.equal(runtime.step({nowMs:0}).vm.safe.pump,true);
    observations = [observation('pump',1,1,1,0,0)];
    assert.deepEqual(runtime.step({nowMs:1}).vm.safe, {pump:true,valve:true,alarm:false,acknowledged:false});
    observations = [observation('pump',1,2,1,1,0)];
    assert.equal(runtime.step({nowMs:2}).vm.safe.pump,true);
    observations = [observation('pump',2,3,2,0,2)];
    assert.deepEqual(runtime.step({nowMs:3}).vm.safe, {pump:false,valve:true,alarm:true,acknowledged:false});
    observations = [observation('pump',3,2,1,2,0)];
    const recovered = runtime.step({nowMs:4}).vm.safe;
    assert.equal(recovered.pump,false);
    assert.equal(recovered.acknowledged,true);
    assert.equal(runtime.step({nowMs:5,samples:{resume:good(5,true)}}).vm.safe.pump,true);
    observations = [observation('pump',2,3,2,0,2)];
    assert.throws(() => runtime.step({nowMs:6}), /stale/);
  } finally {runtime.dispose();}
});

test('hosts require explicit trusted authority and reject ordinary overrides or stale-run evidence', async () => {
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm,artifact), /trusted provider/);
  await assert.rejects(() => ControlRuntime.instantiate(wasm,artifact,{outputRunId:'run',outputObservationProvider:()=>[]}), /framed host/);
  let records = [observation('pump',0,0,0,0,0)];
  const runtime = await ControlRuntime.instantiateFramed(wasm,artifact,{outputRunId:'run',outputObservationProvider:()=>records});
  try {
    assert.throws(() => runtime.step({nowMs:0,inputs:{__gf_output_pump_status:2}}), /unknown input/);
    assert.throws(() => runtime.step({nowMs:0,outputObservations:records}), /trusted provider/);
    records = [{...records[0],runId:'old'}];
    assert.throws(() => runtime.step({nowMs:0}), /stale output run/);
    records = [observation('pump',0,0,0,0,0)];
    assert.equal(runtime.step({nowMs:0}).vm.safe.pump,true);
  } finally {runtime.dispose();}
  const tampered = structuredClone(artifact); tampered.manifest.outputObservations = [];
  await assert.rejects(() => ControlRuntime.instantiateFramed(wasm,tampered), /descriptors/);
});

test('rejected frames do not consume a staged trusted output receipt', async () => {
  const initial = observation('pump',0,0,1,0,0);
  let records = [initial];
  const runtime = await ControlRuntime.instantiateFramed(wasm,artifact,{outputRunId:'run',outputObservationProvider:()=>records});
  try {
    runtime.step({nowMs:0});
    records = [observation('pump',1,2,1,1,0)];
    assert.throws(() => runtime.step({nowMs:1,samples:{resume:{...good(1,true),id:'invalid'}}}), /id/);
    records = [initial];
    runtime.step({nowMs:1});
    records = [observation('pump',1,2,1,1,0)];
    const dispatch = runtime.runtime.dispatch;
    runtime.runtime.dispatch = () => {throw new NativeDispatchError('reject before commit',{committed:false});};
    assert.throws(() => runtime.step({nowMs:2}), /reject before commit/);
    runtime.runtime.dispatch = dispatch;
    records = [initial];
    assert.equal(runtime.step({nowMs:2}).vm.safe.pump,true);
  } finally {runtime.dispose();}
});
