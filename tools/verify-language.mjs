#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractLiterate } from './literate.mjs';
import { compileSource } from './toolchain.mjs';
import { CURRICULUM_REPLAY_MANIFEST, prepareCurriculumReplays, verifyCurriculumReplayWasm } from './curriculum-replay.mjs';
import { PC01_PROJECTION, verifyPc01Projection } from './generate-pc-01-projection.mjs';
import { verificationSourceHashes } from './verification-sources.mjs';

// Deliberately explicit. Product/LLM/device tests belong to other repositories.
export const LANGUAGE_TESTS = Object.freeze([
  'tests/doc-translations.test.mjs',
  'tests/doc-index.test.mjs',
  'tests/verified-wasm-artifact.test.mjs',
  'tests/ci-verification-routing.test.mjs',
  'tests/boundary-conformance.test.mjs',
  'tests/compiler.test.mjs',
  'tests/docs-runnable-examples.test.mjs',
  'tests/programming-book-simulation.test.mjs',
  'tests/ghostsim-input-validation.test.mjs',
  'tests/reference-cli.test.mjs',
  'tests/feature-status.test.mjs',
  'tests/reference-simulator.test.mjs',
  'tests/adapt-control-host.test.mjs',
  'tests/reference-query.test.mjs',
  'tests/reference-index-links.test.mjs',
  'tests/reference-terms-boundaries.test.mjs',
  'tests/authoring-efficiency.test.mjs',
  'tests/time-literals.test.mjs',
  'tests/date-time-control.test.mjs',
  'tests/quantities.test.mjs',
  'tests/constraints.test.mjs',
  'tests/coverage-edges.test.mjs',
  'tests/gfb1-browser.test.mjs',
  'tests/coverage-source-identity.test.mjs',
  'tests/core-ir.test.mjs',
  'tests/gfb1-golden.test.mjs',
  'tests/gfb2-int.test.mjs',
  'tests/gfb4-window.test.mjs',
  'tests/gfb5-schedule.test.mjs',
  'tests/gfb5-browser.test.mjs',
  'tests/gfb5-native.test.mjs',
  'tests/gfb6-native.test.mjs',
  'tests/gfb7-pid-contract.test.mjs',
  'tests/gfb4-browser.test.mjs',
  'tests/dynamic-int-conversions.test.mjs',
  'tests/int-division-identity.test.mjs',
  'tests/datetime-runtime.test.mjs',
  'tests/result-trace-runtime.test.mjs',
  'tests/result-control.test.mjs',
  'tests/result-provenance.test.mjs',
  'tests/expression-order.test.mjs',
  'tests/state-snapshot-reference.test.mjs',
  'tests/long-tick-state.test.mjs',
  'tests/duration-runtime.test.mjs',
  'tests/portable-package.test.mjs',
  'tests/gfb10-package.test.mjs',
  'tests/control-host.test.mjs',
  'tests/control-runtime-atomicity.test.mjs',
  'tests/native-dispatch-status.test.mjs',
  'tests/framed-control-host.test.mjs',
  'tests/consumer-framed-compatibility.test.mjs',
  'tests/vfd-speed.test.mjs',
  'tests/control.test.mjs',
  'tests/control-source-validation.test.mjs',
  'tests/compiler-syntax-diagnostics.test.mjs',
  'tests/compiler-newline-diagnostics.test.mjs',
  'tests/compiler-syntax-boundaries.test.mjs',
  'tests/compiler-syntax-structure.test.mjs',
  'tests/compiler-parser-callsites.test.mjs',
  'tests/compiler-token-limit-diagnostics.test.mjs',
  'tests/compiler-cli-diagnostics.test.mjs',
  'tests/ghostc-toon.test.mjs',
  'tests/structured-diagnostics.test.mjs',
  'tests/compiler-semantic-diagnostics.test.mjs',
  'tests/compiler-interaction-diagnostics.test.mjs',
  'tests/compiler-control-diagnostics-extra.test.mjs',
  'tests/compiler-window-diagnostics.test.mjs',
  'tests/compiler-window-byte-limit.test.mjs',
  'tests/compiler-schedule-duplicates.test.mjs',
  'tests/daily-slots-policy.test.mjs',
  'tests/periodic-cron-policy.test.mjs',
  'tests/natural-condition-contract.test.mjs',
  'tests/natural-schedule-contract.test.mjs',
  'tests/accounting-syntax.test.mjs',
  'tests/accounting-wasm.test.mjs',
  'tests/context-wasm-boundaries.test.mjs',
  'tests/after-event-contract.test.mjs',
  'tests/after-event-wasm.test.mjs',
  'tests/after-event-control.test.mjs',
  'tests/deferred-runtime-gates.test.mjs',
  'tests/temporal-descriptor-artifact.test.mjs',
  'tests/int-operating-settings.test.mjs',
  'tests/int-settings-artifacts.test.mjs',
  'tests/objective-adapt-structural.test.mjs',
  'tests/int-settings-package.test.mjs',
  'tests/debounce-control.test.mjs',
  'tests/debounce-runtime.test.mjs',
  'tests/debounce-provenance.test.mjs',
  'tests/debounce-diagnostics.test.mjs',
  'tests/hold-last-control.test.mjs',
  'tests/hold-last-diagnostics.test.mjs',
  'tests/hold-last-runtime.test.mjs',
  'tests/hold-last-provenance.test.mjs',
  'tests/true-for-integration.test.mjs',
  'tests/true-for-wasm.test.mjs',
  'tests/true-for-lowering.test.mjs',
  'tests/window-control.test.mjs',
  'tests/window-package.test.mjs',
  'tests/window-native.test.mjs',
  'tests/window-framed-native.test.mjs',
  'tests/window-wasm.test.mjs',
  'tests/window-host.test.mjs',
  'tests/window-provenance.test.mjs',
  'tests/window-derived-control.test.mjs',
  'tests/window-derived-host.test.mjs',
  'tests/window-derived-package.test.mjs',
  'tests/window-derived-provenance.test.mjs',
  'tests/temporal-replay-wasm.test.mjs',
  'tests/core-replay-wasm.test.mjs',
  'tests/temporal-resource-plan-wasm.test.mjs',
  'tests/range-contract.test.mjs',
  'tests/curriculum-replay.test.mjs',
  'tests/core-irrigation-proof.test.mjs',
  'tests/pc-01-projection-sync.test.mjs',
  'tests/integration-contract.test.mjs',
  'tests/interaction-contract.test.mjs',
  'tests/interaction-corpus.test.mjs',
  'tests/interaction-emission.test.mjs',
  'tests/interaction-runtime-snapshot.test.mjs',
  'tests/intent-anchor-map.test.mjs',
  'tests/ledger.test.mjs',
  'tests/literate.test.mjs',
  'tests/lesson.test.mjs',
  'tests/lesson-boundaries.test.mjs',
  'tests/source-trace.test.mjs',
  'tests/source-dependencies.test.mjs',
  'tests/import-header.test.mjs',
  'tests/import-composition.test.mjs',
  'tests/composition-execution.test.mjs',
  'tests/import-cli-digest.test.mjs',
  'tests/policy.test.mjs',
  'tests/requirement-catalog.test.mjs',
  'tests/output-conformance.test.mjs',
  'tests/runtime-conformance.test.mjs',
  'tests/schedule.test.mjs',
  'tests/schedule-descriptor-artifact.test.mjs',
  'tests/schedule-missed-reaction.test.mjs',
  'tests/solar-control.test.mjs',
  'tests/solar-control-runtime.test.mjs',
  'tests/solar-schedule.test.mjs',
  'tests/solar-scanframe-native-wasm.test.mjs',
  'tests/solar-provider-wasm.test.mjs',
  'tests/scheduled-admission.test.mjs',
  'tests/signals-wasm.test.mjs',
  'tests/scan-frame-wasm.test.mjs',
  'tests/scan-tape-parity.test.mjs',
  'tests/ghostsim.test.mjs',
  'tests/ghostsim-closed-loop.test.mjs',
  'tests/ghostsim-continuous-io.test.mjs',
  'tests/ghostsim-temporal.test.mjs',
  'tests/ghostsim-solar.test.mjs',
  'tests/daily-runtime.test.mjs',
  'tests/daily-slots-runtime.test.mjs',
  'tests/ghostsim-daily.test.mjs',
  'tests/ghostsim-daily-slots.test.mjs',
  'tests/ghostsim-live.test.mjs',
  'tests/ghostsim-console.test.mjs',
  'tests/authoring-workflow.test.mjs',
  'tests/station-wasm.test.mjs',
  'tests/station-stop-priority.test.mjs',
  'tests/toolchain.test.mjs',
  'tests/browser-toolchain.test.mjs',
  'tests/operating-settings.test.mjs',
  'tests/config-native-wasm-parity.test.mjs',
  'tests/issue-90-settings-stream.test.mjs',
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
  const scenarioNativePath = path.join(root, 'target/release/examples/scenario_scan');
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
    if (catalog.replayScenarios !== CURRICULUM_REPLAY_MANIFEST) {
      throw new Error(`PLC curriculum replayScenarios must be ${CURRICULUM_REPLAY_MANIFEST}`);
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
        if (source.generatedPath !== PC01_PROJECTION) throw new Error(`PC-01 generatedPath must be ${PC01_PROJECTION}`);
        const generated = verifyPc01Projection({ repositoryRoot: root });
        if (generated.documentSha256 !== digest) throw new Error('PC-01 generated projection source digest is stale');
        const projectionSha256 = generated.projectionSha256;
        if (projectionSha256 !== requireString(source.projectionSha256, 'PC-01 projection SHA-256')) {
          throw new Error('PC-01 projection SHA-256 does not match the derived E01 source');
        }
        const extraction = extractLiterate(generated.projection, { filename: source.generatedPath });
        if (extraction.warnings.length) throw new Error(`PC-01 E01 projection has literate warnings: ${extraction.warnings.join('; ')}`);
        await compileSource(generated.projection, { filename: source.generatedPath });
        lessons.push({ id: lesson.id, source: relative, generatedSource: source.generatedPath, documentSha256: digest, projectionSha256, projection: 'E01@ch01' });
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
    const replayText = sourceFile(CURRICULUM_REPLAY_MANIFEST, 'PLC curriculum replay manifest').text;
    const replay = await prepareCurriculumReplays({ repositoryRoot: root, catalog });
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
      replay: {
        manifest: CURRICULUM_REPLAY_MANIFEST,
        manifestSha256: sourceSha256(replayText),
        scenarios: replay.scenarios.length,
        frames: replay.scenarios.reduce((count, entry) => count + entry.scenario.frames.length, 0),
        checkpoints: replay.scenarios.reduce((count, entry) => count + entry.scenario.checkpoints.length, 0),
      },
    };
    console.log(`PLC curriculum catalog: PASS ${lessons.length} lessons, ${replay.scenarios.length} replay scenarios (${report.plcCurriculum.catalogSha256})`);
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name !== 'ghostflow-language') throw new Error('run this verifier in the standalone ghostflow-language export');
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required');
    if (process.platform === 'win32') throw new Error('retained native tutorial paths require a POSIX host (macOS/Linux)');
    report.sourceSha256 = verificationSourceHashes(root);
    await gate('npm', ['run', 'docs:check']);
    for (const test of LANGUAGE_TESTS) {
      if (!fs.statSync(path.join(root, test)).isFile()) throw new Error(`missing language test: ${test}`);
    }
    await verifyPlcCurriculum();
    if (curriculumOnly) {
      if (!fs.existsSync(wasmPath)) {
        await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release']);
        wasmVerified = true;
      }
      report.plcCurriculum.replay.runtime = await verifyCurriculumReplayWasm(fs.readFileSync(wasmPath), { repositoryRoot: root });
      report.passed = true;
      return;
    }
    if (nodeOnly) {
      if (!fs.existsSync(wasmPath)) throw new Error('WASM artifact missing; run npm test first');
      if (!fs.existsSync(nativePath)) throw new Error('release native artifact missing; run npm test first');
      if (!fs.existsSync(framedNativePath)) throw new Error('release framed native artifact missing; run npm test first');
      if (!fs.existsSync(scenarioNativePath)) throw new Error('release scenario runner missing; run npm test first');
    } else {
      report.rustc = (await gate('rustc', ['--version'])).trim();
      report.cargo = (await gate('cargo', ['--version'])).trim();
      await gate('cargo', ['fmt', '--all', '--', '--check']);
      // Required before cargo test: core includes this generated test fixture.
      await gate(process.execPath, ['tools/ghostc.mjs', 'examples/irrigation.ghost.md', 'build/irrigation.gfb']);
      await gate('cargo', ['test', '--locked', '--offline', '--workspace']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-core', '--example', 'run']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-core', '--example', 'run', '--release']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-core', '--example', 'scan_adapter', '--release']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-core', '--example', 'scan_tape', '--release']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-core', '--example', 'context_tape', '--release']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-core', '--example', 'scenario_scan', '--release']);
      await gate('cargo', ['build', '--locked', '--offline', '-p', 'ghostflow-wasm', '--target', 'wasm32-unknown-unknown', '--release']);
      wasmVerified = true;
    }
    report.plcCurriculum.replay.runtime = await verifyCurriculumReplayWasm(fs.readFileSync(wasmPath), { repositoryRoot: root });
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
