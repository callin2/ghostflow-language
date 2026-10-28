import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { compileSource as compileBrowser } from '../tools/browser-toolchain.mjs';
import { restoreArtifactSourceMap } from '../tools/toolchain.mjs';
import { emitInteractionSchema } from '../tools/interaction-schema.mjs';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const filename = 'farm.ghost.md';
const doc = code => `# Original document\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const anchor = '<!-- ghostflow:anchor id=COMMON kind=intent status=confirmed origin=user -->\n> Follow the authored policy.\n\n';
const assumption = '<!-- ghostflow:anchor id=GUESS kind=assumption status=unconfirmed origin=ai -->\n> This initial state is a proposal.\n\n';
const link = '  // ghostflow:link id=COMMON relation=implements\n';
const definition = (body, prefix = anchor) => prefix + doc(`control Cell {\n${body}\n}`);
const leaf = definition(`${link}  output on: Bool;\n  // ghostflow:link id=GUESS relation=assumes\n  state held: Bool = false;\n${link}  on <- held;`, anchor + assumption);
const entry = (name, text, revision = 'r1') => ({ filename: name, text, revision });
const pin = (alias, document) => `import ${alias} from "./${document.filename}" revision "${document.revision}" sha256 "${sha256Hex(document.text)}";`;
const child = entry('cell.ghost.md', leaf);
function pair(document = child, prefix = anchor) {
  return prefix + doc(`${pin('Cell', document)}\ncontrol Farm {\n${link}  output local: Bool;\n  output a, b: Bool;\n  instance west: Cell;\n  instance east: Cell;\n  connect a <- east.on;\n  connect b <- west.on;\n${link}  local <- false;\n}`);
}
const compile = (source = pair(), sourceClosure = [child], options = {}) => compileSourceSync(source, { filename, sourceClosure, ...options });
const group = compilation => compilation.traceMetadata.compositionIntent;
const artifactMap = c => ({ format: 'GhostFlow/source-map-v1', bytecodeSha256: sha256Hex(c.bytes),
  sourceDocument: c.sourceDocument, sourceClosure: c.sourceClosure, nodes: c.sourceMap,
  lines: c.extractionMap, traceMetadata: c.traceMetadata,
  interactionSchema: c.interactionSchema, interactionSourceIdentity: c.interactionSourceIdentity,
});
const authoredLine = (text, number) => text.split('\n')[number - 1].trim();

test('composition keeps duplicate anchor IDs scoped to the root and each authored instance', async () => {
  const c = compile();
  assert.equal(group(c).format, 'GhostFlow/composition-intent-v1');
  assert.equal(group(c).sourceClosureSha256, sha256Hex(canonicalJson(c.sourceClosure)));
  assert.deepEqual(group(c).instances.map(i => i.instance), ['east', 'west']);
  assert.deepEqual(c.traceMetadata.intentAnchors.map(a => a.id), ['COMMON']);
  assert.ok(c.traceMetadata.intentLinks.every(l => c.sourceMap.find(n => n.id === l.nodeId).instance === null));
  const [east, west] = group(c).instances;
  for (const instance of [east, west]) {
    assert.deepEqual(instance.definition, { filename: child.filename, revision: 'r1', sha256: sha256Hex(leaf) });
    assert.deepEqual(instance.anchors.map(a => [a.id, a.kind, a.status, a.origin]), [
      ['COMMON', 'intent', 'confirmed', 'user'], ['GUESS', 'assumption', 'unconfirmed', 'ai'],
    ]);
    assert.deepEqual(instance.links.map(l => [l.anchorId, l.nodeKind, l.relation]), [
      ['COMMON', 'output', 'implements'], ['GUESS', 'state', 'assumes'], ['COMMON', 'connection', 'implements'],
    ]);
    for (const l of instance.links) {
      const node = c.sourceMap.find(n => n.id === l.nodeId);
      assert.equal(node.instance, instance.instance);
      assert.equal(node.definitionNodeId, l.definitionNodeId);
      assert.equal(node.filename, child.filename);
      assert.equal(node.line, l.source.line);
      assert.equal(node.endColumn, l.source.endColumn);
      assert.equal(node.extracted.line, l.extractedSource.line);
      assert.match(authoredLine(leaf, l.directiveSource.line), /^\/\/ ghostflow:link/);
      assert.notEqual(l.source.line, l.extractedSource.line);
    }
  }
  assert.deepEqual(east.links.map(l => l.definitionNodeId), west.links.map(l => l.definitionNodeId));
  assert.ok(east.links.every((l, i) => l.nodeId !== west.links[i].nodeId));
  assert.deepEqual((await compileBrowser(pair(), { filename, sourceClosure: [child] })).traceMetadata, c.traceMetadata);
  assert.deepEqual(restoreArtifactSourceMap(artifactMap(c), c.bytes).traceMetadata, c.traceMetadata);
});

test('different definitions and nested authored paths retain their own original spans and IDs', () => {
  const second = entry('other.ghost.md', definition(`${link}  output on: Bool;\n${link}  on <- true;`, '# Another original\n\n' + anchor), 'other-r2');
  const middle = entry('middle.ghost.md', anchor + doc(`${pin('Cell', child)}\ncontrol Middle {\n${link}  output on: Bool;\n  instance inside: Cell;\n  connect on <- inside.on;\n}`), 'middle-r3');
  const source = doc(`${pin('A', child)}\n${pin('B', second)}\n${pin('Middle', middle)}\ncontrol Root {\n  output a, b, c: Bool;\n  instance right: B;\n  instance outer: Middle;\n  instance left: A;\n  connect a <- left.on;\n  connect b <- right.on;\n  connect c <- outer.on;\n}`);
  const c = compile(source, [second, middle, child]);
  assert.deepEqual(group(c).instances.map(i => i.instance), ['left', 'outer', 'outer.inside', 'right']);
  assert.equal(c.traceMetadata.intentAnchors, undefined);
  for (const i of group(c).instances) {
    const original = [child, second, middle].find(d => d.filename === i.definition.filename);
    assert.ok(i.anchors.some(a => a.id === 'COMMON'));
    for (const l of i.links) {
      assert.equal(l.source.filename, original.filename);
      assert.equal(c.sourceMap.find(n => n.id === l.nodeId).instance, i.instance);
      assert.match(authoredLine(original.text, l.source.line), /^(output|state|on <-)/);
    }
  }
});

test('linked instance input and output declarations retain provenance through lowering', () => {
  const wired = entry('wired.ghost.md', definition(`${link}  input request: Bool;\n${link}  output on: Bool;\n${link}  on <- request |> recover(false);`));
  const source = doc(`${pin('Wired', wired)}\ncontrol Root {\n input request: Bool; output on: Bool;\n instance wired: Wired;\n connect wired.request <- request;\n connect on <- wired.on;\n}`);
  const c = compile(source, [wired]);
  const [i] = group(c).instances;
  assert.deepEqual(i.links.map(l => l.nodeKind), ['sensor', 'output', 'connection']);
  assert.ok(i.links.every(l => c.sourceMap.some(n => n.id === l.nodeId && n.definitionNodeId === l.definitionNodeId)));
  assert.deepEqual(c.manifest.outputs.map(o => o.name), ['on']);
});

test('imported coverage uses only that definition links and does not cover a sibling statement', () => {
  const mixed = entry('mixed.ghost.md', definition('  output on, spare: Bool;\n' + link + '  on <- true;\n  spare <- false;'));
  const c = compile(pair(mixed), [mixed]);
  const importedWarnings = c.warnings.filter(w => w.span?.file === mixed.filename);
  assert.equal(importedWarnings.length, 1);
  assert.equal(authoredLine(mixed.text, importedWarnings[0].span.start.line), 'spare <- false;');
  const unlinked = entry('unlinked.ghost.md', definition('  output on: Bool;\n  on <- true;', ''));
  assert.equal(compile(pair(unlinked), [unlinked]).warnings.filter(w => w.span?.file === unlinked.filename).length, 1);
});

test('unused imported intent stays in the closure without inventing an instance', () => {
  const c = compile(doc(`${pin('Unused', child)}\ncontrol Root { output on: Bool; on <- true; }`));
  assert.equal(c.sourceClosure.documents[0].text, leaf);
  assert.deepEqual(c.sourceClosure.instances, []);
  assert.equal(group(c), undefined);
  assert.equal(c.warnings.some(w => w.span?.file === child.filename), false);
});

const invalidDefinitions = [
  ['relation', leaf.replace('relation=implements', 'relation=invalid'), 'ghostflow:link', /malformed ghostflow link directive/],
  ['missing', leaf.replace('id=COMMON relation=implements', 'id=MISSING relation=implements'), '// ghostflow:link id=MISSING', /missing anchor/],
  ['superseded', leaf.replace('kind=intent status=confirmed', 'kind=intent status=superseded'), '// ghostflow:link id=COMMON', /superseded anchor/],
  ['orphan', leaf.replace('  output on:', '\n  output on:'), '// ghostflow:link id=COMMON', /orphan intent link/],
  ['duplicate anchor', anchor + leaf, '<!-- ghostflow:anchor id=COMMON', /duplicate intent anchor/],
  ['duplicate link', leaf.replace('  output on:', link + '  output on:'), '// ghostflow:link id=COMMON', /duplicate identical intent link/],
  ['classification', leaf.replace('id=GUESS relation=assumes', 'id=GUESS relation=implements'), '// ghostflow:link id=GUESS', /cannot reference assumption/],
];
for (const [label, text, marker, message] of invalidDefinitions) test(`imported ${label} fails at the original document span exactly once`, () => {
  const original = entry('cell.ghost.md', '# Offset\n\nExtra prose.\n\n' + text);
  assert.throws(() => compile(pair(original), [original]), error => {
    assert.match(error.message, message);
    assert.equal(error.filename, original.filename);
    const matchingLines = original.text.split('\n').flatMap((line, i) => line.includes(marker) ? [i + 1] : []);
    assert.equal(error.line, matchingLines[label.startsWith('duplicate') ? 1 : 0]);
    const envelope = error.diagnosticEnvelope;
    assert.equal(envelope.source.filename, original.filename);
    assert.equal(envelope.source.sha256, sha256Hex(original.text));
    assert.equal(envelope.requestSource.filename, filename);
    assert.equal(envelope.diagnostics[0].span.file, original.filename);
    assert.equal(envelope.diagnostics[0].span.start.line, error.line);
    assert.equal(envelope.diagnostics[0].span.start.column, error.column);
    return true;
  });
});

test('prose-only definition revisions change provenance while preserving executable bytes', () => {
  const before = compile();
  const revised = entry(child.filename, '# Inserted heading\n\n' + leaf.replace('authored policy', 'reviewed authored policy'), 'r2');
  const after = compile(pair(revised), [revised]);
  assert.deepEqual(after.bytes, before.bytes);
  assert.notEqual(group(after).sourceClosureSha256, group(before).sourceClosureSha256);
  assert.notEqual(group(after).instances[0].definition.sha256, group(before).instances[0].definition.sha256);
  assert.equal(group(after).instances[0].definition.revision, 'r2');
  assert.equal(group(after).instances[0].links[0].source.line, group(before).instances[0].links[0].source.line + 2);
  assert.deepEqual(group(after).instances[0].links.map(l => l.nodeId), group(before).instances[0].links.map(l => l.nodeId));
});

test('root evidence cannot claim an imported node through a colliding anchor ID', () => {
  const source = pair(child, anchor.replace('status=confirmed', 'status=unconfirmed'));
  const c = compile(source);
  const importedNodeId = group(c).instances[0].links[0].nodeId;
  const intentEvidence = { format: 'GhostFlow/intent-evidence-v1', sourceDocumentSha256: c.sourceDocument.sha256,
    interpretations: [{ id: 'I1', revision: 'r1', original: { id: 'O1', revision: 'r1', reference: 'record:original' },
      text: 'Root interpretation', anchorIds: ['COMMON'], decision: { kind: 'undecided', question: 'Review?', owner: null } }],
    conditions: [{ id: 'C1', revision: 'r1', interpretation: { id: 'I1', revision: 'r1' },
      statement: 'Root behavior', scope: 'root', nodeIds: [importedNodeId] }], checks: [],
  };
  assert.throws(() => compile(source, [child], { intentEvidence }), /node has no authored link to this interpretation/);
  intentEvidence.conditions[0].nodeIds = [c.traceMetadata.intentLinks[0].nodeId];
  assert.ok(compile(source, [child], { intentEvidence }).intentEvidence);
});

test('ordinary compilation accepts imported intent and interaction projection explicitly refuses it', () => {
  const c = compile();
  assert.equal(c.interactionSchema, null);
  const identity = { documentId: 'farm', revisionId: 'r1' };
  assert.throws(() => emitInteractionSchema(c, identity), /does not support instance-qualified imported intent/);
  assert.throws(() => compile(pair(), [child], { interactionSourceIdentity: identity }), /does not support instance-qualified imported intent/);
});

test('WASM activation and execution accept original unconfirmed imported intent', async t => {
  const proposed = entry(child.filename, leaf.replace('held: Bool = false', 'held: Bool = true'));
  const c = compile(pair(proposed), [proposed]);
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiateFramed(wasm, c);
  t.after(() => runtime.dispose());
  assert.deepEqual(runtime.step({ nowMs: 0, samples: {} }).vm.safe, { a: true, b: true, local: false });
  assert.equal(group(c).instances[0].anchors[1].status, 'unconfirmed');
});

const mutations = [
  ['instance', m => { m.instances[0].instance = 'west'; }],
  ['revision', m => { m.instances[0].definition.revision = 'r2'; }],
  ['definition digest', m => { m.instances[0].definition.sha256 = '0'.repeat(64); }],
  ['closure digest', m => { m.sourceClosureSha256 = '0'.repeat(64); }],
  ['composed node', m => { m.instances[0].links[0].nodeId = m.instances[1].links[0].nodeId; }],
  ['definition node', m => { m.instances[0].links[0].definitionNodeId++; }],
  ['span', m => { m.instances[0].links[0].source.line++; }],
  ['classification', m => { m.instances[0].anchors[1].status = 'confirmed'; }],
  ['origin', m => { m.instances[0].anchors[1].origin = 'user'; }],
  ['relation', m => { m.instances[0].links[1].relation = 'implements'; }],
];

test('canonical artifact recovery rejects every forged composition intent field and missing metadata', () => {
  const c = compile();
  for (const [label, mutate] of mutations) {
    const map = structuredClone(artifactMap(c));
    mutate(map.traceMetadata.compositionIntent);
    assert.throws(() => restoreArtifactSourceMap(map, c.bytes), /traceMetadata.*canonical source/, label);
  }
  const missing = structuredClone(artifactMap(c));
  delete missing.traceMetadata.compositionIntent;
  assert.throws(() => restoreArtifactSourceMap(missing, c.bytes), /traceMetadata.*canonical source/);
  const standalone = compileSourceSync(definition(`${link}  output on: Bool;\n${link}  on <- true;`), { filename });
  const forged = artifactMap(standalone);
  delete forged.sourceClosure;
  forged.traceMetadata.compositionIntent = group(c);
  assert.throws(() => restoreArtifactSourceMap(forged, standalone.bytes), /source trace metadata fields mismatch/);
});

test('signed portable packages recompile composition intent and reject resigned provenance tampering', async () => {
  const c = compile();
  const key = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  const keyId = 'composition-test';
  const identity = { compilerRevision: 'composition-test-r1', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/framed-scan-abi-v1', bindingRevision: 'composition-bindings-r1',
    requiredCapabilities: c.manifest.outputs.map(o => ({ kind: 'actuator', name: o.name, type: 'bool' })),
  };
  const packageValue = await buildPortablePackage(c, identity, {
    signers: [{ keyId, privateKey: key.privateKey }], verifyCompilation: () => compile(), onDiagnostic() {},
  });
  const options = { trustedKeys: [{ keyId, publicKey: key.publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision, supportedRuntimeSemantics: [identity.runtimeSemantics],
    supportedRuntimeAbis: [identity.runtimeAbi], supportedManifestFormats: [c.manifest.format],
    availableCapabilities: identity.requiredCapabilities, expectedBindingRevision: identity.bindingRevision,
    verifyBytecode: async () => true,
  };
  assert.ok(await verifyPortablePackage(packageValue, options));
  for (const [label, mutate] of mutations) {
    const forged = structuredClone(packageValue);
    const map = JSON.parse(Buffer.from(forged.payload.sourceMap.contentBase64, 'base64'));
    mutate(map.traceMetadata.compositionIntent);
    const bytes = Buffer.from(canonicalJson(map));
    forged.payload.sourceMap.contentBase64 = bytes.toString('base64');
    forged.payload.sourceMap.sha256 = sha256Hex(bytes);
    const payload = Buffer.from(canonicalJson(forged.payload));
    forged.payloadSha256 = sha256Hex(payload);
    forged.signatures[0].signatureBase64 = Buffer.from(await crypto.subtle.sign('Ed25519', key.privateKey, payload)).toString('base64');
    await assert.rejects(() => verifyPortablePackage(forged, options), error => error.code === 'source-map-mismatch', label);
  }
});
