#!/usr/bin/env node
// Mutants are temporary siblings of control.mjs so its ./gfb1.mjs import remains real.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tools = path.join(root, 'tools');
const original = await fs.readFile(path.join(tools, 'control.mjs'), 'utf8');
const id = randomUUID();
const moduleName = `.output-contract-mutant-${id}.mjs`;
const probeName = `.output-contract-probe-${id}.mjs`;
const modulePath = path.join(tools, moduleName), probePath = path.join(tools, probeName);
const cases = [
  { name: 'initializer-reject', needle: "kind === 'output' && this.matches('=')", replacement: 'false', source: 'control Initializer { output pump: Bool = false; pump <- false; }', diagnostic: 'output declarations are type-only' },
  { name: 'missing-connection', needle: 'if (!output.expression) error(output.loc, `output ${output.name} requires exactly one connection (${output.name} <- expression;)`);', replacement: 'if (false) {}', source: 'control Missing { output pump: Bool; }', diagnostic: 'output pump requires exactly one connection' },
  { name: 'duplicate-connection', needle: 'if (output.expression) error(item.loc, `duplicate output connection ${item.name}`);', replacement: 'if (false) {}', source: 'control Duplicate { output pump: Bool; pump <- false; pump <- true; }', diagnostic: 'duplicate output connection pump' },
  { name: 'type-mismatch', needle: 'if (!sameType(value.type, output.type)) error(item.loc, `output ${item.name} must be ${output.type.kind}`);', replacement: 'if (false) {}', source: 'control Mismatch { output requested: Number; requested <- true; }', diagnostic: 'output requested must be Number' },
];

function replaceOnce(source, needle, replacement) { const first = source.indexOf(needle); if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) throw new Error(`mutation needle is not unique: ${needle}`); return source.slice(0, first) + replacement + source.slice(first + needle.length); }
function run(file) { return new Promise(resolve => { const child = spawn(process.execPath, [file], { cwd: root, stdio: 'ignore', timeout: 5_000 }); child.on('error', error => resolve({ status: null, signal: null, error: error.message })); child.on('close', (status, signal) => resolve({ status, signal, error: null })); }); }
function probeSource(source, diagnostic) { return `import assert from 'node:assert/strict';\nimport { compileControl, ControlCompileError } from './${moduleName}';\ntry {\n  assert.throws(() => compileControl(${JSON.stringify(source)}), error => error instanceof ControlCompileError && error.message.includes(${JSON.stringify(diagnostic)}));\n} catch (error) {\n  if (error instanceof assert.AssertionError) process.exitCode = 42;\n  else throw error;\n}\n`; }

const report = { format: 'GhostFlow/output-contract-mutation-v1', timeoutMs: 5_000, scope: 'four compiler output-declaration guards only', baselines: [], mutants: [], survivors: 0, infrastructureFailures: 0 };
try {
  await fs.writeFile(modulePath, original);
  for (const baseline of cases) {
    await fs.writeFile(probePath, probeSource(baseline.source, baseline.diagnostic));
    const baselineResult = await run(probePath);
    report.baselines.push({ name: baseline.name, result: baselineResult });
    if (baselineResult.status !== 0 || baselineResult.signal || baselineResult.error) throw new Error(`original output-contract probe did not pass: ${baseline.name}`);
  }
  for (const mutant of cases) {
    await fs.writeFile(modulePath, replaceOnce(original, mutant.needle, mutant.replacement));
    await fs.writeFile(probePath, probeSource(mutant.source, mutant.diagnostic));
    const result = await run(probePath);
    const infrastructureFailure = Boolean(result.signal || result.error) || ![0, 42].includes(result.status);
    const killed = !infrastructureFailure && result.status === 42;
    report.mutants.push({ name: mutant.name, killed, interrupted: Boolean(result.signal), infrastructureFailure, result });
    if (infrastructureFailure) report.infrastructureFailures++;
    else if (!killed) report.survivors++;
  }
  if (report.infrastructureFailures !== 0) throw new Error(`output-contract mutation infrastructure failures: ${report.infrastructureFailures}`);
  if (report.survivors !== 0) throw new Error(`output-contract mutation survivors: ${report.survivors}`);
  await fs.mkdir(path.join(root, 'build'), { recursive: true }); await fs.writeFile(path.join(root, 'build', 'mutation-output-contract.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await Promise.all([fs.rm(modulePath, { force: true }), fs.rm(probePath, { force: true })]); }
