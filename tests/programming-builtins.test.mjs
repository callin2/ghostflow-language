import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const compiler = read('tools/control.mjs');
const policies = read('tools/constraints.mjs');
const books = ['docs/ProgrammingInGhostflow.md', 'docs/ProgrammingInGhostflow.en.md'].map(read);

test('scalar fixture migration retains exact baseline source bytes separately', () => {
  const bytes = fs.readFileSync(new URL('./fixtures/history/issue531/scalar-quality-tests.pre-input.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    'd694dfe8d633b12f30a29dcdaa35ba92c4d27d5788059cabe7f9fc7f71857edb');
  for (const entry of JSON.parse(bytes).entries) {
    const original = gunzipSync(Buffer.from(entry.gzipBase64, 'base64'));
    assert.equal(createHash('sha256').update(original).digest('hex'), entry.sha256, entry.path);
  }
});

test('canonical input migration retains pinned pre-migration explicit-quality declarations', () => {
  const bytes = fs.readFileSync(new URL('./fixtures/history/issue531/explicit-quality-tests.pre-input.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '9aacc5c8e449f77a25a20f3fdb7232972130de5dbf0ee8b11b2f044cd9ecddf9');
  const history = JSON.parse(bytes);
  assert.equal(history.baselineCommit, 'c8a5d37ac09230a9011291a3ae3b053d1bc22773');
  for (const entry of history.entries) {
    assert.match(entry.baselineSha256, /^[a-f0-9]{64}$/);
    for (const excerpt of entry.excerpts) {
      assert.match(excerpt.source, /\bsensor\s+\w+\??\s*:/);
      assert.ok(Number.isSafeInteger(excerpt.line) && excerpt.line > 0);
    }
  }
});

// Derive callable spellings from existing dispatch, not an independently edited
// production registry. Contextual constants and rejected aliases are not calls.
function compilerCallables(source) {
  const names = new Set();
  const add = matches => { for (const match of matches) names.add(match[1]); };
  add(source.matchAll(/(?:node|call|gap|admission|restart|basis|options\.basis)\.name\s*(?:===|!==)\s*'([a-z_]+)'/g));
  for (const match of source.matchAll(/\[((?:'[a-z_]+'(?:,\s*)?)+)\]\.includes\((?:node|call|basis|over)\.name\)/g)) {
    add(match[1].matchAll(/'([a-z_]+)'/g));
  }
  add(source.matchAll(/gain\(fields\.\w+, '([a-z_]+)'/g));
  add(source.matchAll(/filterName === '([a-z_]+)'/g));
  for (const match of source.matchAll(/\[((?:'[a-z_]+'(?:,\s*)?)+)\]\.includes\(filterName\)/g)) {
    add(match[1].matchAll(/'([a-z_]+)'/g));
  }
  add(source.matchAll(/token\.value === '(count_on|any_on)'/g));
  for (const syntax of ['ifthenelse', 'pulse', 'persisted_epoch']) names.delete(syntax);
  return [...names].sort();
}

function entries(book) {
  const start = book.indexOf('<a id="ch13"></a>');
  const end = book.indexOf('<a id="appendix-a"></a>', start);
  assert.ok(start >= 0 && end > start, 'chapter 13 precedes unchanged appendix A');
  assert.match(book.slice(0, start), /\]\(#ch13\)/, 'chapter 13 is linked in TOC');
  const rows = [...book.slice(start, end).matchAll(/^\| `([a-z_]+)` \| (.+) \| (.+) \|$/gm)];
  for (const [, destination] of book.slice(start, end).matchAll(/\]\(([^)]+)\)/g)) {
    if (/^https?:/.test(destination)) continue;
    const [file, anchor] = destination.split('#');
    if (file) assert.ok(fs.existsSync(new URL(`../docs/${file}`, import.meta.url)), `chapter link exists: ${destination}`);
    else assert.ok(book.includes(`id="${anchor}"`), `chapter anchor exists: ${destination}`);
  }
  const names = rows.map(row => row[1]);
  assert.equal(new Set(names).size, names.length, 'one entry per callable spelling');
  for (const [, name, signature, context] of rows) {
    assert.ok(signature.includes(`${name}(`), `${name}: explicit signature`);
    assert.match(context, /\[[^\]]+\]\((?:\.\.\/tests\/|\.\.\/examples\/|#ch)\S+\)/, `${name}: existing example link`);
    assert.ok(context.split(/\[[^\]]+\]\(/)[0].trim().length > 10, `${name}: context and boundary explanation`);
  }
  return names.sort();
}

const primary = compilerCallables(compiler);
// Schedule policy calls have their own contextual dispatcher, rather than the
// ordinary expression dispatcher. Keep their coverage derived from that code.
const policyCalls = [...new Set([...compiler.matchAll(/options\.(?:clock|fallback)\.name === '([a-z_]+)'/g)]
  .map(match => match[1]))].sort();
const hostOnly = ['day', 'pump_capacity', 'stopped'];
const expected = [...primary, ...policyCalls, ...hostOnly].sort();

function checkCoverage(book) {
  assert.deepEqual(entries(book), expected, 'book entries cover compiler callables and host-policy forms');
}

test('PIG chapter 13 covers all compiler callables in English and Korean', () => {
  for (const name of hostOnly) {
    assert.match(policies, new RegExp(`this\\.expect\\('${name}'`), `${name}: host-only parser position`);
  }
  for (const book of books) checkCoverage(book);
  assert.deepEqual(entries(books[0]), entries(books[1]));
});

test('PIG coverage rejects a missing entry or missing translation entry', () => {
  for (const book of books) {
    const missing = book.replace(/^\| `hysteresis` \|.*\n/m, '');
    assert.notEqual(missing, book);
    assert.throws(() => checkCoverage(missing), /book entries cover/);
  }
  assert.ok(compilerCallables(`${compiler}\nif (node.name === 'future_builtin') {}`).includes('future_builtin'),
    'a new ordinary dispatcher is detected without updating a test inventory');
});

test('PIG keeps unavailable names outside supported entries and explains hysteresis equality', () => {
  assert.ok(!primary.includes('after_event_for'));
  for (const book of books) {
    const chapter = book.slice(book.indexOf('<a id="ch13"></a>'));
    assert.match(chapter, /after_event_for\(signal, EventId\)/);
    assert.match(chapter, /unknown function/);
    assert.match(chapter, /\[30%,35%\]/);
    assert.match(chapter, /Disconnected\/Stale\/Invalid/);
    assert.match(chapter, /\| 30% \| true \|/);
    assert.match(chapter, /\| 35% \| true \|/);
    assert.match(chapter, /executable:false/);
  }
  // Static contract protection supplements the existing dynamic conditioner
  // oracle. It does not replace its WASM/device verification.
  const conditioner = read('crates/ghostflow-core/src/signals.rs');
  assert.match(conditioner, /value < h\.on_below/);
  assert.match(conditioner, /value > h\.off_above/);
  assert.match(conditioner, /self\.hysteresis_value = self\.initial_hysteresis\(\)/);
});

test('PIG below example compiles in map and is rejected in and_then', () => {
  const source = '# Pipeline example\n\n```ghost\ncontrol Pipeline {\n  input moisture: Percent;\n  output dry: Bool;\n  dry <- moisture |> map(below(30%)) |> recover(false);\n}\n```\n';
  assert.ok(compileSourceSync(source, { filename: 'pipeline.ghost.md' }).bytes.length > 0);
  assert.throws(() => compileSourceSync(source.replace('map(below', 'and_then(below'),
    { filename: 'pipeline.ghost.md' }), /and_then transform must return Result/);
});
