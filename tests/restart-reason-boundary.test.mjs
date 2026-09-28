import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chapter = fs.readFileSync(new URL('../docs/reference/05-settings-and-observation.md', import.meta.url), 'utf8');
const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/03-settings-boundaries.json', import.meta.url), 'utf8')).cases;
const ref05107 = cases.find(entry => entry.id === 'REF-05-107');

function restartRun({ runId, driverResetCause }) {
  return {
    runId,
    restart_reason: driverResetCause ?? 'Unknown',
  };
}

test('REF-05-107 [runtime] 근거 없는 재시작 원인은 Unknown이다.', () => {
  assert.equal(ref05107?.issue, 'https://github.com/callin2/ghostflow-language/issues/339');
  assert.equal(ref05107.status, 'specified');
  assert.match(ref05107.rule, /Unknown/);
  assert.match(ref05107.given, /reset cause/);
  assert.match(ref05107.then, /restart_reason은 Unknown이고 한 run에서 고정된다/);
  assert.match(ref05107.then, /PowerOn 또는 정전 복구로 추측하지 않는다/);
  assert.match(chapter, /type RestartReason = PowerOn \| Brownout \| Watchdog \| Software \| Unknown;/);
  assert.match(chapter, /input restart_reason: RestartReason;/);
  assert.match(chapter, /근거가\s+없으면 `Unknown`이다/);
  assert.match(chapter, /`PowerOn`만으로 정전 복구라고 단정하지 않는다/);
  assert.match(chapter, /이 입력은 한 run\s+동안 고정된다/);

  const first = restartRun({ runId: 'run.restart-unknown.1', driverResetCause: null });
  assert.deepEqual(first, { runId: 'run.restart-unknown.1', restart_reason: 'Unknown' });
  assert.notEqual(first.restart_reason, 'PowerOn');
  const sameRunLater = { ...first, scanId: 3 };
  assert.equal(sameRunLater.restart_reason, first.restart_reason);

  const confirmed = restartRun({ runId: 'run.restart-poweron.1', driverResetCause: 'PowerOn' });
  assert.deepEqual(confirmed, { runId: 'run.restart-poweron.1', restart_reason: 'PowerOn' });
  assert.notEqual(confirmed.runId, first.runId);
  assert.equal(confirmed.restart_reason === 'PowerOn', true, 'PowerOn requires explicit driver evidence in the fixture');
});
