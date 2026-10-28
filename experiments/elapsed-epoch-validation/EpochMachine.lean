import SensorStateMachine

namespace BoolTranslation.EpochMachine
open ModuleEnvelope SensorMachine
set_option maxRecDepth 32768
set_option maxHeartbeats 16000000

def step (ops : NumberOps N) (raw : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (bound : Nat) (s : State N) : Option (State N) :=
  if raw[s.pc]? = some 13 then
    match s.stack with
    | .bool right :: .bool left :: rest =>
      some {s with pc := s.pc + 1, stack := .bool (left == right) :: rest}
    | _ => none
  else SensorStateMachine.step ops raw inputs before candidate bound s

theorem step_conservative (ops : NumberOps N) (raw : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (bound : Nat) (s : State N)
    (notEquality : raw[s.pc]? ≠ some 13) :
    step ops raw inputs before candidate bound s =
      SensorStateMachine.step ops raw inputs before candidate bound s := by
  simp [step, notEquality]

def steps (ops : NumberOps N) (raw : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (bound : Nat) : Nat → State N → Option (State N)
  | 0, s => some s
  | count + 1, s => do
    let next ← step ops raw inputs before candidate bound s
    if next.stack.length ≤ 128 then steps ops raw inputs before candidate bound count next else none

theorem steps_conservative (ops : NumberOps N) (raw : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (bound count : Nat)
    (notEquality : ∀ s : State N, raw[s.pc]? ≠ some 13) (s : State N) :
    steps ops raw inputs before candidate bound count s =
      SensorStateMachine.steps ops raw inputs before candidate bound count s := by
  induction count generalizing s with
  | zero => rfl
  | succ count ih =>
    simp only [steps, SensorStateMachine.steps, step_conservative ops raw inputs before candidate bound s (notEquality s)]
    cases one : SensorStateMachine.step ops raw inputs before candidate bound s with
    | none => rfl
    | some next =>
      by_cases room : next.stack.length ≤ 128
      · simp [room, ih]
      · simp [room]

def sinceCode : List Nat :=
  [4, 2, 0, 10, 30, 6, 0, 3, 3, 0, 31, 74, 0] ++ SensorStateMachine.transitionCode ++
  [4, 0, 0, 13, 30, 6, 0, 4, 1, 0, 31, 3, 0, 3, 3, 0]
def initializedCode : List Nat := [1, 1]
def inputRails (ops : NumberOps N) (r : Reading) (stale : Bool) (now : N) : List (Value N) :=
  rails ops r stale ++ [.number now]
def stateRails (held : Bool) (since : N) (initialized : Bool) : List (Value N) :=
  [.bool held, .number since, .bool initialized]
def transitionSteps (r : Reading) : Nat :=
  SensorStateMachine.recoverySteps r + (if SensorStateMachine.result r then 4 else 2)
def sinceSteps (initialized : Bool) (r : Reading) : Nat :=
  if initialized then 3 + transitionSteps r + 3 + (if SensorStateMachine.result r then 1 else 2) else 5
def nextSince (initialized : Bool) (r : Reading) (since now : N) : N :=
  if !initialized || SensorStateMachine.result r then now else since
def sinceEvents (initialized : Bool) (r : Reading) (trace : List Event) : List Event :=
  if initialized then trace ++ [SensorStateMachine.event r] else trace

-- The adapter checks termination after a supplied finite step count. It does
-- not model Rust scheduling, numeric subtraction, or a scan commit mechanism.
def runValue (ops : NumberOps N) (code : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (bound count : Nat) (trace : List Event) :
    Option (Value N × List Event) := do
  if count > code.length then none else do
    let final ← steps ops code inputs before candidate bound count ⟨0, [], trace⟩
    if final.pc ≠ code.length then none else
      match final.stack with
      | [value] => some (value, final.trace)
      | _ => none

theorem steps_append (ops : NumberOps N) (raw : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (bound left right : Nat) (s : State N) :
    steps ops raw inputs before candidate bound (left + right) s =
      (steps ops raw inputs before candidate bound left s).bind
        (steps ops raw inputs before candidate bound right) := by
  induction left generalizing s with
  | zero => simp [steps]
  | succ left ih =>
    rw [Nat.succ_add, steps, steps]
    cases one : step ops raw inputs before candidate bound s with
    | none => simp [one]
    | some next =>
      by_cases room : next.stack.length ≤ 128
      · simpa [Bind.bind, Option.bind, room] using ih next
      · simp [Bind.bind, Option.bind, room]

def offset (shifted : Bool) : Nat := if shifted then 13 else 0
def expression (shifted : Bool) : List Nat := if shifted then sinceCode else SensorStateMachine.transitionCode

inductive Path (ops : NumberOps N) (raw : List Nat) (inputs before : List (Value N))
    (candidate : Option (List (Value N))) (bound : Nat) : Nat → State N → State N → Prop where
  | refl : Path ops raw inputs before candidate bound 0 s s
  | next (next : State N) (one : step ops raw inputs before candidate bound s = some next)
      (room : next.stack.length ≤ 128) (rest : Path ops raw inputs before candidate bound count next final) :
      Path ops raw inputs before candidate bound (count + 1) s final

theorem path_runs (h : Path ops raw inputs before candidate bound count s final) :
    steps ops raw inputs before candidate bound count s = some final := by
  induction h with
  | refl => rfl
  | next next one room rest ih => simp [steps, one, room, ih]

theorem recovery_context (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (shifted : Bool) (r : Reading) (stale held initialized : Bool) (since now : N)
    (trace : List Event) (room : trace.length < 2) :
    steps ops (expression shifted) (inputRails ops r stale now) (stateRails held since initialized) none 2
      (SensorStateMachine.recoverySteps r) ⟨offset shifted, [], trace⟩ =
      some ⟨offset shifted + 45, [.bool (SensorStateMachine.result r)], trace ++ [SensorStateMachine.event r]⟩ := by
  cases r with
  | healthy b =>
    have path : Path ops (expression shifted) (inputRails ops (.healthy b) stale now)
        (stateRails held since initialized) none 2 13 ⟨offset shifted, [], trace⟩
        ⟨offset shifted + 45, [.bool b], trace ++ [(⟨7, 0, 0⟩ : Event)]⟩ := by
        apply Path.next ⟨offset shifted + 3, [.bool true], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 6, [], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 9, [.bool b], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 14, [.bool b], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 17, [.bool true, .bool b], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 20, [.bool b], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 21, [.number (ops.literal 0), .bool b], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 29, [.number (ops.literal 0), .bool b], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 32, [.bool true, .number (ops.literal 0), .bool b], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 35, [.number (ops.literal 0), .bool b], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 36, [.number (ops.literal 0), .number (ops.literal 0), .bool b], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 40, [.number (ops.literal 0), .number (ops.literal 0), .bool b], trace⟩ (by cases shifted <;> rfl) (by simp)
        refine Path.next (N := N) (ops := ops) (⟨offset shifted + 45, [.bool b], trace ++ [(⟨7, 0, 0⟩ : Event)]⟩ : State N) ?_ (by simp) ?_
        · cases shifted <;> simp [step, SensorStateMachine.step, expression, offset, sinceCode,
              SensorStateMachine.transitionCode, SensorStateMachine.recoverCode, SensorStateMachine.toggleSuffix,
              SensorStateMachine.event, branch, u16, u32, wordAt, dwordAt, laws.integer_literal 0 (by decide), room]
        · exact Path.refl
    exact path_runs path
  | fault f =>
    have bound := fault_bound f
    have small : f.code + 1 ≤ 4 := by omega
    have choiceBound : f.code + 1 ≤ 65535 := by omega
    have path : Path ops (expression shifted) (inputRails ops (.fault f) stale now)
        (stateRails held since initialized) none 2 12 ⟨offset shifted, [], trace⟩
        ⟨offset shifted + 45, [.bool false], trace ++ [(⟨7, f.code + 1, 1⟩ : Event)]⟩ := by
        apply Path.next ⟨offset shifted + 3, [.bool false], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 12, [], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 14, [.bool false], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 17, [.bool false, .bool false], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 24, [.bool false], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 27, [.number (ops.literal f.code), .bool false], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 28, [.number (ops.literal 1), .number (ops.literal f.code), .bool false], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 29, [.number (ops.literal (f.code + 1)), .bool false], trace⟩
          (by cases shifted <;> simp [step, SensorStateMachine.step, expression, offset, sinceCode,
              SensorStateMachine.transitionCode, SensorStateMachine.recoverCode, SensorStateMachine.toggleSuffix,
              SensorStateMachine.event, branch, u16, u32, wordAt, dwordAt, laws.add_one f.code bound]) (by simp)
        apply Path.next ⟨offset shifted + 32, [.bool false, .number (ops.literal (f.code + 1)), .bool false], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 39, [.number (ops.literal (f.code + 1)), .bool false], trace⟩ (by cases shifted <;> rfl) (by simp)
        apply Path.next ⟨offset shifted + 40, [.number (ops.literal 1), .number (ops.literal (f.code + 1)), .bool false], trace⟩ (by cases shifted <;> rfl) (by simp)
        refine Path.next (N := N) (ops := ops) (⟨offset shifted + 45, [.bool false], trace ++ [(⟨7, f.code + 1, 1⟩ : Event)]⟩ : State N) ?_ (by simp) ?_
        · cases shifted <;> simp [step, SensorStateMachine.step, expression, offset, sinceCode,
              SensorStateMachine.transitionCode, SensorStateMachine.recoverCode, SensorStateMachine.toggleSuffix,
              SensorStateMachine.event, branch, u16, u32, wordAt, dwordAt,
          laws.integer_literal 1 (by decide), laws.integer_literal (f.code + 1) small, choiceBound, room]
        · exact Path.refl
    exact path_runs path

theorem toggle_context (ops : NumberOps N) (shifted : Bool) (r : Reading)
    (stale held initialized : Bool) (since now : N) (trace : List Event) :
    steps ops (expression shifted) (inputRails ops r stale now) (stateRails held since initialized) none 2
      (if SensorStateMachine.result r then 4 else 2)
      ⟨offset shifted + 45, [.bool (SensorStateMachine.result r)], trace⟩ =
      some ⟨offset shifted + 58, [.bool (SensorStateMachine.toggled held r)], trace⟩ := by
  cases shifted <;> cases r with
  | healthy b => cases b <;> rfl
  | fault f => rfl

theorem transition_steps (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (shifted : Bool) (r : Reading) (stale held initialized : Bool) (since now : N)
    (trace : List Event) (room : trace.length < 2) :
    steps ops (expression shifted) (inputRails ops r stale now) (stateRails held since initialized) none 2
      (transitionSteps r) ⟨offset shifted, [], trace⟩ =
      some ⟨offset shifted + 58, [.bool (SensorStateMachine.toggled held r)], trace ++ [SensorStateMachine.event r]⟩ := by
  rw [transitionSteps, steps_append, recovery_context ops laws shifted r stale held initialized since now trace room]
  exact toggle_context ops shifted r stale held initialized since now _

theorem since_prefix (ops : NumberOps N) (r : Reading) (stale held initialized : Bool)
    (since now : N) (trace : List Event) :
    steps ops sinceCode (inputRails ops r stale now) (stateRails held since initialized) none 2
      (if initialized then 3 else 5) ⟨0, [], trace⟩ =
      some (if initialized then ⟨13, [], trace⟩ else ⟨87, [.number now], trace⟩) := by
  cases initialized <;> cases r <;>
    simp [steps, step, SensorStateMachine.step, sinceCode, SensorStateMachine.transitionCode,
      SensorStateMachine.recoverCode, SensorStateMachine.toggleSuffix, branch, u16, u32,
      wordAt, inputRails, stateRails, rails]

theorem since_suffix (ops : NumberOps N) (r : Reading) (stale held : Bool)
    (since now : N) (trace : List Event) :
    steps ops sinceCode (inputRails ops r stale now) (stateRails held since true) none 2
      (3 + (if SensorStateMachine.result r then 1 else 2))
      ⟨71, [.bool (SensorStateMachine.toggled held r)], trace⟩ =
      some ⟨87, [.number (nextSince true r since now)], trace⟩ := by
  cases r with
  | healthy b => cases b <;>
    simp [steps, step, SensorStateMachine.step, sinceCode, SensorStateMachine.transitionCode,
      SensorStateMachine.recoverCode, SensorStateMachine.toggleSuffix, branch, u16, u32, wordAt,
      inputRails, stateRails, rails, SensorStateMachine.result, SensorStateMachine.toggled, nextSince]
  | fault f =>
    simp [steps, step, SensorStateMachine.step, sinceCode, SensorStateMachine.transitionCode,
      SensorStateMachine.recoverCode, SensorStateMachine.toggleSuffix, branch, u16, u32, wordAt,
      inputRails, stateRails, rails, SensorStateMachine.result, SensorStateMachine.toggled, nextSince]

theorem transition_execution (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (r : Reading) (stale held initialized : Bool) (since now : N) :
    runValue ops SensorStateMachine.transitionCode (inputRails ops r stale now)
      (stateRails held since initialized) none 2 (transitionSteps r) [] =
      some (.bool (SensorStateMachine.toggled held r), [SensorStateMachine.event r]) := by
  have path := transition_steps ops laws false r stale held initialized since now [] (by simp)
  have count : transitionSteps r ≤ SensorStateMachine.transitionCode.length := by
    cases r with
    | healthy b => cases b <;> decide
    | fault f => simp [transitionSteps, SensorStateMachine.recoverySteps, SensorStateMachine.result, sinceSteps, sinceCode, SensorStateMachine.transitionCode, SensorStateMachine.recoverCode, SensorStateMachine.toggleSuffix, branch, u16, u32]
  simp only [expression, offset, Bool.false_eq_true, if_false, Nat.zero_add] at path
  have numericCount : transitionSteps r ≤ 58 := count
  simp [runValue, numericCount, path, show SensorStateMachine.transitionCode.length = 58 by rfl]

theorem since_execution (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (r : Reading) (stale held initialized : Bool) (since now : N) (trace : List Event)
    (room : trace.length < 2) :
    runValue ops sinceCode (inputRails ops r stale now) (stateRails held since initialized)
      none 2 (sinceSteps initialized r) trace =
      some (.number (nextSince initialized r since now), sinceEvents initialized r trace) := by
  have count : sinceSteps initialized r ≤ sinceCode.length := by
    cases initialized <;> cases r with
    | healthy b => cases b <;> decide
    | fault f => simp [transitionSteps, SensorStateMachine.recoverySteps, SensorStateMachine.result, sinceSteps, sinceCode, SensorStateMachine.transitionCode, SensorStateMachine.recoverCode, SensorStateMachine.toggleSuffix, branch, u16, u32]
  cases initialized with
  | false =>
    have path := since_prefix ops r stale held false since now trace
    simp only [Bool.false_eq_true, if_false] at path
    simp [runValue, sinceSteps, path, nextSince, sinceEvents, show sinceCode.length = 87 by rfl]
  | true =>
    have headPath := since_prefix ops r stale held true since now trace
    change steps ops sinceCode (inputRails ops r stale now) (stateRails held since true) none 2
      3 ⟨0, [], trace⟩ = some ⟨13, [], trace⟩ at headPath
    have middle := transition_steps ops laws true r stale held true since now trace room
    have suffix := since_suffix ops r stale held since now (trace ++ [SensorStateMachine.event r])
    have path : steps ops sinceCode (inputRails ops r stale now) (stateRails held since true) none 2
        (sinceSteps true r) ⟨0, [], trace⟩ =
        some ⟨87, [.number (nextSince true r since now)], trace ++ [SensorStateMachine.event r]⟩ := by
      change steps ops sinceCode (inputRails ops r stale now) (stateRails held since true) none 2
        (3 + transitionSteps r + 3 + (if SensorStateMachine.result r then 1 else 2)) ⟨0, [], trace⟩ = _
      rw [show 3 + transitionSteps r + 3 + (if SensorStateMachine.result r then 1 else 2) =
        3 + (transitionSteps r + (3 + (if SensorStateMachine.result r then 1 else 2))) by omega]
      rw [steps_append, headPath]
      change (steps ops sinceCode (inputRails ops r stale now) (stateRails held since true) none 2
        (transitionSteps r + (3 + (if SensorStateMachine.result r then 1 else 2))) ⟨13, [], trace⟩) = _
      rw [steps_append]
      change ((steps ops (expression true) (inputRails ops r stale now) (stateRails held since true) none 2
        (transitionSteps r) ⟨offset true, [], trace⟩).bind _) = _
      rw [middle]
      exact suffix
    have numericCount : sinceSteps true r ≤ 87 := count
    simp [runValue, numericCount, path, sinceEvents, show sinceCode.length = 87 by rfl]

structure Epoch (N : Type) where
  held : Bool
  since : N
  initialized : Bool
  deriving DecidableEq, Repr
structure Input (N : Type) where
  reading : Reading
  stale : Bool
  now : N
  deriving DecidableEq, Repr
structure Observation (N : Type) where
  epoch : Epoch N
  requested : Bool
  events : List Event
  deriving DecidableEq, Repr

def sourceScan (old : Epoch N) (input : Input N) : Observation N :=
  let held := SensorStateMachine.toggled old.held input.reading
  ⟨⟨held, nextSince old.initialized input.reading old.since input.now, true⟩, held,
    sinceEvents old.initialized input.reading [SensorStateMachine.event input.reading]⟩

def rawScan (ops : NumberOps N) (transition since init output : List Nat)
    (old : Epoch N) (input : Input N) : Option (Observation N) := do
  let inputs := inputRails ops input.reading input.stale input.now
  let before := stateRails old.held old.since old.initialized
  let (held, trace) ← runValue ops transition inputs before none 2 (transitionSteps input.reading) []
  let (started, trace) ← runValue ops since inputs before none 2 (sinceSteps old.initialized input.reading) trace
  let (initialized, trace) ← runValue ops init inputs before none 2 1 trace
  let candidate := [held, started, initialized]
  let (requested, trace) ← runValue ops output inputs before (some candidate) 2 1 trace
  match held, started, initialized, requested with
  | .bool held, .number since, .bool initialized, .bool requested =>
    some ⟨⟨held, since, initialized⟩, requested, trace⟩
  | _, _, _, _ => none

theorem scan_refinement (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (old : Epoch N) (input : Input N) :
    rawScan ops SensorStateMachine.transitionCode sinceCode initializedCode SensorStateMachine.outputCode old input =
      some (sourceScan old input) := by
  have sinceRun := since_execution ops laws input.reading input.stale old.held old.initialized
    old.since input.now [SensorStateMachine.event input.reading] (by simp)
  unfold rawScan
  dsimp only
  rw [transition_execution ops laws]
  simp only [Bind.bind, Option.bind]
  rw [sinceRun]
  simp [runValue, initializedCode, SensorStateMachine.outputCode, steps, step, SensorStateMachine.step,
    wordAt, stateRails, sourceScan, Bind.bind, Option.bind]

def sourceTrace : Epoch N → List (Input N) → List (Observation N)
  | _, [] => []
  | old, input :: rest =>
    let observation := sourceScan old input
    observation :: sourceTrace observation.epoch rest
def rawTrace (ops : NumberOps N) (transition since init output : List Nat) :
    Epoch N → List (Input N) → Option (List (Observation N))
  | _, [] => some []
  | old, input :: rest => do
    let observation ← rawScan ops transition since init output old input
    let tail ← rawTrace ops transition since init output observation.epoch rest
    pure (observation :: tail)

theorem all_histories (ops : NumberOps N) (laws : SmallNumberLaws ops) (initial : Epoch N)
    (inputs : List (Input N)) :
    rawTrace ops SensorStateMachine.transitionCode sinceCode initializedCode SensorStateMachine.outputCode initial inputs =
      some (sourceTrace initial inputs) := by
  induction inputs generalizing initial with
  | nil => rfl
  | cons input rest ih => simp [rawTrace, sourceTrace, scan_refinement ops laws, ih]

theorem first_scan_starts_now (held : Bool) (since : N) (input : Input N) :
    (sourceScan ⟨held, since, false⟩ input).epoch.since = input.now := by rfl

theorem retained_state_preserves_epoch (held : Bool) (since : N) (input : Input N)
    (retained : SensorStateMachine.result input.reading = false) :
    (sourceScan ⟨held, since, true⟩ input).epoch.since = since := by
  simp [sourceScan, nextSince, retained]

theorem changed_state_starts_now (held : Bool) (since now : N) (stale : Bool) :
    (sourceScan ⟨held, since, true⟩ ⟨.healthy true, stale, now⟩).epoch.since = now := by rfl

theorem stale_payload_irrelevant (old : Epoch N) (r : Reading) (left right : Bool) (now : N) :
    sourceScan old ⟨r, left, now⟩ = sourceScan old ⟨r, right, now⟩ := by rfl

theorem actual_event_counts (held : Bool) (since : N) (input : Input N) :
    (sourceScan ⟨held, since, false⟩ input).events.length = 1 ∧
    (sourceScan ⟨held, since, true⟩ input).events.length = 2 := by constructor <;> rfl

#print axioms step_conservative
#print axioms steps_conservative
#print axioms transition_execution
#print axioms since_execution
#print axioms all_histories
end BoolTranslation.EpochMachine
