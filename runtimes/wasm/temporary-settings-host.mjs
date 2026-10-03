import { ControlRuntime } from './control-runtime.mjs';
import { canonicalJson } from '../../tools/canonical-json.mjs';
import { sha256Hex } from '../../tools/sha256.mjs';
import { isInt32, intSettingsIssue } from '../../tools/int-settings.mjs';
import { isTimeType, validateTimeValue } from '../../tools/time-literals.mjs';
import { compileSourceSync } from '../../tools/compile-source.mjs';

const clone = value => structuredClone(value);
const token = Symbol('temporary settings activation');
const exact = n => Number.isSafeInteger(n) && n >= 0;
const text = value => typeof value === 'string' && value.isWellFormed() && value.length > 0 && new TextEncoder().encode(value).length <= 128;
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g),pair=>Number.parseInt(pair,16));
const equal = (a,b) => canonicalJson(a) === canonicalJson(b);
const fail = reason => { throw new Error(`temporary settings: ${reason}`); };
class ReturnUnavailable extends Error {}

function shape(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || required.some(k => !Object.hasOwn(value,k))
    || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) fail('invalid envelope');
}
function payload(config, result) {
  shape(result, ['ok','type','value']);
  if (result.ok !== true || result.type !== config.type) fail('setting type or return validity');
  const value = result.value, s = config.settings;
  if (config.type.startsWith('TimeSlots<')) {
    shape(value,['kind','entries']);
    if (value.kind !== 'slots' || !Array.isArray(value.entries) || value.entries.length > config.capacity) fail('slot capacity');
    const minutes = new Set(), keys = new Set();
    for (const entry of value.entries) {
      shape(entry,['key','minuteOfDay']);
      if (!exact(entry.key) || !exact(entry.minuteOfDay) || entry.minuteOfDay >= 1440
        || entry.minuteOfDay * 60000 % config.gridMs !== 0 || minutes.has(entry.minuteOfDay)
        || entry.key !== 0 && keys.has(entry.key)) fail('slot value or grid');
      minutes.add(entry.minuteOfDay); keys.add(entry.key);
    }
    return;
  }
  if (config.type === 'Bool') { if (typeof value !== 'boolean') fail('setting type'); return; }
  if (typeof value !== 'number' || !Number.isFinite(value)
    || config.type === 'Int' && !isInt32(value)
    || config.type === 'Duration' && !exact(value)
    || config.type === 'Percent' && (value < 0 || value > 100)
    || config.type === 'RelativeHumidity' && (value < 0 || value > 1)) fail('setting type');
  if (isTimeType(config.type)) validateTimeValue(config.type,value);
  if (s) {
    if (value < s.min || value > s.max) fail('setting range');
    const aligned = config.type === 'Int' ? intSettingsIssue(value,s) === null
      : config.type === 'Duration' || isTimeType(config.type) ? (value-s.min) % s.step === 0
        : Math.abs((value-s.min)/s.step-Math.round((value-s.min)/s.step)) <= 1e-9;
    if (!aligned) fail('setting grid');
  }
}

// Reference-host lifetime/admission owner. The shared Rust core remains the
// only expression/state/timer evaluator. Actor grants, run identity, trusted
// clock and approved checkpoint storage are explicit host inputs, not labels
// authenticated by this adapter.
export class TemporarySettingsHost {
  #runtime; #configs; #grants; #source; #run; #capacity;
  #ordinary; #overlays = []; #history = []; #ids = [];
  #position = 0; #unavailable = null; #ended = false;

  static async instantiate(wasm, artifact, { runId, grants, historyCapacity = 256,
    checkpoint = null, restoreApproved = false, framed = true, ...activation } = {}) {
    artifact=clone(artifact);grants=clone(grants);activation=clone(activation);
    if (!text(runId) || !exact(historyCapacity) || historyCapacity < 1 || historyCapacity > 4096
      || !grants || typeof grants !== 'object' || Array.isArray(grants)
      || Object.entries(grants).some(([actor,ids]) => !text(actor) || !Array.isArray(ids)
        || ids.length > 128 || new Set(ids).size !== ids.length || ids.some(id => !exact(id) || id === 0))) fail('invalid activation');
    if (!/^[a-f0-9]{64}$/.test(artifact?.sourceDocument?.sha256 ?? '')
      || typeof artifact.sourceDocument.text !== 'string'
      || sha256Hex(artifact.sourceDocument.text)!==artifact.sourceDocument.sha256
      || sha256Hex(artifact.bytes)!==artifact.manifest?.bytecodeSha256) fail('source/artifact identity');
    const verified=compileSourceSync(artifact.sourceDocument.text,{filename:artifact.sourceDocument.filename,
      ...(artifact.sourceClosure?{sourceClosure:artifact.sourceClosure.documents}:{})});
    if(sha256Hex(verified.bytes)!==sha256Hex(artifact.bytes)||!equal(verified.manifest,artifact.manifest))fail('source/manifest identity');
    const runtime = await (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate)(wasm,clone(artifact),activation);
    try {
      const owner = new TemporarySettingsHost(token,runtime,artifact.sourceDocument.sha256,runId,clone(grants),historyCapacity);
      if (checkpoint !== null) owner.#restore(checkpoint,restoreApproved);
      return owner;
    } catch (error) { runtime.dispose(); throw error; }
  }

  constructor(key,runtime,source,run,grants,capacity) {
    if (key !== token) fail('fresh activation required');
    this.#runtime=runtime;this.#source=source;this.#run=run;this.#grants=grants;this.#capacity=capacity;
    this.#configs=clone(runtime.manifest.configs);
    for(const ids of Object.values(grants))for(const id of ids)this.#config(id);
    const state=runtime.contextSnapshot().state;
    this.#ordinary=state.settings.map(c=>({configId:c.id,result:this.#typed(c)}));
  }
  #typed(config) { return config.result.ok ? {ok:true,type:config.type,value:clone(config.result.value)} : clone(config.result); }
  #config(id) { const c=this.#configs.find(c=>c.id===id);if(!c)fail('setting identity');return c; }
  #allowed(actor,id) { return Object.hasOwn(this.#grants,actor) && this.#grants[actor].includes(id) && this.#config(id).settings?.access==='operator'; }
  snapshot() {
    const core=this.#runtime.contextSnapshot();
    return {sourceSha256:this.#source,programFingerprint:core.state.programFingerprint,runId:this.#run,
      position:this.#position,ended:this.#ended,validity:this.#unavailable===null?'available':'unavailable',
      unavailableReason:this.#unavailable,ordinary:clone(this.#ordinary),overlays:clone(this.#overlays),
      history:clone(this.#history),acceptedEventIds:clone(this.#ids),core:{state:core.state,checkpoint:hex(core.bytes)},lastOutcome:clone(this.#runtime.lastFrameOutcome)};
  }
  checkpoint() {
    const body={schema:'GhostFlow/temporary-settings-host-v1',...this.snapshot()};
    return {body,sha256:sha256Hex(canonicalJson(body))};
  }
  #restore(checkpoint,approved) {
    if (approved!==true) fail('checkpoint restoration requires explicit approval');
    shape(checkpoint,['body','sha256']);
    const b=checkpoint.body;
    if (canonicalJson(b).length>1048576 || checkpoint.sha256!==sha256Hex(canonicalJson(b))) fail('checkpoint digest');
    const before=this.snapshot();
    if (b.schema!=='GhostFlow/temporary-settings-host-v1' || b.sourceSha256!==this.#source
      || b.programFingerprint!==before.programFingerprint || !text(b.runId) || b.runId===this.#run
      || !exact(b.position)
      || !Array.isArray(b.ordinary) || b.ordinary.length!==this.#configs.length
      || !Array.isArray(b.overlays) || b.overlays.length>this.#configs.length
      || !Array.isArray(b.history) || b.history.length>this.#capacity
      || !Array.isArray(b.acceptedEventIds) || b.acceptedEventIds.length>this.#capacity
      || new Set(b.acceptedEventIds).size!==b.acceptedEventIds.length || b.acceptedEventIds.some(id=>!text(id))
      || !equal(b.acceptedEventIds,b.history.map(h=>h.eventId))
      || b.history.length!==b.core?.state?.settingsRevision
      || new Set(b.overlays.map(o=>o.overlayId)).size!==b.overlays.length
      || !/^(?:[0-9a-f]{2})+$/.test(b.core?.checkpoint ?? '')) fail('checkpoint identity or bounds');
    const seen=new Set(), covered=new Set();
    const completedRuns=new Set(),openOverlays=new Set();let previousRun=null,previousPosition=0;
    for(const [index,h] of b.history.entries()){
      shape(h,['eventId','runId','settingsRevision','applicationPosition','actor','reason','effects','request']);
      if(!text(h.eventId)||!text(h.runId)||!text(h.actor)||!text(h.reason)
        ||h.settingsRevision!==index+1||!exact(h.applicationPosition)||h.applicationPosition===0
        ||!Array.isArray(h.effects)||!h.effects.length||h.effects.length>this.#configs.length+1)fail('checkpoint history provenance');
      if(h.runId!==previousRun){if(completedRuns.has(h.runId))fail('checkpoint history run binding');
        if(previousRun!==null)completedRuns.add(previousRun);previousRun=h.runId;previousPosition=0;}
      if(h.applicationPosition<=previousPosition||h.runId===b.runId&&h.applicationPosition>b.position)fail('checkpoint history position binding');
      previousPosition=h.applicationPosition;
      const request=h.request;
      if(request===null){if(h.actor!=='lifecycle'||h.reason!=='lifetime completion')fail('checkpoint lifecycle event provenance');}
      else{
        shape(request,['kind','programFingerprint','sourceSha256','runId','eventId','baseRevision','actor','reason'],['changes','lifetime','cancelOverlayIds']);
        if(!['temporary','ordinary','cancel'].includes(request.kind)||request.eventId!==h.eventId||request.runId!==h.runId
          ||request.actor!==h.actor||request.reason!==h.reason||request.baseRevision!==h.settingsRevision-1
          ||request.programFingerprint!==b.programFingerprint||request.sourceSha256!==this.#source)fail('checkpoint request event binding');
        if(request.kind==='cancel'&&(request.changes!==undefined||request.lifetime!==undefined))fail('checkpoint cancel request provenance');
        if(request.kind!=='cancel'&&(!Array.isArray(request.changes)||!request.changes.length
          ||request.changes.length>this.#configs.length||new Set(request.changes.map(c=>c.configId)).size!==request.changes.length))fail('checkpoint request target provenance');
        if(request.kind==='ordinary'&&request.lifetime!==undefined)fail('checkpoint ordinary request provenance');
        if(request.cancelOverlayIds!==undefined&&(!Array.isArray(request.cancelOverlayIds)
          ||new Set(request.cancelOverlayIds).size!==request.cancelOverlayIds.length||request.cancelOverlayIds.some(id=>!text(id))))fail('checkpoint request cancellation provenance');
      }
      if(h.effects.filter(e=>e.kind==='ordinary').length!==(request?.kind==='ordinary'?1:0)
        ||h.effects.filter(e=>e.kind==='temporary').length!==(request?.kind==='temporary'?1:0))fail('checkpoint request effect binding');
      for(const e of h.effects){
        if(e.kind==='temporary'){
          shape(e,['kind','overlayId','grantSnapshot','changes']);
          if(e.overlayId!==h.eventId||!Array.isArray(e.grantSnapshot)||!e.grantSnapshot.length
            ||e.grantSnapshot.length>128||new Set(e.grantSnapshot).size!==e.grantSnapshot.length
            ||e.grantSnapshot.some(id=>!exact(id)||this.#config(id).settings?.access!=='operator'))fail('checkpoint history permission provenance');
          if(!Array.isArray(e.changes)||!e.changes.length||e.changes.length>this.#configs.length
            ||new Set(e.changes.map(c=>c.configId)).size!==e.changes.length)fail('checkpoint history creation target provenance');
          for(const c of e.changes){shape(c,['configId','result','returnResult']);
            if(!e.grantSnapshot.includes(c.configId))fail('checkpoint history creation permission binding');
            payload(this.#config(c.configId),c.result);payload(this.#config(c.configId),c.returnResult);}
          if(openOverlays.has(e.overlayId))fail('checkpoint history duplicate creation');openOverlays.add(e.overlayId);
        }else if(e.kind==='ordinary'){
          shape(e,['kind','targets']);
          if(!Array.isArray(e.targets)||!e.targets.length||e.targets.length>this.#configs.length
            ||new Set(e.targets).size!==e.targets.length)fail('checkpoint history target provenance');
          for(const id of e.targets)this.#config(id);
          if(!equal(e.targets,request?.changes?.map(c=>c.configId)))fail('checkpoint ordinary target binding');
        }else{
          shape(e,['kind','overlayId','returnTarget','returnValues','creationEvent','effectiveResults','returnDisposition']);
          if(!['cancel','expiry','run-ended','ordinary-replacement'].includes(e.kind)||!text(e.overlayId)||e.creationEvent!==e.overlayId
            ||!Array.isArray(e.returnTarget)||!e.returnTarget.length||e.returnTarget.length>this.#configs.length
            ||new Set(e.returnTarget).size!==e.returnTarget.length||!Array.isArray(e.returnValues)||!Array.isArray(e.effectiveResults)
            ||e.returnValues.length!==e.returnTarget.length||e.effectiveResults.length!==e.returnTarget.length
            ||!['returned','superseded-by-ordinary','fault-emission'].includes(e.returnDisposition))fail('checkpoint history return provenance');
          const creation=b.history.slice(0,index).find(row=>row.eventId===e.creationEvent);
          if(!creation?.effects.some(effect=>effect.kind==='temporary'&&effect.overlayId===e.overlayId))fail('checkpoint history creation binding');
          const created=creation.effects.find(effect=>effect.kind==='temporary'&&effect.overlayId===e.overlayId);
          if(!equal(e.returnTarget,created.changes.map(c=>c.configId))||!equal(e.returnValues,created.changes.map(c=>c.returnResult)))fail('checkpoint history original return binding');
          if(!openOverlays.delete(e.overlayId))fail('checkpoint history duplicate return binding');
          for(const [i,id] of e.returnTarget.entries()){
            payload(this.#config(id),e.returnValues[i]);shape(e.effectiveResults[i],['configId','result']);
            if(e.effectiveResults[i].configId!==id)fail('checkpoint history return target binding');
            const result=e.effectiveResults[i].result;
            if(result.ok)payload(this.#config(id),result);
            else{shape(result,['ok','fault']);if(result.ok!==false||!['SettingsInvalid','SettingsUnavailable'].includes(result.fault))fail('checkpoint history fault provenance');}
          }
          const fault=e.effectiveResults.some(item=>!item.result.ok);
          if(fault!==(e.returnDisposition==='fault-emission')
            ||!fault&&e.returnDisposition!==(h.effects.some(effect=>effect.kind==='ordinary')?'superseded-by-ordinary':'returned')
            ||e.returnDisposition==='returned'&&!equal(e.returnValues,e.effectiveResults.map(item=>item.result)))fail('checkpoint history disposition binding');
        }
      }
    }
    if(!equal([...openOverlays].sort(),b.overlays.map(o=>o.overlayId).sort()))fail('checkpoint history active overlay binding');
    for(const item of b.ordinary){if(seen.has(item.configId))fail('checkpoint setting duplication');seen.add(item.configId);this.#config(item.configId);
      if(item.result.ok)payload(this.#config(item.configId),item.result);
      else if(!['SettingsInvalid','SettingsUnavailable'].includes(item.result.fault))fail('checkpoint ordinary fault');}
    for(const o of b.overlays){
      shape(o,['overlayId','actor','reason','creationEvent','runId','programFingerprint','sourceSha256','settingsRevision','startingPosition','lifetime','changes','permissions','createdAt','expiry','rollbackProvenance']);
      if(!text(o.overlayId)||!text(o.actor)||!text(o.reason)||!text(o.creationEvent)||!text(o.runId)
        ||o.programFingerprint!==before.programFingerprint||o.sourceSha256!==this.#source
        ||!exact(o.settingsRevision)||!exact(o.startingPosition)||!['Run','Until'].includes(o.lifetime?.kind)
        ||o.lifetime.kind==='Until'&&!exact(o.lifetime.dateTimeMs)||!Array.isArray(o.changes)||!o.changes.length)fail('checkpoint overlay');
      if(!Array.isArray(o.permissions)||o.permissions.length>128||new Set(o.permissions).size!==o.permissions.length
        ||o.permissions.some(id=>!exact(id)||this.#config(id).settings?.access!=='operator'))fail('checkpoint permission provenance');
      shape(o.createdAt,['monotonicMs','wallMs','clockRevision']);
      if(!exact(o.createdAt.monotonicMs)||o.createdAt.wallMs!==null&&!exact(o.createdAt.wallMs)
        ||o.createdAt.clockRevision!==null&&!text(o.createdAt.clockRevision))fail('checkpoint creation provenance');
      shape(o.lifetime,['kind'],o.lifetime.kind==='Until'?['dateTimeMs']:[]);
      if(o.lifetime.kind==='Until')validateTimeValue('DateTime',o.lifetime.dateTimeMs);
      if(!equal(o.expiry,o.lifetime.kind==='Run'?{runEnded:o.runId}:{dateTimeMs:o.lifetime.dateTimeMs}))fail('checkpoint expiry provenance');
      shape(o.rollbackProvenance,['ordinaryRevision','returnTarget']);
      if(o.rollbackProvenance.ordinaryRevision!==o.settingsRevision-1
        ||!equal(o.rollbackProvenance.returnTarget,o.changes.map(c=>c.configId)))fail('checkpoint rollback provenance');
      const creation=b.history.find(h=>h.eventId===o.creationEvent);
      if(o.creationEvent!==o.overlayId||!creation||creation.actor!==o.actor||creation.reason!==o.reason
        ||creation.runId!==o.runId||creation.settingsRevision!==o.settingsRevision||creation.applicationPosition!==o.startingPosition)fail('checkpoint creation event binding');
      if(!equal(o.permissions,creation.effects.find(e=>e.kind==='temporary'&&e.overlayId===o.overlayId)?.grantSnapshot))fail('checkpoint permission creation binding');
      if(!equal(o.changes,creation.effects.find(e=>e.kind==='temporary'&&e.overlayId===o.overlayId)?.changes))fail('checkpoint active creation value binding');
      for(const change of o.changes){if(covered.has(change.configId)||!seen.has(change.configId))fail('checkpoint overlay target');covered.add(change.configId);
        shape(change,['configId','result','returnResult']);
        if(!o.permissions.includes(change.configId))fail('checkpoint permission target');
        payload(this.#config(change.configId),change.result);payload(this.#config(change.configId),change.returnResult);
        if(!equal(change.returnResult,b.ordinary.find(x=>x.configId===change.configId).result))fail('checkpoint return provenance');}
    }
    this.#runtime.restoreContextCheckpoint(unhex(b.core.checkpoint));
    const state=this.#runtime.contextSnapshot().state;
    if(!equal(state,b.core.state))fail('checkpoint state binding');
    for(const item of b.ordinary){const overlay=b.overlays.find(o=>o.changes.some(c=>c.configId===item.configId));
      const expected=overlay?.changes.find(c=>c.configId===item.configId).result??item.result;
      if(!equal(this.#typed(state.settings.find(c=>c.id===item.configId)),expected))fail('checkpoint effective value binding');}
    this.#ordinary=clone(b.ordinary);this.#overlays=clone(b.overlays);this.#history=clone(b.history);this.#ids=clone(b.acceptedEventIds);
    // No VM state/timer memory is restored. The new core/run owns fresh memory;
    // only validated context settings and terminal identities are restored.
  }
  dispose(){this.#runtime.dispose();}
  endRun(packet){return this.#attempt(packet,null,true);}
  step(packet,event=null){return this.#attempt(packet,event,false);}
  #attempt(packet,event,ending){try{return this.#step(packet,event,ending);}catch(error){
    if(!(error instanceof ReturnUnavailable))throw error;
    this.#unavailable=error.message;return {accepted:false,reason:'settings-unavailable',outcome:null,coreEvent:null,snapshot:this.snapshot()};}}

  #step(packet,event,ending) {
    if(this.#ended)fail('run ended');
    packet=clone(packet);event=clone(event);
    if(!exact(packet?.nowMs)||packet.contextFacts?.settings!=null)fail('invalid packet');
    const state=this.#runtime.contextSnapshot().state,position=this.#position+1;
    if(!exact(position))fail('position capacity');
    const ordinary=clone(this.#ordinary),overlays=clone(this.#overlays),effects=[],changes=new Map();
    const clock=packet.contextFacts?.clock;
    const trusted=clock?.trusted===true&&clock.unknownReason==null&&exact(clock.wallMs)&&exact(clock.uncertaintyMs)&&clock.monotonicMs===packet.nowMs;
    const remove = (overlay,reason) => {
      for(const change of overlay.changes){try{payload(this.#config(change.configId),change.returnResult);}catch(error){throw new ReturnUnavailable(error.message);}
        const result=clone(change.returnResult);
        changes.set(change.configId,{configId:change.configId,result});}
      effects.push({kind:reason,overlayId:overlay.overlayId,returnTarget:overlay.changes.map(c=>c.configId),returnValues:overlay.changes.map(c=>clone(c.returnResult)),creationEvent:overlay.creationEvent});
      overlays.splice(overlays.indexOf(overlay),1);
    };
    // Explicit cancellation can recover an Until overlay even when time is
    // unavailable: return is validated rather than guessing whether it expired.
    if(event!==null){
      shape(event,['kind','programFingerprint','sourceSha256','runId','eventId','baseRevision','actor','reason'],['changes','lifetime','cancelOverlayIds']);
      if(!['temporary','ordinary','cancel'].includes(event.kind)||!text(event.eventId)||!text(event.actor)||!text(event.reason))fail('event provenance');
      if(event.programFingerprint!==state.programFingerprint||event.sourceSha256!==this.#source||event.runId!==this.#run)fail('Program/source/run identity');
      if(event.baseRevision!==state.settingsRevision||this.#ids.includes(event.eventId))fail('stale revision or duplicate event');
      const cancellations=event.cancelOverlayIds??[];
      if(!Array.isArray(cancellations)||new Set(cancellations).size!==cancellations.length)fail('cancellation identities');
      if(event.kind==='temporary'&&cancellations.length)fail('cancel first before new temporary request');
      for(const id of cancellations){const o=overlays.find(o=>o.overlayId===id);if(!o||o.changes.some(c=>!this.#allowed(event.actor,c.configId)))fail('cancellation identity or permission');remove(o,'cancel');}
      if(event.kind==='cancel'&&(cancellations.length===0||event.changes!==undefined||event.lifetime!==undefined))fail('cancel shape');
    }
    try{
      for(const o of [...overlays]){
        if(o.lifetime.kind==='Run'&&(ending||o.runId!==this.#run))remove(o,'run-ended');
        else if(o.lifetime.kind==='Until'){
          if(!trusted)throw Error('trusted time unavailable');
          if(clock.wallMs-clock.uncertaintyMs>=o.lifetime.dateTimeMs)remove(o,'expiry');
          else if(clock.wallMs+clock.uncertaintyMs>=o.lifetime.dateTimeMs)throw Error('expiry time uncertainty');
          else if(o.changes.some(c=>!this.#allowed(o.actor,c.configId)))throw Error('restored overlay permission unavailable');
        }
      }
    }catch(error){this.#unavailable=error.message;return {accepted:false,reason:'settings-unavailable',outcome:null,coreEvent:null,snapshot:this.snapshot()};}
    if(event!==null&&event.kind!=='cancel'){
      if(!Array.isArray(event.changes)||!event.changes.length||event.changes.length>this.#configs.length
        ||new Set(event.changes.map(c=>c.configId)).size!==event.changes.length)fail('target group');
      for(const change of event.changes){shape(change,['configId','result']);this.#config(change.configId);if(!this.#allowed(event.actor,change.configId))fail('setting permission');}
      if(event.kind==='temporary'){
        if(ending)fail('temporary request at run end');
        shape(event.lifetime,['kind'],event.lifetime?.kind==='Until'?['dateTimeMs']:[]);
        if(!['Run','Until'].includes(event.lifetime.kind))fail('lifetime required');
        if(event.lifetime.kind==='Until'){
          if(!trusted)fail('Until requires trusted time');validateTimeValue('DateTime',event.lifetime.dateTimeMs);
          if(event.lifetime.dateTimeMs<=clock.wallMs+clock.uncertaintyMs)fail('Until expiry not provably future');
        }
        const captured=[];
        for(const change of event.changes){if(overlays.some(o=>o.changes.some(c=>c.configId===change.configId)))fail('temporary nesting');
          payload(this.#config(change.configId),change.result);
          if(change.result.type.startsWith('TimeSlots<')){const priorEntries=state.settings.find(c=>c.id===change.configId).result.value?.entries??[];
            if(change.result.value.entries.some(e=>e.key!==0&&!priorEntries.some(p=>p.key===e.key)))fail('slot key identity');}
          const prior=ordinary.find(c=>c.configId===change.configId).result;payload(this.#config(change.configId),prior);
          captured.push({...clone(change),returnResult:clone(prior)});changes.set(change.configId,clone(change));}
        overlays.push({overlayId:event.eventId,programFingerprint:state.programFingerprint,sourceSha256:this.#source,runId:this.#run,
          actor:event.actor,permissions:this.#grants[event.actor].filter(id=>this.#config(id).settings?.access==='operator'),reason:event.reason,creationEvent:event.eventId,
          settingsRevision:state.settingsRevision+1,startingPosition:position,lifetime:clone(event.lifetime),
          createdAt:{monotonicMs:packet.nowMs,wallMs:clock?.wallMs??null,clockRevision:clock?.sourceRevision??null},
          expiry:event.lifetime.kind==='Run'?{runEnded:this.#run}:{dateTimeMs:event.lifetime.dateTimeMs},
          rollbackProvenance:{ordinaryRevision:state.settingsRevision,returnTarget:captured.map(c=>c.configId)},changes:captured});
        effects.push({kind:'temporary',overlayId:event.eventId,grantSnapshot:clone(overlays.at(-1).permissions),changes:[]});
      }else{
        if(event.lifetime!==undefined)fail('ordinary lifetime');
        for(const o of [...overlays])if(o.changes.some(c=>event.changes.some(x=>x.configId===c.configId))){
          if(o.changes.some(c=>!event.changes.some(x=>x.configId===c.configId)))fail('cancel entire temporary group before partial ordinary change');remove(o,'ordinary-replacement');}
        for(const change of event.changes)changes.set(change.configId,clone(change));
        effects.push({kind:'ordinary',targets:event.changes.map(c=>c.configId)});
      }
    }
    const hasReturns=effects.some(e=>e.returnTarget);
    if(hasReturns&&event?.kind==='ordinary'){
      const invalidSlots=event.changes.some(c=>c.result.ok&&c.result.type?.startsWith('TimeSlots<')
        &&c.result.value?.entries?.some(e=>e.key!==0&&!state.settings.find(s=>s.id===c.configId).result.value?.entries?.some(p=>p.key===e.key)
          &&!this.#ordinary.find(s=>s.configId===c.configId).result.value?.entries?.some(p=>p.key===e.key)));
      if(invalidSlots)for(const [id] of changes)changes.set(id,{configId:id,result:{ok:false,fault:'SettingsInvalid'}});
    }
    const coreEvent=changes.size?{programFingerprint:state.programFingerprint,eventId:event?.eventId??`overlay:${this.#run}:${position}`,
      baseRevision:state.settingsRevision,position,origin:hasReturns?'temporaryReturn':'operatorEdit',changes:[...changes.values()]}:null;
    if(coreEvent&&(this.#history.length>=this.#capacity||this.#ids.length>=this.#capacity)){
      this.#unavailable='event history capacity';return {accepted:false,reason:'settings-unavailable',outcome:null,coreEvent:null,snapshot:this.snapshot()};}
    let outcome;
    try{outcome=this.#runtime.step({...packet,contextFacts:{...packet.contextFacts,settings:coreEvent}});}
    catch(error){if(effects.some(e=>['expiry','run-ended','cancel','ordinary-replacement'].includes(e.kind))){this.#unavailable='return failed: '+error.message;return {accepted:false,reason:'settings-unavailable',outcome:null,coreEvent:null,attemptedCoreEvent:clone(coreEvent),snapshot:this.snapshot()};}throw error;}
    const effective=this.#runtime.contextSnapshot().state;
    for(const effect of effects)if(effect.returnTarget){
      effect.effectiveResults=effect.returnTarget.map(id=>({configId:id,result:this.#typed(effective.settings.find(c=>c.id===id))}));
      effect.returnDisposition=effect.effectiveResults.some(c=>!c.result.ok)?'fault-emission':event?.kind==='ordinary'?'superseded-by-ordinary':'returned';
    }
    // Accepted ordinary invalid payloads retain the core's aggregate Result
    // fault semantics. Temporary values were validated before this evaluation.
    for(const item of ordinary)if(!overlays.some(o=>o.changes.some(c=>c.configId===item.configId)))item.result=this.#typed(effective.settings.find(c=>c.id===item.configId));
    for(const o of overlays)for(const c of o.changes)c.result=this.#typed(effective.settings.find(s=>s.id===c.configId));
    for(const effect of effects)if(effect.kind==='temporary')effect.changes=clone(overlays.find(o=>o.overlayId===effect.overlayId).changes);
    this.#ordinary=ordinary;this.#overlays=overlays;this.#position=position;this.#unavailable=null;this.#ended=ending;
    if(coreEvent){this.#ids.push(coreEvent.eventId);this.#history.push({eventId:coreEvent.eventId,runId:this.#run,settingsRevision:effective.settingsRevision,applicationPosition:position,actor:event?.actor??'lifecycle',reason:event?.reason??'lifetime completion',request:clone(event),effects});}
    return {accepted:true,reason:null,outcome,coreEvent:clone(coreEvent),snapshot:this.snapshot()};
  }
}
