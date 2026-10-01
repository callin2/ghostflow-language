# Solar execution with shared live configuration

[한국어](SOLAR-CONFIG-EXECUTION.ko.md)

Solar and ordinary control expressions can read the same current typed config
Results in one program. Use the complete
[SolarLiveConfig example](../examples/solar-live-config.ghost.md) for an operator
enable switch and sunrise pulse. Its English reading projection is
[here](../examples/solar-live-config.ghost.en.md); compile the canonical Korean
document. Coordinates, timezone, rise/set and offset remain immutable program
data. Changing them requires a new compiled program, rather than a config edit.

## Current Results and recovery

The compiler records the config IDs read by a Solar `when` expression. Rust
independently checks this dependency set against the protected input reads.
Every dependent current fault makes admission `Unknown(SettingsFault)`, even
if an authored `fault` branch evaluates to true. No historical successful value
or initial default silently replaces a current fault. An unrelated config fault
does not suppress that Solar schedule. Ordinary expressions still follow their
own explicit Result branches.

An authorized observation is staged before both Solar and ordinary evaluation.
All consumers at that position see the same Results. A successful observation
after a fault establishes a recovery baseline without catching up missed starts.
The next eligible crossing can fire once. A malformed packet, denied event or
failed VM evaluation commits neither the event nor the Solar occurrence; the
same frame can be retried. Source identity and ordinary elapsed/state semantics
are unchanged by a config observation.

**Why:** treating a setting error as false would lose its cause; treating it as
the last successful value could admit an operation the current observation no
longer authorizes. A shared staged vector makes the schedule and its surrounding
control agree on the setting that actually took effect.

## Facts, execution and restart

The host supplies typed Solar facts, clock evidence and authenticated settings
observations. It calculates astronomical facts using the existing reference
provider; it does not calculate `due` or bypass Rust admission. Facts carry the
exact compiled timezone, coordinates, event and offset binding. A changed
binding rejects the evaluation. Missing or invalid natural evidence follows the
explicit clock/fallback policy, not a guessed event.

The existing Rust SolarPulseEngine participates in the same staged context
transaction as settings and the VM. GFB16 (`GhostFlow/control-v15`) carries
Solar context descriptors; GFCA1 activates the context and GFSF6 adds Solar
facts. Existing non-Solar context profiles retain GFSF5. This explicit
compatibility choice preserves the already shipped calendar profile; older
loaders reject the new GFB header. Existing standalone Solar consumers from
issues #28/#29 retain their concrete execution profile. It is not a fallback for
a rejected shared-config program. Format numbers are distinct from package,
source-language and Device versions.

GFCX3 retains its wrapper version and embeds the Solar engine snapshot as GFES
subtype 3. Restore requires the exact Program and bindings. Current config
Results, including faults, and consumed source-day identities survive restore;
fresh clocks establish a new baseline. A checkpoint is not a general VM image,
a settings fallback or permission to replay missed starts. The host owns durable
storage and must preserve admission before publishing output intents.

## Reproduce the virtual example

1. Install the lockfile dependencies and the Rust `wasm32-unknown-unknown` target.
2. Compile `examples/solar-live-config.ghost.md` with the normal canonical-source
   compiler. Do not edit the English reading projection as a second program.
3. Use the context-capable WASM host or native context runner with the compiled
   artifact, matching activation and finite recorded Solar facts. Supply clock
   evidence explicitly; no physical clock or device is implicitly installed.
4. Supply an authorized Bool config observation, a fault observation, and a
   later successful observation. Compare ordinary Results and schedule traces;
   recovery must establish a baseline, not replay a past sunrise.
5. Build with `cargo build --locked -p ghostflow-core --release --example context_tape`
   and `cargo build --locked -p ghostflow-wasm --target wasm32-unknown-unknown --release`.
   Run `node --test tests/solar-config-compiler.test.mjs tests/solar-config-runtime.test.mjs`.
   The reader example receives a compilation check; the richer focused test
   fixture checks the same artifact and event sequence through native Rust,
   WASM and the virtual simulator. See
   [the context ABI](CONTEXT-EXECUTION-ABI.md) for packet and commit boundaries.

The executable boundary remains explicit: mixing shared config streams with
literal DailySlots is still rejected. Solar Window/Run overlap and cancellation
design in #153 is separate. Signed portable packaging, Device adoption, farmer
interface delivery and physical installation are not supplied by this host
execution change. Reference §3.5 and §5 define the language semantics; the
[older standalone Solar guide](SOLAR-SCHEDULE.md) describes its own profile.

Related issue: [#145](https://github.com/callin2/ghostflow-language/issues/145).
