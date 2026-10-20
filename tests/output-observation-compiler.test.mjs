import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { dailySlotsRange } from './helpers/range-source.mjs';
import { compileSource } from './helpers/literate-compile.mjs';
import { validateOutputObservationsManifest, validateOutputObservationRails, validateOutputObservation } from '../tools/output-observation-contract.mjs';

const source = `control Observe {
  output pump, valve, alarm: Bool;
  state stopped: Bool = false;
  state last_status: OutputStatus = OutputInitial;
  last_status' = output_status(pump);
  stopped' = stopped || output_fault(pump) == OutputTimeout;
  pump <- !stopped';
  valve <- output_status(pump) == OutputCompleted && output_completion(pump) == DeviceAck;
  alarm <- output_health(pump) == OutputFaulted || output_status(valve) == OutputFailed;
}`;

test('real literate source lowers typed observations once per Bool output on scalar rails', async () => {
  const compiled = await compileSource(source);
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v22');
  assert.deepEqual(compiled.manifest.outputObservations.map(item => item.output), ['pump', 'valve']);
  const version = new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset).getUint16(4, true);
  assert.ok([1,2,3,4].includes(version));
  assert.equal(compiled.manifest.inputs.length, 0);
  assert.equal(validateOutputObservationsManifest(compiled.manifest, version).length, 2);
  validateOutputObservationRails(compiled.manifest, compiled.bytes);
});

test('output builtins reject input/non-Bool/unknown arguments, enum mismatch and incompatible contexts', async () => {
  for (const [body, pattern] of [
    ['input pump: Bool; output alarm: Bool; alarm <- output_status(pump) == OutputInitial;', /declared Bool output/],
    ['output pump: Number; pump <- 1.0; let status = output_status(pump);', /declared Bool output/],
    ['output pump: Bool; pump <- output_status(missing) == OutputInitial;', /declared Bool output/],
    ['output pump: Bool; pump <- output_status(pump) == OutputHealthy;', /matching|same|compatible/],
    ['output pump: Bool; pump <- output_status(pump) == 1.0;', /matching|same|compatible/],
    ['config enabled: Bool = true; output pump: Bool; pump <- output_status(pump) == OutputInitial;', /scalar\/sensor/],
    ['type OutputHealth = Ready; output pump: Bool; pump <- true;', /reserved/],
    ['type Custom = OutputPending; output pump: Bool; pump <- true;', /reserved/],
    ['fn output_status(value: Bool) -> Bool { value } output pump: Bool; pump <- true;', /reserved output builtin/],
  ]) await assert.rejects(() => compileSource(`control Reject { ${body} }`), pattern);
});

test('manifest tampering cannot rebind, remove or downgrade private output rails', async () => {
  const compiled = await compileSource(source);
  const version = new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset).getUint16(4, true);
  for (const change of [
    value => { value.outputObservations[0].healthInput = '__gf_output_valve_health'; },
    value => { value.outputObservations[0].extra = true; },
    value => { value.outputObservations.push(value.outputObservations[0]); },
    value => { value.format = 'GhostFlow/control-v1'; },
  ]) {
    const manifest = structuredClone(compiled.manifest); change(manifest);
    assert.throws(() => validateOutputObservationsManifest(manifest, version));
  }
  const removed = structuredClone(compiled.manifest); removed.outputObservations.pop();
  assert.throws(() => validateOutputObservationRails(removed, compiled.bytes), /unbound/);
  const downgraded = structuredClone(compiled.manifest); delete downgraded.outputObservations;
  assert.throws(() => validateOutputObservationRails(downgraded, compiled.bytes), /unbound/);
});

test('pending and device readiness stay independent, and receipt identity never regresses', () => {
  const initial = {runId:'run',output:'pump',requestId:0,status:0,health:1,completion:0,fault:0};
  validateOutputObservation(initial,'run','pump');
  const pending = {...initial,requestId:1,status:1};
  validateOutputObservation(pending,'run','pump',initial);
  const complete = {...pending,status:2,completion:1};
  validateOutputObservation(complete,'run','pump',pending);
  validateOutputObservation({...complete,health:2,fault:5},'run','pump',complete);
  const failed = {...pending,status:3,health:2,fault:2};
  validateOutputObservation(failed,'run','pump',pending);
  validateOutputObservation({...failed,requestId:2,status:1},'run','pump',failed);
  assert.throws(() => validateOutputObservation(complete,'new-run','pump'), /stale/);
  assert.throws(() => validateOutputObservation(pending,'run','pump',complete), /regressed/);
  assert.throws(() => validateOutputObservation(complete,'run','pump',failed), /regressed/);
  assert.throws(() => validateOutputObservation({...complete,completion:0},'run','pump'), /inconsistent/);
});

test('private rail audit preserves scalar, context and lifecycle input table parsing', async () => {
  const book = fs.readFileSync(new URL('../docs/ProgrammingInGhostflow.md', import.meta.url),'utf8');
  const section = book.slice(book.indexOf('### E09 —'),book.indexOf('### E10 —'));
  const civil = section.match(/```ghost\n([\s\S]*?)\n```/)[1];
  const lifecycle = `control Restart {
    type RestartReason = PowerOn | Brownout | Watchdog | Software | Unknown;
    input restart_reason: RestartReason;
    input restart_event: Bool;
    output lamp: Bool; lamp <- restart_event;
  }`;
  for (const [code, version] of [
    ['control Plain { output lamp: Bool; lamp <- true; }',1],
    [civil,9],
    [dailySlotsRange({timezone:'Asia/Seoul'}).match(/```ghost\n([\s\S]*?)\n```/)[1],21],
    [lifecycle,22],
  ]) {
    const compiled = await compileSource(code);
    assert.equal(new DataView(compiled.bytes.buffer,compiled.bytes.byteOffset).getUint16(4,true),version);
    validateOutputObservationRails(compiled.manifest,compiled.bytes);
  }
});
