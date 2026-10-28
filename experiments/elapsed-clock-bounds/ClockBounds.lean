import EpochModule

namespace BoolTranslation.ElapsedClockBounds
open SensorMachine EpochMachine

def maxClock : Nat := 9007199254740991

def AcceptedFrom : Nat → List (Input Nat) → Prop
  | _, [] => True
  | previous, input :: rest =>
    previous ≤ input.now ∧ input.now ≤ maxClock ∧ AcceptedFrom input.now rest

def expressionAge (before : Epoch Nat) (input : Input Nat) : Nat :=
  if before.initialized then input.now - before.since else 0

def committedAge (observation : Observation Nat) (input : Input Nat) : Nat :=
  if observation.epoch.initialized then input.now - observation.epoch.since else 0

structure ScanBounds (before : Epoch Nat) (input : Input Nat) (observation : Observation Nat) : Prop where
  sourceStep : observation = sourceScan before input
  beforeEpoch : before.since ≤ input.now
  afterEpoch : observation.epoch.since ≤ input.now
  clockRange : input.now ≤ maxClock
  expressionRange : expressionAge before input ≤ maxClock
  committedRange : committedAge observation input ≤ maxClock
  expressionDifference : before.initialized = true → expressionAge before input + before.since = input.now
  resetZero : (!before.initialized || SensorStateMachine.result input.reading) = true →
    committedAge observation input = 0
  retainedEqual : before.initialized = true → SensorStateMachine.result input.reading = false →
    committedAge observation input = expressionAge before input

instance (before : Epoch Nat) (input : Input Nat) (observation : Observation Nat) :
    Decidable (ScanBounds before input observation) := by
  apply decidable_of_iff
    (observation = sourceScan before input ∧ before.since ≤ input.now ∧
      observation.epoch.since ≤ input.now ∧ input.now ≤ maxClock ∧
      expressionAge before input ≤ maxClock ∧ committedAge observation input ≤ maxClock ∧
      (before.initialized = true → expressionAge before input + before.since = input.now) ∧
      ((!before.initialized || SensorStateMachine.result input.reading) = true → committedAge observation input = 0) ∧
      (before.initialized = true → SensorStateMachine.result input.reading = false →
        committedAge observation input = expressionAge before input))
  constructor
  · rintro ⟨a, b, c, d, e, f, g, h, i⟩
    exact ⟨a, b, c, d, e, f, g, h, i⟩
  · intro h
    exact ⟨h.sourceStep, h.beforeEpoch, h.afterEpoch, h.clockRange, h.expressionRange,
      h.committedRange, h.expressionDifference, h.resetZero, h.retainedEqual⟩

def TraceBounds : Epoch Nat → List (Input Nat) → List (Observation Nat) → Prop
  | _, [], [] => True
  | before, input :: rest, observation :: tail =>
    ScanBounds before input observation ∧ TraceBounds observation.epoch rest tail
  | _, _, _ => False

def traceBoundsDecidable (before : Epoch Nat) : (inputs : List (Input Nat)) →
    (observations : List (Observation Nat)) → Decidable (TraceBounds before inputs observations)
  | [], [] => isTrue trivial
  | input :: rest, observation :: tail =>
    letI := traceBoundsDecidable observation.epoch rest tail
    inferInstanceAs (Decidable (ScanBounds before input observation ∧ TraceBounds observation.epoch rest tail))
  | [], _ :: _ => isFalse id
  | _ :: _, [] => isFalse id

attribute [instance] traceBoundsDecidable

theorem source_scan_bounds (before : Epoch Nat) (input : Input Nat)
    (epochBound : before.since ≤ input.now) (clockBound : input.now ≤ maxClock) :
    ScanBounds before input (sourceScan before input) := by
  have afterBound : (sourceScan before input).epoch.since ≤ input.now := by
    simp only [sourceScan, nextSince]
    split <;> omega
  refine ⟨rfl, epochBound, afterBound, clockBound, ?_, ?_, ?_, ?_, ?_⟩
  · unfold expressionAge
    split <;> omega
  · unfold committedAge
    split <;> omega
  · intro initialized
    simpa [expressionAge, initialized] using Nat.sub_add_cancel epochBound
  · intro reset
    simp [committedAge, sourceScan, nextSince, reset]
  · intro initialized retained
    simp [expressionAge, committedAge, sourceScan, nextSince, initialized, retained]

theorem source_history_bounds (before : Epoch Nat) (previous : Nat) (inputs : List (Input Nat))
    (epochBound : before.since ≤ previous) (accepted : AcceptedFrom previous inputs) :
    TraceBounds before inputs (sourceTrace before inputs) := by
  induction inputs generalizing before previous with
  | nil => trivial
  | cons input rest ih =>
    obtain ⟨monotonic, clockBound, acceptedRest⟩ := accepted
    have one := source_scan_bounds before input (Nat.le_trans epochBound monotonic) clockBound
    exact ⟨one, ih (sourceScan before input).epoch input.now one.afterEpoch acceptedRest⟩

theorem first_snapshot_zero (held : Bool) (since : Nat) (input : Input Nat) :
    expressionAge ⟨held, since, false⟩ input = 0 ∧
      committedAge (sourceScan ⟨held, since, false⟩ input) input = 0 := by
  simp [expressionAge, committedAge, sourceScan, nextSince]

theorem changed_snapshot_difference (held : Bool) (since now : Nat) (stale : Bool)
    (elapsed : since < now) :
    expressionAge ⟨held, since, true⟩ ⟨.healthy true, stale, now⟩ = now - since ∧
      0 < expressionAge ⟨held, since, true⟩ ⟨.healthy true, stale, now⟩ ∧
      committedAge (sourceScan ⟨held, since, true⟩ ⟨.healthy true, stale, now⟩)
        ⟨.healthy true, stale, now⟩ = 0 := by
  simp [expressionAge, committedAge, sourceScan, nextSince, SensorStateMachine.result]
  omega

def snapshotViews : Epoch Nat → List (Input Nat) → List (Observation Nat) → Option (List (Nat × Nat))
  | _, [], [] => some []
  | before, input :: rest, observation :: tail => do
    let views ← snapshotViews observation.epoch rest tail
    pure ((expressionAge before input, committedAge observation input) :: views)
  | _, _, _ => none

theorem original_module_bounds (source : SourceReader.SourceBytes) (parsed : EpochSource.ParsedSource)
    (raw : List Nat) (metadata : EpochSource.Metadata)
    (sourceRead : EpochSource.readSource source = some parsed)
    (rawRead : EpochModule.readRaw parsed raw = some (EpochModule.expectedCodes, []))
    (metadataBound : metadata = EpochSource.metadataOf parsed)
    (inputs : List (Input Nat)) (accepted : AcceptedFrom 0 inputs) :
    ∃ observations,
      EpochModule.observeModule naturalNumbers parsed raw metadata inputs = some observations ∧
      EpochModule.sourceObservation naturalNumbers source inputs = some observations ∧
      TraceBounds (EpochModule.initial naturalNumbers parsed) inputs observations := by
  let observations := sourceTrace (EpochModule.initial naturalNumbers parsed) inputs
  have sourceTraceRead : EpochModule.sourceObservation naturalNumbers source inputs = some observations := by
    simp [EpochModule.sourceObservation, sourceRead, observations]
  have refinement := EpochModule.original_observed_trace source parsed raw metadata sourceRead rawRead
    metadataBound naturalNumbers natural_laws inputs
  refine ⟨observations, refinement.trans sourceTraceRead, sourceTraceRead, ?_⟩
  apply source_history_bounds _ 0 inputs _ accepted
  change 0 ≤ 0
  omega

#print axioms source_scan_bounds
#print axioms source_history_bounds
#print axioms first_snapshot_zero
#print axioms changed_snapshot_difference
#print axioms original_module_bounds
end BoolTranslation.ElapsedClockBounds
