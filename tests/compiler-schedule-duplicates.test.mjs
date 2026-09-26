import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlCompileError } from '../tools/control.mjs';

const document = body => `# Schedule duplicate\n\n\`\`\`ghost\ncontrol DuplicateSchedule {
  schedule starts: DailySlots<15min> {
${body}
  }
  output due: Bool;
  due <- true;
}\n\`\`\`\n`;
const cases = [
  ['timezone same value', '    timezone = "UTC";\n    §timezone = "UTC";\n    selected = [];', 'timezone'],
  ['timezone different value', '    timezone = "UTC";\n    §timezone = "Asia/Seoul";\n    selected = [];', 'timezone'],
  ['selected same value', '    timezone = "UTC";\n    selected = [06:00];\n    §selected = [06:00];', 'selected'],
  ['selected different value', '    timezone = "UTC";\n    selected = [06:00];\n    §selected = [18:00];', 'selected'],
];

for (const [label, body, key] of cases) test(`DailySlots duplicate option: ${label}`, async () => {
  const marked = document(body); const offset = marked.indexOf('§');
  const before = marked.slice(0, offset); const line = before.split('\n').length; const column = offset - before.lastIndexOf('\n');
  const source = marked.replace('§', '');
  await assert.rejects(() => compileSource(source, { filename: 'schedule-duplicates.ghost.md' }), error => {
    assert.equal(error.constructor, ControlCompileError);
    assert.equal(error.name, 'ControlCompileError');
    assert.equal(error.line, line); assert.equal(error.column, column);
    assert.equal(error.message, `schedule-duplicates.ghost.md:${line}:${column}: duplicate DailySlots option ${key}`);
    assert.equal(error.filename, 'schedule-duplicates.ghost.md');
    return true;
  });
});

test('DailySlots unique timezone and selected fields remain valid', async () => {
  const artifact = await compileSource(document('    timezone = "UTC";\n    selected = [06:00, 18:00];'), { filename: 'schedule-duplicates.ghost.md' });
  assert.ok(artifact.manifest.schedules.some(schedule => schedule.name === 'starts'));
});
