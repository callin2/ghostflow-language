import assert from 'node:assert/strict';
import {compileSourceSync} from '../../tools/compile-source.mjs';
import {extractLiterate} from '../../tools/literate.mjs';
import {parseControl} from '../../tools/control.mjs';
import {sha256} from '../bool-sensor-state-validation/bridge.mjs';
export {sha256};
const list=JSON.stringify, name=s=>list([...Buffer.from(s)]);

export function locate(bytes) {
  const b=Buffer.from(bytes);let at=6;
  const u16=()=>{const n=b.readUInt16LE(at);at+=2;return n;};
  const u32=()=>{const n=b.readUInt32LE(at);at+=4;return n;};
  const text=()=>{const n=u16();return b.subarray(at,at+=n).toString();};
  const blob=()=>{const n=u32(),start=at;return {start,bytes:[...b.subarray(at,at+=n)]};};
  const moduleName=text();assert.equal(u32(),1);
  const inputs=[];for(let n=u16();n-->0;)inputs.push({name:text(),type:b[at++]});
  const states=[];for(let n=u16();n-->0;){const stateName=text(),type=b[at++],start=at,size=type===1?1:8;
    states.push({name:stateName,type,start,initial:[...b.subarray(at,at+=size)]});}
  assert.equal(u16(),1);assert.equal(text(),'control');assert.equal(u32(),0);const capabilities=blob();
  const transitions=[];for(let n=u16();n-->0;){const target=u16();transitions.push({target,...blob()});}
  assert.equal(u16(),1);const outputName=text(),type=b[at++],output={name:outputName,type,...blob()};
  assert.equal(u16(),0);assert.equal(at,b.length);
  return {name:moduleName,inputs,states,capabilities:capabilities.bytes,transitions,output};
}

export function compileEvidence(source,filename) {
  const ast=parseControl(extractLiterate(source,{filename}).code,{filename});
  assert.equal(ast.imports.length,0);assert.equal(ast.body.length,6);
  const [sensor,state,output,transition,connection,timer]=ast.body;
  assert.deepEqual(ast.body.map(x=>x.kind),['sensor','state','output','next','connection','timer']);
  assert.equal(timer.call.name,'elapsed');assert.equal(timer.call.args.length,1);
  assert.equal(timer.call.args[0].name,state.name);assert.equal(timer.call.named.length,0);
  const p={name:ast.name,sensor:sensor.name,state:state.name,initial:state.initial.raw==='true',
    output:output.names[0],origin:sensor.id,site:transition.value.test.right.id,timer:timer.name,timerNode:timer.id};
  assert.deepEqual([p.origin,p.site,p.timerNode],[1,7,18]);
  const c=compileSourceSync(source,{filename}),bytes=[...c.bytes];
  return {projection:p,source:{filename,sha256:sha256(source)},originalSourceBytes:[...Buffer.from(source)],
    bytes,bytecodeSha256:sha256(c.bytes),located:locate(bytes),manifest:c.manifest,metadata:c.traceMetadata};
}
const profile=p=>`⟨⟨⟨${name(p.name)}, ${name(p.sensor)}, ${name(p.state)}, ${p.initial}, ${name(p.output)}⟩, ${p.origin}, ${p.site}⟩, ${name(p.timer)}, ${p.timerNode}⟩`;
const codes=l=>`⟨${l.transitions.map(t=>list(t.bytes)).join(',')}, ${list(l.output.bytes)}⟩`;
function metadata(e) {
  const sensors=e.manifest.sensors.map(s=>`⟨${name(s.name)}, ${name(s.type)}, [${[s.valueInput,s.okInput,s.faultInput].map(name).join(',')}]⟩`);
  const sites=e.metadata.resultSites.map(s=>`⟨${s.site}, ${s.nodeId}, ${name(s.kind)}, ${name(s.errorType)}, [${s.origins.map(o=>`⟨${o.tag}, ${o.nodeId}, ${name(o.kind)}, ${name(o.name)}⟩`).join(',')}]⟩`);
  const bindings=e.metadata.bindings.filter(b=>b.generated).map(b=>`⟨${b.nodeId}, ${name(b.kind)}, ${name(b.name)}, [${b.fields.map(name).join(',')}], ${name(b.generated.declaration)}, ${name(b.generated.role)}⟩`);
  const timers=e.manifest.timers.map(t=>`⟨${name(t.name)}, ${name(t.state)}, ${name(t.clockInput)}⟩`);
  return `(([${sensors.join(',')}], [${sites.join(',')}]), [${bindings.join(',')}], [${timers.join(',')}])`;
}

export function theoremInput(e) {
  const l=locate(e.bytes);
  return `import EpochModule
open BoolTranslation BoolTranslation.SensorMachine BoolTranslation.EpochMachine
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000
def originalSourceBytes : SourceReader.SourceBytes := ${list(e.originalSourceBytes)}
def parsedSource : EpochSource.ParsedSource := ${profile(e.projection)}
def artifactBytes : List Nat := ${list(e.bytes)}
def actualCodes : EpochModule.Codes := ${codes(l)}
def actualMetadata : EpochSource.Metadata := ${metadata(e)}
theorem exactSourceRead : EpochSource.readSource originalSourceBytes = some parsedSource := by decide
theorem structurallyParsed : EpochModule.readRaw parsedSource artifactBytes = some (actualCodes, []) := by decide
theorem codeBinding : actualCodes = EpochModule.expectedCodes := by decide
theorem metadataBinding : actualMetadata = EpochSource.metadataOf parsedSource := by decide
${[...l.transitions.map((t,i)=>[t,['SensorStateMachine.transitionCode','sinceCode','initializedCode'][i]]),[l.output,'SensorStateMachine.outputCode']].map(([s,c],i)=>`theorem rawSlice${i} : (artifactBytes.drop ${s.start}).take ${s.bytes.length} = ${c} := by decide`).join('\n')}
theorem actualOriginalSourceTrace (ops : NumberOps N) (laws : SmallNumberLaws ops) (inputs : List (Input N)) :
    EpochModule.observeModule ops parsedSource artifactBytes actualMetadata inputs =
      EpochModule.sourceObservation ops originalSourceBytes inputs :=
  EpochModule.original_observed_trace originalSourceBytes parsedSource artifactBytes actualMetadata exactSourceRead
    (by rw [structurallyParsed, codeBinding]) metadataBinding ops laws inputs
#print axioms exactSourceRead
#print axioms structurallyParsed
#print axioms codeBinding
#print axioms metadataBinding
#print axioms actualOriginalSourceTrace
`;
}

export function witnessInput(e,{held=false,initialized=false,reading='(.healthy false)',stale=true,since=11,now=29}={}) {
  const l=locate(e.bytes);
  return `import EpochModule
open BoolTranslation BoolTranslation.SensorMachine BoolTranslation.EpochMachine
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000
def parsedSource : EpochSource.ParsedSource := ${profile(e.projection)}
def artifactBytes : List Nat := ${list(e.bytes)}
def actualCodes : EpochModule.Codes := ${codes(l)}
theorem structurallyParsed : EpochModule.readRaw parsedSource artifactBytes = some (actualCodes, []) := by decide
theorem targetedEquality : rawScan naturalNumbers actualCodes.held actualCodes.since actualCodes.initialized actualCodes.output
    ⟨${held}, ${since}, ${initialized}⟩ ⟨${reading}, ${stale}, ${now}⟩ =
      some (sourceScan ⟨${held}, ${since}, ${initialized}⟩ ⟨${reading}, ${stale}, ${now}⟩) := by decide
`;
}
