import Serializer

namespace BoolTranslation.Serialization

def stackBytes : List (Expr p) → List Nat
  | [] => []
  | e :: rest => stackBytes rest ++ bytes (canonical e)

def stackValid (stack : List (Expr p)) : Prop := ∀ e ∈ stack, indices e = true

theorem stackValid_cons (e : Expr p) (stack : List (Expr p)) :
    stackValid (e :: stack) ↔ indices e = true ∧ stackValid stack := by
  simp [stackValid]

theorem stackValid_nil : stackValid ([] : List (Expr p)) := by simp [stackValid]

theorem scan_sound (p : Bool) (code : List Nat) (stack out : List (Expr p))
    (accepted : scan p code stack = some out) :
    stackBytes stack ++ code = stackBytes out ∧ (stackValid stack → stackValid out) := by
  induction code, stack using scan.induct p generalizing out with
  | case1 stack =>
    simp only [scan_nil, Option.some.injEq] at accepted
    subst out
    simp
  | case2 stack rest ih =>
    rw [scan.eq_def] at accepted
    simp only [↓reduceIte] at accepted
    obtain ⟨hb, hv⟩ := ih out accepted
    constructor
    · simpa [stackBytes, canonical, bytes, List.append_assoc] using hb
    · intro hs
      exact hv ((stackValid_cons _ _).mpr ⟨rfl, hs⟩)
  | case3 stack rest nonzero ih =>
    rw [scan.eq_def] at accepted
    simp only [show ¬(1 : Nat) = 0 by decide, ↓reduceIte] at accepted
    obtain ⟨hb, hv⟩ := ih out accepted
    constructor
    · simpa [stackBytes, canonical, bytes, List.append_assoc] using hb
    · intro hs
      exact hv ((stackValid_cons _ _).mpr ⟨rfl, hs⟩)
  | case4 stack b rest h0 h1 =>
    rw [scan.eq_def] at accepted
    simp [h0, h1] at accepted
  | case5 stack lo hi rest bounds ih =>
    rw [scan.eq_def] at accepted
    simp only [bounds, ↓reduceIte] at accepted
    obtain ⟨hb, hv⟩ := ih out accepted
    have hword : word lo hi (lo + 256 * hi) = true := by simp [word, bounds.1, bounds.2]
    obtain ⟨hl, hh, hn⟩ := word_unique _ _ _ hword
    constructor
    · simpa [stackBytes, canonical, bytes, ← hl, ← hh, List.append_assoc] using hb
    · intro hs
      exact hv ((stackValid_cons _ _).mpr ⟨by simpa [indices] using hn, hs⟩)
  | case6 stack lo hi rest bounds =>
    rw [scan.eq_def] at accepted
    simp [bounds] at accepted
  | case7 stack lo hi rest bounds ih =>
    rw [scan.eq_def] at accepted
    simp only [bounds, ↓reduceIte] at accepted
    obtain ⟨hb, hv⟩ := ih out accepted
    have hword : word lo hi (lo + 256 * hi) = true := by simp [word, bounds.1, bounds.2]
    obtain ⟨hl, hh, hn⟩ := word_unique _ _ _ hword
    constructor
    · simpa [stackBytes, canonical, bytes, ← hl, ← hh, List.append_assoc] using hb
    · intro hs
      exact hv ((stackValid_cons _ _).mpr ⟨by simpa [indices] using hn, hs⟩)
  | case8 stack lo hi rest bounds =>
    rw [scan.eq_def] at accepted
    simp [bounds] at accepted
  | case9 stack lo hi rest bounds hp ih =>
    rw [scan.eq_def] at accepted
    simp only [bounds, ↓reduceIte, hp, ↓reduceDIte] at accepted
    obtain ⟨hb, hv⟩ := ih out accepted
    have hword : word lo hi (lo + 256 * hi) = true := by simp [word, bounds.1, bounds.2]
    obtain ⟨hl, hh, hn⟩ := word_unique _ _ _ hword
    constructor
    · simpa [stackBytes, canonical, bytes, ← hl, ← hh, List.append_assoc] using hb
    · intro hs
      exact hv ((stackValid_cons _ _).mpr ⟨by simpa [indices] using hn, hs⟩)
  | case10 stack lo hi rest bounds hp =>
    rw [scan.eq_def] at accepted
    simp [bounds, hp] at accepted
  | case11 stack lo hi rest bounds =>
    rw [scan.eq_def] at accepted
    simp [bounds] at accepted
  | case12 rest e stack ih =>
    rw [scan.eq_def] at accepted
    obtain ⟨hb, hv⟩ := ih out accepted
    constructor
    · simpa [stackBytes, canonical, bytes, List.append_assoc] using hb
    · intro hs
      obtain ⟨he, hs⟩ := (stackValid_cons _ _).mp hs
      exact hv ((stackValid_cons _ _).mpr ⟨he, hs⟩)
  | case13 rest =>
    rw [scan.eq_def] at accepted
    contradiction
  | case14 fl fh rest c stack offset bounds yes jl jh body htail count jbounds y n hn hy ihy ihn iht =>
    dsimp only [offset, yes, count] at bounds jbounds hy hn htail
    rw [scan.eq_def] at accepted
    simp only [bounds, ↓reduceIte] at accepted
    rw [htail] at accepted
    simp only [jbounds, ↓reduceIte, hy, hn] at accepted
    obtain ⟨hb, hv⟩ := iht out accepted
    obtain ⟨yb, yv⟩ := ihy [y] hy
    obtain ⟨nb, nv⟩ := ihn [n] hn
    simp only [stackBytes, List.nil_append] at yb nb
    have yvalid : indices y = true := (yv stackValid_nil) y (by simp)
    have nvalid : indices n = true := (nv stackValid_nil) n (by simp)
    have hlength := congrArg List.length htail
    simp only [List.length_drop, List.length_cons] at hlength
    have ylength : (bytes (canonical y)).length = offset - 3 := by
      rw [← yb]
      simp only [yes, List.length_take]
      omega
    have nlength : (bytes (canonical n)).length = count := by
      rw [← nb, List.length_take]
      exact Nat.min_eq_left jbounds.2.2
    have fw : word fl fh ((bytes (canonical y)).length + 3) = true := by
      simp only [word, decide_eq_true_eq]
      refine ⟨bounds.1, bounds.2.1, ?_⟩
      rw [ylength]
      dsimp only [offset] at *
      omega
    have jw : word jl jh (bytes (canonical n)).length = true := by
      simp only [word, decide_eq_true_eq]
      exact ⟨jbounds.1, jbounds.2.1, nlength.symm⟩
    obtain ⟨flo, fhi, _⟩ := word_unique _ _ _ fw
    obtain ⟨jlo, jhi, _⟩ := word_unique _ _ _ jw
    have splitRest : rest = bytes (canonical y) ++ [31, jl, jh] ++
        bytes (canonical n) ++ body.drop count := by
      calc
        rest = yes ++ rest.drop (offset - 3) := (List.take_append_drop _ _).symm
        _ = bytes (canonical y) ++ (31 :: jl :: jh :: body) := by rw [yb, htail]
        _ = bytes (canonical y) ++ [31, jl, jh] ++ bytes (canonical n) ++ body.drop count := by
          rw [← nb, List.append_assoc, List.append_assoc, List.take_append_drop]
          rfl
    constructor
    · rw [splitRest]
      simpa [stackBytes, canonical, bytes, ← flo, ← fhi, ← jlo, ← jhi,
        List.append_assoc] using hb
    · intro hs
      obtain ⟨hc, hs⟩ := (stackValid_cons _ _).mp hs
      apply hv
      exact (stackValid_cons _ _).mpr ⟨by simp [indices, hc, yvalid, nvalid], hs⟩
  | case15 fl fh rest c stack offset bounds yes jl jh body htail count jbounds bad ihy ihn =>
    dsimp only [offset, yes, count] at bounds jbounds bad htail
    rw [scan.eq_def] at accepted
    simp only [bounds, ↓reduceIte] at accepted
    rw [htail] at accepted
    simp only [jbounds, ↓reduceIte] at accepted
    split at accepted <;> contradiction
  | case16 fl fh rest c stack offset bounds jl jh body htail count bad =>
    dsimp only [offset, count] at bounds bad htail
    rw [scan.eq_def] at accepted
    simp only [bounds, ↓reduceIte] at accepted
    rw [htail] at accepted
    simp [bad] at accepted
  | case17 fl fh rest c stack offset bounds bad =>
    dsimp only [offset] at bounds bad
    rw [scan.eq_def] at accepted
    simp only [bounds, ↓reduceIte] at accepted
    split at accepted <;> contradiction
  | case18 fl fh rest c stack offset bad =>
    dsimp only [offset] at bad
    rw [scan.eq_def] at accepted
    simp [bad] at accepted
  | case19 fl fh rest =>
    rw [scan.eq_def] at accepted
    contradiction
  | case20 code stack h0 h1 h3 h4 h5 h10 h30 =>
    rw [scan] at accepted
    contradiction
    all_goals assumption

theorem decode_serialized (p : Bool) (code : List Nat) (e : Expr p)
    (decoded : decode p code = some e) : serialize e = .ok code := by
  obtain ⟨size, scanned⟩ := decode_full_consumption p code e decoded
  obtain ⟨reconstructed, valid⟩ := scan_sound p code [] [e] scanned
  simp only [stackBytes, List.nil_append] at reconstructed
  have hi : indices e = true := (valid stackValid_nil) e (by simp)
  apply (serialize_iff e code).mpr
  exact ⟨⟨hi, by rwa [← reconstructed]⟩, reconstructed⟩

theorem decode_iff_serialized (p : Bool) (code : List Nat) (e : Expr p) :
    decode p code = some e ↔ serialize e = .ok code :=
  ⟨decode_serialized p code e, serialize_recovery e code⟩

theorem decoded_bytes (p : Bool) (code : List Nat) (e : Expr p)
    (decoded : decode p code = some e) :
    0 < code.length ∧ code.length ≤ 4096 ∧ ∀ b ∈ code, b < 256 :=
  serialized_bytes e code (decode_serialized p code e decoded)

theorem decoded_refinement (p : Bool) (code : List Nat) (e : Expr p)
    (decoded : decode p code = some e) (slots : ByteMachine.Slots)
    (scope : ByteMachine.inScope e slots = true) (env : Env)
    (stack : List Bool) (room : stack.length < 128) :
    Executes code env stack (eval e env :: stack) ∧
    ∃ count, count ≤ code.length ∧ ByteMachine.Steps code slots env count
      ⟨0, stack⟩ ⟨code.length, eval e env :: stack⟩ :=
  serialized_refinement e code (decode_serialized p code e decoded) slots scope env stack room

theorem decoded_execute (p : Bool) (code : List Nat) (e : Expr p)
    (decoded : decode p code = some e) (slots : ByteMachine.Slots)
    (scope : ByteMachine.inScope e slots = true) (env : Env) :
    ByteMachine.execute (code.length + 1) code slots env ⟨0, []⟩ = .done (eval e env) :=
  serialized_execute e code (decode_serialized p code e decoded) slots scope env

#print axioms scan_sound
#print axioms decode_serialized
#print axioms decode_iff_serialized
#print axioms decoded_bytes
#print axioms decoded_refinement
#print axioms decoded_execute

end BoolTranslation.Serialization
