export const pcErrorCases = `
open BoolTranslation BoolTranslation.ByteMachine
set_option maxRecDepth 4096
set_option maxHeartbeats 2000000
def testSlots : Slots := ⟨1, 1, true⟩
def testEnv : Env := ⟨fun _ => true, fun _ => false, fun _ => true⟩
example : step [1, 2] testSlots testEnv ⟨0, []⟩ = .next ⟨2, [true]⟩ := by decide
example : step [1, 1] testSlots testEnv ⟨0, List.replicate 127 false⟩ = .next ⟨2, true :: List.replicate 127 false⟩ := by decide
example : step [1, 1] testSlots testEnv ⟨0, List.replicate 128 false⟩ = .fault .stackLimit := by decide
example : step [10] testSlots testEnv ⟨0, []⟩ = .fault .stackUnderflow := by decide
example : step [30, 0, 0] testSlots testEnv ⟨0, []⟩ = .fault .zeroJump := by decide
example : step [30, 1, 0] testSlots testEnv ⟨0, [true]⟩ = .fault .jumpRange := by decide
example : step [30, 1, 0, 10] testSlots testEnv ⟨0, []⟩ = .fault .stackUnderflow := by decide
example : step [31, 0, 0] testSlots testEnv ⟨0, []⟩ = .fault .zeroJump := by decide
example : step [31, 1, 0] testSlots testEnv ⟨0, []⟩ = .fault .jumpRange := by decide
example : step [3, 1, 0] testSlots testEnv ⟨0, []⟩ = .fault .inputRange := by decide
example : step [4, 1, 0] testSlots testEnv ⟨0, []⟩ = .fault .stateRange := by decide
example : step [5, 1, 0] testSlots testEnv ⟨0, []⟩ = .fault .nextRange := by decide
example : step [5, 0, 0] ⟨1, 1, false⟩ testEnv ⟨0, []⟩ = .fault .nextRange := by decide
example : step [30, 1] testSlots testEnv ⟨0, []⟩ = .fault .truncated := by decide
example : step [255] testSlots testEnv ⟨0, []⟩ = .fault .opcode := by decide
example : step [] testSlots testEnv ⟨1, []⟩ = .fault .truncated := by decide
example : step [] testSlots testEnv ⟨0, []⟩ = .fault .resultCount := by decide
example : execute 1 [1, 1] testSlots testEnv ⟨0, []⟩ = .fault .fuel := by decide
example : execute 2 [1, 1] testSlots testEnv ⟨0, []⟩ = .done true := by decide
`;

export const pcMutations = [
  { name: 'rejected-pc-jump-base', before: 's.pc + 3 + offset', after: 's.pc + 2 + offset', diagnostic: 'unsolved goals' },
  { name: 'rejected-pc-branch-polarity', before: 'if b then s.pc + 3 else s.pc + 3 + offset',
    after: 'if b then s.pc + 3 + offset else s.pc + 3', diagnostic: 'unsolved goals' },
  { name: 'rejected-pc-condition-not-popped', before: 'if b then s.pc + 3 else s.pc + 3 + offset, stack⟩',
    after: 'if b then s.pc + 3 else s.pc + 3 + offset, b :: stack⟩', diagnostic: 'unsolved goals' },
  { name: 'rejected-pc-next-reads-old', before: '.ok (env.next index)', after: '.ok (env.previous index)', diagnostic: 'unsolved goals' },
  { name: 'rejected-pc-stack-limit', before: 'if stack.length < 128 then', after: 'if stack.length < 129 then',
    diagnostic: "tactic 'decide' proved that the proposition" },
  { name: 'rejected-pc-zero-jump', before: 'if offset = 0 then .fault .zeroJump', after: 'if offset = 0 then .next ⟨s.pc + 3, s.stack⟩',
    diagnostic: "tactic 'decide' proved that the proposition" },
  { name: 'rejected-pc-outside-jump', before: 'else if s.pc + 3 + offset > length then .fault .jumpRange',
    after: 'else if s.pc + 3 + offset > length then .next ⟨s.pc + 3 + offset, s.stack⟩',
    diagnostic: "tactic 'decide' proved that the proposition" },
];
