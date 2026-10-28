import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileSourceSync } from '../../tools/compile-source.mjs';
import { extractLiterate } from '../../tools/literate.mjs';
import { parseControl } from '../../tools/control.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const names = value => JSON.stringify([...new TextEncoder().encode(value)]);

export function projectSource(source, filename) {
  const ast = parseControl(extractLiterate(source, { filename }).code, { filename });
  assert.equal(ast.kind, 'control');
  assert.equal(ast.imports.length, 0);
  assert.equal(ast.body.length, 3, 'sensor proof admits exactly one input, output and recovery connection');
  const [sensor, output, connection] = ast.body;
  assert.equal(sensor.kind, 'sensor');
  assert.equal(sensor.type.name, 'Bool');
  assert.equal(sensor.optional, false);
  assert.deepEqual(sensor.options, {});
  assert.equal(output.kind, 'output');
  assert.equal(output.type.name, 'Bool');
  assert.equal(output.initial, null);
  assert.equal(output.names.length, 1);
  assert.notEqual(sensor.name, output.names[0]);
  assert.equal(connection.kind, 'connection');
  assert.equal(connection.name, output.names[0]);
  const pipe = connection.value;
  assert.equal(pipe.kind, 'binary');
  assert.equal(pipe.op, '|>');
  assert.equal(pipe.left.kind, 'reference');
  assert.equal(pipe.left.name, sensor.name);
  assert.equal(pipe.right.kind, 'call');
  assert.equal(pipe.right.name, 'recover');
  assert.equal(pipe.right.named.length, 0);
  assert.equal(pipe.right.args.length, 1);
  assert.equal(pipe.right.args[0].kind, 'literal');
  assert.equal(pipe.right.args[0].raw, 'false');
  assert.deepEqual([sensor.id, pipe.right.id], [1, 5], 'source node assignment is outside this bounded profile');
  return { name: ast.name, sensor: sensor.name, output: output.names[0], origin: sensor.id, site: pipe.right.id };
}

export function compileEvidence(source, filename) {
  const projection = projectSource(source, filename);
  const compiled = compileSourceSync(source, { filename });
  const sensor = compiled.manifest.sensors[0];
  assert.equal(compiled.manifest.sensors.length, 1);
  assert.deepEqual(sensor, {
    name: projection.sensor, type: 'Bool', sampleMs: null, validMin: null, validMax: null,
    filter: null, window: null, staleMs: null, recoverSamples: null,
    valueInput: `__gf_sensor_value_${projection.sensor}`, okInput: `__gf_sensor_ok_${projection.sensor}`,
    faultInput: `__gf_sensor_fault_${projection.sensor}`,
  });
  assert.equal(compiled.sourceMap.find(x => x.id === projection.origin)?.kind, 'sensor');
  assert.equal(compiled.sourceMap.find(x => x.id === projection.site)?.kind, 'call');
  const metadata = {
    sensors: compiled.manifest.sensors.map(s => ({ name: s.name, type: s.type, rails: [s.valueInput, s.okInput, s.faultInput] })),
    sites: compiled.traceMetadata.resultSites.map(s => ({ site: s.site, nodeId: s.nodeId, kind: s.kind,
      errorType: s.errorType, origins: s.origins })),
  };
  return { projection, metadata, bytes: [...compiled.bytes], source: { filename, sha256: sha256(source) },
    bytecodeSha256: sha256(compiled.bytes) };
}

export function theoremInput({ projection: p, metadata, bytes }) {
  assert.deepEqual([p.origin, p.site], [1, 5], 'source node assignment is outside this bounded profile');
  const sensors = metadata.sensors.map(s => `⟨${names(s.name)}, ${names(s.type)}, [${s.rails.map(names).join(', ')}]⟩`);
  const sites = metadata.sites.map(s => {
    const origins = s.origins.map(o => `⟨${o.tag}, ${o.nodeId}, ${names(o.kind)}, ${names(o.name)}⟩`);
    return `⟨${s.site}, ${s.nodeId}, ${names(s.kind)}, ${names(s.errorType)}, [${origins.join(', ')}]⟩`;
  });
  return `import SensorProfile
open BoolTranslation.SensorMachine BoolTranslation.SensorProfile
set_option maxRecDepth 8192
set_option maxHeartbeats 4000000
def sourceProfile : Profile := ⟨${names(p.name)}, ${names(p.sensor)}, ${names(p.output)}⟩
def artifactBytes : List Nat := ${JSON.stringify(bytes)}
def actualMetadata : Metadata := ([${sensors.join(', ')}], [${sites.join(', ')}])
theorem actualLoaded : load artifactBytes = some ⟨sourceProfile, recoverCode⟩ := by decide
theorem actualMetadataBound : actualMetadata = expectedMetadata sourceProfile := by decide
theorem actualRawExecution (ops : NumberOps N) (laws : SmallNumberLaws ops) (reading : Reading) (stalePayload : Bool) :
    runModule ops artifactBytes (rails ops reading stalePayload) = some (expected reading) :=
  loaded_recovery ops laws artifactBytes _ actualLoaded reading stalePayload
theorem actualMeaning (reading : Reading) :
    observe sourceProfile actualMetadata (expected reading) = some (observed reading) :=
  trace_meaning sourceProfile actualMetadata actualMetadataBound reading
theorem actualNaturalExecution (reading : Reading) (stalePayload : Bool) :
    runModule naturalNumbers artifactBytes (rails naturalNumbers reading stalePayload) = some (expected reading) :=
  actualRawExecution naturalNumbers natural_laws reading stalePayload
theorem actualObservedExecution (ops : NumberOps N) (laws : SmallNumberLaws ops) (reading : Reading) (stalePayload : Bool) :
    observeModule ops artifactBytes actualMetadata (rails ops reading stalePayload) = some (observed reading) :=
  loaded_observation ops laws artifactBytes _ actualMetadata actualLoaded actualMetadataBound reading stalePayload
#print axioms actualLoaded
#print axioms actualMetadataBound
#print axioms actualRawExecution
#print axioms actualMeaning
#print axioms actualNaturalExecution
#print axioms actualObservedExecution
`;
}

export function admissionInput(bytes) {
  return `import SensorProfile
open BoolTranslation.SensorProfile
set_option maxRecDepth 8192
set_option maxHeartbeats 4000000
theorem rejected : load ${JSON.stringify(bytes)} = none := by decide
#print axioms rejected
`;
}
