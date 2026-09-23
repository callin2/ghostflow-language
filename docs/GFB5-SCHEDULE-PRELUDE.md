# GFB5 schedule prelude

This internal bytecode profile has an encoder and a portable Rust structural
verifier. Canonical source lowering and schedule execution are not connected.
Loading succeeds for structurally valid modules; activation, temporal planning
and hot swap reject them with `schedule activation requires runtime bindings`.

## Layout

The magic remains `GFB1`; the little-endian format version is `5`. Module,
input, state and temporal clock/root sections retain their existing layout.
Schedule-only modules may have zero physical roots. Windows require valid root
references. A format-5 module must contain at least one schedule; the encoder
continues to emit format 4 for window-only modules.

Each strategy has a `u16` prelude count followed by tagged entries. Tag `0`
contains the existing GFB4 window body. Tag `1` contains this Solar body:

| Field | Encoding and domain |
| --- | --- |
| site | `u32`, positive |
| name | Existing GFB string |
| timezone | Nonempty well-formed UTF-8 string, at most 128 bytes |
| latitude, longitude | `f64`, finite; −90..90 and −180..180 |
| event | `u8`: 0 rise, 1 set |
| offsetMs | `i64`: −86400000..86400000 |
| basis | `u8`: 0 pulse |
| clockPolicy | `u8`: 0 trusted_only |
| recovery | `u8`: 0 baseline |
| fallback | `u8`: 0 skip |
| gapMs | `u64`: 1..9007199254740991 |
| when | Existing expression blob, Bool result, at most 4096 bytes |

All integers are little endian. Policy tags are explicit. Other language
policies require further implementation; this profile does not redefine the
language's supported policies. Timezone availability belongs to the provider
binding and is not established by structural decoding.

Window and schedule slots are separately numbered in encounter order. Opcode
57 retains window reads. Opcode 58 is `[58, u16 scheduleSlot, u8 field]`, where
field 0 has Bool type (`due`). Each prelude expression may reference only prior
entries. Transitions and intents may reference all entries. Sites and names
must be unique across both kinds within each strategy. Scalar states plus
prelude entries must not exceed 128 per strategy.

## Identity and boundaries

The bytecode contains semantic local declaration identity. Document hashes and
external document/revision identities remain in verified artifact metadata.
Comment-only source changes must not alter executable bytes.

The internal encoder forms are:

```text
(solar-pulse SITE NAME TIMEZONE LAT LON EVENT OFFSET_MS
  pulse trusted_only GAP_MS baseline skip WHEN)
(schedule-read SLOT due)
```

These forms are not an additional product source format. Product source remains
one complete `.ghost.md` document.

Focused evidence lives in `tests/gfb5-schedule.test.mjs`,
`tests/gfb5-browser.test.mjs`, `tests/gfb5-native.test.mjs`, and
`crates/ghostflow-core/tests/schedule_module.rs`. These verify wire fields,
dependency ordering, malformed input, boundaries and activation rejection.
They do not establish reservation admission, provider correctness, schedule
execution, durable identity, resource accounting or replay.
