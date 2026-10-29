import ComparisonSource
import ComparisonMachine

namespace BoolTranslation.ComparisonModule
open ModuleEnvelope ModuleLoader SensorMachine SensorProfile EpochMachine ElapsedClockBounds

structure Codes where
  epoch : EpochModule.Codes
  comparison : List Nat
  deriving DecidableEq

def expectedCodes : Codes := ⟨EpochModule.expectedCodes, ComparisonMachine.comparisonCode⟩

def capabilityQuery (p : ComparisonSource.ParsedSource) : List Nat :=
  [1] ++ string (ascii "actuator") ++ string p.epoch.stateSource.profile.output ++ [1] ++
  [1] ++ string (ascii "actuator") ++ string p.comparison ++ [1,2,2,0]

def readStrategy (p : ComparisonSource.ParsedSource) : Reader Unit := do
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

def readRaw (p : ComparisonSource.ParsedSource) : Reader Codes := do
  EpochModule.readHeader p.epoch
  EpochModule.readStates p.epoch
  readStrategy p
  let held ← EpochModule.readTransition 0
  let since ← EpochModule.readTransition 1
  let initialized ← EpochModule.readTransition 2
  let count ← readU16
  require (count = 2)
  let output ← readNamedOutput p.epoch.stateSource.profile.output 1
  let comparison ← readNamedOutput p.comparison 1
  let constraints ← readU16
  require (constraints = 0)
  pure ⟨⟨held, since, initialized, output⟩, comparison⟩

def moduleTrace (p : ComparisonSource.ParsedSource) (raw : List Nat) (inputs : List (Input Nat)) :
    Option (List ComparisonMachine.Observation) := do
  let (codes, tail) ← readRaw p raw
  if tail ≠ [] then none else do
    let initial := EpochModule.initial naturalNumbers p.epoch
    let epochs ← rawTrace naturalNumbers codes.epoch.held codes.epoch.since codes.epoch.initialized
      codes.epoch.output initial inputs
    ComparisonMachine.observeTrace codes.comparison initial inputs epochs

def sourceObservation (source : SourceReader.SourceBytes) (inputs : List (Input Nat)) :
    Option (List ComparisonMachine.Observation) := do
  let p ← ComparisonSource.readSource source
  let initial := EpochModule.initial naturalNumbers p.epoch
  ComparisonMachine.expectedTrace initial inputs (sourceTrace initial inputs)

def observeModule (p : ComparisonSource.ParsedSource) (raw : List Nat) (metadata : ComparisonSource.Metadata)
    (inputs : List (Input Nat)) : Option (List ComparisonMachine.Observation) :=
  if metadata = ComparisonSource.metadataOf p then moduleTrace p raw inputs else none

theorem original_comparison_trace (source : SourceReader.SourceBytes) (p : ComparisonSource.ParsedSource)
    (raw : List Nat) (metadata : ComparisonSource.Metadata)
    (sourceRead : ComparisonSource.readSource source = some p)
    (rawRead : readRaw p raw = some (expectedCodes, []))
    (metadataBound : metadata = ComparisonSource.metadataOf p)
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
  obtain ⟨observations, observed⟩ := ComparisonMachine.source_trace_has_output initial inputs
  have bounds : TraceBounds initial inputs epochs := by
    apply source_history_bounds _ 0 inputs _ accepted
    change 0 ≤ 0
    omega
  refine ⟨epochs, observations, epochRun, bounds, ?_, ?_⟩
  · simp [observeModule, metadataBound, moduleTrace, rawRead, expectedCodes, EpochModule.expectedCodes,
      epochRun, ComparisonMachine.output_trace, initial, observed]
  · simp [sourceObservation, sourceRead, initial, observed]

#print axioms original_comparison_trace
end BoolTranslation.ComparisonModule
