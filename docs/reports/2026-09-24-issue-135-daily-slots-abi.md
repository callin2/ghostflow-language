# Literal DailySlots execution ABI — 2026-09-24

Issue 135's second slice executes the unchanged `REF-03-032` literate source.
It supports literal `DailySlots<15min>` selections with explicit IANA timezone,
DST policies, `pulse`, `trusted_only`, `skip_after`, `baseline`, `fallback =
skip`, and a compiled Bool predicate. Config-selected `REF-03-057` remains a
non-executable descriptor because it requires keyed live settings and persistence.

## Versions and identity

GFB9 adds prelude tag 4. Its descriptor contains site, name, timezone, the exact
900000 ms grid, DST policies, policy tags, gap, 1–96 sorted literal pairs, and
the compiled predicate. Each pair is `(slotKey, minuteOfDay)`. Literal slot keys
are `minuteOfDay + 1`, so they are stable under source reordering. Retiming is a
new literal definition; this slice does not claim live key retention.

`GhostFlow/control-v8` requires GFB9 and DailySlots-only descriptors.
GFSF v3 adds `daily-slots` kind plus `slotKey` and `minuteOfDay` row fields.
GFB8 remains bound to GFSF v2. A GFSF v2 packet cannot drive GFB9.
Mixed Solar/Daily and DailySlots modules remain explicitly unsupported because
the host exposes one activation and fact channel per civil schedule module.

The terminal identity is `(sourceDay, slotKey, fold)` within its schedule site.
`minuteOfDay` is always the declared slot minute. A provider may adjust the
planned wall instant under `next_valid`, but it does not rewrite the declared
minute. Fold and source day describe that civil occurrence.

## Ownership and rejection

The provider supplies bounded occurrence facts, coverage, clock evidence, and
provider/context revisions. Rust validates each row against the installed
descriptor and DST fold policy. Rust owns clock crossing, predicate evaluation,
terminal ledger, missed outcomes, projections, state transitions, and commit.
Caller supplied `due` fields are rejected.

Rows must be strictly ordered by occurrence identity. Wrong kind, site, slot
key, minute, fold, transport version, capacity, or shape rejects the tick.
Capacity exhaustion never evicts terminal history. A downstream VM failure
rolls back ledger, VM state, clock, output, and journal together. Trace evidence
retains slot identity, declared minute, scheduled wall time, terminal outcome,
and provider/context revisions.

The existing GFSF packet limits remain 65536 bytes, 128 schedules, 4096 rows per
schedule, 128 UTF-8 bytes per revision, and activation capacity 1–4096 entries
per schedule.

## Evidence boundary

Focused native tests cover descriptor bounds, wrong identities, duplicate
suppression, capacity, and transaction rollback. Focused WASM tests compile the
unchanged REF-03-032 source and verify GFB9/GFSF3 crossing plus malformed and
downgrade rejection. Ghostsim and the independent reference oracle expect
`due = false` before the supplied occurrence and `due = true` at its crossing.

This is virtual schedule execution. It does not verify an IANA provider,
firmware support, Device timing, requested/applied/confirmed physical outputs,
or the unsupported config-selected schedule.
