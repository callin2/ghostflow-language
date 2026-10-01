/** Browser/Worker public compiler entry with no host I/O dependencies. */
export { compileSource, emitInteractionSchema } from './compile-source.mjs';
export { compileBoundResourceControl, verifyBoundResourceCompilation, observeBoundResourceTrace } from './bound-resource-control.mjs';
