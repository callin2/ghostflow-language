import { theoremInput } from './bridge.mjs';

export function sourceTheoremInput(evidence, originalSourceBytes) {
  const { origin, site } = evidence.projection;
  return theoremInput(evidence).replace('import SensorProfile', 'import SensorSourceReader') + `
open BoolTranslation
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
def originalSourceBytes : SourceReader.SourceBytes := ${JSON.stringify([...originalSourceBytes])}
def parsedSource : SensorSourceReader.ParsedSource := ⟨sourceProfile, ${origin}, ${site}⟩
theorem exactSourceRead : SensorSourceReader.readSource originalSourceBytes = some parsedSource := by decide
theorem parsedOrigin : parsedSource.origin = 1 :=
  (SensorSourceReader.readSource_ids originalSourceBytes parsedSource exactSourceRead).1
theorem parsedSite : parsedSource.site = 5 :=
  (SensorSourceReader.readSource_ids originalSourceBytes parsedSource exactSourceRead).2
theorem originalSourceOrigin : (SensorSourceReader.readSource originalSourceBytes).map (·.origin) = some 1 := by
  rw [exactSourceRead]
  decide
theorem originalSourceSite : (SensorSourceReader.readSource originalSourceBytes).map (·.site) = some 5 := by
  rw [exactSourceRead]
  decide
theorem sourceMetadataBound : actualMetadata = SensorSourceReader.metadataOf parsedSource := by decide
theorem originalSourceObservedExecution (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (reading : Reading) (stalePayload : Bool) :
    observeModule ops artifactBytes actualMetadata (rails ops reading stalePayload) =
      SensorSourceReader.sourceObservation originalSourceBytes reading :=
  SensorSourceReader.loaded_observation originalSourceBytes parsedSource artifactBytes actualMetadata
    exactSourceRead actualLoaded sourceMetadataBound ops laws reading stalePayload
#print axioms exactSourceRead
#print axioms originalSourceOrigin
#print axioms originalSourceSite
#print axioms sourceMetadataBound
#print axioms originalSourceObservedExecution
`;
}

export function sourceAdmissionInput(bytes, accepted) {
  return `import SensorSourceReader
open BoolTranslation
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
def originalSourceBytes : SourceReader.SourceBytes := ${JSON.stringify([...bytes])}
theorem sourceAdmission : (SensorSourceReader.readSource originalSourceBytes).isSome = ${accepted} := by decide
#print axioms sourceAdmission
`;
}
