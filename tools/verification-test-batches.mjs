// Console recording replays every committed prefix in a child process. Run it
// without other test workers competing for CPU; retain every test and timeout.
export function languageTestBatches(tests) {
  const isolated = 'tests/ghostsim-console.test.mjs';
  return [tests.filter(test => test === isolated), tests.filter(test => test !== isolated)]
    .filter(batch => batch.length > 0);
}
