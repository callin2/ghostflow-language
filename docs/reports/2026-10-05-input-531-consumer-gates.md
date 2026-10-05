# Issue 531 independent review and consumer adoption gates

Execution evidence, not a release or physical acceptance claim. The published
implementation at the start of this audit was 8fc85b1. Follow-up changes remain
part of draft PR [532](https://github.com/callin2/ghostflow-language/pull/532).

## Policy decision pending

No pending fault or restart proposal has been applied to PC01, E03 or irrigation.
The parent proposed lamp OFF on acquisition fault; START fault inhibits a new
start while an active run may continue only with healthy STOP/protection;
STOP/low-water fault releases the latch. It also proposed an explicit fresh START
off-to-on transition after recovery. These choices require the user's reply.
Fresh-start recovery changes the historical E03 level-sensitive lesson; if
approved it needs a separately identified new source revision and new tests.
Historical source, replay frames, checkpoints and dated benchmark oracles remain.

## Independent findings and fixes

- Optional Int input capabilities were registered as number, selecting the absent
  strategy despite installed hardware/software capability. Register the existing
  int capability tag. Plain/framed regression distinguishes absence from faults.
- Ordinary host admission accepted fractional Bool valid bounds; context admission
  rejected them. Both reject numeric Bool bounds.
- JS signed-package source replay compared only selected sensor fields. Compare
  complete sensors/sensorInstances descriptors against canonical source replay;
  valid re-signing cannot substitute cadence, recovery, validity or optionality.
- Native package admission now validates typed acquisition metadata domains,
  generated identities, filters and bounded recovery without compiling the DSL.
  Native domain validation does not establish complete source equivalence; source
  replay remains the JS producer/verifier gate. Do not treat these as a new ABI.
- Startup identity conditioning accepts a producer's first Good sample under the
  existing conditioner rules. Recovery counts follow an observed fault in the same
  producer epoch; an epoch change resets processing. Acquisition readiness does
  not choose the application's restart policy.

## Current pin inventory and conflict

Read-only owner audit observed these dev pins; recheck at adoption time.

| Consumer | Existing exact pin |
| --- | --- |
| API language | 81f253235ac3966433bee7fec9dd3fcd8c186ff1 |
| API Authoring | 0.4.0 / 3936df19ac0e587886b8045aee77b9f6b22abb9e |
| Frontend Simulator | 0.4.0 / 25c48796fc01a725405dbd95fcf38211c59d51e1 |
| Frontend Renderer | 0.1.4 / 4519976cc24c0013a1ddf214d4274527b6572de7 |
| Frontend Device SDK | 0.6.0 / 725db667e38999ceea89418dcd9832d84c89bcd4 |
| Device Rust core/package | 7e2c6b549580135ff2bc195957f74601ffac4a89 |
| Frontend firmware setup | Device 0.3.0 / 7fe4d601ef18732a22a9ea4f94929e7d67428656 |

[API PR172](https://github.com/callin2/farm_studio_api/pull/172) is an active
Authoring 0.4.1 / 4b1260682d2559a18bcc6ec3353263c9c81b5947 pin update that
retains old sensor syntax. Coordinate its owner before superseding that pin.
Direct Authoring9 and Simulator/Authoring repository reads returned connector
404; their current suites were not independently inspected. Older local frontend
and Device worktrees were read only. Git ownership protection was not overridden.

## Ordered adoption plan

1. Resolve source fault/restart policies with an explicit new revision; complete
   language owner verification and publish its immutable verified artifact.
2. Simulator owner adopts that compiler artifact and runs installed compilation,
   acquisition quality/continuity, source/replay and full affected package suites.
3. Authoring owner updates candidate syntax/policy and compiler/package pin. API
   coordinates PR172 and verifies installed archive/compiler/WASM provenance with
   tools/check-authoring-boundary.mjs and api/ghostflow-language-pin.json.
   Run test:authoring-consumer:raw, test:authoring, test:program-package,
   test:portable-package-verifier and test:installation-package-boundary.
   Run test:authoring-history and test:authoring-history-route on a disposable DB.
4. Frontend owner updates the installed Simulator and Worker compiler boundary.
   Run test:simulation-boundary, verify:ghostflow, test:integration-build,
   test:unit, test:web-replay, test:simulation-packages, typecheck, build and
   test:browser. Inspect selected-execution-target, usb-virtual-input, mcu-upload,
   playground-comparison and conversation-live-settings browser specs. Target
   switching must preserve approved source/revision/digest.
5. Device owner pins ghostflow-core and ghostflow-package together in
   rust/ghostflow-adapter/Cargo.toml. Run package admission, typed payload and
   observation/session fence suites for the actual target. SDK rejects unsupported
   target/payload combinations. Generic Driver9 remains another owner's scope.
   Physical operation and release acceptance are separate authorized gates.

The current and frontend-pin CI lanes run language checkouts. The frontend-pin
lane checks fixed historical SHA b2f2874dd0238207558dfa4cc83077d322356a6c,
not this candidate against an installed frontend. Neither lane alone proves any
of the installed-consumer checks above.

## Remaining owner contract audit failures

Command: node --test tests/browser-toolchain.test.mjs tests/toolchain.test.mjs
tests/pinned-import-closure.test.mjs tests/consumer-framed-compatibility.test.mjs
tests/portable-package.test.mjs. Result: 38 tests, 14 pass, 24 fail. The release
native run loader was built offline first. These failures remain visible; no
source policy, gate or assertion was bypassed.

- tests/browser-toolchain.test.mjs:79:1: browser and Node public compilers preserve canonical corpus results
  Error [ControlCompileError]: five-minute-watering.ghost.md:48:3: next state request_was_high must be Bool
- tests/browser-toolchain.test.mjs:122:1: browser public compiler executes with Buffer unavailable
  Error [ControlCompileError]: five-minute-watering.ghost.md:48:3: next state request_was_high must be Bool
- tests/consumer-framed-compatibility.test.mjs:11:1: consumer framed WASM executes named VFD Number I/O and independent Start/Stop oracles
  Error [ControlCompileError]: consumer-vfd.ghost.md:12:41: if condition must be Bool
- tests/consumer-framed-compatibility.test.mjs:50:1: consumer framed WASM also executes unrelated named Number and Boolean cabinet programs
  Error [ControlCompileError]: consumer-temperature.ghost.md:11:35: > cannot use Result directly; handle ok(...) and fault(...) with case
- tests/consumer-framed-compatibility.test.mjs:90:1: consumer framed settings atomically apply Bool, Number, Percent and Duration without restarting
  Error [ControlCompileError]: consumer-settings.ghost.md:15:41: if condition must be Bool
- tests/pinned-import-closure.test.mjs:28:1: REF-06-011 exact transitive revision and digest closure survives artifact replay and native framed WASM execution
  Error [ControlCompileError]: farm.ghost.md:6:31: output pump must be Bool
- tests/portable-package.test.mjs:128:1: GF-TEST-portable-package: deterministic package preserves exact literate, GFB, manifest and source-map identities
  Error [ControlCompileError]: 01-latch.ghost.md:19:15: ! requires Bool
- tests/portable-package.test.mjs:153:1: GF-TEST-portable-package-intent-map: a re-signed replacement source map still fails strict intent provenance recovery
  Error [ControlCompileError]: intent-package.ghost.md:9:3: output pump must be Bool
- tests/portable-package.test.mjs:181:1: GF-TEST-portable-package-derivations: signed records cannot lose origins or assert semantic proof
  Error [ControlCompileError]: 01-latch.ghost.md:19:15: ! requires Bool
- tests/portable-package.test.mjs:203:1: GF-TEST-portable-package-constraint-proof: checked eliminated origins survive signing and re-signed tampering fails
  Error [ControlCompileError]: proof-package.ghost.md:2:75: output pump must be Bool
- tests/portable-package.test.mjs:229:1: GF-TEST-portable-package-trust: key rotation accepts a new active signer and rejects a solely revoked signer
  Error [ControlCompileError]: 01-latch.ghost.md:19:15: ! requires Bool
- tests/portable-package.test.mjs:254:1: GF-TEST-portable-package-build: signing requires a deterministic compiler replay of the same source and artifacts
  Error [ControlCompileError]: 01-latch.ghost.md:19:15: ! requires Bool
- tests/portable-package.test.mjs:268:1: GF-TEST-portable-package-rejection: structure, integrity, trust and host compatibility fail closed before GFB loading
  Error [ControlCompileError]: 01-latch.ghost.md:19:15: ! requires Bool
- tests/portable-package.test.mjs:348:1: GF-TEST-portable-package-loader-result: target verification must explicitly return true
  Error [ControlCompileError]: 01-latch.ghost.md:19:15: ! requires Bool
- tests/portable-package.test.mjs:358:1: GF-TEST-portable-package-loader-context: target verifier cannot mutate signed metadata
  Error [ControlCompileError]: 01-latch.ghost.md:19:15: ! requires Bool
- tests/portable-package.test.mjs:374:1: GF-TEST-portable-package-manifest-capabilities: input and required sensor omissions fail closed
  Error [ControlCompileError]: sensor-pump.ghost.md:6:3: removed sensor declaration; use input with the same Result quality and conditioning contract; create an explicit new source revision
- tests/portable-package.test.mjs:403:1: GF-TEST-portable-package-hosts: one verified package feeds byte-identical GFB1 to native Rust and release WASM
  Error [ControlCompileError]: 01-latch.ghost.md:19:15: ! requires Bool
- tests/portable-package.test.mjs:439:1: GF-TEST-portable-package-profiles: signed packages preserve profiles 1, 2 and 3 with Int capabilities
  Error [ControlCompileError]: profile-1.ghost.md:4:83: output result must be Number
- tests/portable-package.test.mjs:472:1: GF-TEST-portable-package-quantities: signed quantity ports map to number and preserve canonical units
  Error [ControlCompileError]: quantity-package.ghost.md:4:82: output echoed must be Temperature
- tests/portable-package.test.mjs:509:1: GF-TEST-portable-package-browser: signed package verification does not require Buffer
  Error [ControlCompileError]: 01-latch.ghost.md:19:15: ! requires Bool
- tests/toolchain.test.mjs:164:1: REF-00-001: equal control bytes retain separate original intent and document revisions
  Error [ControlCompileError]: intent-revision-0.ghost.md:9:3: output pump must be Bool
- tests/toolchain.test.mjs:231:1: traceable artifact maps persist and restore source, map, extraction, and verified trace metadata
  Error [ControlCompileError]: traceable-timer.ghost.md:7:3: next state enabled must be Bool
- tests/toolchain.test.mjs:262:1: traceable artifact-map restoration fails closed when trace provenance is absent or malformed
  Error [ControlCompileError]: traceable-timer.ghost.md:7:3: next state enabled must be Bool
- tests/toolchain.test.mjs:307:1: continuous timer restoration rejects descriptor, role, source-mode, and dependency tampering
  Error [ControlCompileError]: continuous-trace.ghost.md:6:35: continuous_true argument must be Bool

The full native package crate audit reports 18 passed / 25 failed, with current
fixture generation stopping before native admission (e.g. 01-latch.ghost.md:19:15,
! requires Bool). Two new source-independent acquisition validator tests pass. A separate signed
canonical Int/Bool fixture reaches the native loader and executes i32 MAX and
explicit recover(-7); seven re-signed malformed descriptors reject before loading.
That fixture uses an explicit candidate compiler/binding identity.
Exact-head CI for 8fc85b1 failed earlier at
examples/curriculum/generated/pc-01-e01.generated.ghost.md:14:3:
output lamp must be Bool. Coverage and verified candidate packaging were not
reached. Each later draft head requires its own exact-head verification.

Native fixture-generation failures from the full crate audit:

- tests::abi_binding_and_capability_mismatches_fail_before_loader
- tests::development_bypass_rejects_malformed_signature_metadata
- tests::actual_js_package_verifies_before_native_loader_receives_gfb
- tests::development_signature_policy_is_explicit_and_unauthenticated
- tests::signed_descriptor_mismatches_and_unknown_headers_fail_before_loader
- tests::development_bypass_retains_integrity_and_compatibility_checks
- tests::signed_adaptive_bool_package_binds_strategy_queries_and_rejects_resigned_tampering
- tests::executable_at_remains_outside_signed_package_profile
- tests::signed_debounce_domains_and_bytecode_bindings_are_checked_before_target_loader
- tests::signed_current_profiles_preserve_int_capability_identity
- tests::signed_hold_last_domains_and_bytecode_bindings_are_checked_before_target_loader
- tests::signed_quantity_descriptors_require_exact_canonical_units_before_loading
- tests::signed_nested_window_dependencies_bind_to_verified_bytecode
- tests::signed_result_sensor_metadata_is_validated_before_loader
- tests::signed_config_stream_with_elapsed_timer_preserves_native_execution
- tests::revoked_and_untrusted_keys_fail_closed
- tests::signed_time_descriptors_require_integral_bounded_configs_before_loading
- tests::signed_unsupported_bytecode_version_fails_before_loader
- tests::signed_window_manifest_substitutions_fail_before_native_loader
- tests::signed_window_package_binds_gfb4_and_executes_in_the_native_core
- tests::target_loader_must_explicitly_accept_bytecode
- tests::tampered_transport_never_reaches_loader
- tests::target_loader_panic_is_reported_as_rejection
- tests::verifier_profile_rejects_invalid_unused_entries
- tests::trusted_builder_constraint_proof_is_signed_transport_not_native_semantic_proof
