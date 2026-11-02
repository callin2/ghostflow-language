import { verifyBoundResourceCompilation } from '../../tools/bound-resource-control.mjs';
import { FramedGhostFlowRuntime } from './framed-runtime.mjs';
import { SignalConditioner } from './signals.mjs';
import { sensorConfig, hostReading, sensorFaultCode } from './control-runtime.mjs';

// This registry covers this module in one JavaScript realm, including pending
// instantiation. A multi-Worker installation host must arbitrate all writers.
const activeWriters = new Map();
const creation = Symbol('validated bound runtime creation');

/** Software-only final logical writer. It performs no physical I/O. */
export class BoundResourceControlRuntime {
  #runtime;
  #compiled;
  #identities;
  #owner;
  #entry;
  #nextScanId = 0;
  #conditioners = new Map();
  #faulted = false;

  static async instantiate(wasmBytes, compilation) {
    const checked = verifyBoundResourceCompilation(compilation);
    const identities = checked.manifest.resourceBinding.resources.map(resource => resource.resourceId);
    for (const identity of identities) if (activeWriters.has(identity)) throw new Error(`resource already has an active writer: ${identity}`);
    const owner = Symbol('bound resource writer');
    for (const identity of identities) activeWriters.set(identity, owner);
    let runtime;
    try {
      runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
      runtime.load(checked.bytes);
      for (const output of checked.manifest.outputs) runtime.addCapability('actuator', output.name, output.type === 'Percent' ? 'number' : 'bool');
      runtime.activateResourceBinding(checked.resourceBindingActivation);
      return new BoundResourceControlRuntime(runtime, checked, identities, owner, creation);
    } catch (error) {
      runtime?.dispose();
      for (const identity of identities) if (activeWriters.get(identity) === owner) activeWriters.delete(identity);
      throw error;
    }
  }

  constructor(runtime, compilation, identities, owner, token) {
    if (token !== creation) throw new Error('use BoundResourceControlRuntime.instantiate with a checked artifact');
    this.#runtime = runtime; this.#compiled = compilation; this.#identities = identities; this.#owner = owner;
  }

  scan(frame) {
    if (!this.#runtime) throw new Error('bound resource runtime is disposed');
    if (this.#entry === 'host') throw new Error('cannot mix host steps and native scans');
    this.#entry = 'native';
    return this.#runtime.scanResourceBinding(frame, this.#compiled.resourceBindingScan);
  }

  /** Condition explicit Bool observations with the same WASM transactions as ControlRuntime. */
  step(snapshot) {
    if (!this.#runtime) throw new Error('bound resource runtime is disposed');
    if (this.#faulted) throw new Error('bound host is faulted; create a new runtime');
    if (this.#entry === 'native') throw new Error('cannot mix native scans and host steps');
    const { nowMs, inputs, samples = {} } = snapshot;
    const manifest = this.#compiled.manifest;
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(this.#nextScanId)) throw new RangeError('invalid bound scan identity');
    if (snapshot.due !== undefined || snapshot.contextFacts !== undefined || snapshot.scheduleFacts !== undefined) throw new TypeError('bound Bool host does not accept schedule or context facts');
    if (manifest.inputs.some(port => port.type !== 'Bool') || manifest.sensors.some(sensor => sensor.type !== 'Bool')
      || manifest.sensorInstances?.length || manifest.signals.length || manifest.schedules.length) throw new TypeError('bound host supports the finite Bool input profile');
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || !samples || typeof samples !== 'object' || Array.isArray(samples)) throw new TypeError('bound inputs and samples must be records');
    const names = new Set(manifest.inputs.map(port => port.name));
    if (Object.keys(inputs).length !== names.size || Object.keys(inputs).some(name => !names.has(name))) throw new TypeError('bound input names differ from the manifest');
    const frameInputs = manifest.inputs.map(port => {
      if (typeof inputs[port.name] !== 'boolean') throw new TypeError(`bound input ${port.name} must be Bool`);
      return { name: port.name, value: inputs[port.name] };
    });
    const sensorNames = new Set(manifest.sensors.map(sensor => sensor.name));
    const captured = structuredClone(samples);
    for (const [name, sample] of Object.entries(captured)) {
      if (!sensorNames.has(name)) throw new TypeError(`unknown bound sample ${name}`);
      if (!sample || typeof sample !== 'object' || Object.keys(sample).sort().join(',') !== 'epoch,id,quality,timestampMs,value') throw new TypeError(`invalid bound sample ${name}`);
      if (typeof sample.value !== 'boolean') throw new TypeError(`bound sample ${name} must be Bool`);
    }
    this.#entry = 'host';
    const begun = [];
    let committed = false;
    try {
      const readings = {};
      for (const sensor of manifest.sensors) {
        let conditioner = this.#conditioners.get(sensor.name);
        if (!conditioner) {
          conditioner = new SignalConditioner(this.#runtime.wasm, sensorConfig(sensor));
          this.#conditioners.set(sensor.name, conditioner);
        }
        conditioner.begin(); begun.push(conditioner);
        const sample = captured[sensor.name];
        const reading = hostReading(sample === undefined ? conditioner.read(nowMs)
          : conditioner.update({ ...sample, value: Number(sample.value) }, nowMs), sensor.type);
        readings[sensor.name] = reading;
        frameInputs.push({ name: sensor.valueInput, value: reading.value }, { name: sensor.okInput, value: reading.ok },
          { name: sensor.faultInput, value: sensorFaultCode(reading) });
        if (sensor.samplePresentInput !== undefined) {
          const identity = conditioner.sampleIdentity();
          frameInputs.push({ name: sensor.samplePresentInput, value: sample !== undefined && identity !== null },
            { name: sensor.sampleEpochInput, value: identity?.epoch ?? 0 }, { name: sensor.sampleIdInput, value: identity?.id ?? 0 },
            { name: sensor.sampleTimestampInput, value: identity?.timestampMs ?? 0 });
        }
      }
      const frame = { scanId: this.#nextScanId, logicalTimeMs: nowMs, inputs: frameInputs };
      const outcome = this.#runtime.scanResourceBinding(frame, this.#compiled.resourceBindingScan);
      committed = true;
      this.#nextScanId += 1;
      for (const conditioner of begun) conditioner.commit();
      return { vm: outcome.trace, frame: { scanId: outcome.scanId, logicalTimeMs: outcome.logicalTimeMs }, sensors: readings, signals: {} };
    } catch (cause) {
      if (committed) { this.#faulted = true; throw cause; }
      const failures = [];
      for (const conditioner of begun.reverse()) try { conditioner.rollback(); } catch (error) { failures.push(error); }
      if (failures.length) { this.#faulted = true; throw new AggregateError([cause, ...failures], 'bound input rollback failed'); }
      throw cause;
    }
  }

  dispose() {
    for (const conditioner of this.#conditioners.values()) conditioner.dispose();
    this.#conditioners.clear();
    this.#runtime?.dispose(); this.#runtime = null;
    for (const identity of this.#identities) if (activeWriters.get(identity) === this.#owner) activeWriters.delete(identity);
  }
}

/** Reference simulation executes the same framed Rust guard; it adds no policy. */
export async function simulateBoundResourceControl(wasmBytes, compilation, frames) {
  const runtime = await BoundResourceControlRuntime.instantiate(wasmBytes, compilation);
  try { return frames.map(frame => runtime.scan(frame)); }
  finally { runtime.dispose(); }
}
