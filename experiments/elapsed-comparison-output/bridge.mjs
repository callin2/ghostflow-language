import assert from 'node:assert/strict';
import {compileSourceSync} from '../../tools/compile-source.mjs';
import {extractLiterate} from '../../tools/literate.mjs';
import {parseControl} from '../../tools/control.mjs';
import {sha256} from '../elapsed-epoch-validation/bridge.mjs';
export {sha256};
export const fixture = 'experiments/elapsed-comparison-output/fixtures/elapsed-comparison.ghost.md';
const list = JSON.stringify, name = s => list([...Buffer.from(s)]);

export function locate(bytes) {
  const buffer = Buffer.from(bytes);
  assert.deepEqual([...buffer.subarray(0, 6)], [71,70,66,49,3,0]);
  let at = 6;
  const u16 = () => {const value = buffer.readUInt16LE(at); at += 2; return value;};
  const u32 = () => {const value = buffer.readUInt32LE(at); at += 4; return value;};
  const text = () => {const size = u16(); return buffer.subarray(at, at += size).toString('utf8');};
  const blob = () => {const size = u32(), start = at; return {start, bytes: [...buffer.subarray(at, at += size)]};};
  const moduleName = text(); assert.equal(u32(), 1);
  const inputs = []; for (let n = u16(); n-- > 0;) inputs.push({name: text(), type: buffer[at++]});
  const states = []; for (let n = u16(); n-- > 0;) {const state = text(), type = buffer[at++], start = at;
    states.push({name: state, type, start, initial: [...buffer.subarray(at, at += type === 1 ? 1 : 8)]});}
  assert.equal(u16(), 1); assert.equal(text(), 'control'); assert.equal(u32(), 0);
  const capabilities = blob(), transitions = [];
  for (let n = u16(); n-- > 0;) transitions.push({target: u16(), ...blob()});
  assert.equal(u16(), 2);
  const outputs = []; for (let n = 0; n < 2; n++) outputs.push({name: text(), type: buffer[at++], ...blob()});
  assert.equal(u16(), 0); assert.equal(at, buffer.length);
  return {name: moduleName, inputs, states, capabilities, transitions, outputs};
}

export function compileEvidence(source, filename = fixture) {
  const ast = parseControl(extractLiterate(source, {filename}).code, {filename});
  assert.equal(ast.imports.length, 0);
  assert.deepEqual(ast.body.map(x => x.kind), ['sensor','state','output','next','connection','timer','output','connection']);
  const [sensor, state, output, transition, connection, timer, comparison, comparisonConnection] = ast.body;
  const projection = {name: ast.name, sensor: sensor.name, state: state.name, initial: state.initial.raw === 'true',
    output: output.names[0], origin: sensor.id, site: transition.value.test.right.id, timer: timer.name, timerNode: timer.id,
    comparison: comparison.names[0], declaration: comparison.id, connection: comparisonConnection.id};
  assert.equal(timer.call.name, 'elapsed'); assert.equal(timer.call.args.length, 1);
  assert.equal(timer.call.args[0].name, state.name); assert.equal(timer.call.named.length, 0);
  assert.equal(comparison.type.name, 'Bool'); assert.equal(comparison.names.length, 1);
  assert.equal(comparisonConnection.name, comparison.names[0]); assert.equal(comparisonConnection.value.kind, 'binary');
  assert.equal(comparisonConnection.value.op, '>=');
  assert.equal(comparisonConnection.value.left.kind, 'reference');
  assert.equal(comparisonConnection.value.left.name, timer.name);
  assert.equal(comparisonConnection.value.right.raw, '3000ms');
  assert.deepEqual([projection.origin, projection.site, projection.timerNode, projection.declaration, projection.connection], [1,7,18,19,23]);
  assert.equal(connection.value.kind, 'nextReference');
  const compiled = compileSourceSync(source, {filename}), bytes = [...compiled.bytes];
  return {projection, originalSourceBytes: [...Buffer.from(source)], source: {filename, sha256: sha256(source)}, bytes,
    bytecodeSha256: sha256(compiled.bytes), located: locate(bytes), manifest: compiled.manifest, metadata: compiled.traceMetadata};
}

function profile(p) {
  return `⟨⟨⟨⟨${name(p.name)},${name(p.sensor)},${name(p.state)},${p.initial},${name(p.output)}⟩,${p.origin},${p.site}⟩,${name(p.timer)},${p.timerNode}⟩,${name(p.comparison)},${p.declaration},${p.connection}⟩`;
}
function codes(located) {return `⟨⟨${located.transitions.map(t => list(t.bytes)).join(',')},${list(located.outputs[0].bytes)}⟩,${list(located.outputs[1].bytes)}⟩`;}
function metadata(evidence) {
  const sensors = evidence.manifest.sensors.map(s => `⟨${name(s.name)},${name(s.type)},[${[s.valueInput,s.okInput,s.faultInput].map(name).join(',')}]⟩`);
  const sites = evidence.metadata.resultSites.map(s => `⟨${s.site},${s.nodeId},${name(s.kind)},${name(s.errorType)},[${s.origins.map(o => `⟨${o.tag},${o.nodeId},${name(o.kind)},${name(o.name)}⟩`).join(',')}]⟩`);
  const timers = evidence.manifest.timers.map(t => `⟨${name(t.name)},${name(t.state)},${name(t.clockInput)}⟩`);
  const bindings = evidence.metadata.bindings.filter(b => b.generated).map(b => `⟨${b.nodeId},${name(b.kind)},${name(b.name)},[${b.fields.map(name).join(',')}],${name(b.generated.declaration)},${name(b.generated.role)}⟩`);
  const outputs = evidence.manifest.outputs.map(o => `⟨${name(o.name)},${name(o.type)}⟩`);
  const connections = evidence.metadata.bindings.filter(b => b.kind === 'connection').map(b => `⟨${b.nodeId},${name(b.kind)},${name(b.name)},[${b.fields.map(name).join(',')}]⟩`);
  const dependencies = evidence.metadata.dependencies.filter(d => d.target.field === 'requested').map(d => `⟨${name(d.target.field)},${name(d.target.name)},[${d.reads.map(r => `(${name(r.field)},${name(r.name)})`).join(',')}]⟩`);
  return `((([${sensors.join(',')}],[${sites.join(',')}]),[${bindings.join(',')}],[${timers.join(',')}]),[${outputs.join(',')}],[${connections.join(',')}],[${dependencies.join(',')}])`;
}

function definitions(evidence) {
  return `import ComparisonModule
open BoolTranslation BoolTranslation.SensorMachine BoolTranslation.EpochMachine BoolTranslation.ElapsedClockBounds
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000
def originalSourceBytes : SourceReader.SourceBytes := ${list(evidence.originalSourceBytes)}
def parsedSource : ComparisonSource.ParsedSource := ${profile(evidence.projection)}
def artifactBytes : List Nat := ${list(evidence.bytes)}
def actualCodes : ComparisonModule.Codes := ${codes(locate(evidence.bytes))}
def actualMetadata : ComparisonSource.Metadata := ${metadata(evidence)}
theorem exactSourceRead : ComparisonSource.readSource originalSourceBytes = some parsedSource := by decide
theorem structurallyParsed : ComparisonModule.readRaw parsedSource artifactBytes = some (actualCodes, []) := by decide
`;
}

export function theoremInput(evidence) {
  return definitions(evidence) + `theorem codeBinding : actualCodes = ComparisonModule.expectedCodes := by decide
theorem metadataBinding : actualMetadata = ComparisonSource.metadataOf parsedSource := by decide
theorem actualOriginalComparison (inputs : List (Input Nat)) (accepted : AcceptedFrom 0 inputs) :
    ∃ epochs observations,
      rawTrace naturalNumbers SensorStateMachine.transitionCode sinceCode initializedCode SensorStateMachine.outputCode
        (EpochModule.initial naturalNumbers parsedSource.epoch) inputs = some epochs ∧
      TraceBounds (EpochModule.initial naturalNumbers parsedSource.epoch) inputs epochs ∧
      ComparisonModule.observeModule parsedSource artifactBytes actualMetadata inputs = some observations ∧
      ComparisonModule.sourceObservation originalSourceBytes inputs = some observations :=
  ComparisonModule.original_comparison_trace originalSourceBytes parsedSource artifactBytes actualMetadata exactSourceRead
    (by rw [structurallyParsed, codeBinding]) metadataBinding inputs accepted
#print axioms exactSourceRead
#print axioms structurallyParsed
#print axioms codeBinding
#print axioms metadataBinding
#print axioms actualOriginalComparison
`;
}

export function observationInput(evidence, inputs, values, mutant = false) {
  return (mutant ? definitions(evidence) : theoremInput(evidence)) + `
def sampleInputs : List (Input Nat) := ${inputs}
def sampleEpochs := sourceTrace (EpochModule.initial naturalNumbers parsedSource.epoch) sampleInputs
def expectedObservations : List ComparisonMachine.Observation :=
  List.zipWith (fun epoch expired => ⟨epoch,expired,epoch.events⟩) sampleEpochs ${list(values)}
theorem actualObserved : ComparisonModule.moduleTrace parsedSource artifactBytes sampleInputs = some expectedObservations := by decide
` + (mutant ? `theorem targetedEquality : ComparisonModule.moduleTrace parsedSource artifactBytes sampleInputs =
    ComparisonMachine.expectedTrace (EpochModule.initial naturalNumbers parsedSource.epoch) sampleInputs sampleEpochs := by decide
` : '#print axioms actualObserved\n');
}

export function replaceComparison(evidence, code) {
  const changed = structuredClone(evidence), located = locate(changed.bytes), output = located.outputs[1];
  const size = Buffer.alloc(4); size.writeUInt32LE(code.length);
  changed.bytes = [...Buffer.concat([Buffer.from(changed.bytes.slice(0, output.start - 4)), size,
    Buffer.from(code), Buffer.from(changed.bytes.slice(output.start + output.bytes.length))])];
  return changed;
}

export function targetedFailure(input, target) {
  const start = input.indexOf(`theorem ${target} `); assert.ok(start >= 0);
  const proof = input.indexOf(':= by decide', start); assert.ok(proof >= 0);
  const end = input.indexOf('\n', proof);
  return input.slice(0, end < 0 ? input.length : end + 1);
}
