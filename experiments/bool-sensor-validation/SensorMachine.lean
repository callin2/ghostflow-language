import ModuleLoader

namespace BoolTranslation.SensorMachine

set_option maxRecDepth 8192
set_option maxHeartbeats 4000000

open ModuleEnvelope

structure NumberOps (N : Type) where
  literal : Nat → N
  add : N → N → Option N
  integer : N → Option Nat

structure SmallNumberLaws (ops : NumberOps N) : Prop where
  integer_literal : ∀ n, n ≤ 4 → ops.integer (ops.literal n) = some n
  add_one : ∀ n, n < 4 → ops.add (ops.literal n) (ops.literal 1) = some (ops.literal (n + 1))

inductive Value (N : Type) where
  | bool : Bool → Value N
  | number : N → Value N
  deriving DecidableEq, Repr

structure Event where
  site : Nat
  choice : Nat
  origin : Nat
  deriving DecidableEq, Repr

structure State (N : Type) where
  pc : Nat
  stack : List (Value N)
  trace : List Event

def wordAt (raw : List Nat) (pc : Nat) : Option Nat := do
  let lo ← raw[pc]?
  let hi ← raw[pc + 1]?
  if lo < 256 ∧ hi < 256 then some (lo + 256 * hi) else none

def dwordAt (raw : List Nat) (pc : Nat) : Option Nat := do
  let lo ← wordAt raw pc
  let hi ← wordAt raw (pc + 2)
  some (lo + 65536 * hi)

def step (ops : NumberOps N) (raw : List Nat) (inputs : List (Value N)) (s : State N) : Option (State N) := do
  let op ← raw[s.pc]?
  match op with
  | 1 =>
    let b ← raw[s.pc + 1]?
    if b ≤ 1 then some { s with pc := s.pc + 2, stack := .bool (b = 1) :: s.stack } else none
  | 3 =>
    let i ← wordAt raw (s.pc + 1)
    let value ← inputs[i]?
    some { s with pc := s.pc + 3, stack := value :: s.stack }
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
      if 0 < site ∧ origin ≤ 4294967295 ∧ choice ≤ 65535 ∧ s.trace.length < 1 then
        some { pc := s.pc + 5, stack := value :: rest, trace := s.trace ++ [⟨site, choice, origin⟩] }
      else none
    | _ => none
  | op =>
    if 32 ≤ op ∧ op ≤ 47 then
      some { s with pc := s.pc + 1, stack := .number (ops.literal (op - 32)) :: s.stack }
    else none

def execute (ops : NumberOps N) (raw : List Nat) (inputs : List (Value N)) : Nat → State N → Option (Bool × List Event)
  | 0, _ => none
  | fuel + 1, s =>
    if s.pc = raw.length then
      match s.stack with
      | [.bool value] => some (value, s.trace)
      | _ => none
    else do
      let next ← step ops raw inputs s
      if next.stack.length ≤ 128 then execute ops raw inputs fuel next else none

def run (ops : NumberOps N) (code : List Nat) (inputs : List (Value N)) : Option (Bool × List Event) :=
  execute ops code inputs (code.length + 1) ⟨0, [], []⟩

inductive Steps (ops : NumberOps N) (raw : List Nat) (inputs : List (Value N)) : Nat → State N → State N → Prop where
  | refl : Steps ops raw inputs 0 s s
  | next (next : State N) (running : s.pc ≠ raw.length) (one : step ops raw inputs s = some next)
      (room : next.stack.length ≤ 128) (rest : Steps ops raw inputs count next final) :
      Steps ops raw inputs (count + 1) s final

theorem steps_execute (h : Steps ops raw inputs count s final) (fuel : Nat) (room : count < fuel)
    (done : final.pc = raw.length) (stack : final.stack = [.bool value]) :
    execute ops raw inputs fuel s = some (value, final.trace) := by
  induction h generalizing fuel with
  | refl =>
    cases fuel with
    | zero => omega
    | succ fuel => simp [execute, done, stack]
  | next next running one space rest ih =>
    cases fuel with
    | zero => omega
    | succ fuel =>
      simpa [execute, running, one, space] using ih fuel (by omega) done stack

def branch (condition yes no : List Nat) : List Nat :=
  condition ++ [30] ++ u16 (yes.length + 3) ++ yes ++ [31] ++ u16 no.length ++ no

def recoverCode : List Nat :=
  branch [3, 1, 0] [3, 0, 0] [1, 0] ++
  branch [3, 1, 0] [32] [3, 2, 0, 33, 19] ++
  branch [3, 1, 0] [32] [33] ++ [56] ++ u32 5

inductive Fault where
  | disconnected | stale | invalid | notReady
  deriving DecidableEq, Repr

def Fault.code : Fault → Nat
  | .disconnected => 0
  | .stale => 1
  | .invalid => 2
  | .notReady => 3

theorem fault_bound (fault : Fault) : fault.code < 4 := by cases fault <;> decide

inductive Reading where
  | healthy : Bool → Reading
  | fault : Fault → Reading
  deriving DecidableEq, Repr

def rails (ops : NumberOps N) (reading : Reading) (stalePayload : Bool) : List (Value N) :=
  match reading with
  | .healthy b => [.bool b, .bool true, .number (ops.literal 0)]
  | .fault fault => [.bool stalePayload, .bool false, .number (ops.literal fault.code)]

def expected : Reading → Bool × List Event
  | .healthy b => (b, [⟨5, 0, 0⟩])
  | .fault fault => (false, [⟨5, fault.code + 1, 1⟩])

def admitted (ops : NumberOps N) : List (Value N) → Bool
  | [.bool _, .bool ok, .number fault] =>
    match ops.integer fault with
    | some n => if ok then decide (n = 0) else decide (n < 4)
    | none => false
  | _ => false

def runAdmitted (ops : NumberOps N) (code : List Nat) (inputs : List (Value N)) : Option (Bool × List Event) :=
  if admitted ops inputs then run ops code inputs else none

theorem healthy_execution (ops : NumberOps N) (laws : SmallNumberLaws ops) (b : Bool) :
    run ops recoverCode (rails ops (.healthy b) false) = some (expected (.healthy b)) := by
  have path : Steps ops recoverCode (rails ops (.healthy b) false) 13 ⟨0, [], []⟩
      ⟨45, [.bool b], [⟨5, 0, 0⟩]⟩ := by
    apply Steps.next ⟨3, [.bool true], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨6, [], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨9, [.bool b], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨14, [.bool b], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨17, [.bool true, .bool b], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨20, [.bool b], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨21, [.number (ops.literal 0), .bool b], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨29, [.number (ops.literal 0), .bool b], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨32, [.bool true, .number (ops.literal 0), .bool b], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨35, [.number (ops.literal 0), .bool b], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨36, [.number (ops.literal 0), .number (ops.literal 0), .bool b], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨40, [.number (ops.literal 0), .number (ops.literal 0), .bool b], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨45, [.bool b], [⟨5, 0, 0⟩]⟩ (by first | decide | (dsimp; decide)) ?_ (by first | decide | (dsimp; decide)) Steps.refl
    simp [step, recoverCode, branch, u16, u32, wordAt, dwordAt, laws.integer_literal 0 (by first | decide | (dsimp; decide))]
  exact steps_execute path 46 (by first | decide | (dsimp; decide)) (by first | decide | (dsimp; decide)) rfl

theorem fault_execution (ops : NumberOps N) (laws : SmallNumberLaws ops) (fault : Fault) (b : Bool) :
    run ops recoverCode (rails ops (.fault fault) b) = some (expected (.fault fault)) := by
  have bound := fault_bound fault
  have choiceBound : fault.code + 1 ≤ 65535 := by omega
  have small : fault.code + 1 ≤ 4 := by omega
  have path : Steps ops recoverCode (rails ops (.fault fault) b) 12 ⟨0, [], []⟩
      ⟨45, [.bool false], [⟨5, fault.code + 1, 1⟩]⟩ := by
    apply Steps.next ⟨3, [.bool false], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨12, [], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨14, [.bool false], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨17, [.bool false, .bool false], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨24, [.bool false], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨27, [.number (ops.literal fault.code), .bool false], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨28, [.number (ops.literal 1), .number (ops.literal fault.code), .bool false], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨29, [.number (ops.literal (fault.code + 1)), .bool false], []⟩ (by first | decide | (dsimp; decide))
      (by simp [step, recoverCode, branch, u16, u32, laws.add_one fault.code bound]) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨32, [.bool false, .number (ops.literal (fault.code + 1)), .bool false], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨39, [.number (ops.literal (fault.code + 1)), .bool false], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨40, [.number (ops.literal 1), .number (ops.literal (fault.code + 1)), .bool false], []⟩ (by first | decide | (dsimp; decide)) (by rfl) (by first | decide | (dsimp; decide))
    apply Steps.next ⟨45, [.bool false], [⟨5, fault.code + 1, 1⟩]⟩ (by first | decide | (dsimp; decide)) ?_ (by first | decide | (dsimp; decide)) Steps.refl
    simp [step, recoverCode, branch, u16, u32, wordAt, dwordAt,
      laws.integer_literal 1 (by first | decide | (dsimp; decide)), laws.integer_literal (fault.code + 1) small, choiceBound]
  exact steps_execute path 46 (by first | decide | (dsimp; decide)) (by first | decide | (dsimp; decide)) rfl

theorem admitted_rails (ops : NumberOps N) (laws : SmallNumberLaws ops) (r : Reading) (b : Bool) :
    admitted ops (rails ops r b) = true := by
  cases r with
  | healthy value => simp [admitted, rails, laws.integer_literal 0 (by first | decide | (dsimp; decide))]
  | fault fault =>
    have bound := fault_bound fault
    simp [admitted, rails, laws.integer_literal fault.code (by omega), bound]

theorem recovery (ops : NumberOps N) (laws : SmallNumberLaws ops) (r : Reading) (b : Bool) :
    runAdmitted ops recoverCode (rails ops r b) = some (expected r) := by
  simp only [runAdmitted, admitted_rails ops laws r b, ↓reduceIte]
  cases r with
  | healthy value => exact healthy_execution ops laws value
  | fault fault => exact fault_execution ops laws fault b

def naturalNumbers : NumberOps Nat := ⟨id, fun a b => some (a + b), some⟩
theorem natural_laws : SmallNumberLaws naturalNumbers := by constructor <;> intros <;> rfl

theorem false_is_distinguished (fault : Fault) : expected (.healthy false) ≠ expected (.fault fault) := by
  simp [expected]

#print axioms healthy_execution
#print axioms fault_execution
#print axioms recovery
#print axioms false_is_distinguished

end BoolTranslation.SensorMachine
