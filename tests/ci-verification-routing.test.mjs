import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyChanges, verificationResult } from '../tools/ci-verification-routing.mjs';

function repository(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-routing-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.name', 'Routing test'); git('config', 'user.email', 'routing@example.invalid');
  const write = (name, content = 'doc\n') => { fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true }); fs.writeFileSync(path.join(cwd, name), content); };
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  write('README.md'); write('docs/SPEC.md'); const base = commit();
  const classify = (before, after, eventName = 'push') => classifyChanges({ cwd, eventName, sha: after, event: eventName === 'pull_request' ? { pull_request: { base: { sha: before }, head: { sha: after } } } : { before } });
  return { cwd, git, write, commit, base, classify };
}

test('ordinary docs additions, edits, deletions and allowlisted renames use docs', t => {
  const r = repository(t);
  r.write('README.md', 'changed'); r.write('docs/assets/readme-hero.svg');
  let head = r.commit(); assert.equal(r.classify(r.base, head), 'docs');
  r.git('mv', 'README.md', 'README.ko.md');
  const renamed = r.commit(); assert.equal(r.classify(head, renamed), 'docs');
  r.git('rm', 'README.ko.md'); head = r.commit(); assert.equal(r.classify(renamed, head), 'docs');
});

test('mixed, executable markdown, policy, unknown paths and both rename directions use full', t => {
  const r = repository(t);
  for (const name of ['examples/pump.ghost.md', 'docs/SPEC.md', 'AGENTS.md', 'tools/a.mjs', 'odd\nname.md']) {
    const before = r.git('rev-parse', 'HEAD');
    r.write('README.md', name); r.write(name, 'changed'); const head = r.commit();
    assert.equal(r.classify(before, head), 'full', name);
  }
  const beforeRename = r.git('rev-parse', 'HEAD');
  r.git('mv', 'README.md', 'unknown.md'); const head = r.commit();
  assert.equal(r.classify(beforeRename, head), 'full');
  r.git('mv', 'unknown.md', 'README.md'); const back = r.commit();
  assert.equal(r.classify(head, back), 'full');
});

test('symlinks and executable mode changes never qualify as docs', t => {
  const r = repository(t); fs.chmodSync(path.join(r.cwd, 'README.md'), 0o755);
  const executable = r.commit(); assert.equal(r.classify(r.base, executable), 'full');
  fs.unlinkSync(path.join(r.cwd, 'README.md')); fs.symlinkSync('docs/SPEC.md', path.join(r.cwd, 'README.md'));
  const linked = r.commit(); assert.equal(r.classify(executable, linked), 'full');
  r.git('rm', 'README.md'); assert.equal(r.classify(linked, r.commit()), 'full');
});

test('PR compares merge-base; push compares exact before; manual and unresolved inputs use full', t => {
  const r = repository(t); r.git('checkout', '-qb', 'topic'); r.write('README.md', 'topic'); const head = r.commit();
  r.git('checkout', '-q', '-'); r.write('docs/SPEC.md', 'base advanced'); const tip = r.commit();
  assert.equal(r.classify(tip, head, 'pull_request'), 'docs');
  assert.equal(r.classify(tip, head), 'full');
  assert.equal(r.classify(head, head), 'full');
  assert.equal(r.classify('0'.repeat(40), head), 'full');
  assert.equal(r.classify('f'.repeat(40), head), 'full');
  assert.equal(r.classify('--bad', head), 'full');
  assert.equal(r.classify(r.base, head, 'workflow_dispatch'), 'full');
  assert.equal(classifyChanges({ cwd: r.cwd, eventName: 'pull_request', event: {} }), 'full');
  r.git('checkout', '--orphan', 'unrelated'); r.git('rm', '-rf', '.'); r.write('README.md'); const unrelated = r.commit();
  assert.equal(r.classify(unrelated, head, 'pull_request'), 'full');
});

const pair = (source = 'README.md', translation = 'README.ko.md') => ({ source, translation, sourceLanguage: 'en', sourceSha256: 'a'.repeat(64), translationSha256: 'b'.repeat(64) });
test('translation metadata allows only ordinary pair hashes/addition/removal', t => {
  const r = repository(t);
  const manifest = { format: 'GhostFlow/document-translations-v1', documents: [pair(), pair('docs/SPEC.md', 'docs/SPEC.ko.md')], exclusions: [] };
  r.write('docs/translations.json', JSON.stringify(manifest)); const before = r.commit();
  const check = (next, expected) => { r.write('docs/translations.json', typeof next === 'string' ? next : JSON.stringify(next)); const head = r.commit(); assert.equal(r.classify(before, head), expected); };
  const changed = structuredClone(manifest); changed.documents[0].sourceSha256 = 'c'.repeat(64); check(changed, 'docs');
  check({ ...manifest, documents: [manifest.documents[1]] }, 'docs');
  check({ ...manifest, documents: [...manifest.documents, pair('CONTRIBUTING.md', 'CONTRIBUTING.ko.md')] }, 'docs');
  const spec = structuredClone(manifest); spec.documents[1].sourceSha256 = 'c'.repeat(64); check(spec, 'full');
  check({ ...manifest, exclusions: ['new policy'] }, 'full');
  check({ ...manifest, exclusions: [{ path: 'report.md', reason: 'Historical report' }] }, 'full');
  check({ ...manifest, format: 'changed' }, 'full');
  const extra = structuredClone(manifest); extra.documents[0].policy = true; check(extra, 'full');
  check('{broken', 'full');
  const malformedBase = r.git('rev-parse', 'HEAD'); r.write('docs/translations.json', JSON.stringify(manifest)); assert.equal(r.classify(malformedBase, r.commit()), 'full');
  assert.equal(r.classify(r.base, r.git('rev-parse', 'HEAD')), 'full');
});

test('final gate requires successful classifier and selected lane; skipped other lane is expected', () => {
  for (const mode of ['docs', 'full']) {
    const valid = { classify: { result: 'success', outputs: { mode } }, docs: { result: mode === 'docs' ? 'success' : 'skipped' }, verify: { result: mode === 'full' ? 'success' : 'skipped' } };
    assert.doesNotThrow(() => verificationResult(valid));
    for (const failure of ['failure', 'cancelled', 'skipped', undefined]) {
      const badClassifier = structuredClone(valid); badClassifier.classify.result = failure; assert.throws(() => verificationResult(badClassifier));
      const badLane = structuredClone(valid); badLane[mode === 'docs' ? 'docs' : 'verify'].result = failure; assert.throws(() => verificationResult(badLane));
    }
    for (const unknown of ['', 'unknown', undefined]) { const bad = structuredClone(valid); bad.classify.outputs.mode = unknown; assert.throws(() => verificationResult(bad)); }
    for (const failure of ['failure', 'cancelled', undefined]) {
      const bad = structuredClone(valid); bad[mode === 'docs' ? 'verify' : 'docs'].result = failure;
      assert.throws(() => verificationResult(bad));
    }
    const bothSuccessful = structuredClone(valid); bothSuccessful[mode === 'docs' ? 'verify' : 'docs'].result = 'success';
    assert.doesNotThrow(() => verificationResult(bothSuccessful));
  }
  assert.throws(() => verificationResult({}));
});

test('workflow always triggers, routes both lanes, and preserves full verification steps', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/verified-wasm.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /paths-ignore:|\n\s+paths:/);
  assert.match(workflow, /pull_request:\n/); assert.match(workflow, /workflow_dispatch:\n/);
  const section = name => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  \w+:\n/)[0];
  const classifier = section('classify'), docs = section('docs'), verify = section('verify'), result = section('result');
  assert.match(classifier, /fetch-depth: 0/);
  assert.match(classifier, /mode: \$\{\{ steps.route.outputs.mode \}\}/);
  for (const [lane, mode] of [[docs, 'docs'], [verify, 'full']]) {
    assert.match(lane, /needs: classify/);
    assert.ok(lane.includes(`if: \${{ needs.classify.outputs.mode == '${mode}' }}`));
  }
  assert.match(docs, /npm ci --ignore-scripts/); assert.match(docs, /npm run docs:check/);
  assert.match(docs, /node --test tests\/ci-verification-routing.test.mjs tests\/doc-index.test.mjs/);
  assert.doesNotMatch(docs, /rustup|cargo|coverage|npm test|upload-artifact/);
  for (const command of ['run: npm test', 'run: npm run test:coverage', 'node ci/tools/package-verified-wasm.mjs source handoff', 'Upload failure verification report']) assert.ok(verify.includes(command));
  assert.match(result, /needs: \[classify, docs, verify\]/);
  assert.match(result, /if: \$\{\{ always\(\) \}\}/);
  assert.match(result, /VERIFICATION_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(result, /node tools\/ci-verification-routing.mjs result/);
  for (const action of workflow.matchAll(/uses: actions\/\S+@(\S+)/g)) assert.match(action[1], /^[0-9a-f]{40}$/);
  for (const action of workflow.matchAll(/uses: Swatinem\/\S+@(\S+)/g)) assert.match(action[1], /^[0-9a-f]{40}$/);
  assert.match(verify, /workspaces: source -> target/);
  assert.match(verify, /key: \$\{\{ matrix.label \}\}/);
  assert.doesNotMatch(verify, /cache-all-crates: true|cache-workspace-crates: true|cache-directories:|lookup-only: true/);
  const verifier = fs.readFileSync(new URL('../tools/verify-language.mjs', import.meta.url), 'utf8');
  assert.ok(verifier.includes("'tests/ci-verification-routing.test.mjs'"));
});

test('workflow cancels obsolete heads only within the same PR', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/verified-wasm.yml', import.meta.url), 'utf8');
  const concurrency = workflow.split('\nconcurrency:\n')[1]?.split('\njobs:\n')[0];
  assert.ok(concurrency.includes('github.workflow'));
  assert.ok(concurrency.includes('github.event_name'));
  assert.ok(concurrency.includes('github.event.pull_request.number || github.run_id'));
  assert.match(concurrency, /cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/);
});

test('requirement-catalog corruption fails static preflight before native work', () => {
  const verifier = fs.readFileSync(new URL('../tools/verify-language.mjs', import.meta.url), 'utf8');
  assert.match(verifier, /import \{ readCatalog, validateCatalog \} from '\.\.\/contracts\/requirements\/validate\.mjs'/);
  const preflight = verifier.indexOf('validateCatalog(readCatalog({ root }), { root });');
  assert.ok(preflight > verifier.indexOf('  try {'));
  assert.ok(preflight < verifier.indexOf('await verifyPlcCurriculum();'));
  assert.ok(preflight < verifier.indexOf("await gate('cargo'"));
});
