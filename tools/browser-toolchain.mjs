/** Browser/Worker public compiler entry with no host I/O dependencies. */
export { inspectSourceChanges, sourceChangeInventory } from './source-changes.mjs';
export { planSourceUpdate, verifySourceUpdate } from './update-request.mjs';
export { compileSource, emitInteractionSchema } from './compile-source.mjs';
export { previewLegacyScalarMigration, inspectLegacyAdmissionSource, assertLegacyAdmissionTarget, validateLegacyAdmission, preflightLegacyAdmission, LegacyAdmissionError } from './legacy-admission.mjs';
export { intentInterpretationDigest, intentConditionDigest, INTENT_EVIDENCE_LIMITS } from './intent-evidence.mjs';
export { prepareOutputExplanation, joinOutputExplanation, EXPLANATION_LIMITS } from './explanation.mjs';
export { compileBoundResourceControl, verifyBoundResourceCompilation, observeBoundResourceTrace } from './bound-resource-control.mjs';
