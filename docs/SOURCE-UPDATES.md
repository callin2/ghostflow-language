# GhostFlow Source Change Comparison and Update Scope

`tools/source-changes.mjs` and `tools/update-request.mjs` are shared modules usable from browser and Node code. They provide structural comparison and change-scope checks in this repository. They are not wired into production conversation or device-installation flows.

## Compare source documents

```js
import { inspectSourceChanges, sourceChangeInventory } from './tools/source-changes.mjs'

const inventory = sourceChangeInventory(beforeDocument)
const comparison = inspectSourceChanges(beforeDocument, afterDocument)
```

The inventory uses `GhostFlow/source-change-inventory-v1`; comparison uses `GhostFlow/source-changes-v1`. The parser compares recognized control declarations and YAML hardware front matter in five categories:

| Category | Meaning |
| --- | --- |
| `config-default` | Initial default value of an existing setting |
| `config-definition` | Setting declaration, type, bounds, access metadata, and related definition |
| `control-rule` | Control rules, including state, timer, schedule, and connection declarations |
| `logical-io` | Logical input and output declarations, including external calendar and provider declarations |
| `hardware` | Device and wiring structure written in source front matter |

Each change includes a `target`, an `operation` (`add`, `remove`, or `modify`), and structural `before`/`after` values. Changes limited to prose, comments, code locations, declaration order, or grouping are not reported as structural changes.

## Command line

```sh
node tools/ghostdiff.mjs before.ghost.md after.ghost.md
node tools/ghostdiff.mjs before.ghost.md after.ghost.md --json
node tools/ghostdiff.mjs --help
```

With no arguments, the command prints help and exits 0. A successful two-file comparison prints a category summary or the `--json` result and exits 0. Invalid arguments, files, UTF-8, or source syntax exit 2. The command is read-only: it does not modify either file or compile, execute, or install a program.

## Share the module

The browser and Node toolchain entry points re-export the same functions. A browser bundler can also import `tools/source-changes.mjs` directly. Only the CLI wrapper reads files; the shared module takes two strings and returns structured data.

To hand off a source-only package from a committed revision:

```sh
node tools/package-source-changes.mjs /tmp/ghostflow-source-package
```

The resulting `@ghostflow/source-changes` archive exports the comparator at its root, the preflight module at `./update-request`, and the `ghostdiff` executable. `provenance.json` records the owner revision and file hashes. This archive does not build or certify an execution compiler, VM or firmware. It does not update a consumer automatically.

## Preflight an update request

Before Authoring generates a candidate, callers check the requested scope against the current source. This module does not interpret natural language or generate source.

```js
import { planSourceUpdate, verifySourceUpdate } from './tools/update-request.mjs'

const request = {
  format: 'GhostFlow/update-request-v1',
  sourceSha256: sourceChangeInventory(beforeDocument).sha256,
  items: [
    {
      id: 'duration',
      summary: 'Adjust the default watering duration',
      changes: [{ operation: 'modify', target: { kind: 'config', name: 'duration', part: 'default' } }],
      requires: [],
      usesInputs: [],
    },
  ],
}

const plan = planSourceUpdate(beforeDocument, request, { editor: 'simple' })
// The planner does not authorize or perform edits.
const check = verifySourceUpdate(beforeDocument, candidateDocument, request, {
  editor: 'simple', approved: ['duration'],
})
```

The request has exactly these top-level fields:

- `format`: `GhostFlow/update-request-v1`
- `sourceSha256`: the current source inventory's 64-character lowercase SHA-256
- `items`: 1 to 64 change items

Each item has exactly `id`, `summary`, `changes`, `requires`, and `usesInputs`. `id` is unique and `summary` describes the item. `changes` contains 1 to 16 `{ operation, target }` objects. A `target` has exactly `{ kind, name, part }`. Operations are `add`, `remove`, and `modify`. A setting default uses `{ kind: 'config', part: 'default' }`; a setting definition uses `part: 'definition'`; other declaration targets use `part: 'declaration'`. Target existence must match the operation, and a target cannot be edited twice. A config default can only be modified when it already exists.

`requires` lists prerequisite item IDs; `usesInputs` lists input names used by the item. Unknown IDs, dependency cycles, duplicate targets, unexpected fields, and a request whose source hash is stale are rejected.

`editor: 'simple'` allows config defaults and definitions, plus rule changes using inputs already in use. Logical I/O declarations, hardware/wiring, and import changes are outside this editor's scope. An item that adds an input declaration or uses an input that is not already in use is deferred. Items depending on deferred work are also deferred. If one item combines allowed and out-of-scope targets, the whole item is deferred. `editor: 'full'` does not apply these simple-editor scope restrictions.

The planner returns `GhostFlow/update-plan-v1` with `apply` and `deferred` items annotated with reasons. It does not edit source. `verifySourceUpdate` checks approval and prerequisites, then reports structural candidate changes outside the approved scope. In simple-editor mode, newly used inputs and newly unresolved references also fail the check. A candidate that cannot be parsed causes verification to throw.

Deferring logical I/O, hardware/wiring, and dependent work into a farmer's personal TODO shown in the conversation is not implemented yet. The plan's `deferred` list is only a classification result; it does not save TODOs or display them in a conversation.

## Guarantees and boundaries

- Comparison is syntactic and structural. It does not certify semantic compilation, execution, device compatibility, or safety.
- Import statements are compared as declarations. Imported files are not followed, and their declarations are not expanded into the comparison.
- Only hardware structure written in YAML front matter is compared. Host-provided metadata such as `remote-panel` and live setting values are not certified or validated.
- `config-default` means a default written in source. It does not represent live setting events or the value currently applied by a device.
- An editor name or UI flag is not authorization. This tool provides no access control, approval, account permission, or installation.
- The shared modules are not yet connected to production chat/API/device-installation flows.
