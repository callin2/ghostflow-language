import { pcTheoremInput } from './pc-bridge.mjs';

export function serializerTheoremInput(evidence) {
  const lines = [pcTheoremInput(evidence).replace('import ByteMachine', 'import ByteMachine\nimport Serializer'),
    'open BoolTranslation.Serialization'];
  for (const [group, phase] of [['transitions', false], ['outputs', true]]) {
    evidence.decoded[group].forEach((entry, index) => {
      const name = `${group}${index}`, slice = `((artifactBytes.drop ${entry.offset}).take ${entry.length})`;
      lines.push(`theorem ${name}Serialized : serialize ${name}Source = .ok ${slice} := by`,
        `  rw [← ${name}Bound]`,
        `  exact accepted_serialized ${name}Source ${name}Wire ${name}Accepted (by decide)`,
        `theorem ${name}Recovered : decode ${phase} ${slice} = some ${name}Source :=`,
        `  serialize_recovery ${name}Source ${slice} ${name}Serialized`,
        `#print axioms ${name}Serialized`,
        `#print axioms ${name}Recovered`);
    });
  }
  return lines.join('\n') + '\n';
}
