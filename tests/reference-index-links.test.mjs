import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const referenceDir = path.join(root, 'docs/reference');

function slug(text) {
  return text.toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/ /g, '-');
}

function readReference(file) {
  return fs.readFileSync(path.join(referenceDir, file), 'utf8');
}

function section(markdown, heading) {
  const match = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?$`, 'mu').exec(markdown);
  assert.ok(match, `missing section ${heading}`);
  const next = /^## /mu.exec(markdown.slice(match.index + match[0].length));
  return markdown.slice(match.index, next ? match.index + match[0].length + next.index : markdown.length);
}

function tableRows(markdown) {
  return markdown.split(/\r?\n/).filter(line => /^\|.+\|$/.test(line) && !/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|$/.test(line));
}

function anchors(markdown) {
  const result = new Set();
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const delimiter = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) result.add(slug(heading[2]));
  }
  return result;
}

function links(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
}

function cells(row) {
  return row.slice(1, -1).split('|').map(cell => cell.trim());
}

function markdownWithoutLinks(text) {
  return text.replace(/\[[^\]]+\]\([^)]+\)/g, '').trim();
}

function assertResolvableLocalLinks(markdown, baseDir) {
  const errors = [];
  const cache = new Map();
  const loadAnchors = file => {
    const absolute = path.join(baseDir, file);
    if (!cache.has(absolute)) cache.set(absolute, anchors(fs.readFileSync(absolute, 'utf8')));
    return cache.get(absolute);
  };

  for (const target of links(markdown).filter(link => !/^https?:\/\//.test(link))) {
    const [file, anchor, extra] = target.split('#');
    if (extra !== undefined) errors.push(`${target}: invalid multi-anchor target`);
    const absolute = path.join(baseDir, file);
    if (!fs.existsSync(absolute)) {
      errors.push(`${target}: missing target file`);
      continue;
    }
    if (anchor && !loadAnchors(file).has(anchor)) errors.push(`${target}: missing target anchor`);
  }

  assert.deepEqual(errors, []);
}

function compileIndexSource(code) {
  return compileSource(`# Index classification\n\n\`\`\`ghost\n${code}\n\`\`\`\n`, { filename: 'index-classification.ghost.md' });
}

function indexedBody(index, term, file, heading) {
  const row = tableRows(index).find(row => cells(row)[0].includes(term));
  assert.ok(row, `missing index entry for ${term}`);
  assert.ok(links(row).includes(file), `${term} must link to its governing body`);
  return section(readReference(file.replace('.md', '.en.md')), heading);
}

test('REF-07-001: index concepts stay usable as names while body-defined syntax keeps its allowed positions', async () => {
  const chapter = readReference('07-semantic-rules-and-index.en.md');
  const purpose = section(chapter, '7.1 Purpose of this chapter');
  assert.match(purpose, /entire list is not a set of reserved words/);
  const index = section(chapter, '7.5 Declaration and notation index');
  assertResolvableLocalLinks(index, referenceDir);
  assert.ok(tableRows(index).some(row => cells(row)[0].includes('checkpoint')));
  assert.ok(tableRows(section(chapter, '7.7 Terms')).some(row => cells(row)[0] === 'Driver'));
  const vocabulary = indexedBody(index, '`control`', '01-source-and-syntax.md', '1.3 Vocabulary');
  assert.match(vocabulary, /language words cannot be user-defined names/);
  assert.match(vocabulary, /`timezone`.*contextual words/s);

  // These spellings share the index with source keywords, but are concepts,
  // unsupported design notation, or contextual keys rather than global reservations.
  const compiled = await compileIndexSource(`control IndexNames {
    input Driver: Bool;
    input checkpoint: Bool;
    input warn: Bool;
    input timezone: Bool;
    output binding: Bool;
    binding <- (Driver |> recover(false)) && (checkpoint |> recover(false)) && (warn |> recover(false)) && (timezone |> recover(false));
  }`);
  assert.deepEqual(compiled.manifest.sensors.map(input => input.name), ['Driver', 'checkpoint', 'warn', 'timezone']);
  assert.deepEqual(compiled.manifest.outputs, [{ name: 'binding', type: 'Bool' }]);
  await assert.rejects(compileIndexSource('control Bad { output control: Bool; control <- true; }'),
    /output name control is reserved/);
  await assert.rejects(compileIndexSource('input start: Bool; control Bad { output pump: Bool; pump <- true; }'),
    /unexpected declaration control/);

  const scheduleBody = indexedBody(index, '`timezone`', '03-time-and-schedules.md', '3.6 Selected DailySlots');
  assert.match(scheduleBody, /timezone/);
  const contextual = await compileIndexSource(`control ContextualKey {
    schedule starts: DailySlots<15min> { timezone = "UTC"; selected = [06:00]; }
    output pump: Bool;
    pump <- starts.due;
  }`);
  assert.deepEqual(contextual.manifest.schedules.map(({ name, timezone, slots }) => ({ name, timezone, slots })),
    [{ name: 'starts', timezone: 'UTC', slots: [360] }]);
});

test('REF-07-001: indexed design and installation concepts do not become executable source declarations', async () => {
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'tests/reference/cases/03-settings-boundaries.json'), 'utf8')).cases;
  const original = cases.find(entry => entry.id === 'REF-07-001');
  assert.equal(original.issue, 'https://github.com/callin2/ghostflow-language/issues/310');
  assert.equal(original.scope, 'tooling');
  assert.equal(original.status, 'specified');
  const index = section(readReference('07-semantic-rules-and-index.en.md'), '7.5 Declaration and notation index');
  const constraintBody = indexedBody(index, '`warn`', '04-sensors-constraints-control.md', '4.8 Common constraints notation and operations');
  assert.match(constraintBody, /`warn` and `monitor` are unsupported syntax/);
  await assert.rejects(compileIndexSource(`control DesignNotation {
    output pump: Bool; pump <- true;
    constraints Safety { warn true; }
  }`), /unsupported local constraint warn/);

  const compositionBody = indexedBody(index, 'binding', '06-composition-and-replay.md', '6.3 Parameters, settings, dependencies, and bindings');
  const connectionBody = indexedBody(index, 'binding', '06-composition-and-replay.md', '6.4 Import and connection syntax');
  assert.match(connectionBody, /`bind` is not control source syntax/);
  assert.ok(compositionBody.includes("execution environment manages the Driver's own deployment revision"));
  await assert.rejects(compileIndexSource('control InstallationSketch { output pump: Bool; pump <- true; bind pump = gpio(17); }'),
    /unexpected declaration bind/);
  await assert.rejects(compileIndexSource('Driver gpio; control InstallationSketch { output pump: Bool; pump <- true; }'),
    /expected control declaration/);
  const logical = await compileIndexSource('control LogicalPort { input start: Bool; output pump: Bool; pump <- start |> recover(false); }');
  assert.deepEqual(logical.manifest.sensors.map(({ name, type }) => ({ name, type })), [{ name: 'start', type: 'Bool' }]);
  assert.deepEqual(logical.manifest.outputs, [{ name: 'pump', type: 'Bool' }]);
  assert.equal('bindings' in logical.manifest, false, 'logical compilation must not invent physical installation bindings');
});

test('REF-07-008: syntax and symbol index links resolve to exact Reference sections', () => {
  const chapter = readReference('07-semantic-rules-and-index.md');
  const sections = [
    section(chapter, '7.5 선언과 표기 찾아보기'),
    section(chapter, '7.6 기호 찾아보기'),
  ];
  const parsedRows = sections.flatMap(tableRows);
  assert.ok(parsedRows.length > 20, 'index tables must remain substantive');

  assertResolvableLocalLinks(sections.join('\n'), referenceDir);
  const badTargets = sections.flatMap(links).filter(target => !/^https?:\/\//.test(target) && (!target.split('#')[0] || path.basename(target.split('#')[0]) !== target.split('#')[0]));
  assert.deepEqual(badTargets, [], 'index tables must link only to same-directory Reference chapter files');
});

test('REF-07-008: syntax index status markers do not hide parser support', () => {
  const chapter = readReference('07-semantic-rules-and-index.md');
  const syntaxRows = tableRows(section(chapter, '7.5 선언과 표기 찾아보기'));
  const unsupportedRows = syntaxRows.filter(row => /parser 미지원/.test(row));
  assert.deepEqual(unsupportedRows, [
    '| `check`, `limit`, `once ... per occurrence`; `warn` (설계, parser 미지원) | [4. 센서와 제어](04-sensors-constraints-control.md) |',
  ]);
  for (const row of syntaxRows) {
    assert.doesNotMatch(row, /구현 상태|완료|TODO|todo|지원됨|미완료/, `syntax index row must not become an implementation status table: ${row}`);
  }
});

test('REF-07-010: source-to-Reference index links design rationale to exact Reference locations only', () => {
  // Both language versions must preserve exact destinations. Previously only
  // the Korean source was checked, allowing its translation to retain old prose.
  const translation = section(readReference('07-semantic-rules-and-index.en.md'), '7.8 From original documents to the reference');
  assertResolvableLocalLinks(translation, referenceDir);
  const chapter = readReference('07-semantic-rules-and-index.md');
  const sourceIndex = section(chapter, '7.8 원문에서 reference로 찾아가기');
  assertResolvableLocalLinks(sourceIndex, referenceDir);
  assert.deepEqual(links(translation), links(sourceIndex), 'translated index preserves every source link destination');

  const rows = tableRows(sourceIndex).slice(1);
  assert.equal(rows.length, 13, 'source-to-Reference index must cover each design-rationale row');
  for (const row of rows) {
    const [rationale, locations] = cells(row);
    assert.ok(rationale, `missing design rationale: ${row}`);
    assert.ok(locations, `missing Reference location: ${row}`);
    assert.doesNotMatch(row, /이슈 상태|작업 진척|구현 상태|완료|TODO|todo|지원됨|미완료|closed|open/i, `source index row must not be a progress/status table: ${row}`);

    const referenceLinks = links(locations);
    assert.ok(referenceLinks.length > 0, `Reference location cell needs exact links: ${row}`);
    assert.equal(markdownWithoutLinks(locations).replace(/[,.·、，\s]/g, ''), '', `Reference location cell must not contain unlinked target prose: ${row}`);
    for (const target of referenceLinks) {
      assert.match(target, /^0[1-8]-[^#]+\.md#[^#]+$/, `Reference location must be an anchored Reference chapter link: ${target}`);
    }
  }
});
