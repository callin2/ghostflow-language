# Schedule wire and transactional prelude proposal

Status: **draft for root review**. The GFB5 structural slice is complete: core
160, native 12, encoder 8 plus affected 44, browser 3, cross-language native 4,
and catalog 5 passed. Canonical lowering, schedule execution, providers,
resource accounting, and replay remain pending. Identity binding and resource
geometry below are not final approval. Multiple-crossing behavior is fixed by
Reference §3.5: record all newly crossed occurrences missed and execute none.

Root approved §2's executable layout for a staged structural implementation.
The first change adds the internal encoder and portable loader/verifier only;
canonical source lowering and schedule execution remain pending. It requires
at least one schedule in a format-5 module; window-only compilation retains
format 4. All activation paths must reject schedule modules with
`schedule activation requires runtime bindings` until the execution path is
implemented. It must never substitute a false `.due` value.

Evidence: `build/schedule-core-green.log`, `build/gfb5-encoder-affected.log`,
`build/gfb5-browser-green.log`, `build/gfb5-native-green.log`, and
`build/gfb5-catalog.log`. `docs/GFB5-SCHEDULE-PRELUDE.md` records the approved
wire slice.

Ground truth: [Reference §3](../docs/reference/03-time-and-schedules.md),
[pulse design](schedule-pulse-design.md), and the existing
[GFB4 contract](window-gfb4-design.md).

## 1. First execution slice

Solar, `pulse`, authored Bool `when`, `trusted_only`, explicit positive
`skip_after(Duration)`, `baseline`, and `fallback = skip`. Rust consumes planned
occurrence facts; it owns clock validation, crossings, predicate evaluation,
disposition and commit. Providers retain IANA conversion and Solar calculation.
The native Solar helper's UTC/Seoul subset cannot restrict the language's IANA
support. No provider supplies `.due`.

`window`, `run`, held clock, fixed-time fallback, Daily/IANA-DST planning and
durable occurrence-ledger migration remain separate required work. The wire must
represent the complete bounded set of crossings; when there are multiple newly
crossed occurrences for one schedule, all are recorded missed and none executes.

## 2. Proposed GFB5 byte layout

All integers are little endian; strings and expression blobs reuse existing GFB
length prefixes and bounds. GFB5 retains the GFB4 module/input/state sections and
clock/root header. Zero physical roots are permitted for schedule-only modules.
At least one stateful prelude entry is required.

Each strategy replaces GFB4's window list with `u16 preludeCount`, followed by
tagged entries in dependency order, then the existing transitions and intents:

| Entry tag | Body |
| --- | --- |
| `0` | Exact existing GFB4 window descriptor |
| `1` | Solar pulse descriptor below |

Proposed Solar body, in byte order:

```
u32 site
string name
string timezone
f64 latitude
f64 longitude
u8 event                 // 0 rise, 1 set
i64 offsetMs             // whole milliseconds, -24h..+24h
u8 basis                 // 0 pulse
u8 clockPolicy           // 0 trusted_only
u8 recovery              // 0 baseline
u8 fallback              // 0 skip
u64 gapMs                // 1..9007199254740991
blob when                // exactly one Bool result
```

Coordinates must be finite and in their existing source domains. Policy bytes
are explicit, not defaults. Other language policies are unimplemented by this
slice, not permanently invalid language forms.

Window and schedule slots are separate dense indices assigned when each kind
is decoded. Opcode 57 retains its existing window namespace. Proposed opcode 58
is `[58, u16 scheduleSlot, u8 field]`; field `0` returns Bool `.due`. Other fields
reject. Within each strategy, sites and names are unique across both kinds in
the heterogeneous prelude. Separate strategies may refer to the same source
declaration, as in the existing window profile.

The verifier exposes only entries preceding the current descriptor. A window
source may read an earlier schedule; a schedule predicate may read an earlier
window. The compiler topologically sorts the combined graph and gives located
cycle diagnostics. Window evidence marker/root verification remains unchanged.
Transitions and intents can read all staged prelude entries. All ordinary state
reads still observe the old authored state; there is no staged `next` lookup.

Keep `scalar state count + prelude count <= 128` per strategy, input/stack/expression/module
ceilings unchanged. This extends the current stateful entry budget rather than
introducing an unrelated schedule quota. Format 5 requires coordinated decoder,
encoder, package, host, fixtures and golden updates. Formats 1–4 remain current
profiles where the compiler still emits them. Once accepted, the superseded
Solar external-due execution path is removed.

## 3. Identity binding requiring approval

Executable declaration identity and verified artifact identity are separate:

- `site`: artifact-local source node/projection identity, never a durable key.
- `name`: the semantic local declaration name carried in GFB.
- The existing exact source SHA and external `documentId`/`revisionId`: verified
  activation artifact metadata, never fields in executable GFB bytes.

The occurrence key combines an activation-bound stable declaration namespace,
the local declaration, source local date and event kind. Provider revision and a
corrected planned timestamp do not create a new occurrence. The exact source
revision is explanatory provenance, not the stable occurrence key. Source SHA,
bytecode SHA and the Runtime's noncryptographic u64 fingerprint remain distinct.
No additional cryptographic hash or fabricated source ID is introduced.

Activation obtains this binding from `tools/compile-source.mjs`'s existing
`sourceDocument` and `traceMetadata`, validated by the toolchain's canonical map
checks and the verified artifact/package boundary. Comment/prose-only changes
must retain GFB and node identity while changing source identity, as required by
Reference §1 and `tests/toolchain.test.mjs`'s comment-only revision test. A
provider fact cannot set or override the binding. Raw GFB loading proves
bytecode structure only; it does not authenticate source identity. Native
signed-package signature, digest and metadata validation does not imply native
canonical source recompilation; there is no native source compiler in this
proposal.

**Unresolved:** the exact activation-bound stable declaration namespace and its
document/import instance rules. A control/name pair alone is insufficient if
distinct installed documents share those names. Reuse the verified
installation/source identity boundary; no opaque unchecked provider identifier
enters GFB as a substitute. Cross-revision durable ledger migration remains a
separate contract.

## 4. Typed per-scan facts and ABI proposal

Native entry points:

```
Runtime::tick_with_schedule(&ScheduleFacts)
ScanDriver::scan_with_schedule(ScanFrameV1, &ScheduleFacts)
```

The immutable facts object contains one clock snapshot and site groups sorted by
site, with exactly one group per selected schedule. The clock contains boot/time
epoch, monotonic milliseconds, optional wall milliseconds, trust, optional
uncertainty and optional clock source revision. Missing uncertainty stays absent.

Each group has provider ID/revision and zone/context revision bound to the
installed provider capability. It contains either a typed Unknown reason or an
explicit covered wall interval plus a complete ordered source-date list. Each
date row contains an event wall instant or a typed unavailable reason. Rust adds
the compiled offset and validates DateTime bounds. Date rows retain the source
date even when offset crosses midnight. Planned local-time context can accompany
the provider evidence; it never replaces the stable source-date key.

Proposed packet framing is `GFSC`, `u16 version=1`, followed by the clock and
`u16 groupCount`. Scalar domains use the current canonical epoch-day,
epoch-millisecond and safe-integer domains. Presence/status tags discriminate
optional fields; no sentinel wall time. Length-prefixed strings and rows must be
bounded by the explicit facts budget. Exact row/status encoding follows the
provider coverage contract review; it is not silently fixed by this draft.

Coverage must include every eligible source date for the requested interval and
offset. Structural validation can prove consecutive rows, bounds and no duplicate
keys; it cannot prove an external IANA/astronomical provider told the truth. That
is the verified driver capability boundary. Current/previous-date enumeration
alone is not complete coverage for arbitrary authored gaps.

Proposed exports, preserving existing nonschedule calls:

```
gf_tick_schedule(handle, factsPtr, factsLen) -> 1|0
gf_frame_scan_schedule(handle, scanId, logicalTimeMs,
                       inputPtr, inputLen, factsPtr, factsLen) -> 1|0
```

Clock monotonic time must equal the framed logical time and the generated VM now
binding. Modules requiring schedules reject ordinary tick/scan without facts;
there is no cached-facts fallback. Both ABIs share one Rust packet decoder. The
combined framed inputs and facts envelope must fit the existing 64 KiB transport
bound. Native direct calls enforce the same activated resource geometry, not an
unbounded Vec that happens to bypass the packet decoder.

## 5. Transaction, replay and resource proof

One staged clock gate uses consecutive accepted wall/monotonic values for gap
checks; trusted wall high-water is separate. A positive delta greater than the
authored gap rejects admission; equality does not. Boot/trust recovery baselines
do not catch up. Unknown/recovery, provider faults and terminal dispositions are
recorded distinctly. Epoch replacement requires an explicit new session while
timers/windows rely on fixed-session continuity.

Evaluate each schedule predicate once in prelude order against old state and
already staged projections. Windows, clock state, occurrence consumption,
schedule observations and scalar state all commit together after every fallible
expression succeeds. Any later fault discards every candidate. Retry sees the
same crossing. No JavaScript admission state machine or independently committing
provider cache stands in for that transaction.

TickRecord owns the facts needed to replay and each schedule decision. Checkpoints
include accepted clock state and occurrence-consumption state. Ghost replay uses
those recorded facts and the verified installed definitions, not a fresh provider
query. Framed replay preserves original scan IDs and accepted logical times.

**Resource review still required:** introduce an explicit positive facts-byte
budget for schedule activation, bounded by the ABI transport maximum, and derive
row capacities from the encoding. This is storage capacity, not an operating
cadence. GFTA v2 is the proposed place for this field and schedule-only profiles
with zero window sample capacity. Do not reinterpret missing GFTA1 fields as
defaults. Root must approve this profile change before implementation.

The shared structural planner must charge decoded group/row/string capacities,
clock and admission banks, `(journalCapacity+1)` owned facts/decision records and
checkpoints, plus candidate and replay overlap. Merely charging encoded 64 KiB or
the existing temporal arena is insufficient. Avoid repeating provider strings in
every decision: bind rows/decisions to metadata owned once in the record. Actual
capacity checks follow the existing temporal plan rule. JSON buffers remain
separately bounded. A finite in-session occurrence-consumption representation
also needs a proof under provider corrections; do not add an indefinitely growing
HashSet or prune consumed keys merely because a journal record was evicted.

## 6. Implementation boundaries and first decisive checks

| Owner | Bounded work after contract approval |
| --- | --- |
| Root | Identity/capacity decisions; Reference and artifact binding |
| Astra | GFB5 verifier, shared Rust prelude/admission, transaction/resource/replay, ABI |
| Sol | Source graph/lowering/encoder, IANA fact provider and thin host/wrappers |
| Luna | Independent diagnostic and native/WASM acceptance vectors |

First tests should distinguish: a window-fed predicate from old-state input;
the inverse dependency and a cycle; exact gap versus gap+1; failed late intent
then identical crossing retry; corrected provider timestamp retaining occurrence
identity; and journal rollover replay preserving decisions without provider calls.
Add a multi-date coverage test that proves two newly crossed occurrences for one
schedule are both recorded missed and neither is admitted. Pair it with a
single-crossing control that retains ordinary admission behavior.

The independent trusted-only clock component can proceed first. GFB descriptor
identity, complete fact encoding, and the combined storage plan need review
before claiming the full pulse path accepted.
