# Virtual scenario runner

For the compiler, simulator, console, and ownership boundaries together, see
the [authoring and virtual simulation architecture](LLM-TOOLCHAIN-ARCHITECTURE.md).

`ghostsim` runs a compiled GhostFlow control in a fresh Rust core against explicit virtual-time actions. Plain input programs use the native framed runner. Sensor, certified interval, and Solar programs use the existing Rust/WASM control host. It never opens a device driver or applies an output. The fields `requestedVirtualIntent` and `safeVirtualIntent` describe logical intent only.

The WASM host uses framed scans for ordinary sensors, windows, and adaptation.
Certified Bool intervals and Solar use the existing legacy runtime entry points
because their framed ABI is not available; the scenario host assigns their
replay-local scan IDs. Both paths use the same portable Rust evaluation core.

Build and run the included example from this repository root:

```sh
node tools/ghostc.mjs examples/tutorial/01-latch.ghost.md build/01-latch.gfb
cargo build --locked --offline --release -p ghostflow-core --example scenario_scan
npm run build:wasm
node tools/ghostsim.mjs build/01-latch.gfb examples/scenarios/latching-pump.toon --format toon
node tools/ghostsim.mjs build/01-latch.gfb examples/scenarios/latching-pump.toon --format json
```

The scenario follows the [TOON specification](https://github.com/toon-format/spec/blob/main/SPEC.md) and is decoded in strict mode by `@toon-format/toon` 4.1.1. Required fields are `format`, `id`, `initialInputs`, `keyBindings`, and `actions`. Each initial input is `{name,type,value}` and must cover every declared input except the host clock `__gf_now_ms`. Types are `Bool`, `Number`, and `Int`. Bindings map numeric keys 1–8 to distinct Bool inputs. Actions include typed `input`, `key`, and `scan` as before. A `sample` action supplies one identified sensor observation for the next scan. An `interval` action supplies a Driver-certified Bool interval for the next scan; it requires an explicit `temporal` activation profile. Missing samples remain NotReady, and separate observations do not imply continuous truth. An adaptation control may use an explicit `capabilities` roster; an empty roster means optional sensors are absent. A Solar control requires an explicit `solar` activation profile and `solarFacts` on each scan, including clock and provider occurrence evidence. The host never invents Solar due values. Only `scan` evaluates the program. `atMs` is an exact, nonnegative, nondecreasing logical millisecond value. A later scan with unchanged inputs advances elapsed timers.

The runner verifies the artifact's persisted source map against the exact GFB bytes before execution. The result includes the scenario SHA-256, GFB SHA-256, canonical `.ghost.md` document SHA-256 and filename, and immutable document/revision IDs when present. Each scan lists its logical time, complete input snapshot, requested and safe virtual intents, faults, and state before/after. Fresh runs with identical artifact and scenario bytes produce the same semantic trace. The result is one `GhostFlow/scenario-result-v1` document in TOON or JSON; strict TOON decoding yields the same JSON value.

For the four-scan `latching-pump.toon` example, the measured result size is **466 tokens / 1,491 UTF-8 bytes in compact JSON** and **517 tokens / 1,677 UTF-8 bytes in TOON**, using `tiktoken` `cl100k_base` and `@toon-format/toon` 4.1.1. This nested trace is slightly larger in TOON; the formats carry the same data.

Malformed TOON, missing or unknown inputs, wrong types, duplicate bindings, invalid keys, and backward time yield a versioned `outcome: rejected` result with an error location and no scan rows. A runtime failure yields `outcome: runtime-error`, an action index, and only earlier committed scans. A host or transport failure, including a timeout, output buffer overflow, malformed child output, or an oversized encoded result, yields `outcome: host-error`, `traceComplete: false`, and no scan rows. In that case `scans: []` means observations are unavailable; it does not establish that no scans ran. All failures exit nonzero. Limits are 256 KiB of scenario text, 1,024 actions, 256 scans, and 1 MiB of the result encoded in the selected `--format`. Near that limit, JSON may complete while TOON exceeds the limit; when both fit, strict TOON decoding yields the same result value as JSON. Exceeding a limit fails explicitly, without a truncated success result. The native child receives private JSON actions and uses `KeyboardMapper` and `ScanDriver`. The WASM host uses the same portable Rust core and existing signal, temporal, and Solar adapters.

The simulator's `atMs` is supplied by the scenario host. On a device, monotonic timer time and trusted wall-clock/calendar facts come from host clock and provider bindings. RTC, NTP, and network availability are outside the language core. A valid offline RTC can provide calendar time; NTP is optional correction. The source language's timer and calendar meaning remains the same across those bindings. Full controls currently emitted as schedule, accounting, or temporal descriptors are still nonexecutable in `ghostsim`; see the [dated simulator baseline](REFERENCE-SIMULATOR-BASELINE-2026-09-23.md).
