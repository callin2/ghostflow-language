import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource as compileInBrowser } from '../tools/browser-toolchain.mjs';
import { compileSource as compileInNode } from '../tools/toolchain.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'contracts/interaction-v0/examples/corpus.json'), 'utf8'));
const browserEntry = new URL('../tools/browser-toolchain.mjs', import.meta.url).href;
const runtimeSnapshotEntry = new URL('../tools/interaction-runtime-snapshot.mjs', import.meta.url).href;

function identityFor(fixture) {
  return {
    documentId: fixture.source.documentId,
    revisionId: fixture.source.revisionId,
  };
}

function comparable(result) {
  return { ...result, bytes: [...result.bytes] };
}

function withoutBytes(result) {
  const { bytes, ...remaining } = result;
  return remaining;
}

function nodeSha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function browserModuleGraph(entryPath, visited = new Set()) {
  const resolved = path.resolve(entryPath);
  if (visited.has(resolved)) return visited;
  visited.add(resolved);
  const source = fs.readFileSync(resolved, 'utf8');
  assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"]node:/, `${path.relative(root, resolved)} imports a Node builtin`);
  assert.doesNotMatch(source, /\bBuffer\b/, `${path.relative(root, resolved)} depends on Buffer`);
  for (const match of source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;
    browserModuleGraph(path.resolve(path.dirname(resolved), specifier), visited);
  }
  return visited;
}

test('browser public compiler graph contains no Node builtin or Buffer dependency', () => {
  const modules = browserModuleGraph(fileURLToPath(browserEntry));
  assert.ok(modules.has(path.join(root, 'tools/compile-source.mjs')));
  assert.ok(modules.has(path.join(root, 'tools/interaction-schema.mjs')));
  assert.ok(modules.has(path.join(root, 'tools/bound-resource-control.mjs')));
  const runtimeSnapshotModules = browserModuleGraph(fileURLToPath(runtimeSnapshotEntry));
  assert.ok(runtimeSnapshotModules.has(path.join(root, 'tools/interaction-runtime-snapshot.mjs')));
  assert.ok(runtimeSnapshotModules.has(path.join(root, 'tools/interaction-schema.mjs')));
  for (const entry of ['runtimes/wasm/control-runtime.mjs', 'tools/portable-package.mjs']) {
    assert.ok(browserModuleGraph(path.join(root, entry)).has(path.join(root, 'tools/int-settings.mjs')));
  }
  const boundModules = browserModuleGraph(path.join(root, 'runtimes/wasm/bound-resource-control.mjs'));
  assert.ok(boundModules.has(path.join(root, 'runtimes/wasm/framed-runtime.mjs')));
  assert.ok(boundModules.has(path.join(root, 'tools/bound-resource-control.mjs')));
});

test('shared SHA-256 matches Node across padding, UTF-8, binary, and source-limit inputs', () => {
  const samples = [
    '',
    ...[1, 55, 56, 63, 64, 65].map(length => 'a'.repeat(length)),
    '농장 🌱 일출 뒤 5분 급수',
    new Uint8Array([0, 1, 127, 128, 255, 0, 42]),
    'x'.repeat(1024 * 1024),
  ];
  for (const sample of samples) assert.equal(sha256Hex(sample), nodeSha256(sample));
});

test('browser and Node public compilers preserve canonical corpus results', async () => {
  for (const fixture of corpus.cases) {
    const source = fs.readFileSync(path.join(root, fixture.sourcePath), 'utf8');
    const options = {
      filename: path.basename(fixture.sourcePath),
      interactionSourceIdentity: identityFor(fixture),
    };
    const [browser, node] = await Promise.all([
      compileInBrowser(source, options),
      compileInNode(source, options),
    ]);
    assert.equal(Buffer.isBuffer(browser.bytes), false, `${fixture.caseId} browser bytes are Uint8Array`);
    assert.equal(Buffer.isBuffer(node.bytes), true, `${fixture.caseId} Node compatibility wrapper retains Buffer bytes`);
    assert.deepEqual(comparable(browser), comparable(node), `${fixture.caseId} has identical canonical output`);
  }
});

test('browser public compiler rejects non-literate product input', async () => {
  await assert.rejects(
    compileInBrowser('control Raw { output pump: Bool; pump <- false; }', { filename: 'raw.ghost' }),
    /canonical .ghost.md literate source/,
  );
  await assert.rejects(
    compileInBrowser('control Raw { output pump: Bool; pump <- false; }', { filename: 'raw.ghost.md' }),
    /no executable ghost code/,
  );
});

test('browser public compiler preserves literate diagnostic locations', async () => {
  const document = '# Invalid\n\n```ghost\ncontrol Broken {\n  output pump: Bool;\n  pump <- ;\n}\n```\n';
  const options = { filename: 'invalid.ghost.md' };
  const [browser, node] = await Promise.allSettled([
    compileInBrowser(document, options),
    compileInNode(document, options),
  ]);
  assert.equal(browser.status, 'rejected');
  assert.equal(node.status, 'rejected');
  assert.deepEqual(
    { message: browser.reason.message, filename: browser.reason.filename, line: browser.reason.line, column: browser.reason.column },
    { message: node.reason.message, filename: node.reason.filename, line: node.reason.line, column: node.reason.column },
  );
});

test('browser public compiler executes with Buffer unavailable', async () => {
  const fixture = corpus.cases[0];
  const source = fs.readFileSync(path.join(root, fixture.sourcePath), 'utf8');
  const options = {
    filename: path.basename(fixture.sourcePath),
    interactionSourceIdentity: identityFor(fixture),
  };
  const expected = await compileInBrowser(source, options);
  const script = [
    'globalThis.Buffer = undefined;',
    `const { compileSource } = await import(${JSON.stringify(browserEntry)});`,
    `const result = await compileSource(${JSON.stringify(source)}, ${JSON.stringify(options)});`,
    'process.stdout.write(JSON.stringify({ bytes: [...result.bytes], result: { ...result, bytes: undefined } }));',
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const actual = JSON.parse(child.stdout);
  assert.deepEqual(actual.bytes, [...expected.bytes]);
  assert.deepEqual(actual.result, withoutBytes(expected));
});

test('quality corpus migration preserves exact predecessor source snapshots', () => {
  const history = JSON.parse(fs.readFileSync(path.join(root,
    'tests/fixtures/history/issue531/consumer-fixtures.pre-input.json'), 'utf8'));
  assert.equal(history.baseCommit, '76501ff238694fe0e2979bc4f5b05366fc739426');
  assert.equal(history.documents.length, 5);
  for (const predecessor of history.documents) {
    assert.equal(sha256Hex(predecessor.text), predecessor.sha256, predecessor.path);
    assert.notEqual(sha256Hex(fs.readFileSync(path.join(root, predecessor.path))), predecessor.sha256,
      'migration is a new source revision, leaving the predecessor separately pinned');
  }
});

test('five-minute corpus explicitly distinguishes input faults, fresh restart and exact cutoff', async t => {
  const source = fs.readFileSync(path.join(root, corpus.cases[0].sourcePath), 'utf8');
  const artifact = await compileInBrowser(source, { filename: 'five-minute-watering.ghost.md' });
  const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  for (const failed of ['DI1', 'DI2', 'DI3']) {
    for (const quality of ['NotReady', 'Disconnected', 'Stale', 'Invalid']) await t.test(`${failed}/${quality}`, async () => {
      const runtime = await ControlRuntime.instantiateFramed(wasm, artifact);
      try {
        const scan = (nowMs, DI1, faults = {}) => {
          const samples = Object.fromEntries(Array.from({ length: 8 }, (_, n) => {
            const name = `DI${n + 1}`;
            return [name, { epoch: 1, id: nowMs + 1, timestampMs: nowMs,
              quality: faults[name] ?? 'Good', value: name === 'DI1' ? DI1 : false }];
          }));
          const outcome = runtime.step({ nowMs, samples });
          assert.equal(outcome.vm.safe.RO1, outcome.vm.safe.RO2, 'pump and valve remain in lockstep');
          return outcome;
        };
        assert.equal(scan(0, true).vm.safe.RO1, true, 'healthy initial high retains the existing first-start intent');
        assert.equal(scan(1, false, { [failed]: quality }).vm.safe.RO1, failed === 'DI1');
        assert.equal(scan(2, true).vm.safe.RO1, failed === 'DI1', 'held START cannot restart fault-stopped operation');
        assert.equal(scan(3, false).vm.safe.RO1, failed === 'DI1');
        assert.equal(scan(4, true).vm.safe.RO1, true);
        assert.equal(scan(5, true).vm.safe.RO1, true);
        assert.equal(scan(failed === 'DI1' ? 300001 : 300005, true).vm.safe.RO1, false,
          'source timer retains the exact five-minute cutoff');
      } finally { runtime.dispose(); }
    });
  }
});

test('descriptor corpus retains prior authored states on unavailable input without fabricating acquisition', async () => {
  const source = fs.readFileSync(path.join(root, corpus.cases[1].sourcePath), 'utf8');
  const artifact = await compileInBrowser(source, { filename: 'multiple-values.ghost.md' });
  const runtime = await ControlRuntime.instantiateFramed(fs.readFileSync(path.join(root,
    'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm')), artifact);
  try {
    const sample = (id, quality, value) => ({ epoch: 1, id, timestampMs: id, quality, value });
    runtime.step({ nowMs: 1, samples: { first_enable: sample(1, 'Good', true),
      second_enable: sample(1, 'Good', false), sample: sample(1, 'Good', 42) } });
    const failed = runtime.step({ nowMs: 2, samples: { first_enable: sample(2, 'Invalid', false),
      second_enable: sample(2, 'Disconnected', true), sample: sample(2, 'NotReady', 0) } });
    assert.deepEqual(failed.vm.safe, { first_output: true, second_output: false });
    assert.equal(failed.vm.stateAfter.quantity, 42);
    assert.equal(failed.sensors.sample.quality, 'NotReady');
  } finally { runtime.dispose(); }
});
