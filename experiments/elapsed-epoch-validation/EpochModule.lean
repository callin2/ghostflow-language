import EpochSource
import EpochMachine

namespace BoolTranslation.EpochModule
open ModuleEnvelope ModuleLoader SensorProfile SensorMachine EpochSource EpochMachine

structure Codes where
  held : List Nat
  since : List Nat
  initialized : List Nat
  output : List Nat
  deriving DecidableEq

def expectedCodes : Codes :=
  ⟨SensorStateMachine.transitionCode, sinceCode, initializedCode, SensorStateMachine.outputCode⟩

def readHeader (p : EpochSource.ParsedSource) : Reader Unit := do
  let magic ← readBytes 6
  let name ← readName
  let version ← readU32
  let inputCount ← readU16
  let inputs ← readMany SensorProfile.readInput 4
  require (magic = [71, 70, 66, 49, 3, 0] ∧ name = p.stateSource.profile.name ∧ version = 1 ∧
    inputCount = 4 ∧ inputs = SensorProfile.inputFields (SensorStateProfile.sensorProfile p.stateSource.profile) ++
      [(ascii "__gf_now_ms", 2)])

def readBoolState (expected : List Nat) (value : Bool) : Reader Unit := do
  let name ← readName
  let type ← readByte
  let initial ← readByte
  require (name = expected ∧ type = 1 ∧ initial = (if value then 1 else 0))

def readNumberZeroState (expected : List Nat) : Reader Unit := do
  let name ← readName
  let type ← readByte
  let zero ← readBytes 8
  require (name = expected ∧ type = 2 ∧ zero = List.replicate 8 0)

def readStates (p : EpochSource.ParsedSource) : Reader Unit := do
  let count ← readU16
  require (count = 3)
  readBoolState p.stateSource.profile.state p.stateSource.profile.initial
  readNumberZeroState (sinceName p)
  readBoolState (initializedName p) false

def readStrategy (p : EpochSource.ParsedSource) : Reader Unit := do
  let count ← readU16
  let name ← readName
  let priority ← readU32
  let capabilities ← readBlob
  let transitions ← readU16
  require (count = 1 ∧ name = ascii "control" ∧ priority = 0 ∧ transitions = 3 ∧
    capabilities = SensorProfile.capabilityQuery (SensorStateProfile.sensorProfile p.stateSource.profile))

def readTransition (target : Nat) : Reader (List Nat) := do
  let actual ← readU16
  require (actual = target)
  readBlob

def readOutput (p : EpochSource.ParsedSource) : Reader (List Nat) := do
  let count ← readU16
  let name ← readName
  let type ← readByte
  require (count = 1 ∧ name = p.stateSource.profile.output ∧ type = 1)
  readBlob

def readRaw (p : EpochSource.ParsedSource) : Reader Codes := do
  readHeader p
  readStates p
  readStrategy p
  let held ← readTransition 0
  let since ← readTransition 1
  let initialized ← readTransition 2
  let output ← readOutput p
  let constraints ← readU16
  require (constraints = 0)
  pure ⟨held, since, initialized, output⟩

def initial (ops : NumberOps N) (p : EpochSource.ParsedSource) : Epoch N :=
  ⟨p.stateSource.profile.initial, ops.literal 0, false⟩

def moduleTrace (ops : NumberOps N) (p : EpochSource.ParsedSource) (raw : List Nat)
    (inputs : List (Input N)) : Option (List (Observation N)) := do
  let (codes, tail) ← readRaw p raw
  if tail ≠ [] then none else
    rawTrace ops codes.held codes.since codes.initialized codes.output (initial ops p) inputs

def sourceObservation (ops : NumberOps N) (raw : SourceReader.SourceBytes)
    (inputs : List (Input N)) : Option (List (Observation N)) := do
  let parsed ← EpochSource.readSource raw
  pure (sourceTrace (initial ops parsed) inputs)

def observeModule (ops : NumberOps N) (p : EpochSource.ParsedSource) (raw : List Nat)
    (metadata : EpochSource.Metadata) (inputs : List (Input N)) : Option (List (Observation N)) :=
  if metadata = EpochSource.metadataOf p then moduleTrace ops p raw inputs else none

theorem original_source_trace (source : SourceReader.SourceBytes) (p : EpochSource.ParsedSource)
    (raw : List Nat) (sourceRead : EpochSource.readSource source = some p)
    (rawRead : readRaw p raw = some (expectedCodes, []))
    (ops : NumberOps N) (laws : SmallNumberLaws ops) (inputs : List (Input N)) :
    moduleTrace ops p raw inputs = sourceObservation ops source inputs := by
  simp [moduleTrace, sourceObservation, sourceRead, rawRead, expectedCodes, all_histories ops laws]

theorem original_observed_trace (source : SourceReader.SourceBytes) (p : EpochSource.ParsedSource)
    (raw : List Nat) (metadata : EpochSource.Metadata) (sourceRead : EpochSource.readSource source = some p)
    (rawRead : readRaw p raw = some (expectedCodes, [])) (bound : metadata = EpochSource.metadataOf p)
    (ops : NumberOps N) (laws : SmallNumberLaws ops) (inputs : List (Input N)) :
    observeModule ops p raw metadata inputs = sourceObservation ops source inputs := by
  simp [observeModule, bound, original_source_trace source p raw sourceRead rawRead ops laws inputs]

#print axioms original_source_trace
end BoolTranslation.EpochModule
