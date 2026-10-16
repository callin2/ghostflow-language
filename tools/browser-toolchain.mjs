/** Browser/Worker public compiler entry with no host I/O dependencies. */
export { compileSource, emitInteractionSchema } from './compile-source.mjs';
export { prepareOutputExplanation, joinOutputExplanation, EXPLANATION_LIMITS } from './explanation.mjs';
export { compileBoundResourceControl, verifyBoundResourceCompilation, observeBoundResourceTrace } from './bound-resource-control.mjs';
