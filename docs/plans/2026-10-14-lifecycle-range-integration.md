# Lifecycle and immutable IANA Range integration

This owner-source integration preserves restart lifecycle and immutable IANA
Range together. It does not publish a runtime, deploy consumers or establish
physical output evidence. References: [PR536](https://github.com/callin2/ghostflow-language/pull/536)
and [issue541](https://github.com/callin2/ghostflow-language/issues/541).

## Evidence and allocation

The baseline is `dev` at `06c09444fda9acee04ecc96d5e549deac85f91df`.
Lifecycle PR536 at `2e59196e25bc46deab3ce93b375f54dd35b35b9c` describes
its GFB21 envelope as provisional and unpublished. Range at
`d8ffb18eef3a970c96356375597b52783ea4c6d2` assigns GFB21 to immutable
civil Range. Published prerelease `ghostflow-runtime-99ca1a3` instead used
GFB19 for a lifecycle envelope; preserve that release and its consumer pins.

Keep Range21 and allocate the distinct lifecycle22 envelope. It contains the
unchanged inner GFB bytes and checked restart descriptor. The six existing
runtime tags `0c545af`, `81814e4`, `9155047`, `96cab9b`, `99ca1a3` and
`b50bec3`, together with these owner refs, contained no GFB22 allocation in
the checked loader, tools, tests or documentation. This is checked historical
scope, not a claim about all future branches. The `81f2532` GitHub release
record remains a draft with no publication timestamp.

Renumbering Range would discard its current source allocation unnecessarily.
Reusing21 with sniffing or a new tag would leave two incompatible meanings
behind one header and could misinterpret saved bytes. Distinct22 avoids that
ambiguity. Historical lifecycle19 and provisional lifecycle21 are explicitly
rejected without translation or fallback. Migration recompiles reviewed source
with this owner candidate and then coordinates exact consumer pins.

## Responsibilities and admission

Language owns compilation, descriptor validation, inner bytecode execution and
framed-runtime restart initialization. The host supplies the actual restart
reason, or `Unknown` without evidence, and whether the boot event remains
pending. The reason stays fixed during a run; the first successfully committed
scan consumes the pending event. A rejected scan retains it. Program replacement
after consumption does not manufacture another boot event. Authoring and
consumer binding preparation exclude these runtime-owned ports from physical
acquisition inputs; they do not supply invented observations or resume state.
Authored transitions own recovery behavior. Device installation policy and the
output renderer own physical output application and evidence.

Portable packages retain existing base-profile admission: formats1–4,10 and11
may be wrapped with22. The integration also admits immutable IANA Range21 and
22 with inner21, paired with control-v21 and context-scan-abi-v5. Full JS owner
replay and native decoded-descriptor/expression-byte checks bind the signed
manifest, including arbitrary supported predicates, before the target loader.
Wrapping does not admit every Range profile into portable packages, and11 retains
its scalar-config/Periodic limits. No VM execution or GFB meaning changes are
needed: runtime bytes may match the prior build35, while the new source revision
and officially issued package/build identity remain distinct. Host Range execution
still supplies valid time coverage and occurrence
facts, while the shared core validates and executes the authored schedule.

## Verification and integration order

Native/WASM regressions cover combined immutable IANA Range and restart behavior,
including the first pending event and consumption only after commit. Rejection
coverage includes historical19, provisional lifecycle21, malformed descriptors,
nested wrappers, truncation and trailing bytes. Existing supported profiles remain
supported. These tests exercise software facts, not hardware-confirmed causes.

The full verifier exposed overlapping test-file Cargo recompiles of the shared
WASM output: one reader failed with ENOENT while another compilation replaced
that artifact. A 256-scan console case also exceeded its 90-second bound under
concurrent load; isolated calendar and console checks completed in 0.626 and
43.8 seconds. The verifier therefore runs Node test files serially with
`--test-concurrency=1`, preserving dev's isolated console test batch, and allows
600 seconds for each suite gate; other gates
retain 180 seconds. This changes verification scheduling and the suite timeout,
not scan semantics, user quotas, individual test oracles or runtime limits.

Integrate and verify Language first, then its exact Authoring/Simulator consumers,
then API/Web bindings and presentation. Keep candidate source, package identity,
published artifact and actual running service evidence separate. Draft PR and
local test success alone do not establish publication or deployment.
