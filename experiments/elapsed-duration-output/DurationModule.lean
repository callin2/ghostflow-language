import DurationSource
import DurationMachine

namespace BoolTranslation.DurationModule
open ModuleEnvelope ModuleLoader SensorMachine SensorProfile EpochMachine ElapsedClockBounds

structure Codes where
  epoch : EpochModule.Codes
  duration : List Nat
  deriving DecidableEq

def expectedCodes : Codes := ⟨EpochModule.expectedCodes, DurationMachine.durationCode⟩

def capabilityQuery (p : DurationSource.ParsedSource) : List Nat :=
  [1] ++ string (ascii "actuator") ++ string p.epoch.stateSource.profile.output ++ [1] ++
  [1] ++ string (ascii "actuator") ++ string p.duration ++ [2,2,2,0]

def readStrategy (p : DurationSource.ParsedSource) : Reader Unit := do
  let count ← readU16
  let name ← readName
  let priority ← readU32
  let capabilities ← readBlob
  let transitions ← readU16
  require (count = 1 ∧ name = ascii "control" ∧ priority = 0 ∧ capabilities = capabilityQuery p ∧ transitions = 3)

def readNamedOutput (name : List Nat) (type : Nat) : Reader (List Nat) := do
  let actualName ← readName
  let actualType ← readByte
  require (actualName = name ∧ actualType = type)
  readBlob

def readRaw (p : DurationSource.ParsedSource) : Reader Codes := do
  EpochModule.readHeader p.epoch
  EpochModule.readStates p.epoch
  readStrategy p
  let held ← EpochModule.readTransition 0
  let since ← EpochModule.readTransition 1
  let initialized ← EpochModule.readTransition 2
  let count ← readU16
  require (count = 2)
  let output ← readNamedOutput p.epoch.stateSource.profile.output 1
  let duration ← readNamedOutput p.duration 2
  let constraints ← readU16
  require (constraints = 0)
  pure ⟨⟨held, since, initialized, output⟩, duration⟩

def moduleTrace (p : DurationSource.ParsedSource) (raw : List Nat) (inputs : List (Input Nat)) :
    Option (List DurationMachine.Observation) := do
  let (codes, tail) ← readRaw p raw
  if tail ≠ [] then none else do
    let initial := EpochModule.initial naturalNumbers p.epoch
    let epochs ← rawTrace naturalNumbers codes.epoch.held codes.epoch.since codes.epoch.initialized
      codes.epoch.output initial inputs
    DurationMachine.observeTrace codes.duration initial inputs epochs

def sourceObservation (source : SourceReader.SourceBytes) (inputs : List (Input Nat)) :
    Option (List DurationMachine.Observation) := do
  let p ← DurationSource.readSource source
  let initial := EpochModule.initial naturalNumbers p.epoch
  DurationMachine.expectedTrace initial inputs (sourceTrace initial inputs)

def observeModule (p : DurationSource.ParsedSource) (raw : List Nat) (metadata : DurationSource.Metadata)
    (inputs : List (Input Nat)) : Option (List DurationMachine.Observation) :=
  if metadata = DurationSource.metadataOf p then moduleTrace p raw inputs else none

theorem original_duration_trace (source : SourceReader.SourceBytes) (p : DurationSource.ParsedSource)
    (raw : List Nat) (metadata : DurationSource.Metadata)
    (sourceRead : DurationSource.readSource source = some p)
    (rawRead : readRaw p raw = some (expectedCodes, []))
    (metadataBound : metadata = DurationSource.metadataOf p)
    (inputs : List (Input Nat)) (accepted : AcceptedFrom 0 inputs) :
    ∃ epochs observations,
      rawTrace naturalNumbers SensorStateMachine.transitionCode sinceCode initializedCode SensorStateMachine.outputCode
        (EpochModule.initial naturalNumbers p.epoch) inputs = some epochs ∧
      TraceBounds (EpochModule.initial naturalNumbers p.epoch) inputs epochs ∧
      observeModule p raw metadata inputs = some observations ∧
      sourceObservation source inputs = some observations := by
  let initial := EpochModule.initial naturalNumbers p.epoch
  let epochs := sourceTrace initial inputs
  have epochRun := all_histories naturalNumbers natural_laws initial inputs
  obtain ⟨observations, observed⟩ := DurationMachine.source_trace_has_output initial inputs
  have bounds : TraceBounds initial inputs epochs := by
    apply source_history_bounds _ 0 inputs _ accepted
    change 0 ≤ 0
    omega
  refine ⟨epochs, observations, epochRun, bounds, ?_, ?_⟩
  · simp [observeModule, metadataBound, moduleTrace, rawRead, expectedCodes, EpochModule.expectedCodes,
      epochRun, DurationMachine.output_trace, initial, observed]
  · simp [sourceObservation, sourceRead, initial, observed]

#print axioms original_duration_trace
end BoolTranslation.DurationModule
