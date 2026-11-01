# GhostFlow conformance and reliability testing

Status: normative testing policy.

A passing run of the current suite is evidence only for the requirements and
configurations that run names. It does **not** claim that the whole language,
or a physical Farm Device, is verified.

## SQLite-inspired principles

GhostFlow adopts the parts of SQLite's testing discipline that fit a small,
portable control language:

1. **Every testable normative statement is a requirement.** Each requirement
   has a stable, content-derived ID and an exact source location. It has
   either executable tests or an explicit pending reason.
2. **Test the published interface and the deployed bytes.** Parser-only or
   source-level tests cannot establish GFB, native runtime, or WASM behavior.
3. **Keep independent harnesses.** Compiler tests, GFB loader/verifier tests,
   native execution, WASM execution, and host lifecycle tests must be able to
   disagree with each other.
4. **Exercise both sides of every boundary and every boolean decision.**
   Declared limits need minimum, maximum, just-inside, and just-outside cases.
5. **Inject failures at each atomic boundary.** Check the invariant after
   every failure. A rejected compile, load, tick, reset, hot-swap, or
   persistence action must not silently commit a partial state or a partial
   output set.
6. **Treat malformed and mutated artifacts as ordinary hostile inputs.** The
   loader must either reject them without panicking, or accept them as a
   separately valid module. Never assume a mutation is equivalent to its
   source.
7. **Compare independent implementations or targets** using the same artifact
   and the same input trace. Native and WASM must agree. Because both targets
   share semantics from the same core, a separate oracle is still needed for
   those shared semantics.
8. **Measure the tests themselves.** Branch/condition coverage and mutation
   testing become release gates once their reproducible commands and justified
   exclusions are checked in. Never infer a coverage percentage from a test
   count.
9. **Every fixed defect gets a regression test.** A minimal, permanent
   regression case is required before the fix is accepted.
10. **Run the release suite on release builds.** Use release-mode artifacts and
    the same feature configuration that consumers deploy.

This policy is inspired by SQLite's public descriptions of its requirements
catalog, TH3 as-deployed tests, boundary and fault-injection loops, independent
SQL Logic Test comparisons, branch/MC/DC coverage, and mutation testing. It
does not claim that GhostFlow has reached SQLite's coverage or assurance level.

References:

- <https://www.sqlite.org/requirements.html>
- <https://www.sqlite.org/testing.html>
- <https://www.sqlite.org/th3.html>

## Requirement record

The machine-checked catalog under `contracts/requirements/` records, for each
requirement:

- a stable ID derived from the normalized normative text;
- the exact normative text and its documentation locator;
- the owning layer and the supported targets;
- the IDs of tests that exercise the statement, or a non-empty pending reason;
- a status that distinguishes verified, partially verified, and pending work.

Changing normative text creates a new ID. The previous record stays available
as superseded history. This way, what an old test proved never changes
silently.

## Verification layers

Each layer needs its own evidence. The table lists the minimum for each.

| Layer | Minimum evidence |
| --- | --- |
| Grammar | accepted and rejected token/AST cases with exact diagnostics |
| Types and lowering | typed source to inspected GFB structure and manifest |
| GFB verifier | valid, truncated, over-limit and mutated byte sequences |
| Native VM | exact state, requested intent, safe intent, fault and atomicity trace |
| WASM VM | the same artifact/trace and error class as native |
| Host lifecycle | install, activate, first scan, failed scan, reset, hot-swap and replay |
| Product adapter | identified language artifact only; no duplicate evaluator |
| Device | separate build, board/profile, driver and physical-observation gates |

## Output safety rule

**What an output declaration is.** An output declaration names and types a
logical intent port. It does not keep state. It does not configure a physical
relay's startup level or fail-safe level. Every declared output has exactly
one per-scan connection expression. To output a constant intent, write a
constant connection expression.

**Before the first successful scan.** There is no VM output intent yet. The
host/renderer must hold its configured safe state; the default Farm Device
policy is OFF. A compile, load, activation, or tick failure cannot invent an
intent from source syntax.

**Who owns physical safety.** Physical startup, watchdog, and fail-safe policy
belong to the identified host binding. They stay separate from the portable VM
program.
