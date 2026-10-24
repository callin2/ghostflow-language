# Explicit compact profile providers — Language #584

Date: 2026-10-24. Owner issue: [ghostflow-language #584](https://github.com/callin2/ghostflow-language/issues/584). Starting base: `1cbfd1d5931898e211514cd9946e366d868698c0` (`origin/dev` at task start). This report covers the Language candidate and parent review evidence; it is not a release or physical test receipt.

## Decision checkpoint

- Customer outcome: the same authored two-valve work from Farm Studio `/conversation` must pass virtual interaction, explanation and comparison, existing database restoration, then native deployment, testing and monitoring with source identity preserved.
- Evidenced gap: compact front matter rejected Device's explicit `software:`, `host:scan-delta-ms`, and `observation:` selectors as malformed physical channels. The current compiler emits ordinary `input` declarations as quality-bearing `manifest.sensors`; the actual two-valve source has no scalar `manifest.inputs`. A scalar-only binding rule would reject that unchanged source.
- Next action and reason: validate explicit selectors against compiler-owned sensor/input/output type and role while preserving quality and existing physical records. This supplies the Language binding plan required by existing consumers without changing the control body or installing new persistence.
- Observable acceptance: public Node and browser compilation of a two-valve-shaped source agree on plan, source SHA, and bytecode; its bytecode equals the same body without front matter. Incorrect, incomplete and colliding mappings fail with canonical source locations. Device/consumer and physical gates remain separate.

## Change and rationale

`profileRequest` accepts exact `software:<logical-name>`, `host:scan-delta-ms` and `observation:<logical-name>` selectors. Profile resolution records virtual providers as `{ provider, endpoint, role }`, preserving the exact selector and leaving physical `{ instance, channel, role, type, unit? }` records unchanged. Validation gets types from the compiler manifest, accepting dimensionless Bool/Number sensors or scalar inputs for software, dimensionless Number sensor/scalar input for the host delta, and same-name Bool output for observation. Physical inputs remain sensor bindings. All declared sensor, scalar input and output ports require bindings. No compiler manifest, source, quality rail, or provider type is synthesized or mutated.

The public synthetic test source has independent valve modes and resets, one host delta, five physical Bool contacts, six relay outputs, and five Bool diagnostic flags. It is test-only and does not copy a customer's document or imply a published board profile. Negative coverage includes unknown/malformed selectors, name/type/role errors, omissions, duplicate physical channels, a duplicate host-clock endpoint with exact YAML scalar location, and scalar/physical separation. A direct manifest check covers existing scalar-input compatibility separately from the public quality-bearing source.

## Verification and remaining gates

Before the change, `node --test tests/hardware-profiles.test.mjs` failed because `software:modeA` was rejected as malformed physical syntax. After the corrected source-grounded implementation, `node --test tests/hardware-profiles.test.mjs tests/hardware-frontmatter.test.mjs` passed (exit 0) in the local worktree with lockfile dependencies installed by `npm ci --ignore-scripts`. Node/browser plan and bytecode parity, source SHA, and unchanged body bytecode are asserted in the test. Documentation index and translation checks are run after this report and paired contract update.

Parent source-grounded probe at `2026-10-23T15:25:21.828Z`: the actual saved source digest `011eeafd49edd2fda1ae04b1d900b797cc48504bba8c9e595dcce19ae8b5aab8` compiled with proposed explicit metadata into the same 32316 bytecode bytes (SHA-256 `c04b0b18aa02710ffab5e45aa050494a7bb43bb6797fefc7be209e32606f34cc`). Node/browser plans and bytes agreed. The draft document digest is `da9aa1c90d2fd3a4c44c6199c784019caca19f3e1d7ab169095c1299f8153dcc`; it was not saved into the conversation. The actual Device candidate adapter/join path mapped five physical contacts, four software inputs, one host clock, six physical outputs and five observation flags. This checks source-derived mapping only: no ELF/signature/package/runtime/device acceptance is implied. Private source and journal are excluded from this repository.

Remaining: required full owner verification; Device Number software/host sensor production and packager adoption; exact compiler/runtime consumer pin; same customer-source deployment through existing owners; physical contact/load evidence and operational monitoring. A Language test does not establish these gates. No Docker, database migration, server deployment, firmware flash or hardware operation occurred in this slice.

The configured shared work-status/context MCP tools were unavailable in this agent session, so no central status receipt or cross-device context application is claimed. The parent retains the project-level milestone and GitHub issue update.
