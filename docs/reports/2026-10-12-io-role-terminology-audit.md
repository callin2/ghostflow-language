# I/O role terminology migration audit — 2026-10-12

The audit covers tracked Markdown documentation, README and ownership guides, design/development/installation guides, reference chapters, research and task plans, examples, runtime/contract READMEs, feature-status catalog prose and its generated view, and embedded physical sequence labels. The initial bounded inventory found 153 Markdown files containing driver/renderer terms. Input production is driver; output application is renderer; the cabinet operator UI is `@ghostflow/cabinet-view`. USB force-feedback joystick and EC11+TFT remain boundary examples only. Driver/renderer source belongs in `farm-device-drivers`; Device owns host/board integration and failure policy.

Reproduce the role inventory with `rg -n -i 'driver|renderer|드라이버|렌더러' --glob '*.md' --glob '*.svg'`. Review context rather than replacing every matching token. The glossary defines Driver, Renderer and Cabinet-view separately. Current links target the cabinet-view observation heading; old renderer heading fragments remain explicit aliases for published links.

## Intentional retained names and evidence

- Input producers and certified sample/interval contracts retain driver, including keyboard, sensor, clock and event inputs.
- `ScanDriver`, framed/native scan driver names, common host ABI identifiers, `gfdrv_*`, `GF-INT-COMMON-SCAN-DRIVERS`, draft ABI title/path and typedefs remain common adapter identities. The ABI draft explains its input/output roles without adopting or changing that ABI.
- Board-profile JSON `driver`, `driver/address`, `software-input` and quoted protocol/validation diagnostics retain exact field/token spelling. Console display metadata is called a channel descriptor; its existing schema is unchanged.
- External issue titles, source filenames, pinned URLs and third-party Cycle.js/printer-driver analogies retain their source identity. These do not redefine the output renderer role.
- Historical `CHANGELOG*`, `docs/reports/*`, `DOCS-REVIEW-REPORT.md`, `tests/reference/BASELINE.md`, `tasks/reference-evidence.md`, dated authoring efficiency/baseline records and `tests/fixtures/history/*` remain historical evidence. Pinned source excerpts, requirement statement IDs and historical artifact digests are unchanged.
- Rendered sequence SVG visible labels follow the migrated physical sequence. Its embedded PlantUML provenance token retains the original rendering provenance; no new rendering or hardware verification is claimed.
- Mermaid node identifier `driver` in the README is diagram-local identity; its visible output role is renderer. Runtime test filenames and executable fixtures are not renamed.

## Verification scope

Translation pairs and current reviewed hashes, document indexes, exact reference links, requirement catalog and feature-status generation are checked locally. PC-01 current projection generation follows repository policy; no replay frames or historical benchmark digests are rewritten. Existing dependency files are reused read-only from the original checkout through a temporary local symlink; no packages are installed. No real LLM call, build, Device operation, push, PR or publication occurs. Host documentation/compiler checks do not establish physical behavior.

## Independent review correction

Independent review P2 found physical renderer ownership incorrectly changed to cabinet-view in active prose. The cause was a line-level UI substitution that matched physical-output sentences mentioning display, metadata or observation. The review compared the faulty assignments against the output role and reference §5's correct UI boundary. Corrected physical application, relay polarity, output acceptance bounds, renderer disconnection, installation-ledger application evidence and stop cleanup/receipt passages; genuine presentation references remain cabinet-view. The same-pattern audit includes bilingual architecture/research prose and example counterparts, plus generated feature-status source. Historical evidence and executable GhostFlow fences are unchanged.

Added `tests/io-role-documentation.test.mjs` to `docs:check` and the explicit full verifier test list. Before correction all four cases failed on the current documentation; after correction all four pass. The regression checks active tracked Markdown and feature-status source for the known erroneous physical ownership assignments, verifies bilingual stop and relay-polarity passages, checks both translated timer examples, and retains positive cabinet UI presentation and non-confirmation assertions. Translation digest checks alone could not detect this semantic ownership error.
