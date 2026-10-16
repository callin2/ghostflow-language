import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { encode } from '@toon-format/toon';

import { compileControl, ControlCompileError } from '../tools/control.mjs';
import { compileSource } from '../tools/browser-toolchain.mjs';

const hold = `syntax hold(start: Expr<Bool>, stop: Expr<Bool>, held: Expr<Bool>): Expr<Bool> {
  quote { !$(stop) && ($(start) || $(held)) }
}`;

const document = code => `# Macro purity boundary\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;

function assertCompileRejects(source, pattern) {
  assert.throws(() => compileControl(source), error => error instanceof ControlCompileError
    && pattern.test(error.message), `expected ${pattern} rejection`);
}

test('macro splice accepts runtime expressions as AST without reading them during expansion', () => {
  const compiled = compileControl(`${hold}
control RuntimeExpressionSplice {
  input start, stop: Bool;
  state running: Bool = false;
  output pump: Bool;
  running' = @hold(case start { ok(value) => value; fault(_) => false; }, case stop { ok(value) => value; fault(_) => true; }, running);
  pump <- running';
}`);
  assert.equal(compiled.manifest.name, 'RuntimeExpressionSplice');
  assert.ok(compiled.bytes.length > 0);
});

test('macro body cannot read runtime values directly while expanding', () => {
  assertCompileRejects(`
syntax capturesInput(x: Expr<Bool>): Expr<Bool> { quote { $(x) || start } }
control MacroRuntimeCapture {
  input start: Bool;
  output pump: Bool;
  pump <- @capturesInput(false);
}`, /syntax macro capturesInput cannot capture global start/);
});

test('macro grammar exposes no file, network or clock capability primitives', () => {
  for (const [name, expression, pattern] of [
    ['fileRead', 'readFile("outside.txt")', /unknown function readFile/],
    ['networkRead', 'fetch("https:\/\/example.invalid")', /unknown function fetch/],
    ['clockRead', 'now()', /unknown function now/],
  ]) {
    assertCompileRejects(`
syntax ${name}(): Expr<Bool> { quote { ${expression} } }
control CapabilityBoundary {
  output result: Bool;
  result <- @${name}();
}`, pattern);
  }
});

test('direct and indirect recursive macro expansion are rejected', () => {
  assertCompileRejects(`
syntax repeat(x: Expr<Bool>): Expr<Bool> { quote { @repeat($(x)) } }
control DirectMacroRecursion { output result: Bool; result <- @repeat(true); }
`, /recursive syntax macro repeat/);

  assertCompileRejects(`
syntax first(x: Expr<Bool>): Expr<Bool> { quote { @second($(x)) } }
syntax second(x: Expr<Bool>): Expr<Bool> { quote { @first($(x)) } }
control IndirectMacroRecursion { output result: Bool; result <- @first(true); }
`, /recursive syntax macro first/);
});

test('macro expansion has a bounded AST node budget', () => {
  const macros = ['syntax dup0(x: Expr<Bool>): Expr<Bool> { quote { $(x) || $(x) } }'];
  for (let index = 1; index <= 13; index += 1) {
    macros.push(`syntax dup${index}(x: Expr<Bool>): Expr<Bool> { quote { @dup${index - 1}($(x)) || @dup${index - 1}($(x)) } }`);
  }
  assertCompileRejects(`${macros.join('\n')}
control ExpansionBudget { output result: Bool; result <- @dup13(true); }
`, /function expansion exceeds 4096 node budget/);
});

test('canonical compileSource rejects macro impurity without calling host network hook', async () => {
  const previousFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => { fetchCalled = true; throw new Error('host fetch must not run'); };
  try {
    await assert.rejects(() => compileSource(document(`
syntax networkRead(): Expr<Bool> { quote { fetch("https://example.invalid") } }
control NoNetworkAtExpansion { output result: Bool; result <- @networkRead(); }
`), { filename: 'macro-purity.ghost.md' }), /unknown function fetch/);
    assert.equal(fetchCalled, false);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ghostc = path.join(root, 'tools/ghostc.mjs');

test('ghostc rejection emits no runtime artifact', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ghostflow-macro-purity-'));
  try {
    const sourcePath = path.join(directory, 'macro-purity.ghost.md');
    const artifactPath = path.join(directory, 'macro-purity.gfb');
    const requestPath = path.join(directory, 'request.toon');
    writeFileSync(sourcePath, document(`
syntax clockRead(): Expr<Bool> { quote { now() } }
control NoClockAtExpansion { output result: Bool; result <- @clockRead(); }
`));
    writeFileSync(requestPath, encode({
      format: 'GhostFlow/cli-request-v1', operation: 'compile',
      source: { path: sourcePath, documentId: 'macro-purity', revisionId: 'r1' }, artifactPath,
    }));
    const result = spawnSync(process.execPath, [ghostc, '--request', requestPath, '--format', 'json'], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /unknown function now/);
    assert.equal(existsSync(artifactPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
