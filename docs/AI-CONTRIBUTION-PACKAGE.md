# Bounded AI contribution package

English | [한국어](AI-CONTRIBUTION-PACKAGE.ko.md)

This concrete package supports [#134](https://github.com/callin2/ghostflow-language/issues/134).
It gives a contributor enough evidence to investigate one boundary regression
without importing conversation history. It does not authorize a language-rule
change or device execution. Follow [CONTRIBUTING](../CONTRIBUTING.md) and
[the workflow](DEVELOPMENT-WORKFLOW.md) for the complete repository gates.

## Exact baseline and task

The preparation baseline is dev `5f87876a170a9e4c7da9d15f4c99a70c502e7b1a`.
Record the actual base/candidate SHA and clean status for each contribution;
this historical baseline is not a claim that an old run verifies a new head.
The package adds evidence without changing compiler or Rust behavior.

Task: investigate a regression where an intent is allowed at a forbidden
boundary. The fixed case requires `pump=false` when numeric moisture is 42.5
or higher. A proposed change must retain the independently specified oracle.
Do not generalize this example into an installation-wide safety policy.

Minimum reading and contracts:

- `GF-REQ-cf3758241cf74c21`: requested intent and safe intent are distinct;
  [catalog](../contracts/requirements/catalog.json), Reference
  [§4.7](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed).
- `GF-REQ-fe719c3299fc1258`: atomic state/intent commit;
  [Reference §2.8](reference/02-types-expressions-state.en.md),
  [requirements validator](../contracts/requirements/validate.mjs).
- Test selector `GF-TEST-contribution-field-boundary` in
  [runtime conformance](../tests/runtime-conformance.test.mjs).
- Exact canonical input [numeric-threshold.ghost.md](../tests/fixtures/contribution-134/numeric-threshold.ghost.md)
  and independent [oracle.json](../tests/fixtures/contribution-134/oracle.json).

The field-derived source/oracle come from Device #43's software-input,
virtual-output case at immutable revision
[`618e45046f1c8be748eeec6767d5ffe0ea997a11`](https://github.com/callin2/farm-device/tree/618e45046f1c8be748eeec6767d5ffe0ea997a11/tools/hil/cases/numeric-threshold-virtual-ro1).
The selected board is `waveshare-esp32-s3-eth-8di-8ro-r8n16`; these identities
describe provenance, not a board validated by this language contribution.
The oracle is 42.4→true, 42.5→false, 42.6→false, 42.4→true. No expected value
is generated from compiler output or native/WASM agreement.

## Reproduce and demonstrate sensitivity

After pinned dependencies and native/WASM targets are available:

```sh
npm ci --ignore-scripts
cargo build --locked --offline -p ghostflow-core --release --example run
npm run build:wasm
node --test --test-name-pattern GF-TEST-contribution-field-boundary tests/runtime-conformance.test.mjs
node --test tests/runtime-conformance.test.mjs tests/requirement-catalog.test.mjs
```

Use the existing compact wrapper when installed. Dependency setup may require
the repository's normal locked Cargo fetch first; report infrastructure failure
separately. `npm test` and CI remain the complete regression gates.

The focused test compiles the unchanged fixture once and supplies identical
bytes/input tape to native Rust and WASM. It checks requested/safe results
against the field oracle. The WASM ABI's explicit input-clear negative rejects with
`missing input moisture`, preserves the committed outputs, and recovers on the
next explicit input. The CSV native runner skips wholly blank lines, so this
sole-input omission is not claimed as a native comparison. This is a language
negative case, not Device degraded
quality: that pinned adapter initialized Number inputs to zero/retained partial
updates and had no quality channel.

Two temporary, in-memory mutations change `<` to `<=` and replace the condition
with `true`. Each must compile and execute normally on both targets; the
unchanged oracle assertion must then fail. The green test checks that these
assertions go RED, so a compiler crash, timeout, or missing runner cannot count
as a killed mutation. No product source is modified by this demonstration.

## Allowed changes and review evidence

Keep a contribution to the demonstrated owning compiler/core path and this
focused regression, with relevant bilingual rule documentation/changelog only
if behavior changes. Do not alter Device firmware, bindings, drivers, deployment,
UI policy, or historical benchmark hashes. The current package changes evidence
only; an actual regression fix needs its own before/after reproduction.

The issue/PR templates request exact identities, commands/exit status,
before/after results, independent expected values, bounds and remaining gaps.
Review these diff categories separately:

1. Protection expression removal or weakening, including boundary operators.
2. Expected-value edits in `oracle.json` and the test's independent constant.
3. Test deletion, `.skip`/`.todo`, selector/runner-list removal or assertion loss.
4. Requirement `status`, `testIds`, locator digest and `pendingReason` changes.

Use `git diff BASE_SHA...HEAD -- tests/fixtures/contribution-134 tests/runtime-conformance.test.mjs tools/verify-language.mjs contracts/requirements/catalog.json`
and inspect the implementation diff separately. Catalog validation catches
broken references/status contracts; it cannot determine whether a weakened
oracle is correct. Legitimate specification changes need cited authoritative
evidence and a separate independent meaning review; changing both implementation
and expected values does not itself prove correctness.

Native/WASM agreement proves portability for the input tape. Both share Rust
and can share the same misunderstanding. The field oracle adds an independent
boundary expectation, not universal correctness or physical protection proof.
No contact, load, missing-quality channel, driver failure, reboot, live settings,
power interruption, or HIL trust boundary is validated here; Device #43/#45
retain those owners and gaps. Retain exact CI/report/artifact identities and
fresh postmerge evidence when reporting completion.
