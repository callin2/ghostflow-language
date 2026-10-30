import Std

namespace CompilerSafety

inductive Constraint where
  | requires (target : String) (dependency : String)
  | requiresAny (target : String) (dependencies : List String)
  | mutex (names : List String)
  deriving DecidableEq, Repr

inductive Value where
  | boolean (value : Bool)
  | opaque (bits : Nat)
  deriving DecidableEq, Repr

abbrev Values := String → Option Value
abbrev Faults := String → Bool

def on (values : Values) (name : String) : Bool :=
  match values name with
  | some (.boolean true) => true
  | _ => false

def blockedNames (c : Constraint) (values : Values) : List String :=
  match c with
  | .requires target dependency =>
    if on values target && !on values dependency then [target] else []
  | .requiresAny target dependencies =>
    if on values target && !(dependencies.any (on values)) then [target] else []
  | .mutex names =>
    let active := names.filter (on values)
    if active.length > 1 then active else []

def faultName : Constraint → String
  | .requires target dependency => "requires:" ++ target ++ ":" ++ dependency
  | .requiresAny target dependencies =>
    "requires:" ++ target ++ ":" ++ String.intercalate "|" dependencies
  | .mutex names => "mutex:" ++ String.intercalate "," names

structure Effect where
  blocked : String → Bool
  faults : Faults
  changed : Bool

def emptyEffect : Effect := ⟨fun _ => false, fun _ => false, false⟩

def merge (a b : Effect) : Effect :=
  ⟨fun n => a.blocked n || b.blocked n,
   fun f => a.faults f || b.faults f, a.changed || b.changed⟩

def effect (c : Constraint) (values : Values) : Effect :=
  let blocked := blockedNames c values
  let changed := !blocked.isEmpty
  ⟨fun n => blocked.contains n, fun f => changed && decide (f = faultName c), changed⟩

def collect : List Constraint → Values → Effect
  | [], _ => emptyEffect
  | c :: cs, values => merge (effect c values) (collect cs values)

theorem merge_duplicate (a b : Effect) : merge a (merge a b) = merge a b := by
  cases a with
  | mk ab af ac =>
    cases b with
    | mk bb bf bc =>
      simp only [merge, Effect.mk.injEq]
      constructor
      · funext n
        cases ab n <;> simp
      constructor
      · funext f
        cases af f <;> simp
      · cases ac <;> simp

theorem collect_duplicate (c : Constraint) (cs : List Constraint) (v : Values) :
    collect (c :: c :: cs) v = collect (c :: cs) v := by
  exact merge_duplicate (effect c v) (collect cs v)

def check : List Constraint → List Constraint → Bool
  | [], [] => true
  | [], _ :: _ => false
  | _ :: _, [] => false
  | a :: rest, b :: tail =>
    decide (a = b) && (check rest tail ||
      match rest with
      | [] => false
      | next :: _ => decide (a = next) && check rest (b :: tail))

theorem check_collect (original compiled : List Constraint)
    (accepted : check original compiled = true) (values : Values) :
    collect original values = collect compiled values := by
  induction original generalizing compiled with
  | nil =>
    cases compiled with
    | nil => rfl
    | cons b tail => simp [check] at accepted
  | cons a rest ih =>
    cases compiled with
    | nil => simp [check] at accepted
    | cons b tail =>
      simp only [check, Bool.and_eq_true, decide_eq_true_eq, Bool.or_eq_true] at accepted
      obtain ⟨same, kept | removed⟩ := accepted
      · subst b
        exact congrArg (merge (effect a values)) (ih tail kept)
      · subst b
        cases rest with
        | nil => simp at removed
        | cons next remaining =>
          simp only [Bool.and_eq_true, decide_eq_true_eq] at removed
          obtain ⟨sameNext, valid⟩ := removed
          subst next
          exact (collect_duplicate a remaining values).trans (ih (a :: tail) valid)

structure SafetyState where
  values : Values
  faults : Faults

def update (s : SafetyState) (e : Effect) : SafetyState :=
  ⟨fun n => if e.blocked n then some (.boolean false) else s.values n,
   fun f => s.faults f || e.faults f⟩

def run : Nat → List Constraint → SafetyState → SafetyState
  | 0, _, s => s
  | rounds + 1, constraints, s =>
    let e := collect constraints s.values
    if e.changed then run rounds constraints (update s e)
    else update s e

theorem check_run (original compiled : List Constraint)
    (accepted : check original compiled = true) (rounds : Nat) (initial : SafetyState) :
    run rounds original initial = run rounds compiled initial := by
  induction rounds generalizing initial with
  | zero => rfl
  | succ rounds ih =>
    simp only [run]
    rw [check_collect original compiled accepted initial.values]
    split
    · exact ih _
    · rfl

theorem check_safe_values (original compiled : List Constraint)
    (accepted : check original compiled = true) (rounds : Nat) (initial : SafetyState) :
    (run rounds original initial).values = (run rounds compiled initial).values :=
  congrArg SafetyState.values (check_run original compiled accepted rounds initial)

theorem check_faults (original compiled : List Constraint)
    (accepted : check original compiled = true) (rounds : Nat) (initial : SafetyState) :
    (run rounds original initial).faults = (run rounds compiled initial).faults :=
  congrArg SafetyState.faults (check_run original compiled accepted rounds initial)

example : check [.requires "a" "b", .requires "a" "b", .requires "b" "c"]
    [.requires "a" "b", .requires "b" "c"] = true := by decide

example : check [.requires "a" "b", .requires "a" "b"]
    [.requires "a" "c"] = false := by decide

#print axioms check_run

end CompilerSafety
