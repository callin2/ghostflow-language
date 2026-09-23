#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encode } from '@toon-format/toon';
import { runScenario } from './ghostsim.mjs';
import { jsonSha256 } from './integration-contract.mjs';

const cli = fileURLToPath(import.meta.url);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const defaultProfile = () => ({
  format: 'GhostFlow/console-profile-v1', id: 'virtual Waveshare 8DI/8RO',
  inputs: Array.from({ length: 8 }, (_, i) => ({ name: `DI${i + 1}`, label: `DI${i + 1}`, type: 'Bool' })),
  outputs: Array.from({ length: 8 }, (_, i) => ({ name: `RO${i + 1}`, label: `RO${i + 1}`, type: 'Bool' })),
});

function profileFromFile(filename) {
  const bytes = filename ? fs.readFileSync(filename) : null;
  const source = bytes ? JSON.parse(bytes.toString('utf8')) : defaultProfile();
  let profile = source;
  if (source?.schema === 'GhostFlow/board-profile-v1') {
    if (typeof source.id !== 'string' || !source.id || typeof source.revision !== 'string' || !source.revision ||
      typeof source.boardModel !== 'string' || !source.boardModel || !isObject(source.endpoints)) {
      throw new Error('invalid board profile');
    }
    const inputs = []; const outputs = [];
    for (const [name, endpoint] of Object.entries(source.endpoints)) {
      if (!isObject(endpoint) || !['input', 'output'].includes(endpoint.direction)) {
        throw new Error(`invalid board endpoint direction ${name}`);
      }
      if (typeof endpoint.type !== 'string' || !endpoint.type || typeof endpoint.driver !== 'string' || !endpoint.driver ||
        typeof endpoint.address !== 'string' || !endpoint.address || !['high', 'low'].includes(endpoint.activeLevel) ||
        ![0, 1].includes(endpoint.safeLevel)) throw new Error(`invalid board endpoint ${name}`);
      (endpoint.direction === 'input' ? inputs : outputs).push({ name, label: name, type: endpoint.type });
    }
    profile = { format: 'GhostFlow/console-profile-v1', id: source.id, revision: source.revision, inputs, outputs };
  }
  if (!isObject(profile) || profile.format !== 'GhostFlow/console-profile-v1' || typeof profile.id !== 'string' || !profile.id ||
    !Array.isArray(profile.inputs) || !Array.isArray(profile.outputs)) throw new Error('invalid console profile');
  const names = new Set();
  for (const [side, channels] of [['inputs', profile.inputs], ['outputs', profile.outputs]]) {
    for (const channel of channels) {
      if (!isObject(channel) || typeof channel.name !== 'string' || !channel.name || typeof channel.label !== 'string' ||
        !channel.label || typeof channel.type !== 'string' || !channel.type || /[\r\n\t]/u.test(channel.name + channel.label)) {
        throw new Error(`invalid ${side} channel`);
      }
      if (names.has(channel.name)) throw new Error(`duplicate channel ${channel.name}`);
      names.add(channel.name);
    }
  }
  profile.sha256 = source?.schema === 'GhostFlow/board-profile-v1'
    ? jsonSha256(source)
    : createHash('sha256').update(bytes ?? Buffer.from(JSON.stringify(source))).digest('hex');
  return profile;
}

function parseArgs(args) {
  if (!args.length) throw new Error('usage: ghostsim-console <artifact.gfb> [--profile file.json] [--bind CHANNEL=port] [--input port=value] [--record session.toon] [--format toon|json]');
  const options = { artifact: args[0], bindings: [], inputs: [], format: 'toon' };
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]; const value = args[i + 1];
    if (value === undefined) throw new Error(`missing value for ${key}`);
    if (key === '--bind') options.bindings.push(value);
    else if (key === '--input') options.inputs.push(value);
    else if (key === '--profile' && !options.profile) options.profile = value;
    else if (key === '--record' && !options.record) options.record = value;
    else if (key === '--format' && ['toon', 'json'].includes(value)) options.format = value;
    else throw new Error(`unknown or repeated option ${key}`);
  }
  return options;
}

function assignment(value, option) {
  const match = /^([^=]+)=(.+)$/u.exec(value);
  if (!match) throw new Error(`${option} requires NAME=value`);
  return [match[1], match[2]];
}

function setup(artifact, profile, assignments, initialAssignments, defaultLayout) {
  const manifest = JSON.parse(fs.readFileSync(`${artifact}.manifest.json`, 'utf8'));
  const logicalInputs = new Map(manifest.inputs.filter(field => field.name !== '__gf_now_ms').map(field => [field.name, field]));
  const logicalOutputs = new Map(manifest.outputs.map(field => [field.name, field]));
  const channels = new Map([...profile.inputs.map(channel => [channel.name, { side: 'input', channel }]),
    ...profile.outputs.map(channel => [channel.name, { side: 'output', channel }])]);
  const bound = new Map(); const usedPorts = new Set();
  for (const value of assignments) {
    const [name, port] = assignment(value, '--bind');
    const entry = channels.get(name);
    if (!entry) throw new Error(`unknown channel ${name}`);
    if (bound.has(name)) throw new Error(`duplicate binding ${name}`);
    if (usedPorts.has(port)) throw new Error(`duplicate logical port binding ${port}`);
    const logical = (entry.side === 'input' ? logicalInputs : logicalOutputs).get(port);
    if (!logical) throw new Error(`unknown ${entry.side} logical port ${port}`);
    if (logical.type !== entry.channel.type) throw new Error(`type mismatch ${name}=${port}`);
    bound.set(name, port); usedPorts.add(port);
  }
  if (defaultLayout) {
    for (const [name, entry] of channels) {
      if (bound.has(name)) continue;
      const port = (entry.side === 'input' ? logicalInputs : logicalOutputs).get(name);
      if (port?.type === entry.channel.type && !usedPorts.has(name)) {
        bound.set(name, name); usedPorts.add(name);
      }
    }
  }
  const values = new Map();
  for (const field of logicalInputs.values()) {
    if (field.type === 'Bool') values.set(field.name, false);
  }
  for (const value of initialAssignments) {
    const [name, raw] = assignment(value, '--input');
    const field = logicalInputs.get(name);
    if (!field) throw new Error(`unknown input ${name}`);
    if (field.type === 'Bool' && !['true', 'false'].includes(raw)) throw new Error(`invalid Bool input ${name}`);
    if (field.type === 'Int' && !/^-?\d+$/u.test(raw)) throw new Error(`invalid Int input ${name}`);
    if (field.type === 'Number' && !Number.isFinite(Number(raw))) throw new Error(`invalid Number input ${name}`);
    values.set(name, field.type === 'Bool' ? raw === 'true' : Number(raw));
  }
  for (const field of logicalInputs.values()) {
    if (!values.has(field.name)) throw new Error(`missing initial input ${field.name}; use --input ${field.name}=value`);
    if (!usedPorts.has(field.name) && !initialAssignments.some(value => value.startsWith(`${field.name}=`))) {
      throw new Error(`missing binding for logical input ${field.name}`);
    }
  }
  for (const field of logicalOutputs.values()) {
    if (!usedPorts.has(field.name)) throw new Error(`missing binding for logical output ${field.name}`);
  }
  const keyBindings = profile.inputs.slice(0, 8).flatMap((channel, index) => {
    const port = bound.get(channel.name);
    return port && channel.type === 'Bool' ? [{ key: index + 1, input: port }] : [];
  });
  return { manifest, bound, values, keyBindings };
}

function state(value) {
  return value === true ? 'ON' : value === false ? 'OFF' : 'unobserved';
}

function panel(profile, bound, scan, result) {
  const lines = [
    `profile/Driver: ${profile.id}${profile.revision ? ` @ ${profile.revision}` : ''}`,
    `scan: ${scan?.scanId ?? 'unobserved'}  virtual time: ${scan?.logicalTimeMs ?? 'unobserved'} ms  status: ${result.outcome}`,
    `physical: unconfirmed`,
    `bindings: ${[...bound].map(([channel, port]) => `${channel}=${port}`).join(', ') || 'none'}`,
    'KEY  INPUT          STATE       | OUTPUT         REQUESTED   SAFE',
  ];
  for (let i = 0; i < Math.max(profile.inputs.length, profile.outputs.length); i++) {
    const input = profile.inputs[i]; const output = profile.outputs[i];
    const inputPort = input && bound.get(input.name);
    const outputPort = output && bound.get(output.name);
    const key = i < 8 && inputPort && input.type === 'Bool' ? String(i + 1) : '';
    const inputName = input ? `${input.label}${inputPort ? '' : ' (unbound)'}` : '';
    const inputState = input ? inputPort && input.type === 'Bool' ? state(scan?.inputs?.[inputPort]) : inputPort ? 'unsupported' : 'unobserved' : '';
    const outputName = output ? `${output.label}${outputPort ? '' : ' (unbound)'}` : '';
    const requested = outputPort && output?.type === 'Bool' ? state(scan?.requestedVirtualIntent?.[outputPort]) : outputPort ? 'unsupported' : output ? 'unobserved' : '';
    const safe = outputPort && output?.type === 'Bool' ? state(scan?.safeVirtualIntent?.[outputPort]) : outputPort ? 'unsupported' : output ? 'unobserved' : '';
    lines.push(`${key.padEnd(4)} ${inputName.padEnd(14)} ${inputState.padEnd(11)} | ${outputName.padEnd(14)} ${requested.padEnd(11)} ${safe}`);
  }
  if (result.error) lines.push(`error: ${result.error.message}`);
  return lines.join('\n') + '\n';
}

export async function runConsole(args, commands, { panelOutput = process.stderr, resultOutput = process.stdout } = {}) {
  const options = parseArgs(args);
  const profile = profileFromFile(options.profile);
  const { manifest, bound, values, keyBindings } = setup(options.artifact, profile, options.bindings, options.inputs, !options.profile);
  const consoleIdentity = {
    profile: { id: profile.id, ...(profile.revision ? { revision: profile.revision } : {}), sha256: profile.sha256 },
    bindings: [...bound].map(([channel, port]) => ({ channel, port })),
    physical: 'unconfirmed',
  };
  const scenario = {
    format: 'GhostFlow/scenario-v1', id: `console:${profile.id}`,
    initialInputs: [...values].map(([name, value]) => ({ name, type: manifest.inputs.find(field => field.name === name).type, value })),
    keyBindings, actions: [],
  };
  let atMs = 0; let result;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostsim-console-'));
  const scenarioPath = path.join(temporary, 'session.toon');
  function scan() {
    scenario.actions.push({ kind: 'scan', atMs });
    fs.writeFileSync(scenarioPath, encode(scenario) + '\n');
    const run = runScenario(options.artifact, scenarioPath, { format: 'json' });
    result = JSON.parse(run.encoded);
    panelOutput.write(panel(profile, bound, result.scans.at(-1), result));
    return run.success;
  }
  try {
    for await (const raw of commands) {
      const command = raw.trim();
      if (!command) continue;
      if (command === 'exit') break;
      const named = /^toggle\s+(.+)$/u.exec(command);
      if (/^[1-8]$/u.test(command) || named) {
        const channel = named ? profile.inputs.find(item => item.name === named[1]) : profile.inputs[Number(command) - 1];
        if (!channel) throw new Error(`unknown input channel ${named?.[1] ?? command}`);
        const port = bound.get(channel.name);
        if (!port || channel.type !== 'Bool') throw new Error(`input channel ${channel.name} is unbound or unsupported`);
        const value = !values.get(port);
        values.set(port, value);
        const key = keyBindings.find(item => item.input === port)?.key;
        scenario.actions.push(key ? { kind: 'key', key, event: value ? 'down' : 'up' } : { kind: 'input', name: port, type: 'Bool', value });
        if (!scan()) break;
      } else if (/^scan\s+\d+$/u.test(command)) {
        const time = Number(command.slice(5).trim());
        if (!Number.isSafeInteger(time) || time < atMs) throw new Error('scan time must be a nondecreasing safe integer');
        atMs = time;
        if (!scan()) break;
      } else throw new Error(`unknown command ${command}`);
    }
    if (!result) scan();
    if (options.record) fs.copyFileSync(scenarioPath, options.record);
    result.console = consoleIdentity;
    resultOutput.write(options.format === 'json' ? JSON.stringify(result) + '\n' : encode(result) + '\n');
    return result.outcome === 'completed' ? 0 : 1;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

export async function* terminalCommands(input = process.stdin, promptOutput = process.stderr) {
  const wasRaw = Boolean(input.isRaw);
  input.setRawMode(true);
  input.resume();
  let line = null;
  try {
    for await (const chunk of input) {
      for (const char of String(chunk)) {
        if (char === '\x03' || char === '\x04') {
          yield 'exit';
          return;
        }
        if (line === null) {
          if (/^[1-8]$/u.test(char)) yield char;
          else if (char === ':') { line = ''; promptOutput.write(':'); }
          continue;
        }
        if (char === '\r' || char === '\n') {
          promptOutput.write('\n');
          const command = line.trim();
          line = null;
          if (command) yield command;
        } else if (char === '\x7f' || char === '\b') {
          if (line.length) { line = line.slice(0, -1); promptOutput.write('\b \b'); }
        } else if (char >= ' ' && char !== '\x7f') {
          line += char;
          promptOutput.write(char);
        }
      }
    }
  } finally {
    input.setRawMode(wasRaw);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === cli) {
  try {
    const commands = process.stdin.isTTY
      ? terminalCommands(process.stdin, process.stderr)
      : readline.createInterface({ input: process.stdin, terminal: false });
    process.exitCode = await runConsole(process.argv.slice(2), commands);
  } catch (error) {
    process.stderr.write(`ghostsim-console: ${error.message}\n`);
    process.exitCode = 1;
  }
}
