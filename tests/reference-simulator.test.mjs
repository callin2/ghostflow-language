import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { encode } from '@toon-format/toon';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [
  'tests/reference/cases/00-principles.json',
  'tests/reference/cases/01-source-types.json',
  'tests/reference/cases/02-time-control.json',
  'tests/reference/cases/03-settings-boundaries.json',
];
const accepted = files.flatMap(file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).cases)
  .filter(entry => entry.status === 'executable' && entry.expect === 'accept');
// These three are standalone resource declarations, with no control to scan.
const standaloneDescriptors = new Map([
  ['REF-04-044', 'GhostFlow/resource-policy-v1'],
  ['REF-04-045', 'GhostFlow/resource-policy-v1'],
  ['REF-04-050', 'GhostFlow/resource-policy-v1'],
]);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-reference-simulator-'));
const results = [];
const scan = atMs => ({ kind: 'scan', atMs });
const input = (name, type, value) => ({ kind: 'input', name, type, value });
const behaviorOracles = {
  'REF-01-097': {
    actions: [scan(0), input('request', 'Bool', true), scan(1), input('request', 'Bool', false), scan(2)],
    requested: [{ pump: false }, { pump: true }, { pump: false }],
  },
  'REF-03-015': {
    initial: { hot: true },
    actions: [scan(0), scan(299999), scan(300000), input('hot', 'Bool', false), scan(300001)],
    requested: [{ alarm: false }, { alarm: false }, { alarm: true }, { alarm: false }],
  },
  'REF-04-020': {
    actions: [scan(0), input('start', 'Bool', true), scan(100), scan(2099), scan(2100)],
    requested: [{ request: false }, { request: false }, { request: false }, { request: true }],
  },
  'REF-04-041': {
    actions: [scan(0), input('go_forward', 'Bool', true), scan(1), input('go_reverse', 'Bool', true), scan(2)],
    requested: [{ forward: false, reverse: false }, { forward: true, reverse: false }, { forward: true, reverse: true }],
    safe: [{ forward: false, reverse: false }, { forward: true, reverse: false }, { forward: false, reverse: false }],
  },
  'REF-01-057': {
    initial: { temperature: 29.9 },
    actions: [scan(0), input('temperature', 'Number', 30), scan(1), input('temperature', 'Number', 29), scan(2)],
    requested: [{ warm: false }, { warm: true }, { warm: false }],
  },
};

function invoke(tool, args) {
  const result = spawnSync(process.execPath, [path.join(root, `tools/${tool}.mjs`), ...args], {
    cwd: root, encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.signal) throw new Error(`${tool}: ${result.error?.message ?? result.signal}`);
  return result;
}

test('Reference accepted catalog contains 83 cases', () => {
  assert.equal(accepted.length, 83);
  assert.equal(new Set(accepted.map(entry => entry.id)).size, accepted.length);
});

for (const entry of accepted) {
  test(`${entry.id}: compiled Reference artifact executes in ghostsim`, () => {
    const record = { id: entry.id, outcome: 'failed' };
    results.push(record);
    try {
      const dir = fs.mkdtempSync(path.join(workspace, 'case-'));
      const source = path.join(dir, entry.filename ?? 'case.ghost.md');
      const artifact = path.join(dir, 'program.gfb');
      fs.writeFileSync(source, entry.source);
      for (const [name, content] of Object.entries(entry.files ?? {})) fs.writeFileSync(path.join(dir, name), content);
      const compiled = invoke('ghostc', [source, artifact]);
      assert.equal(compiled.status, 0, `${entry.id}: compiler failed: ${compiled.stderr}`);
      const manifest = JSON.parse(fs.readFileSync(`${artifact}.manifest.json`, 'utf8'));
      record.artifactFormat = manifest.format;
      if (!/^GhostFlow\/control-v[1-6]$/.test(manifest.format)) {
        if (standaloneDescriptors.has(entry.id)) {
          assert.equal(manifest.format, standaloneDescriptors.get(entry.id),
            `${entry.id}: unexpected standalone descriptor format`);
          record.outcome = 'noncontrol';
          record.reason = 'standalone resource policy has no control to scan';
          return;
        }
        throw new Error(`${entry.id}: accepted control source compiled to ${manifest.format}; ghostsim requires an executable control artifact`);
      }
      assert.ok(!standaloneDescriptors.has(entry.id), `${entry.id}: standalone declaration unexpectedly became executable`);
      const oracle = behaviorOracles[entry.id];
      const initialInputs = manifest.inputs.filter(input => input.name !== '__gf_now_ms').map(input => {
        assert.ok(['Bool', 'Int', 'Number'].includes(input.type),
          `${entry.id}: unsupported external input ${input.name}: ${input.type}`);
        return { name: input.name, type: input.type,
          value: oracle?.initial && Object.hasOwn(oracle.initial, input.name)
            ? oracle.initial[input.name] : input.type === 'Bool' ? false : 0 };
      });
      const scenario = path.join(dir, 'scenario.toon');
      fs.writeFileSync(scenario, encode({
        format: 'GhostFlow/scenario-v1', id: entry.id, initialInputs, keyBindings: [],
        actions: oracle?.actions ?? [scan(0)],
      }) + '\n');
      const simulated = invoke('ghostsim', [artifact, scenario, '--format', 'json']);
      const outcome = JSON.parse(simulated.stdout);
      if (simulated.status !== 0) {
        throw new Error(`${entry.id}: ${outcome.outcome}: ${outcome.error?.location ?? outcome.error?.actionIndex ?? 'scan'}: ${outcome.error?.message ?? simulated.stderr}`);
      }
      assert.equal(outcome.format, 'GhostFlow/scenario-result-v1');
      assert.equal(outcome.outcome, 'completed');
      assert.equal(outcome.scenario.id, entry.id);
      assert.equal(outcome.scans.length, oracle?.requested.length ?? 1);
      assert.equal(outcome.scans[0].scanId, 0, `${entry.id}: first scan ID`);
      assert.equal(outcome.scans[0].logicalTimeMs, 0);
      for (const [index, row] of outcome.scans.entries()) {
        assert.equal(row.scanId, index, `${entry.id}: scan ${index} ID`);
        assert.equal(row.logicalTimeMs, (oracle?.actions ?? [scan(0)]).filter(action => action.kind === 'scan')[index].atMs);
        assert.ok(row.requestedVirtualIntent !== undefined, `${entry.id}: missing requested intent`);
        assert.ok(row.safeVirtualIntent !== undefined, `${entry.id}: missing safe intent`);
        if (oracle) {
          for (const [name, expected] of Object.entries(oracle.requested[index])) {
            assert.equal(row.requestedVirtualIntent[name], expected, `${entry.id}: scan ${index} requested ${name}`);
          }
          for (const [name, expected] of Object.entries((oracle.safe ?? oracle.requested)[index])) {
            assert.equal(row.safeVirtualIntent[name], expected, `${entry.id}: scan ${index} safe ${name}`);
          }
        }
      }
      record.outcome = 'passed';
      record.scans = outcome.scans.length;
    } catch (error) {
      record.reason = error.message;
      throw error;
    }
  });
}

after(() => {
  const summary = Object.fromEntries(['passed', 'failed', 'noncontrol'].map(outcome =>
    [outcome, results.filter(result => result.outcome === outcome).length]));
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build/reference-simulator-tests.json'), JSON.stringify({
    scope: 'language-reference-accepted-simulator', generatedAt: new Date().toISOString(),
    acceptedIds: accepted.map(entry => entry.id),
    executedIds: results.map(result => result.id),
    notRunIds: accepted.filter(entry => !results.some(result => result.id === entry.id)).map(entry => entry.id),
    summary, results,
  }, null, 2) + '\n');
  fs.rmSync(workspace, { recursive: true, force: true });
});
