import { compileSourceSync } from '../../tools/compile-source.mjs';
import { canonicalJson } from '../../tools/canonical-json.mjs';
import { sha256Hex } from '../../tools/sha256.mjs';
import { assessInstallation } from '../../tools/integration-contract.mjs';
import { GhostFlowRuntime } from './ghostflow-runtime.mjs';
import { NativeDispatchError } from './native-dispatch.mjs';

const FAULTS = Object.freeze({ Disconnected: 0, Stale: 1, Invalid: 2, NotReady: 3 });
const MANIFEST_FIELDS = new Set(['format', 'name', 'inputs', 'outputs', 'sensors', 'schedules', 'timers', 'signals', 'configs', 'bytecodeSha256']);
const activationToken = Symbol('program replacement activation');
const copy = value => structuredClone(value);
const fail = message => { throw new Error(`program replacement: ${message}`); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const runName = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value);

function exact(value, keys, label) {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(`${label} shape`);
}

function supported(manifest, sourceClosure) {
  if (sourceClosure !== undefined || !plain(manifest) || Object.keys(manifest).some(key => !MANIFEST_FIELDS.has(key))
    || !['GhostFlow/control-v1', 'GhostFlow/control-v4'].includes(manifest.format)
    || !Array.isArray(manifest.inputs) || manifest.inputs.length
    || !Array.isArray(manifest.outputs) || !manifest.outputs.length
    || manifest.outputs.some(port => port?.type !== 'Bool')
    || !Array.isArray(manifest.sensors) || manifest.sensors.some(sensor => sensor?.type !== 'Bool'
      || sensor.optional === true || sensor.sampleMs !== null || sensor.validMin !== null
      || sensor.validMax !== null || sensor.filter !== null || sensor.window !== null
      || sensor.staleMs !== null || sensor.recoverSamples !== null
      || sensor.samplePresentInput !== undefined)
    || ['schedules', 'timers', 'signals', 'configs'].some(key => !Array.isArray(manifest[key]) || manifest[key].length)) {
    fail('unsupported Program profile');
  }
}

function prepare(artifact, release, boardProfile, installation) {
  const owned = copy(artifact);
  if (!plain(owned) || !plain(owned.sourceDocument) || typeof owned.sourceDocument.text !== 'string'
    || typeof owned.sourceDocument.filename !== 'string' || !(owned.bytes instanceof Uint8Array)
    || sha256Hex(owned.sourceDocument.text) !== owned.sourceDocument.sha256
    || sha256Hex(owned.bytes) !== owned.manifest?.bytecodeSha256) fail('source or artifact digest mismatch');
  const rebuilt = compileSourceSync(owned.sourceDocument.text, {
    filename: owned.sourceDocument.filename,
    ...(owned.sourceClosure ? { sourceClosure: owned.sourceClosure.documents } : {}),
  });
  if (canonicalJson(rebuilt.sourceDocument) !== canonicalJson(owned.sourceDocument)
    || canonicalJson(rebuilt.manifest) !== canonicalJson(owned.manifest)
    || sha256Hex(rebuilt.bytes) !== sha256Hex(owned.bytes)
    || canonicalJson(rebuilt.sourceClosure ?? null) !== canonicalJson(owned.sourceClosure ?? null)) {
    fail('source, closure, manifest or bytecode differs from compiler output');
  }
  supported(owned.manifest, owned.sourceClosure);
  const assessment = assessInstallation({ release, boardProfile, installation,
    artifacts: { source: owned.sourceDocument.text, module: owned.bytes, manifest: owned.manifest } });
  const checked = assessment.metadata;
  if (!checked.valid) fail(`installation or artifact mismatch: ${checked.errors.map(error => `${error.path}:${error.code}`).join(', ')}`);
  for (const sensor of owned.manifest.sensors) {
    const endpointId = installation.bindings[sensor.name];
    if (endpointId === undefined) fail(`missing input binding ${sensor.name}`);
    const endpoint = boardProfile.endpoints[endpointId];
    if (endpoint?.direction !== 'input' || endpoint.type !== sensor.type) fail(`input binding ${sensor.name} direction or type mismatch`);
  }
  return { artifact: owned, assessment };
}

function observationFrame(manifest, supplied) {
  if (!plain(supplied) || Object.keys(supplied).length !== manifest.sensors.length) fail('complete input observation snapshot required');
  const frame = [];
  for (const sensor of manifest.sensors) {
    if (!Object.hasOwn(supplied, sensor.name)) fail(`missing input observation ${sensor.name}`);
    const item = supplied[sensor.name];
    if (!plain(item) || !runName(item.source) || !runName(item.observationId)) fail(`input observation provenance ${sensor.name}`);
    if (item.ok === true) {
      exact(item, ['ok', 'value', 'source', 'observationId'], `input observation ${sensor.name}`);
      if (typeof item.value !== 'boolean') fail(`input observation type ${sensor.name}`);
      frame.push([sensor.valueInput, item.value, 'bool'], [sensor.okInput, true, 'bool'], [sensor.faultInput, 0, 'number']);
    } else if (item.ok === false) {
      exact(item, ['ok', 'fault', 'source', 'observationId'], `input observation ${sensor.name}`);
      if (!Object.hasOwn(FAULTS, item.fault)) fail(`input observation fault ${sensor.name}`);
      frame.push([sensor.valueInput, false, 'bool'], [sensor.okInput, false, 'bool'], [sensor.faultInput, FAULTS[item.fault], 'number']);
    } else fail(`input observation Result ${sensor.name}`);
  }
  return frame;
}

export class ProgramReplacementHost {
  #runtime; #release; #profile; #installation; #artifact; #assessment; #identity; #runs; #capacity; #latest = null; #disposed = false; #faulted = false;

  static async instantiate(wasmBytes, artifact, { runId, release, boardProfile, installation, historyCapacity = 128 } = {}) {
    if (!runName(runId) || !Number.isSafeInteger(historyCapacity) || historyCapacity < 1 || historyCapacity > 128) fail('run identity or history capacity');
    const ownedRelease = copy(release), ownedProfile = copy(boardProfile), ownedInstallation = copy(installation);
    const { artifact: ownedArtifact, assessment } = prepare(artifact, ownedRelease, ownedProfile, ownedInstallation);
    const wasm = new Uint8Array(wasmBytes);
    const runtime = await GhostFlowRuntime.instantiate(wasm);
    try {
      runtime.load(ownedArtifact.bytes);
      for (const [name, endpointId] of Object.entries(ownedInstallation.bindings)) {
        const endpoint = ownedProfile.endpoints[endpointId];
        if (endpoint.type !== 'Bool') continue;
        runtime.addCapability(endpoint.direction === 'input' ? 'sensor' : 'actuator', name, 'bool');
      }
      runtime.activate();
      return new ProgramReplacementHost(activationToken, runtime, ownedArtifact, ownedRelease, ownedProfile, ownedInstallation, assessment, runId, historyCapacity);
    } catch (error) { runtime.dispose(); throw error; }
  }

  constructor(token, runtime, artifact, release, profile, installation, assessment, runId, capacity) {
    if (token !== activationToken) fail('fresh validated activation required');
    this.#runtime = runtime; this.#artifact = artifact; this.#release = release;
    this.#profile = profile; this.#installation = installation; this.#capacity = capacity;
    this.#assessment = assessment;
    this.#identity = this.#makeIdentity(artifact, runId);
    this.#runs = [copy(this.#identity)];
  }

  #makeIdentity(artifact, runId) {
    return { runId, sourceSha256: artifact.sourceDocument.sha256,
      artifactSha256: artifact.manifest.bytecodeSha256,
      bindingRevision: this.#installation.revision };
  }

  #live() { if (this.#disposed) fail('host disposed'); if (this.#faulted) fail('host unavailable after dispatch failure'); }

  step({ observations } = {}) {
    this.#live();
    const captured = copy(observations), frame = observationFrame(this.#artifact.manifest, captured);
    let phase = 'staging';
    try {
      this.#runtime.clearInputs();
      for (const [name, value, type] of frame) this.#runtime[type === 'bool' ? 'setBool' : 'setNumber'](name, value);
      phase = 'dispatch';
      this.#runtime.tick();
      phase = 'postcommit';
      const result = { identity: copy(this.#identity), assessment: this.#assessment, trace: this.#runtime.trace, observations: captured };
      this.#latest = copy(result);
      return copy(result);
    } catch (error) {
      if (phase !== 'dispatch' || !(error instanceof NativeDispatchError) || error.committed !== false) this.#faulted = true;
      throw error;
    }
  }

  replace({ artifact, runId } = {}) {
    this.#live();
    if (!runName(runId) || this.#runs.some(run => run.runId === runId)) fail('new runId required');
    if (this.#runs.length >= this.#capacity) fail('run history capacity exhausted');
    const { artifact: candidate, assessment } = prepare(artifact, this.#release, this.#profile, this.#installation);
    const identity = this.#makeIdentity(candidate, runId);
    const runs = [...this.#runs, identity];
    const published = copy({ identity, assessment, latest: null, runs });
    this.#runtime.hotSwap(candidate.bytes);
    this.#artifact = candidate;
    this.#assessment = assessment;
    this.#identity = identity;
    this.#runs = runs;
    this.#latest = null;
    return published;
  }

  snapshot() {
    this.#live();
    return copy({ identity: this.#identity, assessment: this.#assessment, latest: this.#latest, runs: this.#runs });
  }

  dispose() { if (!this.#disposed) this.#runtime.dispose(); this.#disposed = true; }
}
