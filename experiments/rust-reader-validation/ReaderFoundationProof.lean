import ReaderFoundation

open Aeneas Aeneas.Std

namespace GhostFlowReader.Foundation

/-- Cursor positions reachable from `new` must stay within the input. -/
def Valid (r : Reader) : Prop := r.at.val ≤ r.bytes.length

/-- The list-of-natural-bytes remainder used by ModuleLoader. -/
def remaining (r : Reader) : List Nat :=
  (r.bytes.val.map UScalar.val).drop r.at.val

theorem new_exact (bytes : Slice U8) :
    Reader.new bytes = Result.ok { bytes, «at» := 0#usize } := by
  rfl

theorem new_valid (bytes : Slice U8) :
    ∃ r, Reader.new bytes = Result.ok r ∧
      r.bytes = bytes ∧ r.at.val = 0 ∧ Valid r ∧
      remaining r = bytes.val.map UScalar.val := by
  refine ⟨{ bytes, «at» := 0#usize }, rfl, rfl, ?_, ?_, ?_⟩ <;>
    simp [Valid, remaining]

/-- The outer Result terminates successfully for every Reader, even invalid ones. -/
theorem finished_exact (r : Reader) :
    Reader.finished r = Result.ok (decide (r.at.val = r.bytes.length)) := by
  simp [Reader.finished, UScalar.eq_equiv]

theorem finished_terminates (r : Reader) :
    ∃ b, Reader.finished r = Result.ok b :=
  ⟨decide (r.at.val = r.bytes.length), finished_exact r⟩

theorem cursor_eq_length_iff_remaining_empty (r : Reader) (h : Valid r) :
    r.at.val = r.bytes.length ↔ remaining r = [] := by
  simp only [remaining, List.drop_eq_nil_iff, List.length_map]
  change r.at.val ≤ r.bytes.val.length at h
  change r.at.val = r.bytes.val.length ↔ r.bytes.val.length ≤ r.at.val
  omega

/-- Equality preserves the outer Result: panic, undefined and divergence are not rejection. -/
theorem finished_remaining (r : Reader) (h : Valid r) :
    Reader.finished r = Result.ok (decide (remaining r = [])) := by
  simp only [finished_exact, cursor_eq_length_iff_remaining_empty r h]

/-- A concrete invalid cursor explains why `Valid` cannot be dropped. -/
def invalidReader : Reader := { bytes := Slice.new U8, «at» := 1#usize }

theorem invalid_cursor_counterexample :
    ¬ Valid invalidReader ∧ remaining invalidReader = [] ∧
      Reader.finished invalidReader = Result.ok false := by
  simp [invalidReader, Valid, remaining, finished_exact]

end GhostFlowReader.Foundation

#print axioms GhostFlowReader.Foundation.new_exact
#print axioms GhostFlowReader.Foundation.new_valid
#print axioms GhostFlowReader.Foundation.finished_exact
#print axioms GhostFlowReader.Foundation.finished_terminates
#print axioms GhostFlowReader.Foundation.cursor_eq_length_iff_remaining_empty
#print axioms GhostFlowReader.Foundation.finished_remaining
#print axioms GhostFlowReader.Foundation.invalid_cursor_counterexample
