import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const physicalUiAssignment = /(?:output[- ]cabinet[- ]view|driver\/cabinet-view|host\/cabinet-view|cabinet[- ]views?\s+(?:application|적용|수락|reports safe-output|appl(?:y|ies) (?:logical outputs|effects))|cabinet-view·설치 설정에서 극성|cabinet-view 결과\/물리 관측|cabinet-view disconnect handling)/i;

test('active documentation never assigns physical output application to cabinet-view', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  const historical = /^(?:CHANGELOG|DOCS-REVIEW-REPORT|docs\/reports\/|docs\/LLM-AUTHORING-EFFICIENCY-|tests\/fixtures\/history\/|tests\/reference\/BASELINE\.md|tasks\/reference-evidence\.md)/;
  const violations = [];
  for (const file of files) {
    if ((!file.endsWith('.md') && file !== 'contracts/feature-status/catalog.json') || historical.test(file)) continue;
    read(file).split('\n').forEach((line, i) => {
      if (physicalUiAssignment.test(line)) violations.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(violations, [], 'Physical application, polarity, acceptance and stop evidence belong to output renderers');
});

test('stop application and relay polarity remain renderer responsibilities in both languages', () => {
  assert.match(read('docs/CONSTRAINTS.en.md'), /renderer reports safe-output application and completes configured cleanup\/wait/);
  assert.match(read('docs/CONSTRAINTS.md'), /renderer가 안전 출력 적용을 보고/);
  assert.match(read('docs/language_faq.en.md'), /polarity in renderer\/installation settings/);
  assert.match(read('docs/language_faq.md'), /renderer·설치 설정에서 극성을 맞춰/);
});

test('timer completion does not establish renderer application in either translated example', () => {
  for (const name of ['optional-feedback-timer', 'explicit-feedback-adoption']) {
    for (const suffix of ['', '.ko']) {
      const text = read(`examples/${name}.ghost${suffix}.md`);
      assert.match(text, /renderer (?:application|적용)/);
      assert.doesNotMatch(text, /cabinet-view application/);
    }
  }
});

test('cabinet-view retains genuine presentation responsibility and no physical evidence claim', () => {
  assert.match(read('docs/language_faq.en.md'), /cabinet-view creating the screen chooses the UI component/);
  assert.match(read('docs/reference/05-settings-and-observation.en.md'), /UI display does not establish applied or confirmed evidence/);
  assert.match(read('AGENTS.md'), /Renderers apply logical outputs to relays, motors, lamps or screens/);
  assert.match(read('AGENTS.md'), /UI is `@ghostflow\/cabinet-view`/);
});
