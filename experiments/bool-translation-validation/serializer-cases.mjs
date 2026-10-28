export const serializerCases = `
open BoolTranslation BoolTranslation.Serialization
namespace SerializationCases

example : serialize (.input 256 : Expr false) = .ok [3, 0, 1] := by rfl
example : serialize (.previous 65535 : Expr false) = .ok [4, 255, 255] := by rfl
example : serialize (.next 256 rfl : Expr true) = .ok [5, 0, 1] := by rfl
example : serialize (.input 65536 : Expr false) = .error .indexRange := by rfl
example : serialize (.previous 65536 : Expr true) = .error .indexRange := by rfl
example : serialize (.next 65536 rfl : Expr true) = .error .indexRange := by rfl

def sample : Expr true := .branch (.previous 256) (.negate (.literal false)) (.next 65535 rfl)
def sampleBytes : List Nat := [4, 0, 1, 30, 6, 0, 1, 0, 10, 31, 3, 0, 5, 255, 255]
example : serialize sample = .ok sampleBytes := by rfl
example : decode true sampleBytes = some sample :=
  serialize_recovery sample sampleBytes (by rfl)

-- Rejection tests execute the independent decoder on raw bytes. It cannot
-- consult an expected expression and cannot leave a suffix unconsumed.
example : (decode false []).isNone = true := by simp [decode, scan]
example : (decode false [1]).isNone = true := by simp [decode, scan]
example : (decode false [1, 2]).isNone = true := by simp [decode, scan]
example : (decode false [1, 1, 1, 0]).isNone = true := by simp [decode, scan]
example : (decode false [1, 1, 0]).isNone = true := by simp [decode, scan]
example : (decode false [10]).isNone = true := by simp [decode, scan]
example : (decode false [3, 0]).isNone = true := by simp [decode, scan]
example : (decode false [3, 256, 0]).isNone = true := by simp [decode, scan]
example : (decode false [3, 0, 256]).isNone = true := by simp [decode, scan]
example : (decode false [5, 0, 0]).isNone = true := by simp [decode, scan]
example : (decode false [31, 1, 0]).isNone = true := by simp [decode, scan]
example : (decode false [1, 1, 30, 2, 0, 1, 0, 31, 2, 0, 1, 1]).isNone = true := by simp [decode, scan]
example : (decode false [1, 1, 30, 8, 0, 1, 0, 31, 2, 0, 1, 1]).isNone = true := by simp [decode, scan]
example : (decode false [1, 1, 30, 5, 0, 1, 0, 31, 2, 0, 1]).isNone = true := by simp [decode, scan]
example : (decode false [1, 1, 30, 5, 0, 1, 0, 31, 0, 0]).isNone = true := by simp [decode, scan]
example : (decode false [1, 1, 30, 5, 0, 1, 0, 31, 2, 0, 1, 1, 0]).isNone = true := by simp [decode, scan]

def negations : Nat → Expr false
  | 0 => .literal false
  | n + 1 => .negate (negations n)
theorem negations_indices (n : Nat) : indices (negations n) = true := by
  induction n <;> simp_all [negations, indices]
theorem negations_size (n : Nat) : (bytes (canonical (negations n))).length = n + 2 := by
  induction n <;> simp_all [negations, canonical, bytes, Nat.add_assoc]
theorem negations_fit (n : Nat) (bound : n + 2 ≤ 4096) : representable (negations n) := by
  exact ⟨negations_indices _, by rw [negations_size]; exact bound⟩
theorem negations_too_long (n : Nat) (bound : 4096 < n + 2) :
    serialize (negations n) = .error .expressionSize := by
  simp [serialize, negations_indices, negations_size, Nat.not_le.mpr bound]
example : representable (negations 4094) := negations_fit _ (by decide)
example : serialize (negations 4094) = .ok (bytes (canonical (negations 4094))) :=
  serialize_ok _ (negations_fit _ (by decide))
example : serialize (negations 4095) = .error .expressionSize := negations_too_long _ (by decide)
theorem too_long_decode (n : Nat) (bound : 4096 < n) :
    decode false (List.replicate n 10) = none := by
  simp [decode, Nat.not_le.mpr bound]
example : decode false (List.replicate 4097 10) = none := too_long_decode _ (by decide)

end SerializationCases
`;

// Universal proofs remain in each mutant. A failure must be a Lean proof
// diagnostic, never a timeout or a missing import/tool masquerading as rejection.
export const serializerMutations = [
  { name: 'rejected-serializer-endian', before: 'def low (n : Nat) : Nat := n % 256',
    after: 'def low (n : Nat) : Nat := n / 256', diagnostic: 'omega could not prove the goal' },
  { name: 'rejected-serializer-branch-offset-minus-three', before: '((bytes wy).length + 3)',
    after: '((bytes wy).length + 0)', diagnostic: "tactic 'rfl' failed" },
  { name: 'rejected-serializer-branch-offset-plus-three', before: '((bytes wy).length + 3)',
    after: '((bytes wy).length + 6)', diagnostic: "tactic 'rfl' failed" },
  { name: 'rejected-serializer-leaf-opcode', before: '| .input i => .read 3 (low i) (high i)',
    after: '| .input i => .read 4 (low i) (high i)', diagnostic: "tactic 'rfl' failed" },
  { name: 'rejected-serializer-index-wrap', before: 'decide (i < 65536)',
    after: 'decide (i < 65537)', diagnostic: 'type mismatch' },
  { name: 'rejected-serializer-overlong', before: 'if code.length ≤ 4096 then .ok code else .error .expressionSize',
    after: 'if code.length ≤ 4097 then .ok code else .error .expressionSize', diagnostic: 'unsolved goals' },
  { name: 'rejected-decoder-drop-not', before: 'scan p rest (.negate e :: stack)',
    after: 'scan p rest (e :: stack)', diagnostic: 'unsolved goals' },
  { name: 'rejected-decoder-discard-trailing', before: '| _ => none\ntermination_by code.length',
    after: '| _ => some stack\ntermination_by code.length', diagnostic: 'unsolved goals' },
  { name: 'rejected-decoder-next-phase', before: 'if hp : p = true then scan p rest (.next (lo + 256 * hi) hp :: stack) else none',
    after: 'scan p rest (.previous (lo + 256 * hi) :: stack)', diagnostic: 'unsolved goals' },
];
