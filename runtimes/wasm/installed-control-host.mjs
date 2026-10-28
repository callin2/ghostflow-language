import { compileSourceSync } from '../../tools/compile-source.mjs';
import { canonicalJson } from '../../tools/canonical-json.mjs';
import { sha256Hex } from '../../tools/sha256.mjs';
import { assessInstallation, jsonSha256, SCHEMAS } from '../../tools/integration-contract.mjs';
import { ControlRuntime } from './control-runtime.mjs';

const activationToken = Symbol('installed control activation');
const copy = value => structuredClone(value);
const fail = message => { throw new Error(`installed control: ${message}`); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const identity = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value);

function exact(value, fields, label) {
  if (!record(value) || Object.keys(value).length !== fields.length
    || fields.some(field => !Object.hasOwn(value, field))) fail(`${label} shape`);
}

function prepareArtifact(artifact) {
  const owned = copy(artifact);
  if (!record(owned) || owned.sourceClosure !== undefined
    || !record(owned.sourceDocument) || typeof owned.sourceDocument.text !== 'string'
    || typeof owned.sourceDocument.filename !== 'string'
    || !owned.sourceDocument.filename.endsWith('.ghost.md')
    || !(owned.bytes instanceof Uint8Array)
    || sha256Hex(owned.sourceDocument.text) !== owned.sourceDocument.sha256
    || sha256Hex(owned.bytes) !== owned.manifest?.bytecodeSha256) fail('source or artifact identity');
  const rebuilt = compileSourceSync(owned.sourceDocument.text, { filename: owned.sourceDocument.filename });
  if (canonicalJson(rebuilt.sourceDocument) !== canonicalJson(owned.sourceDocument)
    || canonicalJson(rebuilt.manifest) !== canonicalJson(owned.manifest)
    || sha256Hex(rebuilt.bytes) !== sha256Hex(owned.bytes)) fail('source, manifest or bytecode differs from compiler output');
  const manifest = owned.manifest;
  if (!['GhostFlow/control-v1', 'GhostFlow/control-v4'].includes(manifest.format)
    || !Array.isArray(manifest.inputs) || manifest.inputs.length
    || !Array.isArray(manifest.outputs) || !manifest.outputs.length
    || manifest.outputs.some(item => item.type !== 'Bool')
    || !Array.isArray(manifest.sensors) || !manifest.sensors.length
    || manifest.sensors.some(item => !['Number', 'Bool'].includes(item.type)
      || item.optional === true || !Number.isSafeInteger(item.staleMs) || item.staleMs <= 0
      || item.type === 'Number' && (typeof item.validMin !== 'number' || typeof item.validMax !== 'number'))
    || ['schedules', 'timers', 'signals', 'configs'].some(key => !Array.isArray(manifest[key]) || manifest[key].length)
    || Object.keys(manifest).some(key => !['format', 'name', 'inputs', 'outputs', 'sensors', 'schedules', 'timers', 'signals', 'configs', 'strategies', 'adaptPolicy', 'bytecodeSha256'].includes(key))) {
    fail('unsupported conditioned sensor Program profile');
  }
  return owned;
}

function prepareInstallation(artifact, release, boardProfile, installation) {
  const owned = { release: copy(release), boardProfile: copy(boardProfile), installation: copy(installation) };
  if (owned.boardProfile?.schema !== SCHEMAS.profileV2) fail('board-profile-v2 is required');
  const assessment = assessInstallation({ ...owned, artifacts: {
    source: artifact.sourceDocument.text, module: artifact.bytes, manifest: artifact.manifest,
  } });
  const checked = assessment.metadata;
  if (!checked.valid) fail(`installation incompatible: ${checked.errors.map(error => `${error.path}:${error.code}`).join(', ')}`);
  return { ...owned, assessment, capabilities: artifact.manifest.sensors.map(({ name, type }) => ({ kind: 'sensor', name, type })) };
}

function requireSensorOnlyReplacement(current, next, manifest) {
  if (current.boardProfile.id !== next.boardProfile.id
    || current.boardProfile.boardModel !== next.boardProfile.boardModel) {
    fail('replacement changes board identity or model');
  }
  const oldRelease = current.release, newRelease = next.release;
  if (canonicalJson({ toolchain: oldRelease.toolchain, runtimeSemanticsVersion: oldRelease.runtimeSemanticsVersion,
    bytecodeFormat: oldRelease.bytecodeFormat, protocolVersion: oldRelease.protocolVersion,
    firmwareSha256: oldRelease.device.firmwareSha256 })
    !== canonicalJson({ toolchain: newRelease.toolchain, runtimeSemanticsVersion: newRelease.runtimeSemanticsVersion,
      bytecodeFormat: newRelease.bytecodeFormat, protocolVersion: newRelease.protocolVersion,
      firmwareSha256: newRelease.device.firmwareSha256 })
    || current.installation.id !== next.installation.id) fail('replacement changes unrelated release or installation identity');
  for (const output of manifest.outputs) {
    const oldEndpointId = current.installation.bindings[output.name];
    const nextEndpointId = next.installation.bindings[output.name];
    if (oldEndpointId !== nextEndpointId
      || canonicalJson(current.boardProfile.endpoints[oldEndpointId])
        !== canonicalJson(next.boardProfile.endpoints[nextEndpointId])) fail(`replacement changes output binding ${output.name}`);
  }
}

/** A reference installation owner. Endpoint and revision labels are supplied by
 * the acquisition caller; this host does not authenticate a physical Driver. */
export class InstalledControlHost {
  #runtime; #wasm; #artifact; #installation; #runId; #usedRuns; #usedBindings; #profileDigests; #latest = null;
  #pending = false; #disposed = false; #cleanupError = null;

  static async instantiate(wasmBytes, artifact, { runId, release, boardProfile, installation } = {}) {
    if (!identity(runId)) fail('invalid run identity');
    const ownedArtifact = prepareArtifact(artifact);
    const ownedInstallation = prepareInstallation(ownedArtifact, release, boardProfile, installation);
    const wasm = new Uint8Array(wasmBytes).slice();
    const runtime = await ControlRuntime.instantiateFramed(wasm, ownedArtifact,
      { capabilities: ownedInstallation.capabilities });
    return new InstalledControlHost(activationToken, wasm, ownedArtifact, ownedInstallation, runtime, runId);
  }

  constructor(token, wasm, artifact, installation, runtime, runId) {
    if (token !== activationToken) fail('fresh validated activation required');
    this.#wasm = wasm; this.#artifact = artifact; this.#installation = installation;
    this.#runtime = runtime; this.#runId = runId; this.#usedRuns = new Set([runId]);
    this.#usedBindings = new Set([installation.installation.revision]);
    this.#profileDigests = new Map([[JSON.stringify([installation.boardProfile.id, installation.boardProfile.revision]),
      jsonSha256(installation.boardProfile)]]);
  }

  #live() { if (this.#disposed) fail('owner is disposed'); }

  #identity() {
    return { runId: this.#runId, sourceSha256: this.#artifact.sourceDocument.sha256,
      bytecodeSha256: this.#artifact.manifest.bytecodeSha256,
      boardProfileRevision: this.#installation.boardProfile.revision,
      bindingRevision: this.#installation.installation.revision };
  }

  snapshot() {
    this.#live();
    return copy({ ...this.#identity(), assessment: this.#installation.assessment,
      latest: this.#latest, cleanupError: this.#cleanupError });
  }

  step(frame) {
    this.#live();
    const owned = copy(frame);
    exact(owned, ['bindingRevision', 'nowMs', 'samples'], 'frame');
    if (owned.bindingRevision !== this.#installation.installation.revision) fail('stale binding revision');
    if (!record(owned.samples)) fail('samples shape');
    const samples = {};
    for (const [name, packet] of Object.entries(owned.samples)) {
      exact(packet, ['bindingRevision', 'endpointId', 'sample'], `sample ${name}`);
      if (packet.bindingRevision !== owned.bindingRevision) fail(`stale sample binding revision ${name}`);
      if (packet.endpointId !== this.#installation.installation.bindings[name]
        || !this.#artifact.manifest.sensors.some(sensor => sensor.name === name)) fail(`sample endpoint mismatch ${name}`);
      samples[name] = packet.sample;
    }
    const outcome = this.#runtime.step({ nowMs: owned.nowMs, samples });
    const published = { ...copy(outcome), identity: this.#identity(), assessment: this.#installation.assessment };
    this.#latest = published;
    return copy(published);
  }

  async replaceBinding({ runId, release, boardProfile, installation } = {}) {
    this.#live();
    if (this.#pending) fail('replacement already pending');
    if (!identity(runId) || this.#usedRuns.has(runId) || this.#usedRuns.size >= 128) fail('fresh bounded run identity required');
    this.#pending = true;
    let candidate;
    try {
      const next = prepareInstallation(this.#artifact, release, boardProfile, installation);
      if (this.#usedBindings.has(next.installation.revision)) fail('unused binding revision required');
      const profileKey = JSON.stringify([next.boardProfile.id, next.boardProfile.revision]);
      const profileDigest = jsonSha256(next.boardProfile);
      if (this.#profileDigests.has(profileKey) && this.#profileDigests.get(profileKey) !== profileDigest) {
        fail('profile revision cannot change its content');
      }
      requireSensorOnlyReplacement(this.#installation, next, this.#artifact.manifest);
      candidate = await ControlRuntime.instantiateFramed(this.#wasm, this.#artifact,
        { capabilities: next.capabilities });
      if (this.#disposed) fail('owner was disposed during preparation');
      const accepted = { runId, sourceSha256: this.#artifact.sourceDocument.sha256,
        bytecodeSha256: this.#artifact.manifest.bytecodeSha256,
        boardProfileRevision: next.boardProfile.revision,
        bindingRevision: next.installation.revision, assessment: copy(next.assessment), latest: null, cleanupError: null };
      const previous = this.#runtime;
      this.#runtime = candidate; candidate = null;
      this.#installation = next;
      this.#runId = runId;
      this.#usedRuns.add(runId);
      this.#usedBindings.add(next.installation.revision);
      this.#profileDigests.set(profileKey, profileDigest);
      this.#latest = null;
      this.#cleanupError = null;
      try { previous.dispose(); } catch (error) { this.#cleanupError = String(error); }
      return accepted;
    } finally {
      candidate?.dispose();
      this.#pending = false;
    }
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#runtime.dispose();
  }
}
