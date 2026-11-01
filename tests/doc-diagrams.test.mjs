import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDiagrams, sourceDigest, staleDiagrams, stampSvg } from '../tools/render-diagrams.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-diagrams-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write('docs/diagrams/_style.puml', 'skinparam defaultFontName SansSerif\n');
  write('docs/diagrams/guide/flow.puml', '@startuml\n!include ../_style.puml\nA -> B: start\n@enduml\n');
  write('docs/diagrams/guide/flow.ko.puml', '@startuml\nA -> B: 시작\n@enduml\n');
  const render = file => write(file.replace(/\.puml$/, '.svg'),
    stampSvg('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><text>&#49884;&#51089;</text></svg>', sourceDigest(root, file), '1.2024.7'));
  render('docs/diagrams/guide/flow.puml'); render('docs/diagrams/guide/flow.ko.puml');
  return { root, write, render };
}

test('fresh rendered diagrams pass without Java', t => {
  const f = fixture(t);
  assert.deepEqual(checkDiagrams(f.root, '1.2024.7'), { diagrams: 2 });
});

test('the shared style is optional and only covers diagrams that include it', t => {
  const f = fixture(t);
  f.write('docs/diagrams/_style.puml', 'skinparam defaultFontSize 20\n');
  assert.deepEqual(staleDiagrams(f.root, '1.2024.7'), ['docs/diagrams/guide/flow.puml']);
  fs.unlinkSync(path.join(f.root, 'docs/diagrams/_style.puml'));
  f.render('docs/diagrams/guide/flow.puml');
  assert.deepEqual(checkDiagrams(f.root, '1.2024.7'), { diagrams: 2 });
});

test('every language variant of a diagram is checked independently', t => {
  const f = fixture(t);
  for (const language of ['zh', 'es', 'ja']) {
    f.write(`docs/diagrams/guide/flow.${language}.puml`, '@startuml\nA -> B\n@enduml\n');
    f.render(`docs/diagrams/guide/flow.${language}.puml`);
  }
  assert.deepEqual(checkDiagrams(f.root, '1.2024.7'), { diagrams: 5 });
  f.write('docs/diagrams/guide/flow.ja.puml', '@startuml\nA -> B: 開始\n@enduml\n');
  assert.deepEqual(staleDiagrams(f.root, '1.2024.7'), ['docs/diagrams/guide/flow.ja.puml']);
});

test('restamping replaces the previous marker', t => {
  const f = fixture(t);
  const svg = fs.readFileSync(path.join(f.root, 'docs/diagrams/guide/flow.svg'), 'utf8');
  assert.equal(stampSvg(svg, 'a'.repeat(64), '1.2024.7').match(/ghostflow-diagram/g).length, 1);
});

for (const [name, mutate, pattern] of [
  ['edited source', f => f.write('docs/diagrams/guide/flow.puml', '@startuml\nA -> B: stop\n@enduml\n'), /stale SVG/],
  ['edited shared style', f => f.write('docs/diagrams/_style.puml', 'skinparam defaultFontSize 20\n'), /stale SVG/],
  ['missing SVG', f => fs.unlinkSync(path.join(f.root, 'docs/diagrams/guide/flow.ko.svg')), /missing rendered SVG/],
  ['orphan SVG', f => f.write('docs/diagrams/guide/old.svg', '<svg/>'), /without PlantUML source/],
  ['unmarked SVG', f => f.write('docs/diagrams/guide/flow.svg', '<svg/>'), /marker/],
  ['translation without English base', f => { f.write('docs/diagrams/guide/solo.ja.puml', '@startuml\n@enduml\n'); f.render('docs/diagrams/guide/solo.ja.puml'); }, /without English base/],
  ['unsupported language', f => { f.write('docs/diagrams/guide/flow.fr.puml', '@startuml\n@enduml\n'); f.render('docs/diagrams/guide/flow.fr.puml'); }, /unsupported diagram language/],
  ['unexpected file', f => f.write('docs/diagrams/guide/flow.png', 'x'), /unexpected file/],
]) test(`rejects ${name}`, t => {
  const f = fixture(t); mutate(f);
  assert.throws(() => checkDiagrams(f.root, '1.2024.7'), pattern);
});

test('rejects SVG rendered by a different PlantUML version', t => {
  const f = fixture(t);
  assert.throws(() => checkDiagrams(f.root, '1.2099.1'), /pinned 1\.2099\.1/);
});
