// Pure contract checks only: no compiler, filesystem, network, or device access.
import { createHash } from 'node:crypto';

export const SCHEMAS = Object.freeze({
  release: 'GhostFlow/integration-release-v1',
  profile: 'GhostFlow/board-profile-v1',
  installation: 'GhostFlow/installation-mapping-v1',
  run: 'GhostFlow/integration-run-v1',
});
export const STATUSES = Object.freeze(['not_run', 'pass', 'fail', 'unknown']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.hasOwn(value, key);
const hashPattern = /^[a-f0-9]{64}$/;

export function sha256(value) {
  if (typeof value !== 'string' && !(value instanceof Uint8Array)) {
    throw new TypeError('sha256 requires exact UTF-8 text or Uint8Array bytes');
  }
  return createHash('sha256').update(value).digest('hex');
}

// Contract-local canonical JSON: sort object keys; preserve arrays and strings.
export function jsonSha256(value) {
  const ancestors = new Set();
  function encode(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if ((!Array.isArray(item) && !isObject(item)) || ancestors.has(item)) throw new TypeError('expected acyclic JSON data');
    ancestors.add(item);
    let encoded;
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) if (!own(item, i)) throw new TypeError('sparse arrays are not JSON data');
      encoded = `[${item.map(encode).join(',')}]`;
    } else {
      if (Object.getOwnPropertySymbols(item).length) throw new TypeError('symbol keys are not JSON data');
      encoded = `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode(item[key])}`).join(',')}}`;
    }
    ancestors.delete(item);
    return encoded;
  }
  return sha256(encode(value));
}

function checks() {
  const errors = [];
  const issue = (path, code, message) => errors.push({ path, code, message });
  const object = (value, path) => {
    if (isObject(value)) return true;
    issue(path, 'shape', 'expected a JSON object'); return false;
  };
  const fields = (value, path, names) => {
    if (!object(value, path)) return false;
    for (const key of names) if (!own(value, key)) issue(`${path}.${key}`, 'shape', 'required field');
    for (const key of Object.keys(value).sort()) if (!names.includes(key)) issue(`${path}.${key}`, 'shape', 'unexpected field');
    return true;
  };
  const text = (value, path) => {
    if (typeof value !== 'string' || !value.trim()) issue(path, 'shape', 'expected nonempty text');
  };
  const digest = (value, path) => {
    if (typeof value !== 'string' || !hashPattern.test(value)) issue(path, 'digest', 'expected lowercase SHA-256 hex');
  };
  const equal = (actual, expected, path, code = 'identity_mismatch') => {
    if (actual !== expected) issue(path, code, 'does not match the pinned identity');
  };
  const schema = (value, expected, path) => equal(value, expected, `${path}.schema`, 'schema');
  const digestOf = (value, path) => {
    try { return jsonSha256(value); } catch (error) { issue(path, 'shape', error.message); return null; }
  };
  const result = () => ({ valid: errors.length === 0, errors });
  return { errors, issue, object, fields, text, digest, equal, schema, digestOf, result };
}

function profileRef(value, path, c) {
  if (!c.fields(value, path, ['id', 'revision', 'sha256'])) return;
  c.text(value.id, `${path}.id`); c.text(value.revision, `${path}.revision`); c.digest(value.sha256, `${path}.sha256`);
}

function releaseShape(release, c) {
  if (!c.fields(release, 'release', ['schema', 'toolchain', 'runtimeSemanticsVersion', 'bytecodeFormat', 'protocolVersion', 'device', 'installation'])) return;
  c.schema(release.schema, SCHEMAS.release, 'release');
  if (c.fields(release.toolchain, 'release.toolchain', ['version', 'sha256'])) {
    c.text(release.toolchain.version, 'release.toolchain.version'); c.digest(release.toolchain.sha256, 'release.toolchain.sha256');
  }
  for (const key of ['runtimeSemanticsVersion', 'bytecodeFormat', 'protocolVersion']) c.text(release[key], `release.${key}`);
  if (c.fields(release.device, 'release.device', ['firmwareSha256', 'boardProfile'])) {
    c.digest(release.device.firmwareSha256, 'release.device.firmwareSha256');
    profileRef(release.device.boardProfile, 'release.device.boardProfile', c);
  }
  profileRef(release.installation, 'release.installation', c);
}

function validateRelease(release, boardProfile, installation, c) {
  releaseShape(release, c);
  if (c.fields(boardProfile, 'boardProfile', ['schema', 'id', 'revision', 'boardModel', 'endpoints'])) {
    c.schema(boardProfile.schema, SCHEMAS.profile, 'boardProfile');
    for (const key of ['id', 'revision', 'boardModel']) c.text(boardProfile[key], `boardProfile.${key}`);
    if (c.object(boardProfile.endpoints, 'boardProfile.endpoints')) {
      const addresses = new Set();
      for (const name of Object.keys(boardProfile.endpoints).sort()) {
        const endpoint = boardProfile.endpoints[name], p = `boardProfile.endpoints.${name}`;
        c.text(name, p);
        if (!c.fields(endpoint, p, ['direction', 'type', 'driver', 'address', 'activeLevel', 'safeLevel'])) continue;
        if (!['input', 'output'].includes(endpoint.direction)) c.issue(`${p}.direction`, 'shape', 'expected input or output');
        for (const key of ['type', 'driver', 'address']) c.text(endpoint[key], `${p}.${key}`);
        if (!['high', 'low'].includes(endpoint.activeLevel)) c.issue(`${p}.activeLevel`, 'shape', 'expected high or low');
        if (![0, 1].includes(endpoint.safeLevel)) c.issue(`${p}.safeLevel`, 'shape', 'expected numeric 0 or 1');
        const address = JSON.stringify([endpoint.driver, endpoint.address]);
        if (addresses.has(address)) c.issue(p, 'duplicate_endpoint', 'endpoint driver/address pair is already declared');
        addresses.add(address);
      }
    }
  }
  if (c.fields(installation, 'installation', ['schema', 'id', 'revision', 'boardProfile', 'bindings'])) {
    c.schema(installation.schema, SCHEMAS.installation, 'installation');
    c.text(installation.id, 'installation.id'); c.text(installation.revision, 'installation.revision');
    profileRef(installation.boardProfile, 'installation.boardProfile', c);
    if (c.object(installation.bindings, 'installation.bindings')) {
      const used = new Set();
      for (const name of Object.keys(installation.bindings).sort()) {
        const endpointId = installation.bindings[name], p = `installation.bindings.${name}`;
        c.text(name, p); c.text(endpointId, p);
        if (typeof endpointId !== 'string' || !isObject(boardProfile?.endpoints) || !own(boardProfile.endpoints, endpointId)) {
          c.issue(p, 'unknown_endpoint', 'binding must name an explicit endpoint in the pinned board profile');
        }
        if (used.has(endpointId)) c.issue(p, 'duplicate_binding', 'endpoint already bound to another logical name');
        used.add(endpointId);
      }
    }
  }
  if (c.errors.length) return;
  const profileDigest = c.digestOf(boardProfile, 'boardProfile');
  for (const [ref, p] of [[release.device.boardProfile, 'release.device.boardProfile'], [installation.boardProfile, 'installation.boardProfile']]) {
    c.equal(ref.id, boardProfile.id, `${p}.id`, 'profile_mismatch');
    c.equal(ref.revision, boardProfile.revision, `${p}.revision`, 'profile_mismatch');
    c.equal(ref.sha256, profileDigest, `${p}.sha256`, 'profile_mismatch');
  }
  c.equal(release.installation.id, installation.id, 'release.installation.id', 'mapping_mismatch');
  c.equal(release.installation.revision, installation.revision, 'release.installation.revision', 'mapping_mismatch');
  c.equal(release.installation.sha256, c.digestOf(installation, 'installation'), 'release.installation.sha256', 'mapping_mismatch');
}

/** Validates pinned metadata against supplied profile/mapping; performs no I/O. */
export function validateReleaseIdentity(release, { boardProfile, installation } = {}) {
  const c = checks(); validateRelease(release, boardProfile, installation, c); return c.result();
}

function artifactDigests(artifacts, c) {
  if (!c.fields(artifacts, 'artifacts', ['source', 'module', 'manifest'])) return null;
  if (typeof artifacts.source !== 'string') c.issue('artifacts.source', 'shape', 'expected exact source text');
  if (!(artifacts.module instanceof Uint8Array)) c.issue('artifacts.module', 'shape', 'expected module bytes as Uint8Array');
  if (c.object(artifacts.manifest, 'artifacts.manifest')) c.digest(artifacts.manifest.bytecodeSha256, 'artifacts.manifest.bytecodeSha256');
  if (c.errors.length) return null;
  const digests = { sourceSha256: sha256(artifacts.source), moduleSha256: sha256(artifacts.module), manifestSha256: c.digestOf(artifacts.manifest, 'artifacts.manifest') };
  c.equal(artifacts.manifest.bytecodeSha256, digests.moduleSha256, 'artifacts.manifest.bytecodeSha256', 'artifact_mismatch');
  return digests;
}

function checkBindings(manifest, profile, installation, c) {
  const names = new Set();
  for (const [list, direction] of [['inputs', 'input'], ['outputs', 'output']]) {
    if (!Array.isArray(manifest[list])) { c.issue(`artifacts.manifest.${list}`, 'shape', 'expected an array'); continue; }
    manifest[list].forEach((entry, index) => {
      const p = `artifacts.manifest.${list}[${index}]`;
      if (!c.object(entry, p)) return;
      c.text(entry.name, `${p}.name`); c.text(entry.type, `${p}.type`);
      if (names.has(entry.name)) c.issue(`${p}.name`, 'duplicate_name', 'logical I/O name must be unique');
      names.add(entry.name);
      if (!own(installation.bindings, entry.name)) { c.issue(`${p}.name`, 'missing_binding', 'logical name has no explicit installation binding'); return; }
      const endpoint = profile.endpoints[installation.bindings[entry.name]];
      c.equal(endpoint.direction, direction, p, 'direction_mismatch');
      c.equal(endpoint.type, entry.type, p, 'type_mismatch');
    });
  }
}

const sources = {
  host: ['none', 'host-tests', 'injected-fixture'],
  hardware: ['none', 'device-status', 'gpio-readback', 'register-readback'],
  physical: ['none', 'physical-observation'],
};

function validateRun(run, release, artifacts, c) {
  releaseShape(release, c);
  const actual = artifactDigests(artifacts, c);
  if (!c.fields(run, 'run', ['schema', 'kind', 'releaseSha256', 'startedAt', 'finishedAt', 'artifacts', 'device', 'gates'])) return;
  c.schema(run.schema, SCHEMAS.run, 'run'); c.digest(run.releaseSha256, 'run.releaseSha256');
  if (!['recorded-evidence', 'fictional-fixture'].includes(run.kind)) c.issue('run.kind', 'evidence_source', 'expected recorded-evidence or fictional-fixture');
  const timestamp = (value, p) => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
      c.issue(p, 'timestamp', 'expected canonical UTC ISO timestamp with milliseconds'); return null;
    }
    return Date.parse(value);
  };
  const start = timestamp(run.startedAt, 'run.startedAt'), end = timestamp(run.finishedAt, 'run.finishedAt');
  if (start !== null && end !== null && end < start) c.issue('run.finishedAt', 'timestamp', 'finish precedes start');
  if (c.fields(run.artifacts, 'run.artifacts', ['sourceSha256', 'moduleSha256', 'manifestSha256'])) {
    for (const key of ['sourceSha256', 'moduleSha256', 'manifestSha256']) {
      c.digest(run.artifacts[key], `run.artifacts.${key}`);
      if (actual) c.equal(run.artifacts[key], actual[key], `run.artifacts.${key}`, 'artifact_mismatch');
    }
  }
  if (c.fields(run.gates, 'run.gates', ['host', 'hardware', 'physical'])) {
    for (const name of ['host', 'hardware', 'physical']) {
      const gate = run.gates[name], p = `run.gates.${name}`;
      if (!c.fields(gate, p, ['status', 'source', 'scope'])) continue;
      if (!STATUSES.includes(gate.status)) c.issue(`${p}.status`, 'status', 'expected not_run, pass, fail, or unknown');
      c.text(gate.scope, `${p}.scope`);
      if (!c.fields(gate.source, `${p}.source`, ['type', 'reference'])) continue;
      if (!sources[name].includes(gate.source.type)) c.issue(`${p}.source.type`, 'evidence_source', 'evidence source cannot support this gate');
      if (gate.source.type === 'none') {
        if (gate.source.reference !== null) c.issue(`${p}.source.reference`, 'evidence_source', 'none requires a null reference');
        if (['pass', 'fail'].includes(gate.status)) c.issue(`${p}.status`, 'evidence_source', 'pass/fail requires a recorded evidence source');
      } else {
        c.text(gate.source.reference, `${p}.source.reference`);
        if (gate.status === 'not_run') c.issue(`${p}.status`, 'evidence_source', 'not_run requires source type none');
      }
      if (name !== 'host' && gate.status === 'pass' && run.device === null) c.issue('run.device', 'device_required', 'device/physical pass requires device identity');
    }
  }
  if (run.device !== null && c.fields(run.device, 'run.device', ['bootId', 'observedAt', 'firmwareSha256', 'boardProfile', 'installation', 'runtimeSemanticsVersion', 'bytecodeFormat', 'protocolVersion', 'sourceSha256', 'moduleSha256'])) {
    c.text(run.device.bootId, 'run.device.bootId'); profileRef(run.device.boardProfile, 'run.device.boardProfile', c);
    profileRef(run.device.installation, 'run.device.installation', c);
    const observed = timestamp(run.device.observedAt, 'run.device.observedAt');
    if (observed !== null && start !== null && end !== null && (observed < start || observed > end)) c.issue('run.device.observedAt', 'timestamp', 'observation must lie within the run');
    for (const key of ['firmwareSha256', 'sourceSha256', 'moduleSha256']) c.digest(run.device[key], `run.device.${key}`);
    for (const key of ['runtimeSemanticsVersion', 'bytecodeFormat', 'protocolVersion']) c.text(run.device[key], `run.device.${key}`);
  }
  if (c.errors.length) return;
  c.equal(run.releaseSha256, c.digestOf(release, 'release'), 'run.releaseSha256', 'release_mismatch');
  if (run.device !== null) {
    c.equal(run.device.firmwareSha256, release.device.firmwareSha256, 'run.device.firmwareSha256', 'firmware_mismatch');
    for (const key of ['id', 'revision', 'sha256']) c.equal(run.device.boardProfile[key], release.device.boardProfile[key], `run.device.boardProfile.${key}`, 'profile_mismatch');
    for (const key of ['id', 'revision', 'sha256']) c.equal(run.device.installation[key], release.installation[key], `run.device.installation.${key}`, 'mapping_mismatch');
    for (const key of ['runtimeSemanticsVersion', 'bytecodeFormat', 'protocolVersion']) c.equal(run.device[key], release[key], `run.device.${key}`);
    for (const key of ['sourceSha256', 'moduleSha256']) c.equal(run.device[key], run.artifacts[key], `run.device.${key}`, 'artifact_mismatch');
  }
}

/** Checks the declaration of evidence, never the truth of a physical claim. */
export function validateRunEvidence(run, { release, artifacts } = {}) {
  const c = checks(); validateRun(run, release, artifacts, c); return c.result();
}

/** Complete metadata/artifact check. No run means there is no execution evidence. */
export function validateIntegration({ release, boardProfile, installation, artifacts, runEvidence = null } = {}) {
  const c = checks(); validateRelease(release, boardProfile, installation, c);
  if (!c.errors.length) {
    const digests = artifactDigests(artifacts, c);
    if (digests && !c.errors.length) checkBindings(artifacts.manifest, boardProfile, installation, c);
  }
  if (runEvidence !== null && !c.errors.length) validateRun(runEvidence, release, artifacts, c);
  return c.result();
}
