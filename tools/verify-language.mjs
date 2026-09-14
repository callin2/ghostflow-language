#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractLiterate } from './literate.mjs';
import { compileSource } from './toolchain.mjs';

// Deliberately explicit. Product/LLM/device tests belong to other repositories.
export const LANGUAGE_TESTS = Object.freeze([
  'tests/boundary-conformance.test.mjs',
  'tests/compiler.test.mjs',
  'tests/constraints.test.mjs',
  'tests/coverage-edges.test.mjs',
  'tests/gfb1-browser.test.mjs',
  'tests/gfb1-golden.test.mjs',
  'tests/portable-package.test.mjs',
  'tests/control-host.test.mjs',
  'tests/framed-control-host.test.mjs',
  'tests/control.test.mjs',
  'tests/integration-contract.test.mjs',
  'tests/intent-anchor-map.test.mjs',
  'tests/ledger.test.mjs',
  'tests/literate.test.mjs',
  'tests/lesson.test.mjs',
  'tests/lesson-boundaries.test.mjs',
  'tests/source-trace.test.mjs',
  'tests/source-dependencies.test.mjs',
  'tests/policy.test.mjs',
  'tests/requirement-catalog.test.mjs',
  'tests/output-conformance.test.mjs',
  'tests/runtime-conformance.test.mjs',
  'tests/schedule.test.mjs',
  'tests/solar-control.test.mjs',
  'tests/solar-schedule.test.mjs',
  'tests/solar-scanframe-native-wasm.test.mjs',
  'tests/scheduled-admission.test.mjs',
  'tests/signals-wasm.test.mjs',
  'tests/scan-frame-wasm.test.mjs',
  'tests/scan-tape-parity.test.mjs',
  'tests/station-wasm.test.mjs',
  'tests/toolchain.test.mjs',
  'tests/operating-settings.test.mjs',
]);

const root = fileURLToPath(new URL('../', import.meta.url));
const PLC_CURRICULUM_CATALOG = 'examples/curriculum/catalog.json';
const PLC_CURRICULUM_IDS = Object.freeze([
  'PC-01', 'PC-02', 'PC-03', 'PC-04', 'PC-05',
  'PC-06', 'PC-07', 'PC-08', 'PC-09', 'PC-10',
]);
const PLC_CURRICULUM_IMPORTED_REPOSITORY = 'callin2/farm_studio_system';
const PLC_CURRICULUM_IMPORTED_REVISION = '056a1c88cdfe3276700f6b6a819b715370af20eb';
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !['--node-only', '--curriculum-only'].includes(args[0]))) {
  console.error('usage: node tools/verify-language.mjs [--node-only|--curriculum-only]');
  process.exitCode = 2;
} else {
  await verify(args[0] === '--node-only', args[0] === '--curriculum-only');
}

async function verify(nodeOnly, curriculumOnly) {
  const report = {
    format: 'GhostFlow/language-verification-v1',
    id: randomUUID(),
    scope: curriculumOnly ? 'plc-curriculum-only' : (nodeOnly ? 'language-node-only' : 'language-host'),
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    hardwareTested: false,
    llmTested: false,
    tests: [...LANGUAGE_TESTS],
    sourceSha256: {},
    gates: [],
    passed: false,
  };
  const env = { ...process.env, CARGO_TARGET_DIR: path.join(root, 'target'), CARGO_NET_OFFLINE: 'true' };
  // Retained tests/tutorial use host target/debug and the explicit WASM target.
  delete env.CARGO_BUILD_TARGET;
  const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
  const nativePath = path.join(root, 'target/release/examples/run');
  const framedNativePath = path.join(root, 'target/release/examples/scan_tape');
  let wasmVerified = false;

  async function gate(command, arguments_) {
    const begin = performance.now();
    process.stdout.write(`\n[gate] ${command} ${arguments_.join(' ')}\n`);
    const result = await new Promise(resolve => {
      let stdout = '', stderr = '', error;
      const child = spawn(command, arguments_, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 });
      child.stdout.on('data', bytes => { stdout += bytes.toString(); process.stdout.write(bytes); });
      child.stderr.on('data', bytes => { stderr += bytes.toString(); process.stderr.write(bytes); });
      child.on('error', failure => { error = failure.message; });
      child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr, error }));
    });
    report.gates.push({ command: [command, ...arguments_], passed: result.status === 0 && !result.error,
      elapsedMs: Math.round(performance.now() - begin), ...result });
    if (result.status !== 0 || result.error) throw new Error(`host gate failed: ${command} ${arguments_.join(' ')}`);
    return result.stdout;
  }

  function sourceSha256(source) {
    return createHash('sha256').update(source).digest('hex');
  }

  function requireObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value;
  }

  function requireString(value, label) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
    return value;
  }

  function sourceFile(relative, label) {
    const normalized = path.posix.normalize(relative);
    if (normalized !== relative || (!normalized.startsWith('docs/') && !normalized.startsWith('examples/'))) {
      throw new Error(`${label} is outside the language source contract`);
    }
    const sourceRoot = path.resolve(root);
    const absolute = path.resolve(sourceRoot, normalized);
    if (!absolute.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`${label} escapes the language source root`);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular source file`);
    return { absolute, text: fs.readFileSync(absolute, 'utf8') };
  }

  function e01Projection(document, filename) {
    const anchor = '<a id="ch01"></a>';
    const start = document.indexOf(anchor);
    if (start < 0 || document.indexOf(anchor, start + anchor.length) >= 0) throw new Error('PC-01 source anchor ch01 must occur exactly once');
    const nextAnchor = document.indexOf('\n<a id=', start + anchor.length);
    const section = document.slice(start, nextAnchor < 0 ? document.length : nextAnchor);
    const matches = [...section.matchAll(/```ghost\r?\n(\/\/ E01\r?\n[\s\S]*?)\r?\n```/g)];
    if (matches.length !== 1) throw new Error('PC-01 E01 executable source must occur exactly once within ch01');
    return `# PC-01 derived projection of ${filename}#ch01 (E01)\n\n` + '```ghost\n' + matches[0][1] + '\n```\n';
  }

  async function verifyPlcCurriculum() {
    const { text: catalogText } = sourceFile(PLC_CURRICULUM_CATALOG, 'PLC curriculum catalog');
    const catalog = JSON.parse(catalogText);
    requireObject(catalog, 'PLC curriculum catalog');
    if (catalog.format !== 'GhostFlow/plc-curriculum-catalog-v1') throw new Error('unsupported PLC curriculum catalog format');
    const toolchain = requireObject(catalog.toolchain, 'PLC curriculum toolchain');
    if (toolchain.package !== 'ghostflow-language') throw new Error('PLC curriculum catalog must identify ghostflow-language');
    requireString(toolchain.packageVersion, 'PLC curriculum toolchain packageVersion');
    for (const key of ['compilerRevision', 'runtimeRevision']) {
      if (!/^[0-9a-f]{40}$/.test(requireString(toolchain[key], `PLC curriculum toolchain ${key}`))) {
        throw new Error(`PLC curriculum toolchain ${key} must be a full git SHA-1`);
      }
    }
    const importedSourceProvenance = requireObject(catalog.importedSourceProvenance, 'PLC curriculum imported source provenance');
    if (importedSourceProvenance.repository !== PLC_CURRICULUM_IMPORTED_REPOSITORY) {
      throw new Error(`PLC curriculum imported source provenance must identify ${PLC_CURRICULUM_IMPORTED_REPOSITORY}`);
    }
    if (importedSourceProvenance.revision !== PLC_CURRICULUM_IMPORTED_REVISION) {
      throw new Error(`PLC curriculum imported source provenance revision must be ${PLC_CURRICULUM_IMPORTED_REVISION}`);
    }
    if (!Array.isArray(catalog.lessons) || catalog.lessons.length !== PLC_CURRICULUM_IDS.length) {
      throw new Error('PLC curriculum catalog must declare PC-01 through PC-10 exactly once');
    }
    const lessons = [];
    for (const [index, lesson] of catalog.lessons.entries()) {
      requireObject(lesson, `PLC curriculum lesson ${index + 1}`);
      if (lesson.id !== PLC_CURRICULUM_IDS[index]) throw new Error(`unexpected PLC curriculum lesson order at index ${index}`);
      requireString(lesson.title, `${lesson.id} title`);
      const source = requireObject(lesson.source, `${lesson.id} source`);
      const relative = requireString(source.path, `${lesson.id} source path`);
      const { text } = sourceFile(relative, `${lesson.id} source`);
      const digest = sourceSha256(text);
      if (lesson.id === 'PC-01') {
        if (source.kind !== 'book-example-projection' || source.anchor !== 'ch01' || source.example !== 'E01') {
          throw new Error('PC-01 must remain the E01 projection at docs/ProgrammingInGhostflow.md#ch01');
        }
        if (Object.hasOwn(source, 'sha256')) throw new Error('PC-01 must distinguish documentSha256 from projectionSha256');
        if (digest !== requireString(source.documentSha256, 'PC-01 document SHA-256')) {
          throw new Error(`PC-01 document SHA-256 does not match ${relative}`);
        }
        const projection = e01Projection(text, relative);
        const projectionSha256 = sourceSha256(projection);
        if (projectionSha256 !== requireString(source.projectionSha256, 'PC-01 projection SHA-256')) {
          throw new Error('PC-01 projection SHA-256 does not match the derived E01 source');
        }
        const extraction = extractLiterate(projection, { filename: `${relative}#ch01:E01.ghost.md` });
        if (extraction.warnings.length) throw new Error(`PC-01 E01 projection has literate warnings: ${extraction.warnings.join('; ')}`);
        await compileSource(projection, { filename: `${relative}#ch01:E01.ghost.md` });
        lessons.push({ id: lesson.id, source: relative, documentSha256: digest, projectionSha256, projection: 'E01@ch01' });
        continue;
      }
      if (source.kind !== 'canonical-literate' || !relative.endsWith('.ghost.md')) {
        throw new Error(`${lesson.id} must reference one canonical literate .ghost.md source`);
      }
      if (digest !== requireString(source.sha256, `${lesson.id} source SHA-256`)) {
        throw new Error(`${lesson.id} source SHA-256 does not match ${relative}`);
      }
      const extraction = extractLiterate(text, { filename: relative });
      if (extraction.warnings.length) throw new Error(`${lesson.id} has literate warnings: ${extraction.warnings.join('; ')}`);
      await compileSource(text, { filename: relative });
      lessons.push({ id: lesson.id, source: relative, sha256: digest });
    }
    report.plcCurriculum = {
      catalog: PLC_CURRICULUM_CATALOG,
      catalogSha256: sourceSha256(catalogText),
      toolchain: {
        package: toolchain.package,
        packageVersion: toolchain.packageVersion,
        compilerRevision: toolchain.compilerRevision,
        runtimeRevision: toolchain.runtimeRevision,
      },
      importedSourceProvenance: { ...importedSourceProvenance },
      lessons,
    };
    console.log(`PLC curriculum catalog: PASS ${lessons.length} lessons (${report.plcCurriculum.catalogSha256})`);
  }

  function hashSource(relative) {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`source symlink is outside the export contract: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (!['target', 'node_modules', 'build', '.git'].includes(name)) hashSource(`${relative}/${name}`);
      }
    } else if (stat.isFile()) {
      report.sourceSha256[relative] = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    }
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name !== 'ghostflow-language') throw new Error('run this verifier in the standalone ghostflow-language export');
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required');
    if (process.platform === 'win32') throw new Error('retained native tutorial paths require a POSIX host (macOS/Linux)');
    for (const relative of [
      'tools', 'crates/ghostflow-core', 'runtimes/wasm', 'runtimes/node/ledger.mjs',
      'tests', 'examples', 'docs', 'contracts/integration-v1', 'contracts/requirements', 'README.md', 'AGENTS.md', '.gitignore',
      'Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json', 'Makefile',
    ]) hashSource(relative);
    for (const test of LANGUAGE_TESTS) {
      if (!fs.statSync(path.join(root, test)).isFile()) throw new Error(`missing language test: ${test}`);
    }
    await verifyPlcCurriculum();
    if (curriculumOnly) {
      report.passed = true;
      return;
    }
    if (nodeOnly) {
      if (!fs.existsSync(wasmPath)) throw new Error('WASM artifact missing; run npm test first');
      if (!fs.existsSync(nativePath)) throw new Error('release native artifact missing; run npm test first');
      if (!fs.existsSync(framedNativePath)) throw new Error('release framed native artifact missing; run npm test first');
    } else {
      report.rustc = (await gate('rustc', ['--version'])).trim();
      report.cargo = (await gate('cargo', ['--version'])).trim();
      await gate('cargo', ['fmt', '--all', '--', '--check']);
      // Required before cargo test: core includes this generated test fixture.
      await gate(process.execPath, ['tools/ghostc.mjs', 'examples/irrigation.ghost', 'build/irrigation.gfb']);
      await gate('cargo', ['test', '--locked', '--offline', '--workspace']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-core', '--example', 'run']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-core', '--example', 'run', '--release']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-core', '--example', 'scan_adapter', '--release']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-core', '--example', 'scan_tape', '--release']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release']);
      wasmVerified = true;
    }
    await gate(process.execPath, ['--test', ...LANGUAGE_TESTS]);
    if (!nodeOnly) {
      await gate(process.execPath, ['tools/tutorial.mjs', '--no-build']);
      report.resources = JSON.parse(await gate('cargo', ['run', '--locked', '--offline', '-q', '-p', 'ghostflow-core', '--example', 'resource_report']));
    }
    const bytes = fs.readFileSync(wasmPath);
    report.wasm = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), builtByThisRun: wasmVerified };
    const nativeBytes = fs.readFileSync(nativePath);
    report.native = { bytes: nativeBytes.length, sha256: createHash('sha256').update(nativeBytes).digest('hex'), buildProfile: 'release', builtByThisRun: !nodeOnly };
    const framedNativeBytes = fs.readFileSync(framedNativePath);
    report.framedNative = { bytes: framedNativeBytes.length, sha256: createHash('sha256').update(framedNativeBytes).digest('hex'), buildProfile: 'release', builtByThisRun: !nodeOnly };
    report.passed = true;
  } catch (error) {
    report.failure = error.message;
    process.exitCode = 1;
    console.error(error.message);
  } finally {
    report.finishedAt = new Date().toISOString();
    const build = path.join(root, 'build');
    const history = path.join(build, 'verification-runs');
    fs.mkdirSync(history, { recursive: true });
    const encoded = JSON.stringify(report, null, 2) + '\n';
    const runName = `${report.startedAt.replaceAll(':', '-')}-${report.id}.json`;
    fs.writeFileSync(path.join(history, runName), encoded, { flag: 'wx' });
    // Partial verification runs must not replace the full host suite's latest result.
    const latest = curriculumOnly ? 'verification-curriculum.json' : (nodeOnly ? 'verification-node.json' : 'verification.json');
    fs.writeFileSync(path.join(build, latest), encoded);
    console.log(`${report.passed ? 'PASS' : 'FAIL'} — build/${latest} (${report.scope}; host evidence only)`);
  }
}
