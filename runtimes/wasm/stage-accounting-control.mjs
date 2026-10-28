import { compileSource } from '../../tools/compile-source.mjs';
import { compileStageAccountingBinding } from '../../tools/stage-accounting-binding.mjs';
import { ControlRuntime } from './control-runtime.mjs';

/** Source compilation establishes declarations; the Rust scan owner records usage. */
export class StageAccountingControl {
  static async instantiateSource(wasm, document, { filename = 'program.ghost.md', runId, bindings,
    maxSegments = 256, runtimeOptions = {}, snapshot } = {}) {
    const artifact = await compileSource(document, { filename });
    const activation = compileStageAccountingBinding(artifact, { runId, bindings, maxSegments });
    const control = await ControlRuntime.instantiateFramed(wasm, artifact, runtimeOptions);
    try {
      control.runtime.activateStageAccounting(activation);
      if (snapshot !== undefined) control.runtime.restoreStageAccounting(snapshot);
      return new StageAccountingControl(control, artifact, runId);
    } catch (error) { control.dispose(); throw error; }
  }

  constructor(control, artifact, runId) {
    this.control = control;
    this.artifact = artifact;
    this.runId = runId;
  }

  step(frame) { return this.control.step(frame); }
  query(account, startMs, endMs, runId = this.runId) {
    return this.control.runtime.stageAccountingQuery(account, runId, startMs, endMs);
  }
  coverageGap() { this.control.runtime.stageAccountingGap(); }
  snapshot() { return this.control.runtime.stageAccountingSnapshot(); }
  async persist(write) {
    if (typeof write !== 'function') throw new TypeError('durable accounting writer is required');
    const snapshot = this.snapshot();
    if (await write(snapshot.bytes.slice(), snapshot.revision) !== true) throw new Error('stage accounting snapshot was not durably acknowledged');
    this.control.runtime.acknowledgeStageAccounting(snapshot.revision);
    return snapshot;
  }
  dispose() { this.control.dispose(); }
}
