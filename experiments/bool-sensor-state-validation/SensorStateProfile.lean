import SensorStateMachine
import SensorProfile

namespace BoolTranslation.SensorStateProfile

open ModuleEnvelope ModuleLoader SensorMachine SensorStateMachine

structure Profile where
  name : List Nat
  sensor : List Nat
  state : List Nat
  initial : Bool
  output : List Nat
  deriving DecidableEq, Repr

def sensorProfile (p : Profile) : SensorProfile.Profile := ⟨p.name, p.sensor, p.output⟩
def valid (p : Profile) : Bool :=
  SensorProfile.valid (sensorProfile p) && identifier p.state &&
  decide ([p.sensor, p.state, p.output].Nodup)

def moduleBytes (p : Profile) : List Nat :=
  [71, 70, 66, 49, 3, 0] ++ string p.name ++ u32 1 ++ u16 3 ++
  (SensorProfile.inputFields (sensorProfile p)).flatMap (fun i => string i.1 ++ [i.2]) ++
  u16 1 ++ string p.state ++ [1, if p.initial then 1 else 0] ++
  u16 1 ++ string (SensorProfile.ascii "control") ++ u32 0 ++
  blob (SensorProfile.capabilityQuery (sensorProfile p)) ++ u16 1 ++ u16 0 ++
  blob transitionCode ++ u16 1 ++ string p.output ++ [1] ++ blob outputCode ++ u16 0

structure Parsed where
  name : List Nat
  inputs : List (List Nat × Nat)
  state : List Nat
  initial : Bool
  output : List Nat
  transition : List Nat
  outputCode : List Nat
  deriving DecidableEq

def readHeader : Reader (List Nat × List (List Nat × Nat)) := do
  let magic ← readBytes 6
  require (magic = [71, 70, 66, 49, 3, 0])
  let name ← readName
  let version ← readU32
  let inputs ← readU16
  require (version = 1 ∧ inputs = 3)
  let fields ← readMany SensorProfile.readInput 3
  pure (name, fields)

def readState : Reader (List Nat × Bool) := do
  let states ← readU16
  require (states = 1)
  let state ← readName
  let stateType ← readByte
  let initial ← readByte
  require (stateType = 1 ∧ initial ≤ 1)
  pure (state, initial = 1)

def readStrategy : Reader (List Nat) := do
  let strategies ← readU16
  let strategy ← readName
  let priority ← readU32
  let _ ← readBlob
  let transitions ← readU16
  let target ← readU16
  require (strategies = 1 ∧ strategy = SensorProfile.ascii "control" ∧ priority = 0 ∧
    transitions = 1 ∧ target = 0)
  readBlob

def readRaw : Reader Parsed := do
  let (name, fields) ← readHeader
  let (state, initial) ← readState
  let transition ← readStrategy
  let outputs ← readU16
  require (outputs = 1)
  let output ← readName
  let outputType ← readByte
  require (outputType = 1)
  let outputCode ← readBlob
  let constraints ← readU16
  require (constraints = 0)
  pure ⟨name, fields, state, initial, output, transition, outputCode⟩

structure Loaded where
  profile : Profile
  transition : List Nat
  output : List Nat
  deriving DecidableEq

def profileOf (m : Parsed) : Profile :=
  ⟨m.name, (m.inputs.headD ([], 0)).1.drop (SensorProfile.ascii "__gf_sensor_value_").length,
    m.state, m.initial, m.output⟩

def load (raw : List Nat) : Option Loaded :=
  if raw.length ≤ 1048576 then
    match readRaw raw with
    | some (m, []) =>
      let p := profileOf m
      if valid p && decide (m.inputs = SensorProfile.inputFields (sensorProfile p) ∧
          m.transition = transitionCode ∧ m.outputCode = outputCode ∧ raw = moduleBytes p) then
        some ⟨p, m.transition, m.outputCode⟩ else none
    | _ => none
  else none

theorem load_sound (raw : List Nat) (m : Loaded) (h : load raw = some m) :
    valid m.profile = true ∧ m.transition = transitionCode ∧ m.output = outputCode ∧
    raw = moduleBytes m.profile := by
  unfold load at h
  split at h
  · split at h
    · dsimp only at h
      split at h
      · rename_i accepted
        simp only [Bool.and_eq_true, decide_eq_true_eq] at accepted
        simp only [Option.some.injEq] at h
        subst_vars
        exact ⟨accepted.1, accepted.2.2.1, accepted.2.2.2.1, accepted.2.2.2.2⟩
      · contradiction
    · contradiction
  · contradiction

theorem loaded_raw_code (raw : List Nat) (m : Loaded) (h : load raw = some m) :
    ∃ parsed, readRaw raw = some (parsed, []) ∧
      parsed.transition = m.transition ∧ parsed.outputCode = m.output := by
  unfold load at h
  split at h
  · split at h
    · rename_i parsed tail
      dsimp only at h
      split at h
      · simp only [Option.some.injEq] at h
        subst_vars
        exact ⟨parsed, tail, rfl, rfl⟩
      · contradiction
    · contradiction
  · contradiction

def expectedMetadata (p : Profile) : SensorProfile.Metadata :=
  ([⟨p.sensor, SensorProfile.ascii "Bool", SensorProfile.railNames (sensorProfile p)⟩],
    [⟨7, 7, SensorProfile.ascii "recover", SensorProfile.ascii "SensorFault",
      [⟨1, 1, SensorProfile.ascii "sensor", p.sensor⟩]⟩])

#print axioms load_sound
#print axioms loaded_raw_code
end BoolTranslation.SensorStateProfile
