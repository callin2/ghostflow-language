import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ID_PREFIX = 'GF-REQ-';
const ID_HEX_LENGTH = 16;
const REQUIREMENT_STATUSES = new Set(['implemented', 'partial', 'pending', 'design-only']);

function fail(message) { throw new Error(`requirement catalog: ${message}`); }

export function normalizeExcerpt(lines) {
  return lines.map(line => line.replace(/\s+/g, ' ').trim()).join('\n').trim();
}

function relativePath(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split('/').includes('..')) {
    fail(`${label} must be a repository-relative path`);
  }
  return value;
}

function checkLocator(locator, label, root) {
  if (!locator || typeof locator !== 'object') fail(`${label} is missing`);
  const file = relativePath(locator.path, `${label}.path`);
  if (typeof locator.heading !== 'string' || !locator.heading.trim()) fail(`${label}.heading is missing`);
  if (!Array.isArray(locator.lines) || locator.lines.length !== 2
    || !locator.lines.every(line => Number.isInteger(line) && line > 0)
    || locator.lines[0] > locator.lines[1]) fail(`${label}.lines must be an increasing positive range`);
  if (typeof locator.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(locator.sha256)) {
    fail(`${label}.sha256 must be a 64-character lowercase SHA-256 digest`);
  }
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail(`${label} points to missing file ${file}`);
  const lines = fs.readFileSync(absolute, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const lineCount = lines.length;
  if (locator.lines[1] > lineCount) fail(`${label} points beyond ${file}`);
  const excerpt = normalizeExcerpt(lines.slice(locator.lines[0] - 1, locator.lines[1]));
  const digest = createHash('sha256').update(excerpt).digest('hex');
  if (digest !== locator.sha256) fail(`${label}.sha256 mismatch`);

  const heading = locator.heading.trim();
  const isMarkdown = file.endsWith('.md');
  const headingLine = lines.findIndex(line => {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (isMarkdown) return /^#{1,6}\s+/.test(normalized)
      && normalized.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '').trim() === heading;
    return normalized.includes(heading);
  });
  if (headingLine < 0) fail(`${label}.heading not found in ${file}`);
  if (headingLine + 1 > locator.lines[0]) fail(`${label}.heading must precede its line range`);
  return file;
}

function checkSet(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || !item)) {
    fail(`${label} must be a non-empty string array`);
  }
}

export function requirementId(statement) {
  if (typeof statement !== 'string' || !statement) fail('statement must be a non-empty string');
  return `${ID_PREFIX}${createHash('sha256').update(statement).digest('hex').slice(0, ID_HEX_LENGTH)}`;
}

export function validateCatalog(catalog, { root = path.resolve(new URL('../..', import.meta.url).pathname) } = {}) {
  if (!catalog || catalog.format !== 'GhostFlow/requirements-catalog-v1') fail('unsupported format');
  if (catalog.idAlgorithm !== 'sha256(statement)[0:16]' || catalog.idPrefix !== ID_PREFIX) fail('unsupported ID algorithm');
  if (!Array.isArray(catalog.requirements) || !Array.isArray(catalog.tests)) fail('requirements and tests tables are required');

  const requirements = new Map();
  const tests = new Map();
  for (const [index, row] of catalog.tests.entries()) {
    if (!row || typeof row.id !== 'string' || !row.id) fail(`tests[${index}].id is missing`);
    if (tests.has(row.id)) fail(`duplicate test ID ${row.id}`);
    tests.set(row.id, row);
    relativePath(row.file, `tests[${index}].file`);
    checkLocator(row.locator, `tests[${index}].locator`, root);
    if (row.file !== row.locator.path) fail(`tests[${index}].file and locator.path disagree`);
    if (typeof row.selector !== 'string' || !row.selector.trim()) fail(`tests[${index}].selector is missing`);
    const absolute = path.join(root, row.file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail(`tests[${index}] points to missing file ${row.file}`);
  }

  const linkedTests = new Set();
  for (const [index, row] of catalog.requirements.entries()) {
    if (!row || typeof row.id !== 'string' || !row.id) fail(`requirements[${index}].id is missing`);
    if (requirements.has(row.id)) fail(`duplicate requirement ID ${row.id}`);
    requirements.set(row.id, row);
    if (row.id !== requirementId(row.statement)) fail(`hash mismatch for ${row.id}`);
    checkLocator(row.source, `requirements[${index}].source`, root);
    if (typeof row.layer !== 'string' || !row.layer.trim()) fail(`requirements[${index}].layer is missing`);
    checkSet(row.targets, `requirements[${index}].targets`);
    const hasTests = Array.isArray(row.testIds) && row.testIds.length > 0;
    const hasPending = typeof row.pendingReason === 'string' && row.pendingReason.trim().length > 0;
    const status = row.status ?? (hasPending ? 'partial' : 'implemented');
    if (!REQUIREMENT_STATUSES.has(status)) fail(`${row.id} has an unsupported status`);
    if (!hasTests && !hasPending) fail(`${row.id} has neither testIds nor pendingReason`);
    if (status === 'implemented' && (!hasTests || hasPending)) {
      fail(`${row.id} implemented status requires tests and no pendingReason`);
    }
    if ((status === 'pending' || status === 'design-only' || status === 'partial') && !hasPending) {
      fail(`${row.id} status ${status} requires pendingReason`);
    }
    if (hasTests) {
      if (row.testIds.some(testId => typeof testId !== 'string' || !tests.has(testId))) {
        fail(`${row.id} references an unknown test ID`);
      }
      row.testIds.forEach(testId => linkedTests.add(testId));
    }
  }
  for (const testId of tests.keys()) if (!linkedTests.has(testId)) fail(`orphan test ${testId}`);
  return { requirements: requirements.size, tests: tests.size, linkedTests: linkedTests.size };
}

export function readCatalog({ root = path.resolve(new URL('../..', import.meta.url).pathname) } = {}) {
  const filename = path.join(root, 'contracts/requirements/catalog.json');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
