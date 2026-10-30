import ConstraintPreservation
open CompilerSafety
set_option maxRecDepth 4096

def original : List Constraint := [
  Constraint.requires "a" "b",
  Constraint.requires "a" "b",
  Constraint.requiresAny "a" ["b", "c"],
  Constraint.requiresAny "a" ["b", "c"],
  Constraint.mutex ["d", "e", "f"],
  Constraint.mutex ["d", "e", "f"],
  Constraint.requires "b" "d",
  Constraint.requires "b" "d",
  Constraint.requires "d" "e",
  Constraint.requires "d" "e"
]
def compiled : List Constraint := [
  Constraint.requires "a" "b",
  Constraint.requiresAny "a" ["b", "c"],
  Constraint.mutex ["d", "e", "f"],
  Constraint.requires "b" "d",
  Constraint.requires "d" "e"
]
theorem accepted : check original compiled = true := by decide
theorem preservation (rounds : Nat) (initial : SafetyState) :
    run rounds original initial = run rounds compiled initial :=
  check_run original compiled accepted rounds initial
