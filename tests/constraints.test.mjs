import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileConstraints, ConstraintCompileError } from '../tools/constraints.mjs';

const source = `
// Extracted canonical-literate rules: bindings are resolved by the parent host runtime.
constraints StationRules {
  exclusive(automatic, manual, configuring);
  allow enter(Auto, Manual, Configure)
    only when mode == Stopped && stopped(station);
  allow apply(settings)
    only when mode == Configure && stopped(station);
  require count_on(pump1.valves) <= 2;
  require pump1.on => any_on(pump1.valves);
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
  once starts per occurrence;
  check pump_capacity(pump1);
  require pump_capacity(pump1) == Pass;
}
constraints SharedPump {
  // Generic activities remain parseable; the host decides whether it supports them.
  exclusive(watering, flushing);
}
`;

const artifact = compileConstraints(source, { filename: 'StationRules.ghost' });
assert.deepEqual(artifact, {
  format: 'GhostFlow/constraints-v1',
  groups: [
    { name: 'StationRules', rules: [
      { kind: 'exclusive', activities: ['automatic', 'manual', 'configuring'] },
      { kind: 'enterStopped', modes: ['Auto', 'Manual', 'Configure'], station: 'station' },
      { kind: 'configureOnly', settings: 'settings', station: 'station' },
      { kind: 'maxValves', pump: 'pump1', max: 2 },
      { kind: 'pumpNeedsValve', pump: 'pump1' },
      { kind: 'dailyLimit', pump: 'pump1', limitMs: 3_600_000, timezone: 'Asia/Seoul' },
      { kind: 'once', schedule: 'starts' },
      { kind: 'capacityCheck', pump: 'pump1', required: false },
      { kind: 'capacityCheck', pump: 'pump1', required: true },
    ] },
    { name: 'SharedPump', rules: [{ kind: 'exclusive', activities: ['watering', 'flushing'] }] },
  ],
});

// Every standalone named-constraints example in the contract remains valid
// source.  (The surrounding control and schedule snippets are intentionally
// outside this separate-file parser's scope.)
const contract = fs.readFileSync(new URL('../docs/CONSTRAINTS.md', import.meta.url), 'utf8');
const documentedGroups = [...contract.matchAll(/^```(?:ghost|text)\n(constraints\s+[\s\S]*?)^```$/gm)]
  .map(match => match[1]);
assert.ok(documentedGroups.length >= 6, 'expected named constraint examples in CONSTRAINTS.md');
const documentedArtifact = compileConstraints(documentedGroups.join('\n'), { filename: 'docs/CONSTRAINTS.md' });
assert.ok(documentedArtifact.groups.some(group => group.name === 'StationRules'));
assert.ok(documentedArtifact.groups.some(group => group.name === 'SharedPump'));
assert.ok(documentedArtifact.groups.some(group => group.rules.some(rule => rule.kind === 'capacityCheck' && !rule.required)));

function expectError(input, text) {
  assert.throws(() => compileConstraints(input, { filename: 'bad.ghost' }), error =>
    error instanceof ConstraintCompileError && error.message.includes(`bad.ghost:`) && error.message.includes(text));
}

expectError('constraints X { warn pressure when pressure < 1; }', 'unsupported constraint expression warn');
expectError('constraints X { require pump.on => valve; }', 'unsupported require constraint');
expectError('constraints X { limit on_time(pump) <= 1h per day("Not/AZone"); }', 'invalid IANA timezone');
expectError('constraints X { require count_on(pump.valves) <= 2.5; }', 'expected ; after max-valves requirement');
expectError('constraints X { check pump_capacity(pump); } constraints X { once start per occurrence; }', 'duplicate constraint group X');
expectError('constraints X { allow enter(Auto) only when mode == Running; }', 'unsupported allow enter condition');
expectError('constraints X { require pump_capacity(pump); }', 'expected == Pass');
expectError('constraints X { once starts per day; }', 'expected occurrence after per');
expectError(`constraints X { ${'('.repeat(33)}`, 'parser nesting exceeds 32');
expectError(`constraints X { ${Array.from({ length: 1025 }, () => 'once starts per occurrence;').join(' ')} }`, 'rule count exceeds 1024');
expectError('x'.repeat(256 * 1024 + 1), 'source byte limit exceeded');

// The parser only handles source text.  This confirms no source is evaluated.
assert.doesNotThrow(() => compileConstraints('constraints Safe { once starts per occurrence; }'));
expectError('constraints Safe { globalThis.pwned(); }', 'unsupported constraint expression globalThis');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostrules-test-'));
const input = path.join(dir, 'rules.ghost.md');
const plainInput = path.join(dir, 'rules.ghost');
const output = path.join(dir, 'rules.json');
fs.writeFileSync(input, `# Station rules\n\n\`\`\`ghost\n${source}\`\`\`\n`);
fs.writeFileSync(plainInput, source);
execFileSync(process.execPath, ['tools/ghostrules.mjs', input, output], { cwd: process.cwd(), stdio: 'pipe' });
assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), artifact);
execFileSync(process.execPath, ['tools/ghostrules.mjs', '--check', input], { cwd: process.cwd(), stdio: 'pipe' });
assert.throws(
  () => execFileSync(process.execPath, ['tools/ghostrules.mjs', '--check', plainInput], { cwd: process.cwd(), stdio: 'pipe' }),
  error => String(error.stderr).includes('requires a canonical .ghost.md literate source'),
);

console.log(`constraints tests passed (${artifact.groups.length} groups, ${artifact.groups[0].rules.length} StationRules rules)`);
