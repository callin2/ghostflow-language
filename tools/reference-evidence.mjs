export function referenceCaseTitle(entry) {
  return `${entry.id} [${entry.scope}] ${entry.rule}`;
}

export function executableReferenceSelector(ref, entry) {
  return ref.path === 'tests/reference-cli.test.mjs'
    && entry?.status === 'executable'
    && ref.caseId === entry.id
    && ref.testId === referenceCaseTitle(entry);
}

export function externalOracleCaseIds(catalog, cases) {
  const byId = new Map(cases.map(entry => [entry.id, entry]));
  const covered = new Set();
  for (const feature of catalog.entries) {
    for (const evidence of feature.evidence) {
      if (evidence.status !== 'verified') continue;
      for (const ref of evidence.refs) {
        if (ref.caseId && byId.get(ref.caseId)?.status === 'specified' && feature.referenceCaseIds.includes(ref.caseId)) {
          covered.add(ref.caseId);
        }
      }
    }
  }
  return covered;
}

const ids = (chapter, numbers) => numbers.map(number => `REF-${chapter}-${String(number).padStart(3, '0')}`);
const span = (first, last) => Array.from({ length: last - first + 1 }, (_, offset) => first + offset);

// The finite 2026-09-28 kernel freeze. This is scope, not a second evidence registry.
export const frozenCompilerCaseIds = Object.freeze([
  ...ids('00', [3, 5]),
  ...ids('01', [1, 2, ...span(5, 16), ...span(19, 51), 54, ...span(56, 61),
    65, 66, ...span(81, 85), ...span(87, 92), ...span(95, 97),
    100, 101, 110, 111, ...span(113, 115)]),
  ...ids('03', span(1, 7)),
  ...ids('04', [40, 41]),
  ...ids('05', [...span(1, 11), 101, 102, 108]),
]);

export const frozenSpecifiedCaseIds = Object.freeze([
  ...ids('00', [1, 4, 8]),
  ...ids('01', [4, 17, 18, 62, 63, 64, 67, 79, 80, 86, 93, 94, 98, 99, 102, 105]),
  ...ids('03', [9]),
  ...ids('04', [42]),
  ...ids('05', [21]),
  ...ids('06', [12, 17]),
  ...ids('07', [3, 6]),
]);
