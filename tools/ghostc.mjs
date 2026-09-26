#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { compileSource, writeArtifact } from './toolchain.mjs';
import { parseControlImports } from './control.mjs';
import { extractLiterate, mapSourcePosition, MAX_INPUT_BYTES } from './literate.mjs';
import { decode as decodeToon, encode as encodeToon } from '@toon-format/toon';

export { compileSource } from './toolchain.mjs';

const REQUEST_FORMAT = 'GhostFlow/cli-request-v1';
const RESULT_FORMAT = 'GhostFlow/cli-result-v1';

function requireRecord(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).find(key => !keys.includes(key));
  if (unknown) throw new Error(`${label} contains unsupported field ${unknown}`);
  return value;
}

function validateRequest(value) {
  requireRecord(value, 'request', ['format', 'operation', 'source', 'artifactPath']);
  if (value.format !== REQUEST_FORMAT) throw new Error(`request.format must be ${REQUEST_FORMAT}`);
  if (!['check', 'compile'].includes(value.operation)) throw new Error('request.operation must be check or compile');
  requireRecord(value.source, 'request.source', ['path', 'documentId', 'revisionId']);
  for (const key of ['path', 'documentId', 'revisionId']) {
    if (typeof value.source[key] !== 'string' || value.source[key].length === 0) throw new Error(`request.source.${key} must be a non-empty string`);
  }
  if (!value.source.path.endsWith('.ghost.md')) throw new Error('request.source.path must name a canonical .ghost.md document');
  if (value.operation === 'compile') {
    if (typeof value.artifactPath !== 'string' || value.artifactPath.length === 0) throw new Error('compile request requires artifactPath');
  } else if (Object.hasOwn(value, 'artifactPath')) throw new Error('check request does not accept artifactPath');
  return value;
}

function structuredResult(request, ok, diagnosticEnvelope, warnings = [], artifact = undefined, error = undefined) {
  const sourceEnvelope = diagnosticEnvelope?.requestSource ?? diagnosticEnvelope?.source;
  const diagnosticSource = diagnosticEnvelope?.source && sourceEnvelope !== diagnosticEnvelope.source
    && diagnosticEnvelope.source.filename !== sourceEnvelope.filename
    ? {
      path: diagnosticEnvelope.source.filename,
      sha256: diagnosticEnvelope.source.sha256,
      ...(diagnosticEnvelope.source.documentId ? { documentId: diagnosticEnvelope.source.documentId } : {}),
      ...(diagnosticEnvelope.source.revisionId ? { revisionId: diagnosticEnvelope.source.revisionId } : {}),
    } : undefined;
  return {
    format: RESULT_FORMAT,
    ok,
    source: sourceEnvelope ? {
      path: sourceEnvelope.filename,
      sha256: sourceEnvelope.sha256,
      ...(sourceEnvelope.documentId ? { documentId: sourceEnvelope.documentId } : {}),
      ...(sourceEnvelope.revisionId ? { revisionId: sourceEnvelope.revisionId } : {}),
    } : request?.source ? { path: request.source.path, documentId: request.source.documentId, revisionId: request.source.revisionId } : null,
    diagnostics: diagnosticEnvelope?.diagnostics ?? [],
    ...(diagnosticEnvelope ? { diagnosticsFormat: diagnosticEnvelope.format } : {}),
    ...(diagnosticEnvelope?.collection ? { collection: diagnosticEnvelope.collection } : {}),
    ...(diagnosticSource ? { diagnosticSource } : {}),
    warnings,
    ...(artifact ? { artifact } : {}),
    ...(error ? { error } : {}),
  };
}

function writeStructured(value, format) {
  process.stdout.write(format === 'json' ? `${JSON.stringify(value)}\n` : `${encodeToon(value)}\n`);
}

async function runRequestCli(args) {
  let requestPath, format = 'toon', formatSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--request' && !requestPath && args[index + 1]) { requestPath = args[++index]; continue; }
    if (args[index] === '--format' && args[index + 1] && ['toon', 'json'].includes(args[index + 1]) && !formatSeen) {
      format = args[++index]; formatSeen = true; continue;
    }
    throw new Error(`unsupported or incomplete argument ${args[index]}`);
  }
  if (!requestPath) throw new Error('--request requires a TOON request file');

  let request;
  try {
    request = validateRequest(decodeToon(fs.readFileSync(requestPath, 'utf8'), { strict: true }));
  } catch (error) {
    writeStructured(structuredResult(null, false, null, [], undefined, { code: 'GF_CLI', message: error.message }), format);
    process.exitCode = 2;
    return;
  }

  try {
    const bytes = fs.readFileSync(request.source.path);
    const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const sourceClosure = collectImportDocuments(source, path.resolve(request.source.path));
    const result = await compileSource(source, {
      filename: sourceClosure.length ? path.resolve(request.source.path) : request.source.path,
      interactionSourceIdentity: { documentId: request.source.documentId, revisionId: request.source.revisionId },
      ...(sourceClosure.length ? { sourceClosure } : {}),
    });
    if (request.operation === 'compile') writeArtifact(result, request.artifactPath);
    const artifactKind = result.manifest?.format ?? (result.manifest ? 'control-v1 + host manifest' : 'MVP GFB1');
    const artifact = request.operation === 'compile'
      ? { path: request.artifactPath, bytes: result.bytes.length, format: artifactKind }
      : undefined;
    writeStructured(structuredResult(request, true, result.diagnosticEnvelope, result.warnings ?? [], artifact), format);
  } catch (error) {
    const envelope = error.diagnosticEnvelope;
    if (!envelope) {
      writeStructured(structuredResult(request, false, null, [], undefined, { code: 'GF_SOURCE', message: error.message }), format);
      process.exitCode = 1;
      return;
    }
    writeStructured(structuredResult(request, false, envelope), format);
    process.exitCode = 1;
  }
}

// Filesystem acquisition is confined to the CLI; the compiler verifies this closure.
function collectImportDocuments(source, filename, documents = new Map()) {
  if (!filename.endsWith('.ghost.md')) return [];
  const extraction = extractLiterate(source, { filename });
  const located = (loc, message) => {
    const original = mapSourcePosition(extraction.sourceMap, loc.line, loc.column);
    return new Error(`${filename}:${original?.line ?? loc.line}:${original?.column ?? loc.column}: ${message}`);
  };
  let imports;
  try { imports = parseControlImports(extraction.code, { filename }); }
  catch (error) {
    if (!Number.isInteger(error.line)) throw error;
    const prefix = `${error.filename}:${error.line}:${error.column}: `;
    throw located(error, error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message);
  }
  for (const entry of imports) {
    const dependency = path.resolve(path.dirname(filename), entry.locator);
    let bytes;
    try { bytes = fs.readFileSync(dependency); }
    catch { throw located(entry.locatorLoc, `cannot read imported document ${entry.locator}`); }
    if (bytes.byteLength > MAX_INPUT_BYTES) throw located(entry.locatorLoc, `imported document ${entry.locator} byte limit exceeded`);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw located(entry.locatorLoc, `imported document ${entry.locator} must contain valid UTF-8 bytes`); }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== entry.sha256) throw located(entry.digestLoc,
      `import sha256 digest mismatch for ${entry.locator}: expected ${entry.sha256}, actual ${actual}`);
    if (!documents.has(dependency)) {
      if (documents.size >= 128) throw located(entry.locatorLoc, 'sourceClosure document limit exceeded');
      documents.set(dependency, { filename: dependency, revision: entry.revision, text });
      collectImportDocuments(text, dependency, documents);
    } else if (documents.get(dependency).revision !== entry.revision) throw located(entry.loc, `import revision mismatch for ${entry.locator}`);
  }
  return [...documents.values()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg === '--request' || arg === '--format')) {
    try { await runRequestCli(args); }
    catch (error) {
      const format = args.includes('json') ? 'json' : 'toon';
      writeStructured(structuredResult(null, false, null, [], undefined, { code: 'GF_CLI', message: error.message }), format);
      process.exitCode = 2;
    }
  } else {
  const checkFlags = args.filter(arg => arg === '--check');
  const check = checkFlags.length === 1;
  const names = args.filter(arg => arg !== '--check');
  if (!names[0] || (!check && !names[1]) || (check && names.length !== 1) || checkFlags.length > 1 || names.length > 2 || names.some(arg => arg.startsWith('--'))) {
    console.error('usage: ghostc <input.ghost.md> <output.gfb>\n       ghostc --check <input.ghost.md>');
    process.exitCode = 2;
  } else {
    try {
      let source;
      const bytes = fs.readFileSync(names[0]);
      try {
        source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch (error) {
        throw new Error(`${names[0]}: source must contain valid UTF-8 bytes`, { cause: error });
      }
      const sourceClosure = collectImportDocuments(source, path.resolve(names[0]));
      const result = await compileSource(source, { filename: sourceClosure.length ? path.resolve(names[0]) : names[0], ...(sourceClosure.length ? { sourceClosure } : {}) });
      if (!check) writeArtifact(result, names[1]);
      const artifactKind = result.manifest?.format === 'GhostFlow/resource-policy-v1'
        ? 'checked resource policy artifact (not executable control)'
        : result.manifest?.format === 'GhostFlow/accounting-v1'
          ? 'checked accounting artifact (not executable control)'
        : result.manifest?.format === 'GhostFlow/schedule-descriptor-v1'
          ? 'checked schedule descriptor artifact (not executable control)'
        : result.manifest?.format === 'GhostFlow/temporal-descriptor-v1'
          ? 'checked temporal descriptor artifact (not executable control)'
        : result.manifest ? 'control-v1 + host manifest' : 'MVP GFB1';
      console.log(`${names[0]}: ${result.bytes.length} bytes; ${artifactKind}${check ? ' (checked)' : ` -> ${names[1]}`}`);
      for (const warning of result.warnings ?? []) console.warn(`warning: ${typeof warning === 'string' ? warning : warning.message}`);
    } catch (error) {
      console.error(`ghostc: ${error.message}`);
      process.exitCode = 1;
    }
  }
  }
}
