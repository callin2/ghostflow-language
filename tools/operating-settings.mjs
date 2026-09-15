import { createHash } from 'node:crypto';
import { compileSource } from './toolchain.mjs';
import { extractLiterate } from './literate.mjs';

const TYPES = new Set(['Number', 'Duration', 'Percent', 'Bool']);
const sha256 = source => createHash('sha256').update(source).digest('hex');

function freezeObject(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeObject(child);
  return Object.freeze(value);
}

function lineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function literateOffsetMapper(source, extraction) {
  const sourceLineStarts = lineStarts(source);
  const codeLines = extraction.code.split('\n');
  const codeLineStarts = [];
  let codeOffset = 0;
  for (const line of codeLines) {
    codeLineStarts.push(codeOffset);
    codeOffset += line.length + 1;
  }

  return (start, end) => {
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
    const lineIndex = codeLineStarts.findIndex((lineStart, index) => {
      const lineEnd = lineStart + codeLines[index].length;
      return start >= lineStart && end <= lineEnd;
    });
    if (lineIndex < 0) return null;
    const mapping = extraction.sourceMap[lineIndex];
    if (!mapping || mapping.line < 1 || mapping.line > sourceLineStarts.length) return null;
    const originalStart = sourceLineStarts[mapping.line - 1] + mapping.column - 1 + start - codeLineStarts[lineIndex];
    const originalEnd = originalStart + (end - start);
    // This also protects against CRLF and malformed maps silently changing a
    // character outside the executable line.
    if (source.slice(originalStart, originalEnd) !== extraction.code.slice(start, end)) return null;
    return { start: originalStart, end: originalEnd };
  };
}

function applyOnlyDeclaredLiteralEdits(source, replacements) {
  const ascending = [...replacements].sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  let candidate = '';
  for (const replacement of ascending) {
    if (replacement.start < previousEnd) throw new Error('overlapping config literal spans');
    candidate += source.slice(previousEnd, replacement.start);
    candidate += replacement.literal;
    previousEnd = replacement.end;
  }
  candidate += source.slice(previousEnd);

  // The candidate is assembled from source gaps and declared literal spans
  // only. Recheck those gaps to keep this boundary explicit if this routine is
  // changed later.
  let sourceAt = 0;
  let candidateAt = 0;
  for (const replacement of ascending) {
    const unchangedLength = replacement.start - sourceAt;
    if (candidate.slice(candidateAt, candidateAt + unchangedLength) !== source.slice(sourceAt, replacement.start)) throw new Error('candidate changed source outside config literals');
    sourceAt = replacement.end;
    candidateAt += unchangedLength + replacement.literal.length;
  }
  if (candidate.slice(candidateAt) !== source.slice(sourceAt)) throw new Error('candidate changed source outside config literals');
  return candidate;
}

export async function createOperatingSettingsCandidate({ source, filename = 'program.ghost.md', expectedSourceSha256, changes }) {
  if (typeof source !== 'string' || sha256(source) !== expectedSourceSha256) throw new Error('stale source hash');
  if (!filename.endsWith('.ghost.md')) throw new Error('operating settings require a canonical .ghost.md literate source');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('changes must be an object');
  // Snapshot primitive requests before compilation yields to caller code.
  const requestedEntries = Object.entries(changes);
  const before = await compileSource(source, { filename });
  const configs = new Map((before.manifest?.configs ?? []).map(config => [config.name, config]));
  const mapOffset = literateOffsetMapper(source, extractLiterate(source, { filename }));
  const replacements = [];
  for (const [name, requested] of requestedEntries) {
    const config = configs.get(name);
    if (!config || !config.settings) throw new Error(`unknown or non-operator config ${name}`);
    if (config.settings.access !== 'operator') throw new Error(`config ${name} is not operator-editable`);
    const type = config.type;
    if (!TYPES.has(type) || typeof requested !== (type === 'Bool' ? 'boolean' : 'number')) throw new Error(`invalid type for ${name}`);
    if (type !== 'Bool') {
      const { min, max, step } = config.settings;
      if (!Number.isFinite(requested) || requested < Number(min) || requested > Number(max) || Math.abs((requested - Number(min)) / Number(step) - Math.round((requested - Number(min)) / Number(step))) > 1e-9) throw new Error(`value outside range or step for ${name}`);
    }
    const extractedStart = config.initialOffset;
    const extractedEnd = config.initialEndOffset;
    if (!Number.isInteger(extractedStart) || !Number.isInteger(extractedEnd) || extractedEnd <= extractedStart) throw new Error(`missing literal span for ${name}`);
    const span = mapOffset(extractedStart, extractedEnd);
    if (!span) throw new Error(`missing literal span for ${name}`);
    const literal = type === 'Bool' ? String(requested) : type === 'Percent' ? `${requested}%` : type === 'Duration' ? `${requested}ms` : String(requested);
    replacements.push({ ...span, literal });
  }
  const candidate = applyOnlyDeclaredLiteralEdits(source, replacements);
  const after = await compileSource(candidate, { filename });
  return Object.freeze({ source: candidate, manifest: freezeObject(after.manifest), sourceSha256: sha256(candidate), beforeSourceSha256: expectedSourceSha256 });
}
