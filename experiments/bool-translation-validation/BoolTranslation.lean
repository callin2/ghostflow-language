import Std

namespace BoolTranslation

inductive Expr (allowNext : Bool) where
  | literal (value : Bool)
  | input (index : Nat)
  | previous (index : Nat)
  | next (index : Nat) (allowed : allowNext = true)
  | negate (value : Expr allowNext)
  | branch (condition yes no : Expr allowNext)
  deriving Repr

structure Env where
  inputs : Nat → Bool
  previous : Nat → Bool
  next : Nat → Bool

def eval : Expr p → Env → Bool
  | .literal b, _ => b
  | .input i, env => env.inputs i
  | .previous i, env => env.previous i
  | .next i _, env => env.next i
  | .negate a, env => !(eval a env)
  | .branch c y n, env => if eval c env then eval y env else eval n env

def conjunction (a b : Expr p) : Expr p := .branch a b (.literal false)
def disjunction (a b : Expr p) : Expr p := .branch a (.literal true) b

theorem conjunction_eval (a b : Expr p) (env : Env) :
    eval (conjunction a b) env = (eval a env && eval b env) := by
  cases h : eval a env <;> simp [conjunction, eval, h]

theorem disjunction_eval (a b : Expr p) (env : Env) :
    eval (disjunction a b) env = (eval a env || eval b env) := by
  cases h : eval a env <;> simp [disjunction, eval, h]

inductive Wire where
  | literal (raw : Nat)
  | read (opcode low high : Nat)
  | negate (value : Wire)
  | branch (condition : Wire) (falseLow falseHigh : Nat) (yes : Wire)
      (jumpLow jumpHigh : Nat) (no : Wire)
  deriving Repr

def bytes : Wire → List Nat
  | .literal raw => [1, raw]
  | .read op lo hi => [op, lo, hi]
  | .negate value => bytes value ++ [10]
  | .branch c fl fh y jl jh n =>
      bytes c ++ [30, fl, fh] ++ bytes y ++ [31, jl, jh] ++ bytes n

def word (lo hi value : Nat) : Bool :=
  decide (lo < 256 ∧ hi < 256 ∧ lo + 256 * hi = value)

def offsets (fl fh : Nat) (yes : Wire) (jl jh : Nat) (no : Wire) : Bool :=
  word fl fh ((bytes yes).length + 3) && word jl jh (bytes no).length

def check : Expr p → Wire → Bool
  | .literal b, .literal raw => decide (raw = if b then 1 else 0)
  | .input i, .read op lo hi => decide (op = 3) && word lo hi i
  | .previous i, .read op lo hi => decide (op = 4) && word lo hi i
  | .next i _, .read op lo hi => decide (op = 5) && word lo hi i
  | .negate a, .negate w => check a w
  | .branch c y n, .branch wc fl fh wy jl jh wn =>
      offsets fl fh wy jl jh wn && check c wc && check y wy && check n wn
  | _, _ => false

def run : Wire → Env → Option Bool
  | .literal raw, _ => if raw = 0 then some false else if raw = 1 then some true else none
  | .read op lo hi, env =>
      if lo < 256 ∧ hi < 256 then
        if op = 3 then some (env.inputs (lo + 256 * hi))
        else if op = 4 then some (env.previous (lo + 256 * hi))
        else if op = 5 then some (env.next (lo + 256 * hi)) else none
      else none
  | .negate w, env => (run w env).map Bool.not
  | .branch c fl fh y jl jh n, env =>
      if offsets fl fh y jl jh n then
        (run c env).bind fun b => if b then run y env else run n env
      else none

theorem check_run (e : Expr p) (w : Wire) (accepted : check e w = true) (env : Env) :
    run w env = some (eval e env) := by
  induction e generalizing w with
  | literal b =>
    cases w <;> simp [check] at accepted
    subst_vars
    cases b <;> rfl
  | input i =>
    cases w <;> simp [check, word] at accepted
    obtain ⟨rfl, hlo, hhi, hindex⟩ := accepted
    simp [run, hlo, hhi, hindex, eval]
  | previous i =>
    cases w <;> simp [check, word] at accepted
    obtain ⟨rfl, hlo, hhi, hindex⟩ := accepted
    simp [run, hlo, hhi, hindex, eval]
  | next i allowed =>
    cases w <;> simp [check, word] at accepted
    obtain ⟨rfl, hlo, hhi, hindex⟩ := accepted
    simp [run, hlo, hhi, hindex, eval]
  | negate a ih =>
    cases w <;> simp [check] at accepted
    simp [run, eval, ih _ accepted]
  | branch c y n ihc ihy ihn =>
    cases w <;> simp only [check, Bool.false_eq_true] at accepted
    rename_i wc fl fh wy jl jh wn
    simp only [Bool.and_eq_true] at accepted
    obtain ⟨⟨⟨hoff, hc⟩, hy⟩, hn⟩ := accepted
    cases hb : eval c env <;> simp [run, hoff, ihc _ hc, ihy _ hy, ihn _ hn, eval, hb]

inductive Executes : List Nat → Env → List Bool → List Bool → Prop where
  | literal (b : Bool) : Executes [1, if b then 1 else 0] env stack (b :: stack)
  | input (h : word lo hi i = true) : Executes [3, lo, hi] env stack (env.inputs i :: stack)
  | previous (h : word lo hi i = true) : Executes [4, lo, hi] env stack (env.previous i :: stack)
  | next (h : word lo hi i = true) : Executes [5, lo, hi] env stack (env.next i :: stack)
  | negate (h : Executes code env stack (b :: stack)) :
      Executes (code ++ [10]) env stack ((!b) :: stack)
  | branchTrue (hc : Executes c env stack (true :: stack))
      (hy : Executes y env stack (value :: stack))
      (hf : word fl fh (y.length + 3) = true) (hj : word jl jh n.length = true) :
      Executes (c ++ [30, fl, fh] ++ y ++ [31, jl, jh] ++ n) env stack (value :: stack)
  | branchFalse (hc : Executes c env stack (false :: stack))
      (hn : Executes n env stack (value :: stack))
      (hf : word fl fh (y.length + 3) = true) (hj : word jl jh n.length = true) :
      Executes (c ++ [30, fl, fh] ++ y ++ [31, jl, jh] ++ n) env stack (value :: stack)

theorem check_executes (e : Expr p) (w : Wire) (accepted : check e w = true)
    (env : Env) (stack : List Bool) :
    Executes (bytes w) env stack (eval e env :: stack) := by
  induction e generalizing w with
  | literal b =>
    cases w <;> simp [check] at accepted
    subst_vars
    exact Executes.literal b
  | input i =>
    cases w <;> simp [check] at accepted
    obtain ⟨rfl, hw⟩ := accepted
    exact Executes.input hw
  | previous i =>
    cases w <;> simp [check] at accepted
    obtain ⟨rfl, hw⟩ := accepted
    exact Executes.previous hw
  | next i allowed =>
    cases w <;> simp [check] at accepted
    obtain ⟨rfl, hw⟩ := accepted
    exact Executes.next hw
  | negate a ih =>
    cases w <;> simp [check] at accepted
    exact Executes.negate (ih _ accepted)
  | branch c y n ihc ihy ihn =>
    cases w <;> simp only [check, Bool.false_eq_true] at accepted
    rename_i wc fl fh wy jl jh wn
    simp only [Bool.and_eq_true, offsets] at accepted
    obtain ⟨⟨⟨⟨hf, hj⟩, hc⟩, hy⟩, hn⟩ := accepted
    have cond := ihc wc hc
    cases hb : eval c env
    · rw [hb] at cond
      simpa [bytes, eval, hb] using Executes.branchFalse cond (ihn wn hn) hf hj
    · rw [hb] at cond
      simpa [bytes, eval, hb] using Executes.branchTrue cond (ihy wy hy) hf hj

def checkList : List (Expr p) → List Wire → Bool
  | [], [] => true
  | e :: es, w :: ws => check e w && checkList es ws
  | _, _ => false

def evalList (es : List (Expr p)) (env : Env) : List Bool := es.map (fun e => eval e env)
def runList (ws : List Wire) (env : Env) : Option (List Bool) := ws.mapM (fun w => run w env)

theorem check_list (es : List (Expr p)) (ws : List Wire)
    (accepted : checkList es ws = true) (env : Env) :
    runList ws env = some (evalList es env) := by
  induction es generalizing ws with
  | nil => cases ws <;> simp_all [checkList, runList, evalList]
  | cons e es ih =>
    cases ws with
    | nil => simp [checkList] at accepted
    | cons w ws =>
      simp only [checkList, Bool.and_eq_true] at accepted
      have tail := ih ws accepted.2
      simp only [runList] at tail ⊢
      simp [List.mapM_cons, check_run e w accepted.1 env, tail, evalList]

def updated (old : Nat → Bool) (targets : List Nat) (values : List Bool) (i : Nat) : Bool :=
  match (targets.zip values).lookup i with
  | some b => b
  | none => old i

def sourceTick (transitions : List (Expr false)) (targets : List Nat)
    (outputs : List (Expr true)) (env : Env) : List Bool × List Bool :=
  let values := evalList transitions env
  let outputEnv := { env with next := updated env.previous targets values }
  (values, evalList outputs outputEnv)

def byteTick (transitions : List Wire) (targets : List Nat)
    (outputs : List Wire) (env : Env) : Option (List Bool × List Bool) := do
  let values ← runList transitions env
  let outputEnv := { env with next := updated env.previous targets values }
  let requests ← runList outputs outputEnv
  pure (values, requests)

theorem simultaneous_tick (ts : List (Expr false)) (tw : List Wire)
    (os : List (Expr true)) (ow : List Wire) (targets : List Nat)
    (ht : checkList ts tw = true) (ho : checkList os ow = true) (env : Env) :
    byteTick tw targets ow env = some (sourceTick ts targets os env) := by
  simp [byteTick, sourceTick, check_list ts tw ht env,
    check_list os ow ho]

theorem transition_ignores_candidate (e : Expr false) (env : Env) (other : Nat → Bool) :
    eval e { env with next := other } = eval e env := by
  induction e with
  | next i impossible => cases impossible
  | literal b => rfl
  | input i => rfl
  | previous i => rfl
  | negate a ih => simp [eval, ih]
  | branch c y n ihc ihy ihn => simp [eval, ihc, ihy, ihn]

#print axioms check_run
#print axioms check_executes
#print axioms simultaneous_tick
#print axioms transition_ignores_candidate

end BoolTranslation
