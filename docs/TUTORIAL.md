# Host execution tutorial

Run `npm test` in this standalone checkout for the complete language gate, or
`npm run tutorial` after installing dependencies and the native/WASM toolchains.
The latter builds both runners and executes `tools/tutorial.mjs`. All outputs
are virtual intents; tutorial results are written locally when the command runs.

| Example | Source | What the runner checks |
|---|---|---|
| Latch | [01-latch.ghost.md](../examples/tutorial/01-latch.ghost.md) | Stop priority, retained state, pump/valve requirement |
| Schedule | [02-watering.ghost.md](../examples/tutorial/02-watering.ghost.md) | Daily slot, elapsed timer, sequential valve states |
| Moisture | [03-moisture.ghost.md](../examples/tutorial/03-moisture.ghost.md) | Median, stale/disconnect handling and recovery without automatic start |
| Shared station | [04-extra-valves.ghost.md](../examples/tutorial/04-extra-valves.ghost.md) | Two controls sharing a station through its generated constraint policy |
| Replay | Isolated VM using latch input snapshots | Deterministic repeat of recorded virtual inputs |

Each control is compiled by the real `compileSource`. WASM traces supply exact
input snapshots to the native runner, and the tutorial asserts that VM trace
JSON is equal. This compares VM execution on common inputs; it does not compare
physical sampling, clock synchronization or MCU host behavior.

For one control:

```sh
node tools/ghostc.mjs examples/tutorial/01-latch.ghost.md build/tutorial/latch.gfb
cargo run --locked --offline -p ghostflow-core --example run -- build/tutorial/latch.gfb examples/tutorial/01-latch.csv
```

Generated `.gfb` files have `.manifest.json` and `.map.json` sidecars. Tutorial
evidence lives in `build/tutorial/evidence.json`, per-program `.trace.json` and
`.inputs.csv`, plus the shared-station policy/binding/trace files. These are
ignored local outputs and are regenerated from the source release.

The unchanged tutorial runner carries the legacy field
`hardware: "deferred-by-user"`. In this language repository that is inherited
host-only evidence metadata; it is not a current authorization or statement
about another project's board status. The top-level host gate explicitly records
`hardwareTested: false` and `llmTested: false`.

See [implementation limits](IMPLEMENTATION.md) and
[verification requirements](VERIFICATION.md).
