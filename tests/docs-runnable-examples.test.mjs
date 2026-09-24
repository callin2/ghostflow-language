import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';

const faq = fs.readFileSync(new URL('../docs/language_faq.md', import.meta.url), 'utf8');
const programming = fs.readFileSync(new URL('../docs/ProgrammingInGhostflow.md', import.meta.url), 'utf8');

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
  ['Programming E09', programming, '### E09 —', '### E10 —'],
  ['Programming E14', programming, '### E14 —', '### E15 —'],
]) {
  test(`${id} remains executable GhostFlow`, () => {
    const compiled = compileSourceSync(example(section, marker, nextMarker), { filename: `${id}.ghost.md` });
    assert.match(compiled.manifest.format, /^GhostFlow\/control-v\d+$/);
    assert.ok(compiled.bytes.length > 0);
  });
}
