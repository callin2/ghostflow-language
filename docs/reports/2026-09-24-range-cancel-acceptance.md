# Range `cancel_when` compiler acceptance — 2026-09-24

Issue: [ghostflow-language #139](https://github.com/callin2/ghostflow-language/issues/139)

Audited base: `f809b4d327f8222acc4f00fa1277e02e8a8688df`.

The civil schedule parser now accepts `cancel_when`; the policy checker requires
a Bool expression for Range, preserves its expression as `cancelWhen`, and
rejects missing cancellation, non-positive duration, and overlapping proven
recurrences. The supported proof subset is UTC Daily and DailySlots, plus
Periodic schedules with a fixed instant or persisted epoch anchor. Exact
boundary contact is accepted, including UTC DailySlots across midnight. Civil
Periodic anchors and non-UTC Daily or DailySlots Range schedules are rejected
because recurrence non-overlap cannot be proved without timezone transition
analysis. This includes repeated and next-valid DST policies. Pulse policies
reject an unused `cancel_when` field.

The settings candidate helper reads configs from either an executable control
manifest or the canonical `GhostFlow/schedule-descriptor-v1` `control` member.
Returned descriptor artifacts remain wrapped and non-executable.

## Verification

| Command | Result |
| --- | --- |
| `node --test tests/range-contract.test.mjs` | exit 0; 7 passed |
| `node --test tests/operating-settings.test.mjs` | exit 0; 9 passed |
| `node --test tests/daily-slots-policy.test.mjs tests/periodic-cron-policy.test.mjs tests/schedule-descriptor-artifact.test.mjs` | exit 0; 107 passed |
| `cargo test --locked --offline -p ghostflow-core --test range_schedule` | exit 0; 11 passed |

After the recurrence proof review, the focused Range contract passed 7/7 with
regressions for a New York 01:30 repeated occurrence, a New York 08:00 24-hour
Daily range, a next-valid DST gap, and a civil Periodic anchor. No timezone
engine or broader runtime claim was added.

The first combined settings run had one infrastructure failure because the fresh
worktree lacked the WASM artifact. After
`cargo build --locked --offline -p ghostflow-wasm --target wasm32-unknown-unknown --release`
completed with exit 0, the blocked settings file passed 9/9.

The Rust Range runtime test `exact_end_is_terminal_and_cancel_never_rearms`
continues to prove termination without rearming. This change preserves the
compiled cancellation predicate in the checked descriptor; it does not make
schedule descriptors executable. That integration remains owned by
[issue #135](https://github.com/callin2/ghostflow-language/issues/135).
