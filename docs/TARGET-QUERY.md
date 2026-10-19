# Target contract query

This pure host API describes a caller-supplied GhostFlow target. It does not contact a Device, discover installed hardware, authenticate reports, or promise future availability. It is tracked by [#562](https://github.com/callin2/ghostflow-language/issues/562) and uses the shared contract work in [#565](https://github.com/callin2/ghostflow-language/issues/565). The [Korean version](TARGET-QUERY.ko.md) has the same contract.

`queryTarget(request)` is exported from `tools/target-query.mjs`. `node tools/ghostdescribe.mjs --request request.json --format json` reads a JSON or TOON request and writes a JSON or TOON result. TOON is the CLI default. Malformed input throws `TargetQueryError` from the API; the CLI emits a bounded `rejected` result and exits 1. Neither path uses a clock, filesystem, network, compiler or device in the query itself. The CLI only reads its request file. `asOf` and `maxAgeMs` are mandatory, so the same request yields the same answer.

## Request

The top-level object has exactly `schema`, `asOf`, `maxAgeMs`, `target`, and optionally `installed`, `observations`, `filter`:

| Field | Shape and meaning |
| --- | --- |
| `schema` | Exact string `GhostFlow/target-query-v1`. |
| `asOf` | Canonical UTC ISO timestamp with milliseconds, such as `2000-01-01T00:00:10.000Z`. |
| `maxAgeMs` | Integer 0–31,536,000,000. A report is stale when `asOf - observedAt > maxAgeMs`; a later report is future. |
| `target` | Declaration object below. |
| `installed` | Optional installation report below. Its presence alone does not make it current or matching. |
| `observations` | Optional array of observation snapshots. Omission means no observations. |
| `filter` | Optional explicit filters below. Omission selects all declared channels and no examples. |

`target` requires `id`, `release`, `boardProfile`, `installation`, `drivers`, and `channels`; it may include `examples`. `release`, `boardProfile`, and `installation` are the existing `integration-release-v1`, `board-profile-v1`, and `installation-mapping-v1` objects. Their exact pinned identities and SHA-256 hashes are checked by `validateReleaseIdentity`. The profile and mapping are **declared** plans, including planned logical bindings; they are not installation evidence. `id` is an explicit target identifier. Release runtime semantics, protocol, firmware SHA, profile and mapping references appear in the result as declared facts.

`drivers` is an array of unique `{ id, version, sha256 }` objects. Every board profile endpoint's `driver` must have a versioned reference. `channels` contains exactly one record for each profile endpoint, with unique `id` equal to the endpoint name. Each record requires `id` and may provide `unit` (text), `updatePeriodMs` (positive integer), `features` (unique text array), or `resources` (unique text array). Direction and type come from the pinned profile, and logical names come from the pinned mapping. No units, rates, features, resources or hardware defaults are inferred. Resource IDs name caller-defined constraints; this query does not define or discover their physical meaning. Omitted `resources` means constraints are unknown and blocks an `available` conclusion. Explicit `resources: []` says there are no resource constraints in this declaration.

Each optional example is `{ id, ref, tags, channels }`. `id` is unique; `tags` and `channels` are nonempty unique text arrays, and each channel must exist in the declaration. `ref` is an opaque reference. The query neither reads nor validates its content.

`installed` requires `{ targetId, bootId, releaseSha256, drivers, observedAt, evidenceRef }`. `releaseSha256` is `jsonSha256(target.release)` from `tools/integration-contract.mjs`, and `drivers` lists the exact declared IDs, versions and SHA-256 digests. The report is `installed_reported` only when identity matches and its time is fresh. It remains a supplied report, not an independently verified installation.

Each observation requires those same identity fields plus `channels` and `resources`, arrays of unique `{ id, state }` entries. State is `available`, `busy`, or `reserved`. Observations must match the target, installed boot ID, release SHA and complete driver references; the installed report must itself be fresh and matching. Observations without one are `unlinked_installation`. Every observation has an explicit `evidenceRef` and canonical `observedAt`. These are provenance labels supplied by the caller, not authenticated evidence.

`filter` supports `channels`, `directions`, `types`, `features`, `contractVersions`, and `exampleTags`, each a nonempty unique string array when present. Values within `channels`, `directions`, `types`, and `contractVersions` are OR; different fields are AND. Every requested feature must be declared on a channel. `contractVersions` means the channel driver's exact `version`, not release protocol, bytecode, runtime or firmware version. Unknown values return zero channels. `directions` accepts only `input` and `output`. Examples appear only when `exampleTags` is supplied, at least one requested tag matches, and the example names at least one selected channel. No semantic similarity or inferred relevance is used.

## Result and limits

The result schema is `GhostFlow/target-query-result-v1`. It contains `asOf`, `targetId`, `requestSha256`, `targetSha256`, `declared`, `installation`, `channels`, `examples`, `diagnostics`, and `suppliedEvidence`. The two SHA-256 fields are canonical JSON digests of the complete supplied request and target declaration, so a result can be tied to exact input. Each selected channel has its declared identity, driver, logical names, optional supplied metadata, `installation`, `observation`, and `availability`. Missing metadata remains absent. Installation is `unknown` or `installed_reported`; observation is `unknown` or `observed` **for that channel**. Availability is `unknown`, `available`, `busy`, `reserved`, or `conflict`. It is available only when that channel has at least one fresh linked state, its resource constraints are explicitly declared, and every declared resource state is present and all agree on available. Any disagreement among fresh linked states yields `conflict`, regardless of report order or recency. A missing state yields unknown unless a conflict already exists. `diagnostics` records invalid report source/index/evidence reference, observed time, target and boot IDs, and codes such as `target_mismatch`, `boot_mismatch`, `release_mismatch`, `driver_mismatch`, `stale`, `future`, and `unlinked_installation`. Invalid reports never supply availability. `suppliedEvidence` retains detached installed and observation reports with their exact reference, time, target, boot, release/driver identities, channel/resource states and `linked_fresh` or `excluded` status. These remain caller-supplied claims.

The pure API snapshots input and returns data without aliases to the caller's objects. Input must be acyclic JSON data, at most 262,144 serialized UTF-8 bytes, depth 16, 12,000 visited nodes, 1,024 elements or keys per generic container, and 4,096 characters per generic string. Contract-specific lists are smaller: at most 256 channels, 128 observations/drivers/examples, and 32 features/resources/tags per record. Identifiers and references are at most 256 characters. Duplicate IDs or filter values, empty supplied filter arrays, unexpected fields, sparse arrays and noncanonical timestamps are rejected. The CLI also caps its input file at 262,144 bytes before parsing. A complete result is capped at 65,536 UTF-8 bytes. If the expanded result exceeds that bound, the API returns an `outcome: "incomplete"` envelope with `output_limit`, exact input digests and no partial channel answer; the CLI exits 1. Narrow the supplied reports or filters and retry.

## Fictional, executable example

This uses the repository's [fictional integration fixture](../contracts/integration-v1/examples/fictional-fixture.json). Its labels, identities and evidence are invented; it is not a device result or deployable program. Run from the repository root:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { queryTarget, TARGET_QUERY_SCHEMA } from './tools/target-query.mjs';
const f = JSON.parse(readFileSync('contracts/integration-v1/examples/fictional-fixture.json', 'utf8'));
const result = queryTarget({
  schema: TARGET_QUERY_SCHEMA,
  asOf: '2000-01-01T00:00:10.000Z',
  maxAgeMs: 5000,
  target: {
    id: 'fictional-target', release: f.release,
    boardProfile: f.boardProfile, installation: f.installation,
    drivers: [
      { id: 'fixture-relay-expander', version: 'fictional-v1', sha256: '3'.repeat(64) },
      { id: 'fixture-input-driver', version: 'fictional-v1', sha256: '4'.repeat(64) },
    ],
    channels: [{ id: 'relay.1' }, { id: 'relay.2' }, { id: 'input.1' }],
  },
  filter: { channels: ['relay.1'] },
});
console.log(result.channels[0].availability); // unknown
JS
```

The caller's supplied installed and observed reports can move this query to a current reported state. That state is tied only to `asOf` and the supplied evidence; it is not a reservation, authority check or physical actuation result.
