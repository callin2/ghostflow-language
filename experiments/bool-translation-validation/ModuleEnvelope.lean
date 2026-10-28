import DecoderSoundness

namespace BoolTranslation.ModuleEnvelope

open Serialization ByteMachine

deriving instance DecidableEq for Except

structure Module where
  name : List Nat
  states : List (List Nat × Bool)
  transitions : List (Expr false)
  outputs : List (List Nat × Expr true)

def u16 (n : Nat) : List Nat := [n % 256, n / 256 % 256]
def u32 (n : Nat) : List Nat := u16 n ++ u16 (n / 65536)
def string (s : List Nat) : List Nat := u16 s.length ++ s
def blob (b : List Nat) : List Nat := u32 b.length ++ b
def code (e : Expr p) : List Nat := bytes (canonical e)

def letter (n : Nat) : Bool := decide (65 ≤ n ∧ n ≤ 90 ∨ 97 ≤ n ∧ n ≤ 122 ∨ n = 95)
def identifier (s : List Nat) : Bool :=
  decide (0 < s.length ∧ s.length ≤ 128) &&
    match s with
    | [] => false
    | first :: rest => letter first && rest.all (fun n => letter n || decide (48 ≤ n ∧ n ≤ 57))

def branching : Expr p → Bool
  | .branch _ _ _ => true
  | .negate e => branching e
  | _ => false

def format (m : Module) : Nat :=
  if m.transitions.any branching || m.outputs.any (fun o => branching o.2) then 3 else 1

def targets (m : Module) : List Nat := List.range m.states.length
def slots (m : Module) (p : Bool) : Slots := ⟨0, m.states.length, p⟩

def query (m : Module) : List Nat :=
  if m.outputs.isEmpty then [5, 1]
  else m.outputs.flatMap (fun o => [1] ++ string [97, 99, 116, 117, 97, 116, 111, 114] ++
    string o.1 ++ [1]) ++ [2] ++ u16 m.outputs.length

structure Entry (p : Bool) where
  metadata : List Nat
  expression : Expr p

def transitionEntries (m : Module) : List (Entry false) :=
  (targets m).zipWith (fun target e => ⟨u16 target, e⟩) m.transitions
def outputEntries (m : Module) : List (Entry true) :=
  m.outputs.map (fun o => ⟨string o.1 ++ [1], o.2⟩)
def record (e : Entry p) : List Nat := e.metadata ++ blob (code e.expression)
def records (entries : List (Entry p)) : List Nat := entries.flatMap record

def header (m : Module) : List Nat :=
  [71, 70, 66, 49] ++ u16 (format m) ++ string m.name ++ u32 1 ++ u16 0 ++
    u16 m.states.length ++ m.states.flatMap (fun s => string s.1 ++ [1, if s.2 then 1 else 0]) ++
    u16 1 ++ string [99, 111, 110, 116, 114, 111, 108] ++ u32 0 ++ blob (query m) ++
    u16 m.transitions.length

def moduleBytes (m : Module) : List Nat :=
  header m ++ records (transitionEntries m) ++ u16 m.outputs.length ++
    records (outputEntries m) ++ u16 0

def validExpression (m : Module) (p : Bool) (e : Expr p) : Bool :=
  indices e && decide ((code e).length ≤ 4096) && inScope e (slots m p)

def valid (m : Module) : Bool :=
  identifier m.name && m.states.all (fun s => identifier s.1) &&
    m.outputs.all (fun o => identifier o.1) &&
    decide ((m.states.map Prod.fst ++ m.outputs.map Prod.fst).Nodup) &&
    decide (m.states.length ≤ 128 ∧ m.outputs.length ≤ 128 ∧
      m.transitions.length = m.states.length ∧ (query m).length ≤ 4096) &&
    m.transitions.all (validExpression m false) &&
    m.outputs.all (fun o => validExpression m true o.2)

inductive Error where
  | profile | moduleSize
  deriving DecidableEq, Repr

def encodeModule (m : Module) : Except Error (List Nat) :=
  if valid m then
    if (moduleBytes m).length ≤ 1048576 then .ok (moduleBytes m) else .error .moduleSize
  else .error .profile

theorem encoded (m : Module) (raw : List Nat) (h : encodeModule m = .ok raw) :
    valid m = true ∧ raw = moduleBytes m ∧ raw.length ≤ 1048576 := by
  unfold encodeModule at h
  split at h <;> simp_all
  split at h <;> simp_all

-- Every boundary is recomputed from the typed module. No decoded offsets enter this view.
def slices : List (Entry p) → List Nat → List (List Nat)
  | [], _ => []
  | e :: es, raw =>
      ((raw.drop (e.metadata.length + 4)).take (code e.expression).length) ::
        slices es (raw.drop (record e).length)

theorem slices_records (entries : List (Entry p)) (tail : List Nat) :
    slices entries (records entries ++ tail) = entries.map (fun e => code e.expression) := by
  induction entries with
  | nil => rfl
  | cons e es ih =>
    simpa [slices, records, record, blob, u32, u16, List.append_assoc] using ih

def transitionSlices (m : Module) (raw : List Nat) : List (List Nat) :=
  slices (transitionEntries m) (raw.drop (header m).length)
def outputSlices (m : Module) (raw : List Nat) : List (List Nat) :=
  slices (outputEntries m)
    (((raw.drop (header m).length).drop (records (transitionEntries m)).length).drop 2)

theorem section_partition (m : Module) (raw : List Nat) (h : encodeModule m = .ok raw) :
    raw = header m ++ records (transitionEntries m) ++ u16 m.outputs.length ++
      records (outputEntries m) ++ u16 0 := (encoded m raw h).2.1

theorem transition_partition (m : Module) (raw : List Nat) (h : encodeModule m = .ok raw) :
    transitionSlices m raw = (transitionEntries m).map (fun e => code e.expression) := by
  rw [(encoded m raw h).2.1]
  simp [transitionSlices, moduleBytes, List.append_assoc, slices_records]

theorem output_partition (m : Module) (raw : List Nat) (h : encodeModule m = .ok raw) :
    outputSlices m raw = (outputEntries m).map (fun e => code e.expression) := by
  rw [(encoded m raw h).2.1]
  simp [outputSlices, moduleBytes, u16, List.drop_append, List.append_assoc, slices_records]

theorem zip_right (xs : List α) (ys : List β) (h : xs.length = ys.length) :
    xs.zipWith (fun _ y => y) ys = ys := by
  induction xs generalizing ys with
  | nil => simpa using (List.length_eq_zero_iff.mp h.symm).symm
  | cons x xs ih =>
    cases ys with
    | nil => simp at h
    | cons y ys =>
      simp only [List.length_cons, Nat.add_right_cancel_iff] at h
      simp [ih ys h]

theorem entry_expressions (m : Module) (h : valid m = true) :
    (transitionEntries m).map Entry.expression = m.transitions ∧
    (outputEntries m).map Entry.expression = m.outputs.map Prod.snd := by
  have length : m.transitions.length = m.states.length := by
    simp only [valid, Bool.and_eq_true, decide_eq_true_eq] at h
    exact h.1.1.2.2.2.1
  constructor
  · simp only [transitionEntries, targets, List.map_zipWith]
    exact zip_right _ _ (by simpa using length.symm)
  · simp [outputEntries, List.map_map]

theorem expression_valid (m : Module) (e : Expr p) (h : validExpression m p e = true) :
    serialize e = .ok (code e) ∧ inScope e (slots m p) = true := by
  simp only [validExpression, Bool.and_eq_true, decide_eq_true_eq] at h
  exact ⟨serialize_ok e h.1, h.2⟩

def runCodes (codes : List (List Nat)) (s : Slots) (env : Env) : Option (List Bool) :=
  codes.mapM fun c => match execute (c.length + 1) c s env ⟨0, []⟩ with
    | .done value => some value
    | _ => none

theorem run_codes (m : Module) (es : List (Expr p))
    (h : es.all (validExpression m p) = true) (env : Env) :
    runCodes (es.map code) (slots m p) env = some (evalList es env) := by
  induction es with
  | nil => rfl
  | cons e es ih =>
    simp only [List.all_cons, Bool.and_eq_true] at h
    obtain ⟨serialized, scope⟩ := expression_valid m e h.1
    have execution := serialized_execute e (code e) serialized (slots m p) scope env
    have tail := ih h.2
    simp only [runCodes, evalList] at tail
    simp [runCodes, evalList, execution, tail]

theorem recover_codes (m : Module) (es : List (Expr p))
    (h : es.all (validExpression m p) = true) :
    (es.map code).mapM (Serialization.decode p) = some es := by
  induction es with
  | nil => rfl
  | cons e es ih =>
    simp only [List.all_cons, Bool.and_eq_true] at h
    have recovered := serialize_recovery e (code e) (expression_valid m e h.1).1
    simp [recovered, ih h.2]

theorem source_partitions (m : Module) (raw : List Nat) (h : encodeModule m = .ok raw) :
    transitionSlices m raw = m.transitions.map code ∧
    outputSlices m raw = (m.outputs.map Prod.snd).map code := by
  obtain ⟨ht, ho⟩ := entry_expressions m (encoded m raw h).1
  constructor
  · rw [transition_partition m raw h, ← ht, List.map_map]; rfl
  · rw [output_partition m raw h, ← ho, List.map_map]; rfl

theorem valid_lists (m : Module) (h : valid m = true) :
    m.transitions.all (validExpression m false) = true ∧
    (m.outputs.map Prod.snd).all (validExpression m true) = true := by
  simp only [valid, Bool.and_eq_true] at h
  exact ⟨h.1.2, by simpa using h.2⟩

theorem recovered_module (m : Module) (raw : List Nat) (h : encodeModule m = .ok raw) :
    (transitionSlices m raw).mapM (Serialization.decode false) = some m.transitions ∧
    (outputSlices m raw).mapM (Serialization.decode true) = some (m.outputs.map Prod.snd) := by
  obtain ⟨ht, ho⟩ := source_partitions m raw h
  obtain ⟨vt, vo⟩ := valid_lists m (encoded m raw h).1
  rw [ht, ho]
  exact ⟨recover_codes m _ vt, recover_codes m _ vo⟩

def rawTick (m : Module) (raw : List Nat) (env : Env) : Option (List Bool × List Bool) := do
  let values ← runCodes (transitionSlices m raw) (slots m false) env
  let outputEnv := { env with next := updated env.previous (targets m) values }
  let requests ← runCodes (outputSlices m raw) (slots m true) outputEnv
  pure (values, requests)

theorem module_tick (m : Module) (raw : List Nat) (h : encodeModule m = .ok raw) (env : Env) :
    rawTick m raw env = some (sourceTick m.transitions (targets m) (m.outputs.map Prod.snd) env) := by
  obtain ⟨ht, ho⟩ := source_partitions m raw h
  obtain ⟨vt, vo⟩ := valid_lists m (encoded m raw h).1
  simp only [rawTick, sourceTick, ht, ho, run_codes m _ vt, run_codes m _ vo, Option.bind_some]
  rfl

#print axioms section_partition
#print axioms source_partitions
#print axioms recovered_module
#print axioms module_tick

end BoolTranslation.ModuleEnvelope
