import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource, restoreArtifactSourceMap, verifyArtifactSourceMap } from '../tools/toolchain.mjs';

const filename = 'intent-anchor.ghost.md';
const document = `<!-- ghostflow:anchor id=GF-INT-PUMP-001 kind=intent status=confirmed origin=user -->
> 급수 요청이 있으면 펌프를 켜 주세요.

<!-- ghostflow:anchor id=GF-PREMISE-PERMIT-001 kind=premise status=confirmed origin=engineer -->
펌프에는 허가 출력이 필요합니다.

<!-- ghostflow:anchor id=GF-INT-FALLBACK-001 kind=intent status=confirmed origin=user -->
매일 일정은 명시된 fallback으로 동작합니다.

<!-- ghostflow:anchor id=GF-ASSUME-CANDIDATE-001 kind=assumption status=unconfirmed origin=ai -->
후보 출력은 검토 전 가정입니다.

\`\`\`ghost
control IntentPump {
  input request, permit: Bool;
  // ghostflow:link id=GF-INT-PUMP-001 relation=implements
  output pump, backup, candidate: Bool;
  // ghostflow:link id=GF-INT-FALLBACK-001 relation=fallback
  schedule daily: DailySlots<15min> { timezone = "UTC"; selected = [07:00]; }
  // ghostflow:link id=GF-INT-PUMP-001 relation=implements
  pump <- request;
  // ghostflow:link id=GF-PREMISE-PERMIT-001 relation=constrains
  require pump => backup;
  backup <- permit;
  // ghostflow:link id=GF-ASSUME-CANDIDATE-001 relation=assumes
  candidate <- request;
}
\`\`\`
`;

const codeOnly = `\`\`\`ghost
control IntentPump {
  input request, permit: Bool;
  output pump, backup, candidate: Bool;
  schedule daily: DailySlots<15min> { timezone = "UTC"; selected = [07:00]; }
  pump <- request;
  require pump => backup;
  backup <- permit;
  candidate <- request;
}
\`\`\`
`;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function artifactMap(compilation) {
  return {
    format: 'GhostFlow/source-map-v1',
    bytecodeSha256: compilation.manifest.bytecodeSha256,
    sourceDocument: compilation.sourceDocument,
    nodes: compilation.sourceMap,
    lines: compilation.extractionMap,
    traceMetadata: compilation.traceMetadata,
  };
}

test('GF-TEST-intent-anchor: explicit literate anchors bind to compiler nodes without changing execution artifacts', async () => {
  const compilation = await compileSource(document, { filename });
  const baseline = await compileSource(codeOnly, { filename });
  assert.deepEqual(compilation.bytes, baseline.bytes);
  assert.deepEqual(compilation.sourceMap.map(node => node.id), baseline.sourceMap.map(node => node.id));
  assert.deepEqual(compilation.traceMetadata.intentAnchors.map(anchor => anchor.id), [
    'GF-INT-PUMP-001', 'GF-PREMISE-PERMIT-001', 'GF-INT-FALLBACK-001', 'GF-ASSUME-CANDIDATE-001',
  ]);
  assert.deepEqual(compilation.traceMetadata.intentLinks.map(({ anchorId, relation, nodeKind }) => ({ anchorId, relation, nodeKind })), [
    { anchorId: 'GF-INT-PUMP-001', relation: 'implements', nodeKind: 'output' },
    { anchorId: 'GF-INT-FALLBACK-001', relation: 'fallback', nodeKind: 'schedule' },
    { anchorId: 'GF-INT-PUMP-001', relation: 'implements', nodeKind: 'connection' },
    { anchorId: 'GF-PREMISE-PERMIT-001', relation: 'constrains', nodeKind: 'require' },
    { anchorId: 'GF-ASSUME-CANDIDATE-001', relation: 'assumes', nodeKind: 'connection' },
  ]);
  const map = artifactMap(compilation);
  assert.deepEqual(verifyArtifactSourceMap(map, compilation.bytes), compilation.sourceDocument);
  assert.deepEqual(restoreArtifactSourceMap(map, compilation.bytes).traceMetadata, compilation.traceMetadata);
});

test('GF-TEST-intent-anchor-diagnostics: author errors identify the literate source and reject ambiguity', async () => {
  const cases = [
    ['malformed anchor', document.replace('origin=user -->', 'origin=user extra=yes -->'), /intent-anchor\.ghost\.md:1:/],
    ['duplicate anchor', document.replace('GF-PREMISE-PERMIT-001', 'GF-INT-PUMP-001'), /duplicate intent anchor/],
    ['missing body', document.replace('> 급수 요청이 있으면 펌프를 켜 주세요.', '# heading is not an anchor body'), /requires one following top-level/],
    ['malformed link', document.replace('relation=implements', 'relation=unknown'), /malformed ghostflow link directive/],
    ['missing anchor', document.replace('id=GF-INT-PUMP-001 relation=implements', 'id=GF-UNKNOWN-001 relation=implements'), /references missing anchor/],
    ['missing anchor in a directive stack', document.replace(
      '  // ghostflow:link id=GF-INT-PUMP-001 relation=implements\n  output pump, backup, candidate: Bool;',
      '  // ghostflow:link id=GF-INT-PUMP-001 relation=implements\n  // ghostflow:link id=GF-UNKNOWN-STACK relation=implements\n  output pump, backup, candidate: Bool;',
    ), /references missing anchor GF-UNKNOWN-STACK/],
    ['orphan link', document.replace('  output pump, backup, candidate: Bool;', '  \n  output pump, backup, candidate: Bool;'), /orphan intent link/],
    ['classification mismatch', document.replace('relation=assumes', 'relation=implements'), /cannot reference assumption/],
    ['superseded anchor', document.replace('kind=intent status=confirmed origin=user -->', 'kind=intent status=superseded origin=user -->'), /references superseded anchor/],
    ['duplicate identical link', document.replace('  output pump, backup, candidate: Bool;', '  // ghostflow:link id=GF-INT-PUMP-001 relation=implements\n  output pump, backup, candidate: Bool;'), /duplicate identical intent link/],
  ];
  for (const [label, source, expected] of cases) {
    await assert.rejects(() => compileSource(source, { filename }), expected, label);
  }
  await assert.rejects(
    () => compileSource('// ghostflow:link id=GF-INT-PUMP-001 relation=implements\ncontrol Plain {}', { filename: 'plain.ghost' }),
    /plain\.ghost:1:4: ghostflow link directives require a literate/,
  );
  const stringValue = await compileSource(`control PlainString {
  config enabled: Bool = false { access = operator; label = "contains ghostflow:link safely"; }
}`, { filename: 'plain-string.ghost' });
  assert.equal(stringValue.manifest.name, 'PlainString', 'a string containing the marker is not a directive');
  const literateString = await compileSource(`\`\`\`ghost
control LiterateString {
  config enabled: Bool = false { access = operator; label = "contains ghostflow:link safely"; }
}
\`\`\`
`, { filename: 'literate-string.ghost.md' });
  assert.equal(literateString.manifest.name, 'LiterateString');
  const ignoredHtml = await compileSource(`<div><!-- ghostflow:anchor id=GF-IGNORED kind=intent status=confirmed origin=user --></div>

\`\`\`ghost
control IgnoredHtml {}
\`\`\`
`, { filename });
  assert.equal(Object.hasOwn(ignoredHtml.traceMetadata, 'intentAnchors'), false, 'enclosing HTML is not an anchor');
});

test('GF-TEST-intent-anchor-sparse-lines: a distant top-level node binds while generated inter-fence separators remain orphaning', async () => {
  const padding = Array.from({ length: 256 }, (_, index) => `  // sparse non-AST line ${index}`).join('\n');
  const sparse = `<!-- ghostflow:anchor id=GF-INT-SPARSE kind=intent status=confirmed origin=user -->
멀리 떨어진 선언도 바로 앞 링크에 연결합니다.

\`\`\`ghost
control Sparse {
  input request: Bool;
${padding}
  // ghostflow:link id=GF-INT-SPARSE relation=implements
  output pump: Bool;
  pump <- request;
}
\`\`\`
`;
  const compilation = await compileSource(sparse, { filename: 'sparse.ghost.md' });
  const linked = compilation.traceMetadata.intentLinks[0];
  assert.equal(linked.nodeKind, 'output');
  assert.ok(linked.extractedSource.line > compilation.sourceMap.length, 'line coordinates are independent of AST node count');

  const split = `<!-- ghostflow:anchor id=GF-INT-SPLIT kind=intent status=confirmed origin=user -->
분리된 fence 사이를 넘어 연결하지 않습니다.

\`\`\`ghost
control Split {
  input request: Bool;
  // ghostflow:link id=GF-INT-SPLIT relation=implements
\`\`\`

\`\`\`ghost
  output pump: Bool;
  pump <- request;
}
\`\`\`
`;
  await assert.rejects(() => compileSource(split, { filename: 'split.ghost.md' }), /orphan intent link/);
});

test('GF-TEST-intent-anchor-recovery: revision, range, metadata, and node tampering fail closed', async () => {
  const compilation = await compileSource(document, { filename });
  const map = artifactMap(compilation);
  const cases = [
    ['revision', value => { value.traceMetadata.sourceDocumentSha256 = '0'.repeat(64); }, /revision mismatch/],
    ['range', value => { value.traceMetadata.intentLinks[0].source.line = 999999; }, /range mismatch|range is outside|source node mismatch/],
    ['node', value => { value.traceMetadata.intentLinks[0].nodeKind = 'input'; }, /source node mismatch/],
    ['directive mapping', value => { value.lines[value.traceMetadata.intentLinks[0].extractedDirectiveSource.line - 1] = null; }, /extraction map mismatch|directive source mapping mismatch/],
    ['anchor body range', value => { value.traceMetadata.intentAnchors[0].source.column += 1; }, /does not match deterministic literate extraction/],
    ['link directive ranges', value => {
      value.traceMetadata.intentLinks[0].directiveSource.column += 1;
      value.traceMetadata.intentLinks[0].extractedDirectiveSource.column += 1;
    }, /does not match deterministic literate extraction/],
    ['missing intent arrays', value => {
      delete value.traceMetadata.intentAnchors;
      delete value.traceMetadata.intentLinks;
    }, /metadata presence mismatch/],
    ['plain source kind', value => { value.sourceDocument.kind = 'plain'; }, /requires literate source kind/],
    ['extraction map', value => { value.lines[0].length += 1; }, /extraction map mismatch/],
    ['unknown field', value => { value.traceMetadata.intentLinks[0].forged = true; }, /intent link fields mismatch/],
    ['unknown metadata field', value => { value.traceMetadata.forged = true; }, /metadata fields mismatch/],
  ];
  for (const [label, mutate, expected] of cases) {
    const candidate = clone(map);
    mutate(candidate);
    assert.throws(() => restoreArtifactSourceMap(candidate, compilation.bytes), expected, label);
  }
});

test('GF-TEST-intent-anchor-stability: prose and link-comment revisions retain bytecode and node identities', async () => {
  const original = await compileSource(document, { filename });
  const revised = await compileSource(
    document
      .replace('급수 요청이 있으면 펌프를 켜 주세요.', '급수 요청의 뜻을 검토한 뒤 펌프를 켜 주세요.')
      .replace('  // ghostflow:link id=GF-INT-PUMP-001 relation=implements', '    // ghostflow:link id=GF-INT-PUMP-001 relation=implements'),
    { filename },
  );
  assert.notEqual(revised.sourceDocument.sha256, original.sourceDocument.sha256);
  assert.deepEqual(revised.bytes, original.bytes);
  assert.deepEqual(revised.sourceMap.map(node => node.id), original.sourceMap.map(node => node.id));
});
