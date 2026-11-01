# GFB5 schedule prelude

GFB5 is an **internal** bytecode profile that adds schedule entries (currently
Solar) to the per-strategy *prelude*: a list of window and schedule entries
that the strategy's transitions and intents can reference. Its current status:

| Part | Status |
| --- | --- |
| Encoder | implemented |
| Portable Rust structural verifier | implemented |
| Canonical source lowering | not connected |
| Schedule execution | not connected |
| Loading | succeeds for structurally valid modules |
| Activation, temporal planning, hot swap | reject with `schedule activation requires runtime bindings` |

## Layout

The magic remains `GFB1`; the little-endian format version is `5`.

- Module, input, state and temporal clock/root sections keep their existing
  layout.
- Schedule-only modules may have zero physical roots. Windows still require
  valid root references.
- A format-5 module must contain at least one schedule. For window-only modules
  the encoder continues to emit format 4.

Each strategy has a `u16` prelude count, followed by that many tagged entries:

- Tag `0` contains the existing GFB4 window body.
- Tag `1` contains this Solar body:

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

All integers are little endian. Policy tags are explicit; each policy field
currently has exactly one defined value. Other language policies need further
implementation; this profile does not redefine which policies the language
supports. Timezone availability belongs to the provider binding and is not
established by structural decoding.

**Slots and references.**

- Window slots and schedule slots are numbered separately, in encounter order.
- Opcode 57 still reads windows. Opcode 58 is
  `[58, u16 scheduleSlot, u8 field]`, where field 0 has Bool type (`due`).
- Each prelude expression may reference only earlier entries. Transitions and
  intents may reference all entries.
- Sites and names must be unique across both kinds within each strategy.
- Scalar states plus prelude entries must not exceed 128 per strategy.

## Identity and boundaries

The bytecode contains semantic local declaration identity. Document hashes and
external document/revision identities stay in verified artifact metadata.
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
`crates/ghostflow-core/tests/schedule_module.rs`.

- **They verify:** wire fields, dependency ordering, malformed input, boundaries
  and activation rejection.
- **They do not establish:** reservation admission, provider correctness,
  schedule execution, durable identity, resource accounting or replay.
