// Current Node consumers share the portable implementation and its realm-local
// writer registry; this compatibility import adds no separate execution policy.
export { BoundResourceControlRuntime, simulateBoundResourceControl } from '../wasm/bound-resource-control.mjs';
