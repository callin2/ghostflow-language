import ByteMachine

namespace BoolTranslation.Serialization

def low (n : Nat) : Nat := n % 256
def high (n : Nat) : Nat := n / 256

theorem word_encode (n : Nat) (bound : n < 65536) :
    word (low n) (high n) n = true := by
  simp only [word, decide_eq_true_eq, low, high]
  omega

theorem word_unique (lo hi n : Nat) (h : word lo hi n = true) :
    lo = low n ∧ hi = high n ∧ n < 65536 := by
  simp only [word, decide_eq_true_eq] at h
  simp only [low, high]
  omega

def canonical : Expr p → Wire
  | .literal b => .literal (if b then 1 else 0)
  | .input i => .read 3 (low i) (high i)
  | .previous i => .read 4 (low i) (high i)
  | .next i _ => .read 5 (low i) (high i)
  | .negate e => .negate (canonical e)
  | .branch c y n =>
      let wy := canonical y
      let wn := canonical n
      .branch (canonical c) (low ((bytes wy).length + 3))
        (high ((bytes wy).length + 3)) wy
        (low (bytes wn).length) (high (bytes wn).length) wn

def indices : Expr p → Bool
  | .literal _ => true
  | .input i | .previous i | .next i _ => decide (i < 65536)
  | .negate e => indices e
  | .branch c y n => indices c && indices y && indices n

-- Representability is a byte-format bound, separate from module slot scope.
def representable (e : Expr p) : Prop :=
  indices e = true ∧ (bytes (canonical e)).length ≤ 4096

inductive SerializeError where
  | indexRange | expressionSize
  deriving DecidableEq, Repr

def serialize (e : Expr p) : Except SerializeError (List Nat) :=
  if indices e then
    let code := bytes (canonical e)
    if code.length ≤ 4096 then .ok code else .error .expressionSize
  else .error .indexRange

theorem serialize_ok (e : Expr p) (h : representable e) :
    serialize e = .ok (bytes (canonical e)) := by
  simp [serialize, h.1, h.2]

theorem serialize_iff (e : Expr p) (code : List Nat) :
    serialize e = .ok code ↔ representable e ∧ code = bytes (canonical e) := by
  unfold serialize representable
  split <;> rename_i h
  · dsimp only
    split <;> simp_all
    · exact eq_comm
    · omega
  · simp_all

theorem accepted_canonical (e : Expr p) (w : Wire) (accepted : check e w = true) :
    w = canonical e := by
  induction e generalizing w with
  | literal b =>
    cases w <;> simp [check] at accepted
    subst_vars; rfl
  | input i =>
    cases w <;> simp [check] at accepted
    obtain ⟨rfl, hw⟩ := accepted
    obtain ⟨rfl, rfl, _⟩ := word_unique _ _ _ hw
    rfl
  | previous i =>
    cases w <;> simp [check] at accepted
    obtain ⟨rfl, hw⟩ := accepted
    obtain ⟨rfl, rfl, _⟩ := word_unique _ _ _ hw
    rfl
  | next i allowed =>
    cases w <;> simp [check] at accepted
    obtain ⟨rfl, hw⟩ := accepted
    obtain ⟨rfl, rfl, _⟩ := word_unique _ _ _ hw
    rfl
  | negate e ih =>
    cases w <;> simp [check] at accepted
    simp [canonical, ih _ accepted]
  | branch c y n ihc ihy ihn =>
    cases w <;> simp only [check, Bool.false_eq_true] at accepted
    rename_i wc fl fh wy jl jh wn
    simp only [Bool.and_eq_true, offsets] at accepted
    obtain ⟨⟨⟨⟨hf, hj⟩, hc⟩, hy⟩, hn⟩ := accepted
    obtain rfl := ihc _ hc
    obtain rfl := ihy _ hy
    obtain rfl := ihn _ hn
    obtain ⟨rfl, rfl, _⟩ := word_unique _ _ _ hf
    obtain ⟨rfl, rfl, _⟩ := word_unique _ _ _ hj
    rfl

theorem accepted_indices (e : Expr p) (w : Wire) (accepted : check e w = true) :
    indices e = true := by
  induction e generalizing w with
  | literal b => rfl
  | input i =>
    cases w <;> simp [check] at accepted
    simpa [indices] using (word_unique _ _ _ accepted.2).2.2
  | previous i =>
    cases w <;> simp [check] at accepted
    simpa [indices] using (word_unique _ _ _ accepted.2).2.2
  | next i allowed =>
    cases w <;> simp [check] at accepted
    simpa [indices] using (word_unique _ _ _ accepted.2).2.2
  | negate e ih =>
    cases w <;> simp [check] at accepted
    exact ih _ accepted
  | branch c y n ihc ihy ihn =>
    cases w <;> simp only [check, Bool.false_eq_true] at accepted
    simp only [Bool.and_eq_true] at accepted
    obtain ⟨⟨⟨_, hc⟩, hy⟩, hn⟩ := accepted
    simp [indices, ihc _ hc, ihy _ hy, ihn _ hn]

theorem accepted_serialized (e : Expr p) (w : Wire) (accepted : check e w = true)
    (size : (bytes w).length ≤ 4096) : serialize e = .ok (bytes w) := by
  have hi := accepted_indices e w accepted
  have eq := accepted_canonical e w accepted
  subst w
  exact serialize_ok e ⟨hi, size⟩

theorem accepted_bytes (e : Expr p) (w : Wire) (accepted : check e w = true) :
    ∀ b ∈ bytes w, b < 256 := by
  induction e generalizing w with
  | literal b =>
    cases w <;> simp [check] at accepted
    subst_vars
    cases b <;> simp [bytes]
  | input i =>
    cases w <;> simp [check, word] at accepted
    obtain ⟨rfl, hlo, hhi, _⟩ := accepted
    simp [bytes, hlo, hhi]
  | previous i =>
    cases w <;> simp [check, word] at accepted
    obtain ⟨rfl, hlo, hhi, _⟩ := accepted
    simp [bytes, hlo, hhi]
  | next i allowed =>
    cases w <;> simp [check, word] at accepted
    obtain ⟨rfl, hlo, hhi, _⟩ := accepted
    simp [bytes, hlo, hhi]
  | negate e ih =>
    cases w <;> simp [check] at accepted
    intro b hb
    simp only [bytes, List.mem_append, List.mem_singleton] at hb
    rcases hb with hb | rfl
    · exact ih _ accepted b hb
    · decide
  | branch c y n ihc ihy ihn =>
    cases w <;> simp only [check, Bool.false_eq_true] at accepted
    simp only [Bool.and_eq_true, offsets, word, decide_eq_true_eq] at accepted
    obtain ⟨⟨⟨⟨⟨hfl, hfh, _⟩, hjl, hjh, _⟩, hc⟩, hy⟩, hn⟩ := accepted
    intro b hb
    simp only [bytes, List.mem_append, List.mem_cons, List.mem_singleton,
      List.not_mem_nil, or_false] at hb
    rcases hb with (((hb | (rfl | rfl | rfl)) | hb) | (rfl | rfl | rfl)) | hb
    all_goals first | assumption | decide | exact ihc _ hc b hb |
      exact ihy _ hy b hb | exact ihn _ hn b hb

theorem canonical_accepted (e : Expr p) (h : representable e) :
    check e (canonical e) = true := by
  induction e with
  | literal b => simp [canonical, check]
  | input i =>
    exact by simpa [canonical, check] using word_encode i (by simpa [indices] using h.1)
  | previous i =>
    exact by simpa [canonical, check] using word_encode i (by simpa [indices] using h.1)
  | next i allowed =>
    exact by simpa [canonical, check] using word_encode i (by simpa [indices] using h.1)
  | negate e ih =>
    have he : representable e := by
      refine ⟨h.1, ?_⟩
      have := h.2
      simp only [canonical, bytes, List.length_append, List.length_cons, List.length_nil] at this
      omega
    exact ih he
  | branch c y n ihc ihy ihn =>
    have hi := h.1
    simp only [indices, Bool.and_eq_true] at hi
    have hs := h.2
    simp only [canonical, bytes, List.length_append, List.length_cons, List.length_nil] at hs
    have hc := ihc ⟨hi.1.1, by omega⟩
    have hy := ihy ⟨hi.1.2, by omega⟩
    have hn := ihn ⟨hi.2, by omega⟩
    have hf := word_encode ((bytes (canonical y)).length + 3) (by omega)
    have hj := word_encode (bytes (canonical n)).length (by omega)
    simp [canonical, check, offsets, hc, hy, hn, hf, hj]

theorem serialized_bytes (e : Expr p) (code : List Nat) (encoded : serialize e = .ok code) :
    0 < code.length ∧ code.length ≤ 4096 ∧ ∀ b ∈ code, b < 256 := by
  obtain ⟨h, rfl⟩ := (serialize_iff e code).mp encoded
  exact ⟨ByteMachine.bytes_positive _, h.2, accepted_bytes e _ (canonical_accepted e h)⟩

theorem branch_offsets_positive (c y n : Expr p) (h : representable (.branch c y n)) :
    0 < (bytes (canonical y)).length + 3 ∧
    (bytes (canonical y)).length + 3 < 65536 ∧
    0 < (bytes (canonical n)).length ∧ (bytes (canonical n)).length < 65536 := by
  have hs := h.2
  have hn := ByteMachine.bytes_positive (canonical n)
  simp only [canonical, bytes, List.length_append, List.length_cons, List.length_nil] at hs
  omega

theorem serialized_refinement (e : Expr p) (code : List Nat)
    (encoded : serialize e = .ok code) (slots : ByteMachine.Slots)
    (scope : ByteMachine.inScope e slots = true) (env : Env)
    (stack : List Bool) (room : stack.length < 128) :
    Executes code env stack (eval e env :: stack) ∧
    ∃ count, count ≤ code.length ∧ ByteMachine.Steps code slots env count
      ⟨0, stack⟩ ⟨code.length, eval e env :: stack⟩ := by
  obtain ⟨h, rfl⟩ := (serialize_iff e code).mp encoded
  exact ByteMachine.accepted_refinement e (canonical e) (canonical_accepted e h)
    slots scope env stack (by rw [ByteMachine.demand_one]; omega)

theorem serialized_execute (e : Expr p) (code : List Nat)
    (encoded : serialize e = .ok code) (slots : ByteMachine.Slots)
    (scope : ByteMachine.inScope e slots = true) (env : Env) :
    ByteMachine.execute (code.length + 1) code slots env ⟨0, []⟩ = .done (eval e env) := by
  obtain ⟨h, rfl⟩ := (serialize_iff e code).mp encoded
  exact ByteMachine.accepted_execute e (canonical e) (canonical_accepted e h) slots scope env

-- The parser sees only opcodes and a stack built from earlier bytes. Branch
-- arms are delimited by the encoded offsets, and each arm must yield one Expr.
def scan (p : Bool) (code : List Nat) (stack : List (Expr p)) : Option (List (Expr p)) :=
  match code with
  | [] => some stack
  | 1 :: b :: rest =>
      if b = 0 then scan p rest (.literal false :: stack)
      else if b = 1 then scan p rest (.literal true :: stack) else none
  | 3 :: lo :: hi :: rest =>
      if lo < 256 ∧ hi < 256 then scan p rest (.input (lo + 256 * hi) :: stack) else none
  | 4 :: lo :: hi :: rest =>
      if lo < 256 ∧ hi < 256 then scan p rest (.previous (lo + 256 * hi) :: stack) else none
  | 5 :: lo :: hi :: rest =>
      if lo < 256 ∧ hi < 256 then
        if hp : p = true then scan p rest (.next (lo + 256 * hi) hp :: stack) else none
      else none
  | 10 :: rest =>
      match stack with
      | e :: stack => scan p rest (.negate e :: stack)
      | [] => none
  | 30 :: fl :: fh :: rest =>
      match stack with
      | c :: stack =>
          let offset := fl + 256 * fh
          if fl < 256 ∧ fh < 256 ∧ 3 ≤ offset then
            let yes := rest.take (offset - 3)
            match _htail : rest.drop (offset - 3) with
            | 31 :: jl :: jh :: body =>
                let count := jl + 256 * jh
                if jl < 256 ∧ jh < 256 ∧ count ≤ body.length then
                  match scan p yes [], scan p (body.take count) [] with
                  | some [y], some [n] => scan p (body.drop count) (.branch c y n :: stack)
                  | _, _ => none
                else none
            | _ => none
          else none
      | [] => none
  | _ => none
termination_by code.length
decreasing_by
  all_goals simp_all only [List.length_cons, List.length_nil, List.length_take,
    List.length_drop]
  all_goals first | omega | {
    have hh := congrArg List.length _htail
    simp only [List.length_cons, List.length_drop] at hh
    omega }

def decode (p : Bool) (code : List Nat) : Option (Expr p) :=
  if code.length ≤ 4096 then
    match scan p code [] with
    | some [e] => some e
    | _ => none
  else none

theorem decode_full_consumption (p : Bool) (code : List Nat) (e : Expr p)
    (decoded : decode p code = some e) :
    code.length ≤ 4096 ∧ scan p code [] = some [e] := by
  unfold decode at decoded
  split at decoded
  · rename_i size
    split at decoded <;> simp_all
  · contradiction

theorem scan_nil (p : Bool) (stack : List (Expr p)) : scan p [] stack = some stack := by
  rw [scan]

theorem scan_literal (b : Bool) (tail : List Nat) (stack : List (Expr p)) :
    scan p ([1, if b then 1 else 0] ++ tail) stack = scan p tail (.literal b :: stack) := by
  cases b <;> rw [scan.eq_def] <;> simp

theorem scan_read (i : Nat) (bound : i < 65536) (tail : List Nat) (stack : List (Expr p)) :
    scan p ([3, low i, high i] ++ tail) stack = scan p tail (.input i :: stack) ∧
    scan p ([4, low i, high i] ++ tail) stack = scan p tail (.previous i :: stack) := by
  have h := word_encode i bound
  simp only [word, decide_eq_true_eq] at h
  constructor <;> rw [scan.eq_def] <;> simp [h.1, h.2.1, h.2.2]

theorem scan_next (i : Nat) (bound : i < 65536) (allowed : p = true)
    (tail : List Nat) (stack : List (Expr p)) :
    scan p ([5, low i, high i] ++ tail) stack = scan p tail (.next i allowed :: stack) := by
  have h := word_encode i bound
  simp only [word, decide_eq_true_eq] at h
  rw [scan.eq_def]
  simp [h.1, h.2.1, h.2.2, allowed]

theorem scan_not (e : Expr p) (tail : List Nat) (stack : List (Expr p)) :
    scan p (10 :: tail) (e :: stack) = scan p tail (.negate e :: stack) := by
  rw [scan]

theorem scan_branch (c y n : Expr p) (yes no tail : List Nat) (stack : List (Expr p))
    (yesBound : yes.length + 3 < 65536) (noBound : no.length < 65536)
    (hy : scan p yes [] = some [y]) (hn : scan p no [] = some [n]) :
    scan p ([30, low (yes.length + 3), high (yes.length + 3)] ++ yes ++
      [31, low no.length, high no.length] ++ no ++ tail) (c :: stack) =
      scan p tail (.branch c y n :: stack) := by
  have hf := word_encode (yes.length + 3) yesBound
  have hj := word_encode no.length noBound
  simp only [word, decide_eq_true_eq] at hf hj
  rw [scan.eq_def]
  simp [List.append_assoc, hf.1, hf.2.1, hf.2.2, hj.1, hj.2.1, hj.2.2, hy, hn]
  rw [hf.2.2, Nat.add_sub_cancel, List.drop_left]
  simp [hj.1, hj.2.1, hj.2.2, hy, hn]

theorem scan_canonical (e : Expr p) (h : representable e)
    (tail : List Nat) (stack : List (Expr p)) :
    scan p (bytes (canonical e) ++ tail) stack = scan p tail (e :: stack) := by
  induction e generalizing tail stack with
  | literal b => exact scan_literal b tail stack
  | input i => exact (scan_read i (by simpa [indices] using h.1) tail stack).1
  | previous i => exact (scan_read i (by simpa [indices] using h.1) tail stack).2
  | next i allowed => exact scan_next i (by simpa [indices] using h.1) allowed tail stack
  | negate e ih =>
    have he : representable e := by
      refine ⟨h.1, ?_⟩
      have := h.2
      simp only [canonical, bytes, List.length_append, List.length_cons, List.length_nil] at this
      omega
    simpa only [canonical, bytes, List.append_assoc] using
      (ih he ([10] ++ tail) stack).trans (scan_not e tail stack)
  | branch c y n ihc ihy ihn =>
    have hi := h.1
    simp only [indices, Bool.and_eq_true] at hi
    have hs := h.2
    simp only [canonical, bytes, List.length_append, List.length_cons, List.length_nil] at hs
    have hc : representable c := ⟨hi.1.1, by omega⟩
    have hy : representable y := ⟨hi.1.2, by omega⟩
    have hn : representable n := ⟨hi.2, by omega⟩
    have sy : scan p (bytes (canonical y)) [] = some [y] := by
      simpa only [List.append_nil, scan_nil] using ihy hy [] []
    have sn : scan p (bytes (canonical n)) [] = some [n] := by
      simpa only [List.append_nil, scan_nil] using ihn hn [] []
    simp only [canonical, bytes, List.append_assoc]
    rw [ihc hc]
    simpa only [List.append_assoc] using
      scan_branch c y n (bytes (canonical y)) (bytes (canonical n)) tail stack
        (by omega) (by omega) sy sn

theorem serialize_recovery (e : Expr p) (code : List Nat)
    (encoded : serialize e = .ok code) : decode p code = some e := by
  obtain ⟨h, rfl⟩ := (serialize_iff e code).mp encoded
  have recovered : scan p (bytes (canonical e)) [] = some [e] := by
    simpa only [List.append_nil, scan_nil] using scan_canonical e h [] []
  simp [decode, h.2, recovered]

#print axioms accepted_serialized
#print axioms serialize_recovery
#print axioms serialized_bytes
#print axioms decode_full_consumption
#print axioms serialized_refinement
#print axioms serialized_execute

end BoolTranslation.Serialization
