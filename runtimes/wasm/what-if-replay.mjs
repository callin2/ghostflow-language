import { ControlRuntime } from './control-runtime.mjs';
import { compileSource, verifyArtifactSourceMap } from '../../tools/toolchain.mjs';
import { canonicalJson } from '../../tools/canonical-json.mjs';
import { sha256Hex } from '../../tools/sha256.mjs';

const MAX_FRAMES = 256;
const MAX_BYTES = 1024 * 1024;
const copy = value => structuredClone(value);
const digest = value => sha256Hex(new TextEncoder().encode(canonicalJson(value)));
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}
function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}: unknown ${key}`);
}
function id(value, label) {
  if (typeof value !== 'string' || !value.length || value.length > 128) throw new TypeError(`${label} must be a bounded identity`);
}
function bounded(value) {
  if (new TextEncoder().encode(canonicalJson(value)).length > MAX_BYTES) throw new RangeError('replay record byte budget exceeded');
}

/** A bounded, source-bound reference ghost. The checkpoint is an event-sourced
 * initial-state prefix, not a foreign VM memory image. No live runtime or sink
 * is accepted by this API. Each request executes on a fresh portable core. */
export async function prepareWhatIfReplay({ wasmBytes, compilation, identity, prefix = [], future = [] }) {
  const artifact = copy(compilation);
  const wasm = new Uint8Array(wasmBytes);
  keys(identity, ['timelineId', 'instanceId', 'runId', 'sourceRevision', 'bindingRevision'], 'identity');
  for (const name of ['timelineId', 'instanceId', 'runId', 'sourceRevision', 'bindingRevision']) id(identity[name], name);
  const origin = copy(identity);
  // Capture caller-owned recordings before compilation suspends preparation.
  // Data supplied afterwards must use explicit synthetic branch inputs.
  const recordedPrefix = copy(prefix), recordedFuture = copy(future);
  verifyArtifactSourceMap({
    format: 'GhostFlow/source-map-v1', bytecodeSha256: sha256Hex(artifact.bytes),
    sourceDocument: artifact.sourceDocument,
    ...(artifact.sourceClosure ? { sourceClosure: artifact.sourceClosure } : {}),
    nodes: artifact.sourceMap, lines: artifact.extractionMap ?? null,
    traceMetadata: artifact.traceMetadata ?? null,
    interactionSchema: artifact.interactionSchema ?? null,
    interactionSourceIdentity: artifact.interactionSourceIdentity ?? null,
  }, artifact.bytes, { manifest: artifact.manifest });
  const rebuilt = await compileSource(artifact.sourceDocument.text, {
    filename: artifact.sourceDocument.filename,
    ...(artifact.sourceClosure ? { sourceClosure: artifact.sourceClosure.documents } : {}),
    ...(artifact.interactionSourceIdentity ? { interactionSourceIdentity: artifact.interactionSourceIdentity } : {}),
  });
  if (sha256Hex(rebuilt.bytes) !== sha256Hex(artifact.bytes)
      || canonicalJson(rebuilt.manifest) !== canonicalJson(artifact.manifest)) {
    throw new Error('replay manifest or bytecode does not match canonical compiled source');
  }
  const manifest = artifact.manifest;
  if (manifest?.format !== 'GhostFlow/control-v1'
      || ['configs', 'schedules', 'contexts', 'controllers', 'objectives', 'afterEvents'].some(key => manifest[key]?.length)) {
    throw new Error('what-if profile requires a plain control without settings, schedules or external bindings');
  }
  const required = {
    inputs: manifest.inputs.filter(input => !input.name.startsWith('__gf_')).map(input => input.name),
    samples: manifest.sensors.map(sensor => sensor.name),
  };
  if (!Array.isArray(recordedPrefix) || !Array.isArray(recordedFuture) || recordedPrefix.length + recordedFuture.length > MAX_FRAMES) {
    throw new RangeError(`replay requires at most ${MAX_FRAMES} frames`);
  }
  bounded([recordedPrefix, recordedFuture]);
  let previous = -1;
  for (const [index, frame] of [...recordedPrefix, ...recordedFuture].entries()) {
    keys(frame, ['nowMs', 'inputs', 'samples'], `frame ${index}`);
    if (!Number.isSafeInteger(frame.nowMs) || frame.nowMs < 0 || frame.nowMs <= previous) throw new Error('replay times must increase');
    previous = frame.nowMs;
    for (const group of ['inputs', 'samples']) {
      keys(frame[group] ?? {}, required[group], `frame ${index} ${group}`);
    }
  }
  const missing = frames => frames.flatMap((frame, offset) => Object.entries(required).flatMap(([kind, names]) =>
    names.filter(name => !Object.hasOwn(frame[kind] ?? {}, name)).map(name => ({ offset, logicalTimeMs: frame.nowMs, kind, name }))));
  if (missing(recordedPrefix).length) throw new Error('baseline checkpoint prefix has missing recorded inputs');
  async function execute(frames) {
    const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
    try { return frames.map(frame => copy(runtime.step(frame))); }
    finally { runtime.dispose(); }
  }
  const baseline = await execute(recordedPrefix);
  const checkpoint = {
    format: 'GhostFlow/replay-prefix-checkpoint-v1', prefixSha256: digest(recordedPrefix),
    outcomesSha256: digest(baseline), frameCount: recordedPrefix.length,
    bytecodeSha256: sha256Hex(artifact.bytes), sourceDocumentSha256: artifact.sourceDocument.sha256,
    sourceClosureSha256: digest(artifact.sourceClosure ?? { root: artifact.sourceDocument.sha256 }),
    identity: origin, settingsRevision: 0,
  };
  checkpoint.sha256 = digest(checkpoint);
  const original = missing(recordedFuture).length ? null : await execute([...recordedPrefix, ...recordedFuture]);
  return Object.freeze({
    checkpoint: copy(checkpoint),
    async branch({ branchId, runId, synthetic = [] }) {
      id(branchId, 'branchId'); id(runId, 'branch runId');
      if (branchId === origin.timelineId || runId === origin.runId) throw new Error('ghost branch requires separate identities');
      if (!Array.isArray(synthetic) || synthetic.length > MAX_FRAMES * 128) throw new RangeError('synthetic input budget exceeded');
      bounded(synthetic);
      const frames = copy(recordedFuture), provenance = [];
      const seen = new Set();
      for (const entry of synthetic) {
        keys(entry, ['offset', 'kind', 'name', 'value', 'provenance'], 'synthetic input');
        if (entry.provenance !== 'synthetic') throw new Error('virtual inputs must explicitly declare synthetic provenance');
        if (!Number.isInteger(entry.offset) || entry.offset < 0 || entry.offset >= frames.length
            || !Object.hasOwn(required, entry.kind) || !required[entry.kind].includes(entry.name)) throw new Error('synthetic input does not address a required branch input');
        const key = `${entry.offset}:${entry.kind}:${entry.name}`;
        if (seen.has(key)) throw new Error('duplicate synthetic input');
        seen.add(key);
        frames[entry.offset][entry.kind] ??= {};
        frames[entry.offset][entry.kind][entry.name] = copy(entry.value);
      }
      const gaps = missing(frames);
      const receipt = { format: 'GhostFlow/what-if-replay-v1', branchId, runId, origin: copy(origin),
        checkpoint: copy(checkpoint), physicalEffects: false, missing: gaps, frames: [] };
      if (gaps.length) return { ...receipt, status: 'missing-input' };
      // Validate the entire request before publishing any outcomes. A rejected
      // request cannot consume the baseline, IDs or original runtime state.
      const results = await execute([...recordedPrefix, ...frames]);
      if (digest(results.slice(0, recordedPrefix.length)) !== checkpoint.outcomesSha256) throw new Error('baseline replay diverged');
      for (const [offset, frame] of frames.entries()) {
        for (const [kind, names] of Object.entries(required)) for (const name of names) provenance.push({
          offset, logicalTimeMs: frame.nowMs, kind, name,
          provenance: seen.has(`${offset}:${kind}:${name}`) ? 'synthetic' : 'recorded',
        });
        receipt.frames.push({ logicalTimeMs: frame.nowMs, inputs: copy(frame.inputs ?? {}), samples: copy(frame.samples ?? {}),
          original: original ? copy(original[recordedPrefix.length + offset]) : null,
          candidate: results[recordedPrefix.length + offset] });
      }
      return { ...receipt, status: 'completed', provenance };
    },
  });
}
