import SensorMachine

namespace BoolTranslation.SensorStateMachine

open ModuleEnvelope SensorMachine
set_option maxRecDepth 8192
set_option maxHeartbeats 8000000

def step (ops : NumberOps N) (raw : List Nat) (inputs : List (Value N)) (before : List (Value N)) (candidate : Option (List (Value N))) (traceBound : Nat) (s : State N) : Option (State N) := do
  let op ← raw[s.pc]?
  match op with
  | 1 =>
    let b ← raw[s.pc + 1]?
    if b ≤ 1 then some { s with pc := s.pc + 2, stack := .bool (b = 1) :: s.stack } else none
  | 3 =>
    let i ← wordAt raw (s.pc + 1)
    let value ← inputs[i]?
    some { s with pc := s.pc + 3, stack := value :: s.stack }
  | 4 =>
    let i ← wordAt raw (s.pc + 1)
    let value ← before[i]?
    some { s with pc := s.pc + 3, stack := value :: s.stack }
  | 5 =>
    let i ← wordAt raw (s.pc + 1)
    let next ← candidate
    let value ← next[i]?
    some { s with pc := s.pc + 3, stack := value :: s.stack }
  | 10 =>
    match s.stack with
    | .bool value :: rest => some { s with pc := s.pc + 1, stack := .bool (!value) :: rest }
    | _ => none
  | 19 =>
    match s.stack with
    | .number right :: .number left :: rest =>
      let value ← ops.add left right
      some { s with pc := s.pc + 1, stack := .number value :: rest }
    | _ => none
  | 30 | 31 =>
    let offset ← wordAt raw (s.pc + 1)
    let next := s.pc + 3
    if next + offset ≤ raw.length then
      if op = 31 then some { s with pc := next + offset }
      else match s.stack with
        | .bool condition :: rest =>
          some { s with pc := if condition then next else next + offset, stack := rest }
        | _ => none
    else none
  | 56 =>
    let site ← dwordAt raw (s.pc + 1)
    match s.stack with
    | .number origin :: .number choice :: value :: rest =>
      let origin ← ops.integer origin
      let choice ← ops.integer choice
      if 0 < site ∧ origin ≤ 4294967295 ∧ choice ≤ 65535 ∧ s.trace.length < traceBound then
        some { pc := s.pc + 5, stack := value :: rest, trace := s.trace ++ [⟨site, choice, origin⟩] }
      else none
    | _ => none
  | op =>
    if 32 ≤ op ∧ op ≤ 47 then
      some { s with pc := s.pc + 1, stack := .number (ops.literal (op - 32)) :: s.stack }
    else none


def recoverCode : List Nat :=
  branch [3, 1, 0] [3, 0, 0] [1, 0] ++
  branch [3, 1, 0] [32] [3, 2, 0, 33, 19] ++
  branch [3, 1, 0] [32] [33] ++ [56] ++ u32 7

def toggleSuffix : List Nat := [30, 7, 0, 4, 0, 0, 10, 31, 3, 0, 4, 0, 0]
def transitionCode : List Nat := recoverCode ++ toggleSuffix
def outputCode : List Nat := [5, 0, 0]

def result : Reading → Bool
  | .healthy b => b
  | .fault _ => false

def event : Reading → Event
  | .healthy _ => ⟨7, 0, 0⟩
  | .fault f => ⟨7, f.code + 1, 1⟩

def steps (ops : NumberOps N) (raw : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (traceBound : Nat) : Nat → State N → Option (State N)
  | 0, s => some s
  | count + 1, s => do
    let next ← step ops raw inputs before candidate traceBound s
    if next.stack.length ≤ 128 then steps ops raw inputs before candidate traceBound count next else none

def recoverySteps : Reading → Nat
  | .healthy _ => 13
  | .fault _ => 12

theorem recovery_context (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (r : Reading) (stale : Bool) (tail before : List (Value N))
    (candidate : Option (List (Value N))) (trace : List Event) (traceBound : Nat)
    (stackRoom : tail.length + 3 ≤ 128) (traceRoom : trace.length < traceBound) :
    steps ops transitionCode (rails ops r stale) before candidate traceBound
      (recoverySteps r) ⟨0, tail, trace⟩ =
      some ⟨45, .bool (result r) :: tail, trace ++ [event r]⟩ := by
  cases r with
  | healthy b =>
    simp [recoverySteps, steps, step, transitionCode, recoverCode, toggleSuffix, branch, u16, u32,
      wordAt, dwordAt, rails, result, event, laws.integer_literal 0 (by decide), traceRoom,
      show tail.length + 1 ≤ 128 by omega, show tail.length + 2 ≤ 128 by omega, show tail.length ≤ 128 by omega, stackRoom]
  | fault f =>
    have bound := fault_bound f
    have small : f.code + 1 ≤ 4 := by omega
    simp [recoverySteps, steps, step, transitionCode, recoverCode, toggleSuffix, branch, u16, u32,
      wordAt, dwordAt, rails, result, event,
      laws.add_one f.code bound, laws.integer_literal 1 (by decide),
      laws.integer_literal (f.code + 1) small, traceRoom,
      show f.code + 1 ≤ 65535 by omega,
      show tail.length + 1 ≤ 128 by omega, show tail.length + 2 ≤ 128 by omega, show tail.length ≤ 128 by omega, stackRoom]


#print axioms recovery_context
end BoolTranslation.SensorStateMachine
