import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';

test('true_for keeps the Driver-certified interval contract in the compiled manifest', async () => {
  const filename = 'true-for.ghost.md';
  const marked = `# True for evidence

\`\`\`ghost
control TrueForEvidence {
  input hot: Bool;
  signal sustained = §true_for(hot, duration: 5min, quality: measured);
  output alarm: Bool;
  alarm <- sustained |> recover(false);
}
\`\`\`
`;
  const artifact = await compileSource(marked.replace('§', ''), { filename });
  assert.equal(artifact.manifest.signals[0].kind, 'true-for');
  assert.equal(artifact.manifest.signals[0].quality, 'measured');
  assert.deepEqual(Object.keys(artifact.manifest.signals[0].intervalInputs),
    ['present', 'epoch', 'id', 'start', 'end', 'value', 'quality', 'fault']);
});
