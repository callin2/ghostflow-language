import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { differential } from '../experiments/bool-sensor-validation/differential.mjs';

test('actual Bool recovery preserves fault origin across native and WASM quality boundaries', async t => {
  const evidenceDir = await mkdtemp(join(tmpdir(), 'bool-sensor-runtime-'));
  t.after(() => rm(evidenceDir, { recursive: true, force: true }));
  const filename = 'experiments/bool-sensor-validation/fixtures/recover-false.ghost.md';
  const result = await differential({
    source: await readFile(new URL(`../${filename}`, import.meta.url), 'utf8'), filename, evidenceDir,
    wasmPath: fileURLToPath(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)),
    nativePath: fileURLToPath(new URL('../target/release/examples/run', import.meta.url)),
    provenance: { overallVerification: 'host gate in progress', identifiedBuild: false },
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.rawRailExecutions, 30);
  assert.equal(result.canonicalQualityExecutions, 20);
  assert.equal(result.rawBoundaryChecks, 7);
  assert.equal(result.qualityBoundaryChecks, 18);
  assert.equal(result.productionCorrespondenceProof, false);
});
