# Stale branch reconciliation — 2026-10-03

Base: `fc34996bf456347034c721202048271d57971bf0` (`origin/dev`).
Both original tips are retained through merge commits. This report records
historical reconciliation evidence, not new signed Solar package acceptance.

## Schedule source trace

Original [source fix and signed Solar test](https://github.com/callin2/ghostflow-language/commit/968db691433d5e15700437df89e5e1b1c6a24b5b)
adds schedule input bindings. The production fix is already present through
[b1670e31819ac0b9d5805dc18187498b86b11c0b](https://github.com/callin2/ghostflow-language/commit/b1670e31819ac0b9d5805dc18187498b86b11c0b).
Current `tools/source-trace.mjs` remains byte-identical to the base. The existing
`schedule generated inputs preserve declaration bindings through artifact
publication` test passes for Solar and DailySlots, including missing-binding
rejection.

The original signed Solar success test was evaluated unchanged. Its compilation
emits `GhostFlow/control-v3` with GFB version **5**. It fails at
`tools/portable-package.mjs` admission with `unsupported-bytecode-version`.
The [portable package contract](../PORTABLE-PACKAGE.md) and current builder and
signed-payload verifier admit versions 1, 2, 3, 4, 10 and 11; `compileSource`
offers no target-profile option. Expanding package or Device compatibility is
outside this reconciliation. The unsupported success test remains reachable in
its original commit, rather than becoming an active skipped or weakened test.
Current `tests/portable-package.test.mjs` remains byte-identical to the base.

Failure log: `/var/folders/bt/lvx6vmp905n753cfmj6s5sdw0000gn/T/codex-test-logs/test-compact.HFxN5Km1`.
One selected test failed. No signed Solar acceptance is claimed.

## PC-01 projection

Original [generated refresh](https://github.com/callin2/ghostflow-language/commit/6a2f48b754bf055bc8a0ae670ce8f3b1f2d99bf7)
changes three generated files only. Its recorded book/projection digests
(`b61ba3e394ed3e0880f61f8a9e9f68833382c97b10852345c7f0273a80f5c833`,
`9228a58d6da9ff456c492a9fd58d8488d0b214c8070e32aff311d188760e53a0`)
do not match its committed book/projection bytes
(`508530b8b958b82dc85c95a9cb43577931a733a9a7a59d4a92cec6d2d417a2b4`,
`713487ea32586c83d3c35fa2f455b11088ca989f37dde4e0276aa74e4ff2401a`).
The refresh is superseded. Current catalog, replay scenarios and generated
PC-01 document remain byte-identical to the base. The canonical generator's
`--check` passes. Historical benchmark records and expected hashes are unchanged.

## Remote branch lifecycle

The [development workflow](../DEVELOPMENT-WORKFLOW.md) now records automatic
same-repository merged-`dev` head deletion with an exact remote-tip lease.
Permanent, fork, absent and advanced heads are preserved. Local branches and
dirty worktrees are untouched. Mocked regressions verify eligibility, exclusions,
exact leased deletion and propagation of a concurrent-update rejection.
