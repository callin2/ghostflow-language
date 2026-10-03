import { compileSource } from '../../tools/toolchain.mjs';
import { canonicalJson } from '../../tools/canonical-json.mjs';
import { sha256Hex } from '../../tools/sha256.mjs';
import { ControlRuntime } from '../wasm/control-runtime.mjs';
import { AccountingRuntime } from '../wasm/accounting-runtime.mjs';
import { FileLedger } from './ledger.mjs';

const MAX_FRAMES = 256, MAX_BYTES = 1024 * 1024;
const copy = value => structuredClone(value);
const hash = value => sha256Hex(new TextEncoder().encode(canonicalJson(value)));
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}
function keys(value, names, label) {
  record(value, label);
  for (const name of Object.keys(value)) if (!names.includes(name)) throw new Error(`${label}: unknown ${name}`);
}
function identity(value, label) {
  if (typeof value !== 'string' || !value.length || value.length > 128) throw new TypeError(`${label} requires a bounded identity`);
}
function bound(frames) {
  if (frames.length > MAX_FRAMES) throw new RangeError('timeline frame budget exceeded');
  if (new TextEncoder().encode(canonicalJson(frames)).length > MAX_BYTES) throw new RangeError('timeline input byte budget exceeded');
}
function captureFrame(frame, required, previous) {
  keys(frame, ['nowMs', 'inputs', 'contextFacts'], 'timeline frame');
  const captured = copy(frame);
  if (!Number.isSafeInteger(captured.nowMs) || captured.nowMs < 0 || captured.nowMs <= previous) throw new Error('timeline times must increase');
  keys(captured.inputs, required, 'timeline inputs');
  for (const name of required) if (!Object.hasOwn(captured.inputs, name)) throw new Error(`missing recorded input ${name}`);
  record(captured.contextFacts, 'recorded context facts');
  return captured;
}
function observation(runtime) {
  const context = runtime.contextSnapshot();
  return { outcome: copy(runtime.lastFrameOutcome), context: copy(context.state), checkpoint: Buffer.from(context.bytes).toString('hex') };
}

/** Bounded desktop reference owner. Applied evidence is caller validated;
 * accepted requested/safe intent never manufactures an applied receipt. */
export async function createGhostTimeline({ wasmBytes, document, filename, sourceClosure, identity: originIdentity,
  context, accounting, output, effectSink, initializeEmpty = false }) {
  if (typeof document !== 'string' || typeof filename !== 'string' || !filename.endsWith('.ghost.md')) throw new TypeError('canonical .ghost.md source is required');
  const wasm = new Uint8Array(wasmBytes), closure = copy(sourceClosure);
  keys(originIdentity, ['timelineId', 'instanceId', 'runId', 'sourceRevision', 'bindingRevision'], 'timeline identity');
  for (const name of ['timelineId', 'instanceId', 'runId', 'sourceRevision', 'bindingRevision']) identity(originIdentity[name], name);
  const origin = copy(originIdentity), activation = copy(context);
  keys(activation, ['bootEpoch', 'terminalCapacity', 'bindings'], 'context activation');
  if (!Array.isArray(activation.bindings) || activation.bindings.length) throw new Error('timeline profile requires no external context bindings');
  if (typeof effectSink !== 'function') throw new TypeError('live synchronous effect sink is required');
  if (typeof initializeEmpty !== 'boolean') throw new TypeError('initializeEmpty must be explicit Boolean');
  record(accounting, 'accounting binding');
  const { account, resourceId, storage } = accounting, config = copy(accounting.config);
  if (!(storage instanceof FileLedger)) throw new TypeError('timeline requires a FileLedger persistence owner');
  const artifact = await compileSource(document, { filename, ...(closure ? { sourceClosure: closure } : {}) });
  const manifest = artifact.manifest;
  if (manifest.format !== 'GhostFlow/control-v10' || !manifest.schedules?.length
      || manifest.schedules.some(schedule => schedule.kind !== 'periodic')
      || ['sensors', 'signals', 'controllers', 'objectives', 'afterEvents'].some(name => manifest[name]?.length)
      || manifest.contexts?.length) throw new Error('timeline profile requires a GFB10 Periodic control without external context or sensor adapters');
  if (manifest.accounting?.constraints?.length
      || manifest.accounting?.bindings?.some(binding => binding.operation !== 'on_time')) {
    throw new Error('timeline profile does not support accounting-dependent decisions or event-count bindings');
  }
  if (!manifest.outputs.some(item => item.name === output && item.type === 'Bool')) throw new Error('live output binding requires a compiled Bool output');
  const ledger = await AccountingRuntime.instantiateSource(wasm, document, { filename, account, resourceId, config });
  let runtime;
  try {
    if (ledger.source.sha256 !== artifact.sourceDocument.sha256 || ledger.source.artifactSha256 !== manifest.bytecodeSha256) throw new Error('timeline accounting Program identity mismatch');
    runtime = await ControlRuntime.instantiateFramed(wasm, artifact, { context: activation });
    const persisted = await storage.read();
    let initial = persisted, persistenceReceipts = [];
    if (persisted) ledger.restore(persisted);
    else if (initializeEmpty) await ledger.initializeEmpty(async (bytes, revision) => {
      const captured = new Uint8Array(bytes);
      if (await storage.persist(captured) !== true) return false;
      initial = captured; persistenceReceipts.push({ revision: String(revision), sha256: sha256Hex(captured) });
      return true;
    });
    else throw new Error('missing durable ledger: explicit empty initialization is required');
    return new Timeline({ wasm, artifact, activation, origin, ledger, storage, runtime, output, resourceId, effectSink,
      persisted: initial, persistenceReceipts });
  } catch (error) { runtime?.dispose(); ledger.dispose(); throw error; }
}

class Timeline {
  #wasm; #artifact; #activation; #origin; #ledger; #storage; #runtime; #output; #resourceId; #sink;
  #frames = []; #rows = []; #persisted = null; #persistReceipts = []; #busy = false; #closed = false; #sinkFailed = false;
  constructor({ wasm, artifact, activation, origin, ledger, storage, runtime, output, resourceId, effectSink, persisted, persistenceReceipts }) {
    this.#wasm = wasm; this.#artifact = artifact; this.#activation = activation; this.#origin = origin;
    this.#ledger = ledger; this.#storage = storage; this.#runtime = runtime; this.#output = output; this.#resourceId = resourceId; this.#sink = effectSink;
    this.#persisted = new Uint8Array(persisted); this.#persistReceipts = persistenceReceipts;
  }
  #available() {
    if (this.#closed) throw new Error('timeline is disposed');
    if (this.#busy) throw new Error('timeline owner is busy');
  }
  #persist = async (bytes, revision) => {
    const captured = new Uint8Array(bytes);
    if (await this.#storage.persist(captured) !== true) return false;
    this.#persisted = captured;
    this.#persistReceipts.push({ revision: String(revision), sha256: sha256Hex(captured) });
    return true;
  };
  get compilation() { this.#available(); return copy(this.#artifact); }
  append(frame) {
    this.#available();
    if (this.#sinkFailed) throw new Error('live sink failed; create a new timeline owner');
    const captured = captureFrame(frame, this.#required(), this.#frames.at(-1)?.nowMs ?? -1);
    bound([...this.#frames, captured]);
    this.#busy = true;
    try {
      const outcome = this.#runtime.step(captured), row = observation(this.#runtime);
      // Commit the accepted decision record before dispatch. A sink failure is
      // separate evidence, never an applied interval or an undone core tick.
      this.#frames.push(captured); this.#rows.push(row);
      try {
        const result = this.#sink(copy({ origin: this.#origin, sourceSha256: this.#artifact.sourceDocument.sha256,
          artifactSha256: this.#artifact.manifest.bytecodeSha256, resourceId: this.#resourceId,
          target: this.#ledger.source.target, output: this.#output, intent: outcome.vm.safe[this.#output], frame: outcome.frame }));
        if (result?.then) throw new Error('live effect sink must be synchronous');
      } catch (error) { this.#sinkFailed = true; throw error; }
      return copy(row);
    } finally { this.#busy = false; }
  }
  #required() { return this.#artifact.manifest.inputs.filter(item => !item.name.startsWith('__gf_')).map(item => item.name); }
  async recordApplied(segment) {
    this.#available();
    const captured = copy(segment);
    this.#busy = true;
    try { return await this.#ledger.recordAppliedSegment(captured, this.#persist); }
    finally { this.#busy = false; }
  }
  async persistPending() {
    this.#available(); this.#busy = true;
    try { return await this.#ledger.persistPending(this.#persist); }
    finally { this.#busy = false; }
  }
  usedRolling(nowMs, windowMs) { this.#available(); return this.#ledger.usedRolling(this.#resourceId, nowMs, windowMs); }
  observe() {
    this.#available();
    const ledger = this.#ledger.snapshot();
    return { identity: copy(this.#origin), sourceSha256: this.#artifact.sourceDocument.sha256,
      artifactSha256: this.#artifact.manifest.bytecodeSha256, binding: copy(this.#ledger.source),
      frames: copy(this.#frames), receipts: copy(this.#rows), live: observation(this.#runtime),
      ledger: { bytes: ledger.bytes, revision: String(ledger.revision) },
      persisted: this.#persisted?.slice(), persistenceReceipts: copy(this.#persistReceipts), sinkFailed: this.#sinkFailed };
  }
  async branch({ branchId, runId, at = this.#frames.length }) {
    this.#available(); identity(branchId, 'branchId'); identity(runId, 'branch runId');
    if (branchId === this.#origin.timelineId || runId === this.#origin.runId) throw new Error('ghost branch requires separate identities');
    if (!Number.isInteger(at) || at < 1 || at > this.#frames.length) throw new Error('branch requires an accepted recorded prefix');
    const prefix = copy(this.#frames.slice(0, at)), rows = copy(this.#rows.slice(0, at));
    // Only immutable decision data reaches the branch. No sink, storage,
    // accounting handle or live runtime is present in its closure.
    this.#busy = true;
    try { return await Branch.create({ wasm: this.#wasm, artifact: copy(this.#artifact), activation: copy(this.#activation),
      identity: { branchId, runId, origin: copy(this.#origin) }, prefix, rows, recordedFuture: copy(this.#frames.slice(at)), required: this.#required() }); }
    finally { this.#busy = false; }
  }
  dispose() { this.#available(); this.#closed = true; this.#runtime.dispose(); this.#ledger.dispose(); }
}

class Branch {
  #wasm; #artifact; #activation; #identity; #prefix; #rows; #required; #recordedFuture; #runtime; #future = []; #futureRows = []; #provenance = []; #busy = false; #closed = false;
  static async create(options) {
    const owner = new Branch(options), executed = await owner.#execute(options.prefix);
    try { owner.#verify(executed.rows); owner.#runtime = executed.runtime; return owner; }
    catch (error) { executed.runtime.dispose(); throw error; }
  }
  constructor({ wasm, artifact, activation, identity: branchIdentity, prefix, rows, recordedFuture, required }) {
    this.#wasm = wasm; this.#artifact = artifact; this.#activation = activation; this.#identity = branchIdentity;
    this.#prefix = prefix; this.#rows = rows; this.#required = required;
    this.#recordedFuture = recordedFuture;
  }
  #available() { if (this.#closed) throw new Error('branch is disposed'); if (this.#busy) throw new Error('branch is busy'); }
  async #execute(frames) {
    const runtime = await ControlRuntime.instantiateFramed(this.#wasm, this.#artifact, { context: this.#activation });
    try { return { runtime, rows: frames.map(frame => { runtime.step(frame); return observation(runtime); }) }; }
    catch (error) { runtime.dispose(); throw error; }
  }
  #verify(rows) {
    if (hash(rows.slice(0, this.#prefix.length)) !== hash(this.#rows)) throw new Error('ghost baseline replay diverged');
  }
  async step(frame, { provenance } = {}) {
    this.#available();
    if (!['recorded', 'synthetic'].includes(provenance)) throw new Error('branch frame requires explicit recorded or synthetic provenance');
    const captured = captureFrame(frame, this.#required, (this.#future.at(-1) ?? this.#prefix.at(-1)).nowMs);
    if (provenance === 'recorded' && (!this.#recordedFuture[this.#future.length]
        || hash(captured) !== hash(this.#recordedFuture[this.#future.length]))) throw new Error('recorded branch frame must match the captured actual timeline');
    const frames = [...this.#prefix, ...this.#future, captured]; bound(frames);
    this.#busy = true;
    let executed;
    try {
      executed = await this.#execute(frames); this.#verify(executed.rows);
      this.#runtime.dispose(); this.#runtime = executed.runtime; executed = null;
      this.#future.push(captured); this.#futureRows.push(observation(this.#runtime));
      this.#provenance.push(provenance);
      return { ...copy(this.#futureRows.at(-1)), provenance, physicalEffects: false };
    } finally { executed?.runtime.dispose(); this.#busy = false; }
  }
  async rewind() {
    this.#available(); this.#busy = true;
    let executed;
    try {
      executed = await this.#execute(this.#prefix); this.#verify(executed.rows);
      this.#runtime.dispose(); this.#runtime = executed.runtime; executed = null;
      this.#future = []; this.#futureRows = []; this.#provenance = [];
      return this.#observation();
    } finally { executed?.runtime.dispose(); this.#busy = false; }
  }
  #observation() { return { identity: copy(this.#identity), prefixSha256: hash(this.#prefix),
    baselineSha256: hash(this.#rows), frames: copy(this.#future), receipts: copy(this.#futureRows), provenance: copy(this.#provenance), live: observation(this.#runtime), physicalEffects: false }; }
  observe() { this.#available(); return this.#observation(); }
  dispose() { this.#available(); this.#closed = true; this.#runtime.dispose(); }
}
