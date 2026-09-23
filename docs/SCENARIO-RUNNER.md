# Virtual scenario runner

For the compiler, simulator, console, and ownership boundaries together, see
the [authoring and virtual simulation architecture](LLM-TOOLCHAIN-ARCHITECTURE.md).

`ghostsim` runs a compiled GhostFlow control in a fresh Rust core against explicit virtual-time actions. It never opens a device driver or applies an output. The fields `requestedVirtualIntent` and `safeVirtualIntent` describe logical intent only.

Build and run the included example from this repository root:

```sh
node tools/ghostc.mjs examples/tutorial/01-latch.ghost.md build/01-latch.gfb
cargo build --locked --offline --release -p ghostflow-core --example scenario_scan
node tools/ghostsim.mjs build/01-latch.gfb examples/scenarios/latching-pump.toon --format toon
node tools/ghostsim.mjs build/01-latch.gfb examples/scenarios/latching-pump.toon --format json
```

The scenario follows the [TOON specification](https://github.com/toon-format/spec/blob/main/SPEC.md) and is decoded in strict mode by `@toon-format/toon` 4.1.1. Its exact versioned shape is `format`, `id`, `initialInputs`, `keyBindings`, and `actions`. Each initial input is `{name,type,value}` and must cover every declared input except the host clock `__gf_now_ms`. Types are `Bool`, `Number`, and `Int`. Bindings map numeric keys 1–8 to distinct Bool inputs. Actions are `{kind: input,name,type,value}`, `{kind: key,key,event: down|up}`, or `{kind: scan,atMs}`. Only `scan` evaluates the program. `atMs` is an exact, nonnegative, nondecreasing logical millisecond value. A later scan with unchanged inputs advances elapsed timers.

The runner verifies the artifact's persisted source map against the exact GFB bytes before execution. The result includes the scenario SHA-256, GFB SHA-256, canonical `.ghost.md` document SHA-256 and filename, and immutable document/revision IDs when present. Each scan lists its logical time, complete input snapshot, requested and safe virtual intents, faults, and state before/after. Fresh runs with identical artifact and scenario bytes produce the same semantic trace. The result is one `GhostFlow/scenario-result-v1` document in TOON or JSON; strict TOON decoding yields the same JSON value.

For the four-scan `latching-pump.toon` example, the measured result size is **466 tokens / 1,491 UTF-8 bytes in compact JSON** and **517 tokens / 1,677 UTF-8 bytes in TOON**, using `tiktoken` `cl100k_base` and `@toon-format/toon` 4.1.1. This nested trace is slightly larger in TOON; the formats carry the same data.

Malformed TOON, missing or unknown inputs, wrong types, duplicate bindings, invalid keys, and backward time yield a versioned `outcome: rejected` result with an error location and no scan rows. A runtime failure yields `outcome: runtime-error`, an action index, and only earlier committed scans. Both commands exit nonzero. Limits are 256 KiB of scenario text, 1,024 actions, 256 scans, and 1 MiB of encoded result. Exceeding a limit fails explicitly, without a truncated success result. The Rust child process receives a private JSON action transport; it uses `KeyboardMapper` for key edges and `ScanDriver` for every scan.

This runner uses plain runtime activation. A control that requires external certified intervals, schedule bindings, or another host resource yields `outcome: rejected` with `error.location: activation` and no scans. Those resources require a separate explicit host contract; this scenario format does not invent them.
