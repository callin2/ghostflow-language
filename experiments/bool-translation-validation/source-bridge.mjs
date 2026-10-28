import { loaderTheoremInput } from './loader-bridge.mjs';

export function sourceTheoremInput(evidence, originalSourceBytes) {
  return loaderTheoremInput(evidence).replace('import ModuleLoader', 'import SourceReader') + `
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
def originalSourceBytes : SourceReader.SourceBytes := ${JSON.stringify([...originalSourceBytes])}
theorem exactSourceRead : SourceReader.readSource originalSourceBytes = some sourceModule := by decide
theorem originalSourceInitializedTrace (n : Nat) :
    ModuleLoader.trace artifactBytes n = SourceReader.sourceTrace originalSourceBytes n :=
  SourceReader.initialized_trace originalSourceBytes artifactBytes sourceModule exactSourceRead exactModuleLoaded n
#print axioms exactSourceRead
#print axioms originalSourceInitializedTrace
`;
}

export function sourceAdmissionInput(originalSourceBytes, accepted) {
  return `import SourceReader
open BoolTranslation
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
def originalSourceBytes : SourceReader.SourceBytes := ${JSON.stringify([...originalSourceBytes])}
theorem sourceAdmission : (SourceReader.readSource originalSourceBytes).isSome = ${accepted} := by decide
#print axioms sourceAdmission
`;
}
