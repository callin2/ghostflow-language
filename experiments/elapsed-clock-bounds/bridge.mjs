import {theoremInput as epochTheoremInput, compileEvidence, sha256} from '../elapsed-epoch-validation/bridge.mjs';

export {compileEvidence, sha256};
export const fixture = 'experiments/elapsed-epoch-validation/fixtures/elapsed-toggle.ghost.md';

export function theoremInput(evidence) {
  return epochTheoremInput(evidence).replace('import EpochModule', 'import ClockBounds') + `
open BoolTranslation.ElapsedClockBounds
theorem actualOriginalSourceClockBounds (inputs : List (Input Nat)) (accepted : AcceptedFrom 0 inputs) :
    ∃ observations,
      EpochModule.observeModule naturalNumbers parsedSource artifactBytes actualMetadata inputs = some observations ∧
      EpochModule.sourceObservation naturalNumbers originalSourceBytes inputs = some observations ∧
      TraceBounds (EpochModule.initial naturalNumbers parsedSource) inputs observations :=
  original_module_bounds originalSourceBytes parsedSource artifactBytes actualMetadata exactSourceRead
    (by rw [structurallyParsed, codeBinding]) metadataBinding inputs accepted
#print axioms actualOriginalSourceClockBounds
`;
}

export function sampleInput(evidence, inputs, proposition) {
  return theoremInput(evidence) + `
def sampleInputs : List (Input Nat) := ${inputs}
def sampleObservations : List (Observation Nat) :=
  sourceTrace (EpochModule.initial naturalNumbers parsedSource) sampleInputs
theorem actualSampleTrace :
    EpochModule.observeModule naturalNumbers parsedSource artifactBytes actualMetadata sampleInputs =
      some sampleObservations := by
  rw [actualOriginalSourceTrace naturalNumbers natural_laws sampleInputs]
  simp [EpochModule.sourceObservation, exactSourceRead, sampleObservations]
theorem targetedBound : ${proposition} := by decide
#print axioms actualSampleTrace
#print axioms targetedBound
`;
}

export function targetedFailure(input, targetTheorem) {
  const start = input.indexOf(`theorem ${targetTheorem} `);
  if (start < 0) throw new Error('missing target theorem');
  const proof = input.indexOf(':= by decide', start);
  if (proof < 0) throw new Error('missing target proof');
  const end = input.indexOf('\n', proof);
  return input.slice(0, end < 0 ? input.length : end + 1);
}
