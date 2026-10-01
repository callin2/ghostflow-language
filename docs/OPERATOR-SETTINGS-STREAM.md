# Typed configuration streams

The normative language rules are Reference §2 Result, §3 Periodic/DailySlots,
and §5 settings. A config declaration names a typed stream with an initial
`ok(initial)` observation. A config read is `Result<T, SettingsFault>`; the
consumer uses existing `case`, `map`, `and_then` or explicit `recover` semantics.
The producer may be a network interface or physical control. Consumer source
does not name its transport. This contract does not require RxJS or a new
general stream framework.

`SettingsInvalid` means a recognized, authorized emission failed payload
validation. `SettingsUnavailable` is an explicit producer error observation.
Missing messages alone cause neither error nor a fabricated repeated emission.
Both faults are recoverable by a later successful emission. No implicit
last-good/default policy exists.

An aggregate identifies a nonempty, unique, authorized set of config IDs. All
payloads validate together. The aggregate emits all `ok` or all addressed
`fault`; unrelated streams remain unchanged. Conflicting explicit fault codes
inside one aggregate reject the packet. A uniform explicit fault is propagated
to the addressed group; an actual payload validation failure emits
`SettingsInvalid` for that group.
Malformed packets, unrecognized targets, stale Program/base revision or denied
authority are rejected before admission. Such rejection creates no observation.
An accepted error emission advances the settings observation revision.

All consumers at an evaluation position use the same current Results. A
dependent schedule preserves an error as `Unknown(SettingsFault)` and admits
no new occurrence while it is current. Recovery applies the declared phase
policy at the successful emission position without past catch-up. An admitted
Run is not cancelled by a config error. Ordinary control expressions determine
their own response explicitly. A duration read inside `case` can therefore
change an ongoing control at the next evaluation without resetting elapsed
time. A program can explicitly capture a successful value in state when it
wants a per-run duration instead.

## Binary integration

GFB11/control-v10 replaces the prior GFB10 context profile. Scalar config
descriptors are prelude tag12 and precede their schedule consumers:

```text
u32 id, string name, string semanticType, u8 kind, u8 operatorEditable
scalar: typed initial, u8 hasBounds, [typed min, max, step]
slots:  u64 gridMs, u16 capacity, u16 count, u16 minuteOfDay[]
u16 okInput, valueInput, faultInput
```

Kinds are Bool0, Int1, Number2 and TimeSlots3. Scalar values use canonical Bool
flag, signed i32 or finite f64 representations. `semanticType` preserves
Duration, Percent and quantity/time distinctions on the wire. TimeSlots uses
0xffff for all scalar projection indices. Scalar projections have protected
names `__gf_config_ID_ok/value/fault`. A host cannot set them directly.

Periodic tag5 replaces its embedded config value/bounds with `u32 configId`.
ID0 instead carries an immediately following positive `u64 literalIntervalMs`;
a literal is not an invented editable config. Config DailySlots tag9 carries
`string timezone, u32 configId, u8 dstMissing, dstRepeated` after its common
prefix. Both consumers reference the shared config descriptor and current
observation, rather than separate setting copies.

Every GFB11 artifact ends with `u16 objectiveCount` (0 or 1). The objective body
retains name/output and its four input indices, adds `u16 targetOkInput`, then
retains period/late/direction and the six PID numbers. The target value/ok pair
must refer to one Temperature config descriptor. Host code cannot write either
protected input or substitute the manifest's initial target.

GFSF5 retains the context clock/evidence sections. Its settings envelope is
Program fingerprint, event ID, base revision, effective position and changes.
After effective position, `u8 origin` distinguishes operatorEdit0 from
producerObservation1. The host authenticates this classification; a packet
claim is not an authentication credential. Consumer source sees only Result.
Operator edits require editable access. A legitimate producer observation can
report a fault for a readonly config and recover it to its declared initial
payload; it cannot change that readonly payload. Each change is `u32 configId, u8 rail`. Rail0 contains `string semanticType,
u8 kind, typed value`; a TimeSlots value is `u16 count` then `(u64 key,u16 minute)`.
Rail1 contains fault code0 (`SettingsInvalid`) or1 (`SettingsUnavailable`).
Structural tags and finite numerical representation are checked before stream
validation. A valid representation with the wrong declared type, range, grid
or capacity produces the semantic error rail.

TimeSlots keys are allocated by the shared config stream. Key0 requests a new
identity. Existing keys retime retained entries; absent keys remove entries.
All schedules consuming that config share those identities. Errors do not
expose the historical list as a current successful value.

The combined context call stages emissions, protected inputs, schedule
decisions and VM state together. A rejected combined call does not consume its
event, so retry is possible. This API does not acknowledge the emission as
effective before commit. Independently accepted observations, if supplied by
another API, cannot later be undone by a failed control evaluation.

The public framed path uses `gf_frame_activate_context` and
`gf_frame_scan_context` with the same GFCA1/GFSF5 packets and native ScanDriver.
The complete input frame omits runtime-protected Result projections and the
derived monotonic clock. Its logical time must match the context clock. Only a
successful evaluation advances the native scan ID/time and publishes the
accepted outcome. Rejected frames remain retryable at the same scan ID. Framed
checkpoint/state access and pre-first-scan restore reuse GFCX3; they do not
create a second settings state or synthesize an accepted outcome in JavaScript.

GFCX3 persists the current Result, revision, accepted event identities and key
allocation history under the exact Program/binding identity. A restored fault
remains a fault. Historical successful payloads exist only for stable-key and
phase validation, never as a consumer fallback. Restored engine caches must
agree with the shared config history. It also retains bounded full calendar
ID/revision content history. Old GFCX1/GFCX2 images are rejected explicitly.

Context state exposes each config's ID, name, type and current Result. Error
results contain a fault rather than an old `value`. Source hashes and run
identity remain unchanged by emissions. Existing state/timer semantics remain
unchanged. Hardware acquisition, WebUI transport and device release work are
outside this language/runtime change.

## Executable profile boundary

The Periodic profile in this change executes an explicit `instant` anchor with
`preserve_anchor`, pulse/trusted-clock/baseline/skip policies. The Reference's
other anchors and phase policies retain their own implementation requirements;
this change does not claim to execute them. Config-backed TimeSlots uses the
shared stream consumer. Mixing streams with the older Solar or literal
DailySlots execution profile is rejected at source compilation. The native
Temperature PID objective reads its target from the same protected config
Result vector; a fault follows its authored disable policy. These rejections
must not be bypassed by converting a real operator setting to a constant.
Solar unification is tracked in [#145](https://github.com/callin2/ghostflow-language/issues/145).
Accounting reserve and limit values in the executable profile are static
designer bounds. The Reference's 5-minute ON and 10-second stop-delay example
uses `let` for those fixed bounds; a live config Result is rejected rather than
silently folded to its initial value.
The current `basis = range(...)` DailySlots profile likewise requires a fixed
duration. A live config Result is rejected at compilation; literal/`let` range
overlap and touching-boundary rules remain executable. Extending Range to a
shared live Result consumer is separate from this Periodic and ordinary-control
stream implementation.
Native/WASM and virtual-simulator validation does not certify frontend delivery,
physical acquisition, Device deployment or arbitrary external producer adapters.

The shared vector is staged before the existing PID engine. A target fault
follows the authored `fault = disable` policy immediately, including between
PID deadlines. Recovery preserves the existing deadline and `track_safe`
policy. Settings and PID changes commit with the same successful evaluation.
Restart restores config observations and uses the authored PID
`restart = reset(...)`; a config checkpoint does not restore controller history.

Signed portable packages accept scalar config GFB11 artifacts, including ordinary
elapsed timers, under
`GhostFlow/context-scan-abi-v5` and `control-v10`. Signature, digest, capability
and compiler-consistency checks remain mandatory. This package profile does
not add schedule, PID, TimeSlots or signal-prelude packaging support.
