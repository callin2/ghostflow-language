import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileSourceSync } from '../../tools/compile-source.mjs';
import { extractLiterate } from '../../tools/literate.mjs';
import { parseControl } from '../../tools/control.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const names = value => JSON.stringify([...Buffer.from(value)]);

export function compileEvidence(source, filename) {
  const ast = parseControl(extractLiterate(source, { filename }).code, { filename });
  assert.equal(ast.imports.length, 0);
  assert.equal(ast.body.length, 5);
  const [sensor, state, output, transition, connection] = ast.body;
  assert.equal(sensor.kind, 'sensor');
  assert.equal(sensor.type.name, 'Bool');
  assert.equal(sensor.optional, false);
  assert.deepEqual(sensor.options, {});
  assert.equal(state.kind, 'state');
  assert.equal(state.type.name, 'Bool');
  assert.equal(state.initial.kind, 'literal');
  assert.ok(['true', 'false'].includes(state.initial.raw));
  assert.equal(output.kind, 'output');
  assert.equal(output.type.name, 'Bool');
  assert.equal(output.names.length, 1);
  assert.equal(output.initial, null);
  assert.equal(transition.kind, 'next');
  assert.equal(transition.name, state.name);
  assert.equal(transition.value.kind, 'if');
  const { test, yes, no } = transition.value;
  assert.equal(test.kind, 'binary');
  assert.equal(test.op, '|>');
  assert.equal(test.left.kind, 'reference');
  assert.equal(test.left.name, sensor.name);
  assert.equal(test.right.kind, 'call');
  assert.equal(test.right.name, 'recover');
  assert.equal(test.right.named.length, 0);
  assert.equal(test.right.args.length, 1);
  assert.equal(test.right.args[0].kind, 'literal');
  assert.equal(test.right.args[0].raw, 'false');
  assert.equal(yes.kind, 'unary');
  assert.equal(yes.op, '!');
  assert.equal(yes.value.kind, 'reference');
  assert.equal(yes.value.name, state.name);
  assert.equal(no.kind, 'reference');
  assert.equal(no.name, state.name);
  assert.equal(connection.kind, 'connection');
  assert.equal(connection.name, output.names[0]);
  assert.equal(connection.value.kind, 'nextReference');
  assert.equal(connection.value.name, state.name);
  const projection = { name: ast.name, sensor: sensor.name, state: state.name,
    initial: state.initial.raw === 'true', output: output.names[0], origin: sensor.id, site: test.right.id };
  const compiled = compileSourceSync(source, { filename });
  assert.equal(compiled.manifest.sensors.length, 1);
  const manifest = compiled.manifest.sensors[0];
  assert.deepEqual(manifest, { name: sensor.name, type: 'Bool', sampleMs: null, validMin: null, validMax: null,
    filter: null, window: null, staleMs: null, recoverSamples: null,
    valueInput: `__gf_sensor_value_${sensor.name}`, okInput: `__gf_sensor_ok_${sensor.name}`,
    faultInput: `__gf_sensor_fault_${sensor.name}` });
  const metadata = { sensors: compiled.manifest.sensors.map(s => ({ name: s.name, type: s.type,
    rails: [s.valueInput, s.okInput, s.faultInput] })),
    sites: compiled.traceMetadata.resultSites.map(s => ({ site: s.site, nodeId: s.nodeId,
      kind: s.kind, errorType: s.errorType, origins: s.origins })) };
  return { projection, metadata, bytes: [...compiled.bytes], source: { filename, sha256: sha256(source) },
    bytecodeSha256: sha256(compiled.bytes) };
}

export function theoremInput({ projection: p, metadata, bytes }, originalSourceBytes) {
  const sensors = metadata.sensors.map(s => `⟨${names(s.name)}, ${names(s.type)}, [${s.rails.map(names).join(', ')}]⟩`);
  const sites = metadata.sites.map(s => `⟨${s.site}, ${s.nodeId}, ${names(s.kind)}, ${names(s.errorType)}, [${s.origins.map(o =>
    `⟨${o.tag}, ${o.nodeId}, ${names(o.kind)}, ${names(o.name)}⟩`).join(', ')}]⟩`);
  return `import SensorStateSource
open BoolTranslation BoolTranslation.SensorMachine BoolTranslation.SensorStateMachine
open BoolTranslation.SensorStateProfile BoolTranslation.SensorStateSource
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
def originalSourceBytes : SourceReader.SourceBytes := ${JSON.stringify([...originalSourceBytes])}
def sourceProfile : SensorStateProfile.Profile := ⟨${names(p.name)}, ${names(p.sensor)}, ${names(p.state)}, ${p.initial}, ${names(p.output)}⟩
def parsedSource : SensorStateSource.ParsedSource := ⟨sourceProfile, ${p.origin}, ${p.site}⟩
def artifactBytes : List Nat := ${JSON.stringify(bytes)}
def actualMetadata : SensorProfile.Metadata := ([${sensors.join(', ')}], [${sites.join(', ')}])
theorem exactSourceRead : SensorStateSource.readSource originalSourceBytes = some parsedSource := by decide
theorem actualLoaded : SensorStateProfile.load artifactBytes = some ⟨sourceProfile, transitionCode, outputCode⟩ := by decide
theorem actualMetadataBound : actualMetadata = metadataOf parsedSource := by decide
theorem actualOriginalSourceTrace (ops : NumberOps N) (laws : SmallNumberLaws ops) (inputs : List ScanInput) :
    observeModule ops artifactBytes actualMetadata inputs = sourceObservation originalSourceBytes inputs :=
  original_source_input_trace originalSourceBytes parsedSource artifactBytes actualMetadata
    exactSourceRead actualLoaded actualMetadataBound ops laws inputs
#print axioms exactSourceRead
#print axioms actualLoaded
#print axioms actualMetadataBound
#print axioms actualOriginalSourceTrace
`;
}

export function admissionInput(bytes) {
  return `import SensorStateProfile
open BoolTranslation.SensorStateProfile
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
example : load ${JSON.stringify(bytes)} = none := by decide
`;
}

export function sourceAdmissionInput(bytes, accepted) {
  return `import SensorStateSource
open BoolTranslation.SensorStateSource
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
example : (readSource ${JSON.stringify([...bytes])}).isSome = ${accepted} := by decide
`;
}
