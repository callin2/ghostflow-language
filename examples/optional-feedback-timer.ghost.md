# Timer control with optional observation

2026-10-05 explicit input-quality revision: unknown request retains established run state; the two-second deadline still applies. Quality does not assert a physical failure.

The operator establishes a command duration for this example: two seconds. This illustrative value is not a measured travel time or an approved setting for a particular installation. Replace it only with an explicitly established installation value. No physical feedback is required to calculate output intent.

`run_request` is a maintained Bool request. The first accepted true scan starts a new interval. Repeated true scans do not reset the timer. At two seconds, requested and safe `drive` become false. Keeping the request true does not restart it. A false scan stops immediately and commits `run = false`; a later true scan starts a fresh interval. A false/true pulse between accepted scans cannot reset the timer. On a new runtime, state and timer initialize again; a first true request starts a new interval.

`age` times the committed Bool state `run`. `run_age` is zero on a requested state transition, so start and stop take effect in the current decision. The timer uses supplied monotonic scan time. If there is no scan exactly at the limit, the next accepted scan applies the limit.

The optional `observation` capability selects `Observed` when installed and `Baseline` when absent. Both strategies issue exactly the same actuator intent. Healthy true, healthy false, missing samples and installed faults remain separate sensor observations returned by the production host. The host returns a `NotReady` reading placeholder for an absent optional sensor; capability metadata and the selected strategy establish absence. Supplying a sample cannot invent the absent capability. A fault does not select the absence strategy. This example grants observation no control authority.

Timer completion is the end of authored command duration. It does not prove Driver application, relay contact operation, load movement or position. Requested intent, safe intent, applied command and independent physical evidence remain separate.

```ghost
control OptionalFeedbackTimer {
  input run_request: Bool;
  output drive: Bool;
  input observation?: Bool;

  // Example value established by the operator; not a measured position.
  let calibrated_duration = 2s;
  state run: Bool = false;
  let requested = case run_request { ok(value) => value; fault(_) => run; };
  run' = requested;
  timer age = elapsed(run);
  let run_age = if requested == run then age else 0s;
  let timed_request = requested && run_age < calibrated_duration;

  adapt observation_policy {
    strategy Observed priority 10 match (observation: sensor<Bool>) {
      drive <- timed_request;
    }
    strategy Baseline priority 0 match always {
      drive <- timed_request;
    }
  }
}
```

Related contracts: [optional sensors and output evidence](../docs/reference/04-sensors-constraints-control.en.md), [observation and permissions](../docs/reference/05-settings-and-observation.en.md). Regression and workflow registration: [GhostFlow #382](https://github.com/callin2/ghostflow-language/issues/382).
