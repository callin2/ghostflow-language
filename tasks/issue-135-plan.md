# Issue 135: first executable schedule slice

Tracker: https://github.com/callin2/ghostflow-language/issues/135

This dated implementation session targets only `REF-03-024` (`Daily`). The
unchanged canonical literate fixture must compile to an executable control
artifact and run through the existing Rust VM path. A host adapter may supply a
bounded, complete occurrence fact set. Rust remains responsible for predicate
evaluation, clock/admission state, projections, transaction commit and intent.

## Test first

1. Record the current exact-fixture failure at the descriptor artifact gate.
2. Add a focused executable-reference oracle with a boot baseline and one Daily
   crossing. Keep the fixture source and expected language contract unchanged.
3. Add the smallest native/WASM parity checks supported by the existing schedule
   runtime harnesses.

## Implementation boundary

- Reuse `schedule_clock` and the bounded schedule admission/runtime machinery.
- Architecture review approved a distinct GFB8/tag-3 Daily descriptor and
  control-v7 manifest. GFB7 remains PID-only. GFSF v2 transports explicit
  trigger kind and civil fold; current Solar consumers retain GFSF v1.
- Keep IANA occurrence generation and context revisions at the provider/adapter
  boundary. Do not add a JavaScript expression, state, admission or intent VM.
- Preserve Unknown reasons, boot/recovery baseline, gap terminalization,
  rollback, occurrence identity, DST policy fields and exact source identity.
- Do not change DailySlots, Periodic, Cron, TimeSlots, WorkCalendar or Tide
  behavior in this slice.

## File ownership

The issue-135 worker owns this plan, focused schedule/compiler/runtime files and
focused tests for `REF-03-024`. It does not edit `tasks/plan.md` or temporal
worker cases. The shared `tests/reference/cases/02-time-control.json` fixture is
read-only unless a legitimate executable input context is required; its source
and expectations remain unchanged.

## Acceptance

- The pre-change focused test is red for the known descriptor-only reason.
- The unchanged `REF-03-024` source produces an executable artifact.
- `ghostsim` executes a baseline and one accepted Daily crossing through Rust.
- Targeted tests pass and the change is committed locally without push, merge,
  USB or hardware work.

## Native/compiler checkpoint (2026-09-24)

- `9916c41` implements the constant Daily pulse slice and distinct native/WASM
  activation/tick entry points. It preserves the unchanged REF-03-024 source.
- Recorded red: REF-03-024 descriptor-only execution failure; missing fold
  identity; unavailable context incorrectly reported as BootBaseline; lost
  provider/context revisions in Unknown observations.
- Green: native schedule tests 24, admission tests 9, fold tests 2; compiler,
  source identity, Solar regression and low-level Daily WASM tests 18.
- Host ControlRuntime and ghostsim integration is assigned separately. This
  checkpoint does not claim that integration is complete.
- ABI details and provider responsibilities are in
  `docs/reports/2026-09-24-issue-135-daily-abi.md`.
