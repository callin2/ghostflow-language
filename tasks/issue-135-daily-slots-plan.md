# Issue 135: literal DailySlots execution

Tracker: https://github.com/callin2/ghostflow-language/issues/135

**Status:** all four steps are complete.

## Scope

- **Goal:** execute the unchanged `REF-03-032` through the shared Rust schedule
  runtime.
- **Supported:** literal `DailySlots<15min>` selections with `pulse`,
  `trusted_only`, `baseline` and `skip`.
- **Not executable yet:** the config-selected `REF-03-057` remains a
  non-executable descriptor until keyed settings edits and persistence exist.

## Steps

1. [x] Add GFB9/control-v8 for the literal DailySlots descriptor and stable
   literal slot keys.
2. [x] Extend Rust schedule facts and admission identity with the source day,
   slot key and DST fold. Rust keeps ownership of the predicate, crossing,
   terminal ledger and transaction.
3. [x] Add GFSF v3, public WASM and ghostsim integration with explicit provider
   facts. Reject missing, stale, malformed and caller-computed outcomes.
4. [x] Prove the unchanged Reference source through native, WASM and simulator
   tests, including bounded capacity and atomic rollback.

Out of scope: Device revisions, physical output claims, and changes to the
Reference source or expectations.
