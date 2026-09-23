import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decode, encode } from '@toon-format/toon';

const root = fileURLToPath(new URL('../', import.meta.url));
const referenceIndex = fs.readFileSync(path.join(root, 'docs/LANGUAGE-REFERENCE.md'));
const chapterPaths = referenceIndex.toString('utf8')
  .matchAll(/\]\((reference\/\d\d-[^)]+\.md)\)/g);
const sources = [...new Set([...chapterPaths].map((match) => `docs/${match[1]}`))];

const topics = Object.freeze({
  'ref-01-02': ['intent-anchor'],
  'ref-02-05': ['fault'],
  'ref-02-08': ['state', 'tick', 'snapshot'],
  'ref-03-02': ['timer', 'elapsed'],
  'ref-03-03': ['continuous timer'],
  'ref-05-01': ['settings'],
  'ref-05-02': ['live settings', 'setting revision'],
});
const symbols = Object.freeze({
  'ref-01-02': ['ghostflow:anchor', 'ghostflow:link'],
  'ref-02-05': ['Result', 'Option', 'fault'],
  'ref-02-08': ['state'],
  'ref-03-02': ['timer', 'elapsed'],
  'ref-03-03': ['true_for'],
  'ref-05-01': ['config'],
});
const classifications = Object.freeze({
  'ref-01-02': 'normative_rule',
  'ref-02-05': 'normative_rule',
  'ref-02-08': 'normative_rule',
  'ref-03-02': 'normative_rule',
  'ref-03-03': 'normative_rule',
  'ref-05-01': 'normative_rule',
  'ref-05-05': 'design_rationale',
  'ref-06-11': 'design_rationale',
  'ref-07-05': 'index',
  'ref-07-06': 'index',
  'ref-07-07': 'index',
  'ref-07-08': 'index',
});

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function headingAnchor(heading) {
  return heading.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s/g, '-');
}

export function referenceCatalog() {
  const sections = [];
  const sourceDigests = [`docs/LANGUAGE-REFERENCE.md\0${digest(referenceIndex)}`];
  for (const source of sources) {
    const bytes = fs.readFileSync(path.join(root, source));
    const markdown = bytes.toString('utf8');
    sourceDigests.push(`${source}\0${digest(bytes)}`);
    const headings = [...markdown.matchAll(/^## (\d+)\.(\d+) (.+)$/gm)];
    for (let index = 0; index < headings.length; index += 1) {
      const [, chapter, section, heading] = headings[index];
      const id = `ref-${chapter.padStart(2, '0')}-${section.padStart(2, '0')}`;
      const excerpt = markdown.slice(headings[index].index, headings[index + 1]?.index ?? markdown.length);
      sections.push({
        id, source, heading, citation: `${source}#${headingAnchor(`${chapter}.${section} ${heading}`)}`,
        classification: classifications[id] ?? 'unspecified',
        topics: topics[id] ?? [], symbols: symbols[id] ?? [],
        digest: digest(Buffer.from(excerpt)), bytes: Buffer.byteLength(excerpt),
        excerpt,
      });
    }
  }
  const ids = new Set(sections.map((section) => section.id));
  if (ids.size !== sections.length) throw new Error('duplicate Reference section ID');
  for (const id of [...Object.keys(topics), ...Object.keys(symbols), ...Object.keys(classifications)]) {
    if (!ids.has(id)) throw new Error(`stale Reference metadata mapping: ${id}`);
  }
  return {
    sourceDigest: digest(sourceDigests.join('\n')),
    sections,
  };
}

export function queryReferenceToon(requestText) {
  const request = decode(requestText, { strict: true });
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('request must be a TOON object');
  const allowed = new Set(['operation', 'sectionId', 'topic', 'symbol', 'budgetBytes']);
  if (Object.keys(request).some((key) => !allowed.has(key))) throw new TypeError('unknown request field');
  if (!['catalog', 'lookup'].includes(request.operation)) throw new TypeError('operation must be catalog or lookup');
  if (!Number.isSafeInteger(request.budgetBytes) || request.budgetBytes < 256 || request.budgetBytes > 1000000) {
    throw new TypeError('budgetBytes must be an integer from 256 to 1000000');
  }
  if (request.operation === 'catalog' && ('sectionId' in request || 'topic' in request || 'symbol' in request)) throw new TypeError('catalog cannot select a section');
  if (request.operation === 'lookup' &&
      ['sectionId', 'topic', 'symbol'].filter((key) => key in request).length !== 1) {
    throw new TypeError('lookup requires exactly one sectionId, topic, or symbol');
  }
  if (request.operation === 'lookup' &&
      [request.sectionId, request.topic, request.symbol].some((value) => value !== undefined && (typeof value !== 'string' || !value.trim()))) {
    throw new TypeError('selector must be a nonempty string');
  }
  const catalog = referenceCatalog();
  const matches = request.operation === 'catalog' ? catalog.sections : catalog.sections.filter((section) =>
    request.sectionId ? section.id === request.sectionId :
      request.topic ? section.topics.some((topic) => topic.toLowerCase() === request.topic.toLowerCase()) :
        section.symbols.includes(request.symbol));
  if (matches.length === 0) return encode({ status: 'no_match', sourceDigest: catalog.sourceDigest, sections: [] });
  const sections = matches.map(({ excerpt, ...metadata }) =>
    request.operation === 'catalog' ? metadata : { ...metadata, markdown: excerpt });
  const response = encode({ status: 'ok', sourceDigest: catalog.sourceDigest, sections });
  const requiredBytes = Buffer.byteLength(response);
  if (requiredBytes > request.budgetBytes) return encode({ status: 'budget_exceeded', sourceDigest: catalog.sourceDigest, requiredBytes, budgetBytes: request.budgetBytes });
  return response;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === '--toon-request' && args.length === 2) {
      process.stdout.write(`${queryReferenceToon(fs.readFileSync(args[1] === '-' ? 0 : args[1], 'utf8'))}\n`);
    } else {
      const operation = args.shift();
      if (!['catalog', 'lookup'].includes(operation)) throw new TypeError('usage: reference-query.mjs catalog|lookup [--section ID|--topic TOPIC] [--budget BYTES]');
      const request = { operation, budgetBytes: 32768 };
      while (args.length) {
        const flag = args.shift();
        const value = args.shift();
        if (value === undefined) throw new TypeError(`${flag} requires a value`);
        if (flag === '--section') request.sectionId = value;
        else if (flag === '--topic') request.topic = value;
        else if (flag === '--symbol') request.symbol = value;
        else if (flag === '--budget') request.budgetBytes = Number(value);
        else throw new TypeError(`unknown argument ${flag}`);
      }
      const result = decode(queryReferenceToon(encode(request)));
      if (result.status !== 'ok') {
        process.stdout.write(`${result.status}${result.requiredBytes ? `: requires ${result.requiredBytes} bytes` : ''}\n`);
        process.exitCode = result.status === 'no_match' ? 1 : 2;
      } else if (operation === 'catalog') {
        for (const section of result.sections) process.stdout.write(`${section.id}\t${section.heading}\t${section.citation}\n`);
      } else {
        for (const section of result.sections) process.stdout.write(`${section.id} ${section.citation} ${section.digest}\n${section.markdown}`);
      }
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
