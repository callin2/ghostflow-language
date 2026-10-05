# GFB bytecode

## Provisional lifecycle framing

The local GFB21 candidate wraps unchanged inner GFB bytes and the checked restart
descriptor; see [Scan frame WASM](SCAN-FRAME-WASM.md#restart-lifecycle-extension).
GFB19 continues to mean live Range start and GFB20 means keyed TimeSlots Range.
The published `ghostflow-runtime-99ca1a3` lifecycle GFB19 wrapper collides with
the current Range allocation and is rejected by the combined loader, without
translation or fallback. Its historical bytes and consumer pins remain fixed.
Recompile reviewed source for a distinct owner candidate; 21 is provisional
pending allocation coordination. This does not publish a new format or release.

GFB18 adds the adopted calendar boundary profile `GhostFlow/control-v18`.
Prelude tag 17 is a calendar-filtered immutable UTC Daily Range; tag 18 is a
typed calendar Result with protected Bool/Bool/fault-code inputs. Their exact
layouts and unchanged GFSF5 facts are in
[Context execution ABI](CONTEXT-EXECUTION-ABI.md#gfb18-calendar-boundaries).
Range rejects work intervals crossing midnight while permitting explicit
separate ranges ending at midnight and starting on the next date. Existing
ordinary Range and older binary layouts retain their semantics. A GFB18 header
is required for these tags; older loaders reject it. These identifiers do not
certify a Device release or physical execution.

## Bounded natural policies (GFB13)

Only extended Solar/Tide policies select GFB13 and `GhostFlow/control-v12`; legacy profile bytes remain unchanged. Solar tag 1 retains its layout and appends after the `when` expression `holdMs:u64` (0 means none) and `fallbackAtMs:u64` (86400000 means skip). Context records append `holdMs:u64` after the cancellation expression. Manifest policies are objects: clock `{kind: 'hold_trusted', durationMs, terminal: 'skip'}`, fallback `{kind: 'fixed_time', atMs, terminal: 'skip'}`.

Extended Solar facts use GFSF6: retain the Solar v1 row layout and append after provider/context strings optional `fallbackWallMs` and `unavailableReason:u8` (255 means none; 0–5 are natural-context reason codes). Legacy v1 packets and WASM function names remain unchanged. Pinned older runtimes reject GFB13 before activation. The signed portable-package config-only GFB11 profile remains narrow. This format is not physical Device evidence.

All integers are little-endian. Strings are `u16 length` followed by UTF-8
bytes. Values use a bounded postfix stack; conditional expressions use forward
branches. Public compilation accepts a complete canonical `.ghost.md` document.
The S-expression representation in `tools/gfb1.mjs` is internal compiler IR.

## Module envelope and format decision

- magic: `GFB1` (the envelope magic is unchanged)
- format version: `u16`
- module name: string
- module version: `u32`
- inputs: `u16 count`, then `(name, type)` records
- states: `u16 count`, then `(name, type, default value)` records
- strategies: `u16 count`, then strategy records
- safety constraints: `u16 count`, then constraint records
- format 4 temporal header: after states, `nowInput`, `timeEpochInput`, and root table
- format 4 temporal strategy table: after each query, window descriptors precede transitions/intents

| Format | Compiler selection | Value types |
|---|---|---|
| 1 | Straight-line expressions without Int | `1=Bool`, `2=Number` |
| 2 | Straight-line expressions with Int declarations or operations | Also `3=Int` |
| 3 | Branches, dynamic Int/Number conversions, or time value guards | Bool, Number and Int |
| 4 | Temporal window modules with physical roots and temporal clock inputs | Existing format 3 types plus bounded window descriptors |
| 5 | Solar schedule prelude | Format 4 types plus tagged schedule descriptors |
| 6 | Continuous `true_for` prelude | Temporal types plus true-for descriptors |
| 7 | PID objective | Bool, Number and Int plus objective record |
| 8 | Daily schedule prelude | Temporal types plus Daily descriptors |
| 9 | DailySlots schedule prelude | Temporal types plus DailySlots descriptors |
| 12 | Immutable UTC Range | GFB11 context layout plus UTC Range tag 13 |
| 11 | Typed configuration streams and context execution | Context preludes and optional PID objective; replaces the prior format 10 context profile |

These are compiler output profiles, not a promise that every host supports every
profile. See the feature-specific ABI documents for record layouts and activation.

The 2026-09-22 format decision introduces format 3 for Reference §2.6 evaluation.
Formats 1 and 2 remain current compact profiles for straight-line programs.
Superseded eager expression opcodes `11`, `12`, and `18` are rejected in **every**
profile. Recompile sources containing those operations; loaders never translate
or fall back to eager execution. Unsupported format numbers fail before activation.
Existing straight-line golden vectors retain their exact bytes and hashes.

Format 2 requires an Int declaration or instruction. Int immediate bytes do not
count as opcodes. Format 3 permits Bool/Number-only branches. Its integer
instructions and capability query type tags have the same meaning as format 2.

Each strategy contains a name, signed priority, query blob, transitions, and
intents. A blob has a `u32` byte-length prefix. Transitions name a state by `u16`
index; intents have a name and result type. Defaults encode Bool as `u8`, Number
as finite `f64`, and Int as signed `i32`.

## Expression opcodes

| Opcode | Operands | Meaning |
|---:|---|---|
| 1 | `u8` | Bool constant, 0 or 1 |
| 2 | `f64` | Finite Number constant |
| 3 | `u16` | Input index |
| 4 | `u16` | Previous state index |
| 5 | `u16` | Next state index; intents only |
| 10 | — | Boolean NOT |
| 13 | — | Equal values of the same type |
| 14–17 | — | Numeric LT, LTE, GT, GTE |
| 19–22 | — | Number ADD, SUB, MUL, DIV |
| 23 | `i32` | Int constant; formats 2 and 3 |
| 24 | — | Checked Int negation |
| 25–29 | — | Checked Int ADD, SUB, MUL, DIV, REM |
| 30 | `u16 displacement` | Pop Bool; jump if false; format 3 |
| 31 | `u16 displacement` | Unconditional jump; format 3 |
| 32–47 | — | Number constant `opcode - 32` (0 through 15); format 3 |
| 48 | — | Int to exact Number; formats 3 and 4 |
| 49–53 | — | Number to Int: exact, floor, ceil, trunc, nearest-even; formats 3 and 4 |
| 54 | — | Check Duration milliseconds, Number → Number; formats 3 and 4 |
| 55 | — | Check DateTime UTC epoch milliseconds, Number → Number; formats 3 and 4 |
| 56 | `u32 site` | Trace Result consumption; `[payload:T, choice:Number, origin:Number] → [payload:T]`; formats 3 and 4 |
| 57 | `u16 slot, u8 field` | Temporal window projection: `0=ok`, `1=value`, `2=fault`, `3=origin`, `4=admissionRevision`, `5=newestTimestamp`, `6=count`, `7=quality`; temporal formats with windows |
| 58 | `u16 slot, u8 field` | Schedule projection: `0=due`, `1=missed`, `2=active` (context profiles only for `active`); formats 5, 6, 8, 9 and 11 with schedules |
| 59 | `u16 slot, u8 field` | Continuous `true_for` projection: `0=ok`, `1=value`, `2=fault`, `3=origin`, `4=start`, `5=end`, `6=covered`; format 6 |

The compiler uses compact Number constants in branched expressions to keep
finite enum control programs within the same 4096-byte expression budget.
These constants still have Number identity; they are unrelated to Int's opcode
23 and type tag 3. Negative zero retains its ordinary `NUMBER_CONST f64` encoding
and sign. Other Number values also keep the ordinary encoding. Formats 1 and 2
reject the compact opcodes and retain their current straight-line bytes.

Dynamic conversions consume one typed operand and produce one typed result.
Number-to-Int operations round according to their explicit policy, then reject
values outside `-2147483648..2147483647` with `integer-conversion-out-of-range`.
For `int_exact`, a finite fractional value produces
`integer-conversion-fractional` before the range check, including `2147483648.5`.
Non-finite input remains invalid at the existing Number input boundary.
Conversion faults reject the entire tick. Unselected branch conversions do not
execute. Constant conversions retain compile-time diagnostics and literal lowering;
their straight-line programs can still select format 1 or 2.

`CHECK_DURATION` preserves a Number only when it is a finite integer in
`0..9007199254740991`; otherwise it rejects the tick with `duration-out-of-range`.
The source compiler emits the guard immediately after each dynamic Duration
arithmetic operation, including unary minus. Invalid intermediate results cannot
be hidden by later arithmetic. Constant Duration errors remain compile diagnostics.
An unselected branch does not execute its guard. This opcode preserves the machine
Number representation; it does not collapse the manifest's nominal Duration type.

`CHECK_DATETIME` likewise preserves only finite integer UTC epoch milliseconds in
`0..253402300799999`. Violations reject the tick with `datetime-out-of-range`.
DateTime shifts use ordinary Number arithmetic followed immediately by this guard,
so an invalid intermediate instant cannot be hidden by a later inverse shift.
The instruction does not define arithmetic for Date or TimeOfDay.

Arithmetic consumes the left operand followed by the right operand. Number
division by zero and non-finite results reject the tick. Int arithmetic rejects
overflow and zero divisors. Division truncates toward zero; remainder has the
dividend's sign. `MIN div -1` overflows; `MIN % -1` is exactly zero.

## Format 4 temporal window records

Format 4 uses the existing `GFB1` envelope and `u16` format version `4`. It is
selected only for modules containing at least one temporal window. Non-window
modules retain their existing format selection. Format 4 includes all format 3
expression operations.

After the scalar state table, the module stores `u16 nowInput`, `u16
timeEpochInput`, then `u16 rootCount`. These indices bind the reserved Number
inputs `__gf_now_ms` and `__gf_time_epoch`. Each root stores a strictly
increasing positive `u32 tag`, a name, and four `u16` input indices for present
(`Bool`), epoch, id, and timestamp (`Number`). Clock and root input bindings must
be distinct.

Each strategy stores `u16 windowCount` before transitions and intents. A window
record contains `u32 site`, name, operation (`0=average`, `1=min`, `2=max`,
`3=rate`), payload type, `u64 overMs`, `u64 maxAgeMs`, then `u16 rootRefCount`
and sorted `u16` root indices. It has six length-prefixed source expressions
in this order: `ok` (Bool), `payload` (payload type), and `fault`, `origin`,
`quality`, `sourceTag` (Number). Durations are in `1..2^53-1`.
Average and rate use Number payloads; minimum and maximum may use Number or Int.
Each scalar state count plus window count is limited to 128.

Opcode 57 reads a window slot and field. Fields 0 and 1 have Bool and payload
types respectively; fields 2 through 7 have Number type. Successful aggregate
quality is `3`; unavailable quality is `0`. Formats 1 through 3 and device
queries reject opcode 57. The verifier rejects invalid root/window sites,
duplicate names, noncanonical root order, invalid durations, and source
expression type mismatches before activation. Source expressions may read prior
window slots only; transitions and intents may read all slots in their strategy.

The sixth source expression is an evidence reference interpreted by quality:
quality `1` selects a physical root tag; quality `3` selects a prior window site.
These are distinct identity namespaces. Field-7 opcode-57 reads in the quality
expression declare the prior-window evidence dependencies. Their physical roots
must be included in the consumer's root references. Other window reads used only
in control conditions do not declare evidence. Constant quality `3` alone cannot
authorize an arbitrary upstream window. Both encoder and native loader validate
these bindings before activation; no additional opcode or wire field is used.

Nested-window manifest descriptors include a non-empty `upstreamWindows` array
of `{name, site, slot}`, sorted by prior slot. Physical-only descriptors omit it.
The `sources` array contains all transitive physical roots. Canonical package
replay pins these fields; the native package verifier also checks them against
the decoded prior-window dependencies.

The `GhostFlow/control-v4` manifest binds the generated `__gf_now_ms` and
`__gf_time_epoch` inputs and window signal descriptors. Density facts, target
memory budgets, and the execution epoch are activation inputs; they are not
invented by loading or encoded as authored manifest settings.

Branch displacements count bytes from the end of the displacement immediate.
They must be positive and land on an instruction boundary or the expression end.
Backward edges, loops, targets outside the expression, and unreachable instruction
bytes are invalid. Both outgoing paths are verified, including unselected paths.
Every join requires identical stack height and types. Every path must finish with
one value of the declared result type; stack capacity is 128 values.

For `if condition then yes else no`, lowering is:

```text
condition
JUMP_IF_FALSE(length(yes) + 3)
yes
JUMP(length(no))
no
```

`left && right` lowers as `if left then right else false`.
`left || right` lowers as `if left then true else right`. Conditions and selected
branches execute left to right in Rust, on native and WASM. Unselected branches
cannot produce runtime faults. Compile-time type/name errors still fail.

For input index 0, `if guard then true else false` has these exact bytes:

```text
03 00 00  1e 05 00  01 01  1f 02 00  01 00
INPUT(0)  JFALSE(5) TRUE   JUMP(2)   FALSE
```

## Query opcodes

Queries have a separate instruction namespace:

- `1 HAS kind-string name-string type-u8`
- `2 ALL u16-child-count`
- `3 ANY u16-child-count`
- `4 NOT`
- `5 BOOL_CONST u8` (0 or 1)

These effect-free capability predicates retain postfix evaluation. Expression
opcode retirement does not change query ALL/ANY. The verifier checks all query
operands, capability types, stack bounds and the single Boolean result.

## Safety records and host manifest

A constraint record is `kind:u8`, `arity:u16`, then that many distinct Boolean
intent names. Kinds are `1=requires` (two names), `2=mutex` (2–32 names), and
`3=requires-any` (target then 1–31 alternatives). Each round reads one candidate
snapshot and applies all false-only blocks together until a fixed point.

Module limits are 1 MiB overall, 128 UTF-8 bytes per name, 128 inputs/states/
intents/constraints, 32 strategies, and 4096 bytes per blob. In format 4, each
strategy's scalar state count plus window count is also limited to 128. Runtime faults reject
the tick before committing state, intents or the journal.
Unknown expression/query opcodes and constraint kinds reject before activation.

Manifest schema and bytecode format are distinct contracts. A
`GhostFlow/control-v4` manifest can bind Int-capable GFB format 2 or 3, and window
manifests pair with GFB format 4. A branch
alone does not require the Int manifest schema. `.gfb.manifest.json` preserves
nominal types and generated inputs; `.gfb.map.json` preserves source mapping.
The manifest's `bytecodeSha256` binds exact bytecode bytes, not authentication.
Missing generated input is a runtime error. See [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Conformance artifacts

`tests/fixtures/gfb1-golden-v1.ghost.md` and
`tests/fixtures/gfb2-int-golden-v1.ghost.md` are authoritative literate sources for
the corresponding tracked `.gfb` and digest metadata `.json` files. Node and
browser compilation preserve the straight-line vectors. Native and WASM loaders
reject invalid versions, malformed bytecode and retired eager instructions.
`tests/gfb2-int.test.mjs` also fixes the format-3 branch bytes and exercises
selected/unselected runtime faults through both hosts. Core Rust tests cover
nested branch execution, branch joins, invalid indices and stack boundaries.

## Result consumption diagnostics

`TRACE_RESULT` (56) requires a positive u32 site. The compiler's internal form is
`(trace-result site payload choice origin)`. Evaluation computes payload, choice,
then origin before recording an event; the payload's value and type are unchanged.
Choice is an exact Number integer in `0..65535`: zero means Ok, and a fault uses
its error enum ordinal plus one. Origin is an exact Number integer in
`0..4294967295`, with zero as the default. Invalid metadata rejects the tick with
`result-trace-out-of-range`. Source metadata binds site and origin identifiers to
the exact source revision and the error enum; the VM does not infer those names.

Every committed TickRecord JSON has a dedicated `resultTrace` array of
`{site, choice, origin}` events. Events follow execution order, including repeated
sites. An unexecuted marker produces no event. Diagnostics never enter requested
or safe actuator intents. A later fault discards the tick's entire diagnostic
buffer along with its candidate state and intents. Rewind retains the selected
journal record; ghost replay regenerates diagnostics from recorded inputs. There
is no separate mutable diagnostic checkpoint state or new native/WASM C ABI.

The loader counts marker instructions in every transition, intent, and format 4
window source expression. Forward-only control flow executes each instruction at
most once per expression, so the module's expression bytes bound all events in a
tick; copied expressions count separately. The 1 MiB module limit and five bytes
per marker give a conservative upper bound of `floor(1,048,576 / 5) = 209715`
markers before headers and other records further reduce it. At 12 bytes per
event, that is at most 2516580 bytes before collection overhead; retained
diagnostics also obey the existing bounded journal capacity.

[Portable GFB packages](PORTABLE-PACKAGE.md) preserve exact bytecode and bind its
source, manifest, source map, compiler/runtime identity and installation binding.
Packaging never rewrites bytecode.

## Compiler stage boundary

The location-aware Surface AST passes through checked source lowering, then an
in-memory typed Core IR. That IR has resolved input/state references, semantic
expression types and operators, requested intents, Bool constraints, and explicit
extension descriptors for temporal, config, quality, and objective behavior.
The S-expression form named above is the internal lowering input to this stage.
Only the GFB emitter maps the Core IR to numeric opcodes, selects a format, and
writes bytes. This separation changes no GFB wire version or runtime contract.

## Immutable UTC Range (format 12)

GFB12 requires at least one UTC Range prelude and otherwise uses the GFB11 context layout and optional objective trailer. Tagged prelude `13` encodes `site:u32`, name string, `gapMs:u64`, timezone string (`UTC` only), `durationMs:u64`, `startCount:u16`, then sorted unique `startMs:u64` values and the `when` and `cancel_when` expression blobs. There are 1–96 starts in `[0,86400000)`; duration is in `[1,86400000]`. Circular daily spacing must be at least the duration. The native decoder independently validates these bounds and non-overlap. Old format bytes remain unchanged; older consumers reject format 12 before activation. Downgrading the header cannot make tag 13 a GFB11 prelude.

The manifest remains `GhostFlow/control-v10` and uses the existing context facts ABI. Each Range site requires empty occurrence rows and no calendar/provider; the runtime derives UTC plans from trusted wall time. Occurrence identity uses site, UTC source day and stable sorted slot key. Range engine checkpoints use GFES2 with GFRG1 consumed-key ledgers; prior engines retain GFES1. A new boot retains deduplication but never resumes an active timer. Capacity exhaustion and malformed checkpoints fail explicitly and atomically. Signed portable-package configuration profiles remain GFB11 and do not accept GFB12.
