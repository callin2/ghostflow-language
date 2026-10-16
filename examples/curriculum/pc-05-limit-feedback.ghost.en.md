<!-- translation-source: examples/curriculum/pc-05-limit-feedback.ghost.md -->
[Korean original](pc-05-limit-feedback.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# PC-05 — Limit feedback and valve direction changes

<!-- ghostflow:anchor id=GF-INT-PC05-LIMIT-FEEDBACK-V1 kind=intent status=confirmed origin=imported -->
> Learning scenario: A learning scenario based on the limit-switch stage of the
> user's PLC-replacement curriculum. This document is not a direct user quote.

The linked original is the sole canonical literate executable source for PC-05. It preserves
and references lesson [E06 DirectionInterlock](../../docs/ProgrammingInGhostflow.md#e06--두-방향을-동시에-요청하면)
and the [PC-04 direction-change interlock](./pc-04-direction-interlock.ghost.md).
E06's `mutex` blocks simultaneous output requests; PC-04's wait state prevents
an immediate change to the opposite direction. This lesson adds observations
of the valve's actual end positions.

`open_request` and `close_request` are momentary requests that remain true while
pressed. `open_limit` and `close_limit` are normalized end-position observations;
when true, they indicate that the open or closed limit respectively has been
reached. Outputs are logical commands to the open/close contactor coils, not
evidence that the valve actually moved.

This new producer-quality revision distinguishes unavailable position observations from healthy false. Explicitly unavailable permission or position selects `Stopped`; only two healthy asserted limits mean `SensorConflict`. Request quality gates the existing release/rearm logic. Healthy button values do not infer physical faults, and no new START input is added. The predecessor is retained at `tests/fixtures/history/issue531/pc-05-limit-feedback.ghost.en.md.pre-input.txt`.

```ghost
// Source revision: issue531-producer-quality-pc05-v1
control LimitFeedbackValve {
  input open_request, close_request, open_limit, close_limit, stop_ok, overload_ok: Bool;
  output valve_open_contactor, valve_close_contactor: Bool;

  let reversal_wait = 2s;

  type Phase = Stopped | Closed | Opening | Open | Closing | WaitOpen | WaitClose | SensorConflict;
  // ghostflow:link id=GF-INT-PC05-LIMIT-FEEDBACK-V1 relation=implements
  state phase: Phase = Stopped;
  // ghostflow:link id=GF-INT-PC05-LIMIT-FEEDBACK-V1 relation=implements
  state request_armed: Bool = false;
  // ghostflow:link id=GF-INT-PC05-LIMIT-FEEDBACK-V1 relation=implements
  timer age = elapsed(phase);

  let requests_good = case open_request { ok(_) => case close_request { ok(_) => true; fault(_) => false; }; fault(_) => false; };
  let open_requested = open_request |> recover(false);
  let close_requested = close_request |> recover(false);
  let permission_good = case stop_ok { ok(_) => case overload_ok { ok(_) => true; fault(_) => false; }; fault(_) => false; };
  let permit = (stop_ok |> recover(false)) && (overload_ok |> recover(false));
  let position_known = case open_limit { ok(_) => case close_limit { ok(_) => true; fault(_) => false; }; fault(_) => false; };
  // Fault branch payloads cannot reach a position decision: phase gates position_known first.
  let open_observed = case open_limit { ok(value) => value; fault(_) => false; };
  let close_observed = case close_limit { ok(value) => value; fault(_) => false; };
  let conflict = open_observed && close_observed;
  let known_open = open_observed && !close_observed;
  let known_closed = close_observed && !open_observed;
  let ambiguous = open_requested && close_requested;
  let open_event = requests_good && request_armed && open_requested && !close_requested;
  let close_event = requests_good && request_armed && close_requested && !open_requested;

  request_armed' = requests_good && permission_good && position_known && permit && !conflict && !open_requested && !close_requested;

  phase' = if !permission_good || !position_known then Stopped
    else if conflict then SensorConflict
    else if phase != SensorConflict && (!permit || ambiguous) then Stopped
    else case phase {
    Stopped =>
      if open_event then Opening
      else if close_event then Closing
      else if known_open then Open
      else if known_closed then Closed
      else Stopped;

    Closed =>
      if open_event then Opening
      else if known_closed then Closed
      else if known_open then Open
      else Stopped;

    Opening =>
      if close_event then WaitClose
      else if open_observed then Open
      else Opening;

    Open =>
      if close_event then Closing
      else if known_open then Open
      else if known_closed then Closed
      else Stopped;

    Closing =>
      if open_event then WaitOpen
      else if close_observed then Closed
      else Closing;

    WaitOpen =>
      if close_event then WaitClose
      else if open_observed then Open
      else if age >= reversal_wait then Opening
      else WaitOpen;

    WaitClose =>
      if open_event then WaitOpen
      else if close_observed then Closed
      else if age >= reversal_wait then Closing
      else WaitClose;

    SensorConflict =>
      if known_open then Open
      else if known_closed then Closed
      else Stopped;
  };

  valve_open_contactor <- phase' == Opening;
  valve_close_contactor <- phase' == Closing;
  mutex(valve_open_contactor, valve_close_contactor);
}
```

If both end positions are true in any state, `SensorConflict` takes priority
and outputs turn off. Loss of permission or simultaneous requests also selects
`Stopped` and turns outputs off. The control starts in `Stopped` without
inventing a physical position. It moves to `Open` or `Closed` only after exactly
one end position is observed. If the matching limit observation disappears
while stopped at an end, it returns to `Stopped` rather than trusting old state.
If only the opposite limit is observed, the end state is reconciled to that
physical observation.

While moving, observation of the target end position stops motion in that state.
If a new request for the opposite direction arrives in the same tick, that event
takes priority over the end position: the phase enters `WaitOpen` or `WaitClose`
and both commands turn off immediately. Motion resumes only after exactly two
seconds, so the operator's request is not silently lost. A new opposite request
during the wait changes the target and restarts the full wait.

If an end position never arrives, the control remains in `Opening` or `Closing`
with the command on. This learning example intentionally exposes its missing
timeout and is not ready for hardware deployment. PC-10 adds timeout, fault
latch, and reset. `mutex` is only a software backstop; it does not replace actual
electrical/mechanical interlocks or zero-speed/position-feedback wiring.

`tools/check-pc-05.mjs` creates a fresh WASM `ControlRuntime` for each case and
does not rebuild the existing WASM. Its result is a compiler/WASM virtual trace,
not physical evidence of contact closure, valve movement, or fluid flow.
