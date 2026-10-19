import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { decode } from '@toon-format/toon';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';
import { runScenario } from '../tools/ghostsim.mjs';
import { runLiveConsole, terminalCommands } from '../tools/ghostsim-console.mjs';
import { jsonSha256 } from '../tools/integration-contract.mjs';
import { readInputObservation } from '../tools/software-input-producer.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = path.join(root, 'tools/ghostsim-console.mjs');

async function fixture(source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-console-'));
  const artifact = path.join(directory, 'control.gfb');
  writeArtifact(await compileSource(`\`\`\`ghost\n${source}\n\`\`\`\n`, { filename: 'control.ghost.md' }), artifact);
  return { directory, artifact, record: path.join(directory, 'session.toon') };
}

function run(artifact, commands, args = [], timeoutMs = 10000) {
  return spawnSync(process.execPath, [cli, artifact, ...args], { input: commands.join('\n') + '\n', encoding: 'utf8', timeout: timeoutMs });
}

test('default virtual Waveshare panel toggles DI1 and records a replayable TOON scenario', async () => {
  const { directory, artifact, record } = await fixture('control Demo { input DI1: Bool; output RO1: Bool; RO1 <- DI1 |> recover(false); }');
  try {
    const child = run(artifact, ['1', '1', 'exit'], ['--record', record]);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stderr, /virtual Waveshare 8DI\/8RO/);
    assert.match(child.stderr, /DI8/);
    assert.match(child.stderr, /RO8/);
    assert.match(child.stderr, /physical: unconfirmed/);
    const result = decode(child.stdout, { strict: true });
    assert.deepEqual(result.scans.map(scan => readInputObservation(scan, 'DI1')), [true, false]);
    assert.deepEqual(result.scans.map(scan => scan.inputs.__gf_sensor_ok_DI1), [true, true],
      'the released button is a healthy false observation');
    assert.deepEqual(result.scans.map(scan => scan.safeVirtualIntent.RO1), [true, false]);
    const replay = decode(runScenario(artifact, record).encoded, { strict: true });
    const runnerProjection = { ...result };
    delete runnerProjection.console;
    assert.deepEqual(runnerProjection, replay);
    assert.equal(result.console.profile.id, 'virtual Waveshare 8DI/8RO');
    assert.deepEqual(result.console.bindings, [{ channel: 'DI1', port: 'DI1' }, { channel: 'RO1', port: 'RO1' }]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('selected 2DI/4RO profile uses explicit bindings and aligned unequal rows', async () => {
  const { directory, artifact } = await fixture('control Demo { input enabled: Bool; output motor: Bool; motor <- enabled |> recover(false); }');
  try {
    const profilePath = path.join(directory, 'profile.json');
    const profileBytes = Buffer.from(JSON.stringify({
      format: 'GhostFlow/console-profile-v1', id: 'fixture-driver-2x4', revision: 'display-r3',
      inputs: ['A', 'B'].map(name => ({ name, label: name, type: 'Bool' })),
      outputs: ['R1', 'R2', 'R3', 'R4'].map(name => ({ name, label: name, type: 'Bool' })),
    }, null, 2) + '\n');
    fs.writeFileSync(profilePath, profileBytes);
    const child = run(artifact, ['1', 'exit'], ['--profile', profilePath, '--bind', 'A=enabled', '--bind', 'R3=motor', '--format', 'json']);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stderr, /fixture-driver-2x4/);
    assert.match(child.stderr, /R4 \(unbound\)/);
    assert.doesNotMatch(child.stderr, /DI8|RO8/);
    const result = JSON.parse(child.stdout);
    assert.equal(result.scans[0].safeVirtualIntent.motor, true);
    assert.deepEqual(result.console.profile, {
      id: 'fixture-driver-2x4', revision: 'display-r3',
      sha256: createHash('sha256').update(profileBytes).digest('hex'),
    });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('named toggle reaches channels after key 8 and a clock-only scan advances a timer', async () => {
  const { directory, artifact, record } = await fixture('control Demo { input enabled: Bool; state active: Bool = false; timer age = elapsed(active); active\' = enabled |> recover(false); output expired: Bool; expired <- age >= 100ms; }');
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
  const { directory, artifact } = await fixture('control Demo { input start: Bool; output pump: Bool; pump <- start |> recover(false); }');
  try {
    const missing = run(artifact, ['1', 'exit']);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing binding for logical output pump/);
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
  const { directory, artifact } = await fixture('control Safe { input DI1: Bool; output RO1, RO2: Bool; RO1 <- DI1 |> recover(false); RO2 <- false; require RO1 => RO2; }');
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

test('TTY raw mode restores when setup fails after enabling it', async () => {
  const modes = [];
  const input = {
    isRaw: false,
    setRawMode(value) { modes.push(value); this.isRaw = value; },
    resume() { throw new Error('input unavailable'); },
  };
  await assert.rejects(async () => {
    for await (const command of terminalCommands(input)) void command;
  }, /input unavailable/);
  assert.deepEqual(modes, [true, false]);
});

test('live TTY scans at zero and draws before any key or timer tick', async () => {
  const { directory, artifact } = await fixture('control Demo { input DI1: Bool; output RO1: Bool; RO1 <- DI1 |> recover(false); }');
  const input = new EventEmitter();
  const output = new EventEmitter();
  const written = [];
  const scans = [];
  const modes = [];
  input.isTTY = true;
  input.isRaw = false;
  input.resume = () => {};
  input.pause = () => {};
  input.setRawMode = value => { modes.push(value); input.isRaw = value; };
  output.columns = 100;
  output.rows = 30;
  output.write = value => { written.push(value); return true; };
  const resultOutput = { write: value => { written.push(value); return true; } };
  let tick;
  const running = runLiveConsole([artifact], {
    input, output, resultOutput, now: () => 0,
    setInterval: callback => { tick = callback; return 1; }, clearInterval: () => {},
    createSession: async () => ({
      manifest: { inputs: [{ name: 'DI1', type: 'Bool' }], outputs: [{ name: 'RO1', type: 'Bool' }] },
      scan(atMs, typedInputs) {
        scans.push({ atMs, typedInputs });
        return { scanId: scans.length - 1, logicalTimeMs: atMs, inputs: { DI1: typedInputs[0].value }, requestedVirtualIntent: { RO1: false }, safeVirtualIntent: { RO1: false } };
      },
      dispose() {},
    }),
    renderPanel: (_profile, _bound, scan) => `PANEL ${scan.scanId} ${scan.logicalTimeMs}`,
  });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(scans, [{ atMs: 0, typedInputs: [{ name: 'DI1', type: 'Bool', value: false }] }]);
    assert.match(written.join(''), /PANEL 0 0/);
    assert.equal(typeof tick, 'function');
    input.emit('data', Buffer.from(':exit\r'));
    assert.equal(await running, 0);
    assert.deepEqual(modes, [true, false]);
    assert.doesNotMatch(written.join(''), /GhostFlow\/scenario-result-v1/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('live TTY uses elapsed time, scans each tick once, toggles immediately, and bounds history', async () => {
  const { directory, artifact } = await fixture('control Demo { input DI1: Bool; output RO1: Bool; RO1 <- DI1 |> recover(false); }');
  const input = new EventEmitter();
  const output = new EventEmitter();
  const scans = [];
  const frames = [];
  let current = 1000;
  let tick;
  let cleared = false;
  input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  input.resume = () => {};
  input.pause = () => {};
  output.columns = 80;
  output.rows = 24;
  output.write = () => true;
  const running = runLiveConsole([artifact], {
    input, output, resultOutput: { write() {} }, now: () => current,
    setInterval: callback => { tick = callback; return 1; }, clearInterval: () => { cleared = true; },
    createSession: async () => ({
      manifest: { inputs: [{ name: 'DI1', type: 'Bool' }], outputs: [{ name: 'RO1', type: 'Bool' }] },
      scan(atMs, typedInputs) {
        scans.push([atMs, typedInputs[0].value]);
        return { scanId: scans.length - 1, logicalTimeMs: atMs, inputs: { DI1: typedInputs[0].value }, requestedVirtualIntent: { RO1: typedInputs[0].value }, safeVirtualIntent: { RO1: typedInputs[0].value } };
      },
      dispose() {},
    }),
    renderPanel: (_profile, _bound, scan, history) => { frames.push([scan.scanId, history.length]); return 'frame'; },
  });
  try {
    await new Promise(resolve => setImmediate(resolve));
    current = 1107; tick();
    current = 1400; tick();
    input.emit('data', Buffer.from('1'));
    assert.deepEqual(scans.slice(0, 4), [[0, false], [107, false], [400, false], [400, true]]);
    for (let i = 0; i < 260; i++) { current += 100; tick(); }
    assert.equal(scans.length, 264);
    assert.ok(frames.at(-1)[1] <= 120);
    input.emit('data', Buffer.from('\x03'));
    assert.equal(await running, 0);
    assert.equal(input.isRaw, false);
    assert.equal(cleared, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('live TTY rejects recording before opening a session', async () => {
  const { directory, artifact, record } = await fixture('control Demo { input DI1: Bool; output RO1: Bool; RO1 <- DI1 |> recover(false); }');
  try {
    let opened = false;
    await assert.rejects(runLiveConsole([artifact, '--record', record], {
      createSession: async () => { opened = true; },
    }), /--record is unavailable in live TTY mode/);
    assert.equal(opened, false);
    assert.equal(fs.existsSync(record), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('live TTY ignores escape key sequences even when split across input chunks', async () => {
  const { directory, artifact } = await fixture('control Demo { input DI1, DI3, DI5: Bool; output RO1: Bool; RO1 <- DI1 |> recover(false); }');
  const input = new EventEmitter();
  const output = new EventEmitter();
  const scans = [];
  input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  input.resume = () => {};
  input.pause = () => {};
  output.write = () => true;
  const running = runLiveConsole([artifact], {
    input, output, resultOutput: { write() {} }, now: () => 0,
    setInterval: () => 1, clearInterval: () => {},
    createSession: async () => ({
      manifest: { inputs: ['DI1', 'DI3', 'DI5'].map(name => ({ name, type: 'Bool' })), outputs: [{ name: 'RO1', type: 'Bool' }] },
      scan(atMs, typedInputs) {
        scans.push(typedInputs.map(input => input.value));
        return { scanId: scans.length - 1, logicalTimeMs: atMs, inputs: Object.fromEntries(typedInputs.map(input => [input.name, input.value])), requestedVirtualIntent: { RO1: false }, safeVirtualIntent: { RO1: false } };
      },
      dispose() {},
    }),
    renderPanel: () => 'frame',
  });
  try {
    await new Promise(resolve => setImmediate(resolve));
    input.emit('data', Buffer.from('\x1b['));
    input.emit('data', Buffer.from('3~\x1b[15~'));
    assert.equal(scans.length, 1, 'Delete and F5 must not toggle digit inputs');
    input.emit('data', Buffer.from('1'));
    assert.deepEqual(scans.at(-1), [true, false, false]);
    input.emit('data', Buffer.from('\x03'));
    assert.equal(await running, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('live TTY restores terminal and disposes runtime when a scan fails', async () => {
  const { directory, artifact } = await fixture('control Demo { input DI1: Bool; output RO1: Bool; RO1 <- DI1 |> recover(false); }');
  const input = new EventEmitter();
  const output = new EventEmitter();
  const writes = [];
  let tick;
  let disposed = false;
  let cleared = false;
  let current = 100;
  input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  input.resume = () => {};
  input.pause = () => {};
  output.write = value => { writes.push(value); return true; };
  const running = runLiveConsole([artifact], {
    input, output, resultOutput: { write() {} }, now: () => current,
    setInterval: callback => { tick = callback; return 1; }, clearInterval: () => { cleared = true; },
    createSession: async () => ({
      manifest: { inputs: [{ name: 'DI1', type: 'Bool' }], outputs: [{ name: 'RO1', type: 'Bool' }] },
      scan(atMs) {
        if (atMs) throw new Error('virtual scan failed');
        return { scanId: 0, logicalTimeMs: 0, inputs: { DI1: false }, requestedVirtualIntent: { RO1: false }, safeVirtualIntent: { RO1: false } };
      },
      dispose() { disposed = true; },
    }),
    renderPanel: () => 'frame',
  });
  try {
    await new Promise(resolve => setImmediate(resolve));
    current = 200;
    tick();
    assert.equal(await running, 1);
    assert.equal(disposed, true);
    assert.equal(cleared, true);
    assert.equal(input.isRaw, false);
    assert.match(writes.join(''), /\x1b\[\?25h\x1b\[\?1049l/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('board-profile-v1 endpoint order and identity drive a 2DI/4RO console without installation claims', async () => {
  const { directory, artifact } = await fixture('control Demo { input enabled: Bool; output motor: Bool; motor <- enabled |> recover(false); }');
  try {
    const profilePath = path.join(directory, 'board.json');
    const endpoint = (direction, address) => ({ direction, type: 'Bool', driver: 'fixture', address, activeLevel: 'high', safeLevel: 0 });
    const board = {
      schema: 'GhostFlow/board-profile-v1', id: 'fixture-board', revision: 'r7', boardModel: 'FICTIONAL',
      endpoints: {
        'input.2': endpoint('input', 'input.2'), 'relay.4': endpoint('output', 'relay.4'),
        'input.1': endpoint('input', 'input.1'), 'relay.1': endpoint('output', 'relay.1'),
        'relay.3': endpoint('output', 'relay.3'), 'relay.2': endpoint('output', 'relay.2'),
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
      [copy => { copy.unexpected = true; }, /invalid board profile/],
      [copy => { copy.endpoints['input.2'].unexpected = true; }, /invalid board endpoint/],
      [copy => { copy.endpoints['input.2'].address = 'relay.4'; }, /duplicate board endpoint/],
      [copy => { copy.endpoints['input.2'].safeLevel = false; }, /invalid board endpoint/],
      [copy => { copy.endpoints['input.2'].driver = '  '; }, /invalid board endpoint/],
    ]) {
      const invalid = structuredClone(board); change(invalid); fs.writeFileSync(profilePath, JSON.stringify(invalid));
      const rejected = run(artifact, ['1', 'exit'], options);
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, diagnostic);
      assert.doesNotMatch(rejected.stderr, /KEY  INPUT/);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('rejected command preserves committed scans and records their exact replay', async () => {
  const { directory, artifact, record } = await fixture('control Demo { input DI1: Bool; output RO1: Bool; RO1 <- DI1 |> recover(false); }');
  try {
    for (const rejected of ['bad-command', 'scan 0']) {
      const commands = rejected === 'scan 0' ? ['1', 'scan 100', rejected] : ['1', rejected];
      const child = run(artifact, commands, ['--record', record, '--format', 'json']);
      assert.equal(child.status, 1, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.outcome, 'command-error');
      assert.equal(result.error.location, 'command');
      assert.equal(result.scans.length, commands.length - 1);
      assert.ok(result.error.message);
      const recorded = decode(fs.readFileSync(record, 'utf8'), { strict: true });
      assert.equal(recorded.actions.filter(action => action.kind === 'scan').length, commands.length - 1);
      const replay = JSON.parse(runScenario(artifact, record, { format: 'json' }).encoded);
      assert.equal(replay.outcome, 'completed');
      for (const field of ['scans', 'scenario', 'artifact', 'outputMeaning']) {
        assert.deepEqual(result[field], replay[field]);
      }
      assert.equal(result.scans[0].safeVirtualIntent.RO1, true);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('scan budget rejects the attempted scan while retaining a replayable 256-scan prefix', { timeout: 120000 }, async () => {
  const { directory, artifact, record } = await fixture('control Demo { input DI1: Bool; output RO1: Bool; RO1 <- DI1 |> recover(false); }');
  try {
    // Prefix replay is quadratic; this bounded infrastructure timeout leaves the 256-scan guard unchanged.
    const child = run(artifact, Array.from({ length: 257 }, () => 'scan 0'), ['--record', record, '--format', 'json'], 90000);
    assert.equal(child.status, 1, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.outcome, 'command-error');
    assert.match(result.error.message, /scan budget 256 exceeded/);
    assert.equal(result.scans.length, 256);
    const recorded = decode(fs.readFileSync(record, 'utf8'), { strict: true });
    assert.equal(recorded.actions.length, 256);
    const replay = JSON.parse(runScenario(artifact, record, { format: 'json' }).encoded);
    assert.deepEqual(result.scans, replay.scans);
    assert.deepEqual(result.scenario, replay.scenario);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
