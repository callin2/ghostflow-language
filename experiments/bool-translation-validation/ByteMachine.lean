import BoolTranslation

namespace BoolTranslation.ByteMachine

structure Slots where
  inputs : Nat
  states : Nat
  candidate : Bool
  deriving Repr

def inScope : Expr p → Slots → Bool
  | .literal _, _ => true
  | .input i, slots => decide (i < slots.inputs)
  | .previous i, slots => decide (i < slots.states)
  | .next i _, slots => slots.candidate && decide (i < slots.states)
  | .negate e, slots => inScope e slots
  | .branch c y n, slots => inScope c slots && inScope y slots && inScope n slots

def demand : Wire → Nat
  | .literal _ | .read _ _ _ => 1
  | .negate w => demand w
  | .branch c _ _ y _ _ n => max (demand c) (max (demand y) (demand n))

theorem demand_one (w : Wire) : demand w = 1 := by
  induction w <;> simp_all [demand]

theorem bytes_positive (w : Wire) : 0 < (bytes w).length := by
  cases w <;> simp [bytes] <;> omega

structure State where
  pc : Nat
  stack : List Bool
  deriving DecidableEq, Repr

inductive Fault where
  | truncated | opcode | byte | inputRange | stateRange | nextRange
  | stackLimit | stackUnderflow | zeroJump | jumpRange | resultCount | fuel
  deriving DecidableEq, Repr

inductive Outcome where
  | next (state : State)
  | done (value : Bool)
  | fault (reason : Fault)
  deriving DecidableEq, Repr

def push (pc : Nat) (stack : List Bool) (value : Bool) : Outcome :=
  if stack.length < 128 then .next ⟨pc, value :: stack⟩ else .fault .stackLimit

def readSlot (opcode index : Nat) (slots : Slots) (env : Env) : Except Fault Bool :=
  if opcode = 3 then
    if index < slots.inputs then .ok (env.inputs index) else .error .inputRange
  else if opcode = 4 then
    if index < slots.states then .ok (env.previous index) else .error .stateRange
  else if slots.candidate && decide (index < slots.states) then .ok (env.next index)
  else .error .nextRange

def decode (rest : List Nat) (length : Nat) (slots : Slots) (env : Env) (s : State) : Outcome :=
  match rest with
  | 1 :: b :: _ => if b < 256 then push (s.pc + 2) s.stack (b != 0) else .fault .byte
  | op :: lo :: hi :: _ =>
    if op = 3 ∨ op = 4 ∨ op = 5 then
      if lo < 256 ∧ hi < 256 then
        match readSlot op (lo + 256 * hi) slots env with
        | .ok value => push (s.pc + 3) s.stack value
        | .error fault => .fault fault
      else .fault .byte
    else if op = 30 ∨ op = 31 then
      if lo < 256 ∧ hi < 256 then
        let offset := lo + 256 * hi
        if offset = 0 then .fault .zeroJump
        else if s.pc + 3 + offset > length then .fault .jumpRange
        else if op = 31 then .next ⟨s.pc + 3 + offset, s.stack⟩
        else match s.stack with
          | [] => .fault .stackUnderflow
          | b :: stack => .next ⟨if b then s.pc + 3 else s.pc + 3 + offset, stack⟩
      else .fault .byte
    else if op = 10 then
      match s.stack with
      | [] => .fault .stackUnderflow
      | b :: stack => push (s.pc + 1) stack (!b)
    else .fault .opcode
  | 10 :: _ => match s.stack with
      | [] => .fault .stackUnderflow
      | b :: stack => push (s.pc + 1) stack (!b)
  | op :: _ => if op = 1 ∨ op = 3 ∨ op = 4 ∨ op = 5 ∨ op = 30 ∨ op = 31
      then .fault .truncated else .fault .opcode
  | [] => .fault .truncated

def step (code : List Nat) (slots : Slots) (env : Env) (s : State) : Outcome :=
  if s.pc = code.length then
    match s.stack with
    | [b] => .done b
    | _ => .fault .resultCount
  else if s.pc > code.length then .fault .truncated
  else decode (code.drop s.pc) code.length slots env s

inductive Steps (code : List Nat) (slots : Slots) (env : Env) : Nat → State → State → Prop where
  | zero : Steps code slots env 0 s s
  | cons (first : step code slots env a = .next b) (rest : Steps code slots env n b c) :
      Steps code slots env (n + 1) a c

theorem Steps.single (h : step code slots env a = .next b) : Steps code slots env 1 a b :=
  .cons h .zero

theorem Steps.trans (first : Steps code slots env m a b) (rest : Steps code slots env n b c) :
    Steps code slots env (m + n) a c := by
  induction first with
  | zero => simpa using rest
  | cons h tail ih => simpa [Nat.add_assoc, Nat.add_comm, Nat.add_left_comm] using Steps.cons h (ih rest)

theorem step_at (pre suffix : List Nat) (instruction : List Nat) (nonempty : 0 < instruction.length)
    (slots : Slots) (env : Env) (stack : List Bool) :
    step (pre ++ (instruction ++ suffix)) slots env ⟨pre.length, stack⟩ =
      decode (instruction ++ suffix) (pre.length + instruction.length + suffix.length) slots env ⟨pre.length, stack⟩ := by
  have ne : pre.length ≠ (pre ++ (instruction ++ suffix)).length := by simp only [List.length_append]; omega
  have le : ¬ pre.length > (pre ++ (instruction ++ suffix)).length := by simp only [List.length_append]; omega
  simp only [step, ne, le, ↓reduceIte]
  simp [List.drop_append, Nat.add_assoc]

theorem step_literal (pre suffix : List Nat) (b : Bool) (slots : Slots) (env : Env)
    (stack : List Bool) (room : stack.length < 128) :
    step (pre ++ [1, if b then 1 else 0] ++ suffix) slots env ⟨pre.length, stack⟩ =
      .next ⟨pre.length + 2, b :: stack⟩ := by
  simp only [List.append_assoc]
  rw [step_at pre suffix _ (by simp)]
  cases b <;> simp [decode, push, room]

theorem step_read (pre suffix : List Nat) (op lo hi index : Nat) (slots : Slots) (env : Env)
    (stack : List Bool) (room : stack.length < 128) (encoded : word lo hi index = true)
    (valid : op = 3 ∨ op = 4 ∨ op = 5) (read : readSlot op index slots env = .ok value) :
    step (pre ++ [op, lo, hi] ++ suffix) slots env ⟨pre.length, stack⟩ =
      .next ⟨pre.length + 3, value :: stack⟩ := by
  have hword := encoded
  simp only [word, decide_eq_true_eq] at hword
  obtain ⟨hlo, hhi, hi⟩ := hword
  simp only [List.append_assoc]
  rw [step_at pre suffix _ (by simp)]
  rcases valid with rfl | rfl | rfl <;> simp [decode, hlo, hhi, hi, read, push, room]

theorem step_not (pre suffix : List Nat) (slots : Slots) (env : Env)
    (stack : List Bool) (room : stack.length < 128) (b : Bool) :
    step (pre ++ [10] ++ suffix) slots env ⟨pre.length, b :: stack⟩ =
      .next ⟨pre.length + 1, (!b) :: stack⟩ := by
  simp only [List.append_assoc]
  rw [step_at pre suffix _ (by simp)]
  cases suffix with
  | nil => simp [decode, push, room]
  | cons a tail => cases tail <;> simp [decode, push, room]

theorem step_conditional (pre yes no suffix : List Nat) (fl fh jl jh : Nat)
    (slots : Slots) (env : Env) (stack : List Bool) (b : Bool)
    (encoded : word fl fh (yes.length + 3) = true) :
    step (pre ++ [30, fl, fh] ++ yes ++ [31, jl, jh] ++ no ++ suffix) slots env ⟨pre.length, b :: stack⟩ =
      .next ⟨if b then pre.length + 3 else pre.length + 3 + yes.length + 3, stack⟩ := by
  have hword := encoded
  simp only [word, decide_eq_true_eq] at hword
  obtain ⟨hlo, hhi, hindex⟩ := hword
  simp only [List.append_assoc]
  rw [step_at pre (yes ++ ([31, jl, jh] ++ (no ++ suffix))) [30, fl, fh] (by simp)]
  simp only [List.append_assoc, List.length_append, List.length_cons, List.length_nil]
  cases b <;> simp [decode, hlo, hhi, hindex, Nat.add_assoc]

theorem step_jump (pre no suffix : List Nat) (jl jh : Nat)
    (slots : Slots) (env : Env) (stack : List Bool)
    (encoded : word jl jh no.length = true) (positive : 0 < no.length) :
    step (pre ++ [31, jl, jh] ++ no ++ suffix) slots env ⟨pre.length, stack⟩ =
      .next ⟨pre.length + 3 + no.length, stack⟩ := by
  have hword := encoded
  simp only [word, decide_eq_true_eq] at hword
  obtain ⟨hlo, hhi, hindex⟩ := hword
  simp only [List.append_assoc]
  rw [step_at pre (no ++ suffix) [31, jl, jh] (by simp)]
  have nonzero : no.length ≠ 0 := by omega
  simp [decode, hlo, hhi, hindex, nonzero, Nat.add_assoc]

theorem accepted_steps (e : Expr p) (w : Wire) (accepted : check e w = true)
    (slots : Slots) (scope : inScope e slots = true) (env : Env)
    (pre suffix : List Nat) (stack : List Bool) (room : stack.length < 128) :
    ∃ count, count ≤ (bytes w).length ∧
      Steps (pre ++ bytes w ++ suffix) slots env count
        ⟨pre.length, stack⟩ ⟨pre.length + (bytes w).length, eval e env :: stack⟩ := by
  induction e generalizing w pre suffix stack with
  | literal b =>
    cases w <;> simp [check] at accepted
    subst_vars
    exact ⟨1, by simp [bytes], by simpa [bytes, eval] using Steps.single (step_literal pre suffix b slots env stack room)⟩
  | input i =>
    cases w <;> simp [check] at accepted
    obtain ⟨rfl, hw⟩ := accepted
    simp only [inScope, decide_eq_true_eq] at scope
    exact ⟨1, by simp [bytes], by simpa [bytes, eval] using (Steps.single
      (step_read pre suffix 3 _ _ i slots env stack room hw (by simp) (by simp [readSlot, scope])))⟩
  | previous i =>
    cases w <;> simp [check] at accepted
    obtain ⟨rfl, hw⟩ := accepted
    simp only [inScope, decide_eq_true_eq] at scope
    exact ⟨1, by simp [bytes], by simpa [bytes, eval] using (Steps.single
      (step_read pre suffix 4 _ _ i slots env stack room hw (by simp) (by simp [readSlot, scope])))⟩
  | next i allowed =>
    cases w <;> simp [check] at accepted
    obtain ⟨rfl, hw⟩ := accepted
    simp only [inScope, Bool.and_eq_true, decide_eq_true_eq] at scope
    exact ⟨1, by simp [bytes], by simpa [bytes, eval] using (Steps.single
      (step_read pre suffix 5 _ _ i slots env stack room hw (by simp) (by simp [readSlot, scope.1, scope.2])))⟩
  | negate e ih =>
    cases w <;> simp [check] at accepted
    rename_i child
    obtain ⟨count, bound, path⟩ := ih child accepted scope pre ([10] ++ suffix) stack room
    have final := Steps.single (step_not (pre ++ bytes child) suffix slots env stack room (eval e env))
    have joined := path.trans (by simpa [List.append_assoc, List.length_append] using final)
    refine ⟨count + 1, ?_, ?_⟩
    · simp only [bytes, List.length_append, List.length_cons, List.length_nil]; omega
    · simpa [bytes, eval, List.append_assoc, List.length_append, Nat.add_assoc] using joined
  | branch c y n ihc ihy ihn =>
    cases w <;> simp only [check, Bool.false_eq_true] at accepted
    rename_i wc fl fh wy jl jh wn
    simp only [Bool.and_eq_true, offsets] at accepted
    obtain ⟨⟨⟨⟨hf, hj⟩, hc⟩, hy⟩, hn⟩ := accepted
    simp only [inScope, Bool.and_eq_true] at scope
    obtain ⟨⟨sc, sy⟩, sn⟩ := scope
    obtain ⟨cc, cb, cp⟩ := ihc wc hc sc pre ([30, fl, fh] ++ bytes wy ++ [31, jl, jh] ++ bytes wn ++ suffix) stack room
    have branchStep := Steps.single (step_conditional (pre ++ bytes wc) (bytes wy) (bytes wn) suffix fl fh jl jh slots env stack (eval c env) hf)
    have first := cp.trans (by simpa [List.append_assoc, List.length_append] using branchStep)
    cases hcond : eval c env with
    | false =>
      obtain ⟨nc, nb, np⟩ := ihn wn hn sn (pre ++ bytes wc ++ [30, fl, fh] ++ bytes wy ++ [31, jl, jh]) suffix stack room
      have joined := first.trans (by simpa [List.append_assoc, List.length_append, hcond, Nat.add_assoc, Nat.add_comm, Nat.add_left_comm] using np)
      refine ⟨cc + 1 + nc, ?_, ?_⟩
      · simp only [bytes, List.length_append, List.length_cons, List.length_nil]; omega
      · simpa [bytes, eval, hcond, List.append_assoc, List.length_append, Nat.add_assoc, Nat.add_comm, Nat.add_left_comm] using joined
    | true =>
      obtain ⟨yc, yb, yp⟩ := ihy wy hy sy (pre ++ bytes wc ++ [30, fl, fh]) ([31, jl, jh] ++ bytes wn ++ suffix) stack room
      have arms := first.trans (by simpa [List.append_assoc, List.length_append, hcond, Nat.add_assoc] using yp)
      have jumpStep := Steps.single (step_jump (pre ++ bytes wc ++ [30, fl, fh] ++ bytes wy) (bytes wn) suffix jl jh slots env (eval y env :: stack) hj (bytes_positive wn))
      have joined := arms.trans (by simpa [List.append_assoc, List.length_append, Nat.add_assoc, Nat.add_comm, Nat.add_left_comm] using jumpStep)
      refine ⟨cc + 1 + yc + 1, ?_, ?_⟩
      · simp only [bytes, List.length_append, List.length_cons, List.length_nil]; omega
      · simpa [bytes, eval, hcond, List.append_assoc, List.length_append, Nat.add_assoc, Nat.add_comm, Nat.add_left_comm] using joined

def execute : Nat → List Nat → Slots → Env → State → Outcome
  | 0, _, _, _, _ => .fault .fuel
  | fuel + 1, code, slots, env, state =>
      match step code slots env state with
      | .next state => execute fuel code slots env state
      | terminal => terminal

theorem steps_execute (path : Steps code slots env count start finish) (remaining : Nat) :
    execute (count + remaining) code slots env start = execute remaining code slots env finish := by
  induction path with
  | zero => simp
  | cons first rest ih =>
    simpa [execute, first, Nat.add_assoc, Nat.add_comm, Nat.add_left_comm] using ih

theorem accepted_execute (e : Expr p) (w : Wire) (accepted : check e w = true)
    (slots : Slots) (scope : inScope e slots = true) (env : Env) :
    execute ((bytes w).length + 1) (bytes w) slots env ⟨0, []⟩ = .done (eval e env) := by
  obtain ⟨count, bound, path⟩ := accepted_steps e w accepted slots scope env [] [] [] (by simp)
  simp only [List.nil_append, List.append_nil, List.length_nil, Nat.zero_add] at path
  have fuel : (bytes w).length + 1 = count + ((bytes w).length - count + 1) := by omega
  rw [fuel, steps_execute path]
  simp [execute, step]

theorem accepted_refinement (e : Expr p) (w : Wire) (accepted : check e w = true)
    (slots : Slots) (scope : inScope e slots = true) (env : Env)
    (stack : List Bool) (room : stack.length + demand w ≤ 128) :
    Executes (bytes w) env stack (eval e env :: stack) ∧
    ∃ count, count ≤ (bytes w).length ∧
      Steps (bytes w) slots env count ⟨0, stack⟩ ⟨(bytes w).length, eval e env :: stack⟩ := by
  constructor
  · exact check_executes e w accepted env stack
  · have room' : stack.length < 128 := by rw [demand_one] at room; omega
    simpa using accepted_steps e w accepted slots scope env [] [] stack room'

#print axioms demand_one
#print axioms accepted_steps
#print axioms accepted_execute
#print axioms accepted_refinement

end BoolTranslation.ByteMachine
