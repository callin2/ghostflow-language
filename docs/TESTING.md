# GhostFlow conformance and reliability testing

Status: normative testing policy. Passing the current suite is evidence only for
the requirements and configurations named by that run; it is not a claim that
the whole language or a physical Farm Device is verified.

## SQLite-inspired principles

GhostFlow adopts the parts of SQLite's testing discipline that fit a small,
portable control language:

1. Every testable normative statement is a requirement. It has a stable,
   content-derived ID, an exact source location and either executable tests or
   an explicit pending reason.
2. Test the published interface and the bytes that are deployed. Parser-only or
   source-level tests cannot establish GFB, native runtime or WASM behavior.
3. Keep independent harnesses. Compiler tests, GFB loader/verifier tests, native
   execution, WASM execution and host lifecycle tests must be able to disagree.
4. Exercise both sides of every boundary and every boolean decision. Minimum,
   maximum, just-inside and just-outside cases are required for declared limits.
5. Inject failures at each atomic boundary and verify the invariant after every
   failure. A rejected compile, load, tick, reset, hot-swap or persistence action
   must not silently commit a partial state or output set.
6. Treat malformed and mutated artifacts as ordinary hostile inputs. The loader
   must either reject them without panic or accept them as a separately valid
   module; a mutation is never assumed equivalent to its source.
7. Compare independent implementations or targets with the same artifact and
   input trace. Native and WASM agreement is mandatory, while a separate oracle
   remains necessary for semantics that both targets share from the same core.
8. Measure the tests themselves. Branch/condition coverage and mutation testing
   are release gates once their reproducible commands and justified exclusions
   are checked in. A percentage is never inferred from test count.
9. Every fixed defect gets a minimal permanent regression case before the fix is
   accepted.
10. Run the release suite against release-mode artifacts and the same feature
    configuration that consumers deploy.

This policy is inspired by SQLite's public descriptions of its requirements
catalog, TH3 as-deployed tests, boundary and fault-injection loops, independent
SQL Logic Test comparisons, branch/MC/DC coverage and mutation testing. It does
not claim that GhostFlow has reached SQLite's coverage or assurance level.

References:

- <https://www.sqlite.org/requirements.html>
- <https://www.sqlite.org/testing.html>
- <https://www.sqlite.org/th3.html>

## Requirement record

The machine-checked catalog under `contracts/requirements/` records:

- stable ID derived from normalized normative text;
- exact normative text and documentation locator;
- owning layer and supported targets;
- test IDs that exercise the statement, or a non-empty pending reason;
- status that distinguishes verified, partially verified and pending work.

Changing normative text creates a new ID. The previous record remains available
as superseded history instead of silently changing what an old test proved.

## Verification layers

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

An output declaration names and types a logical intent port. It does not retain
state and does not configure a physical relay's startup or fail-safe level.
Every declared output has exactly one per-scan connection expression. A constant
intent is written as a constant connection expression.

Before the first successful scan there is no VM output intent. The host/driver
must hold its configured safe state; the default Farm Device policy is OFF.
Compile, load, activation or tick failure cannot invent an intent from source
syntax. Physical startup, watchdog and fail-safe policy belong to the identified
host binding and remain separate from the portable VM program.

