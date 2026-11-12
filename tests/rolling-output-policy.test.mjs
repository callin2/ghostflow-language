import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/compile-source.mjs';

const source = '# Applied rolling output limit\n\n```ghost\ncontrol Watering {\n'
  + 'resource irrigation: BoolActuator;\n'
  + 'account applied = on_time(irrigation, stage: applied, persistence: durable, output: pump);\n'
  + 'constraints Budget { limit used(applied, rolling(60s)) <= 30s { reserve = 5s; on_unknown = block; } }\n'
  + 'input manual: Bool; output pump: Bool; pump <- manual |> recover(false);\n'
  + '}\n```\n';
const options = { filename: 'rolling-output-policy.ghost.md' };

test('#96 mandatory applied rolling policy changes the portable Program bytes', async () => {
  const artifact = await compileSource(source, options);
  const changed = await compileSource(source.replace('<= 30s', '<= 25s'), options);
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v29');
  assert.equal(Buffer.from(artifact.bytes).readUInt16LE(4), 29);
  assert.notDeepEqual(artifact.bytes, changed.bytes);
});

test('#96 mandatory profile rejects unsupported output, stage and reservation', async () => {
  for (const [replacement, pattern] of [
    [['output: pump', 'output: missing'], /output/i],
    [['stage: applied', 'stage: safe'], /applied/i],
    [['reserve = 5s', 'reserve = 35s'], /reserve/i],
  ]) {
    await assert.rejects(compileSource(source.replace(...replacement), options), pattern);
  }
});
