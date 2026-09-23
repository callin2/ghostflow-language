import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ControlCompileError } from '../tools/control.mjs';
import { extractLiterate, MAX_INPUT_LINES } from '../tools/literate.mjs';
import { compileSource, verifyArtifactSourceMap, writeArtifact } from '../tools/toolchain.mjs';

async function validCanonical(t, source, filename) {
  const result = await compileSource(source, { filename });
  assert.equal(result.sourceDocument.text, source);
  assert.equal(result.sourceDocument.sha256, createHash('sha256').update(source).digest('hex'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-newline-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'control.gfb');
  writeArtifact(result, artifact);
  const map = JSON.parse(fs.readFileSync(`${artifact}.map.json`, 'utf8'));
  assert.deepEqual(verifyArtifactSourceMap(map, result.bytes), result.sourceDocument);
}

async function locatedReject(source, filename, line, column, detail) {
  await assert.rejects(() => compileSource(source, { filename }), error => {
    assert.equal(error.constructor, ControlCompileError);
    assert.equal(error.name, 'ControlCompileError');
    assert.equal(error.filename, filename);
    assert.equal(error.line, line);
    assert.equal(error.column, column);
    assert.equal(error.message, `${filename}:${line}:${column}: ${detail}`);
    return true;
  });
}

test('bare CR canonical documents compile and map parser diagnostics to original lines', async t => {
  const invalid = ['# Example', '', '```ghost', 'control Bad { let x = ; }', '```', ''].join('\r');
  await locatedReject(invalid, 'bare-cr.ghost.md', 4, 23, 'expected expression, found ;');
  const valid = ['# Example', '', '```ghost', 'control Good { output ready: Bool; ready <- true; }', '```', ''].join('\r');
  await validCanonical(t, valid, 'bare-cr-valid.ghost.md');
});

test('mixed LF, CRLF, and CR documents preserve exact source identity and diagnostic mapping', async t => {
  const prefix = '# Mixed\r\n\nText\r```ghost\r\n';
  const suffix = '\r}\r\n```';
  const invalid = `${prefix}control Mixed {\r  let x = ;\n${suffix}`;
  await locatedReject(invalid, 'mixed-newlines.ghost.md', 6, 11, 'expected expression, found ;');
  const valid = `${prefix}control Mixed {\r  output ready: Bool;\n  ready <- true;${suffix}`;
  await validCanonical(t, valid, 'mixed-newlines-valid.ghost.md');
});

test('bare CR terminal EOF maps to the final authored code-line insertion point', async () => {
  const source = ['# Example', '', '```ghost', 'control Bad { let x =', '```', ''].join('\r');
  await locatedReject(source, 'bare-cr-eof.ghost.md', 4, 22, 'expected expression, found end of file');
});

test('bare CR line counting enforces the exact literate input limit', () => {
  const document = count => ['```ghost', 'control Boundary {}', '```', ...Array(count - 3).fill('')].join('\r');
  assert.doesNotThrow(() => extractLiterate(document(MAX_INPUT_LINES), { filename: 'cr-lines-valid.ghost.md' }));
  assert.throws(() => extractLiterate(document(MAX_INPUT_LINES + 1), { filename: 'cr-lines-invalid.ghost.md' }),
    error => error instanceof RangeError && error.message === 'literate line limit exceeded');
});
