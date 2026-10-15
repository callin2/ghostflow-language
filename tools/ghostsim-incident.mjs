#!/usr/bin/env node
// Replay completed virtual scans through ghostsim. No ingress reducer or VM.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runScenario, loadVerifiedArtifact } from './ghostsim.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['program.gfb', 'program.gfb.manifest.json', 'program.gfb.map.json', 'scenario.toon', 'record.json'];
const MAX_FILE = 4 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MEANING = 'Recorded virtual decisions only; no physical effect/contact or closed-loop process evidence. Hash consistency is not provenance authentication.';

function fail(code, partial = false, gaps = []) {
  throw Object.assign(new Error(code), { incidentCode: code, partial, gaps });
}
function requireValue(condition, code) { if (!condition) fail(code); }
function read(file, limit = MAX_FILE) {
  let fd;
  try {
    requireValue(fs.lstatSync(file).isFile(), 'invalid-artifact-file');
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if (error.incidentCode) throw error;
    if (error.code === 'ENOENT') fail('artifact-missing', true, ['artifact-missing']);
    if (error.code === 'ELOOP') fail('invalid-artifact-file');
    fail('artifact-read-failed');
  }
  try {
    const stat = fs.fstatSync(fd);
    requireValue(stat.isFile() && stat.size <= limit, 'invalid-artifact-file');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function parse(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('invalid-json'); }
}
function resultError(error) {
  return { format: 'GhostFlow/incident-replay-result-v1', outcome: error.partial ? 'partial' : 'rejected',
    matched: false, scans: [], gaps: error.gaps ?? [], error: { code: error.incidentCode ?? 'incident-operation-failed' }, evidenceMeaning: MEANING };
}
function directory(root) {
  const resolved = path.resolve(root);
  const stat = fs.lstatSync(resolved);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'invalid-bundle-directory');
  return resolved;
}
function runtimeIdentity(engine) {
  requireValue(engine === 'native' || engine === 'wasm', 'unsupported-runtime');
  const binary = engine === 'native' ? 'target/release/examples/scenario_scan' : 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm';
  const hosts = [
    ...fs.readdirSync(path.join(ROOT, 'tools')).filter(n => n.endsWith('.mjs')).map(n => `tools/${n}`),
    ...fs.readdirSync(path.join(ROOT, 'runtimes/wasm')).filter(n => n.endsWith('.mjs')).map(n => `runtimes/wasm/${n}`)].sort();
  // A content revision, not a guessed Git/build ID. No machine paths or times.
  const hostRevision = hosts.map(name => [name, digest(read(path.join(ROOT, name)))]);
  return { engine, coreSha256: digest(read(path.join(ROOT, binary))), hostSha256: digest(json(hostRevision)),
    dependencyLockSha256: digest(read(path.join(ROOT, 'package-lock.json'))), nodeVersion: process.versions.node };
}
function readManifest(root) {
  const bytes = read(path.join(root, 'manifest.json'));
  const seal = read(path.join(root, 'manifest.sha256'), 128).toString('ascii').trim();
  requireValue(/^[a-f0-9]{64}$/.test(seal) && digest(bytes) === seal, 'manifest-integrity-mismatch');
  return { manifest: parse(bytes), manifestSha256: seal };
}
function verifyFiles(root, artifacts, exactNames = null) {
  requireValue(Array.isArray(artifacts) && artifacts.length <= 32, 'invalid-artifact-inventory');
  const seen = new Set(), missing = [], files = new Map();
  for (const item of artifacts) {
    requireValue(object(item) && typeof item.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(item.name)
      && !seen.has(item.name), 'invalid-artifact-inventory');
    seen.add(item.name);
    if (item.status !== undefined && item.status !== 'present') { missing.push(item.name); continue; }
    const bytes = read(path.join(root, item.name));
    requireValue(Number.isSafeInteger(item.bytes) && item.bytes === bytes.length && /^[a-f0-9]{64}$/.test(item.sha256)
      && digest(bytes) === item.sha256, 'artifact-integrity-mismatch');
    files.set(item.name, bytes);
  }
  if (exactNames) requireValue(same([...seen].sort(), [...exactNames].sort()) && missing.length === 0, 'invalid-artifact-inventory');
  return { missing, files };
}
function withSnapshot(files, execute) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-incident-execution-'));
  try {
    for (const [name, bytes] of files) fs.writeFileSync(path.join(stage, name), bytes, { mode: 0o400, flag: 'wx' });
    const artifact = path.join(stage, 'program.gfb');
    loadVerifiedArtifact(artifact);
    return execute(artifact, path.join(stage, 'scenario.toon'));
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
function availableRuntimes() {
  return Object.fromEntries(['native', 'wasm'].map(engine => {
    try { return [engine, runtimeIdentity(engine)]; }
    catch (error) { if (error.incidentCode !== 'artifact-missing') throw error; return [engine, null]; }
  }));
}
function verifyRuntimeAfter(execution, before) {
  const runtime = runtimeIdentity(execution.executor);
  requireValue(same(before[execution.executor], runtime), 'runtime-revision-mismatch');
  return runtime;
}
function verifyRecord(record, capture) {
  requireValue(record?.format === 'GhostFlow/scenario-result-v1' && record.outcome === 'completed'
    && Array.isArray(record.scans) && record.scans.length > 0 && record.scans.length <= 256, 'incomplete-recorded-execution');
  if (!object(record.scans[0]?.stateBefore)) fail('initial-state-unknown', true, ['initial-state-unknown']);
  let previousTime = -1;
  for (const [i, scan] of record.scans.entries()) {
    requireValue(scan.scanId === i, 'scan-sequence-gap');
    requireValue(Number.isSafeInteger(scan.logicalTimeMs) && scan.logicalTimeMs >= 0 && scan.logicalTimeMs >= previousTime, 'clock-boundary');
    requireValue(scan.bootId === undefined || scan.bootId === capture.bootId, 'boot-boundary');
    requireValue(object(scan.stateBefore) && object(scan.stateAfter) && object(scan.safeVirtualIntent)
      && object(scan.requestedVirtualIntent) && object(scan.inputs), 'incomplete-scan');
    previousTime = scan.logicalTimeMs;
  }
}

export function captureIncident({ artifactPath, scenarioPath, directory: destination } = {}) {
  try {
    // Snapshot user-selected inputs before running; never follow paths in data.
    const supplied = [artifactPath, `${artifactPath}.manifest.json`, `${artifactPath}.map.json`, scenarioPath].map(f => read(f));
    const files = new Map(FILES.slice(0, 4).map((name, i) => [name, supplied[i]]));
    const before = availableRuntimes();
    const execution = withSnapshot(files, (artifact, scenario) => runScenario(artifact, scenario, { format: 'json' }));
    const record = parse(Buffer.from(execution.encoded));
    requireValue(execution.success && record.outcome === 'completed', 'capture-execution-failed');
    const capture = { runId: `virtual-${randomUUID()}`, bootId: `virtual-${randomUUID()}`, initialState: 'program-initializers',
      settings: 'artifact-defaults-and-explicit-scenario-activation', bindings: 'artifact-and-explicit-scenario', ordering: 'explicit-scenario-actions' };
    verifyRecord(record, capture);
    files.set('record.json', json(record));
    const runtime = verifyRuntimeAfter(execution, before);
    const artifacts = [...files].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: digest(bytes) }));
    const manifest = { schema: 'GhostFlow/incident-replay-v1', version: 1, capture, runtime, artifacts };
    const bytes = json(manifest);
    const out = path.resolve(destination);
    fs.mkdirSync(out, { mode: 0o700 }); // Exclusive destination; no overwrite.
    for (const [name, content] of files) fs.writeFileSync(path.join(out, name), content, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(out, 'manifest.json'), bytes, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(out, 'manifest.sha256'), digest(bytes) + '\n', { mode: 0o600, flag: 'wx' });
    return { format: 'GhostFlow/incident-replay-result-v1', outcome: 'captured', identity: capture, runtime,
      manifestSha256: digest(bytes), source: record.artifact, scans: record.scans, evidenceMeaning: MEANING };
  } catch (error) { return resultError(error); }
}

export function replayIncident({ directory: suppliedDirectory, candidatePath } = {}, { runner = runScenario } = {}) {
  try {
    const root = directory(suppliedDirectory);
    const { manifest, manifestSha256 } = readManifest(root);
    if (manifest.schema === 'FarmStudio/incident-bundle-v1' && manifest.version === 1) {
      const { missing } = verifyFiles(root, manifest.artifacts);
      requireValue(Array.isArray(manifest.gaps) && manifest.gaps.every(g => typeof g === 'string' && /^[a-z][a-z0-9-]{0,100}$/.test(g)), 'invalid-historical-gaps');
      return { format: 'GhostFlow/incident-replay-result-v1', outcome: 'partial', matched: false, scans: [], manifestSha256,
        gaps: [...new Set([...manifest.gaps, ...(missing.length ? ['artifact-missing'] : []), 'completed-scan-capsule-unavailable'])].sort(),
        evidenceMeaning: `${MEANING} Historical System envelope integrity checked; producer semantic validation and missing execution context are not supplied.` };
    }
    requireValue(manifest.schema === 'GhostFlow/incident-replay-v1' && manifest.version === 1, 'unsupported-incident-format');
    const { files } = verifyFiles(root, manifest.artifacts, FILES);
    const capture = manifest.capture;
    if (!object(capture) || capture.initialState !== 'program-initializers') fail('initial-state-unknown', true, ['initial-state-unknown']);
    requireValue(['runId', 'bootId'].every(k => typeof capture[k] === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(capture[k])), 'run-identity-unavailable');
    requireValue(capture.settings === 'artifact-defaults-and-explicit-scenario-activation' && capture.bindings === 'artifact-and-explicit-scenario'
      && capture.ordering === 'explicit-scenario-actions', 'unsupported-execution-context');
    requireValue(object(manifest.runtime) && same(runtimeIdentity(manifest.runtime.engine), manifest.runtime), 'runtime-revision-mismatch');
    const recorded = parse(files.get('record.json'));
    verifyRecord(recorded, capture);
    const execution = withSnapshot(files, (artifact, scenario) => runner(artifact, scenario, { format: 'json' }));
    verifyRuntimeAfter(execution, { [manifest.runtime.engine]: manifest.runtime });
    const actual = parse(Buffer.from(execution.encoded));
    requireValue(execution.success && same(recorded, actual), 'recorded-execution-mismatch');
    const result = { format: 'GhostFlow/incident-replay-result-v1', outcome: 'completed', matched: true,
      identity: capture, runtime: manifest.runtime, manifestSha256, source: actual.artifact, scans: actual.scans, evidenceMeaning: MEANING };
    if (candidatePath !== undefined) {
      const candidateFiles = new Map(FILES.slice(0, 3).map((name, i) => [name, read([candidatePath, `${candidatePath}.manifest.json`, `${candidatePath}.map.json`][i])]));
      candidateFiles.set('scenario.toon', files.get('scenario.toon'));
      const candidateBefore = availableRuntimes();
      const candidateExecution = withSnapshot(candidateFiles, (artifact, scenario) => runner(artifact, scenario, { format: 'json' }));
      const candidateRuntime = verifyRuntimeAfter(candidateExecution, candidateBefore);
      const candidate = parse(Buffer.from(candidateExecution.encoded));
      requireValue(candidateExecution.success && candidate.scans?.length === actual.scans.length, 'candidate-execution-failed');
      const differences = [];
      for (const [i, scan] of actual.scans.entries()) {
        const next = candidate.scans[i];
        requireValue(next.scanId === scan.scanId && next.logicalTimeMs === scan.logicalTimeMs, 'candidate-scan-identity-mismatch');
        for (const channel of [...new Set([...Object.keys(scan.safeVirtualIntent), ...Object.keys(next.safeVirtualIntent)])].sort()) {
          const a = scan.safeVirtualIntent[channel], b = next.safeVirtualIntent[channel];
          if (!Object.is(a, b)) differences.push({ scanId: scan.scanId, logicalTimeMs: scan.logicalTimeMs, channel,
            original: a ?? null, candidate: b ?? null, originalPresent: Object.hasOwn(scan.safeVirtualIntent, channel), candidatePresent: Object.hasOwn(next.safeVirtualIntent, channel) });
        }
      }
      result.outcome = 'compared';
      result.candidate = { source: candidate.artifact, runtime: candidateRuntime, equivalent: differences.length === 0, differences };
    }
    return result;
  } catch (error) { return resultError(error); }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  let result;
  if (command === 'capture' && args.length === 3) result = captureIncident({ artifactPath: args[0], scenarioPath: args[1], directory: args[2] });
  else if (command === 'replay' && (args.length === 1 || args.length === 3 && args[1] === '--candidate')) result = replayIncident({ directory: args[0], candidatePath: args[2] });
  else result = resultError(Object.assign(new Error(), { incidentCode: 'cli-arguments' }));
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.outcome === 'partial' ? 2 : result.outcome === 'rejected' ? 1 : 0;
}
