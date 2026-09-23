# Temporal policy decisions

Status: **approved product decisions recorded in Reference §§3.5 and 4.4**. This
file remains a test and technical-contract planning record. It does not claim
compiler or runtime support.

## Settled decisions

### `true_for`

`true_for(..., quality: measured)` may accumulate only continuous intervals
that the installed Driver certifies were actually observed. Separate point
samples do not certify the interval between them. The compiler/runtime must not
interpolate between samples or treat expected cadence, scan cadence, duplicate
samples, or clock-only ticks as observed continuity.

Applied to Reference §4.4 after the existing `true_for` sentence:

> 연속성은 Driver가 실제 관측되었다고 인증한 interval만 이어 붙인다. 서로 떨어진
> sample 사이를 보간하거나 expected cadence, scan cadence, duplicate, clock-only tick을
> 관측 증거로 간주하지 않는다.

### `after_event`

Every distinct start event has an independently tracked result. Overlapping
events remain distinguishable. A later start event does not overwrite an older
pending or completed result. The existing half-open interval `[e,e+window)`
continues to apply to each event identity.

Applied to Reference §4.4 after the existing `after_event` sentence:

> 겹치는 event도 identity별 result를 독립적으로 유지한다. 새 start event는 이전
> pending 또는 completed result를 덮어쓰지 않는다.

This resolves the product choice previously marked pending in
`tasks/after-event-design.md`: select independent per-event results.

### Multiple schedule crossings

When one accepted observation interval crosses two or more occurrences of the
same schedule, record every crossed occurrence as missed and execute none of
them. This rule is limited to the multiple-crossing case. A scan that crosses
exactly one occurrence continues to use the ordinary pulse admission rules.

Applied to Reference §3.5 under observation gaps and recovery:

> 하나의 accepted observation interval에서 같은 schedule의 occurrence를 둘 이상
> 교차하면 교차한 occurrence를 모두 missed로 기록하고 어느 것도 실행하지 않는다.
> 정확히 하나만 교차한 경우에는 ordinary admission 규칙을 그대로 적용한다.

## Decisive specification scenarios

1. **Certified continuity:** two touching Driver-certified true intervals whose
   union reaches the positive duration make `true_for` true at the boundary.
2. **No interpolation:** true point samples at `t=0` and `t=d` with no certified
   interval between them do not satisfy `true_for`, regardless of expected or
   actual scan cadence.
3. **Continuity break:** a gap in certified coverage, false interval, or
   inadmissible quality resets the accumulated true interval.
4. **Overlapping events:** event `A` starts, then event `B` starts before `A`'s
   window ends. Predicate observations update separately addressable `A` and
   `B` results; `B` never replaces `A`.
5. **Half-open event boundary:** evidence exactly at `e + window` is excluded
   only from that event's result and cannot erase another overlapping result.
6. **Multiple Solar crossings:** with `gap = skip_after(3days)`, an accepted
   interval containing two Solar occurrences records both as missed, produces
   no execution for either, and an identical retry cannot duplicate the two
   records after commit.
7. **Single-crossing control:** the same schedule with one crossed occurrence
   follows ordinary predicate/admission behavior, proving the new missed policy
   was not applied broadly.

## Technical contracts still required

These decisions do not choose the following implementation contracts:

- Driver interval-certificate wire shape, trust binding, coverage validation,
  clock/epoch identity, and proof propagation through transformed signals.
- Bounded state, checkpoint, replay, and resource accounting for certified
  intervals.
- Event input ABI, opaque identity binding, independently addressable result
  projection, result retention, overlap capacity, lateness, negative/pending
  result shape, and event fault/quality behavior.
- The typed missed reason and trace representation for multiple schedule
  crossings, complete provider-fact bounds, occurrence-ledger capacity, replay
  encoding, and correction handling.
- Any concrete byte layout, ABI, storage budget, overflow rule, or deployment
  provider capability.
