import { readFileSync } from 'node:fs';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { jsonSha256 } from '../tools/integration-contract.mjs';
import { ProgramReplacementHost } from '../runtimes/wasm/program-replacement-host.mjs';

const source = body => `# Virtual replacement example\n\n\`\`\`ghost\n${body}\n\`\`\`\n`;
const original = compileSourceSync(source(`control Pump {
  input enabled: Bool;
  state held: Bool = false;
  held' = enabled |> recover(false);
  output pump: Bool;
  pump <- held';
}`), { filename: 'example-pump.ghost.md' });
const replacement = compileSourceSync(source(`control Pump {
  input enabled: Bool;
  state held: Bool = false;
  state replacement_count: Int = 0;
  held' = enabled |> recover(false);
  replacement_count' = replacement_count + 1;
  output pump: Bool;
  pump <- held';
}`), { filename: 'example-pump.ghost.md' });

const boardProfile = { schema: 'GhostFlow/board-profile-v1', id: 'virtual-board', revision: '1',
  boardModel: 'VIRTUAL', endpoints: {
    start: { direction: 'input', type: 'Bool', driver: 'virtual-input', address: 'input/start', activeLevel: 'high', safeLevel: 0 },
    relay: { direction: 'output', type: 'Bool', driver: 'virtual-output', address: 'output/relay', activeLevel: 'high', safeLevel: 0 },
  } };
const profile = { id: boardProfile.id, revision: boardProfile.revision, sha256: jsonSha256(boardProfile) };
const installation = { schema: 'GhostFlow/installation-mapping-v1', id: 'virtual-installation', revision: '1',
  boardProfile: profile, bindings: { enabled: 'start', pump: 'relay' } };
const release = { schema: 'GhostFlow/integration-release-v1',
  toolchain: { version: 'virtual-toolchain', sha256: '1'.repeat(64) },
  runtimeSemanticsVersion: 'virtual-runtime', bytecodeFormat: 'GFB1', protocolVersion: 'virtual-protocol',
  device: { firmwareSha256: '2'.repeat(64), boardProfile: profile },
  installation: { id: installation.id, revision: installation.revision, sha256: jsonSha256(installation) } };
const wasm = readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const host = await ProgramReplacementHost.instantiate(wasm, original, {
  runId: 'virtual-run-1', release, boardProfile, installation,
});
try {
  const observation = (value, observationId) => ({ enabled: { ok: true, value,
    source: 'virtual-input', observationId } });
  const before = host.step({ observations: observation(true, 'sample-1') });
  const boundary = host.replace({ artifact: replacement, runId: 'virtual-run-2' });
  const after = host.step({ observations: observation(false, 'sample-2') });
  process.stdout.write(JSON.stringify({ before: { identity: before.identity, safe: before.trace.safe },
    boundary, after: { identity: after.identity, stateBefore: after.trace.stateBefore, safe: after.trace.safe } }, null, 2) + '\n');
} finally { host.dispose(); }
