import ModuleEnvelope

namespace BoolTranslation.ModuleLoader

open ModuleEnvelope

deriving instance DecidableEq for Expr
deriving instance DecidableEq for Module

abbrev Reader (α : Type) := StateT (List Nat) Option α

def require (condition : Prop) [Decidable condition] : Reader Unit := fun raw =>
  if condition then some ((), raw) else none

def readBytes (n : Nat) : Reader (List Nat) := fun raw =>
  if n ≤ raw.length then some (raw.take n, raw.drop n) else none

def readByte : Reader Nat
  | b :: rest => if b < 256 then some (b, rest) else none
  | [] => none

def readU16 : Reader Nat := do
  let lo ← readByte
  let hi ← readByte
  pure (lo + 256 * hi)

def readU32 : Reader Nat := do
  let lo ← readU16
  let hi ← readU16
  pure (lo + 65536 * hi)

def readName : Reader (List Nat) := do
  let n ← readU16
  require (n ≤ 128)
  let name ← readBytes n
  require (identifier name = true)
  pure name

def readBlob : Reader (List Nat) := do
  let n ← readU32
  require (n ≤ 4096)
  readBytes n

def readMany (read : Reader α) : Nat → Reader (List α)
  | 0 => pure []
  | n + 1 => do
    let value ← read
    let values ← readMany read n
    pure (value :: values)

def readState : Reader (List Nat × Bool) := do
  let name ← readName
  let type ← readByte
  let value ← readByte
  require (type = 1 ∧ value ≤ 1)
  pure (name, value = 1)

def readExpression (p : Bool) : Reader (Expr p) := do
  let bytes ← readBlob
  fun rest => (Serialization.decode p bytes).map (fun expression => (expression, rest))

def readTransition : Reader (Expr false) := do
  let _ ← readU16
  readExpression false

def readOutput : Reader (List Nat × Expr true) := do
  let name ← readName
  let type ← readByte
  require (type = 1)
  let expression ← readExpression true
  pure (name, expression)

def readHeader : Reader (List Nat × Nat) := do
  let magic ← readBytes 4
  require (magic = [71, 70, 66, 49])
  let format ← readU16
  require (format = 1 ∨ format = 3)
  let name ← readName
  let version ← readU32
  let inputs ← readU16
  let count ← readU16
  require (version = 1 ∧ inputs = 0 ∧ count ≤ 128)
  pure (name, count)

def readStrategy (states : Nat) : Reader Unit := do
  let strategies ← readU16
  let strategy ← readName
  let priority ← readU32
  let _ ← readBlob
  let count ← readU16
  require (strategies = 1 ∧ strategy = [99, 111, 110, 116, 114, 111, 108] ∧
    priority = 0 ∧ count = states)

def readOutputs : Reader (List (List Nat × Expr true)) := do
  let count ← readU16
  require (count ≤ 128)
  let outputs ← readMany readOutput count
  let constraints ← readU16
  require (constraints = 0)
  pure outputs

def readModule : Reader Module := do
  let (name, count) ← readHeader
  let states ← readMany readState count
  readStrategy count
  let transitions ← readMany readTransition count
  let outputs ← readOutputs
  pure ⟨name, states, transitions, outputs⟩

def load (raw : List Nat) : Option Module :=
  if raw.length ≤ 1048576 then
    match readModule raw with
    | some (m, []) => if encodeModule m = .ok raw then some m else none
    | _ => none
  else none

theorem load_sound (raw : List Nat) (m : Module) (h : load raw = some m) :
    encodeModule m = .ok raw := by
  unfold load at h
  split at h
  · split at h
    · split at h
      · rename_i accepted
        simp only [Option.some.injEq] at h
        subst_vars
        exact accepted
      · contradiction
    · contradiction
  · contradiction

theorem load_consumed (raw : List Nat) (m : Module) (h : load raw = some m) :
    readModule raw = some (m, []) := by
  unfold load at h
  split at h
  · split at h
    · rename_i parsed
      split at h
      · simp only [Option.some.injEq] at h
        subst_vars
        exact parsed
      · contradiction
    · contradiction
  · contradiction

theorem load_of_read (raw : List Nat) (m : Module)
    (parsed : readModule raw = some (m, [])) (encoded : encodeModule m = .ok raw) :
    load raw = some m := by
  simp [load, parsed, encoded, (ModuleEnvelope.encoded m raw encoded).2.2]

def tick (raw : List Nat) (env : Env) : Option (List Bool × List Bool) := do
  let m ← load raw
  rawTick m raw env

theorem loaded_tick (raw : List Nat) (m : Module) (h : load raw = some m) (env : Env) :
    tick raw env = some (sourceTick m.transitions (targets m) (m.outputs.map Prod.snd) env) := by
  simp only [tick, h, Option.bind_some]
  exact module_tick m raw (load_sound raw m h) env

def initial (m : Module) : List Bool := m.states.map Prod.snd

def environment (state : List Bool) : Env :=
  ⟨fun _ => false, fun i => state[i]?.getD false, fun _ => false⟩

abbrev Observation := List Bool × List Bool

def sourceTrace (m : Module) : Nat → List Bool → List Observation
  | 0, _ => []
  | n + 1, state =>
      let observation := sourceTick m.transitions (targets m) (m.outputs.map Prod.snd) (environment state)
      observation :: sourceTrace m n observation.1

def byteTrace (m : Module) (raw : List Nat) : Nat → List Bool → Option (List Observation)
  | 0, _ => some []
  | n + 1, state => do
      let observation ← rawTick m raw (environment state)
      let rest ← byteTrace m raw n observation.1
      pure (observation :: rest)

theorem trace_refinement (raw : List Nat) (m : Module) (h : load raw = some m)
    (n : Nat) (state : List Bool) :
    byteTrace m raw n state = some (sourceTrace m n state) := by
  induction n generalizing state with
  | zero => rfl
  | succ n ih =>
    simp only [byteTrace, sourceTrace, module_tick m raw (load_sound raw m h),
      Option.bind_some, ih]
    rfl

def initialState (raw : List Nat) : Option (List Bool) := (load raw).map initial

def trace (raw : List Nat) (n : Nat) : Option (List Observation) := do
  let m ← load raw
  byteTrace m raw n (initial m)

theorem loaded_initial (raw : List Nat) (m : Module) (h : load raw = some m) :
    initialState raw = some (m.states.map Prod.snd) := by simp [initialState, h, initial]

theorem initialized_trace (raw : List Nat) (m : Module) (h : load raw = some m) (n : Nat) :
    trace raw n = some (sourceTrace m n (m.states.map Prod.snd)) := by
  simp only [trace, h, Option.bind_some]
  exact trace_refinement raw m h n (initial m)

#print axioms load_sound
#print axioms load_consumed
#print axioms loaded_tick
#print axioms loaded_initial
#print axioms trace_refinement
#print axioms initialized_trace

end BoolTranslation.ModuleLoader
