#!/usr/bin/env node
// Transport existing host-verification evidence; this does not run a compiler.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertVerificationSources } from './verification-sources.mjs';

const WASM_PATH = 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm';
const WASM_COMMAND = ['cargo', 'build', '--locked', '--offline', '-p',
  'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateVerificationReport(report, binary) {
  if (report?.format !== 'GhostFlow/language-verification-v1' ||
      report.scope !== 'language-host' || report.passed !== true) {
    throw new Error('a successful full language-host report is required');
  }
  if (!Array.isArray(report.gates) || !report.gates.length ||
      report.gates.some(gate => gate.passed !== true || gate.status !== 0 || gate.error || gate.signal)) {
    throw new Error('all verification gates must have succeeded');
  }
  if (!report.gates.some(gate => JSON.stringify(gate.command) === JSON.stringify(WASM_COMMAND))) {
    throw new Error('the full report must include the locked, offline release WASM build');
  }
  if (report.wasm?.builtByThisRun !== true || report.wasm.bytes !== binary.bytes ||
      report.wasm.sha256 !== binary.sha256 || !/^[0-9a-f]{64}$/.test(binary.sha256)) {
    throw new Error('WASM bytes do not match the artifact built by this verification');
  }
  for (const key of ['node', 'rustc', 'cargo']) {
    if (typeof report[key] !== 'string' || !report[key]) throw new Error(`missing ${key} version`);
  }
  for (const name of ['Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json']) {
    if (!/^[0-9a-f]{64}$/.test(report.sourceSha256?.[name] ?? '')) {
      throw new Error(`missing source hash: ${name}`);
    }
  }
}

function command(cwd, executable, args) {
  return execFileSync(executable, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function checkout(root) {
  if (fs.realpathSync(command(root, 'git', ['rev-parse', '--show-toplevel'])) !== root) {
    throw new Error('source must be the root of a real checkout');
  }
  if (command(root, 'git', ['status', '--porcelain', '--untracked-files=normal'])) {
    throw new Error('checkout contains modified or untracked source');
  }
  return {
    commit: command(root, 'git', ['rev-parse', 'HEAD']),
    tree: command(root, 'git', ['rev-parse', 'HEAD^{tree}']),
  };
}

function sourceFile(root, relative) {
  if (path.posix.normalize(relative) !== relative || path.isAbsolute(relative) ||
      relative.startsWith('../') || relative.includes('\\')) throw new Error('invalid source path');
  const absolute = path.join(root, relative);
  if (fs.realpathSync(absolute) !== absolute || !fs.lstatSync(absolute).isFile()) {
    throw new Error(`source must be a regular file: ${relative}`);
  }
  return fs.readFileSync(absolute);
}

export async function packageVerifiedWasm(source, destination) {
  const root = fs.realpathSync(source);
  const ciRoot = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)));
  const sourceIdentity = checkout(root);
  const ciIdentity = checkout(ciRoot);
  const repository = process.env.GITHUB_REPOSITORY;
  if (repository !== 'callin2/ghostflow-language' || process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('this handoff is produced by ghostflow-language GitHub Actions only');
  }
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) {
    if (!/^\d+$/.test(process.env[key] ?? '')) throw new Error(`missing CI identity: ${key}`);
  }
  if (!process.env.GITHUB_WORKFLOW_REF || !/^[0-9a-f]{40}$/.test(process.env.GITHUB_WORKFLOW_SHA ?? '')) {
    throw new Error('missing immutable workflow identity');
  }
  const reportBytes = sourceFile(root, 'build/verification.json');
  const report = JSON.parse(reportBytes);
  const bytes = sourceFile(root, WASM_PATH);
  const binary = { path: 'ghostflow_wasm.wasm', bytes: bytes.length, sha256: sha256(bytes) };
  validateVerificationReport(report, binary);
  // Old pinned source has no build hooks. Do not retrofit its immutable identity.
  if (fs.existsSync(path.join(root, 'scripts/build-language-with-identity.mjs'))) {
    const issued = JSON.parse(sourceFile(root, 'build/build-identity.json'));
    if (issued.wasmSha256 !== binary.sha256 || issued.identity?.sourceSHA !== sourceIdentity.commit ||
        JSON.stringify(issued.identity) !== JSON.stringify(report.buildIdentity)) {
      throw new Error('WASM build identity does not match actual verified bytes/source');
    }
  }
  assertVerificationSources(root, report.sourceSha256);
  // Validate the actual module, without substituting an injected ABI or a mock.
  await WebAssembly.compile(bytes);
  const toolchain = {
    node: process.version,
    npm: command(root, 'npm', ['--version']),
    rustc: command(root, 'rustc', ['--version']),
    cargo: command(root, 'cargo', ['--version']),
    rustcVerbose: command(root, 'rustc', ['--version', '--verbose']),
  };
  for (const key of ['node', 'rustc', 'cargo']) {
    if (toolchain[key] !== report[key]) throw new Error(`${key} changed since verification`);
  }
  const manifest = {
    format: 'GhostFlow/verified-wasm-artifact-v1',
    source: { repository, ...sourceIdentity, cargoLockSha256: sha256(sourceFile(root, 'Cargo.lock')) },
    binary,
    buildIdentity: report.buildIdentity ?? null,
    verification: { path: 'verification.json', sha256: sha256(reportBytes), scope: report.scope },
    toolchain,
    build: { command: ['npm', 'test'], target: 'wasm32-unknown-unknown', profile: 'release' },
    ci: {
      repository, commit: ciIdentity.commit,
      workflowRef: process.env.GITHUB_WORKFLOW_REF,
      workflowSha: process.env.GITHUB_WORKFLOW_SHA,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      runUrl: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`,
    },
  };
  // A fresh directory prevents old successful bytes from surviving a failed run.
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, binary.path), bytes, { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'verification.json'), reportBytes, { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${sourceIdentity.commit}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) {
    console.error('usage: node tools/package-verified-wasm.mjs <source-checkout> <new-output-directory>');
    process.exitCode = 2;
  } else {
    try {
      const manifest = await packageVerifiedWasm(process.argv[2], process.argv[3]);
      console.log(`${manifest.source.commit}: ${manifest.binary.sha256}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
