import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource, restoreArtifactSourceMap } from '../tools/toolchain.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';

const source = `# Nested window provenance

\`\`\`ghost
control NestedProvenance {
  input reading: Number;
  signal inner = window_average(reading, over: 2ms, quality: measured, max_age: 2ms);
  signal outer = window_average(inner, over: 10ms, quality: measured, max_age: 10ms);
  output average: Number;
  average <- outer |> recover(-1.0);
}
\`\`\`
`;
const compile = () => compileSource(source, { filename: 'nested-provenance.ghost.md' });
const envelope = artifact => ({
  format: 'GhostFlow/source-map-v1', bytecodeSha256: artifact.manifest.bytecodeSha256,
  sourceDocument: artifact.sourceDocument, nodes: artifact.sourceMap,
  lines: artifact.extractionMap, traceMetadata: artifact.traceMetadata,
});

test('nested window metadata binds the immediate aggregate and transitive physical source', async () => {
  const artifact = await compile();
  const [inner, outer] = artifact.manifest.signals;
  const expected = [{ name: inner.name, site: inner.site, slot: inner.slot }];
  assert.deepEqual(outer.upstreamWindows, expected);
  assert.deepEqual(outer.sources, inner.sources);
  assert.deepEqual(artifact.traceMetadata.windowSites[1].upstreamWindows, expected);
  const dependencies = artifact.traceMetadata.dependencies.find(entry => entry.target.field === 'windowTrace' && entry.target.name === 'outer');
  assert.ok(dependencies.reads.some(read => read.field === 'windowTrace' && read.name === 'inner'));
  assert.doesNotThrow(() => restoreArtifactSourceMap(envelope(artifact), artifact.bytes));
});

test('canonical restoration rejects removed, rebound and forward nested evidence bindings', async () => {
  const artifact = await compile();
  for (const mutate of [
    map => { delete map.traceMetadata.windowSites[1].upstreamWindows; },
    map => { map.traceMetadata.windowSites[1].upstreamWindows[0].site++; },
    map => { map.traceMetadata.windowSites[1].upstreamWindows[0].slot = 1; },
    map => { map.traceMetadata.windowSites[1].upstreamWindows[0].name = 'outer'; },
    map => { map.traceMetadata.windowSites[1].upstreamWindows = []; },
  ]) {
    const candidate = structuredClone(envelope(artifact));
    mutate(candidate);
    assert.throws(() => restoreArtifactSourceMap(candidate, artifact.bytes), /window|evidence/i);
  }
});

function traceWithProof(artifact) {
  const [inner, outer] = artifact.manifest.signals;
  const tag = inner.sources[0].tag;
  const physical = (id, timestampMs, value) => ({ sourceTag: tag, epoch: 5, id, timestampMs, value });
  const leaf = (...args) => ({ kind: 'physical', ...physical(...args), suppliedValue: args[2], childCount: 0, subtreeSize: 1 });
  const aggregate = (revision, timestampMs, value, count) => ({ kind: 'derived', site: inner.site,
    timeEpoch: 5, admissionRevision: revision, timestampMs, evaluatedAtMs: timestampMs,
    value, suppliedValue: value, operation: 'average', childCount: count, subtreeSize: count + 1 });
  const derived = (revision, timestampMs, value, proofRoot) => ({ kind: 'derived', site: inner.site,
    timeEpoch: 5, admissionRevision: revision, timestampMs, evaluatedAtMs: timestampMs, value, proofRoot });
  const record = (site, value, contributors) => ({ site: site.site, payloadType: 'number', operation: 'average',
    value, quality: 3, count: contributors.length, admissionRevision: 3, timeEpoch: 5, nowMs: 2,
    first: contributors[0], last: contributors.at(-1), contributors, upstreamFault: null });
  return {
    module: artifact.traceMetadata.moduleFingerprint,
    safetyTrace: { format: 'GhostFlow/safety-trace-v1', constraints: [] }, resultTrace: [],
    windowTrace: [record(inner, 15, [physical(2, 1, 10), physical(3, 2, 20)]), {
      ...record(outer, 20 / 3, [derived(1, 0, 0, 0), derived(2, 1, 5, 2), derived(3, 2, 15, 5)]),
      proof: [aggregate(1, 0, 0, 1), leaf(1, 0, 0), aggregate(2, 1, 5, 2), leaf(1, 0, 0), leaf(2, 1, 10),
        aggregate(3, 2, 15, 2), leaf(2, 1, 10), leaf(3, 2, 20)],
    }],
  };
}

test('nested trace observation preserves aggregate identities and owned physical proofs', async () => {
  const artifact = await compile();
  const trace = traceWithProof(artifact);
  const observed = observeSourceTrace(artifact.traceMetadata, trace).windowEvents[1];
  assert.equal(observed.value, 20 / 3);
  assert.equal(observed.count, 3);
  assert.deepEqual(observed.contributors.map(point => [point.site, point.admissionRevision]),
    [1, 2, 3].map(revision => [artifact.manifest.signals[0].site, revision]));
  assert.equal(observed.proof.length, 8);
  assert.equal(observed.proof[0].value, 0);
});

test('mapped aggregate evidence keeps the original aggregate and supplied edge values distinct', async () => {
  const mapped = source
    .replace('control NestedProvenance {', 'fn fixed(value: Number) -> Number { 300.0 }\ncontrol NestedProvenance {')
    .replace('window_average(inner,', 'window_average(inner |> map(fixed),');
  const artifact = await compileSource(mapped, { filename: 'mapped-nested-provenance.ghost.md' });
  const trace = traceWithProof(artifact);
  const outer = trace.windowTrace[1];
  outer.value = 300;
  for (const point of outer.contributors) {
    point.value = 300;
    outer.proof[point.proofRoot].suppliedValue = 300;
  }
  const observed = observeSourceTrace(artifact.traceMetadata, trace).windowEvents[1];
  assert.equal(observed.value, 300);
  assert.deepEqual(observed.contributors.map(point => point.value), [300, 300, 300]);
  assert.deepEqual([0, 2, 5].map(index => observed.proof[index].value), [0, 5, 15]);
});

test('nested trace observation rejects malformed trees and rebound aggregate evidence', async () => {
  const artifact = await compile();
  for (const mutate of [
    trace => { delete trace.windowTrace[1].proof; },
    trace => { trace.windowTrace[1].proof[0].subtreeSize = 0; },
    trace => { trace.windowTrace[1].proof[0].childCount = 2; },
    trace => { trace.windowTrace[1].proof[0].site = artifact.manifest.signals[1].site; },
    trace => { trace.windowTrace[1].proof[0].suppliedValue = 7; },
    trace => { trace.windowTrace[1].proof[1].sourceTag++; },
    trace => { trace.windowTrace[1].proof[0].timestampMs = 1; },
    trace => { trace.windowTrace[1].proof[0].evaluatedAtMs = 3; },
    trace => { trace.windowTrace[1].proof.push({ ...trace.windowTrace[1].proof[1] }); },
  ]) {
    const trace = structuredClone(traceWithProof(artifact)); mutate(trace);
    assert.throws(() => observeSourceTrace(artifact.traceMetadata, trace), /window|proof|evidence/i);
  }
});
