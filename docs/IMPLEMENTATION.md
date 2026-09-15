# Implementation and artifact boundaries

This export keeps the existing compiler and portable runtime unchanged. The
language documents include both implemented syntax and future design; acceptance
is determined by the compiler and the host tests described in
[VERIFICATION.md](VERIFICATION.md).

## Executable path

`tools/browser-toolchain.mjs` exposes `compileSource(source, {filename,
interactionSourceIdentity})` for canonical `.ghost.md` documents only and is
safe to import from a browser Worker. `tools/toolchain.mjs` wraps that same
environment-neutral compiler for Node and owns artifact filesystem I/O.
CommonMark extraction preserves original-position mapping through
`tools/literate.mjs`; the extracted control lowers through `tools/gfb1.mjs` to
GFB1. Plain source is rejected at both public compiler boundaries.

The language suite verifies that this browser entry's local import graph has no
Node builtin or `Buffer` dependency and executes it with `Buffer` unavailable.
It does not add a browser runner or claim Vite/Chromium Worker evidence; that
consumer integration belongs to the Farm Studio Web boundary.

Modern control supports inputs, configs, outputs, state, finite enums, pure
functions, expression/next-state checks, elapsed timers, DailySlots, sensors and
signals within the existing bounded profile. Standalone constraints use canonical
`.ghost.md` input through `tools/ghostrules.mjs`; its internal
`tools/constraints.mjs` lowerer produces the separate generated policy format.
Unsupported syntax is rejected; this export adds no language features.

`crates/ghostflow-core` owns module loading, expression execution, simultaneous
state transitions, intent/safety resolution, signal conditioning and station
arbitration. `runtimes/wasm` exposes those engines and contains reference host
adapters for manifest validation, generated inputs, schedules and persistence
callbacks. `runtimes/node/ledger.mjs` provides the file persistence used by host
station tests. API and firmware consumers must consume these implementations
through their contracts instead of reimplementing VM transitions.

An `output name: Type;` declaration is type-only and must have exactly one
`name <- expression;` connection. The connection produces a logical requested
intent for the tick; safety resolution may produce a distinct safe intent. The VM
does not assign startup defaults and does not promise that an intent reached
hardware. Startup and failure-safe OFF behavior, output application timing, and
driver disconnect handling are host/Driver policy and require separate evidence.

## Artifacts and versions

| Item | Current representation | Role |
|---|---|---|
| Authoritative program | `.ghost.md` | Literate source with intent, code, comments and explanation |
| Generated executable | `.gfb`, GFB1 envelope version 1 | Binary IR consumed by the VM |
| Generated control manifest | `GhostFlow/control-v1` | Typed host ports, timer/sensor/schedule requirements and bytecode hash |
| Generated constraint policy | `GhostFlow/constraints-v1` | Lowered standalone constraint source, bound by the host |
| Generated source map | `.gfb.map.json` | Diagnostic nodes/line mapping; source-preserving envelope from compileSource as specified in SOURCE-MAP.md |
| Integration identity/evidence | `contracts/integration-v1`, pure checker | Cross-project release, profile, mapping and run identities |
| Host verification | `GhostFlow/language-verification-v1` | This checkout's commands, results and source/artifact hashes |

The npm/core version `0.1.0`, source-language profile, bytecode version, manifest
format and firmware version are independent. The original migration map was an
unversioned nodes/lines object. The additive [source-map contract](SOURCE-MAP.md)
preserves those fields and adds a versioned original-source envelope and paired
hashes. GFB and the strict control manifest remain unchanged. The integration
team's v1 contract checker is included unchanged.

A release owner must preserve source, bytecode, manifest and map together with
their hashes, compiler/core revision, dependency locks, runtime ABI/profile and
applicable feature requirements. `compileSource` binds the manifest to the
bytecode SHA-256; a hash is an integrity check, not an authenticity signature.
The integration contract supplies additional identity/compatibility fields. Its
example is fictional and not a deployable program or execution result. Production
packaging and API/Device wiring remain consumer work. API deployment records and
firmware releases remain separately versioned.

Installation records provide names, capabilities, bindings and known site facts.
Executable schedules, interlocks and transitions belong to source (including
standalone constraint source) and its compiled artifacts. A binding record cannot
silently override program semantics.

## Limits and consumer responsibilities

- Core currently uses Rust `std` and dynamic allocation. Portable source does not
  establish `no_std`, fixed whole-VM memory, MCU timing bounds or a device profile.
- Native CSV/WASM parity replays the same generated VM input snapshots. It does
  not prove that another host generates identical sensor, timer or schedule data.
- Sensor/signal language support exists in this host platform; a firmware may
  support a smaller profile and must reject unsupported requirements explicitly.
- Driver mapping, clock synchronization, physical I/O, atomic device deployment,
  recovery, LLM intent quality and farmer interaction belong to consumer projects.
- Full general checkpoint restore, automatic ledger compaction, per-opcode source
  mapping, and production release signing/packaging are not added by this export.
