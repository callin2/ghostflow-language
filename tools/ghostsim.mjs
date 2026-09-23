#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '@toon-format/toon';
import { verifyArtifactSourceMap } from './toolchain.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MAX_SCENARIO_BYTES = 256 * 1024;
const MAX_ACTIONS = 1024;
const MAX_SCANS = 256;
const MAX_RESULT_BYTES = 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireShape(value, keys, location) {
  if (!object(value)) throw new Error(`${location}: expected object`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${location}: unknown field ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${location}: missing field ${key}`);
  }
}

function requireName(value, location) {
  if (typeof value !== 'string' || !value || /[\t\r\n]/u.test(value)) {
    throw new Error(`${location}: expected nonempty text without control separators`);
  }
}

function requireTyped(input, location) {
  requireShape(input, ['name', 'type', 'value'], location);
  requireName(input.name, `${location}.name`);
  const valid = input.type === 'Bool' ? typeof input.value === 'boolean'
    : input.type === 'Int' ? Number.isInteger(input.value) && input.value >= -2147483648 && input.value <= 2147483647
      : input.type === 'Number' ? typeof input.value === 'number' && Number.isFinite(input.value) : false;
  if (!valid) throw new Error(`${location}: invalid ${input.type} value`);
}

export function validateScenario(scenario, manifest) {
  requireShape(scenario, ['format', 'id', 'initialInputs', 'keyBindings', 'actions'], 'scenario');
  if (scenario.format !== 'GhostFlow/scenario-v1') throw new Error('scenario.format: unsupported version');
  requireName(scenario.id, 'scenario.id');
  if (!Array.isArray(scenario.initialInputs)) throw new Error('initialInputs: expected array');
  if (!Array.isArray(scenario.keyBindings)) throw new Error('keyBindings: expected array');
  if (!Array.isArray(scenario.actions) || scenario.actions.length > MAX_ACTIONS) {
    throw new Error(`actions: expected at most ${MAX_ACTIONS} actions`);
  }
  const fields = new Map(manifest.inputs.filter(field => field.name !== '__gf_now_ms').map(field => [field.name, field.type]));
  const inputs = new Map();
  for (const [index, input] of scenario.initialInputs.entries()) {
    const location = `initialInputs[${index}]`;
    requireTyped(input, location);
    if (!fields.has(input.name)) throw new Error(`${location}: unknown input ${input.name}`);
    if (inputs.has(input.name)) throw new Error(`${location}: duplicate input ${input.name}`);
    if (fields.get(input.name) !== input.type) throw new Error(`${location}: type mismatch ${input.name}`);
    inputs.set(input.name, input.value);
  }
  for (const name of fields.keys()) {
    if (!inputs.has(name)) throw new Error(`initialInputs: missing input ${name}`);
  }
  const keys = new Set();
  const boundInputs = new Set();
  for (const [index, binding] of scenario.keyBindings.entries()) {
    const location = `keyBindings[${index}]`;
    requireShape(binding, ['key', 'input'], location);
    if (!Number.isInteger(binding.key) || binding.key < 1 || binding.key > 8) throw new Error(`${location}: key must be 1..8`);
    if (keys.has(binding.key)) throw new Error(`${location}: duplicate key ${binding.key}`);
    if (boundInputs.has(binding.input)) throw new Error(`${location}: duplicate binding ${binding.input}`);
    if (fields.get(binding.input) !== 'Bool') throw new Error(`${location}: binding ${binding.input} must be a Bool input`);
    keys.add(binding.key);
    boundInputs.add(binding.input);
  }
  let scans = 0;
  let previousTime = null;
  for (const [index, action] of scenario.actions.entries()) {
    const location = `actions[${index}]`;
    if (!object(action)) throw new Error(`${location}: expected object`);
    switch (action.kind) {
      case 'input':
        requireShape(action, ['kind', 'name', 'type', 'value'], location);
        requireTyped({ name: action.name, type: action.type, value: action.value }, location);
        if (!fields.has(action.name)) throw new Error(`${location}: unknown input ${action.name}`);
        if (fields.get(action.name) !== action.type) throw new Error(`${location}: type mismatch ${action.name}`);
        break;
      case 'key':
        requireShape(action, ['kind', 'key', 'event'], location);
        if (!keys.has(action.key)) throw new Error(`${location}: unbound key ${action.key}`);
        if (!['down', 'up'].includes(action.event)) throw new Error(`${location}: key event must be down or up`);
        break;
      case 'scan':
        requireShape(action, ['kind', 'atMs'], location);
        if (!Number.isSafeInteger(action.atMs) || action.atMs < 0) throw new Error(`${location}: atMs must be an exact nonnegative integer`);
        if (previousTime !== null && action.atMs < previousTime) throw new Error(`${location}: logical time moved backwards`);
        previousTime = action.atMs;
        if (++scans > MAX_SCANS) throw new Error(`${location}: scan budget ${MAX_SCANS} exceeded`);
        break;
      default: throw new Error(`${location}: unknown action kind ${String(action.kind)}`);
    }
  }
  if (scans === 0) throw new Error('actions: at least one scan is required');
  return scans;
}

export function loadVerifiedArtifact(artifactPath) {
  const artifactBytes = fs.readFileSync(artifactPath);
  const manifest = JSON.parse(fs.readFileSync(`${artifactPath}.manifest.json`, 'utf8'));
  const map = JSON.parse(fs.readFileSync(`${artifactPath}.map.json`, 'utf8'));
  const document = verifyArtifactSourceMap(map, artifactBytes, { manifest });
  if (!/^GhostFlow\/control-v[1-6]$/u.test(manifest.format)) throw new Error('artifact must be an executable control artifact');
  if (manifest.bytecodeSha256 !== sha256(artifactBytes)) throw new Error('artifact SHA-256 mismatch');
  return { artifactBytes, manifest, map, document };
}

export function runScenario(artifactPath, scenarioPath, { format = 'toon' } = {}) {
  if (!['toon', 'json'].includes(format)) throw new Error('--format must be toon or json');
  const scenarioBytes = fs.readFileSync(scenarioPath);
  if (scenarioBytes.length > MAX_SCENARIO_BYTES) throw new Error(`scenario exceeds ${MAX_SCENARIO_BYTES} bytes`);
  const scenario = decode(new TextDecoder('utf-8', { fatal: true }).decode(scenarioBytes), { strict: true });
  const { manifest, map, document } = loadVerifiedArtifact(artifactPath);
  const scanCount = validateScenario(scenario, manifest);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-run-'));
  try {
    const actionsPath = path.join(directory, 'actions.json');
    fs.writeFileSync(actionsPath, JSON.stringify(scenario));
    const identity = {
      format: 'GhostFlow/scenario-result-v1',
      scenario: { id: scenario.id, sha256: sha256(scenarioBytes) },
      artifact: {
        bytecodeSha256: manifest.bytecodeSha256,
        sourceDocumentSha256: document.sha256,
        sourceFilename: document.filename,
        ...(map.interactionSourceIdentity ? { sourceIdentity: map.interactionSourceIdentity } : {}),
      },
      outputMeaning: 'virtual intent; no physical output applied or confirmed',
    };
    const encodeResult = result => (format === 'json' ? JSON.stringify(result) : encode(result)) + '\n';
    const hostError = error => {
      const message = String(error.message ?? error).slice(0, 4096);
      return {
        encoded: encodeResult({
          ...identity, outcome: 'host-error', traceComplete: false, scans: [],
          error: { location: 'host', message: `native observations unavailable: ${message}` },
        }),
        success: false,
      };
    };
    const child = spawnSync(path.join(root, 'target/release/examples/scenario_scan'), [artifactPath, actionsPath], {
      encoding: 'utf8', timeout: 20_000, maxBuffer: MAX_RESULT_BYTES + 4096,
    });
    if (child.error) return hostError(child.error);
    if (child.status === null) return hostError(new Error(`native runner terminated by ${child.signal ?? 'unknown signal'}`));
    let rows;
    try {
      rows = child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (child.status === 0 && rows.length !== scanCount) throw new Error(`native runner returned ${rows.length} of ${scanCount} scans`);
    } catch (error) {
      return hostError(error);
    }
    const failed = child.status !== 0;
    const diagnostic = child.stderr.trim() || `native runner exited ${child.status}`;
    const indexedError = /^action\[(\d+)\]: (.*)$/u.exec(diagnostic);
    const activationError = /^activation: (.*)$/u.exec(diagnostic);
    if (failed && !indexedError && !activationError) return hostError(new Error(diagnostic));
    let scans;
    try {
      scans = rows.map(row => ({
        scanId: row.scanId, logicalTimeMs: row.logicalTimeMs,
        inputs: row.trace.inputs,
        requestedVirtualIntent: row.trace.requested,
        safeVirtualIntent: row.trace.safe,
        faults: row.trace.faults,
        stateBefore: row.trace.stateBefore,
        stateAfter: row.trace.stateAfter,
      }));
    } catch (error) {
      return hostError(error);
    }
    const result = {
      ...identity,
      outcome: !failed ? 'completed' : indexedError ? 'runtime-error' : 'rejected',
      scans,
      ...(failed ? { error: indexedError
        ? { actionIndex: Number(indexedError[1]), message: indexedError[2] }
        : { location: activationError ? 'activation' : 'runner', message: activationError ? activationError[1] : diagnostic } } : {}),
    };
    let encoded;
    try {
      encoded = encodeResult(result);
    } catch (error) {
      return hostError(error);
    }
    if (Buffer.byteLength(encoded) > MAX_RESULT_BYTES) {
      return hostError(new Error(`result budget ${MAX_RESULT_BYTES} bytes exceeded`));
    }
    return { encoded, success: !failed };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function rejectedScenario(artifactPath, scenarioPath, error, format) {
  let scenario = { id: null, sha256: null };
  let artifact = null;
  try {
    if (fs.statSync(scenarioPath).size <= MAX_SCENARIO_BYTES) {
      const bytes = fs.readFileSync(scenarioPath);
      scenario.sha256 = sha256(bytes);
      const decoded = decode(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { strict: true });
      if (object(decoded) && typeof decoded.id === 'string') scenario.id = decoded.id.slice(0, 256);
    }
  } catch { /* The rejection still reports its original decode or file error. */ }
  try {
    const bytes = fs.readFileSync(artifactPath);
    const manifest = JSON.parse(fs.readFileSync(`${artifactPath}.manifest.json`, 'utf8'));
    const map = JSON.parse(fs.readFileSync(`${artifactPath}.map.json`, 'utf8'));
    const document = verifyArtifactSourceMap(map, bytes, { manifest });
    artifact = {
      bytecodeSha256: manifest.bytecodeSha256,
      sourceDocumentSha256: document.sha256,
      sourceFilename: document.filename,
      ...(map.interactionSourceIdentity ? { sourceIdentity: map.interactionSourceIdentity } : {}),
    };
  } catch { /* An unverified artifact has no claimed identity. */ }
  const message = String(error.message).slice(0, 4096);
  const line = /^Line (\d+):/u.exec(message);
  const path = /^([A-Za-z][\w.]*\[?\d*\]?):/u.exec(message);
  const location = line ? `line:${line[1]}` : path?.[1] ?? 'scenario';
  const result = {
    format: 'GhostFlow/scenario-result-v1', scenario, artifact,
    outcome: 'rejected', outputMeaning: 'virtual intent; no physical output applied or confirmed',
    scans: [], error: { location, message, ...(String(error.message).length > 4096 ? { diagnosticTruncated: true } : {}) },
  };
  return (format === 'json' ? JSON.stringify(result) : encode(result)) + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length > 4 || args.slice(2).length % 2 !== 0) {
    console.error('usage: ghostsim <artifact.gfb> <scenario.toon> [--format toon|json]');
    process.exitCode = 2;
  } else {
    const options = {};
    try {
      for (let index = 2; index < args.length; index += 2) {
        const name = args[index];
        if (name === '--format' && options.format === undefined) options.format = args[index + 1];
        else throw new Error(`unknown or repeated option ${name}`);
      }
      const result = runScenario(args[0], args[1], options);
      process.stdout.write(result.encoded);
      if (!result.success) process.exitCode = 1;
    } catch (error) {
      process.stdout.write(rejectedScenario(args[0], args[1], error, options?.format === 'json' ? 'json' : 'toon'));
      process.exitCode = 1;
    }
  }
}
