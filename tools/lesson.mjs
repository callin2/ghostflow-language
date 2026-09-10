import { compileControl } from './control.mjs';
import { extractLiterate, mapSourcePosition } from './literate.mjs';

const UTF8 = new TextEncoder();
const RAW_JSON_LIMIT = 1024 * 1024;
const SOURCE_LIMIT = 64 * 1024;
const DURATION_LIMIT = 600_000;
const CHECKPOINT_LIMIT = 256;
const SCENARIO_LIMIT = 16;
const FRAMES_PER_SCENARIO_LIMIT = 1024;
const FRAMES_TOTAL_LIMIT = 4096;
const INPUTS_PER_FRAME_LIMIT = 128;
const NARRATION_LIMIT = 4096;
const ID_LIMIT = 128;
const TITLE_LIMIT = 256;
const LOCALE_LIMIT = 64;
const CANONICAL_DEPTH_LIMIT = 64;

export class LessonBundleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LessonBundleError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new LessonBundleError(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, keys, path) {
  if (!isPlainObject(value)) fail('invalid-schema', `${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('unknown-or-missing-field', `${path} must contain exactly: ${expected.join(', ')}`);
  }
  return value;
}

function boundedString(value, path, maximum, { nonempty = true } = {}) {
  if (typeof value !== 'string' || (nonempty && value.length === 0) || value.length > maximum) {
    fail('invalid-string', `${path} must be ${nonempty ? 'non-empty ' : ''}string at most ${maximum} characters`);
  }
  return value;
}

function safeInteger(value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('invalid-integer', `${path} must be a safe integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function detached(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(detached));
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.keys(value).map(key => [key, detached(value[key])])))
  }
  return value;
}

function canonicalValue(value, depth = 0) {
  if (depth > CANONICAL_DEPTH_LIMIT) throw new RangeError('canonical JSON nesting exceeds 64');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON does not support non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalValue(item, depth + 1)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(value[key], depth + 1)}`).join(',')}}`;
  }
  throw new TypeError('canonical JSON only supports plain JSON values');
}

/** Canonical JSON sorts object keys recursively while preserving array and UTF-8 string content.
 * It includes bundleSha256 when present; callers omit that own field to calculate a bundle digest. */
export function canonicalLessonJson(value) {
  return canonicalValue(value);
}

async function sha256(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail('crypto-unavailable', 'Web Crypto SHA-256 is required');
  const digest = await subtle.digest('SHA-256', UTF8.encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validateInputs(value, path) {
  if (!isPlainObject(value)) fail('invalid-inputs', `${path} must be an object`);
  const names = Object.keys(value);
  if (names.length > INPUTS_PER_FRAME_LIMIT) fail('input-limit', `${path} must contain at most ${INPUTS_PER_FRAME_LIMIT} inputs`);
  const inputs = Object.create(null);
  for (const name of names) {
    boundedString(name, `${path} input name`, ID_LIMIT);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name === '__proto__' || name === 'constructor' || name === 'prototype') {
      fail('invalid-inputs', `${path}.${name} is not an allowed input name`);
    }
    const input = value[name];
    if (typeof input !== 'boolean' && !(typeof input === 'number' && Number.isFinite(input))) {
      fail('invalid-inputs', `${path}.${name} must be a boolean or finite number`);
    }
    inputs[name] = input;
  }
  return inputs;
}

function validateSource(value) {
  exactObject(value, ['text', 'sha256', 'mediaType'], 'source');
  const text = boundedString(value.text, 'source.text', SOURCE_LIMIT, { nonempty: false });
  if (UTF8.encode(text).byteLength > SOURCE_LIMIT) fail('source-limit', 'source.text exceeds 64 KiB UTF-8');
  const sha256Value = boundedString(value.sha256, 'source.sha256', 64);
  if (!/^[a-f0-9]{64}$/.test(sha256Value)) fail('invalid-source-digest', 'source.sha256 must be a lowercase SHA-256 hex digest');
  if (value.mediaType !== 'text/markdown; profile=ghostflow-literate') fail('invalid-media-type', 'source.mediaType is not GhostFlow literate Markdown');
  return { text, sha256: sha256Value, mediaType: value.mediaType };
}

function validateToolchain(value) {
  exactObject(value, ['compilerId', 'compilerRevision', 'runtimeId', 'runtimeRevision', 'abiVersion'], 'toolchain');
  return {
    compilerId: boundedString(value.compilerId, 'toolchain.compilerId', ID_LIMIT),
    compilerRevision: boundedString(value.compilerRevision, 'toolchain.compilerRevision', ID_LIMIT),
    runtimeId: boundedString(value.runtimeId, 'toolchain.runtimeId', ID_LIMIT),
    runtimeRevision: boundedString(value.runtimeRevision, 'toolchain.runtimeRevision', ID_LIMIT),
    abiVersion: safeInteger(value.abiVersion, 'toolchain.abiVersion', 1, 1),
  };
}

function validateScenarios(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > SCENARIO_LIMIT) fail('scenario-limit', `scenarios must contain 1 to ${SCENARIO_LIMIT} entries`);
  const ids = new Set();
  let totalFrames = 0;
  const scenarios = value.map((scenario, scenarioIndex) => {
    const path = `scenarios[${scenarioIndex}]`;
    exactObject(scenario, ['id', 'title', 'frames'], path);
    const id = boundedString(scenario.id, `${path}.id`, ID_LIMIT);
    if (ids.has(id)) fail('duplicate-id', `duplicate scenario id: ${id}`);
    ids.add(id);
    const framesValue = scenario.frames;
    if (!Array.isArray(framesValue) || framesValue.length < 1 || framesValue.length > FRAMES_PER_SCENARIO_LIMIT) {
      fail('frame-limit', `${path}.frames must contain 1 to ${FRAMES_PER_SCENARIO_LIMIT} entries`);
    }
    totalFrames += framesValue.length;
    if (totalFrames > FRAMES_TOTAL_LIMIT) fail('frame-limit', `all scenarios must contain at most ${FRAMES_TOTAL_LIMIT} frames`);
    let previousAtMs = -1;
    const frames = framesValue.map((frame, frameIndex) => {
      const framePath = `${path}.frames[${frameIndex}]`;
      exactObject(frame, ['atMs', 'inputs'], framePath);
      const atMs = safeInteger(frame.atMs, `${framePath}.atMs`, 0, DURATION_LIMIT);
      if (atMs <= previousAtMs) fail('invalid-order', `${framePath}.atMs must be strictly increasing`);
      previousAtMs = atMs;
      return { atMs, inputs: validateInputs(frame.inputs, `${framePath}.inputs`) };
    });
    return { id, title: boundedString(scenario.title, `${path}.title`, TITLE_LIMIT), frames };
  });
  return { scenarios, ids };
}

function validateCheckpoints(value, durationMs, sourceLineCount, scenarioIds) {
  if (!Array.isArray(value) || value.length < 1 || value.length > CHECKPOINT_LIMIT) fail('checkpoint-limit', `playback.checkpoints must contain 1 to ${CHECKPOINT_LIMIT} entries`);
  let previousAtMs = -1;
  return value.map((checkpoint, index) => {
    const path = `playback.checkpoints[${index}]`;
    exactObject(checkpoint, ['atMs', 'sourceSpan', 'narration', 'scenarioId'], path);
    const atMs = safeInteger(checkpoint.atMs, `${path}.atMs`, 0, durationMs);
    if (atMs <= previousAtMs) fail('invalid-order', `${path}.atMs must be strictly increasing`);
    previousAtMs = atMs;
    exactObject(checkpoint.sourceSpan, ['startLine', 'endLine'], `${path}.sourceSpan`);
    const startLine = safeInteger(checkpoint.sourceSpan.startLine, `${path}.sourceSpan.startLine`, 1, sourceLineCount);
    const endLine = safeInteger(checkpoint.sourceSpan.endLine, `${path}.sourceSpan.endLine`, startLine, sourceLineCount);
    const narration = boundedString(checkpoint.narration, `${path}.narration`, NARRATION_LIMIT, { nonempty: false });
    const scenarioId = boundedString(checkpoint.scenarioId, `${path}.scenarioId`, ID_LIMIT);
    if (!scenarioIds.has(scenarioId)) fail('missing-scenario', `${path}.scenarioId does not reference a scenario`);
    return { atMs, sourceSpan: { startLine, endLine }, narration, scenarioId };
  });
}

function remapCompileError(error, extraction, filename) {
  if (!Number.isSafeInteger(error?.line)) throw error;
  const position = mapSourcePosition(extraction.sourceMap, error.line, Number.isSafeInteger(error.column) ? error.column : 1);
  if (!position) throw error;
  const detail = String(error.message).replace(/^.*?:\d+:\d+:\s*/, '');
  error.message = `${filename}:${position.line}:${position.column}: ${detail}`;
  error.filename = position.file;
  error.line = position.line;
  error.column = position.column;
  throw error;
}

export async function validateLessonBundle(jsonText) {
  if (typeof jsonText !== 'string') fail('invalid-json', 'lesson bundle must be JSON text');
  if (UTF8.encode(jsonText).byteLength > RAW_JSON_LIMIT) fail('raw-json-limit', 'lesson bundle exceeds 1 MiB UTF-8');
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    fail('invalid-json', 'lesson bundle is not valid JSON');
  }
  exactObject(parsed, ['format', 'lessonId', 'revision', 'title', 'locale', 'source', 'playback', 'scenarios', 'toolchain', 'bundleSha256'], 'bundle');
  if (parsed.format !== 'ghostflow-lesson-v1') fail('unsupported-format', 'bundle.format must be ghostflow-lesson-v1');
  const lessonId = boundedString(parsed.lessonId, 'lessonId', ID_LIMIT);
  const revision = boundedString(parsed.revision, 'revision', ID_LIMIT);
  const title = boundedString(parsed.title, 'title', TITLE_LIMIT);
  const locale = boundedString(parsed.locale, 'locale', LOCALE_LIMIT);
  const source = validateSource(parsed.source);
  exactObject(parsed.playback, ['durationMs', 'checkpoints'], 'playback');
  const durationMs = safeInteger(parsed.playback.durationMs, 'playback.durationMs', 0, DURATION_LIMIT);
  const { scenarios, ids } = validateScenarios(parsed.scenarios);
  const sourceLineCount = source.text.replace(/\r\n/g, '\n').split('\n').length;
  const checkpoints = validateCheckpoints(parsed.playback.checkpoints, durationMs, sourceLineCount, ids);
  const toolchain = validateToolchain(parsed.toolchain); // Structural identity only; it proves neither trust nor compatibility.
  const bundleSha256 = boundedString(parsed.bundleSha256, 'bundleSha256', 64);
  if (!/^[a-f0-9]{64}$/.test(bundleSha256)) fail('invalid-bundle-digest', 'bundleSha256 must be a lowercase SHA-256 hex digest');
  // Deliberately hash the original, unnormalized UTF-8 source; extraction may normalize CRLF later.
  if (await sha256(source.text) !== source.sha256) fail('source-digest-mismatch', 'source.sha256 does not match source.text');
  const { bundleSha256: _excluded, ...digestPayload } = parsed;
  if (await sha256(canonicalLessonJson(digestPayload)) !== bundleSha256) fail('bundle-digest-mismatch', 'bundleSha256 does not match the canonical bundle');
  return detached({ format: parsed.format, lessonId, revision, title, locale, source, playback: { durationMs, checkpoints }, scenarios, toolchain, bundleSha256 });
}

export async function compileLessonBundle(jsonText) {
  const bundle = await validateLessonBundle(jsonText);
  const filename = `${bundle.lessonId}@${bundle.revision}.ghost.md`;
  const extraction = extractLiterate(bundle.source.text, { filename });
  if (extraction.warnings.length > 0) {
    fail('literate-warnings', `lesson source contains rejected literate warnings: ${extraction.warnings.join('; ')}`);
  }
  let compilation;
  try {
    compilation = compileControl(extraction.code, { filename });
  } catch (error) {
    remapCompileError(error, extraction, filename);
  }
  return { bundle, extraction, compilation };
}
