import ConstraintPreservation
open CompilerSafety
set_option maxRecDepth 4096

def original : List Constraint := [
  Constraint.mutex ["a", "b", "c", "d", "e", "f", "g", "h"],
  Constraint.mutex ["a", "b", "c", "d", "e", "f", "g", "h"],
  Constraint.requiresAny "a" ["b", "c"],
  Constraint.requiresAny "a" ["b", "c"]
]
def compiled : List Constraint := [
  Constraint.mutex ["a", "b", "c", "d", "e", "f", "g", "h"],
  Constraint.requiresAny "a" ["b", "c"]
]
theorem accepted : check original compiled = true := by decide
theorem preservation (rounds : Nat) (initial : SafetyState) :
    run rounds original initial = run rounds compiled initial :=
  check_run original compiled accepted rounds initial
