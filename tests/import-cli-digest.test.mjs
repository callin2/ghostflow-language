import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ghostc = fileURLToPath(new URL('../tools/ghostc.mjs', import.meta.url));
// Explicit relay-input-v1 revision; the predecessor is archived independently.
const child = '# 릴레이 원문\r\n\r\n```ghost\r\ncontrol Relay { input start: Bool; output pump: Bool; state request: Bool = false; request\' = case start { ok(value) => value; fault(_) => request; }; pump <- request\'; }\r\n```\r\n';
const sha = source => createHash('sha256').update(source).digest('hex');
const document = (digest, body = 'output pump: Bool; pump <- false;') => `# Root\n\n\`\`\`ghost\nimport Relay from "./relay.ghost.md" revision "relay-input-v1" sha256 "${digest}";\ncontrol Farm { ${body} }\n\`\`\`\n`;
function fixture(t, source, dependency = child) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-import-digest-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'farm.ghost.md'), output = path.join(directory, 'farm.gfb');
  fs.writeFileSync(input, source); if (dependency !== null) fs.writeFileSync(path.join(directory, 'relay.ghost.md'), dependency);
  return { input, output };
}
function run(...args) {
  const result = spawnSync(process.execPath, [ghostc, ...args], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined); return result;
}

test('CLI checks REF-06-102 dependency digest before unsupported instance lowering', t => {
  const catalog = JSON.parse(fs.readFileSync(new URL('./reference/cases/03-settings-boundaries.json', import.meta.url), 'utf8'));
  const entry = catalog.cases.find(item => item.id === 'REF-06-102');
  const { input, output } = fixture(t, entry.source, entry.files['relay.ghost.md']);
  const digestColumn = entry.source.split('\n')[3].indexOf(`"${'0'.repeat(64)}"`) + 1;
  assert.equal(digestColumn, 65);
  const expected = `${input}:4:${digestColumn}: import sha256 digest mismatch for ./relay.ghost.md: expected ${'0'.repeat(64)}, actual ${sha(entry.files['relay.ghost.md'])}`;
  for (const args of [['--check', input], [input, output]]) {
    const result = run(...args);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr, `ghostc: ${expected}\n`);
  }
  assert.equal(fs.existsSync(output), false);
});

test('matching exact UTF-8 prose and CRLF digest accepts the verified closure', t => {
  const { input } = fixture(t, document(sha(child)));
  const result = run('--check', input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('changed imported prose fails digest validation without replacing existing artifacts', t => {
  const { input, output } = fixture(t, document(sha(child)), child.replace('원문', '변경'));
  const paths = [output, `${output}.map.json`, `${output}.manifest.json`];
  for (const target of paths) fs.writeFileSync(target, 'existing artifact');
  const result = run(input, output);
  assert.equal(result.status, 1); assert.match(result.stderr, /import sha256 digest mismatch/);
  for (const target of paths) assert.equal(fs.readFileSync(target, 'utf8'), 'existing artifact');
});

test('missing imported document reports the authored locator', t => {
  const { input } = fixture(t, document(sha(child)), null);
  const result = run('--check', input);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /:4:19: cannot read imported document \.\/relay\.ghost\.md/);
});

test('imported bytes must be valid UTF-8 even if the digest matches', t => {
  const bytes = Buffer.from([0xff, 0xfe]);
  const { input } = fixture(t, document(sha(bytes)), bytes);
  const result = run('--check', input);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /imported document .* must contain valid UTF-8 bytes/);
});
