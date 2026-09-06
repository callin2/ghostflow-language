# Integration contract v1

This is a small compatibility and evidence contract for TASK32. It connects a
pinned language/runtime/device release to a named installation and individual
program runs. The implementation is `tools/integration-contract.mjs`; its only
dependency is Node's built-in SHA-256 implementation. It performs no file,
network, compiler, LLM, runtime, serial, or GPIO operations.

`valid: true` means the supplied records are structurally consistent and the
checked identities and hashes agree. It does not mean a gate passed, a device
was contacted, the program behaves correctly, the pinout is electrically safe,
or water was delivered. A run with a recorded `fail` can be a valid record.

## Records and ownership

The **release** has no program source hash, boot ID, timestamp, or test result.
Those belong to a **run**. A new program or device reboot can have a new run
while retaining the same release identity. Changes to a pinned component,
profile, or installation mapping require a new release digest.

| Record / field | Owner and meaning |
| --- | --- |
| `release.schema` | Contract maintainer; exactly `GhostFlow/integration-release-v1`. |
| `release.toolchain.version`, `.sha256` | Language release owner; version and exact distribution/artifact hash, including the compiler dependencies needed to reproduce it. |
| `release.runtimeSemanticsVersion` | Language/runtime owners; identifier of the execution semantics supported by both compiler and runtime. |
| `release.bytecodeFormat` | Language/runtime owners; shared bytecode format identifier. |
| `release.protocolVersion` | API/transport and firmware owners; explicit shared protocol identifier. |
| `release.device.firmwareSha256` | Firmware release owner; SHA-256 of the exact firmware image, independently of the program module. |
| `release.device.boardProfile` | Board integrator; `{id, revision, sha256}` of the approved board profile. |
| `release.installation` | Site/installation owner; `{id, revision, sha256}` of the approved logical mapping. |
| `boardProfile.boardModel`, `.endpoints` | Board integrator; specific board/revision and reviewed channel definitions, based on board documentation and separate physical checks. |
| `installation.boardProfile`, `.bindings` | Site owner; approved profile reference and explicit logical-name-to-endpoint-ID dictionary. |
| `run.releaseSha256`, `.artifacts` | Integration runner; release digest and the exact source/module/manifest digests used for that run. |
| `run.kind` | Evidence producer; `recorded-evidence` or `fictional-fixture`. A fixture label must be retained when sharing examples. |
| `run.startedAt`, `.finishedAt` | Evidence producer; canonical UTC ISO timestamps with milliseconds. |
| `run.device` | Device observation adapter; observed boot ID, observation timestamp, firmware/profile/installation/runtime/protocol identities and source/module hashes, or `null` when unavailable. |
| `run.device.installation` | Device observation adapter; `{id, revision, sha256}` of the mapping actually installed, required whenever `run.device` is non-null and compared to `release.installation`. |
| `run.gates.host`, `.hardware`, `.physical` | Respective test or observation owner; independent status, evidence source/reference, and exact scope of the result. |

Profile and installation IDs/revisions are nonempty strings. The release pins
their digests as well as their names. All SHA-256 fields use 64 lowercase hex
characters. Version identifiers are compared exactly; the validator does not
guess compatibility from semver ranges or board family names.

A board endpoint contains `direction` (`input`/`output`), `type` (the manifest's
semantic type), `driver`, `address`, `activeLevel` (`high`/`low`) and `safeLevel`
(numeric `0`/`1`). This v1 profile supports digital electrical endpoints and
explicit logical endpoints for software inputs; it does not model analog
circuitry. `driver` and `address` are explicit profile-owned identifiers, with
duplicate pairs rejected. Reserved pins should not appear as usable endpoints.
Address strings are opaque to this validator; their meaning remains the profile
integrator's responsibility.

Bindings are a dictionary such as `{ "pump": "relay.1" }`, never an array or an
inline pin assignment. Every `manifest.inputs`/`manifest.outputs` entry requires
an exact name binding with matching direction and semantic type. Declaration
order has no effect. Extra site bindings may remain unused by a program; aliasing
one endpoint under multiple logical names is rejected in v1. Generated clocks,
sensors and other runtime-provided inputs remain the runtime's responsibility;
the validator does not derive new inputs or generate any control logic.

Not every declared input needs a physical DI channel. For example, a software
`start` input can bind to the explicit endpoint ID `command.start`, declared as
`{direction: "input", type: "Bool", driver: "software-input", address:
"commands/start", activeLevel: "high", safeLevel: 0}` in the pinned profile.
Here the driver/address identify a logical input; `activeLevel` and `safeLevel`
describe its Boolean convention and default, not an electrical pin or pull
configuration. The runtime adapter owns how the software input is supplied.
This mapping still requires explicit names, matching types/directions and
profile/installation digests. The validator never assigns a DI pin to it.

Replacing `relay.1` with an undeclared `GPIO7` fails. Changing a profile endpoint
from an expander channel to a generic GPIO changes the profile digest and fails
against the pinned release. A consistently incorrect profile can still pass
these metadata checks. Profile review and electrical testing remain independent
gates, and software readback cannot establish that an installed load is correct.

## Evidence rules

Each gate has exactly `{status, source: {type, reference}, scope}`. The three gates
are mandatory and independent; there is no aggregate board/physical pass.

| Status | Meaning |
| --- | --- |
| `not_run` | No test was performed; source must be `none`, reference `null`. |
| `pass` | The stated scope passed according to its explicit evidence source. |
| `fail` | The stated scope failed according to its explicit evidence source. |
| `unknown` | Available information cannot establish the result; no conversion to pass. |

| Gate | Permitted source types besides `none` |
| --- | --- |
| `host` | `host-tests`, `injected-fixture` |
| `hardware` | `device-status`, `gpio-readback`, `register-readback` |
| `physical` | `physical-observation` |

`pass`/`fail` require a source and nonempty record reference; `none` permits only
`not_run`/`unknown`. A nonempty `scope` is always required. Hardware or physical
`pass` also requires a device observation linked to the release and artifacts.
Disconnect/failure evidence may exist with a null device identity and a
`fail`/`unknown` hardware status. The reference is a producer-owned record ID or
path; this module neither opens it nor authenticates its contents.

A host pass never fills in hardware or physical statuses. GPIO/register/device
readback cannot be the source of a physical pass. A physical observation must
say what was observed: terminal voltage, LED state, contact state and delivered
water are distinct claims. Even an accepted `physical-observation` record is
only a declaration here; this validator cannot verify its truth or infer wider
behavior. Active-low channels also mean logical output and electrical level
must not be compared as if they were the same value.

The device observation carries `bootId`, `observedAt`, `firmwareSha256`,
`boardProfile: {id, revision, sha256}`, `installation: {id, revision, sha256}`,
`runtimeSemanticsVersion`, `bytecodeFormat`, `protocolVersion`, `sourceSha256`,
and `moduleSha256`. Its timestamp must lie within the run. Installation identity
is mandatory whenever the device record exists, regardless of gate statuses.
All three installation fields must match `release.installation`; unchanged
firmware, profile and program hashes cannot conceal a different installed
mapping. Identity comparisons use observed values supplied by the adapter;
they must not be copied from expected release values and presented as observed.
The current POC protocol may need an explicit adapter/capability extension before
it can provide every field. Missing observations are not guessed. This contract
does not modify that protocol or implement firmware attestation.

## Hashes and pure API

`sha256(textOrBytes)` hashes exact UTF-8 source text or `Uint8Array`/`Buffer` bytes.
It never appends a newline or normalizes Unicode/line endings. The run's
`moduleSha256` is the hash called `bytecodeSha256` by the current compiler and
serial protocol. The supplied manifest's `bytecodeSha256` must match module bytes.

`jsonSha256(json)` sorts object keys recursively, preserves array order and
string contents, and hashes compact JSON encoded as UTF-8. Only finite JSON data
is accepted; undefined values and cycles are rejected. Use this contract-local
encoding for profile, mapping, manifest and release metadata digests. Source,
module, firmware and toolchain artifact hashes always use exact artifact bytes.

```js
import {
  validateReleaseIdentity, validateRunEvidence, validateIntegration,
} from './tools/integration-contract.mjs';

const artifacts = { source, module: compiled.bytes, manifest: compiled.manifest };
const releaseCheck = validateReleaseIdentity(release, { boardProfile, installation });
const runCheck = validateRunEvidence(runEvidence, { release, artifacts });
const allChecks = validateIntegration({
  release, boardProfile, installation, artifacts, runEvidence,
});
// Each result: { valid: boolean, errors: [{ path, code, message }] }
```

`validateReleaseIdentity` checks both supplied profile/mapping content and their
pinned references. `validateRunEvidence` checks run declarations and artifact
bytes against a supplied release; it assumes profile/mapping contents are checked
separately. `validateIntegration` performs both and checks manifest name bindings.
Omit `runEvidence` (or pass null) for metadata/artifact-only validation. It creates
no gate defaults, resolves no physical channels, and returns no execution claims.
Inputs are not mutated. Validation errors have deterministic order. Hash helpers
throw `TypeError` for unsupported inputs; validators return error records.

The existing `compileSource` owns language parsing, semantics, module generation
and manifest generation. Runtime implementations own execution, timers, schedules
and behavior tests. This contract hashes their outputs and compares declared
identities; it does not recompile source to prove source/module correspondence,
inspect firmware binaries, infer GPIOs, or duplicate runtime behavior. Bindings
are not deployed by this validator. A future adapter must explicitly consume
the validated mapping and record the binding actually installed.

Frontend/API build versions can be added by an outer integration BOM referencing
the release digest. They need not be mandatory fields in this language/device
contract. Moving these files into the language repository requires only the
validator, this directory and its dedicated test; no POC imports or submodules
are needed.

## Fictional example and regression tests

`examples/fictional-fixture.json` is a complete fictional set of linked records.
The module bytes and source are deliberately non-executable. Toolchain and
firmware hashes are illustrative identifiers; metadata/source/module digests
are internally consistent. Decode `artifacts.moduleHex` to bytes and pass it as
`artifacts.module` when using the API (hex is just the JSON fixture encoding).

The tests use this fixture only. No board, LLM, compiler, or live HTTP service is
called, and no evidence files are generated. Run only:

```sh
node --test tests/integration-contract.test.mjs
```

The tests cover wrong boards and profiles, generic GPIO substitution, mapping
drift, declaration-order independence, mismatched artifacts, observed identity
mismatches, and the prohibition on promoting host/readback evidence into a
physical pass. These tests establish contract behavior only.
