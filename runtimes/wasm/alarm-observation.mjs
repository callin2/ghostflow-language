import { prepareAlarmObservation, encodeAlarmQuery } from '../../tools/alarm-observation.mjs';
import { FramedGhostFlowRuntime } from './framed-runtime.mjs';

const construction = Symbol();

/** Alarm transitions are recorded by Rust during accepted scans, independently of reads. */
export class AlarmObservationRuntime {
  #runtime;
  #binding;
  static async instantiate(wasmBytes, compilation, descriptor, identity) {
    const prepared = prepareAlarmObservation(compilation, descriptor);
    const binding = prepared.bind(identity);
    const runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
    try {
      runtime.load(compilation.bytes);
      for (const output of compilation.manifest.outputs) runtime.addCapability('actuator', output.name,
        output.type === 'Bool' ? 'bool' : output.type === 'Int' ? 'int' : 'number');
      runtime.activate(); runtime.activateAlarms(binding.bytes, binding.sha256);
      return new AlarmObservationRuntime(construction, runtime, binding);
    } catch (error) { runtime.dispose(); throw error; }
  }
  constructor(token, runtime, binding) { if (token !== construction) throw new Error('use AlarmObservationRuntime.instantiate'); this.#runtime = runtime; this.#binding = binding; }
  scan(frame) { if (!this.#runtime) throw new Error('alarm runtime is disposed'); return this.#runtime.scan(frame); }
  query(cursor = null) {
    if (!this.#runtime) throw new Error('alarm runtime is disposed');
    if (cursor !== null && (Object.keys(cursor).sort().join(',') !== 'bindingSha256,runId,sequence,streamId'
      || cursor.bindingSha256 !== this.#binding.sha256 || cursor.runId !== this.#binding.runId || cursor.streamId !== this.#binding.streamId)) throw new Error('stale alarm cursor identity');
    return this.#runtime.queryAlarms(encodeAlarmQuery(this.#binding, cursor?.sequence ?? null));
  }
  dispose() { this.#runtime?.dispose(); this.#runtime = null; }
}
