import { Parser } from 'commonmark';

export const MAX_INPUT_BYTES = 1024 * 1024;
export const MAX_INPUT_LINES = 100_000;

export class LiterateError extends Error {
  constructor(filename, line, column, message) {
    super(`${filename}:${line}:${column}: ${message}`);
    this.name = 'LiterateError'; this.filename = filename;
    this.line = line; this.column = column;
  }
}

/** CommonMark determines containers; raw source supplies unmodified code and locations. */
export function extractLiterate(markdown, { filename = '<literate>' } = {}) {
  if (typeof markdown !== 'string') throw new TypeError('markdown must be a string');
  if (new TextEncoder().encode(markdown).byteLength > MAX_INPUT_BYTES) throw new RangeError('literate byte limit exceeded');
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > MAX_INPUT_LINES) throw new RangeError('literate line limit exceeded');
  let frontMatterEnd = -1;
  if (lines[0] === '---') {
    frontMatterEnd = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
    if (frontMatterEnd < 0) throw new LiterateError(filename, 1, 1, 'unclosed front matter');
  }
  // Preserve every line number while preventing front matter from becoming Markdown code.
  const parsedSource = lines.map((line, index) => index <= frontMatterEnd ? '' : line).join('\n');
  const walker = new Parser().parse(parsedSource).walker();
  const chunks = [], sourceMap = [], warnings = [];
  let event;
  while ((event = walker.next())) {
    const node = event.node;
    if (!event.entering || node.type !== 'code_block') continue;
    const info = node.info ?? '';
    if (!/^ghost(?:$|[-\s])/.test(info)) continue;
    const [[first, column], [last]] = node.sourcepos;
    if (node.parent.type !== 'document') {
      warnings.push(`${filename}:${first}:${column}: nested ghost fence inside ${node.parent.type} is ignored`);
      continue;
    }
    const opener = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[first - 1]);
    if (!opener) continue; // Indented code is never executable.
    const rawInfo = opener[2].trim();
    if (rawInfo !== 'ghost') throw new LiterateError(filename, first, column,
      rawInfo.startsWith('ghost-') ? 'unknown ghost tag' : 'unsupported ghost fence attributes');
    const closer = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[last - 1]);
    if (last === first || !closer || closer[1][0] !== opener[1][0] || closer[1].length < opener[1].length) {
      throw new LiterateError(filename, first, column, 'unclosed ghost fence');
    }
    const body = lines.slice(first, last - 1);
    if (!body.some(line => line.trim())) continue;
    if (chunks.length) sourceMap.push(null);
    chunks.push(body.join('\n') + '\n');
    body.forEach((line, index) => sourceMap.push({ file: filename, line: first + index + 1, column: 1, length: line.length }));
  }
  if (!chunks.length) throw new LiterateError(filename, 1, 1, 'no executable ghost code');
  return { code: chunks.join('\n'), sourceMap, warnings };
}

/** Maps copied characters (and the end-of-line insertion point), never generated separators. */
export function mapSourcePosition(sourceMap, line, column) {
  if (!Array.isArray(sourceMap) || !Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
  const entry = sourceMap[line - 1];
  if (!entry || column > entry.length + 1) return null;
  return { file: entry.file, line: entry.line, column: entry.column + column - 1 };
}
