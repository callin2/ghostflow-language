# Authoring and virtual simulation architecture

This map describes the offline toolchain at this checkout. The canonical program is
one complete `.ghost.md` document. Its prose, intent anchors, document ID, and
revision ID travel with the compiled artifact; no second editable control string
is created. The [Language Reference](LANGUAGE-REFERENCE.md) defines program
semantics. This document describes the current tools and their boundaries.

```mermaid
flowchart LR
  LLM[LLM client] -->|TOON Reference request| R[reference-query.mjs]
  R -->|TOON citation and digest| LLM
  LLM -->|TOON check or compile request + complete .ghost.md| C[ghostc.mjs]
  Human[Human terminal] -->|.ghost.md and arguments| C
  C -->|GFB + manifest + source map| A[(artifact files)]
  A --> S[ghostsim.mjs Node host]
  Scenario[TOON scenario] --> S
  S -->|validated private JSON actions| Native[scenario_scan Rust process]
  Native -->|scan traces| S
  S -->|TOON or JSON result| LLM
  Human -->|raw number keys or line commands| Console[ghostsim-console.mjs]
  Profile[profile or Driver descriptor] --> Console
  Console -->|recorded TOON scenario| Scenario
  Console -->|same runScenario path| S
  Console -->|ASCII panel on stderr; final result on stdout| Human
  A -. separate browser adapter .-> WASM[WASM reference runtime]
  Device[Device ownership: firmware and physical I/O] -. profile metadata only .-> Profile
```

The model path uses strict TOON for [Reference queries](../tools/reference-query.mjs),
[`GhostFlow/cli-request-v1` and `cli-result-v1`](../tools/ghostc.mjs), and
[`GhostFlow/scenario-v1` and `scenario-result-v1`](../tools/ghostsim.mjs).
`ghostc --request` returns typed diagnostics with source spans. The human
`ghostc` command accepts the document path directly and prints short text
diagnostics. The [ASCII console](KEYBOARD-HOST.md) accepts raw number keys 1–8
without Enter in a TTY; `:` enters a line command such as `scan 100`. Its
recorded TOON file is a normal scenario, and its final result adds `console`
presentation identity to the simulator result.

The source map holds the complete document and immutable document/revision
identity. `ghostsim` checks the map against the exact GFB bytes and manifest
before starting the native runner. The result names the scenario SHA-256,
bytecode SHA-256, source document SHA-256 and filename, plus document/revision
IDs when supplied. A malformed request or failed activation returns a rejected
result with no scan rows. A runtime error returns only earlier committed scans
and its action index. A host failure after runner invocation reports
`host-error` with `traceComplete: false`; an empty scan list then means native
observations are unavailable, not that the runtime performed no scan. All
failures exit nonzero.

The scenario result is a deterministic replay artifact, not a live observation
record. Its `scanId` is scoped to that replay and it has no `runId`. A host that
publishes scans as observations must assign its own run identity and preserve
the artifact, source, scenario, and scan identities together, as required by
[Reference §5.4](reference/05-settings-and-observation.md#54-정체성과-물리적-사실의-경계).

Only a `scan` action evaluates the program. Its nonnegative `atMs` is a virtual
clock value that cannot move backward. Input and key actions update held values;
a later clock-only scan evaluates them again. The Rust core produces requested
and safe **virtual intent** separately. Neither field says a relay moved.
The Node host uses a private JSON transport to the native Rust process; JSON
there is an internal bridge, not a second program or public scenario format.
The console accumulates one TOON scenario and replays it through the same
`runScenario` path for each redraw. It does not own a VM or clock. If a console
command or scan time fails after completed scans, `command-error` retains those
rows and `--record` saves only the accepted, replayable prefix.

The selected [`GhostFlow/board-profile-v1`](KEYBOARD-HOST.md) or presentation-only
Driver descriptor supplies the console's ordered input and output channel
roster. `--bind CHANNEL=port` connects each channel to a matching manifest
logical port; board profiles never infer a logical binding from an endpoint
name. With no descriptor, the console uses a **virtual Waveshare 8DI/8RO**
layout. Only exact matching default `DI`/`RO` logical names bind automatically.
The layout does not verify pins, an installed board, an installation mapping,
or an applied output. Other channel counts come from the chosen descriptor.
The result records its profile ID, revision when present, digest, bindings, and
`physical: unconfirmed`.

The [browser-safe public toolchain](../tools/browser-toolchain.mjs) and
[WASM adapter](../runtimes/wasm/README.md) form a separate host path to the
same portable language/runtime semantics. The
API host owns model requests, conversation, document storage and deployment
orchestration. The Device repository owns board profiles, firmware, actual
drivers, pins, clocks and physical verification. This CLI makes no model calls
and no device calls.

## Driver, runtime and virtual device responsibilities

The following components are implemented in the offline path. The word
**Driver** needs a qualifier: an input adapter, the core `ScanDriver`, a console
descriptor and a physical I/O driver have different responsibilities.

| Component | Responsibility and state | Implementation |
| --- | --- | --- |
| Scenario / keyboard input driver | Holds typed logical inputs and key down/up state; converts explicit actions into a complete input snapshot. It never derives new sensor values from outputs. | [`scenario_scan.rs`](../crates/ghostflow-core/examples/scenario_scan.rs), [`KeyboardMapper`](../crates/ghostflow-core/src/keyboard.rs) |
| Virtual-time host | Supplies `atMs` and explicit scan opportunities. The console's toggle command appends an input/key action and a scan at the current time; `scan N` advances to the supplied time. No background clock advances this CLI session. | [`ghostsim.mjs`](../tools/ghostsim.mjs), [`ghostsim-console.mjs`](../tools/ghostsim-console.mjs) |
| Framed scan driver | Owns one runtime and validates complete typed inputs, sequential scan IDs and nondecreasing logical time before evaluation. Successful scans advance its sequence/time. It performs no device I/O. | [`ScanDriver`](../crates/ghostflow-core/src/scan.rs) |
| Portable Rust runtime | Loads GFB, activates supported capabilities, evaluates expressions, program state, timers and constraints, and emits a trace with requested/safe intents and faults. Native and WASM hosts use this core. | [`ghostflow-core`](../crates/ghostflow-core/src/lib.rs), [WASM adapter](../runtimes/wasm/README.md) |
| Virtual device view | Displays held inputs, requested/safe output banks and scan identity using the selected channel roster. The state consists of simulated input values, core program state and recorded observations; it has no separate actuator or plant model. | [ASCII panel and profile rules](KEYBOARD-HOST.md) |
| Profile / Driver descriptor | Describes ordered channels and types; explicit bindings connect them to manifest ports. Board-profile driver/address/polarity metadata is not executed by the console. | [`board-profile-v1` contract](../contracts/integration-v1/README.md), [`console-profile-v1`](KEYBOARD-HOST.md) |

“Virtual device” here means an I/O view around a real GhostFlow runtime. The
native runner registers virtual actuator capabilities from the module's output
types so the runtime can activate. It does not emulate a Waveshare controller,
relay register, contact, pump, tank level or sensor response. In particular,
`safe.pump = true` does not automatically change a water-level input. A scenario
must supply that input explicitly. A closed-loop plant model or simulated
applied/confirmed output would require a separate, explicit model and evidence
contract; neither is implemented by this CLI.

The browser has its own input and pacing host. Farm Studio's
`app/src/features/playground/playgroundRuntime.ts` instantiates
`ControlRuntime.instantiateFramed`; `playgroundScan.ts` supplies manifest-shaped
Boolean snapshots and explicit logical time, then reads displayed outputs from
the returned safe bank. `simulationPacer.ts` determines scan opportunities for
interactive playback. These frontend components do not evaluate GhostFlow
rules. Browser runtime state persists between scans, whereas the ASCII console
reconstructs the current state by replaying its accumulated scenario in a fresh
native process. Neither browser pacing nor the older real-time Rust keyboard
example changes the CLI's explicit virtual-time contract.

## Representative execution sequences

### Compile, start, and reach a virtual timer boundary

This implemented path uses the complete
[`virtual-timer.ghost.md`](../examples/authoring/corpus/virtual-timer.ghost.md)
and its [scenario](../examples/authoring/corpus/virtual-timer-scenario.toon).
`phase` starts at `Idle`; `pump` follows the computed next phase. No wall-clock
waiting occurs between the three scans. The phase names below describe the
source semantics; the trace also contains compiler-generated timer state.

```plantuml
@startuml
title Offline timer: complete document to explicit virtual scans
actor Author
participant "ghostc (Node)" as Compiler
database "GFB + manifest + source map" as Files
participant "ghostsim (Node)" as Host
participant "scenario_scan (Rust)" as Runner
participant "ScanDriver" as Scan
participant "Rust Runtime" as Core
Author -> Compiler: check complete .ghost.md
Compiler --> Author: diagnostics + source identity
Author -> Compiler: compile same complete .ghost.md
Compiler -> Files: GFB + manifest + map containing full document
Author -> Host: artifact path + TOON scenario
Host -> Files: read and verify artifact/source identities
Host -> Host: strict decode; validate all actions and typed inputs
Host -> Runner: spawn fresh process: GFB path + private JSON actions
Runner -> Core: load, install, add virtual actuator capabilities, activate
Runner -> Scan: transfer runtime ownership; next scan ID = 0
Runner -> Runner: initial start=false, stop=false
Runner -> Runner: input start=true (held input only)
note over Runner,Core: Input mutation alone does not evaluate or advance time.
loop atMs = 0, 1999, 2000; scan IDs = 0, 1, 2
  Runner -> Scan: complete input snapshot + scan ID + atMs
  Scan -> Scan: validate types, sequence, nondecreasing time
  Scan -> Core: tick_at(atMs)
  Core -> Core: previous state -> next state -> requested -> safe
  Core -> Core: commit state and trace
  Core --> Scan: inputs, stateBefore/After, requested/safe, faults
  Scan -> Scan: advance scan sequence and logical clock
  Scan --> Runner: ScanOutcome
  Runner --> Host: one JSON trace row on stdout
end
note over Scan,Core
  0 ms: Idle -> Running; pump ON/ON
  1999 ms: Running -> Running; pump ON/ON
  2000 ms: Running -> Done; pump OFF/OFF
  requested/safe are virtual intents, not applied output.
end note
Host --> Author: one TOON/JSON result + hashes + all scan rows
@enduml
```

![Offline timer sequence](assets/llm-toolchain-timer.svg)

Validation or activation failure yields no scan rows. An action-level runtime
error stops execution and returns earlier committed rows with its action index.
A constraint fault can instead be a successful scan with a blocked safe intent;
it is not automatically a runner failure. These paths are implemented in
[`ghostsim.mjs`](../tools/ghostsim.mjs),
[`scenario_scan.rs`](../crates/ghostflow-core/examples/scenario_scan.rs), and
[`ScanDriver`](../crates/ghostflow-core/src/scan.rs).

### Toggle an input, inspect permission blocking, then replay

This is the console command sequence in the reproduction section below, using
`pump-rev-2.ghost.md` and explicit DI/RO bindings. This pump has no program state
or timer. The console owns the accumulated scenario; each `runScenario` call
creates a fresh Rust process that reconstructs runtime state from the beginning.

```plantuml
@startuml
title Console pump: same-time toggles and recorded replay
actor Human
participant "ghostsim-console" as Console
participant "ghostsim / runScenario" as Host
participant "scenario_scan + KeyboardMapper" as Input
participant "ScanDriver + Rust Runtime" as Core
database "recorded TOON scenario" as Record
Human -> Console: profile + explicit DI/RO bindings
Console -> Console: held inputs false; atMs=0; actions=[]
loop commands: 1, 3, scan 5
  Human -> Console: command
  alt 1 or 3
    Console -> Console: toggle held input; append key down; append scan atMs=0
  else scan 5
    Console -> Console: set atMs=5; append scan (inputs unchanged)
  end
  Console -> Host: runScenario(accumulated TOON)
  Host -> Input: fresh process; replay ALL actions
  Input -> Input: seed held inputs and keyboard; apply key actions
  loop every recorded scan
    Input -> Core: KeyboardMapper values + complete frame + explicit time
    Core --> Input: committed trace: requested/safe + faults
  end
  Input --> Host: all trace rows
  Host --> Console: result with artifact/source identity
  Console --> Human: ASCII on stderr using LAST scan row
end
note over Console,Core
  After 1: scan 0 at 0 ms, pump ON/OFF (permission blocked)
  After 3: scan 1 at 0 ms, pump ON/ON (permission present)
  After scan 5: scan 2 at 5 ms, pump ON/ON
  Same time may contain multiple scans; time advance alone adds no input.
end note
Human -> Console: exit
Console -> Record: copy accumulated TOON (--record)
Console --> Human: final TOON/JSON + console profile/bindings; physical unconfirmed
Human -> Host: replay same artifact + recorded TOON
Host -> Input: fresh process; same actions and virtual times
Input --> Host: same scan results
Host --> Human: TOON result (no console presentation envelope)
@enduml
```

![Console pump sequence](assets/llm-toolchain-console.svg)

Recording retains logical input/key actions and virtual scan times. The
profile digest and DI/RO binding roster are added to the final console result,
not to the scenario file. Replaying the recording reproduces logical scans;
reproducing the panel also requires retaining its profile and binding arguments.

## Physical Driver and Device boundary

The physical path has additional responsibilities defined by
[Reference §8](reference/08-language-runtime-and-device-boundaries.md) and the
[integration contract](../contracts/integration-v1/README.md):

```plantuml
@startuml
title Physical scan: Device ownership and current firmware failure handling
database "Approved profile + installation bindings" as Profile
participant "Device scan host / clock" as Host
participant "Sensor / input driver" as Input
participant "ScanDriver + Rust Runtime" as Core
participant "Physical output driver" as Output
participant "Relay / load" as Load
participant "Host observation stream" as Evidence
participant "Independent observation" as Observer
Profile -> Host: endpoint types, polarity, address, mapping and identities
Host -> Core: install artifact; activate supported capabilities
Host -> Input: sample mapped endpoints
Input --> Host: normalized typed input snapshot
Host -> Host: latch snapshot; assign scan ID and logical time
Host -> Core: complete scan frame
alt frame rejected or runtime evaluation error
  Core --> Host: error (no successful scan result)
  Host -> Host: halt adapter; running=false; fault recorded
  Host -> Output: attempt OFF mask (firmware error path)
  Output --> Host: application result; physical state requires evidence
else successful scan (possibly with constraint faults)
  Core -> Core: commit program state and requested/safe trace
  Core --> Host: safe intent + scan identity + faults
  Host -> Output: map safe logical intent through installation/polarity
  Output -> Load: attempt electrical output write
  alt write acknowledged
    Output --> Host: applied mask = attempted mask
  else write failed
    Output --> Host: I/O error
    Host -> Host: cached applied mask = unknown; cached latch = unknown
  end
  opt driver available and readback due
    Output -> Load: read output latch/register
    Load --> Output: observed register value
    Output --> Host: readback evidence with observation scope
  end
  Host -> Host: record_relay(available, applied, latch)
  opt write/readback failure, latch mismatch or unavailable driver
    Host -> Evidence: publish attempted safe mask + separate applied/latch evidence
    Host -> Host: halt: running=false; fault; clear adapter live outputs
    Host -> Evidence: publish halted/fault observation
    note over Host,Output
      A following firmware loop requests OFF through the same driver.
      OFF is not assumed applied until acknowledged.
      Resume is rejected while faulted; redeployment is required.
    end note
  end
  opt independent physical observation available
    Observer -> Load: observe contact, terminal or delivered effect
    Observer --> Host: confirmation evidence for stated scope
  end
  note over Host,Core
    Core state already committed before output application.
    Driver failure does not roll back that scan through ScanDriver.
    Device halt policy is implemented; committed core state is retained.
  end note
end
@enduml
```

![Physical scan boundary sequence](assets/llm-toolchain-device.svg)

This diagram combines the ownership contract with the current `farm-device`
firmware failure path. It is not a connection made by `ghostsim` or hardware
verification. Independent physical confirmation is a contract boundary;
the current firmware observation reports intent, applied write and register
latch only, with no relay-contact or load feedback.
Device owns firmware, physical drivers, approved board profiles, clocks,
watchdogs and output handling at boot or failure. Installation bindings select
the actual endpoint for each logical port. Logical safe intent, driver-applied
output, register readback and physical confirmation remain distinct evidence.
The integration validator checks supplied identities and mappings; it neither
installs them nor performs I/O.

Device adapter code exists separately in `farm-device`:
`rust/ghostflow-adapter/src/lib.rs` uses the shared `ScanDriver` and records
applied masks and relay latch observations through `record_relay`; the firmware
owns the actual output operation. That separate implementation is not invoked
or certified by this authoring path. Its firmware/core revision, installation
mapping and physical evidence must be checked for the intended deployment.
There is no end-to-end device deployment, hardware emulation or physical
confirmation step in the commands below.

The output evidence chain is already defined by
[Reference §4.7](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed):
requested intent, safe intent, applied command and confirmed feedback are
different facts. The [command-result lifecycle](reference/05-settings-and-observation.md#event-command-result와-alarm)
describes request receipt, rejection, start, completion, cancellation and failure;
it does not make a completed core scan proof of a completed physical action.
The [Interaction v0 contract](../contracts/interaction-v0/README.md) projects
completed runtime observations and performs no I/O. Reference
[§8.5](reference/08-language-runtime-and-device-boundaries.md#85-변경과-재시작의-생명주기)
separately assigns restart/state restoration to an explicit policy and checkpoint
contract; it does not require rolling back a successful core scan after an I/O
failure.

The current Device policy is visible in `farm-device/rust/firmware/src/ghostflow.rs`
(`scan_with_clock`, `set_mask`, `record_relay`, then `halt`) and
`farm-device/rust/ghostflow-adapter/src/lib.rs` (`halt`, `scan_inner`, `resume`).
It preserves the attempted safe mask as an observation, stops further core
evaluation, clears adapter live output intents and requests OFF on the next
firmware loop. It retains the committed core state and rejects resume while
faulted. This is an implemented Device policy, not a missing language transaction.

This assessment was checked against clean `farm-device` revision
[`6d2e97b`](https://github.com/callin2/farm-device/commit/6d2e97b243045e3b2dfbbb9bf205614e26eceba4),
including `rust/ghostflow-adapter/tests/adapter.rs`'s
`relay_fault_halts_clears_intent_and_trace_is_bounded` case. The test was read,
not rerun for this documentation review. A later Device revision must be
inspected before repeating the implementation claim. Neither that host test
nor this diagram proves an actual relay contact reached OFF.

## What the sequences establish and leave open

The offline ownership chain is coherent: hosts supply inputs and time, the Rust
core owns evaluation and state, and views consume traces. The sequences do not
establish that a deployment is complete. The following are review findings,
with severity relative to the scenario that needs the missing behavior.

| Finding | Consequence and severity | Required evidence or decision |
| --- | --- | --- |
| Core commit precedes physical output application; the evidence stages remain separate. | **Defined boundary, not a missing policy:** current Device firmware records failed application, halts and requests OFF on the following loop without rolling back the committed core state. | Verify the intended firmware revision and failure path on the target device. CLI simulation does not certify output handling or physical OFF. |
| No output-to-sensor plant model exists in the CLI. | **High for closed-loop claims:** safe pump intent cannot establish water flow, level change or sensor feedback. | Supply explicit scenario inputs or a separately specified plant model; independently observe physical effects for hardware claims. |
| Console redraw replays the entire accumulated scenario; the scenario is bounded to 256 scans. | **Medium for interactive duration:** this is a bounded review session, not a continuous device host. | Keep acceptance scoped to bounded sessions. A persistent session would need its own lifecycle contract before implementation. |
| A console recording omits its presentation profile/bindings; those exist in the final result. | **Low for logical replay; medium for panel reproduction:** the recorded logical scans are reproducible, but the original channel labels/layout cannot be recovered from TOON alone. | Retain the final console result and profile/binding arguments alongside the recording when panel identity matters. |

The pump permission sequence checks requested versus safe intent. The timer
sequence checks previous/next program state and the 1999/2000 ms boundary.
Neither proves a physical deadline: if a host supplies no scan at 2000 ms,
the runtime performs no autonomous transition then. Actual scan cadence,
input freshness and output latency remain host/Device acceptance criteria.
The Device-side debug/output policy is tracked in
[farm-device #25](https://github.com/callin2/farm-device/issues/25); physical
relay contact evidence is tracked in
[farm-device #26](https://github.com/callin2/farm-device/issues/26).

## Reproduce the public path

From the language repository root, with dependencies installed and the native
`scenario_scan` example built, run these commands. They use the reviewed sample
document and its TOON requests; no raw control copy is generated.

```sh
mkdir -p build/authoring
cp examples/authoring/pump-rev-2.ghost.md build/authoring/pump.ghost.md
node tools/ghostc.mjs --request examples/authoring/check-rev-2.toon
node tools/ghostc.mjs --request examples/authoring/compile-rev-2.toon
node tools/ghostsim.mjs build/authoring/pump.gfb examples/authoring/pump-scenario.toon --format toon
printf '1\n3\nscan 5\nexit\n' | node tools/ghostsim-console.mjs build/authoring/pump.gfb \
  --bind DI1=start --bind DI2=stop --bind DI3=permit_ok \
  --bind RO1=pump --bind RO2=permit --record build/authoring/console.toon --format json
node tools/ghostsim.mjs build/authoring/pump.gfb build/authoring/console.toon --format toon
```

The check and compile results identify document `GF-EXAMPLE-PUMP`, revision
`rev-2`, and the same full-document SHA-256. The scripted scenario scans at
0, 1 and 2 ms; `pump` requested/safe values are `ON/OFF`, `ON/ON`, then
`OFF/OFF`. The console example scans at 0, 0 and 5 ms. Its panel has eight
input/output rows, including unbound DI8/RO8, and reports physical status as
unconfirmed. Its recorded scenario replays with the same scans and artifact
identity. A selected 2DI/4RO board-profile fixture exercises unequal rows in
[`ghostsim-console.test.mjs`](../tests/ghostsim-console.test.mjs). The
[`authoring-workflow.test.mjs`](../tests/authoring-workflow.test.mjs) already
checks the TOON check/compile/simulate path; no separate compiler or runner is
needed for this view.

## Current limits

The runner permits at most 256 KiB of scenario text, 1,024 actions, 256 scans,
and 1 MiB of encoded result. It uses plain runtime activation. Controls that
need external certified intervals, schedule bindings, or another host resource
are rejected at activation. Host event ordering is tracked in
[#115](https://github.com/callin2/ghostflow-language/issues/115), while
temporal resources are described in [TEMPORAL-RESOURCES.md](TEMPORAL-RESOURCES.md);
basic virtual-time simulation does not supply a hidden default policy. The
console has no automatic scan cadence and does not prove physical behavior.
