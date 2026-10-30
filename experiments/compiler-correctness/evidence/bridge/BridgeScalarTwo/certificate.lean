import ConstraintPreservation
open CompilerSafety
set_option maxRecDepth 4096

def original : List Constraint := [
  Constraint.mutex ["a", "b"],
  Constraint.mutex ["a", "b"]
]
def compiled : List Constraint := [
  Constraint.mutex ["a", "b"]
]
theorem accepted : check original compiled = true := by decide
theorem preservation (rounds : Nat) (initial : SafetyState) :
    run rounds original initial = run rounds compiled initial :=
  check_run original compiled accepted rounds initial
