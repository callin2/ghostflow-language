import { leanExpr } from './bridge.mjs';

const nameBytes = name => JSON.stringify([...new TextEncoder().encode(name)]);

export const readerReduction = `readModule, readHeader, readStrategy, readOutputs,
    readMany, readState, readOutput, readTransition, readExpression, readName, readBlob,
    readU32, readU16, readByte, readBytes, require, bind, pure, Functor.map,
    StateT.bind, StateT.pure, StateT.map, Serialization.decode, Serialization.scan,
    identifier, letter`;

export function loaderTheoremInput({ projection, artifact }) {
  const states = projection.states.map(s => `(${nameBytes(s.name)}, ${s.initial})`);
  const transitions = projection.transitions.map(t => leanExpr(t.expression));
  const outputs = projection.outputs.map(o => `(${nameBytes(o.name)}, ${leanExpr(o.expression)})`);
  return `import ModuleLoader
open BoolTranslation BoolTranslation.ModuleEnvelope BoolTranslation.ModuleLoader
set_option maxRecDepth 8192
set_option maxHeartbeats 4000000
def sourceModule : Module := ⟨${nameBytes(projection.name)}, [${states.join(', ')}], [${transitions.join(', ')}], [${outputs.join(', ')}]⟩
def artifactBytes : List Nat := ${JSON.stringify(artifact.bytes)}
theorem exactModuleLoaded : load artifactBytes = some sourceModule := by
  apply load_of_read
  · simp [artifactBytes, sourceModule, ${readerReduction}] <;> decide
  · decide
theorem loadedWholeBytes : encodeModule sourceModule = .ok artifactBytes :=
  load_sound artifactBytes sourceModule exactModuleLoaded
theorem loadedFullyConsumed : readModule artifactBytes = some (sourceModule, []) :=
  load_consumed artifactBytes sourceModule exactModuleLoaded
theorem loadedTick (env : Env) :
    tick artifactBytes env = some (sourceTick sourceModule.transitions (targets sourceModule) (sourceModule.outputs.map Prod.snd) env) :=
  loaded_tick artifactBytes sourceModule exactModuleLoaded env
theorem loadedInitialization : initialState artifactBytes = some (sourceModule.states.map Prod.snd) :=
  loaded_initial artifactBytes sourceModule exactModuleLoaded
theorem loadedInitializedTrace (n : Nat) :
    trace artifactBytes n = some (sourceTrace sourceModule n (sourceModule.states.map Prod.snd)) :=
  initialized_trace artifactBytes sourceModule exactModuleLoaded n
#print axioms exactModuleLoaded
#print axioms loadedWholeBytes
#print axioms loadedFullyConsumed
#print axioms loadedTick
#print axioms loadedInitialization
#print axioms loadedInitializedTrace
`;
}

export function loaderAdmissionInput(bytes, accepted) {
  return `import ModuleLoader
open BoolTranslation BoolTranslation.ModuleEnvelope BoolTranslation.ModuleLoader
set_option maxRecDepth 8192
set_option maxHeartbeats 4000000
def artifactBytes : List Nat := ${JSON.stringify(bytes)}
theorem loaderAdmission : (load artifactBytes).isSome = ${accepted} := by
  simp [artifactBytes, load, ${readerReduction}] <;> decide
#print axioms loaderAdmission
`;
}
