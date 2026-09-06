# GhostFlow language contract, MVP 0.1

## Design invariants

1. Hardware is addressed by semantic capability, not board, pin, or product.
2. A tick is deterministic and atomic.
3. Feedback crosses an explicit state boundary.
4. Every effect is an intent interpreted by a host driver and safety kernel.
5. Every active strategy is uniquely selected from a device profile.
6. Every accepted module has statically bounded state and expression cost.
7. Replay never invokes a physical effect sink.

## Program elements

- `module`: stable module identity.
- `version`: unsigned schema version.
- `input`: a named boolean or number stream sample.
- `state`: a named boolean or number retained between ticks.
- `strategy`: device query plus state transitions and intents.
- `next`: simultaneous state transition expression.
- `intent`: desired actuator output after transitions are computed.
- `requires`, `mutex`: native safety constraints.

Names are ASCII identifiers containing letters, digits, `_`, `-`, and `.`.
Duplicate names are errors. References are checked by the compiler and again by
the bytecode verifier.

## Device-query semantics

A device profile is a set of `(kind, name, type)` capabilities. A strategy
matches when its query evaluates true. The matching strategy with the greatest
integer priority is selected. No match is an activation error. Multiple matches
at the winning priority are an ambiguity error.

Selection is stable during a tick. Adding, removing, failing, or recovering a
device creates a candidate profile that must be activated at a safe boundary.
The host may shadow-run the candidate before committing it.

This deliberately borrows progressive enhancement from CSS media queries but
does not borrow CSS cascade or source-order precedence.

## Tick semantics

1. Missing inputs are rejected; hosts must submit an explicit fault/status
   input if absence is meaningful.
2. All `next` expressions read the same old state and input snapshot.
3. Computed next states are committed simultaneously.
4. All `intent` expressions read the committed next state.
5. Safety constraints transform intents into safe outputs.
6. The journal records input, old/new state, requested/safe intents, strategy,
   and faults.

`next.NAME` is valid only in intent expressions. This prevents transition order
from leaking into semantics.

## Time travel and ghost execution

The journal stores initial state and bounded tick records. Rewind restores a
prior recorded state without executing intents. Replay creates an isolated VM,
feeds recorded input snapshots, and captures a shadow trace. A replacement
module or device profile can be used for branch comparison.

Wall-clock time is ordinary input data. The runtime uses monotonically
increasing logical tick numbers for ordering, so clock correction cannot rewrite
causal order.

## Hot replacement

`Runtime::hot_swap` is transactional: parse and verify the candidate, select a
unique strategy for the current capability profile, migrate compatible state,
then commit. Same-name/same-type state values migrate automatically. New states
receive declared defaults. Removed states disappear. A type change requires an
explicit future migration module and is rejected by the MVP.

## Error model

The VM does not throw language exceptions. Public operations return a status
and diagnostic. Hardware failure, stale data, timeout, and disconnected sensors
must be represented by typed inputs in future revisions; the MVP represents
them through explicit boolean status inputs.
