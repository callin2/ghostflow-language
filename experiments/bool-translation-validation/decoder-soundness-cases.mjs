export const decoderSoundnessCases = `
open BoolTranslation BoolTranslation.Serialization
namespace DecoderSoundnessCases

theorem rawPrevious : decode false [4, 0, 1] = some (.previous 256) := by
  simp [decode, scan]
example : serialize (.previous 256 : Expr false) = .ok [4, 0, 1] :=
  decode_serialized false _ _ rawPrevious
example : ByteMachine.inScope (.previous 256 : Expr false) ⟨0, 128, false⟩ = false := by decide

def branch : Expr true := .branch (.previous 0) (.literal false) (.next 0 rfl)
def raw : List Nat := [4, 0, 0, 30, 5, 0, 1, 0, 31, 3, 0, 5, 0, 0]
theorem rawBranch : decode true raw = some branch := by
  simp [decode, scan, raw, branch]
example : serialize branch = .ok raw := decode_serialized true raw branch rawBranch
example (env : Env) : ByteMachine.execute (raw.length + 1) raw ⟨0, 1, true⟩ env ⟨0, []⟩ =
    .done (eval branch env) :=
  decoded_execute true raw branch rawBranch ⟨0, 1, true⟩ (by decide) env
example : decode true (raw ++ [10]) = some (.negate branch) := by
  simp [decode, scan, raw, branch]

-- The arbitrary-stack invariant accounts for bytes consumed before a negate.
example : stackBytes ([.literal true] : List (Expr false)) ++ [10] =
    stackBytes ([.negate (.literal true)] : List (Expr false)) :=
  (scan_sound false [10] [.literal true] [.negate (.literal true)] (by rw [scan_not, scan_nil])).1

end DecoderSoundnessCases
`;

// Finite executable premise search is exploratory evidence, separate from the
// universal kernel proof above. Keep the actual inputs and result reproducible.
export const decoderConverseProbe = `
open BoolTranslation BoolTranslation.Serialization
namespace DecoderConverseProbe
def probe (p : Bool) (code : List Nat) : Bool :=
  match decode p code with
  | none => true
  | some e => match serialize e with
    | .ok actual => actual == code
    | .error _ => false
def sequences : Nat → List (List Nat)
  | 0 => [[]]
  | n + 1 => (sequences n).flatMap fun tail =>
      [0, 1, 3, 4, 5, 10, 30, 31, 255, 256].map (· :: tail)
def shortCodes := (List.range 6).flatMap sequences
def branchCode : List Nat := [1, 1, 30, 5, 0, 1, 0, 31, 2, 0, 1, 1]
def branchMutations := (List.range branchCode.length).flatMap fun i =>
  [0, 1, 2, 3, 4, 5, 8, 10, 30, 31, 255, 256, 65536].map fun b => branchCode.set i b
#eval (shortCodes.length, shortCodes.all (probe false), shortCodes.all (probe true))
#eval (branchMutations.length, branchMutations.all (probe false), branchMutations.all (probe true))
end DecoderConverseProbe
`;

// Each mutant preserves the existing serializer roundtrip theorem, and its
// witness is accepted by the mutated raw decoder. Only the converse proof is
// then appended: it must fail independently of finite rejection cases.
export const decoderSoundnessMutations = [
  { name: 'noncanonical-bool', before: 'else if b = 1 then scan p rest (.literal true :: stack) else none',
    after: 'else if b = 1 ∨ b = 2 then scan p rest (.literal true :: stack) else none',
    witness: `
open BoolTranslation BoolTranslation.Serialization
example : decode false [1, 2] = some (.literal true) := by simp [decode, scan.eq_def]
example : serialize (.literal true : Expr false) = .ok [1, 1] := by rfl
example : ([1, 1] : List Nat) ≠ [1, 2] := by decide
example : serialize (.literal true : Expr false) ≠ .ok [1, 2] := by
  simp [serialize, indices, canonical, bytes]
`, diagnostic: 'application type mismatch' },
  { name: 'discarded-tail', before: '| _ => none\ntermination_by code.length',
    after: '| _ => some stack\ntermination_by code.length',
    witness: `
open BoolTranslation BoolTranslation.Serialization
example : decode false [1, 1, 255] = some (.literal true) := by simp [decode, scan.eq_def]
example : serialize (.literal true : Expr false) = .ok [1, 1] := by rfl
example : ([1, 1] : List Nat) ≠ [1, 1, 255] := by decide
example : serialize (.literal true : Expr false) ≠ .ok [1, 1, 255] := by
  simp [serialize, indices, canonical, bytes]
`, diagnostic: "tactic 'contradiction' failed" },
];
