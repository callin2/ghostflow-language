import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { decode, encode } from '@toon-format/toon';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpus = path.join(root, 'examples/authoring/corpus');
const manifestPath = path.join(corpus, 'manifest.json');
const baselinePath = path.join(root, 'docs/LLM-AUTHORING-EFFICIENCY-BASELINE-2026-09-23.json');
const work = path.join(root, 'build/authoring-efficiency-corpus');
const sha256 = value => createHash('sha256').update(value).digest('hex');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  }).sort();
}

function run(script, args, { input, cwd = root, env = process.env } = {}) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd, env, input, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function sourceRequest(operation, sourcePath, identity, artifactPath) {
  return {
    format: 'GhostFlow/cli-request-v1', operation,
    source: { path: sourcePath, documentId: identity.documentId, revisionId: identity.revisionId },
    ...(artifactPath ? { artifactPath } : {}),
  };
}

function invokeGhostc(request) {
  const requestPath = path.join(work, 'request.toon');
  fs.writeFileSync(requestPath, encode(request));
  const result = run('tools/ghostc.mjs', ['--request', path.relative(root, requestPath)]);
  return { ...result, decoded: result.stdout ? decode(result.stdout, { strict: true }) : null };
}

function countTokens(payloads) {
  const code = [
    'import importlib.metadata, json, sys, tiktoken',
    'value = json.load(sys.stdin)',
    'assert importlib.metadata.version("tiktoken") == "0.12.0"',
    'encoder = tiktoken.get_encoding("cl100k_base")',
    'print(json.dumps({"version": importlib.metadata.version("tiktoken"), "counts": {name: {"toon": len(encoder.encode(item["toon"])), "json": len(encoder.encode(item["json"]))} for name, item in value.items()}}, sort_keys=True))',
  ].join('; ');
  const result = spawnSync('python3', ['-c', code], {
    cwd: root, env: process.env, input: JSON.stringify(payloads), encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stderr}\nInstall tiktoken==0.12.0 before requesting a token recount.`);
  return JSON.parse(result.stdout);
}

test('offline authoring corpus records bounded retrieval, compilation, correction, and simulation evidence', t => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  const report = {
    format: 'GhostFlow/authoring-efficiency-baseline-v1',
    sourceRevision: {
      ...manifest.sourceRevision,
      toolchainFiles: manifest.sourceRevision.toolchainFiles.map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(root, file))) })),
      packageLockSha256: sha256(fs.readFileSync(path.join(root, 'package-lock.json'))),
      scenarioRunnerSha256: sha256(fs.readFileSync(path.join(root, 'crates/ghostflow-core/examples/scenario_scan.rs'))),
      rustCoreTreeSha256: sha256(filesUnder(path.join(root, 'crates/ghostflow-core/src'))
        .map(file => `${path.relative(root, file)}\0${sha256(fs.readFileSync(file))}`).join('\n')),
    },
    encoder: { name: '@toon-format/toon', version: '4.1.1' },
    tokenizer: { name: 'cl100k_base', package: 'tiktoken', version: '0.12.0' },
    cases: [],
  };
  const tokenPayloads = {};
  const referenceSourceDigests = new Set();

  for (const item of manifest.cases) {
    const retrieved = [];
    for (const sectionId of item.referenceSections) {
      const request = encode({ operation: 'lookup', sectionId, budgetBytes: 1000000 });
      const result = run('tools/reference-query.mjs', ['--toon-request', '-'], { input: request });
      assert.equal(result.status, 0, result.stderr);
      const decoded = decode(result.stdout, { strict: true });
      assert.equal(decoded.status, 'ok');
      assert.deepEqual(decoded.sections.map(section => section.id), [sectionId]);
      referenceSourceDigests.add(decoded.sourceDigest);
      retrieved.push({ id: sectionId, bytes: decoded.sections[0].bytes, responseBytes: Buffer.byteLength(result.stdout), digest: decoded.sections[0].digest });
    }

    const sourcePath = path.posix.join('build/authoring-efficiency-corpus', `${item.id}.ghost.md`);
    const absoluteSource = path.join(root, sourcePath);
    const artifactPath = path.posix.join('build/authoring-efficiency-corpus', `${item.id}.gfb`);
    let compileRounds = 0;
    let correctionRounds = 0;
    let simulationRounds = 0;
    const attempts = [];
    let finalResult;

    for (const revision of item.revisions) {
      const source = fs.readFileSync(path.join(corpus, revision.file));
      fs.writeFileSync(absoluteSource, source);
      const identity = { documentId: item.documentId, revisionId: revision.revisionId };
      const checked = invokeGhostc(sourceRequest('check', sourcePath, identity));
      compileRounds += 1;
      assert.equal(checked.status, revision.expectedExit, `${item.id}/${revision.revisionId}: ${checked.stderr || checked.stdout}`);
      assert.equal(checked.decoded.source.documentId, item.documentId);
      assert.equal(checked.decoded.source.revisionId, revision.revisionId);
      assert.equal(checked.decoded.source.sha256, sha256(source));
      if (revision.expectedDiagnostic) {
        assert.equal(checked.decoded.diagnostics[0].code, revision.expectedDiagnostic);
        assert.equal(checked.decoded.diagnostics[0].span.file, sourcePath);
        tokenPayloads.diagnostic ??= checked.decoded;
      } else {
        assert.equal(checked.decoded.ok, true);
      }
      attempts.push({
        ...identity, sha256: sha256(source), result: checked.decoded.ok ? 'checked' : 'diagnostic',
        diagnosticBytes: revision.expectedDiagnostic ? Buffer.byteLength(checked.stdout) : 0,
      });
      finalResult = checked.decoded;
      if (revision.corrects) correctionRounds += 1;
    }
    if (attempts.length > 1) {
      assert.ok(attempts.every(attempt => attempt.documentId === item.documentId));
      assert.equal(new Set(attempts.map(attempt => attempt.sha256)).size, attempts.length);
      assert.equal(new Set(attempts.map(attempt => attempt.revisionId)).size, attempts.length);
    }

    if (['compiled', 'compiled_after_one_correction', 'compiled_with_open_assumption', 'simulated'].includes(item.outcome)) {
      const finalRevision = item.revisions.at(-1);
      const identity = { documentId: item.documentId, revisionId: finalRevision.revisionId };
      const compiled = invokeGhostc(sourceRequest('compile', sourcePath, identity, artifactPath));
      compileRounds += 1;
      assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
      assert.equal(compiled.decoded.ok, true);
      assert.equal(compiled.decoded.source.sha256, attempts.at(-1).sha256);
      finalResult = compiled.decoded;
    }

    let simulationResultBytes = 0;
    let scenarioIdentity = null;
    if (item.outcome === 'simulated') {
      const scenarioPath = path.join(corpus, item.scenario);
      const scenarioBytes = fs.readFileSync(scenarioPath);
      const simulated = run('tools/ghostsim.mjs', [artifactPath, scenarioPath]);
      assert.equal(simulated.status, 0, simulated.stderr);
      const result = decode(simulated.stdout, { strict: true });
      assert.equal(result.outcome, 'completed');
      assert.equal(result.scenario.sha256, sha256(scenarioBytes));
      assert.deepEqual(result.artifact.sourceIdentity, { documentId: item.documentId, revisionId: item.revisions.at(-1).revisionId });
      assert.deepEqual(result.scans.map(scan => scan.safeVirtualIntent.pump), item.expectedSafePump);
      simulationRounds += 1;
      simulationResultBytes = Buffer.byteLength(simulated.stdout);
      scenarioIdentity = result.scenario;
      tokenPayloads.simulation = result;
    }

    if (item.expectedFinalDiagnostic) assert.equal(finalResult.diagnostics[0].code, item.expectedFinalDiagnostic);
    if (item.openAssumption) {
      const latest = fs.readFileSync(absoluteSource, 'utf8');
      assert.match(latest, /kind=assumption status=unconfirmed/u);
      assert.match(latest, /maximum run duration/u);
      assert.doesNotMatch(latest, /config\s+\w+:\s*Duration/u);
    }
    report.cases.push({
      id: item.id, intendedRule: item.intendedRule, referenceSections: retrieved,
      referenceChunks: retrieved.length,
      referenceContentBytes: retrieved.reduce((sum, section) => sum + section.bytes, 0),
      referenceResponseBytes: retrieved.reduce((sum, section) => sum + section.responseBytes, 0),
      sourceIdentity: attempts,
      scenarioIdentity,
      compileRounds, correctionRounds, simulationRounds,
      diagnosticBytes: attempts.reduce((sum, attempt) => sum + attempt.diagnosticBytes, 0),
      simulationResultBytes,
      outcome: item.outcome,
      boundary: item.boundary,
      equivalenceChecks: {
        compilerOutcomeMatched: true,
        sourceIdentityPreserved: attempts.every(attempt => attempt.documentId === item.documentId),
        revisionDigestsDistinct: attempts.length < 2 || new Set(attempts.map(attempt => attempt.sha256)).size === attempts.length,
        safeIntentMatched: item.expectedSafePump ? simulationRounds === 1 : null,
        openAssumptionPreserved: item.openAssumption ?? false,
      },
    });
  }

  report.tokenComparisons = baseline.tokenComparisons;
  if (process.env.GF_AUTHORING_RECOMPUTE_TOKENS === '1') {
    const tokenizer = countTokens(Object.fromEntries(Object.entries(tokenPayloads).map(([name, payload]) => ({
      [name]: { toon: encode(payload), json: JSON.stringify(payload) },
    })).flatMap(Object.entries)));
    report.tokenizer.version = tokenizer.version;
    report.tokenComparisons = Object.fromEntries(Object.entries(tokenPayloads).map(([name, payload]) => ({
      [name]: {
        toonBytes: Buffer.byteLength(encode(payload)), jsonBytes: Buffer.byteLength(JSON.stringify(payload)),
        toonTokens: tokenizer.counts[name].toon, jsonTokens: tokenizer.counts[name].json,
      },
    })).flatMap(Object.entries));
  }

  report.totals = report.cases.reduce((totals, item) => ({
    referenceChunks: totals.referenceChunks + item.referenceChunks,
    referenceContentBytes: totals.referenceContentBytes + item.referenceContentBytes,
    referenceResponseBytes: totals.referenceResponseBytes + item.referenceResponseBytes,
    compileRounds: totals.compileRounds + item.compileRounds,
    correctionRounds: totals.correctionRounds + item.correctionRounds,
    simulationRounds: totals.simulationRounds + item.simulationRounds,
    diagnosticBytes: totals.diagnosticBytes + item.diagnosticBytes,
    simulationResultBytes: totals.simulationResultBytes + item.simulationResultBytes,
  }), {
    referenceChunks: 0, referenceContentBytes: 0, referenceResponseBytes: 0,
    compileRounds: 0, correctionRounds: 0, simulationRounds: 0,
    diagnosticBytes: 0, simulationResultBytes: 0,
  });

  assert.equal(report.cases.length, 7);
  assert.equal(referenceSourceDigests.size, 1);
  report.sourceRevision.referenceSourceDigest = [...referenceSourceDigests][0];
  report.sourceRevision.digest = sha256(JSON.stringify({
    ...report.sourceRevision,
    digest: undefined,
  }));
  assert.ok(report.cases.every(item => item.referenceChunks > 0));
  assert.equal(report.cases.reduce((sum, item) => sum + item.simulationRounds, 0), 1);
  assert.deepEqual(report.totals, {
    referenceChunks: 15, referenceContentBytes: 33185, referenceResponseBytes: 41465,
    compileRounds: 16, correctionRounds: 3, simulationRounds: 1,
    diagnosticBytes: 2044, simulationResultBytes: 1811,
  });
  assert.equal(report.tokenizer.version, '0.12.0');
  assert.equal(report.sourceRevision.digest, '3da5e81c5d10f74c3d46807be2aa20b8dd9cded68070b871c547852e221ea9fe');
  assert.equal(report.sourceRevision.referenceSourceDigest, 'sha256:8d3321241fd3bc7c731ed3ebf9d65f58dfe47427bb81137a41210d804624eea4');
  assert.deepEqual(report.tokenComparisons, {
    diagnostic: { toonBytes: 498, jsonBytes: 547, toonTokens: 176, jsonTokens: 174 },
    simulation: { toonBytes: 1810, jsonBytes: 1630, toonTokens: 581, jsonTokens: 506 },
  });
  assert.deepEqual(report, baseline);
  if (process.env.GF_AUTHORING_REPORT === '1') process.stdout.write(`AUTHORING_EFFICIENCY_REPORT=${JSON.stringify(report)}\n`);
});
