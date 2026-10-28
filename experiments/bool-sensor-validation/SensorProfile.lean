import SensorMachine

namespace BoolTranslation.SensorProfile

open ModuleEnvelope ModuleLoader SensorMachine

def ascii (s : String) : List Nat := s.toList.map Char.toNat

structure Profile where
  name : List Nat
  sensor : List Nat
  output : List Nat
  deriving DecidableEq, Repr

def railNames (p : Profile) : List (List Nat) :=
  [ascii "__gf_sensor_value_" ++ p.sensor, ascii "__gf_sensor_ok_" ++ p.sensor,
    ascii "__gf_sensor_fault_" ++ p.sensor]

def inputFields (p : Profile) : List (List Nat × Nat) := (railNames p).zip [1, 1, 2]
def capabilityQuery (p : Profile) : List Nat :=
  [1] ++ string (ascii "actuator") ++ string p.output ++ [1, 2, 1, 0]

def moduleBytes (p : Profile) : List Nat :=
  [71, 70, 66, 49, 3, 0] ++ string p.name ++ u32 1 ++ u16 3 ++
  (inputFields p).flatMap (fun i => string i.1 ++ [i.2]) ++ u16 0 ++ u16 1 ++
  string (ascii "control") ++ u32 0 ++ blob (capabilityQuery p) ++ u16 0 ++
  u16 1 ++ string p.output ++ [1] ++ blob recoverCode ++ u16 0

def valid (p : Profile) : Bool :=
  identifier p.name && identifier p.sensor && identifier p.output &&
    (railNames p).all identifier && decide (p.sensor ≠ p.output)

structure Parsed where
  name : List Nat
  inputs : List (List Nat × Nat)
  output : List Nat
  outputType : Nat
  code : List Nat
  deriving DecidableEq

def readInput : Reader (List Nat × Nat) := do
  let name ← readName
  let type ← readByte
  pure (name, type)

def readHeader : Reader (List Nat × List (List Nat × Nat)) := do
  let magic ← readBytes 6
  require (magic = [71, 70, 66, 49, 3, 0])
  let name ← readName
  let version ← readU32
  let inputs ← readU16
  require (version = 1 ∧ inputs = 3)
  let fields ← readMany readInput 3
  let states ← readU16
  require (states = 0)
  pure (name, fields)

def readStrategy : Reader Unit := do
  let count ← readU16
  let name ← readName
  let priority ← readU32
  let _ ← readBlob
  let transitions ← readU16
  let outputs ← readU16
  require (count = 1 ∧ name = ascii "control" ∧ priority = 0 ∧ transitions = 0 ∧ outputs = 1)

def readRaw : Reader Parsed := do
  let (name, inputs) ← readHeader
  readStrategy
  let output ← readName
  let type ← readByte
  let code ← readBlob
  let constraints ← readU16
  require (constraints = 0)
  pure ⟨name, inputs, output, type, code⟩

structure Loaded where
  profile : Profile
  code : List Nat
  deriving DecidableEq

def profileOf (m : Parsed) : Profile :=
  ⟨m.name, (m.inputs.headD ([], 0)).1.drop (ascii "__gf_sensor_value_").length, m.output⟩

def load (raw : List Nat) : Option Loaded :=
  if raw.length ≤ 1048576 then
    match readRaw raw with
    | some (m, []) =>
      let p := profileOf m
      if valid p && decide (m.inputs = inputFields p ∧ m.outputType = 1 ∧
          m.code = recoverCode ∧ raw = moduleBytes p) then some ⟨p, m.code⟩ else none
    | _ => none
  else none

theorem load_sound (raw : List Nat) (m : Loaded) (h : load raw = some m) :
    valid m.profile = true ∧ m.code = recoverCode ∧ raw = moduleBytes m.profile := by
  unfold load at h
  split at h
  · split at h
    · dsimp only at h
      split at h
      · rename_i accepted
        simp only [Bool.and_eq_true, decide_eq_true_eq] at accepted
        simp only [Option.some.injEq] at h
        subst_vars
        exact ⟨accepted.1, accepted.2.2.2.1, accepted.2.2.2.2⟩
      · contradiction
    · contradiction
  · contradiction

theorem loaded_raw_code (raw : List Nat) (m : Loaded) (h : load raw = some m) :
    ∃ parsed, readRaw raw = some (parsed, []) ∧ parsed.code = m.code := by
  unfold load at h
  split at h
  · split at h
    · rename_i parsed tail
      dsimp only at h
      split at h
      · simp only [Option.some.injEq] at h
        subst_vars
        exact ⟨parsed, tail, rfl⟩
      · contradiction
    · contradiction
  · contradiction

def runModule (ops : NumberOps N) (raw : List Nat) (inputs : List (Value N)) : Option (Bool × List Event) := do
  let m ← load raw
  runAdmitted ops m.code inputs

theorem loaded_recovery (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (raw : List Nat) (m : Loaded) (h : load raw = some m) (r : Reading) (b : Bool) :
    runModule ops raw (rails ops r b) = some (expected r) := by
  simp [runModule, h, (load_sound raw m h).2.1, recovery ops laws r b]

structure SensorMeta where
  name : List Nat
  payloadType : List Nat
  rails : List (List Nat)
  deriving DecidableEq

structure OriginMeta where
  tag : Nat
  node : Nat
  kind : List Nat
  name : List Nat
  deriving DecidableEq

structure SiteMeta where
  site : Nat
  node : Nat
  kind : List Nat
  errorType : List Nat
  origins : List OriginMeta
  deriving DecidableEq

abbrev Metadata := List SensorMeta × List SiteMeta

def expectedMetadata (p : Profile) : Metadata :=
  ([⟨p.sensor, ascii "Bool", railNames p⟩],
    [⟨5, 5, ascii "recover", ascii "SensorFault", [⟨1, 1, ascii "sensor", p.sensor⟩]⟩])

inductive Observation where
  | healthy : Bool → Observation
  | recovered : Fault → Bool → Observation
  deriving DecidableEq, Repr

def observed : Reading → Observation
  | .healthy b => .healthy b
  | .fault fault => .recovered fault false

def faultFromChoice : Nat → Option Fault
  | 1 => some .disconnected
  | 2 => some .stale
  | 3 => some .invalid
  | 4 => some .notReady
  | _ => none

def observe (p : Profile) (metadata : Metadata) (result : Bool × List Event) : Option Observation := do
  if metadata ≠ expectedMetadata p then none else
    match result.2 with
    | [event] =>
      if event.site ≠ 5 then none else
        if event.choice = 0 then
          if event.origin = 0 then some (.healthy result.1) else none
        else if event.origin = 1 then do
          let fault ← faultFromChoice event.choice
          some (.recovered fault result.1)
        else none
    | _ => none

theorem trace_meaning (p : Profile) (metadata : Metadata) (h : metadata = expectedMetadata p) (r : Reading) :
    observe p metadata (expected r) = some (observed r) := by
  rw [h]
  cases r with
  | healthy b => simp [observe, expected, observed]
  | fault f => cases f <;> simp [observe, expected, observed, faultFromChoice, Fault.code]

def observeModule (ops : NumberOps N) (raw : List Nat) (metadata : Metadata) (inputs : List (Value N)) : Option Observation := do
  let m ← load raw
  let result ← runAdmitted ops m.code inputs
  observe m.profile metadata result

theorem loaded_observation (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (raw : List Nat) (m : Loaded) (metadata : Metadata) (loaded : load raw = some m)
    (bound : metadata = expectedMetadata m.profile) (r : Reading) (b : Bool) :
    observeModule ops raw metadata (rails ops r b) = some (observed r) := by
  simp [observeModule, loaded, (load_sound raw m loaded).2.1,
    recovery ops laws r b, trace_meaning m.profile metadata bound r]

#print axioms load_sound
#print axioms loaded_raw_code
#print axioms loaded_recovery
#print axioms trace_meaning
#print axioms loaded_observation

end BoolTranslation.SensorProfile
