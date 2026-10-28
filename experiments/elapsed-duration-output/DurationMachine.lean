import ClockBounds

namespace BoolTranslation.DurationMachine
open SensorMachine EpochMachine ElapsedClockBounds

def durationCode : List Nat := [4,2,0,30,10,0,3,3,0,4,1,0,20,31,1,0,32]

def step (ops : NumberOps Nat) (code : List Nat) (inputs before : List (Value Nat))
    (candidate : Option (List (Value Nat))) (bound : Nat) (state : State Nat) : Option (State Nat) :=
  if code[state.pc]? = some 20 then
    match state.stack with
    | .number right :: .number left :: rest =>
      some {state with pc := state.pc + 1, stack := .number (left - right) :: rest}
    | _ => none
  else EpochMachine.step ops code inputs before candidate bound state

theorem step_conservative (ops : NumberOps Nat) (code : List Nat) (inputs before : List (Value Nat))
    (candidate : Option (List (Value Nat))) (bound : Nat) (state : State Nat)
    (notSubtraction : code[state.pc]? ≠ some 20) :
    step ops code inputs before candidate bound state = EpochMachine.step ops code inputs before candidate bound state := by
  simp [step, notSubtraction]

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
      let next ← step naturalNumbers code inputs before candidate bound state
      if next.stack.length ≤ 128 then execute code inputs before candidate bound fuel next else none

def runValue (code : List Nat) (inputs before : List (Value Nat))
    (candidate : Option (List (Value Nat))) (bound : Nat) (trace : List Event) :
    Option (Value Nat × List Event) :=
  execute code inputs before candidate bound (code.length + 1) ⟨0, [], trace⟩

theorem duration_execution (before : Epoch Nat) (input : Input Nat)
    (candidate : Option (List (Value Nat))) (bound : Nat) (trace : List Event) :
    runValue durationCode (inputRails naturalNumbers input.reading input.stale input.now)
      (stateRails before.held before.since before.initialized) candidate bound trace =
      some (.number (expressionAge before input), trace) := by
  rcases before with ⟨held, since, initialized⟩
  rcases input with ⟨reading, stale, now⟩
  cases initialized <;> cases reading <;> rfl

structure Observation where
  base : EpochMachine.Observation Nat
  elapsed : Nat
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
    | .bool _ => none
    | .number elapsed => do
      let remaining ← observeTrace code observation.epoch rest tail
      pure (⟨observation, elapsed, events⟩ :: remaining)
  | _, _, _ => none

def expectedTrace : Epoch Nat → List (Input Nat) → List (EpochMachine.Observation Nat) → Option (List Observation)
  | _, [], [] => some []
  | before, input :: rest, observation :: tail => do
    let remaining ← expectedTrace observation.epoch rest tail
    pure (⟨observation, expressionAge before input, observation.events⟩ :: remaining)
  | _, _, _ => none

theorem output_trace (before : Epoch Nat) (inputs : List (Input Nat))
    (observations : List (EpochMachine.Observation Nat)) :
    observeTrace durationCode before inputs observations = expectedTrace before inputs observations := by
  induction inputs generalizing before observations with
  | nil => cases observations <;> rfl
  | cons input rest ih =>
    cases observations with
    | nil => rfl
    | cons observation tail => simp [observeTrace, expectedTrace, duration_execution, ih]

theorem source_trace_has_output (before : Epoch Nat) (inputs : List (Input Nat)) :
    ∃ observations, expectedTrace before inputs (sourceTrace before inputs) = some observations := by
  induction inputs generalizing before with
  | nil => exact ⟨[], rfl⟩
  | cons input rest ih =>
    obtain ⟨tail, h⟩ := ih (sourceScan before input).epoch
    exact ⟨⟨sourceScan before input, expressionAge before input, (sourceScan before input).events⟩ :: tail,
      by simp [sourceTrace, expectedTrace, h]⟩

#print axioms step_conservative
#print axioms duration_execution
#print axioms output_trace
#print axioms source_trace_has_output
end BoolTranslation.DurationMachine
