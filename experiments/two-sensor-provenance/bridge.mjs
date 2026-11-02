import assert from 'node:assert/strict';
import { compileSourceSync } from '../../tools/compile-source.mjs';
import { extractLiterate } from '../../tools/literate.mjs';
import { parseControl } from '../../tools/control.mjs';
import { sha256 } from '../bool-sensor-validation/bridge.mjs';
export { sha256 };
const list = JSON.stringify;
const name = s => list([...Buffer.from(s)]);

// Trusted JS transport/locator. PairModule.readRaw independently checks the full
// original byte list in Lean; this AST projection is not a formal source reader.
export function locate(bytes) {
  const b = Buffer.from(bytes); let at = 6;
  const u16 = () => { const n = b.readUInt16LE(at); at += 2; return n; };
  const u32 = () => { const n = b.readUInt32LE(at); at += 4; return n; };
  const text = () => { const n = u16(); const s = b.subarray(at, at += n).toString(); return s; };
  const blob = () => { const n = u32(), start = at; return { start, bytes: [...b.subarray(at, at += n)] }; };
  const moduleName = text(); assert.equal(u32(), 1);
  const count = u16(), inputs = [];
  for (let i = 0; i < count; i++) inputs.push({ name: text(), type: b[at++] });
  assert.equal(u16(), 0); assert.equal(u16(), 1); assert.equal(text(), 'control'); assert.equal(u32(), 0);
  const capabilities = blob(); assert.equal(u16(), 0);
  const outputCount = u16(), outputs = [];
  for (let i = 0; i < outputCount; i++) { const n = text(), type = b[at++]; outputs.push({ name: n, type, ...blob() }); }
  assert.equal(u16(), 0); assert.equal(at, b.length);
  return { name: moduleName, inputs, capabilities: capabilities.bytes, outputs };
}

export function compileEvidence(source, filename) {
  const ast = parseControl(extractLiterate(source, { filename }).code, { filename });
  assert.equal(ast.imports.length, 0); assert.equal(ast.body.length, 6);
  const [left, right, lo, ro, lc, rc] = ast.body;
  for (const s of [left, right]) {
    assert.equal(s.kind, 'sensor'); assert.equal(s.type.name, 'Bool');
    assert.equal(s.optional, false); assert.deepEqual(s.options, {});
  }
  for (const o of [lo, ro]) {
    assert.equal(o.kind, 'output'); assert.equal(o.type.name, 'Bool');
    assert.equal(o.initial, null); assert.equal(o.names.length, 1);
  }
  assert.equal(new Set([left.name, right.name, ...lo.names, ...ro.names]).size, 4);
  const projection = [lc, rc].map((c, i) => {
    const sensor = [left, right][i], output = [lo, ro][i].names[0];
    assert.equal(c.kind, 'connection'); assert.equal(c.name, output);
    const p = c.value; assert.equal(p.kind, 'binary'); assert.equal(p.op, '|>');
    assert.equal(p.left.kind, 'reference'); assert.equal(p.left.name, sensor.name);
    assert.equal(p.right.kind, 'call'); assert.equal(p.right.name, 'recover');
    assert.deepEqual(p.right.named, []); assert.equal(p.right.args.length, 1);
    assert.equal(p.right.args[0].kind, 'literal'); assert.equal(p.right.args[0].raw, 'false');
    return { sensor: sensor.name, output, origin: sensor.id, site: p.right.id };
  });
  assert.deepEqual(projection.map(p => [p.origin, p.site]), [[1, 7], [2, 12]]);
  const c = compileSourceSync(source, { filename }), bytes = [...c.bytes], located = locate(bytes);
  return { originalSourceBytes: [...Buffer.from(source)], originalSourceSha256: sha256(source), sourceControlName: ast.name,
    bytes, bytecodeSha256: sha256(c.bytes), projection, located, manifest: c.manifest, metadata: c.traceMetadata };
}

function parsed(p) {
  return `⟨${name(p.name)}, [${p.inputs.map(i => `(${name(i.name)}, ${i.type})`).join(',')}], ${list(p.capabilities)}, [${p.outputs.map(o => `(${name(o.name)}, ${o.type}, ${list(o.bytes)})`).join(',')}]⟩`;
}
function metadata(m, sensors) {
  const sm = sensors.map(s => `⟨${name(s.name)}, ${name(s.type)}, [${[s.valueInput, s.okInput, s.faultInput].map(name).join(',')}]⟩`);
  const sites = m.resultSites.map(s => `⟨${s.site}, ${s.nodeId}, ${name(s.kind)}, ${name(s.errorType)}, [${s.origins.map(o => `⟨${o.tag}, ${o.nodeId}, ${name(o.kind)}, ${name(o.name)}⟩`).join(',')}]⟩`);
  return `([${sm.join(',')}], [${sites.join(',')}])`;
}
export function theoremInput(e, baseline = e) {
  const sensors = baseline.projection.map(p => ({name:p.sensor,type:'Bool',valueInput:`__gf_sensor_value_${p.sensor}`,
    okInput:`__gf_sensor_ok_${p.sensor}`,faultInput:`__gf_sensor_fault_${p.sensor}`}));
  const expectedTrace = {resultSites:baseline.projection.map(p=>({site:p.site,nodeId:p.site,kind:'recover',errorType:'SensorFault',
    origins:[{tag:p.origin,nodeId:p.origin,kind:'sensor',name:p.sensor}]}))};
  const independent = {name:baseline.sourceControlName, inputs:sensors.flatMap(s=>[
    {name:s.valueInput,type:1},{name:s.okInput,type:1},{name:s.faultInput,type:2}]),capabilities:baseline.located.capabilities,
    outputs:baseline.projection.map((p,i)=>({name:p.output,type:1,bytes:baseline.located.outputs[i].bytes}))};
  const expectedParsed = parsed(independent).replace(list(baseline.located.outputs[0].bytes), '(code false)').replace(list(baseline.located.outputs[1].bytes), '(code true)');
  return `import PairModule
open BoolTranslation BoolTranslation.ModuleEnvelope BoolTranslation.SensorMachine BoolTranslation.SensorPairMachine BoolTranslation.SensorProfile BoolTranslation.PairModule
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
def originalSourceBytes : List Nat := ${list(e.originalSourceBytes)}
theorem originalBytesBound : originalSourceBytes = ${list(baseline.originalSourceBytes)} := by decide
def artifactBytes : List Nat := ${list(e.bytes)}
def actualParsed : PairModule.Parsed := ${parsed(locate(e.bytes))}
theorem structurallyParsed : PairModule.readRaw artifactBytes = some (actualParsed, []) := by decide
def expectedParsed : PairModule.Parsed := ${expectedParsed}
theorem actualBinding : actualParsed = expectedParsed := by decide
def actualMetadata : Metadata := ${metadata(e.metadata, e.manifest.sensors)}
def expectedMetadata : Metadata := ${metadata(expectedTrace, sensors)}
theorem metadataBinding : actualMetadata = _root_.expectedMetadata := by decide
${baseline.located.outputs.map((o, i) => `theorem rawSlice${i} : (artifactBytes.drop ${o.start}).take 45 = code ${i ? 'true' : 'false'} := by decide`).join('\n')}
theorem actualPairedExecution (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (left right : Reading) (leftStale rightStale : Bool) :
    PairModule.evaluate ops artifactBytes (pairRails ops left right leftStale rightStale) =
      some (some (SensorPairMachine.expected false left), some (SensorPairMachine.expected true right)) := by
  simpa [PairModule.evaluate, structurallyParsed, actualBinding, expectedParsed] using
    congrArg some (paired_recovery ops laws left right leftStale rightStale)
#print axioms structurallyParsed
#print axioms actualBinding
#print axioms metadataBinding
#print axioms actualPairedExecution
`;
}

export function witnessInput(bytes, side, rightFault = false) {
  const p = locate(bytes), expression = p.outputs[side ? 1 : 0].bytes;
  return `import PairModule
open BoolTranslation BoolTranslation.SensorMachine BoolTranslation.SensorPairMachine
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000
def artifactBytes : List Nat := ${list(bytes)}
def parsed : PairModule.Parsed := ${parsed(p)}
theorem structurallyParsed : PairModule.readRaw artifactBytes = some (parsed, []) := by decide
theorem targetedEquality : SensorMachine.run naturalNumbers ${list(expression)}
    (pairRails naturalNumbers ${rightFault ? '(.healthy true) (.fault .invalid)' : '(.fault .stale) (.healthy true)'} true false) =
      some (SensorPairMachine.expected ${side} ${rightFault ? (side ? '(.fault .invalid)' : '(.healthy true)') : (side ? '(.healthy true)' : '(.fault .stale)')}) := by decide
`;
}
