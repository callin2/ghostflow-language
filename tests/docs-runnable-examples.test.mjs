import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';

const faq = fs.readFileSync(new URL('../docs/language_faq.md', import.meta.url), 'utf8');
const programming = fs.readFileSync(new URL('../docs/ProgrammingInGhostflow.md', import.meta.url), 'utf8');
const programmingEnglish = fs.readFileSync(new URL('../docs/ProgrammingInGhostflow.en.md', import.meta.url), 'utf8');

function example(section, marker, nextMarker) {
  const start = section.indexOf(marker);
  assert.notEqual(start, -1, `missing example ${marker}`);
  const sectionEnd = section.indexOf(nextMarker, start + marker.length);
  assert.notEqual(sectionEnd, -1, `missing following section after ${marker}`);
  const next = section.indexOf('```ghost\n', start);
  assert.notEqual(next, -1, `missing GhostFlow fence in ${marker}`);
  assert.ok(next < sectionEnd, `missing GhostFlow fence within ${marker}`);
  const end = section.indexOf('\n```', next + 9);
  assert.notEqual(end, -1, `unclosed GhostFlow fence in ${marker}`);
  assert.ok(end < sectionEnd, `unclosed GhostFlow fence within ${marker}`);
  return `# ${marker}\n\n${section.slice(next, end + 4)}\n`;
}

for (const [id, section, marker, nextMarker] of [
  ['FAQ 07', faq, '<a id="q07"></a>', '<a id="q08"></a>'],
  ['FAQ 11', faq, '<a id="q11"></a>', '<a id="q12"></a>'],
  ['FAQ 13', faq, '<a id="q13"></a>', '<a id="q14"></a>'],
  ['FAQ 22', faq, '<a id="q22"></a>', '<a id="q23"></a>'],
  ['Programming E01', programming, '### E01 —', '<a id="ch02"></a>'],
  ['Programming E02', programming, '### E02 —', '<a id="ch03"></a>'],
  ['Programming E03', programming, '### E03 —', '### PC-02 —'],
  ['Programming E04', programming, '### E04 —', '<a id="ch04"></a>'],
  ['Programming E05', programming, '### E05 —', '### E06 —'],
  ['Programming E06', programming, '### E06 —', '<a id="ch05"></a>'],
  ['Programming E07', programming, '### E07 —', '<a id="ch06"></a>'],
  ['Programming E08', programming, '### E08 —', '<a id="ch07"></a>'],
  ['Programming E09', programming, '### E09 —', '### E10 —'],
  ['Programming E10', programming, '### E10 —', '### E14 —'],
  ['Programming E12', programming, '### E12 —', '### E13 —'],
  ['Programming E13', programming, '### E13 —', '### E11 —'],
  ['Programming E14', programming, '### E14 —', '### E15 —'],
]) {
  test(`${id} remains executable GhostFlow`, () => {
    const compiled = compileSourceSync(example(section, marker, nextMarker), { filename: `${id}.ghost.md` });
    assert.match(compiled.manifest.format, /^GhostFlow\/control-v\d+$/);
    assert.ok(compiled.bytes.length > 0);
    if (section === programming) {
      const translated = example(programmingEnglish, marker, nextMarker);
      assert.equal(translated, example(section, marker, nextMarker), `${id} translation must preserve executable code`);
    }
  });
}

test('Programming E15 compiles the complete literate document in both languages', () => {
  for (const document of [programming, programmingEnglish]) {
    const start = document.indexOf('````markdown\n', document.indexOf('### E15 —'));
    const end = document.indexOf('\n````', start);
    assert.ok(start >= 0 && end > start, 'E15 complete document must be present');
    const compiled = compileSourceSync(document.slice(start + '````markdown\n'.length, end), { filename: 'follow-switch.ghost.md' });
    assert.match(compiled.manifest.format, /^GhostFlow\/control-v\d+$/);
    assert.ok(compiled.bytes.length > 0);
  }
});

for (const [id, marker, nextMarker, mutation] of [
  ['E02', '### E02 —', '<a id="ch03"></a>', source => source.replace(
    /let low = case threshold \{[\s\S]*?\n  \};/, 'let low = level < threshold;')],
  ['E08', '### E08 —', '<a id="ch07"></a>', source => source.replace('age >= value', 'age >= delay')],
]) {
  test(`Programming ${id} rejects implicit scalar config access`, () => {
    const source = example(programming, marker, nextMarker);
    const stale = mutation(source);
    assert.notEqual(stale, source, 'mutation must restore a direct config comparison');
    assert.throws(() => compileSourceSync(stale, { filename: `${id}.ghost.md` }), /cannot use Result directly/);
  });
}

for (const [id, diagnostic] of [
  ['E90', /expected ; after input declaration/],
  ['E91', /requires matching ordered types/],
  ['E92', /next state references are allowed only in output expressions/],
  ['E93', /unexpected trailing token control/],
  ['E94', /Int literal is outside -2147483648\.\.2147483647/],
  ['E95', /case for Mode must be exhaustive/],
  ['E96', /duplicate output connection lamp/],
  ['E97', /cannot use Result directly/],
]) {
  test(`Programming ${id} retains its intended compiler diagnostic`, () => {
    const code = document => {
      const section = document.slice(document.indexOf(`### ${id} —`));
      const match = section.match(/```ghost-error\n([\s\S]*?)\n```/);
      assert.ok(match, `${id} error example must be present`);
      return match[1];
    };
    const canonical = code(programming);
    assert.equal(code(programmingEnglish), canonical, `${id} translation must preserve error code`);
    const source = `# ${id}\n\n\`\`\`ghost\n${canonical}\n\`\`\`\n`;
    assert.throws(() => compileSourceSync(source, { filename: `${id}.ghost.md` }), error => {
      assert.match(error.message, diagnostic);
      assert.equal(error.diagnosticEnvelope.source.filename, `${id}.ghost.md`);
      assert.ok(error.diagnosticEnvelope.diagnostics.length > 0);
      return true;
    });
  });
}
