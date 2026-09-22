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

const ANCHOR_ID = '[A-Za-z][A-Za-z0-9._:-]{0,127}';
const ANCHOR = new RegExp(`^<!-- ghostflow:anchor id=(${ANCHOR_ID}) kind=(intent|premise|assumption) status=(confirmed|unconfirmed|superseded) origin=(user|operator|engineer|ai|imported) -->$`);
const LINK = new RegExp(`^(\\s*)// ghostflow:link id=(${ANCHOR_ID}) relation=(implements|constrains|fallback|assumes)(?: meaning=(counter))?$`);

function range(filename, firstLine, firstColumn, lastLine, lastColumn) {
  return { filename, line: firstLine, column: firstColumn, endLine: lastLine, endColumn: lastColumn + 1 };
}

function directiveColumn(line, marker) {
  const offset = line.indexOf(marker);
  return offset < 0 ? 1 : offset + 1;
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
  const root = new Parser().parse(parsedSource);
  const walker = root.walker();
  const chunks = [], sourceMap = [], warnings = [], topLevel = [], anchors = [], linkDirectives = [];
  let event;
  while ((event = walker.next())) {
    const node = event.node;
    if (!event.entering) continue;
    if (node.parent?.type === 'document') topLevel.push(node);
    if (node.type !== 'code_block') continue;
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
    body.forEach((line, index) => {
      const originalLine = first + index + 1;
      const extractedLine = sourceMap.length + 1;
      const match = LINK.exec(line);
      if (match) {
        const column = match[1].length + 1;
        linkDirectives.push({
          anchorId: match[2], relation: match[3],
          ...(match[4] ? { meaning: match[4] } : {}),
          directiveSource: range(filename, originalLine, column, originalLine, line.length),
          extractedDirectiveSource: range(filename, extractedLine, column, extractedLine, line.length),
        });
      } else if (/^\s*\/\/.*ghostflow:link/.test(line)) {
        throw new LiterateError(filename, originalLine, directiveColumn(line, 'ghostflow:link'), 'malformed ghostflow link directive');
      }
      sourceMap.push({ file: filename, line: originalLine, column: 1, length: line.length });
    });
  }
  if (!chunks.length) throw new LiterateError(filename, 1, 1, 'no executable ghost code');
  for (const [index, node] of topLevel.entries()) {
    if (node.type !== 'html_block' || typeof node.literal !== 'string') continue;
    const [[firstLine, firstColumn], [lastLine, lastColumn]] = node.sourcepos;
    const match = ANCHOR.exec(node.literal);
    if (!match) {
      if (node.literal.startsWith('<!-- ghostflow:anchor') && !node.literal.includes('\n')) {
        throw new LiterateError(filename, firstLine, directiveColumn(lines[firstLine - 1], 'ghostflow:anchor'), 'malformed ghostflow anchor directive');
      }
      continue;
    }
    const body = topLevel[index + 1];
    if (!body || !['paragraph', 'block_quote'].includes(body.type)) {
      throw new LiterateError(filename, firstLine, firstColumn, 'ghostflow anchor requires one following top-level paragraph or block quote');
    }
    const [[bodyFirstLine, bodyFirstColumn], [bodyLastLine, bodyLastColumn]] = body.sourcepos;
    anchors.push({
      id: match[1], kind: match[2], status: match[3], origin: match[4],
      directiveSource: range(filename, firstLine, firstColumn, lastLine, lastColumn),
      source: range(filename, bodyFirstLine, bodyFirstColumn, bodyLastLine, bodyLastColumn),
    });
  }
  return { code: chunks.join('\n'), sourceMap, warnings, anchors, linkDirectives };
}

/** Maps copied characters (and the end-of-line insertion point), never generated separators. */
export function mapSourcePosition(sourceMap, line, column) {
  if (!Array.isArray(sourceMap) || !Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
  const entry = sourceMap[line - 1];
  if (!entry || column > entry.length + 1) return null;
  return { file: entry.file, line: entry.line, column: entry.column + column - 1 };
}
