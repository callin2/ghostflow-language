import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compileSource } from './toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

export const CURRICULUM_REPLAY_MANIFEST = 'examples/curriculum/replay-scenarios.json';
export const CURRICULUM_REPLAY_IDS = Object.freeze(['PC-01', 'PC-02', 'PC-03', 'PC-05', 'PC-08', 'PC-09']);

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const SHA256 = /^[0-9a-f]{64}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly ${wanted.join(', ')}`);
  }
}

function string(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function regularFile(repositoryRoot, relative, label) {
  string(relative, label);
  const normalized = path.posix.normalize(relative);
  if (normalized !== relative || (!relative.startsWith('docs/') && !relative.startsWith('examples/'))) {
    throw new Error(`${label} is outside the curriculum source contract`);
  }
  const absolute = path.resolve(repositoryRoot, relative);
  const resolvedRoot = path.resolve(repositoryRoot);
  if (!absolute.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`${label} escapes repository root`);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`);
  const text = fs.readFileSync(absolute, 'utf8');
  return { absolute, text, sha256: sha256(text) };
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`);
  const result = value.map((item, index) => string(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates`);
  return result;
}

function sameList(actual, expected, label) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} does not match the compiled control manifest`);
  }
}

function boolRecord(value, names, label) {
  object(value, label);
  exactKeys(value, names, label);
  for (const name of names) if (typeof value[name] !== 'boolean') throw new Error(`${label}.${name} must be Bool`);
  return value;
}

function outputSnapshot(trace, outputNames) {
  return Object.fromEntries(outputNames.map(name => [name, trace[name]]));
}

function equalBoolRecord(actual, expected, label) {
  for (const [name, value] of Object.entries(expected)) {
    if (actual[name] !== value) throw new Error(`${label}.${name} expected ${value}, got ${String(actual[name])}`);
  }
}

function sourceContract(scenario, lesson, repositoryRoot) {
  const source = object(scenario.source, `${scenario.id}.source`);
  exactKeys(source, ['canonicalPath', 'canonicalSha256', 'executablePath', 'executableSha256'], `${scenario.id}.source`);
  const lessonSource = object(lesson.source, `${scenario.id} catalog source`);
  const expected = scenario.id === 'PC-01'
    ? {
        canonicalPath: lessonSource.path,
        canonicalSha256: lessonSource.documentSha256,
        executablePath: lessonSource.generatedPath,
        executableSha256: lessonSource.projectionSha256,
      }
    : {
        canonicalPath: lessonSource.path,
        canonicalSha256: lessonSource.sha256,
        executablePath: lessonSource.path,
        executableSha256: lessonSource.sha256,
      };
  for (const key of Object.keys(expected)) {
    const value = key.endsWith('Sha256') ? digest(source[key], `${scenario.id}.source.${key}`) : string(source[key], `${scenario.id}.source.${key}`);
    if (value !== expected[key]) throw new Error(`${scenario.id}.source.${key} does not match curriculum catalog`);
  }
  const canonical = regularFile(repositoryRoot, source.canonicalPath, `${scenario.id} canonical source`);
  if (canonical.sha256 !== source.canonicalSha256) throw new Error(`${scenario.id} canonical source SHA-256 mismatch`);
  const executable = regularFile(repositoryRoot, source.executablePath, `${scenario.id} executable source`);
  if (executable.sha256 !== source.executableSha256) throw new Error(`${scenario.id} executable source SHA-256 mismatch`);
  return { source, canonical, executable };
}

export function readCurriculumReplayManifest({ repositoryRoot = defaultRoot } = {}) {
  return JSON.parse(regularFile(repositoryRoot, CURRICULUM_REPLAY_MANIFEST, 'curriculum replay manifest').text);
}

export async function prepareCurriculumReplays({ repositoryRoot = defaultRoot, manifest, catalog } = {}) {
  const replay = manifest ?? readCurriculumReplayManifest({ repositoryRoot });
  const curriculum = catalog ?? JSON.parse(regularFile(repositoryRoot, 'examples/curriculum/catalog.json', 'curriculum catalog').text);
  object(replay, 'curriculum replay manifest');
  exactKeys(replay, ['format', 'scenarios'], 'curriculum replay manifest');
  if (replay.format !== 'GhostFlow/plc-curriculum-replay-v1') throw new Error('unsupported curriculum replay manifest format');
  if (!Array.isArray(replay.scenarios) || replay.scenarios.length !== CURRICULUM_REPLAY_IDS.length) {
    throw new Error('curriculum replay manifest must contain exactly six scenarios');
  }
  const lessons = new Map(curriculum.lessons.map(lesson => [lesson.id, lesson]));
  const prepared = [];

  for (const [scenarioIndex, scenarioValue] of replay.scenarios.entries()) {
    const scenario = object(scenarioValue, `scenarios[${scenarioIndex}]`);
    exactKeys(scenario, ['id', 'source', 'inputs', 'outputs', 'frames', 'checkpoints'], `scenarios[${scenarioIndex}]`);
    const expectedId = CURRICULUM_REPLAY_IDS[scenarioIndex];
    if (scenario.id !== expectedId) throw new Error(`curriculum replay scenario ${scenarioIndex} must be ${expectedId}`);
    const lesson = lessons.get(scenario.id);
    if (!lesson) throw new Error(`${scenario.id} is missing from curriculum catalog`);
    const sources = sourceContract(scenario, lesson, repositoryRoot);
    const artifact = await compileSource(sources.executable.text, { filename: sources.source.executablePath });
    if (!artifact.manifest) throw new Error(`${scenario.id} executable source did not compile as a control`);

    const inputNames = stringList(scenario.inputs, `${scenario.id}.inputs`);
    const outputNames = stringList(scenario.outputs, `${scenario.id}.outputs`);
    const compiledInputs = artifact.manifest.inputs.map(input => {
      if (input.type !== 'Bool') throw new Error(`${scenario.id} input ${input.name} must compile as Bool`);
      return input.name;
    });
    const compiledOutputs = artifact.manifest.outputs.map(output => {
      if (output.type !== 'Bool') throw new Error(`${scenario.id} output ${output.name} must compile as Bool`);
      return output.name;
    });
    sameList(inputNames, compiledInputs, `${scenario.id}.inputs`);
    sameList(outputNames, compiledOutputs, `${scenario.id}.outputs`);

    if (!Array.isArray(scenario.frames) || scenario.frames.length === 0) throw new Error(`${scenario.id}.frames must be non-empty`);
    let previousTime = -1;
    for (const [frameIndex, frameValue] of scenario.frames.entries()) {
      const frame = object(frameValue, `${scenario.id}.frames[${frameIndex}]`);
      exactKeys(frame, ['atMs', 'inputs'], `${scenario.id}.frames[${frameIndex}]`);
      if (!Number.isSafeInteger(frame.atMs) || frame.atMs < 0) throw new Error(`${scenario.id}.frames[${frameIndex}].atMs must be a non-negative safe integer`);
      if (frame.atMs <= previousTime) throw new Error(`${scenario.id}.frames must use strictly increasing virtual time`);
      previousTime = frame.atMs;
      boolRecord(frame.inputs, inputNames, `${scenario.id}.frames[${frameIndex}].inputs`);
    }

    if (!Array.isArray(scenario.checkpoints) || scenario.checkpoints.length === 0) throw new Error(`${scenario.id}.checkpoints must be non-empty`);
    let previousFrame = -1;
    const checkpoints = new Map();
    for (const [checkpointIndex, checkpointValue] of scenario.checkpoints.entries()) {
      const checkpoint = object(checkpointValue, `${scenario.id}.checkpoints[${checkpointIndex}]`);
      exactKeys(checkpoint, ['frame', 'requested', 'safe'], `${scenario.id}.checkpoints[${checkpointIndex}]`);
      if (!Number.isSafeInteger(checkpoint.frame) || checkpoint.frame < 0 || checkpoint.frame >= scenario.frames.length) {
        throw new Error(`${scenario.id}.checkpoints[${checkpointIndex}].frame is outside frames`);
      }
      if (checkpoint.frame <= previousFrame) throw new Error(`${scenario.id}.checkpoints must use strictly increasing frame indexes`);
      previousFrame = checkpoint.frame;
      boolRecord(checkpoint.requested, outputNames, `${scenario.id}.checkpoints[${checkpointIndex}].requested`);
      boolRecord(checkpoint.safe, outputNames, `${scenario.id}.checkpoints[${checkpointIndex}].safe`);
      checkpoints.set(checkpoint.frame, checkpoint);
    }
    prepared.push({ scenario, artifact, inputNames, outputNames, checkpoints });
  }
  return { format: replay.format, scenarios: prepared };
}

async function execute(runtimeFactory, wasmBytes, prepared, runtimeName) {
  let frames = 0;
  let checkpoints = 0;
  for (const entry of prepared.scenarios) {
    const runtime = await runtimeFactory(wasmBytes, entry.artifact);
    try {
      for (const [frameIndex, frame] of entry.scenario.frames.entries()) {
        const result = runtime.step({ nowMs: frame.atMs, inputs: frame.inputs });
        frames += 1;
        const checkpoint = entry.checkpoints.get(frameIndex);
        if (!checkpoint) continue;
        checkpoints += 1;
        equalBoolRecord(outputSnapshot(result.vm.requested, entry.outputNames), checkpoint.requested,
          `${entry.scenario.id} ${runtimeName} checkpoint ${frameIndex} requested`);
        equalBoolRecord(outputSnapshot(result.vm.safe, entry.outputNames), checkpoint.safe,
          `${entry.scenario.id} ${runtimeName} checkpoint ${frameIndex} safe`);
      }
    } finally {
      runtime.dispose();
    }
  }
  return { runtime: runtimeName, scenarios: prepared.scenarios.length, frames, checkpoints };
}

export async function verifyCurriculumReplayWasm(wasmBytes, options = {}) {
  const prepared = options.prepared ?? await prepareCurriculumReplays(options);
  const legacy = await execute(ControlRuntime.instantiate.bind(ControlRuntime), wasmBytes, prepared, 'host-simulation');
  const framed = await execute(ControlRuntime.instantiateFramed.bind(ControlRuntime), wasmBytes, prepared, 'framed-wasm');
  return { legacy, framed };
}
