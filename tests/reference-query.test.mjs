import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode } from '@toon-format/toon';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { queryReferenceToon } from '../tools/reference-query.mjs';

test('TOON catalog exposes stable section IDs and canonical source metadata', () => {
  const result = decode(queryReferenceToon('operation: catalog\nbudgetBytes: 100000'));
  assert.equal(result.status, 'ok');
  const state = result.sections.find((section) => section.id === 'ref-02-08');
  assert.equal(state.source, 'docs/reference/02-types-expressions-state.md');
  assert.match(state.heading, /tick과 상태 snapshot/);
  assert.equal(state.classification, 'normative_rule');
  assert.equal(result.sections.find((section) => section.id === 'ref-07-05').classification, 'index');
  assert.equal(result.sections.find((section) => section.id === 'ref-05-05').classification, 'design_rationale');
  assert.equal(result.sections.find((section) => section.id === 'ref-06-09').classification, 'unspecified');
  assert.match(result.sourceDigest, /^sha256:[a-f0-9]{64}$/);
});

test('state lookup returns the exact bounded Markdown section', () => {
  const result = decode(queryReferenceToon('operation: lookup\nsectionId: ref-02-08\nbudgetBytes: 20000'));
  assert.equal(result.status, 'ok');
  const section = result.sections[0];
  const source = fs.readFileSync(new URL('../docs/reference/02-types-expressions-state.md', import.meta.url), 'utf8');
  const start = source.indexOf('## 2.8 tick과 상태 snapshot');
  const end = source.indexOf('## 2.9 ', start);
  assert.equal(section.markdown, source.slice(start, end));
  assert.equal(section.bytes, Buffer.byteLength(section.markdown));
});

test('representative topics resolve to ordered canonical sections', () => {
  for (const [topic, id] of [
    ['state', 'ref-02-08'], ['timer', 'ref-03-02'], ['settings', 'ref-05-01'],
    ['fault', 'ref-02-05'], ['intent-anchor', 'ref-01-02'],
  ]) {
    const result = decode(queryReferenceToon(`operation: lookup\ntopic: ${topic}\nbudgetBytes: 20000`));
    assert.equal(result.status, 'ok', topic);
    assert.deepEqual(result.sections.map((section) => section.id), [id], topic);
  }
});

test('unknown section and exhausted budget have explicit results', () => {
  const missing = decode(queryReferenceToon('operation: lookup\nsectionId: ref-99-99\nbudgetBytes: 512'));
  assert.equal(missing.status, 'no_match');
  assert.deepEqual(missing.sections, []);
  const bounded = queryReferenceToon('operation: lookup\nsectionId: ref-02-08\nbudgetBytes: 512');
  const result = decode(bounded);
  assert.equal(result.status, 'budget_exceeded');
  assert.ok(result.requiredBytes > 512);
  assert.ok(Buffer.byteLength(bounded) <= 512);
});

test('unknown request fields and ambiguous selectors are rejected', () => {
  assert.throws(() => queryReferenceToon('operation: catalog\nbudgetBytes: 512\nunknown: value'), /unknown request field/);
  assert.throws(() => queryReferenceToon('operation: lookup\nsectionId: ref-02-08\ntopic: state\nbudgetBytes: 512'), /exactly one/);
});

test('a symbol selector retrieves its owning section', () => {
  const result = decode(queryReferenceToon('operation: lookup\nsymbol: ghostflow:anchor\nbudgetBytes: 20000'));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.sections.map((section) => section.id), ['ref-01-02']);
});

test('human CLI prints a cited Markdown section', () => {
  const cli = spawnSync(process.execPath, ['tools/reference-query.mjs', 'lookup', '--section', 'ref-02-08', '--budget', '20000'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /docs\/reference\/02-types-expressions-state\.md#/);
  assert.match(cli.stdout, /## 2\.8 tick과 상태 snapshot/);
});

test('CLI accepts a strict TOON request on stdin', () => {
  const cli = spawnSync(process.execPath, ['tools/reference-query.mjs', '--toon-request', '-'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    input: 'operation: lookup\nsymbol: config\nbudgetBytes: 20000\n',
  });
  assert.equal(cli.status, 0, cli.stderr);
  const result = decode(cli.stdout);
  assert.equal(result.status, 'ok');
  assert.equal(result.sections[0].id, 'ref-05-01');
});
