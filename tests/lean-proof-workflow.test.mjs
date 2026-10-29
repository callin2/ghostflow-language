import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const workflowText = fs.readFileSync(new URL('../.github/workflows/lean-proof.yml', import.meta.url), 'utf8');
const workflow = parse(workflowText);
const expectedSuites = [
  ['bool-translation-validation', 'bool-pc-validation'],
  ['bool-sensor-validation', 'bool-sensor-validation'],
  ['bool-sensor-state-validation', 'bool-sensor-state-validation'],
  ['int32-codec-validation', 'int32-codec-validation'],
  ['two-sensor-provenance', 'two-sensor-provenance'],
  ['elapsed-epoch-validation', 'elapsed-epoch-validation'],
  ['elapsed-clock-bounds', 'elapsed-clock-bounds'],
  ['elapsed-duration-output', 'elapsed-duration-output'],
];
const expectedPaths = [
  '.github/workflows/lean-proof.yml',
  ...expectedSuites.map(([verifier]) => `experiments/${verifier}/**`),
  'experiments/lean-outcome.mjs',
  'tests/bool-translation-validation.test.mjs',
  'tests/bool-generated-certificates.test.mjs',
  'tests/bool-sensor-validation.test.mjs',
  'tests/bool-sensor-state-validation.test.mjs',
  'tests/int32-codec-validation.test.mjs',
  'tests/two-sensor-provenance.test.mjs',
  'tests/elapsed-epoch-validation.test.mjs',
  'tests/elapsed-clock-bounds.test.mjs',
  'tests/elapsed-duration-output.test.mjs',
  'tests/lean-outcome.test.mjs',
  'tests/lean-proof-workflow.test.mjs',
  'tools/**',
  'crates/ghostflow-core/src/**',
  'package.json',
  'package-lock.json',
];
const checkoutSha = "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";
const bridgeTests = 'node --test tests/bool-translation-validation.test.mjs tests/bool-generated-certificates.test.mjs tests/bool-sensor-validation.test.mjs tests/bool-sensor-state-validation.test.mjs tests/int32-codec-validation.test.mjs tests/lean-outcome.test.mjs tests/two-sensor-provenance.test.mjs tests/elapsed-epoch-validation.test.mjs tests/elapsed-clock-bounds.test.mjs tests/elapsed-duration-output.test.mjs tests/lean-proof-workflow.test.mjs';

test('Lean proof workflow preserves routing and runs eight isolated bounded suites', () => {
  assert.deepEqual(workflow.on.pull_request.paths, expectedPaths);
  assert.deepEqual(workflow.on.push.branches, ['main', 'dev']);
  assert.deepEqual(workflow.on.push.paths, expectedPaths);
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
  assert.deepEqual(workflow.permissions, { contents: 'read' });

  const matrix = workflow.jobs['lean-proofs'];
  assert.equal(matrix['runs-on'], 'ubuntu-24.04');
  assert.equal(matrix['timeout-minutes'], 30);
  assert.equal(matrix.strategy['fail-fast'], false);
  assert.equal(matrix.strategy['max-parallel'], 3);
  assert.deepEqual(matrix.strategy.matrix.include.map(({ verifier, evidence_dir }) => [verifier, evidence_dir]), expectedSuites);
  assert.equal(matrix.permissions, undefined, 'the matrix cannot override read-only workflow permissions');

  const checkout = matrix.steps.find(step => step.name === 'Checkout proof source');
  assert.match(checkout.uses, /^actions\/checkout@[0-9a-f]{40}$/);
  assert.equal(checkout.with.ref, checkoutSha);
  assert.equal(checkout.with['persist-credentials'], false);
  const node = matrix.steps.find(step => step.name === 'Set up Node.js 22');
  assert.match(node.uses, /^actions\/setup-node@[0-9a-f]{40}$/);
  assert.equal(node.with['node-version'], 22);

  const prepare = matrix.steps.find(step => step.name === 'Prepare suite evidence directory');
  assert.ok(prepare.run.includes('setup.log'));
  assert.equal(prepare.env.PROOF_CHECKOUT_SHA, checkoutSha);
  const dependencies = matrix.steps.find(step => step.name === 'Install locked Node dependencies');
  assert.ok(dependencies.run.includes('npm ci --ignore-scripts'));
  assert.ok(dependencies.run.includes('build/${{ matrix.evidence_dir }}/npm-ci.log'));
  const lean = matrix.steps.find(step => step.name === 'Install pinned Lean 4.19.0');
  assert.ok(lean.run.includes('leanprover/lean4:v4.19.0'));
  assert.ok(lean.run.includes('build/${{ matrix.evidence_dir }}/lean-install.log'));
  const bridge = matrix.steps.find(step => step.name === 'Check proof bridge tests');
  assert.ok(bridge.run.includes(bridgeTests));
  const verifier = matrix.steps.find(step => step.name === 'Check suite with Lean kernel');
  assert.ok(verifier.run.includes('node "experiments/${{ matrix.verifier }}/verify.mjs"'));
  assert.ok(verifier.run.includes('--evidence-dir "build/${{ matrix.evidence_dir }}"'));

  const evidence = matrix.steps.find(step => step.name === 'Upload proof evidence even on failure');
  assert.equal(evidence.if, '${{ always() }}');
  assert.match(evidence.uses, /^actions\/upload-artifact@[0-9a-f]{40}$/);
  assert.ok(evidence.with.name.includes('${{ matrix.verifier }}'));
  assert.ok(evidence.with.name.includes(checkoutSha));
  assert.ok(evidence.with.name.includes('${{ github.run_id }}'));
  assert.ok(evidence.with.name.includes('${{ github.run_attempt }}'));
  assert.equal(evidence.with.path, 'build/${{ matrix.evidence_dir }}/');
  assert.equal(new Set(matrix.strategy.matrix.include.map(entry => entry.evidence_dir)).size, expectedSuites.length);

  for (const [suite] of expectedSuites) {
    assert.ok(fs.existsSync(new URL(`../experiments/${suite}/verify.mjs`, import.meta.url)), `${suite} verifier exists`);
  }
});

test('required proof check fails when any matrix suite fails, is cancelled, or is skipped', () => {
  const proof = workflow.jobs.proof;
  assert.equal(proof.name, 'proof');
  assert.deepEqual(proof.needs, ['lean-proofs']);
  assert.equal(proof.if, '${{ always() }}');
  const gate = proof.steps.find(step => step.name === 'Require every Lean proof suite to succeed');
  assert.equal(gate.env.LEAN_PROOFS_RESULT, '${{ needs.lean-proofs.result }}');

  for (const [result, expectedExit] of [['success', 0], ['failure', 1], ['cancelled', 1], ['skipped', 1]]) {
    const execution = spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', gate.run], {
      encoding: 'utf8', env: { ...process.env, LEAN_PROOFS_RESULT: result },
    });
    assert.equal(execution.status, expectedExit, `${result}: ${execution.stderr}`);
  }
});
