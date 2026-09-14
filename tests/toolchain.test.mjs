import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { compileSource, restoreArtifactSourceMap, verifyArtifactSourceMap, writeArtifact } from '../tools/toolchain.mjs';

const filename = 'mapped.ghost.md';
const markdown = [
  '# A literate control',
  '',
  '설명과 prose는 실행되지 않으며 😄 그대로 보존된다.',
  '',
  '```ghost',
  '// Full-line comment survives compilation.',
  'control Mapped {',
  '  output pump: Bool; // trailing comment',
  '  pump <- false;',
  '}',
  '```',
  '',
  '```markdown',
  'This nonexecuting block is also part of the authored document.',
  '```',
  '',
].join('\r\n');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const traceableTimerControl = `control TraceableTimer {
  input running: Bool;
  state enabled: Bool = false;
  enabled' = running;
  timer age = elapsed(enabled);
  output pump, permit: Bool;
  pump <- enabled';
  permit <- running;
  require pump => permit;
  require !(pump && permit);
}`;

function artifactMap(result) {
  return {
    format: 'GhostFlow/source-map-v1',
    bytecodeSha256: result.manifest.bytecodeSha256,
    sourceDocument: result.sourceDocument,
    nodes: result.sourceMap,
    lines: result.extractionMap,
    traceMetadata: result.traceMetadata,
  };
}

test('source-preserving map recovers the exact CRLF literate document', async () => {
  const extracted = extractLiterate(markdown, { filename });
  const direct = compileControl(extracted.code, { filename });
  const result = await compileSource(markdown, { filename });

  assert.equal(result.manifest.name, 'Mapped');
  assert.equal(result.manifest.bytecodeSha256, createHash('sha256').update(result.bytes).digest('hex'));
  assert.deepEqual(Object.keys(result.manifest).sort(), [
    'bytecodeSha256', 'configs', 'format', 'inputs', 'name', 'outputs', 'schedules', 'sensors', 'signals', 'timers',
  ].sort(), 'the existing control manifest remains unchanged except for its existing bytecode digest');
  assert.equal('sourceSha256' in result.manifest, false);
  assert.deepEqual(result.sourceMap.map(node => node.id), direct.sourceMap.map(node => node.id), 'node IDs are immutable across remapping');
  assert.deepEqual(result.sourceDocument, {
    format: 'GhostFlow/source-document-v1',
    kind: 'literate',
    filename,
    text: markdown,
    sha256: createHash('sha256').update(markdown).digest('hex'),
  });

  const output = result.sourceMap.find(node => node.kind === 'output');
  assert.deepEqual(
    { filename: output.filename, line: output.line, column: output.column },
    { filename, line: 8, column: 3 },
  );
  assert.deepEqual(
    { filename: output.extracted.filename, line: output.extracted.line, column: output.extracted.column },
    { filename, line: 3, column: 3 },
  );

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-toolchain-'));
  try {
    const artifact = path.join(temporary, 'nested', 'mapped.gfb');
    writeArtifact(result, artifact);
    assert.deepEqual(fs.readFileSync(artifact), result.bytes);
    const manifest = JSON.parse(fs.readFileSync(`${artifact}.manifest.json`, 'utf8'));
    const sourceMap = JSON.parse(fs.readFileSync(`${artifact}.map.json`, 'utf8'));
    assert.deepEqual(manifest, result.manifest);
    assert.deepEqual(sourceMap.nodes, result.sourceMap);
    assert.deepEqual(sourceMap.lines, result.extractionMap);
    assert.equal(sourceMap.format, 'GhostFlow/source-map-v1');
    assert.equal(sourceMap.bytecodeSha256, result.manifest.bytecodeSha256);
    assert.deepEqual(
      verifyArtifactSourceMap(sourceMap, fs.readFileSync(artifact), { expectedSourceSha256: result.sourceDocument.sha256 }),
      result.sourceDocument,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('comment-only literate revisions retain GFB and node identity but change source identity', async () => {
  const original = await compileSource(markdown, { filename });
  for (const revised of [
    markdown.replace('설명과 prose는 실행되지 않으며 😄 그대로 보존된다.', '개정된 설명과 prose도 그대로 보존된다.'),
    markdown.replace('// Full-line comment survives compilation.', '// 개정된 주석\r\n// 추가된 설명'),
    markdown.replace('// trailing comment', '// 출력의 이유를 수정한 주석'),
  ]) {
    const changed = await compileSource(revised, { filename });
    assert.notEqual(changed.sourceDocument.sha256, original.sourceDocument.sha256);
    assert.deepEqual(changed.bytes, original.bytes);
    assert.deepEqual(changed.sourceMap.map(node => node.id), original.sourceMap.map(node => node.id));
    const changedMap = {
      format: 'GhostFlow/source-map-v1',
      bytecodeSha256: changed.manifest.bytecodeSha256,
      sourceDocument: changed.sourceDocument,
      nodes: changed.sourceMap,
      lines: changed.extractionMap,
    };
    assert.deepEqual(verifyArtifactSourceMap(changedMap, original.bytes), changed.sourceDocument);
    assert.throws(() => verifyArtifactSourceMap(changedMap, original.bytes, {
      expectedSourceSha256: original.sourceDocument.sha256,
    }), /expected revision/, 'identical bytecode must not hide a different document revision');
  }
});

test('source-map verification rejects tampering, malformed source fields, and wrong revisions', async () => {
  const result = await compileSource(markdown, { filename });
  const map = {
    format: 'GhostFlow/source-map-v1',
    bytecodeSha256: createHash('sha256').update(result.bytes).digest('hex'),
    sourceDocument: result.sourceDocument,
    nodes: result.sourceMap,
    lines: result.extractionMap,
  };
  const changedText = clone(map);
  changedText.sourceDocument.text += 'changed';
  assert.throws(() => verifyArtifactSourceMap(changedText, result.bytes), /does not match text/);

  const changedBytes = Buffer.from(result.bytes);
  changedBytes[0] ^= 1;
  assert.throws(() => verifyArtifactSourceMap(map, changedBytes), /does not match artifact/);
  assert.throws(() => verifyArtifactSourceMap({ ...map, format: 'GhostFlow/source-map-v0' }, result.bytes), /unsupported source map format/);
  assert.throws(() => verifyArtifactSourceMap({ ...map, nodes: null }, result.bytes), /nodes/);
  assert.throws(() => verifyArtifactSourceMap({ ...map, sourceDocument: null }, result.bytes), /sourceDocument/);
  for (const field of ['format', 'kind', 'filename', 'text', 'sha256']) {
    const missing = clone(map);
    delete missing.sourceDocument[field];
    assert.throws(() => verifyArtifactSourceMap(missing, result.bytes), undefined, `missing ${field}`);
  }
  assert.throws(() => verifyArtifactSourceMap({ ...map, sourceDocument: { ...map.sourceDocument, kind: 'unknown' } }, result.bytes), /kind/);
  assert.throws(() => verifyArtifactSourceMap({ ...map, sourceDocument: { ...map.sourceDocument, filename: '' } }, result.bytes), /filename/);
  assert.throws(() => verifyArtifactSourceMap({ ...map, sourceDocument: { ...map.sourceDocument, text: '\ud800' } }, result.bytes), /well-formed UTF-8/);
  assert.throws(() => verifyArtifactSourceMap({ ...map, sourceDocument: { ...map.sourceDocument, text: 'x'.repeat(1024 * 1024 + 1) } }, result.bytes), /byte limit/);
  assert.throws(() => verifyArtifactSourceMap({ ...map, sourceDocument: { ...map.sourceDocument, sha256: 'A'.repeat(64) } }, result.bytes), /lowercase/);
  assert.throws(() => verifyArtifactSourceMap({ ...map, lines: {} }, result.bytes), /lines/);
  assert.throws(() => verifyArtifactSourceMap(map, result.bytes, { expectedSourceSha256: 'z'.repeat(64) }), /lowercase/);
  assert.throws(() => verifyArtifactSourceMap(map, result.bytes, { expectedSourceSha256: '0'.repeat(64) }), /expected revision/);
});

test('traceable artifact maps persist and restore source, map, extraction, and verified trace metadata', async () => {
  const result = await compileSource(traceableTimerControl, { filename: 'traceable-timer.ghost' });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-toolchain-'));
  try {
    const artifact = path.join(temporary, 'traceable-timer.gfb');
    writeArtifact(result, artifact);
    const map = JSON.parse(fs.readFileSync(`${artifact}.map.json`, 'utf8'));
    assert.deepEqual(map.traceMetadata, result.traceMetadata);
    assert.equal(map.traceMetadata.sourceDocumentSha256, result.sourceDocument.sha256);
    assert.equal(map.traceMetadata.bytecodeSha256, result.manifest.bytecodeSha256);
    assert.deepEqual(
      verifyArtifactSourceMap(map, result.bytes, { expectedSourceSha256: result.sourceDocument.sha256 }),
      result.sourceDocument,
      'the legacy verifier preserves its source-document return value',
    );
    assert.deepEqual(
      restoreArtifactSourceMap(map, result.bytes, { expectedSourceSha256: result.sourceDocument.sha256 }),
      {
        sourceDocument: result.sourceDocument,
        sourceMap: result.sourceMap,
        extractionMap: result.extractionMap,
        traceMetadata: result.traceMetadata,
      },
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('traceable artifact-map restoration fails closed when trace provenance is absent or malformed', async () => {
  const result = await compileSource(traceableTimerControl, { filename: 'traceable-timer.ghost' });
  const map = artifactMap(result);
  const timerBindings = map.traceMetadata.bindings.filter(entry => entry.kind === 'timer');
  assert.equal(timerBindings.length, 2, 'fixture has both required generated timer-state bindings');
  const [since, initialized] = timerBindings;
  const malformed = [
    ['missing trace metadata', value => { delete value.traceMetadata; }],
    ['wrong module fingerprint', value => { value.traceMetadata.moduleFingerprint = '0000000000000000'; }],
    ['wrong trace source revision', value => { value.traceMetadata.sourceDocumentSha256 = '0'.repeat(64); }],
    ['wrong trace bytecode revision', value => { value.traceMetadata.bytecodeSha256 = '0'.repeat(64); }],
    ['duplicate timer binding', value => { value.traceMetadata.bindings.push(structuredClone(since)); }],
    ['missing timer binding', value => {
      value.traceMetadata.bindings = value.traceMetadata.bindings.filter(entry => !(entry.kind === 'timer' && entry.generated.role === initialized.generated.role));
    }],
    ['wrong timer role', value => { value.traceMetadata.bindings.find(entry => entry.kind === 'timer').generated.role = 'forged'; }],
    ['wrong generated timer name', value => { value.traceMetadata.bindings.find(entry => entry.kind === 'timer').name = '__gf_timer_since_forged'; }],
    ['wrong timer AST node', value => { value.traceMetadata.bindings.find(entry => entry.kind === 'timer').nodeId = 'forged-node'; }],
    ['wrong timer source', value => { value.traceMetadata.bindings.find(entry => entry.kind === 'timer').source.line += 1; }],
    ['unknown dependency target', value => { value.traceMetadata.dependencies[0].target.name = 'forged_target'; }],
    ['broken constraint coverage', value => { value.traceMetadata.constraints.pop(); }],
  ];
  for (const [label, mutate] of malformed) {
    const candidate = clone(map);
    mutate(candidate);
    assert.throws(
      () => restoreArtifactSourceMap(candidate, result.bytes),
      /traceMetadata|trace metadata|trace provenance|source trace|binding|timer|dependency|constraint|module/i,
      label,
    );
    if (label === 'missing trace metadata') {
      assert.deepEqual(
        verifyArtifactSourceMap(candidate, result.bytes), result.sourceDocument,
        'the compatibility verifier remains source-only compatible when metadata is absent',
      );
    } else {
      assert.throws(
        () => verifyArtifactSourceMap(candidate, result.bytes),
        /traceMetadata|trace metadata|trace provenance|source trace|binding|timer|dependency|constraint|module/i,
        `${label} is also rejected by the legacy verifier when metadata is present`,
      );
    }
  }
});

test('legacy maps without traceable control nodes restore with a null trace metadata projection', async () => {
  const legacy = await compileSource('(module LegacyRestore (strategy run 0 (device true)))', { filename: 'legacy-restore.ghost' });
  const map = {
    format: 'GhostFlow/source-map-v1',
    bytecodeSha256: createHash('sha256').update(legacy.bytes).digest('hex'),
    sourceDocument: legacy.sourceDocument,
    nodes: legacy.sourceMap,
    lines: legacy.extractionMap,
  };
  assert.deepEqual(restoreArtifactSourceMap(map, legacy.bytes), {
    sourceDocument: legacy.sourceDocument,
    sourceMap: legacy.sourceMap,
    extractionMap: legacy.extractionMap,
    traceMetadata: null,
  });
});

test('writeArtifact rejects an invalid envelope before replacing existing files', async () => {
  const result = await compileSource(markdown, { filename });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-toolchain-'));
  try {
    const artifact = path.join(temporary, 'mapped.gfb');
    writeArtifact(result, artifact);
    const before = new Map([
      [artifact, fs.readFileSync(artifact)],
      [`${artifact}.manifest.json`, fs.readFileSync(`${artifact}.manifest.json`)],
      [`${artifact}.map.json`, fs.readFileSync(`${artifact}.map.json`)],
    ]);
    const cyclicNodes = [];
    cyclicNodes.push(cyclicNodes);
    for (const [invalid, message] of [
      [{ ...result, sourceDocument: { ...result.sourceDocument, text: `${result.sourceDocument.text}tampered` } }, /does not match text/],
      [{ ...result, sourceDocument: null }, /sourceDocument/],
      [{ ...result, sourceDocument: undefined }, /sourceDocument/],
      [{ ...result, manifest: { ...result.manifest, bytecodeSha256: '0'.repeat(64) } }, /manifest bytecode SHA-256/],
      [{ ...result, sourceMap: cyclicNodes }, /circular/i],
    ]) {
      assert.throws(() => writeArtifact(invalid, artifact), message);
      for (const [name, contents] of before) assert.deepEqual(fs.readFileSync(name), contents, `${name} was not replaced`);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('low-level legacy compilation gains a plain source envelope while direct compileControl stays legacy-compatible', async () => {
  const legacy = await compileSource('(module Legacy (strategy run 0 (device true)))', { filename: 'legacy.ghost' });
  assert.equal(legacy.manifest, null);
  assert.equal(legacy.sourceDocument.kind, 'plain');
  assert.equal(legacy.bytes.subarray(0, 4).toString(), 'GFB1');

  const direct = compileControl(extractLiterate(markdown, { filename }).code, { filename });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-toolchain-'));
  try {
    const legacyArtifact = path.join(temporary, 'legacy.gfb');
    writeArtifact(legacy, legacyArtifact);
    const legacyMap = JSON.parse(fs.readFileSync(`${legacyArtifact}.map.json`, 'utf8'));
    assert.deepEqual(verifyArtifactSourceMap(legacyMap, legacy.bytes), legacy.sourceDocument);
    assert.equal(fs.existsSync(`${legacyArtifact}.manifest.json`), false);

    const directArtifact = path.join(temporary, 'direct.gfb');
    writeArtifact(direct, directArtifact);
    assert.deepEqual(JSON.parse(fs.readFileSync(`${directArtifact}.map.json`, 'utf8')), { nodes: direct.sourceMap });
    assert.equal('sourceDocument' in JSON.parse(fs.readFileSync(`${directArtifact}.map.json`, 'utf8')), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('compileSource retains existing literate diagnostics and rejects non-UTF-8 source strings', async () => {
  const invalid = [
    '# Invalid literate control',
    '',
    '```ghost',
    'control Invalid {',
    '  output pump: Bool;',
    '  pump <- missing;',
    '}',
    '```',
    '',
  ].join('\n');
  await assert.rejects(
    () => compileSource(invalid, { filename: 'invalid.ghost.md' }),
    error => error.filename === 'invalid.ghost.md'
      && error.line === 6 && error.column === 11
      && error.message.includes('invalid.ghost.md:6:11: unknown identifier missing'),
  );
  await assert.rejects(() => compileSource('\ud800'), /well-formed UTF-8/);
  await assert.rejects(() => compileSource('x'.repeat(1024 * 1024 + 1)), /source byte limit/);
});
