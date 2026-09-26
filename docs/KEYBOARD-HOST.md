# Real-time keyboard host

The native `keyboard` example runs a compiled GFB with virtual terminal input.
It does not access GPIO, serial, MQTT, or a network device.

```sh
cargo run --locked --offline -p ghostflow-core --example keyboard -- \
  build/program.gfb \
  --key 1=start --key 2=stop \
  --record build/keyboard-events.csv
```

The terminal is placed in raw mode while the process runs and is restored on
normal exit. Press `Ctrl-C` to exit. A number `1` through `8` toggles the
matching input and produces one runtime tick.

The mapper holds one boolean state per configured input. Each press of a bound
number toggles that input between `true` and `false`. No keyup event is needed.
Unbound keys are ignored. Every press ticks the runtime with the complete
current boolean state.

`--record` writes replayable event records with this header:

```csv
logical_time_ms,key,event
```

The existing `run` CSV runner remains unchanged. The recorded event CSV is an
audit stream for a host adapter; it is not accepted as the ordinary input
matrix used by `run`.

## Live ASCII console

In an interactive terminal, `ghostsim-console` starts a persistent virtual
GhostFlow runtime. It scans at 0 ms and draws the first full-screen panel
immediately, before any key is pressed. A 100 ms wall-clock timer supplies one
new scan per tick. Logical time is elapsed monotonic time from startup; late
timer callbacks scan once at the current elapsed time without replaying missed
ticks. Each row shows recent input, requested output intent, and safe output
intent as ASCII traces. The display uses the terminal's alternate screen and
restores the screen, cursor, and raw keyboard mode when it ends. It never opens
a physical Driver. Both stdin and stderr must be terminals for this live view.

```sh
node tools/ghostsim-console.mjs build/program.gfb \
  --bind DI1=start --bind DI2=stop --bind RO1=pump --bind RO2=valve
```

When `--profile` is absent, the layout is a **virtual Waveshare 8DI/8RO** with
Bool `DI1`–`DI8` and `RO1`–`RO8`. The default name binds only to a manifest
logical port with exactly the same name and type. Other logical ports need an
explicit `--bind CHANNEL=port` assignment. This layout conveys no pin number,
installed hardware, or site approval. Every logical output needs a binding.
An unbound logical input needs an explicit `--input port=value` starting value;
it cannot be toggled from the panel. Unused profile channels display `(unbound)`.

A selected descriptor may use the existing `GhostFlow/board-profile-v1` schema:
`schema`, `id`, `revision`, `boardModel`, and an `endpoints` object. Each endpoint
key is its channel ID. Each value has `direction` (`input` or `output`), `type`,
`driver`, `address`, `activeLevel`, and `safeLevel`. The console lists endpoint
IDs in the order they appear in the JSON file, separately for inputs and
outputs. It uses direction and type for binding validation. It never opens
the named driver or treats an address as a confirmed pin. All logical port
bindings remain explicit with `--bind`. The selected board profile must satisfy
the integration contract's exact field sets, nonempty text fields, endpoint
direction and level values, and unique `driver`/`address` pairs before its
identity is shown or hashed.

The alternative `GhostFlow/console-profile-v1` JSON below is a presentation-only
Driver descriptor. Its `id`, ordered channels, labels, and types drive the
virtual panel; it carries no physical installation mapping.

```json
{
  "format": "GhostFlow/console-profile-v1",
  "id": "example-2DI-4RO",
  "inputs": [
    { "name": "A", "label": "Input A", "type": "Bool" },
    { "name": "B", "label": "Input B", "type": "Bool" }
  ],
  "outputs": [
    { "name": "R1", "label": "Relay 1", "type": "Bool" },
    { "name": "R2", "label": "Relay 2", "type": "Bool" },
    { "name": "R3", "label": "Relay 3", "type": "Bool" },
    { "name": "R4", "label": "Relay 4", "type": "Bool" }
  ]
}
```

```sh
node tools/ghostsim-console.mjs build/program.gfb \
  --profile build/profile.json --bind A=start --bind B=stop \
  --bind R1=pump --bind R2=valve
```

On a terminal, keys `1` through `8` toggle a bound Bool input and scan
immediately; Enter is not needed. Press `:` to enter a command, then Enter.
For later channels, enter `:toggle CHANNEL`, such as `:toggle DI9`. Enter
`:exit` or press Ctrl-C to end. The panel starts at scan 0, and a short human
summary follows exit. `--record` and `--format` are rejected in live TTY mode.
An unbounded live run cannot fit the bounded `GhostFlow/scenario-v1` recording
contract. Build the WASM runtime first with `npm run build:wasm` if
`target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm` is absent.
`:scan N` is a piped replay command; the interactive clock runs automatically.

When commands are piped through stdin, omit `:` and use one command per line.
This bounded replay mode runs the `ghostsim` scenario runner and writes one
complete `GhostFlow/scenario-result-v1` document to stdout. It defaults to
TOON; `--format json` selects JSON. The panel is printed to stderr after each
scan.

In piped replay mode, each toggle records a key edge or typed input action and
scans once at the current virtual time. Time starts at 0 ms and cannot move
backward. If there were no commands, exit records one initial scan at 0 ms.
For a non-Bool manifest input in either mode, supply `--input port=value` with
a typed initial value. A non-Bool channel can appear in the descriptor, but
its panel state is `unsupported` and it has no toggle shortcut.

Rows align the input and output lists by index. Empty cells remain empty when
one side is shorter. Bool values display ON or OFF; missing observations display
`unobserved`. Output columns separately show requested and safe virtual intent.
The panel reports the profile/Driver identity, scan ID, virtual time,
status/error, and `physical: unconfirmed`. The live panel keeps a bounded
rolling trace of the latest 120 scans. Piped replay prints exact bindings.

In piped replay mode, `--record` writes the exact replayable TOON scenario.
For example:

```sh
printf '1\nscan 100\nexit\n' | node tools/ghostsim-console.mjs build/program.gfb \
  --bind DI1=start --bind DI2=stop --bind RO1=pump --bind RO2=valve \
  --record build/session.toon
```

Replay it with
`node tools/ghostsim.mjs build/program.gfb build/session.toon --format toon`.
If a command or scan time is rejected after scans have completed, the final
result has `outcome: command-error`, a `command` error, and the completed scan
rows. This is a console session failure; runner input rejection uses
`outcome: rejected` with no scans.
The recorded scenario contains only the accepted actions and scans; it replays
to the same scan rows and scenario identity. The rejected attempt is excluded.
If no scan completed, no replayable scenario is recorded.
The final result includes a `console` field containing the selected profile ID,
revision when present, digest, bindings, and physical status. For a board profile,
the digest uses the integration contract's canonical JSON SHA-256; for a console
descriptor, it hashes the exact JSON file bytes. The replay
has equivalent scans, outcome, artifact/source identity, and scenario digest;
`ghostsim` does not add the console presentation metadata. The older keyboard
example's `logical_time_ms,key,event` CSV needs explicit conversion into
`GhostFlow/scenario-v1` initial inputs, key bindings, and ordered key/scan actions
before it can be replayed by `ghostsim`.
