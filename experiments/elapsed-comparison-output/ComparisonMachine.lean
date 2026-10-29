import DurationMachine

namespace BoolTranslation.ComparisonMachine
open SensorMachine EpochMachine ElapsedClockBounds

set_option maxRecDepth 32768
set_option maxHeartbeats 16000000

def thresholdBytes : List Nat := [0,0,0,0,0,112,167,64]
def mutantThresholdBytes : List Nat := [0,0,0,0,0,114,167,64]
def comparisonCode : List Nat := DurationMachine.durationCode ++ [2] ++ thresholdBytes ++ [17]

def boundLiteral (bytes : List Nat) : Option Nat :=
  if bytes = thresholdBytes then some 3000 else
  if bytes = mutantThresholdBytes then some 3001 else none

def step (code : List Nat) (inputs before : List (Value Nat))
    (candidate : Option (List (Value Nat))) (bound : Nat) (state : State Nat) : Option (State Nat) :=
  if code[state.pc]? = some 2 then do
    let value ← boundLiteral ((code.drop (state.pc + 1)).take 8)
    pure {state with pc := state.pc + 9, stack := .number value :: state.stack}
  else if code[state.pc]? = some 17 ∨ code[state.pc]? = some 16 then
    match state.stack with
    | .number right :: .number left :: rest =>
      some {state with pc := state.pc + 1, stack := .bool (if code[state.pc]? = some 17 then decide (left ≥ right) else decide (left > right)) :: rest}
    | _ => none
  else DurationMachine.step naturalNumbers code inputs before candidate bound state

theorem step_conservative (code : List Nat) (inputs before : List (Value Nat))
    (candidate : Option (List (Value Nat))) (bound : Nat) (state : State Nat)
    (notLiteral : code[state.pc]? ≠ some 2) (notGe : code[state.pc]? ≠ some 17)
    (notGt : code[state.pc]? ≠ some 16) :
    step code inputs before candidate bound state =
      DurationMachine.step naturalNumbers code inputs before candidate bound state := by
  simp [step, notLiteral, notGe, notGt]

def execute (code : List Nat) (inputs before : List (Value Nat))
    (candidate : Option (List (Value Nat))) (bound : Nat) :
    Nat → State Nat → Option (Value Nat × List Event)
  | 0, _ => none
  | fuel + 1, state =>
    if state.pc = code.length then
      match state.stack with
      | [value] => some (value, state.trace)
      | _ => none
    else if state.pc > code.length then none else do
      let next ← step code inputs before candidate bound state
      if next.stack.length ≤ 128 then execute code inputs before candidate bound fuel next else none

def runValue (code : List Nat) (inputs before : List (Value Nat))
    (candidate : Option (List (Value Nat))) (bound : Nat) (trace : List Event) :
    Option (Value Nat × List Event) :=
  execute code inputs before candidate bound (code.length + 1) ⟨0, [], trace⟩

theorem comparison_execution (before : Epoch Nat) (input : Input Nat)
    (candidate : Option (List (Value Nat))) (bound : Nat) (trace : List Event) :
    runValue comparisonCode (inputRails naturalNumbers input.reading input.stale input.now)
      (stateRails before.held before.since before.initialized) candidate bound trace =
      some (.bool (decide (expressionAge before input ≥ 3000)), trace) := by
  rcases before with ⟨held, since, initialized⟩
  rcases input with ⟨reading, stale, now⟩
  cases initialized <;> cases reading <;> rfl

structure Observation where
  base : EpochMachine.Observation Nat
  expired : Bool
  eventsAfter : List Event
  deriving DecidableEq, Repr

def observeTrace (code : List Nat) : Epoch Nat → List (Input Nat) →
    List (EpochMachine.Observation Nat) → Option (List Observation)
  | _, [], [] => some []
  | before, input :: rest, observation :: tail => do
    let (value, events) ← runValue code (inputRails naturalNumbers input.reading input.stale input.now)
      (stateRails before.held before.since before.initialized)
      (some (stateRails observation.epoch.held observation.epoch.since observation.epoch.initialized)) 2 observation.events
    match value with
    | .number _ => none
    | .bool expired => do
      let remaining ← observeTrace code observation.epoch rest tail
      pure (⟨observation, expired, events⟩ :: remaining)
  | _, _, _ => none

def expectedTrace : Epoch Nat → List (Input Nat) → List (EpochMachine.Observation Nat) → Option (List Observation)
  | _, [], [] => some []
  | before, input :: rest, observation :: tail => do
    let remaining ← expectedTrace observation.epoch rest tail
    pure (⟨observation, decide (expressionAge before input ≥ 3000), observation.events⟩ :: remaining)
  | _, _, _ => none

theorem output_trace (before : Epoch Nat) (inputs : List (Input Nat))
    (observations : List (EpochMachine.Observation Nat)) :
    observeTrace comparisonCode before inputs observations = expectedTrace before inputs observations := by
  induction inputs generalizing before observations with
  | nil => cases observations <;> rfl
  | cons input rest ih =>
    cases observations with
    | nil => rfl
    | cons observation tail => simp [observeTrace, expectedTrace, comparison_execution, ih]

theorem source_trace_has_output (before : Epoch Nat) (inputs : List (Input Nat)) :
    ∃ observations, expectedTrace before inputs (sourceTrace before inputs) = some observations := by
  induction inputs generalizing before with
  | nil => exact ⟨[], rfl⟩
  | cons input rest ih =>
    obtain ⟨tail, h⟩ := ih (sourceScan before input).epoch
    exact ⟨⟨sourceScan before input, decide (expressionAge before input ≥ 3000), (sourceScan before input).events⟩ :: tail,
      by simp [sourceTrace, expectedTrace, h]⟩

#print axioms step_conservative
#print axioms comparison_execution
#print axioms output_trace
#print axioms source_trace_has_output
end BoolTranslation.ComparisonMachine
