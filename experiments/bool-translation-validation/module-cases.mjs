export const moduleCases = `
open BoolTranslation BoolTranslation.ModuleEnvelope
set_option maxRecDepth 8192
set_option maxHeartbeats 4000000
namespace ModuleCases

def empty : Module := ⟨[65], [], [], []⟩
example : query empty = [5, 1] := by decide
example : format empty = 1 := by decide
example : valid empty = true := by decide
example : encodeModule empty = .ok (moduleBytes empty) := by decide
example : rawTick empty (moduleBytes empty) env = some ([], []) := by rfl
example : targets { empty with states := [([97], false), ([98], true)] } = [0, 1] := by decide

example : identifier [] = false := by decide
example : identifier [48] = false := by decide
example : identifier [65, 45] = false := by decide
example : identifier [195, 169] = false := by decide
example : identifier [95, 48] = true := by decide
example : identifier (List.replicate 128 65) = true := by decide
example : identifier (List.replicate 129 65) = false := by decide
example : encodeModule { empty with name := [256] } = .error .profile := by decide

def one : Module := ⟨[65], [([97], false)], [.previous 0], [([98], .next 0 rfl)]⟩
example : valid one = true := by decide
example : encodeModule one = .ok (moduleBytes one) := by decide
example : encodeModule { one with transitions := [] } = .error .profile := by decide
example : encodeModule { one with transitions := [.previous 1] } = .error .profile := by decide
example : encodeModule { one with transitions := [.input 0] } = .error .profile := by decide
example : encodeModule { one with outputs := [([98], .next 1 rfl)] } = .error .profile := by decide
example : encodeModule { one with outputs := [([97], .literal true)] } = .error .profile := by decide
example : encodeModule { one with outputs := [([98], .literal true), ([98], .literal false)] } = .error .profile := by decide
example : format { one with transitions := [.branch (.literal true) (.previous 0) (.literal false)] } = 3 := by decide
example : format { one with outputs := [([98], .negate (.branch (.literal true) (.literal true) (.literal false)))] } = 3 := by decide
example (m : Module) (h : valid m = true) (size : 1048576 < (moduleBytes m).length) :
    encodeModule m = .error .moduleSize := by simp [encodeModule, h, Nat.not_le.mpr size]
example (m : Module) (h : 4096 < (query m).length) : valid m = false := by
  simp [valid, Nat.not_le.mpr h]
example (m : Module) (h : 128 < m.states.length) : valid m = false := by
  simp [valid, Nat.not_le.mpr h]
example (m : Module) (h : 128 < m.outputs.length) : valid m = false := by
  simp [valid, Nat.not_le.mpr h]
example (m : Module) (e : Expr p) (h : 4096 < (code e).length) :
    validExpression m p e = false := by simp [validExpression, Nat.not_le.mpr h]

end ModuleCases
`;
