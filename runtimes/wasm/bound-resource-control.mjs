import { verifyBoundResourceCompilation } from '../../tools/bound-resource-control.mjs';
import { FramedGhostFlowRuntime } from './framed-runtime.mjs';

// This registry covers this module in one JavaScript realm, including pending
// instantiation. A multi-Worker installation host must arbitrate all writers.
const activeWriters = new Map();
const creation = Symbol('validated bound runtime creation');

/** Software-only final logical writer. It performs no physical I/O. */
export class BoundResourceControlRuntime {
  #runtime;
  #compiled;
  #identities;
  #owner;

  static async instantiate(wasmBytes, compilation) {
    const checked = verifyBoundResourceCompilation(compilation);
    const identities = checked.manifest.resourceBinding.resources.map(resource => resource.resourceId);
    for (const identity of identities) if (activeWriters.has(identity)) throw new Error(`resource already has an active writer: ${identity}`);
    const owner = Symbol('bound resource writer');
    for (const identity of identities) activeWriters.set(identity, owner);
    let runtime;
    try {
      runtime = await FramedGhostFlowRuntime.instantiate(wasmBytes);
      runtime.load(checked.bytes);
      for (const output of checked.manifest.outputs) runtime.addCapability('actuator', output.name, 'bool');
      runtime.activateResourceBinding(checked.resourceBindingActivation);
      return new BoundResourceControlRuntime(runtime, checked, identities, owner, creation);
    } catch (error) {
      runtime?.dispose();
      for (const identity of identities) if (activeWriters.get(identity) === owner) activeWriters.delete(identity);
      throw error;
    }
  }

  constructor(runtime, compilation, identities, owner, token) {
    if (token !== creation) throw new Error('use BoundResourceControlRuntime.instantiate with a checked artifact');
    this.#runtime = runtime; this.#compiled = compilation; this.#identities = identities; this.#owner = owner;
  }

  scan(frame) {
    if (!this.#runtime) throw new Error('bound resource runtime is disposed');
    return this.#runtime.scanResourceBinding(frame, this.#compiled.resourceBindingScan);
  }

  dispose() {
    this.#runtime?.dispose(); this.#runtime = null;
    for (const identity of this.#identities) if (activeWriters.get(identity) === this.#owner) activeWriters.delete(identity);
  }
}

/** Reference simulation executes the same framed Rust guard; it adds no policy. */
export async function simulateBoundResourceControl(wasmBytes, compilation, frames) {
  const runtime = await BoundResourceControlRuntime.instantiate(wasmBytes, compilation);
  try { return frames.map(frame => runtime.scan(frame)); }
  finally { runtime.dispose(); }
}
