import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cliConcurrency, runNodeCli } from './helpers/cli-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/compiler-syntax-diagnostics.json', import.meta.url), 'utf8'));
const ghostc = path.join(root, 'tools/ghostc.mjs');

function document(code) {
  return ['# Compiler CLI diagnostic', '', '```ghost', code, '```', ''].join('\n');
}

function locationOf(code, marker, occurrence = 1) {
  let index = -1;
  for (let seen = 0; seen < occurrence; seen += 1) index = code.indexOf(marker, index + 1);
  assert.notEqual(index, -1, `missing location marker ${JSON.stringify(marker)}`);
  const lines = code.slice(0, index).split('\n');
  return { line: lines.length + 3, column: lines.at(-1).length + 1 };
}

async function run(args) {
  const result = await runNodeCli([ghostc, ...args], { cwd: root, timeout: 30_000 });
  assert.equal(result.error, null, result.error);
  assert.equal(result.signal, null);
  return result;
}

test('ghostc CLI reports every lexer/parser fixture and preserves artifacts', { concurrency: cliConcurrency }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-cli-diagnostics-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await Promise.all(fixture.cases.map((item, index) => t.test(`ghostc diagnostic: ${item.id}`, async () => {
    const input = path.join(directory, `${index}-${item.id}.ghost.md`);
    const output = path.join(directory, `${index}-${item.id}.gfb`);
    const source = document(item.code);
    fs.writeFileSync(input, source, 'utf8');
    const expectedLocation = locationOf(item.code, item.at, item.occurrence ?? 1);
    const expectedStderr = `ghostc: ${input}:${expectedLocation.line}:${expectedLocation.column}: ${item.message}\n`;

    const check = await run(['--check', input]);
    assert.equal(check.status, 1);
    assert.equal(check.stdout, '');
    assert.equal(check.stderr, expectedStderr);
    assert.equal(fs.existsSync(`${input}.gfb`), false);
    assert.equal(fs.existsSync(`${input}.manifest.json`), false);
    assert.equal(fs.existsSync(`${input}.map.json`), false);

    const seeds = [output, `${output}.manifest.json`, `${output}.map.json`];
    const seeded = index % 2 === 0;
    const contents = seeded ? seeds.map((file, seedIndex) => {
      const bytes = Buffer.from(`existing-${item.id}-${seedIndex}`);
      fs.writeFileSync(file, bytes);
      return bytes;
    }) : [];
    const build = await run([input, output]);
    assert.equal(build.status, 1);
    assert.equal(build.stdout, '');
    assert.equal(build.stderr, expectedStderr);
    for (const [seedIndex, file] of seeds.entries()) {
      if (seeded) assert.deepEqual(fs.readFileSync(file), contents[seedIndex]);
      else assert.equal(fs.existsSync(file), false);
    }
  })));
});

test('ghostc CLI valid control harness emits an artifact', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-cli-valid-'));
  try {
    const input = path.join(directory, 'valid.ghost.md');
    const output = path.join(directory, 'valid.gfb');
    fs.writeFileSync(input, document('control Valid {}'), 'utf8');
    const result = await run([input, output]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /control-v1 \+ host manifest/);
    assert.equal(fs.existsSync(output), true);
    assert.equal(fs.existsSync(`${output}.manifest.json`), true);
    assert.equal(fs.existsSync(`${output}.map.json`), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
