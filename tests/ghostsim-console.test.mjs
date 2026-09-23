import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { decode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { runScenario } from '../tools/ghostsim.mjs';
import { terminalCommands } from '../tools/ghostsim-console.mjs';
import { jsonSha256 } from '../tools/integration-contract.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const cli = path.join(root, 'tools/ghostsim-console.mjs');

async function fixture(source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-console-'));
  const artifact = path.join(directory, 'control.gfb');
  writeArtifact(await compileSource(`\`\`\`ghost\n${source}\n\`\`\`\n`, { filename: 'control.ghost.md' }), artifact);
  return { directory, artifact, record: path.join(directory, 'session.toon') };
}

function run(artifact, commands, args = []) {
  return spawnSync(process.execPath, [cli, artifact, ...args], { input: commands.join('\n') + '\n', encoding: 'utf8', timeout: 10000 });
}

test('default virtual Waveshare panel toggles DI1 and records a replayable TOON scenario', async () => {
  const { directory, artifact, record } = await fixture('control Demo { input DI1: Bool; output RO1: Bool; RO1 <- DI1; }');
  try {
    const child = run(artifact, ['1', '1', 'exit'], ['--record', record]);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stderr, /virtual Waveshare 8DI\/8RO/);
    assert.match(child.stderr, /DI8/);
    assert.match(child.stderr, /RO8/);
    assert.match(child.stderr, /physical: unconfirmed/);
    const result = decode(child.stdout, { strict: true });
    assert.deepEqual(result.scans.map(scan => scan.inputs.DI1), [true, false]);
    assert.deepEqual(result.scans.map(scan => scan.safeVirtualIntent.RO1), [true, false]);
    assert.deepEqual(decode(runScenario(artifact, record).encoded, { strict: true }).scans, result.scans);
    assert.equal(result.console.profile.id, 'virtual Waveshare 8DI/8RO');
    assert.deepEqual(result.console.bindings, [{ channel: 'DI1', port: 'DI1' }, { channel: 'RO1', port: 'RO1' }]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('selected 2DI/4RO profile uses explicit bindings and aligned unequal rows', async () => {
  const { directory, artifact } = await fixture('control Demo { input enabled: Bool; output motor: Bool; motor <- enabled; }');
  try {
    const profilePath = path.join(directory, 'profile.json');
    fs.writeFileSync(profilePath, JSON.stringify({
      format: 'GhostFlow/console-profile-v1', id: 'fixture-driver-2x4',
      inputs: ['A', 'B'].map(name => ({ name, label: name, type: 'Bool' })),
      outputs: ['R1', 'R2', 'R3', 'R4'].map(name => ({ name, label: name, type: 'Bool' })),
    }));
    const child = run(artifact, ['1', 'exit'], ['--profile', profilePath, '--bind', 'A=enabled', '--bind', 'R3=motor', '--format', 'json']);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stderr, /fixture-driver-2x4/);
    assert.match(child.stderr, /R4 \(unbound\)/);
    assert.doesNotMatch(child.stderr, /DI8|RO8/);
    assert.equal(JSON.parse(child.stdout).scans[0].safeVirtualIntent.motor, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('named toggle reaches channels after key 8 and a clock-only scan advances a timer', async () => {
  const { directory, artifact, record } = await fixture('control Demo { input enabled: Bool; state active: Bool = false; timer age = elapsed(active); active\' = enabled; output expired: Bool; expired <- age >= 100ms; }');
  try {
    const profilePath = path.join(directory, 'profile.json');
    fs.writeFileSync(profilePath, JSON.stringify({
      format: 'GhostFlow/console-profile-v1', id: 'nine-inputs',
      inputs: Array.from({ length: 9 }, (_, i) => ({ name: `IN${i + 1}`, label: `IN${i + 1}`, type: 'Bool' })),
      outputs: [{ name: 'OUT', label: 'OUT', type: 'Bool' }],
    }));
    const child = run(artifact, ['toggle IN9', 'scan 100', 'exit'], ['--profile', profilePath, '--bind', 'IN9=enabled', '--bind', 'OUT=expired', '--record', record]);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(decode(child.stdout, { strict: true }).scans.map(scan => scan.logicalTimeMs), [0, 100]);
    assert.deepEqual(decode(child.stdout, { strict: true }).scans.map(scan => scan.safeVirtualIntent.expired), [false, true]);
    const recorded = decode(fs.readFileSync(record, 'utf8'), { strict: true });
    assert.equal(recorded.actions[0].kind, 'input');
    assert.deepEqual(decode(runScenario(artifact, record).encoded, { strict: true }).scans, decode(child.stdout, { strict: true }).scans);
    assert.equal(decode(child.stdout, { strict: true }).console.profile.id, 'nine-inputs');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('unrelated logical names require explicit mapping before the console draws a panel', async () => {
  const { directory, artifact } = await fixture('control Demo { input start: Bool; output pump: Bool; pump <- start; }');
  try {
    const missing = run(artifact, ['1', 'exit']);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing binding for logical input start/);
    assert.doesNotMatch(missing.stderr, /KEY  INPUT/);
    const duplicate = run(artifact, ['1', 'exit'], ['--bind', 'DI1=start', '--bind', 'DI1=start', '--bind', 'RO1=pump']);
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /duplicate binding DI1/);
    const mismatch = run(artifact, ['1', 'exit'], ['--bind', 'RO1=start']);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /unknown output logical port start/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('panel separates requested and safe virtual output intent', async () => {
  const { directory, artifact } = await fixture('control Safe { input DI1: Bool; output RO1, RO2: Bool; RO1 <- DI1; RO2 <- false; require RO1 => RO2; }');
  try {
    const child = run(artifact, ['1', 'exit']);
    assert.equal(child.status, 0, child.stderr);
    const result = decode(child.stdout, { strict: true });
    assert.equal(result.scans[0].requestedVirtualIntent.RO1, true);
    assert.equal(result.scans[0].safeVirtualIntent.RO1, false);
    assert.match(child.stderr, /RO1\s+ON\s+OFF/);
    assert.equal(result.console.physical, 'unconfirmed');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('TTY digits act without Enter, colon enters commands, and raw mode restores on exit', async () => {
  const input = Readable.from([Buffer.from('1:scan 100\r\x03')]);
  const modes = [];
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = value => { modes.push(value); input.isRaw = value; };
  const displayed = [];
  const output = { write: value => displayed.push(value) };
  const commands = [];
  for await (const command of terminalCommands(input, output)) commands.push(command);
  assert.deepEqual(commands, ['1', 'scan 100', 'exit']);
  assert.deepEqual(modes, [true, false]);
  assert.match(displayed.join(''), /:scan 100/);
});

test('board-profile-v1 endpoint order and identity drive a 2DI/4RO console without installation claims', async () => {
  const { directory, artifact } = await fixture('control Demo { input enabled: Bool; output motor: Bool; motor <- enabled; }');
  try {
    const profilePath = path.join(directory, 'board.json');
    const endpoint = direction => ({ direction, type: 'Bool', driver: 'fixture', address: 'fictional', activeLevel: 'high', safeLevel: 0 });
    const board = {
      schema: 'GhostFlow/board-profile-v1', id: 'fixture-board', revision: 'r7', boardModel: 'FICTIONAL',
      endpoints: {
        'input.2': endpoint('input'), 'relay.4': endpoint('output'),
        'input.1': endpoint('input'), 'relay.1': endpoint('output'),
        'relay.3': endpoint('output'), 'relay.2': endpoint('output'),
      },
    };
    fs.writeFileSync(profilePath, JSON.stringify(board));
    const options = ['--profile', profilePath, '--bind', 'input.2=enabled', '--bind', 'relay.3=motor'];
    const child = run(artifact, ['1', 'exit'], options);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stderr, /input\.2[\s\S]*input\.1/);
    assert.match(child.stderr, /relay\.4[\s\S]*relay\.1[\s\S]*relay\.3[\s\S]*relay\.2/);
    assert.doesNotMatch(child.stderr, /physical: confirmed/);
    const result = decode(child.stdout, { strict: true });
    assert.deepEqual(result.console.profile, { id: 'fixture-board', revision: 'r7', sha256: jsonSha256(board) });
    assert.deepEqual(result.console.bindings, [{ channel: 'input.2', port: 'enabled' }, { channel: 'relay.3', port: 'motor' }]);
    assert.equal(result.scans[0].safeVirtualIntent.motor, true);
    const wrongSide = run(artifact, ['1', 'exit'], ['--profile', profilePath, '--bind', 'relay.4=enabled', '--bind', 'relay.3=motor']);
    assert.equal(wrongSide.status, 1);
    assert.match(wrongSide.stderr, /unknown output logical port enabled/);
    assert.doesNotMatch(wrongSide.stderr, /KEY  INPUT/);
    for (const [change, diagnostic] of [
      [copy => { copy.endpoints['input.2'].direction = 'sideways'; }, /invalid board endpoint direction/],
      [copy => { copy.endpoints['input.2'].type = 'Int'; }, /type mismatch input\.2=enabled/],
    ]) {
      const invalid = structuredClone(board); change(invalid); fs.writeFileSync(profilePath, JSON.stringify(invalid));
      const rejected = run(artifact, ['1', 'exit'], options);
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, diagnostic);
      assert.doesNotMatch(rejected.stderr, /KEY  INPUT/);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
