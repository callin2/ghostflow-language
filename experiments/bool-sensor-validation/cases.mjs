export const cases = `
open BoolTranslation.SensorMachine BoolTranslation.SensorProfile
set_option maxRecDepth 8192
set_option maxHeartbeats 4000000
namespace SensorCases
def p : Profile := ⟨ascii "Sensor", ascii "di", ascii "out"⟩
example : load (moduleBytes p) = some ⟨p, recoverCode⟩ := by decide
example : load ((moduleBytes p) ++ [0]) = none := by decide
example : load ((moduleBytes p).dropLast) = none := by decide
example : load (moduleBytes { p with sensor := [] }) = none := by decide
example : load (moduleBytes { p with output := p.sensor }) = none := by decide
example : load (moduleBytes { p with sensor := List.replicate 120 97 }) = none := by decide
example : admitted naturalNumbers [.bool true, .bool true, .number 1] = false := by decide
example : admitted naturalNumbers [.bool true, .bool false, .number 4] = false := by decide
example : admitted naturalNumbers [.bool true, .number 1, .number 0] = false := by decide
example : admitted naturalNumbers [.bool true, .bool false, .bool false] = false := by decide
example : admitted naturalNumbers [.bool false, .bool false] = false := by decide
example : runAdmitted naturalNumbers recoverCode [.bool true, .bool false, .number 4] = none := by decide
def partialNumbers : NumberOps (Option Nat) := ⟨some, fun a b => do pure ((← a) + (← b)), id⟩
example : admitted partialNumbers [.bool true, .bool false, .number none] = false := by decide
example : run naturalNumbers [3, 0, 0, 30, 0, 0, 1, 1] [.number 1] = none := by decide
example : run naturalNumbers [1, 1, 33, 19] [] = none := by decide
example : run naturalNumbers [1, 1, 32, 32, 56, 5, 0, 0, 0] [] = some (true, [⟨5, 0, 0⟩]) := by decide
example : run naturalNumbers [1, 1, 32, 56, 5, 0, 0, 0] [] = none := by decide
example : run naturalNumbers [1, 1, 1, 0, 32, 56, 5, 0, 0, 0] [] = none := by decide
example : run naturalNumbers [1, 1, 32, 32, 56, 0, 0, 0, 0] [] = none := by decide
example : run naturalNumbers [1, 1, 32, 32, 56, 5, 0, 0] [] = none := by decide
example : run naturalNumbers [1, 1, 31, 255, 255] [] = none := by decide
example : observe p (expectedMetadata p) (false, [⟨5, 0, 1⟩]) = none := by decide
example : observe p (expectedMetadata p) (false, [⟨5, 5, 1⟩]) = none := by decide
example : observe p (expectedMetadata p) (false, [⟨6, 1, 1⟩]) = none := by decide
example : observe p (expectedMetadata p) (false, [⟨5, 1, 2⟩]) = none := by decide
example : observe p ([], []) (false, [⟨5, 1, 1⟩]) = none := by decide
example : run naturalNumbers recoverCode (rails naturalNumbers (.healthy false) false) ≠
    run naturalNumbers recoverCode (rails naturalNumbers (.fault .disconnected) false) := by decide
end SensorCases
`;

export const machineMutations = [
  { name: 'drop-result-trace', before: 'trace := s.trace ++ [⟨site, choice, origin⟩]', after: 'trace := s.trace', diagnostic: 'unsolved goals' },
  { name: 'reverse-quality-branch', before: 'if condition then next else next + offset', after: 'if condition then next + offset else next', diagnostic: "tactic 'rfl' failed" },
  { name: 'erase-fault-choice-increment', before: '[3, 1, 0] [32] [3, 2, 0, 33, 19]', after: '[3, 1, 0] [32] [3, 2, 0, 32, 19]', diagnostic: "tactic 'rfl' failed" },
];
