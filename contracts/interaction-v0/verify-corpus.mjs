#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInteraction } from './validate.mjs';
import { canonicalJson } from '../../tools/canonical-json.mjs';
import { compileSource } from '../../tools/toolchain.mjs';

export const INTERACTION_CORPUS_FORMAT = 'GhostFlow/interaction-test-corpus-v1';
export const SCAN_TAPE_FORMAT = 'GhostFlow/interaction-scan-tape-v1';
export const SCAN_TAPE_DIGEST_STRATEGY = 'canonical-json-excluding-digest-v1';

const SOURCE_FORMAT = 'GhostFlow/source-document-v1';
const CORPUS_VERSION = '1.0';
const TAPE_VERSION = '1.0';
const SHA256 = /^[a-f0-9]{64}$/;
const MODULE_FINGERPRINT = /^[a-f0-9]{16}$/;
const PUBLIC_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const CORPUS_PATH = 'contracts/interaction-v0/examples/corpus.json';
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fail(message) {
  throw new Error(`interaction corpus: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, fields, label) {
  if (!isObject(value)) fail(`${label} must be an object`);
  const allowed = new Set(fields);
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  const missing = fields.filter(key => !Object.hasOwn(value, key));
  if (unknown.length || missing.length) {
    fail(`${label} fields invalid (unknown: ${unknown.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})`);
  }
}

function publicId(value, label) {
  if (typeof value !== 'string' || !PUBLIC_ID.test(value) || value.startsWith('__gf_')) {
    fail(`${label} must be a public stable identifier`);
  }
}

function digest(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${label} must be a lowercase SHA-256 digest`);
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')
      || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
      || path.posix.normalize(value) !== value || value === '.'
      || value.split('/').some(part => part === '..' || part === '')) {
    fail(`${label} must be a normalized repository-relative path`);
  }
  return value;
}

function identity(value, label) {
  exactObject(value, ['documentId', 'revisionId', 'format', 'kind', 'sha256'], label);
  publicId(value.documentId, `${label}.documentId`);
  publicId(value.revisionId, `${label}.revisionId`);
  if (value.format !== SOURCE_FORMAT) fail(`${label}.format must be ${SOURCE_FORMAT}`);
  if (value.kind !== 'literate') fail(`${label}.kind must be literate`);
  digest(value.sha256, `${label}.sha256`);
}

function moduleIdentity(value, label) {
  exactObject(value, ['id', 'moduleFingerprint', 'bytecodeSha256'], label);
  publicId(value.id, `${label}.id`);
  if (typeof value.moduleFingerprint !== 'string' || !MODULE_FINGERPRINT.test(value.moduleFingerprint)) {
    fail(`${label}.moduleFingerprint must be lowercase 16-hex`);
  }
  digest(value.bytecodeSha256, `${label}.bytecodeSha256`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function utf8(bytes, label) {
  try {
    if (typeof bytes === 'string') return bytes;
    if (!(bytes instanceof Uint8Array)) fail(`${label} reader must return text or bytes`);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if (error.message.startsWith('interaction corpus:')) throw error;
    fail(`${label} must be valid UTF-8`);
  }
}

function readJson(readText, relative, label) {
  let value;
  try {
    value = JSON.parse(utf8(readText(relative, label), label));
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${label} must contain strict JSON (${error.message})`);
    throw error;
  }
  return value;
}

function verifyCorpusShape(corpus) {
  exactObject(corpus, ['format', 'version', 'cases'], 'corpus');
  if (corpus.format !== INTERACTION_CORPUS_FORMAT) fail(`corpus.format must be ${INTERACTION_CORPUS_FORMAT}`);
  if (corpus.version !== CORPUS_VERSION) fail(`corpus.version must be ${CORPUS_VERSION}`);
  if (!Array.isArray(corpus.cases) || corpus.cases.length < 2) fail('corpus.cases must contain at least two fixtures');
  const caseIds = new Set();
  const sourcePaths = new Set();
  const tapePaths = new Set();
  const tapeIds = new Set();
  for (const [index, fixture] of corpus.cases.entries()) {
    const label = `corpus.cases[${index}]`;
    exactObject(fixture, ['caseId', 'sourcePath', 'source', 'module', 'tapePath', 'projections'], label);
    publicId(fixture.caseId, `${label}.caseId`);
    if (caseIds.has(fixture.caseId)) fail(`${label}.caseId is duplicated`);
    caseIds.add(fixture.caseId);
    safeRelativePath(fixture.sourcePath, `${label}.sourcePath`);
    if (!fixture.sourcePath.endsWith('.ghost.md')) fail(`${label}.sourcePath must name a canonical literate .ghost.md document`);
    if (sourcePaths.has(fixture.sourcePath)) fail(`${label}.sourcePath is duplicated`);
    sourcePaths.add(fixture.sourcePath);
    identity(fixture.source, `${label}.source`);
    moduleIdentity(fixture.module, `${label}.module`);
    safeRelativePath(fixture.tapePath, `${label}.tapePath`);
    if (!fixture.tapePath.endsWith('.scan-tape.json')) fail(`${label}.tapePath must name a scan-tape JSON document`);
    if (tapePaths.has(fixture.tapePath)) fail(`${label}.tapePath is duplicated`);
    tapePaths.add(fixture.tapePath);
    exactObject(fixture.projections, ['schemaPath', 'snapshotPath'], `${label}.projections`);
    const { schemaPath, snapshotPath } = fixture.projections;
    if ((schemaPath === null) !== (snapshotPath === null)) fail(`${label}.projections must provide both schemaPath and snapshotPath or neither`);
    for (const [field, value] of [['schemaPath', schemaPath], ['snapshotPath', snapshotPath]]) {
      if (value !== null) safeRelativePath(value, `${label}.projections.${field}`);
    }
  }
  return { caseIds, tapeIds };
}

function expectedInputTypes(manifest, label) {
  if (!Array.isArray(manifest?.inputs)) fail(`${label} compiled manifest must provide inputs`);
  const types = new Map();
  for (const input of manifest.inputs) {
    if (!isObject(input) || typeof input.name !== 'string' || typeof input.type !== 'string') {
      fail(`${label} compiled input descriptors must contain names and types`);
    }
    if (types.has(input.name)) fail(`${label} compiled input names must be unique`);
    types.set(input.name, input.type);
  }
  return types;
}

function validateInputValue(value, type, label) {
  if (type === 'Bool') {
    if (typeof value !== 'boolean') fail(`${label} must be Bool`);
    return;
  }
  if (type === 'Duration') {
    if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer Duration`);
    return;
  }
  if (['Number', 'Percent'].includes(type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite ${type}`);
    return;
  }
  fail(`${label} uses unsupported compiled input type ${type}`);
}

function tapeDigest(tape) {
  const unsigned = structuredClone(tape);
  delete unsigned.digest;
  return sha256(canonicalJson(unsigned, { rejectSparseArrays: true, rejectUnsafeIntegers: true }));
}

function validateTape(tape, fixture, inputTypes) {
  const label = `tape ${fixture.caseId}`;
  exactObject(tape, ['format', 'version', 'caseId', 'source', 'tapeId', 'digest', 'runs', 'observationExpectations'], label);
  if (tape.format !== SCAN_TAPE_FORMAT) fail(`${label}.format must be ${SCAN_TAPE_FORMAT}`);
  if (tape.version !== TAPE_VERSION) fail(`${label}.version must be ${TAPE_VERSION}`);
  if (tape.caseId !== fixture.caseId) fail(`${label}.caseId does not match its corpus entry`);
  identity(tape.source, `${label}.source`);
  for (const key of ['documentId', 'revisionId', 'format', 'kind', 'sha256']) {
    if (tape.source[key] !== fixture.source[key]) fail(`${label}.source.${key} does not match the canonical source revision`);
  }
  publicId(tape.tapeId, `${label}.tapeId`);
  if (!Array.isArray(tape.runs) || tape.runs.length < 2) fail(`${label}.runs must contain at least two run epochs`);
  if (!Array.isArray(tape.observationExpectations)) fail(`${label}.observationExpectations must be an array`);
  exactObject(tape.digest, ['algorithm', 'strategy', 'sha256'], `${label}.digest`);
  if (tape.digest.algorithm !== 'SHA-256') fail(`${label}.digest.algorithm must be SHA-256`);
  if (tape.digest.strategy !== SCAN_TAPE_DIGEST_STRATEGY) fail(`${label}.digest.strategy must be ${SCAN_TAPE_DIGEST_STRATEGY}`);
  digest(tape.digest.sha256, `${label}.digest.sha256`);
  if (tape.digest.sha256 !== tapeDigest(tape)) fail(`${label}.digest.sha256 does not match canonical tape content`);

  const runIds = new Set();
  let reusedScanZero = false;
  for (const [runIndex, run] of tape.runs.entries()) {
    const runLabel = `${label}.runs[${runIndex}]`;
    exactObject(run, ['runId', 'scans'], runLabel);
    publicId(run.runId, `${runLabel}.runId`);
    if (runIds.has(run.runId)) fail(`${runLabel}.runId is duplicated`);
    runIds.add(run.runId);
    if (!Array.isArray(run.scans) || run.scans.length === 0) fail(`${runLabel}.scans must be non-empty`);
    const scanIds = new Set();
    let previousTime = null;
    for (const [scanIndex, scan] of run.scans.entries()) {
      const scanLabel = `${runLabel}.scans[${scanIndex}]`;
      exactObject(scan, ['completion', 'inputs'], scanLabel);
      exactObject(scan.completion, ['kind', 'scanId', 'logicalTimeMs'], `${scanLabel}.completion`);
      if (scan.completion.kind !== 'completed-scan') fail(`${scanLabel}.completion.kind must be completed-scan`);
      const { scanId, logicalTimeMs } = scan.completion;
      if (!Number.isSafeInteger(scanId) || scanId < 0) fail(`${scanLabel}.completion.scanId must be a non-negative safe integer`);
      if (!Number.isSafeInteger(logicalTimeMs) || logicalTimeMs < 0) fail(`${scanLabel}.completion.logicalTimeMs must be a non-negative safe integer`);
      if (scanIds.has(scanId)) fail(`${runLabel} has duplicate scanId ${scanId}`);
      if (scanId !== scanIndex) fail(`${runLabel} scanIds must be contiguous starting at zero (expected ${scanIndex}, got ${scanId})`);
      if (previousTime !== null && logicalTimeMs < previousTime) fail(`${runLabel} logical time reversal at scanId ${scanId}`);
      scanIds.add(scanId);
      previousTime = logicalTimeMs;

      if (!Array.isArray(scan.inputs)) fail(`${scanLabel}.inputs must be an array of named values`);
      const actualNames = [];
      const seenInputs = new Set();
      for (const [inputIndex, input] of scan.inputs.entries()) {
        const inputLabel = `${scanLabel}.inputs[${inputIndex}]`;
        exactObject(input, ['name', 'value'], inputLabel);
        publicId(input.name, `${inputLabel}.name`);
        if (seenInputs.has(input.name)) fail(`${inputLabel}.name is duplicated`);
        if (!inputTypes.has(input.name)) fail(`${inputLabel}.name is not a declared input`);
        seenInputs.add(input.name);
        actualNames.push(input.name);
        validateInputValue(input.value, inputTypes.get(input.name), `${inputLabel}.value`);
      }
      const expectedNames = [...inputTypes.keys()];
      if (actualNames.length !== expectedNames.length || expectedNames.some(name => !seenInputs.has(name))) {
        fail(`${scanLabel}.inputs must provide every declared input exactly once`);
      }
      if (actualNames.some((name, index) => name !== expectedNames[index])) {
        fail(`${scanLabel}.inputs must follow compiled manifest input order`);
      }
    }
    if (runIndex > 0 && run.scans[0].completion.scanId === 0) reusedScanZero = true;
  }
  if (!reusedScanZero) fail(`${label} must show scanId 0 reused by a fresh, different runId`);

  const expectationIds = new Set();
  for (const [index, expectation] of tape.observationExpectations.entries()) {
    const expectationLabel = `${label}.observationExpectations[${index}]`;
    exactObject(expectation, ['expectationId', 'descriptorId', 'status', 'reason'], expectationLabel);
    publicId(expectation.expectationId, `${expectationLabel}.expectationId`);
    publicId(expectation.descriptorId, `${expectationLabel}.descriptorId`);
    if (expectationIds.has(expectation.expectationId)) fail(`${expectationLabel}.expectationId is duplicated`);
    expectationIds.add(expectation.expectationId);
    if (expectation.status !== 'unavailable') fail(`${expectationLabel}.status must be unavailable`);
    if (typeof expectation.reason !== 'string' || !expectation.reason.trim()) fail(`${expectationLabel}.reason must explain the validator-only expectation`);
  }
  return tape.digest.sha256;
}

function verifyProjection(fixture, readJson) {
  const { schemaPath, snapshotPath } = fixture.projections;
  if (schemaPath === null) return null;
  const schema = readJson(schemaPath, `${fixture.caseId} schema projection`);
  const snapshot = readJson(snapshotPath, `${fixture.caseId} snapshot projection`);
  const result = validateInteraction(schema, snapshot);
  if (!result.valid) fail(`${fixture.caseId} schema/snapshot projection is invalid: ${JSON.stringify(result.errors)}`);
  for (const [key, value] of Object.entries(fixture.module)) {
    if (schema.module[key] !== value) fail(`${fixture.caseId} schema projection module.${key} does not match compiled source`);
  }
  for (const [key, value] of Object.entries(fixture.source)) {
    if (schema.source[key] !== value) fail(`${fixture.caseId} schema projection source.${key} does not match canonical source`);
  }
  const descriptorIds = new Set(schema.descriptors.map(item => item.id));
  return descriptorIds;
}

/** Compile canonical literate sources and strictly verify their shared scan-test stimulus. */
export async function verifyInteractionCorpus({ root = REPOSITORY_ROOT, corpus, readFile } = {}) {
  const repositoryRoot = path.resolve(root);
  const readBytes = readFile ?? (relative => fs.readFileSync(path.resolve(repositoryRoot, safeRelativePath(relative, 'file path'))));
  const checkedPath = relative => {
    const safe = safeRelativePath(relative, 'file path');
    const absolute = path.resolve(repositoryRoot, safe);
    if (absolute !== repositoryRoot && !absolute.startsWith(`${repositoryRoot}${path.sep}`)) fail(`path escapes repository root: ${relative}`);
    return safe;
  };
  const text = (relative, label) => utf8(readBytes(checkedPath(relative)), label);
  const json = (relative, label) => readJson(text, relative, label);
  const activeCorpus = corpus ?? json(CORPUS_PATH, 'corpus manifest');
  const { tapeIds } = verifyCorpusShape(activeCorpus);
  const results = [];

  for (const fixture of activeCorpus.cases) {
    const sourcePath = checkedPath(fixture.sourcePath);
    const rawSource = readBytes(sourcePath);
    const sourceBytes = typeof rawSource === 'string' ? Buffer.from(rawSource, 'utf8') : Buffer.from(rawSource);
    const sourceText = utf8(sourceBytes, `${fixture.caseId} canonical source`);
    if (!sourcePath.endsWith('.ghost.md')) fail(`${fixture.caseId} canonical source must be literate`);
    const sourceSha256 = sha256(sourceBytes);
    if (sourceSha256 !== fixture.source.sha256) fail(`${fixture.caseId} source SHA-256 does not match corpus identity`);
    const compiled = await compileSource(sourceText, { filename: sourcePath });
    if (compiled.sourceDocument.kind !== 'literate' || compiled.sourceDocument.format !== SOURCE_FORMAT) {
      fail(`${fixture.caseId} compiled source is not a literate source document`);
    }
    if (compiled.sourceDocument.sha256 !== fixture.source.sha256) fail(`${fixture.caseId} compiler source SHA-256 differs from corpus identity`);
    const actualModule = {
      id: compiled.manifest?.name,
      moduleFingerprint: compiled.traceMetadata?.moduleFingerprint,
      bytecodeSha256: compiled.manifest?.bytecodeSha256,
    };
    for (const [key, value] of Object.entries(fixture.module)) {
      if (actualModule[key] !== value) fail(`${fixture.caseId} compiled module.${key} does not match corpus identity`);
    }
    if (compiled.traceMetadata?.bytecodeSha256 !== fixture.module.bytecodeSha256) {
      fail(`${fixture.caseId} trace bytecode SHA-256 does not match compiled module identity`);
    }

    const inputTypes = expectedInputTypes(compiled.manifest, fixture.caseId);
    const tapePath = checkedPath(fixture.tapePath);
    const tape = json(tapePath, `${fixture.caseId} scan tape`);
    if (tapeIds.has(tape.tapeId)) fail(`tapeId ${tape.tapeId} is duplicated`);
    tapeIds.add(tape.tapeId);
    const tapeSha256 = validateTape(tape, fixture, inputTypes);
    const descriptorIds = verifyProjection(fixture, json);
    if (descriptorIds) {
      for (const expectation of tape.observationExpectations) {
        if (!descriptorIds.has(expectation.descriptorId)) {
          fail(`${fixture.caseId} validator-only observation expectation references unknown descriptor ${expectation.descriptorId}`);
        }
      }
    }
    results.push({
      caseId: fixture.caseId,
      sourcePath,
      sourceSha256,
      moduleId: actualModule.id,
      moduleFingerprint: actualModule.moduleFingerprint,
      bytecodeSha256: actualModule.bytecodeSha256,
      tapeId: tape.tapeId,
      tapeSha256,
      runIds: tape.runs.map(run => run.runId),
      scanCount: tape.runs.reduce((sum, run) => sum + run.scans.length, 0),
      canonicalSourceKind: compiled.sourceDocument.kind,
    });
  }
  return { format: 'GhostFlow/verified-interaction-corpus-v1', version: '1.0', cases: results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    process.stderr.write('usage: node contracts/interaction-v0/verify-corpus.mjs\n');
    process.exitCode = 2;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(await verifyInteractionCorpus(), null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
