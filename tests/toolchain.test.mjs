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
const traceableTimerDocument = `# Traceable timer

\`\`\`ghost
${traceableTimerControl}
\`\`\`
`;
const traceableTimerFilename = 'traceable-timer.ghost.md';

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

test('schedule generated inputs preserve declaration bindings through artifact publication', async t => {
  const source = '# Schedule provenance\n\n```ghost\ncontrol Schedules {\n'
    + '  schedule dawn: Solar { timezone = "UTC"; latitude = 0; longitude = 0; at = sun`rise`; fallback = skip; }\n'
    + '  schedule slots: DailySlots<15min> { timezone = "UTC"; selected = [06:00]; }\n'
    + '  output pump: Bool;\n  pump <- dawn.due || slots.due;\n}\n```\n';
  const result = await compileSource(source, { filename: 'schedules.ghost.md' });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-schedule-map-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const artifact = path.join(temporary, 'schedules.gfb');
  writeArtifact(result, artifact);
  const map = JSON.parse(fs.readFileSync(`${artifact}.map.json`, 'utf8'));
  assert.deepEqual(verifyArtifactSourceMap(map, result.bytes), result.sourceDocument);
  const bindings = map.traceMetadata.bindings.filter(binding => binding.kind === 'schedule');
  assert.deepEqual(bindings.map(binding => binding.name), ['__gf_schedule_due_dawn', '__gf_schedule_due_slots']);
  for (const binding of bindings) {
    assert.deepEqual(binding.fields, ['inputs']);
    assert.equal(map.nodes.find(node => node.id === binding.nodeId)?.kind, 'schedule');
    const missing = clone(map);
    missing.traceMetadata.bindings = missing.traceMetadata.bindings.filter(item => item.nodeId !== binding.nodeId);
    assert.throws(() => verifyArtifactSourceMap(missing, result.bytes), /schedule binding count/);
  }
});

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
  const result = await compileSource(traceableTimerDocument, { filename: traceableTimerFilename });
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
        interactionSchema: null,
        interactionSourceIdentity: null,
      },
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('traceable artifact-map restoration fails closed when trace provenance is absent or malformed', async () => {
  const result = await compileSource(traceableTimerDocument, { filename: traceableTimerFilename });
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

test('continuous timer restoration rejects descriptor, role, source-mode, and dependency tampering', async t => {
  const result = await compileSource(`# Continuous timer trace

\`\`\`ghost
control ContinuousTrace {
  input hot, backup: Bool;
  timer hot_for = continuous_true(hot);
  output ready: Bool;
  ready <- hot_for >= 30ms;
}
\`\`\`
`, { filename: 'continuous-trace.ghost.md' });
  const map = artifactMap(result);
  assert.equal(restoreArtifactSourceMap(map, result.bytes, {
    manifest: result.manifest,
  }).traceMetadata.moduleFingerprint, result.traceMetadata.moduleFingerprint);

  const mutations = [
    ['missing descriptor', value => { value.manifest.timers = []; }],
    ['mixed descriptor', value => { value.manifest.timers[0].state = 'forged'; }],
    ['legacy descriptor substitution', value => {
      value.manifest.timers[0] = { name: 'hot_for', state: 'forged', clockInput: '__gf_now_ms' };
    }],
    ['legacy private role substitution', value => {
      const binding = value.map.traceMetadata.bindings.find(entry => entry.generated?.role === 'wasTrue');
      binding.generated.role = 'initialized';
      binding.name = '__gf_timer_initialized_hot_for';
    }],
    ['source mode substitution', value => {
      value.map.nodes.find(node => node.kind === 'timer').timerMode = 'elapsed';
    }],
    ['missing condition dependency read', value => {
      const dependency = value.map.traceMetadata.dependencies.find(entry => (
        entry.target.field === 'timerValue' && entry.target.name === 'hot_for'
      ));
      dependency.reads = dependency.reads.filter(read => read.name !== 'hot');
    }],
    ['extra condition dependency read', value => {
      const dependency = value.map.traceMetadata.dependencies.find(entry => (
        entry.target.field === 'timerValue' && entry.target.name === 'hot_for'
      ));
      dependency.reads.push({ field: 'inputs', name: 'forged' });
    }],
    ['substituted existing input read', value => {
      const dependency = value.map.traceMetadata.dependencies.find(entry => (
        entry.target.field === 'timerValue' && entry.target.name === 'hot_for'
      ));
      // A real, same-typed input passes name/type checks but is not the source dependency.
      dependency.reads.find(read => read.name === 'hot').name = 'backup';
    }, /value dependencies do not match canonical source lowering/],
  ];
  for (const [label, mutate, diagnostic = /timer|binding|descriptor|mode|dependenc|canonical/i] of mutations) {
    await t.test(label, () => {
      const candidate = { map: clone(map), manifest: clone(result.manifest) };
      mutate(candidate);
      assert.throws(() => restoreArtifactSourceMap(candidate.map, result.bytes, {
        manifest: candidate.manifest,
      }), diagnostic, label);
    });
  }
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

test('compileSource retains existing literate diagnostics and rejects non-UTF-8 source strings', async () => {
  const invalid = [
    '# Invalid literate control',
    '',
    '```ghost',
    'control InvalidFixture {',
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
