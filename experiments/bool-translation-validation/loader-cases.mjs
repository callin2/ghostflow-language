import { readerReduction } from './loader-bridge.mjs';

const reduction = `simp [empty, swap, load, ${readerReduction},
    moduleBytes, header, records, record, transitionEntries, outputEntries,
    targets, string, blob, code, Serialization.canonical, bytes, u32, u16,
    format, branching, query, encodeModule, valid, validExpression,
    Serialization.indices, ByteMachine.inScope, slots, Serialization.low,
    Serialization.high, List.range_succ, List.range_zero, List.zipWith, List.flatMap] <;> decide`;
const badTargetReduction = reduction.replace('simp [', 'simp [badTargets, ');

export const loaderCases = `
open BoolTranslation BoolTranslation.ModuleEnvelope BoolTranslation.ModuleLoader
set_option maxRecDepth 8192
set_option maxHeartbeats 4000000
namespace LoaderCases

def empty : Module := ⟨[65], [], [], []⟩
def swap : Module := ⟨[65], [([97], false), ([98], true)],
  [.previous 1, .previous 0], [([99], .next 0 rfl), ([100], .previous 0)]⟩

example : load (moduleBytes empty) = some empty := by decide
example : initialState (moduleBytes empty) = some [] := by decide
example : trace (moduleBytes empty) 2 = some [([], []), ([], [])] := by decide
theorem swapLoaded : load (moduleBytes swap) = some swap := by ${reduction}
example : initialState (moduleBytes swap) = some [false, true] :=
  loaded_initial _ _ swapLoaded
example : trace (moduleBytes swap) 3 = some
    [([true, false], [true, false]), ([false, true], [false, true]), ([true, false], [true, false])] := by
  rw [initialized_trace _ _ swapLoaded]
  decide
example : trace (moduleBytes swap) 0 = some [] := by
  rw [initialized_trace _ _ swapLoaded]
  rfl
example : load [] = none := by decide
example : trace [] 0 = none := by decide
example : readByte [256] = none := by decide
example : readU16 [255, 255] = some (65535, []) := by decide
example : readU32 [255, 255, 255, 255] = some (4294967295, []) := by decide
example : readBytes 4 [1, 2, 3] = none := by decide
example : readName [129, 0] = none := by decide
example : readName [0, 0] = none := by decide
example : readName [1, 0, 48] = none := by decide
example : readBlob [1, 16, 0, 0] = none := by decide
example : readBlob [255, 255, 255, 255] = none := by decide
example : readExpression false [3, 0, 0, 0, 5, 0, 0] = none := by ${reduction}
example : load ((moduleBytes swap) ++ [0]) = none := by ${reduction}
example : load ((moduleBytes swap).dropLast) = none := by ${reduction}
example : load (moduleBytes { swap with transitions := [.previous 2, .previous 0] }) = none := by ${reduction}
example : load (moduleBytes { swap with outputs := [([99], .next 2 rfl)] }) = none := by ${reduction}
example : load (moduleBytes { swap with transitions := [.input 0, .previous 0] }) = none := by ${reduction}
example : load (moduleBytes { swap with states := [([97], false), ([97], true)] }) = none := by ${reduction}
example : load (moduleBytes { swap with outputs := [([97], .literal true)] }) = none := by ${reduction}
example (raw : List Nat) (size : 1048576 < raw.length) : load raw = none := by
  simp [load, Nat.not_le.mpr size]

def badTargets : List Nat := header swap ++
  u16 1 ++ blob (code (.previous 1 : Expr false)) ++
  u16 1 ++ blob (code (.previous 0 : Expr false)) ++
  u16 swap.outputs.length ++ records (outputEntries swap) ++ u16 0

theorem parserAcceptsBadTargets : readModule badTargets = some (swap, []) := by ${badTargetReduction}
theorem loaderRejectsBadTargets : load badTargets = none := by ${badTargetReduction}
example : (fun raw => (readModule raw).bind
    (fun result => if result.2 = [] then some result.1 else none)) badTargets = some swap := by
  simp [parserAcceptsBadTargets]
example : trace badTargets 0 = none := by simp [trace, loaderRejectsBadTargets]

end LoaderCases
`;

export const loaderMutations = [
  { name: 'canonical-check-removed', before: 'if encodeModule m = .ok raw then some m else none', after: 'some m', diagnostic: "tactic 'split' failed" },
  { name: 'initial-values-inverted', before: 'def initial (m : Module) : List Bool := m.states.map Prod.snd',
    after: 'def initial (m : Module) : List Bool := m.states.map (fun s => !s.2)', diagnostic: 'unsolved goals' },
  { name: 'tick-keeps-initial-state', before: 'let rest ← byteTrace m raw n observation.1',
    after: 'let rest ← byteTrace m raw n state', diagnostic: "tactic 'rfl' failed" },
];
