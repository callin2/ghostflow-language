# Explicitly adopted feedback inhibition

2026-10-05 explicit input-quality revision: unknown request retains established run state; the two-second deadline still applies. Quality does not assert a physical failure.

This separate source explicitly adopts a diagnostic permissive rule: a healthy
true observation permits a timed request; healthy false or any sensor fault
inhibits it. This illustrative stop rule is authored policy for this example,
not a universal response to missing feedback. The [observation-only timer](optional-feedback-timer.ghost.md)
remains valid without physical feedback and gives observation no control authority.

The operator-established illustrative command duration is two seconds. The
timer measures maintained request duration, not movement or Driver application.
Inhibition neither resets nor extends that duration. Recovery before the deadline
can permit the remaining request; recovery at or after the deadline cannot restart
it. Stop/restart semantics are those of the linked timer example.

`observation` is a required Bool sensor. In the reference host, no supplied sample
conditions to `NotReady`; the authored `fault(_) => false` branch inhibits output.
An empty optional-capability list does not remove this required declaration.
An unknown sample role or mismatched capability type is rejected. An incomplete
native scan frame is rejected before a decision. None of these conditions selects
the observation-only example or another strategy.

Adoption is recorded in this canonical source revision and its compiled artifact.
Replay uses that same document, bytecode and supplied request/sample frames.
The existing source-map verifier rejects an expected revision belonging to the
observation-only document. No new deployment or replay service is implied.
Requested and safe intents remain separate from applied commands and independent
physical evidence. A diagnostic Bool does not establish movement or position.

```ghost
control ExplicitFeedbackAdoption {
  input run_request: Bool;
  output drive: Bool;
  input observation: Bool;

  // Illustrative operator-established command duration, not measured motion.
  let calibrated_duration = 2s;
  state run: Bool = false;
  let requested = case run_request { ok(value) => value; fault(_) => run; };
  run' = requested;
  timer age = elapsed(run);
  let run_age = if requested == run then age else 0s;
  let timed_request = requested && run_age < calibrated_duration;
  let permit = case observation { ok(value) => value; fault(_) => false; };
  drive <- timed_request && permit;
}
```

Contracts: [required/optional sensors and output evidence](../docs/reference/04-sensors-constraints-control.en.md),
[observation permissions](../docs/reference/05-settings-and-observation.en.md).
Regression: [GhostFlow #384](https://github.com/callin2/ghostflow-language/issues/384).
