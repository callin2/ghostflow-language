import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compile, parse, tokenize } from './gfb1.mjs';

function remapSourceNodes(nodes, lines, mapPosition) {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map(node => {
    if (!node || typeof node !== 'object') return node;
    const original = mapPosition(lines, node.line, node.column);
    if (!original) return node;
    const extracted = {
      filename: node.filename, line: node.line, column: node.column,
      endLine: node.endLine, endColumn: node.endColumn,
    };
    const end = mapPosition(lines, node.endLine ?? node.line, node.endColumn ?? node.column);
    // Preserve the compiler-assigned ID exactly: host trace IDs are stable
    // across Markdown-only edits, while this records both coordinate systems.
    return {
      ...node,
      filename: original.file, line: original.line, column: original.column,
      ...(end ? { endLine: end.line, endColumn: end.column } : {}),
      extracted,
    };
  });
}

export async function compileSource(source, { filename = 'program.ghost' } = {}) {
  if (Buffer.byteLength(source) > 1024 * 1024) throw new Error(`${filename}: source byte limit exceeded`);
  let code = source, extraction = null;
  if (filename.endsWith('.ghost.md')) {
    const { extractLiterate } = await import('./literate.mjs');
    extraction = extractLiterate(source, { filename });
    code = extraction.code;
  } else if (filename.endsWith('.md')) {
    throw new Error(`${filename}: literate sources must use .ghost.md`);
  }
  const legacy = code.trimStart().startsWith('(') || code.trimStart().startsWith(';');
  let result;
  try {
    result = legacy ? { bytes: compile(parse(tokenize(code))), manifest: null, sourceMap: [] }
      : (await import('./control.mjs')).compileControl(code, { filename });
  } catch (error) {
    if (extraction && Number.isInteger(error.line)) {
      const { mapSourcePosition } = await import('./literate.mjs');
      const original = mapSourcePosition(extraction.sourceMap, error.line, error.column ?? 1);
      if (original) {
        const detail = error.message.replace(/^.*?:\d+:\d+:\s*/, '');
        error.message = `${filename}:${original.line}:${original.column}: ${detail}`;
        error.filename = original.file; error.line = original.line; error.column = original.column;
      }
    }
    throw error;
  }
  if (extraction) {
    const { mapSourcePosition } = await import('./literate.mjs');
    result = { ...result, sourceMap: remapSourceNodes(result.sourceMap, extraction.sourceMap, mapSourcePosition) };
  }
  const bytes = Buffer.from(result.bytes);
  if (bytes.length > 1024 * 1024) throw new Error('compiled module byte limit exceeded');
  const digest = createHash('sha256').update(bytes).digest('hex');
  return { ...result, bytes, manifest: result.manifest ? { ...result.manifest, bytecodeSha256: digest } : null,
    extractionMap: extraction?.sourceMap ?? null, warnings: extraction?.warnings ?? [] };
}

export function writeArtifact(result, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, result.bytes);
  if (result.manifest) {
    fs.writeFileSync(`${outputPath}.manifest.json`, JSON.stringify(result.manifest, null, 2) + '\n');
    fs.writeFileSync(`${outputPath}.map.json`, JSON.stringify({ nodes: result.sourceMap, lines: result.extractionMap }, null, 2) + '\n');
  }
}
