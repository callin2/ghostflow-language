#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { compileSource, writeArtifact } from './toolchain.mjs';
import { parseControlImports } from './control.mjs';
import { extractLiterate, mapSourcePosition, MAX_INPUT_BYTES } from './literate.mjs';

export { compileSource } from './toolchain.mjs';

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
