import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decode, encode } from '@toon-format/toon';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/browser-toolchain.mjs';

test('bounded diagnostics and overflow agree across API, JSON and TOON without artifact writes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-multi-error-'));
  try {
    const sourcePath = path.join(directory, 'many.ghost.md');
    const artifactPath = path.join(directory, 'many.gfb');
    const source = '```ghost\ncontrol Many {\n'
      + Array.from({ length: 21 }, (_, i) => `let bad${i}: Bool = 2;`).join('\n') + '\n}\n```\n';
    fs.writeFileSync(sourcePath, source);
    let envelope;
    await assert.rejects(() => compileSource(source, { filename: sourcePath }), error => {
      envelope = error.diagnosticEnvelope;
      assert.equal(envelope.diagnostics.length, 20);
      assert.deepEqual(envelope.collection, { limit: 20, truncated: true });
      return true;
    });
    const request = requestFile(directory, {
      format: 'GhostFlow/cli-request-v1', operation: 'compile',
      source: { path: sourcePath, documentId: 'many', revisionId: 'r1' }, artifactPath,
    });
    const json = run(['--request', request, '--format', 'json']);
    const toon = run(['--request', request]);
    assert.equal(json.status, 1);
    assert.equal(toon.status, 1);
    const decoded = JSON.parse(json.stdout);
    assert.deepEqual(decoded, decode(toon.stdout, { strict: true }));
    assert.deepEqual(decoded.diagnostics, envelope.diagnostics);
    assert.deepEqual(decoded.collection, envelope.collection);
    assert.equal(decoded.artifact, undefined);
    assert.equal(fs.existsSync(artifactPath), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ghostc = path.join(root, 'tools/ghostc.mjs');

function run(args) {
  const result = spawnSync(process.execPath, [ghostc, ...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function requestFile(directory, request) {
  const file = path.join(directory, 'request.toon');
  fs.writeFileSync(file, encode(request));
  return file;
}

test('TOON check returns the versioned public diagnostic envelope and preserves path identity', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-toon-한글-'));
  try {
    const sourcePath = path.join(directory, '농장.ghost.md');
    fs.writeFileSync(sourcePath, '# Farm 🌱\n\n```ghost\ncontrol Farm {}\n```\n');
    const request = requestFile(directory, {
      format: 'GhostFlow/cli-request-v1', operation: 'check',
      source: { path: sourcePath, documentId: 'farm', revisionId: 'rev-1' },
    });
    const result = run(['--request', request]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const decoded = decode(result.stdout, { strict: true });
    assert.equal(decoded.format, 'GhostFlow/cli-result-v1');
    assert.equal(decoded.ok, true);
    assert.deepEqual(decoded.source, {
      path: sourcePath, documentId: 'farm', revisionId: 'rev-1',
      sha256: createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'),
    });
    assert.deepEqual(decoded.diagnostics, []);
    assert.equal('diagnosticEnvelope' in decoded, false);
    assert.equal(decoded.diagnosticsFormat, 'GhostFlow/diagnostics-v1');
    assert.deepEqual(decode(encode(decoded), { strict: true }), decoded);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('TOON compile failure reports public diagnostics and does not create an artifact', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-toon-fail-'));
  try {
    const sourcePath = path.join(directory, 'bad.ghost.md');
    const artifactPath = path.join(directory, 'bad.gfb');
    fs.writeFileSync(sourcePath, '# Bad\n\n```ghost\ncontrol Bad { output pump: Bool; pump <- ; }\n```\n');
    const request = requestFile(directory, {
      format: 'GhostFlow/cli-request-v1', operation: 'compile',
      source: { path: sourcePath, documentId: 'bad', revisionId: 'rev-2' }, artifactPath,
    });
    const result = run(['--request', request]);
    const json = run(['--request', request, '--format', 'json']);
    assert.equal(result.status, 1);
    assert.equal(json.status, 1);
    assert.equal(result.stderr, '');
    const decoded = decode(result.stdout, { strict: true });
    assert.deepEqual(decoded, JSON.parse(json.stdout));
    assert.equal(decoded.ok, false);
    assert.equal(decoded.source.documentId, 'bad');
    assert.equal(decoded.source.revisionId, 'rev-2');
    assert.equal(decoded.diagnostics[0].code, 'GF_PARSE');
    assert.equal('diagnosticEnvelope' in decoded, false);
    assert.equal(Object.keys(decoded).filter(key => key === 'diagnostics').length, 1);
    assert.equal(Object.values(decoded).some(value => value && typeof value === 'object' && !Array.isArray(value) && 'diagnostics' in value), false);
    assert.deepEqual(decoded.diagnostics[0].span.start, { line: 4, column: 42 });
    assert.equal('artifact' in decoded, false);
    assert.equal(fs.existsSync(artifactPath), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('imported diagnostics keep child source identity correlated to root source once', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-toon-import-'));
  try {
    const childPath = path.join(directory, 'relay.ghost.md');
    const child = '# Relay\n\n```ghost\ncontrol Relay { output pump: Bool; pump <- ; }\n```\n';
    fs.writeFileSync(childPath, child);
    const rootPath = path.join(directory, 'farm.ghost.md');
    const rootSource = `\`\`\`ghost\nimport Relay from "./relay.ghost.md" revision "r1" sha256 "${createHash('sha256').update(child).digest('hex')}";\ncontrol Farm { output pump: Bool; instance east: Relay; connect pump <- east.pump; }\n\`\`\`\n`;
    fs.writeFileSync(rootPath, rootSource);
    const request = requestFile(directory, {
      format: 'GhostFlow/cli-request-v1', operation: 'check',
      source: { path: rootPath, documentId: 'farm', revisionId: 'rev-4' },
    });
    const result = run(['--request', request]);
    assert.equal(result.status, 1);
    const decoded = decode(result.stdout, { strict: true });
    assert.deepEqual(decoded.source, {
      path: rootPath, documentId: 'farm', revisionId: 'rev-4',
      sha256: createHash('sha256').update(rootSource).digest('hex'),
    });
    assert.deepEqual(decoded.diagnosticSource, {
      path: childPath, sha256: createHash('sha256').update(child).digest('hex'),
    });
    assert.equal(decoded.diagnostics[0].span.file, childPath);
    assert.equal('diagnosticEnvelope' in decoded, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('JSON and TOON are projections of the same successful compile result', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-json-'));
  try {
    const sourcePath = path.join(directory, 'valid.ghost.md');
    fs.writeFileSync(sourcePath, '```ghost\ncontrol Valid {}\n```\n');
    const artifactPath = path.join(directory, 'valid.gfb');
    const request = requestFile(directory, {
      format: 'GhostFlow/cli-request-v1', operation: 'compile',
      source: { path: sourcePath, documentId: 'valid', revisionId: 'rev-3' }, artifactPath,
    });
    const toon = run(['--request', request]);
    const json = run(['--request', request, '--format', 'json']);
    assert.equal(toon.status, 0, toon.stderr);
    assert.equal(json.status, 0, json.stderr);
    assert.deepEqual(decode(toon.stdout, { strict: true }), JSON.parse(json.stdout));
    assert.equal(JSON.parse(json.stdout).artifact.path, artifactPath);
    assert.equal(fs.existsSync(artifactPath), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('TOON invocation errors return structured exit 2 and reject raw source fields', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-toon-invalid-'));
  try {
    const request = requestFile(directory, {
      format: 'GhostFlow/cli-request-v1', operation: 'compile',
      source: { path: 'a.ghost.md', documentId: 'a', revisionId: 'r1' }, artifactPath: 'a.gfb', rawCode: 'control A {}',
    });
    const result = run(['--request', request, '--format', 'json']);
    const toonResult = run(['--request', request]);
    assert.equal(result.status, 2);
    assert.equal(toonResult.status, 2);
    assert.equal(result.stderr, '');
    const decoded = JSON.parse(result.stdout);
    assert.equal(decoded.format, 'GhostFlow/cli-result-v1');
    assert.equal(decoded.ok, false);
    assert.equal(decoded.error.code, 'GF_CLI');
    assert.deepEqual(decode(toonResult.stdout, { strict: true }), decoded);

    const missingRevision = requestFile(directory, {
      format: 'GhostFlow/cli-request-v1', operation: 'check',
      source: { path: 'a.ghost.md', documentId: 'a' },
    });
    const missing = run(['--request', missingRevision, '--format', 'json']);
    assert.equal(missing.status, 2);
    assert.equal(JSON.parse(missing.stdout).error.code, 'GF_CLI');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
