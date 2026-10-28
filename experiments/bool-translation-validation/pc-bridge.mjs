import { theoremInput } from './bridge.mjs';

export function pcTheoremInput(evidence) {
  const lines = [theoremInput(evidence).replace('import BoolTranslation', 'import BoolTranslation\nimport ByteMachine'),
    'open BoolTranslation.ByteMachine',
    `def transitionSlots : Slots := ⟨0, ${evidence.decoded.states.length}, false⟩`,
    `def outputSlots : Slots := ⟨0, ${evidence.decoded.states.length}, true⟩`,
    `theorem inputCountBound : (artifactBytes.drop ${evidence.decoded.inputCountOffset}).take 2 = [transitionSlots.inputs % 256, transitionSlots.inputs / 256] := by decide`,
    `theorem stateCountBound : (artifactBytes.drop ${evidence.decoded.stateCountOffset}).take 2 = [transitionSlots.states % 256, transitionSlots.states / 256] := by decide`,
    'theorem sameOutputCounts : outputSlots.inputs = transitionSlots.inputs ∧ outputSlots.states = transitionSlots.states := by decide'];
  for (const [group, slots] of [['transitions', 'transitionSlots'], ['outputs', 'outputSlots']]) {
    evidence.decoded[group].forEach((entry, index) => {
      const name = `${group}${index}`, slice = `((artifactBytes.drop ${entry.offset}).take ${entry.length})`;
      lines.push(`theorem ${name}Scoped : inScope ${name}Source ${slots} = true := by decide`,
        `theorem ${name}PCPreserved (env : Env) : execute (${slice}.length + 1) ${slice} ${slots} env ⟨0, []⟩ = .done (eval ${name}Source env) := by`,
        `  rw [← ${name}Bound]`,
        `  exact accepted_execute ${name}Source ${name}Wire ${name}Accepted ${slots} ${name}Scoped env`,
        `#print axioms ${name}PCPreserved`);
    });
  }
  return lines.join('\n') + '\n';
}
