# Continuous Bool timer metadata and compatibility contract

Status: Main-reviewed implementation handoff for NT-T1-A, 2026-09-15.
Tracking: language #46 / local TASK-85.2.1. Compiler implementation remains #47.

This contract fills one narrow gap: measure how long a Bool condition has stayed
continuously `true`, while returning zero as soon as the condition is `false`.
It does not add calendar time, a new VM opcode, pause/resume accumulation, or a
general stream library. Existing `elapsed(state)` behavior remains unchanged.

## Two different elapsed meanings

The existing timer descriptor is legacy and remains valid:

```json
{"name":"age","state":"phase","clockInput":"__gf_now_ms"}
```

It means “time since the referenced state last changed.” It can therefore report
time in either state, including how long a Bool has been false. New consumers
must continue accepting this exact three-field descriptor with its current
semantics and generated `since` / `initialized` state bindings.

The new descriptor is exact and explicitly different:

```json
{"name":"active_for","mode":"continuous-true","clockInput":"__gf_now_ms"}
```

It means “time for which the authored Bool condition has remained continuously
true; otherwise zero.” The condition expression is already compiled into GFB1
and is linked through the timer declaration's source trace. It is not duplicated
as an editable expression string in the manifest.

The public source spelling that produces this descriptor is intentionally not
chosen by NT-T1-A. That language-surface decision must be reviewed before #47
accepts new source syntax. The descriptor, lowering semantics, compatibility and
tests below are fixed independently of that spelling.

## Exact consumer compatibility

The timer list remains in the current control manifest; its top-level format is
not changed merely to add this descriptor.

A new consumer accepts exactly either:

- legacy: keys `name`, `state`, `clockInput`; or
- continuous: keys `name`, `mode`, `clockInput`, with
  `mode == "continuous-true"`.

It rejects a mixed descriptor (`state` plus `mode`), missing/extra fields,
unknown mode, invalid names, duplicate timer names, or any clock input other
than `__gf_now_ms`, before VM instantiation or state mutation. It must not reject
all legacy manifests just because continuous descriptors are supported.

The existing consumer already exact-checks the legacy key set. Consequently it
rejects a continuous descriptor before execution: `mode` is unknown and `state`
is absent. That fail-closed result is required and must have a regression test.
There is no downgrade from a rejected continuous descriptor to legacy elapsed.

Signed portable packages continue to cover the exact manifest and source map.
Package verification must use the consumer profile that understands the selected
descriptor; a valid signature does not make an unsupported descriptor executable.

## Lowering with two private states

Each continuous timer owns exactly two generated states, independent of every
other timer instance:

| role | generated name | initial value | meaning |
|---|---|---:|---|
| `wasTrue` | `__gf_timer_was_true_<timer>` | `false` | condition was true on the preceding accepted scan |
| `since` | `__gf_timer_since_<timer>` | `0` | monotonic millisecond instant at which this uninterrupted true interval began |

For the current scan's compiled Bool `condition` and accepted monotonic `now`,
the timer value and next states are equivalent to:

```text
value      = if condition && wasTrue then now - since else 0
wasTrue'   = condition
since'     = if !condition then now
             else if !wasTrue then now
             else since
```

The timer value is a `Duration` and uses the existing exact non-negative
millisecond clock boundary. The host rejects an unsafe, missing, non-integer or
backward `now` before executing the scan. A rejected scan does not update either
private state and does not return a stale trace as a new result.

The condition is a typed Bool expression under the language's normal current/
previous-state rules. NT-T1-A does not permit an implicit `Result<Bool>` to Bool
conversion. A sensor fault must be handled explicitly by the author, for example
by selecting `false` in the fault branch; only that resulting Bool reaches this
timer. The compiler does not invent “fault means false” as a global policy.

This lowering uses existing constants, Bool operations, conditionals, subtraction,
state transitions and monotonic clock input. GFB1 format/opcodes and the Rust/WASM
VM are unchanged. #47 owns compiler emission and conformance, not a second timer
engine in a host adapter.

## Source and trace metadata

The authored timer declaration remains the authoritative source node. Its two
private state bindings use the existing `generated` record with these exact roles:

- `{ declaration: <timer>, role: "wasTrue" }`
- `{ declaration: <timer>, role: "since" }`

Both bindings point to the same timer declaration node and expose
`stateBefore` / `stateAfter`. The manifest descriptor, both generated state names,
node ID/kind/location and source/bytecode revisions must agree during strict
source-map recovery. Missing, duplicate, swapped, mixed legacy/continuous roles,
or a generated state belonging to another timer is rejected.

Validation is descriptor-profile aware: legacy descriptors require exactly the
existing `since` / `initialized` pair; continuous descriptors require exactly
the `wasTrue` / `since` pair above. Strict recovery therefore receives the
already validated manifest together with bytes, source map and trace metadata,
and cross-checks descriptor name/mode/clock input against the generated roles.
Checking trace metadata without its manifest cannot establish this agreement.

Static dependencies for the timer value include every possible read of the
compiled Bool condition, following the existing rule that both conditional
branches are possible static reads. They are not a claim that every read caused
the observed elapsed value. The additive dependency target is exactly
`{ field: "timerValue", name: <timer> }`; reads retain the existing `inputs`,
`stateBefore`, and `stateAfter` field vocabulary. Runtime traces continue to
distinguish previous and next state; UI timing-chart and intent navigation are
separate consumers.

## T01 conformance vectors

Every vector starts with a fresh runtime unless the rows explicitly continue one
instance. `value` is the timer's value visible in that scan.

| vector | accepted scans `(now, condition → value)` | required result |
|---|---|---|
| T01-FALSE | `(0,F→0)`, `(500,F→0)` | false is immediately and continuously zero |
| T01-FIRST | `(1000,T→0)` | first true scan starts the interval at zero |
| T01-SAME | `(1000,T→0)`, `(1000,T→0)`, `(1500,T→500)` | same timestamp does not advance or reset |
| T01-RESET | `(0,T→0)`, `(900,T→900)`, `(901,F→0)`, `(1200,T→0)`, `(1300,T→100)` | false resets; a later true begins a new interval |
| T01-ROLLBACK | accept `(1000,T→0)`, reject `(999,T)`, then accept `(1500,T→500)` | rollback rejects before mutation; interval is preserved |
| T01-CLOCK-INVALID | after one accepted scan, try missing, negative, fractional and unsafe `now` | every scan is rejected before mutation, returns no new result, and the next valid scan continues from the last accepted state |
| T01-FAULT | explicit fault branch yields `F` after a true interval | value becomes zero; no implicit sensor coercion |
| T01-RESULT-TYPE | compile a `Result<Bool>` sensor/signal directly as the timer condition | compilation fails; an explicit `case ok(...) / fault(...)` Bool is required |
| T01-INSTANCES | A true from 0; B first true at 700 | A and B keep distinct `wasTrue`/`since` and values |
| T01-SOURCE | one literate declaration compiled and recovered | descriptor, two roles, node location and both revision hashes agree |

Compatibility vectors additionally prove:

1. the new consumer runs an unchanged valid legacy manifest and produces the
   existing elapsed trace;
2. the old consumer rejects the continuous descriptor before VM creation;
3. the new consumer rejects mixed, unknown-mode, extra-field and malformed
   descriptors before VM creation;
4. native and WASM traces match for the same accepted scan tape after #47.

## Evidence boundary and handoff

Completion of NT-T1-A is a reviewed contract, not compiler implementation.
NT-T1-B/#47 may proceed only after choosing the public source spelling through
the language review. Its acceptance requires compiler, manifest consumer,
source-map, native and WASM conformance. Device clock adapters, firmware upload,
GPIO, relays, physical loads, calendar time and farmer-facing UX remain separate
gates.
