import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decode, encode } from '@toon-format/toon';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const example = path.join(root, 'examples/authoring');
const sha256 = text => createHash('sha256').update(text).digest('hex');

function cli(script, args, input) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root, input, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function request(directory, fixture, sourcePath, artifactPath) {
  const template = decode(fs.readFileSync(path.join(example, `${fixture}.toon`), 'utf8'), { strict: true });
  template.source.path = sourcePath;
  if (artifactPath) template.artifactPath = artifactPath;
  const requestPath = path.join(directory, `${fixture}.toon`);
  fs.writeFileSync(requestPath, encode(template));
  return requestPath;
}

test('offline authoring example retrieves Reference, fixes one canonical document, and simulates safe intent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-authoring-'));
  try {
    for (const [file, id] of [
      ['intent-reference-request.toon', 'ref-01-02'],
      ['syntax-reference-request.toon', 'ref-01-05'],
      ['reference-request.toon', 'ref-04-07'],
    ]) {
      const reference = cli('tools/reference-query.mjs', ['--toon-request', '-'], fs.readFileSync(path.join(example, file), 'utf8'));
      assert.equal(reference.status, 0, reference.stderr);
      const lookup = decode(reference.stdout, { strict: true });
      assert.equal(lookup.status, 'ok');
      assert.equal(lookup.sections[0].id, id);
      assert.ok(lookup.sections[0].citation.includes('#'));
      assert.ok(lookup.sections[0].digest.startsWith('sha256:'));
    }

    const documentPath = path.join(directory, 'pump.ghost.md');
    const artifactPath = path.join(directory, 'pump.gfb');
    const first = fs.readFileSync(path.join(example, 'pump-rev-1.ghost.md'), 'utf8');
    const corrected = fs.readFileSync(path.join(example, 'pump-rev-2.ghost.md'), 'utf8');
    fs.writeFileSync(documentPath, first);
    const documentId = 'GF-EXAMPLE-PUMP';
    const firstCheck = cli('tools/ghostc.mjs', ['--request', request(directory, 'check-rev-1', documentPath)]);
    assert.equal(firstCheck.status, 1);
    const failure = decode(firstCheck.stdout, { strict: true });
    assert.equal(failure.ok, false);
    assert.equal(failure.source.documentId, documentId);
    assert.equal(failure.source.revisionId, 'rev-1');
    assert.equal(failure.source.sha256, sha256(first));
    assert.equal(failure.diagnostics[0].span.file, documentPath);
    assert.equal(failure.diagnostics[0].code, 'GF_PARSE');

    fs.writeFileSync(documentPath, corrected);
    const secondCheck = cli('tools/ghostc.mjs', ['--request', request(directory, 'check-rev-2', documentPath)]);
    assert.equal(secondCheck.status, 0, secondCheck.stdout);
    const checked = decode(secondCheck.stdout, { strict: true });
    assert.equal(checked.ok, true);
    assert.equal(checked.source.sha256, sha256(corrected));
    assert.equal(checked.source.documentId, documentId);
    assert.equal(checked.source.revisionId, 'rev-2');
    assert.notEqual(checked.source.sha256, failure.source.sha256);

    const compiled = cli('tools/ghostc.mjs', ['--request', request(directory, 'compile-rev-2', documentPath, artifactPath)]);
    assert.equal(compiled.status, 0, compiled.stdout);
    const compileResult = decode(compiled.stdout, { strict: true });
    assert.equal(compileResult.ok, true);
    const map = JSON.parse(fs.readFileSync(`${artifactPath}.map.json`, 'utf8'));
    assert.equal(map.sourceDocument.text, corrected);
    assert.deepEqual(map.interactionSourceIdentity, { documentId, revisionId: 'rev-2' });

    const simulated = cli('tools/ghostsim.mjs', [artifactPath, path.join(example, 'pump-scenario.toon')]);
    assert.equal(simulated.status, 0, simulated.stdout);
    const result = decode(simulated.stdout, { strict: true });
    assert.equal(result.outcome, 'completed');
    assert.equal(result.artifact.sourceDocumentSha256, checked.source.sha256);
    assert.deepEqual(result.artifact.sourceIdentity, { documentId, revisionId: 'rev-2' });
    assert.deepEqual(result.scans.map(scan => scan.requestedVirtualIntent.pump), [true, true, false]);
    assert.deepEqual(result.scans.map(scan => scan.safeVirtualIntent.pump), [false, true, false]);
    assert.match(corrected, /kind=assumption status=unconfirmed/);
    assert.doesNotMatch(corrected, /timer\s+\w+\s*=/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
