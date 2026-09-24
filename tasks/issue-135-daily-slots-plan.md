# Issue 135: literal DailySlots execution

Tracker: https://github.com/callin2/ghostflow-language/issues/135

## Scope

Execute unchanged `REF-03-032` through the shared Rust schedule runtime. This
slice supports literal `DailySlots<15min>` selections with `pulse`,
`trusted_only`, `baseline` and `skip`. Config-selected `REF-03-057` remains a
non-executable descriptor until keyed settings edits and persistence exist.

## Steps

1. Add GFB9/control-v8 for the literal DailySlots descriptor and stable literal
   slot keys.
2. Extend Rust schedule facts and admission identity to source day, slot key and
   DST fold. Rust retains predicate, crossing, terminal ledger and transaction
   ownership.
3. Add GFSF v3, public WASM and ghostsim integration with explicit provider
   facts. Reject missing, stale, malformed and caller-computed outcomes.
4. Prove the unchanged Reference source through native, WASM and simulator
   tests, including bounded capacity and atomic rollback.

No Device revision, physical output claim, Reference source or expectation
changes are in scope.
