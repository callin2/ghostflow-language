import { leanExpr } from './bridge.mjs';

const nameBytes = name => JSON.stringify([...new TextEncoder().encode(name)]);

export function moduleTheoremInput({ projection, artifact }) {
  const states = projection.states.map(s => `(${nameBytes(s.name)}, ${s.initial})`);
  const transitions = projection.transitions.map(t => leanExpr(t.expression));
  const outputs = projection.outputs.map(o => `(${nameBytes(o.name)}, ${leanExpr(o.expression)})`);
  return `import ModuleEnvelope
open BoolTranslation BoolTranslation.ModuleEnvelope
set_option maxRecDepth 8192
set_option maxHeartbeats 4000000
def sourceModule : Module := ⟨${nameBytes(projection.name)}, [${states.join(', ')}], [${transitions.join(', ')}], [${outputs.join(', ')}]⟩
def artifactBytes : List Nat := ${JSON.stringify(artifact.bytes)}
theorem wholeModuleEncoded : encodeModule sourceModule = .ok artifactBytes := by decide
theorem wholeModulePartition : artifactBytes = header sourceModule ++ records (transitionEntries sourceModule) ++ u16 sourceModule.outputs.length ++ records (outputEntries sourceModule) ++ u16 0 :=
  section_partition sourceModule artifactBytes wholeModuleEncoded
theorem wholeModuleRecovered :
    (transitionSlices sourceModule artifactBytes).mapM (Serialization.decode false) = some sourceModule.transitions ∧
    (outputSlices sourceModule artifactBytes).mapM (Serialization.decode true) = some (sourceModule.outputs.map Prod.snd) :=
  recovered_module sourceModule artifactBytes wholeModuleEncoded
theorem wholeModuleTick (env : Env) :
    rawTick sourceModule artifactBytes env = some (sourceTick sourceModule.transitions (targets sourceModule) (sourceModule.outputs.map Prod.snd) env) :=
  module_tick sourceModule artifactBytes wholeModuleEncoded env
#print axioms wholeModuleEncoded
#print axioms wholeModulePartition
#print axioms wholeModuleRecovered
#print axioms wholeModuleTick
`;
}
