import SensorStateRecovery

namespace BoolTranslation.SensorStateMachine
open ModuleEnvelope SensorMachine
set_option maxRecDepth 8192
set_option maxHeartbeats 8000000

def execute (ops : NumberOps N) (raw : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (traceBound : Nat) : Nat → State N → Option (Bool × List Event)
  | 0, _ => none
  | fuel + 1, s =>
    if s.pc = raw.length then
      match s.stack with
      | [.bool value] => some (value, s.trace)
      | _ => none
    else do
      let next ← step ops raw inputs before candidate traceBound s
      if next.stack.length ≤ 128 then execute ops raw inputs before candidate traceBound fuel next else none

theorem steps_execute (ops : NumberOps N) (raw : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (traceBound count : Nat) (s final : State N)
    (h : steps ops raw inputs before candidate traceBound count s = some final)
    (fuel : Nat) (room : count < fuel) (done : final.pc = raw.length)
    (stack : final.stack = [.bool value]) :
    execute ops raw inputs before candidate traceBound fuel s = some (value, final.trace) := by
  induction count generalizing s fuel with
  | zero =>
    simp only [steps, Option.some.injEq] at h
    subst s
    cases fuel with
    | zero => omega
    | succ fuel => simp [execute, done, stack]
  | succ count ih =>
    simp only [steps] at h
    obtain ⟨next, one, h⟩ := Option.bind_eq_some.mp h
    split at h
    · rename_i space
      have running : s.pc ≠ raw.length := by
        intro equal
        simp [step, equal, List.getElem?_eq_none (Nat.le_refl raw.length)] at one
      cases fuel with
      | zero => omega
      | succ fuel =>
        simpa [execute, running, one, space] using ih next h fuel (by omega)
    · contradiction

theorem steps_append (ops : NumberOps N) (raw : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (traceBound left right : Nat) (s : State N) :
    steps ops raw inputs before candidate traceBound (left + right) s =
      (steps ops raw inputs before candidate traceBound left s).bind
        (steps ops raw inputs before candidate traceBound right) := by
  induction left generalizing s with
  | zero => simp [steps]
  | succ left ih =>
    rw [Nat.succ_add, steps, steps]
    cases one : step ops raw inputs before candidate traceBound s with
    | none => simp [one]
    | some next =>
      by_cases room : next.stack.length ≤ 128
      · simpa [Bind.bind, Option.bind, room] using ih next
      · simp [Bind.bind, Option.bind, room]

def toggled (old : Bool) (r : Reading) : Bool := if result r then !old else old

theorem toggle_suffix (ops : NumberOps N) (r : Reading) (stale old : Bool) :
    steps ops transitionCode (rails ops r stale) [.bool old] none 1
      (if result r then 4 else 2) ⟨45, [.bool (result r)], [event r]⟩ =
      some ⟨58, [.bool (toggled old r)], [event r]⟩ := by
  cases r with
  | healthy b => cases b <;> cases old <;> rfl
  | fault f => cases old <;> rfl

def runExpression (ops : NumberOps N) (code : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (trace : List Event) : Option (Bool × List Event) :=
  execute ops code inputs before candidate 1 (code.length + 1) ⟨0, [], trace⟩

theorem transition_execution (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (r : Reading) (stale old : Bool) :
    runExpression ops transitionCode (rails ops r stale) [.bool old] none [] =
      some (toggled old r, [event r]) := by
  have recover := recovery_context ops laws r stale [] [.bool old] none [] 1 (by simp) (by simp)
  have suffix := toggle_suffix ops r stale old
  have path : steps ops transitionCode (rails ops r stale) [.bool old] none 1
      ((recoverySteps r) + (if result r then 4 else 2))
      ⟨0, [], []⟩ = some ⟨58, [.bool (toggled old r)], [event r]⟩ := by
    rw [steps_append, recover]
    exact suffix
  apply steps_execute ops transitionCode (rails ops r stale) [.bool old] none 1 _ _ _ path
  · cases r with
    | healthy b => cases b <;> (dsimp [recoverySteps, result]; decide)
    | fault f => dsimp [recoverySteps, result]; decide
  · rfl
  · rfl

theorem output_execution (ops : NumberOps N) (inputs : List (Value N)) (old candidate : Bool)
    (trace : List Event) :
    runExpression ops outputCode inputs [.bool old] (some [.bool candidate]) trace =
      some (candidate, trace) := by rfl

structure ScanInput where
  reading : Reading
  stalePayload : Bool
  deriving DecidableEq, Repr

structure ScanObservation where
  state : Bool
  output : Bool
  events : List Event
  deriving DecidableEq, Repr

def sourceScan (old : Bool) (input : ScanInput) : ScanObservation :=
  let next := toggled old input.reading
  ⟨next, next, [event input.reading]⟩

def rawScan (ops : NumberOps N) (transition output : List Nat) (old : Bool)
    (input : ScanInput) : Option ScanObservation := do
  let inputs := rails ops input.reading input.stalePayload
  let (candidate, trace) ← runExpression ops transition inputs [.bool old] none []
  let (requested, events) ← runExpression ops output inputs [.bool old] (some [.bool candidate]) trace
  pure ⟨candidate, requested, events⟩

theorem scan_refinement (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (old : Bool) (input : ScanInput) :
    rawScan ops transitionCode outputCode old input = some (sourceScan old input) := by
  simp [rawScan, transition_execution ops laws, output_execution, sourceScan]

def sourceTrace : Bool → List ScanInput → List ScanObservation
  | _, [] => []
  | old, input :: rest =>
    let observation := sourceScan old input
    observation :: sourceTrace observation.state rest

def rawTrace (ops : NumberOps N) (transition output : List Nat) :
    Bool → List ScanInput → Option (List ScanObservation)
  | _, [] => some []
  | old, input :: rest => do
    let observation ← rawScan ops transition output old input
    let tail ← rawTrace ops transition output observation.state rest
    pure (observation :: tail)

theorem input_trace (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (initial : Bool) (inputs : List ScanInput) :
    rawTrace ops transitionCode outputCode initial inputs = some (sourceTrace initial inputs) := by
  induction inputs generalizing initial with
  | nil => rfl
  | cons input rest ih => simp [rawTrace, sourceTrace, scan_refinement ops laws, ih]

#print axioms recovery_context
#print axioms transition_execution
#print axioms output_execution
#print axioms input_trace
end BoolTranslation.SensorStateMachine
