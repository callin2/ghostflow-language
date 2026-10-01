import { CompileError, lowerExpression } from './core-ir.mjs';

const UTF8 = new TextEncoder();

function tokenize(source) {
  if (UTF8.encode(source).byteLength > 1024 * 1024) throw new CompileError('source byte limit exceeded');
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === ';') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '(' || c === ')') { tokens.push(c); i++; continue; }
    let j = i;
    while (j < source.length && !/[\s();]/.test(source[j])) j++;
    if (j === i) throw new CompileError(`unexpected character at ${i}`);
    tokens.push(source.slice(i, j));
    i = j;
  }
  return tokens;
}

function parse(tokens) {
  let at = 0;
  function one(depth = 0) {
    if (depth > 128) throw new CompileError('syntax nesting limit exceeded');
    const token = tokens[at++];
    if (token === undefined) throw new CompileError('unexpected end of input');
    if (token === ')') throw new CompileError('unexpected )');
    if (token !== '(') return token;
    const list = [];
    while (tokens[at] !== ')') {
      if (at >= tokens.length) throw new CompileError('unclosed (');
      list.push(one(depth + 1));
    }
    at++;
    return list;
  }
  const ast = one();
  if (at !== tokens.length) throw new CompileError('multiple top-level forms');
  return ast;
}

const TYPE = { bool: 1, number: 2, int: 3 };
const OP = { bool:1, number:2, input:3, state:4, next:5, not:10,
  eq:13, lt:14, lte:15, gt:16, gte:17, add:19, sub:20, mul:21, div:22,
  int:23, 'int-neg':24, 'int-add':25, 'int-sub':26, 'int-mul':27, 'int-div':28, 'int-rem':29,
  branchFalse:30, jump:31, 'int-to-number':48, 'int-exact':49, 'int-floor':50,
  'int-ceil':51, 'int-trunc':52, 'int-nearest-even':53, 'check-duration':54, 'check-datetime':55,
  'trace-result':56, 'window-read':57, 'schedule-read':58, 'true-for-read':59 };

class Writer {
  constructor() { this.parts = []; }
  bytes(v) { this.parts.push(v instanceof Uint8Array ? v : new Uint8Array(v)); }
  u8(v) { const b=new Uint8Array(1); new DataView(b.buffer).setUint8(0,v); this.parts.push(b); }
  u16(v) { const b=new Uint8Array(2); new DataView(b.buffer).setUint16(0,v,true); this.parts.push(b); }
  u32(v) { const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,v,true); this.parts.push(b); }
  u64(v) { const b=new Uint8Array(8); new DataView(b.buffer).setBigUint64(0,BigInt(v),true); this.parts.push(b); }
  i64(v) { const b=new Uint8Array(8); new DataView(b.buffer).setBigInt64(0,BigInt(v),true); this.parts.push(b); }
  i32(v) { const b=new Uint8Array(4); new DataView(b.buffer).setInt32(0,v,true); this.parts.push(b); }
  f64(v) { const b=new Uint8Array(8); new DataView(b.buffer).setFloat64(0,v,true); this.parts.push(b); }
  str(s) { const b=UTF8.encode(s); if (b.length>65535) throw new CompileError('string too long'); this.u16(b.length); this.bytes(b); }
  finish() { const size=this.parts.reduce((total,part)=>total+part.byteLength,0); const out=new Uint8Array(size); let at=0; for(const part of this.parts){out.set(part,at);at+=part.byteLength;} return out; }
}

function assertName(name, label) {
  if (typeof name !== 'string' || name.length > 128 || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name))
    throw new CompileError(`invalid ${label} name: ${name}`);
}

function scalarType(name) {
  if (!TYPE[name]) throw new CompileError(`unknown type ${name}`);
  return TYPE[name];
}

function unsignedAtom(atom, max, message) {
  if (typeof atom !== 'string' || !/^\d+$/.test(atom)) throw new CompileError(message);
  const value = BigInt(atom);
  if (value > max) throw new CompileError(message);
  return value;
}

function signedAtom(atom, min, max, message) {
  if (typeof atom !== 'string' || !/^-?\d+$/.test(atom)) throw new CompileError(message);
  const value = BigInt(atom);
  if (value < min || value > max) throw new CompileError(message);
  return value;
}

function finiteAtom(atom, min, max, message) {
  if (typeof atom !== 'string' || atom.length === 0) throw new CompileError(message);
  const value = Number(atom);
  if (!Number.isFinite(value) || value < min || value > max) throw new CompileError(message);
  return value;
}

function wellFormedShortString(value) {
  if (typeof value !== 'string' || value.length === 0 || UTF8.encode(value).length > 128) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function windowQualityDependencies(node, found = new Set()) {
  if (!Array.isArray(node)) return found;
  if (node[0] === 'window-read' && node[2] === 'quality' && typeof node[1] === 'string' && /^\d+$/.test(node[1])) {
    found.add(Number(node[1]));
  }
  for (const child of node.slice(1)) windowQualityDependencies(child, found);
  return found;
}

function emitExpression(ir) {
  let w = new Writer(), usesInt = false, usesFormat3 = false;
  function containsBranch(n) {
    if (['conditional', 'logical_and', 'logical_or'].includes(n.kind)) return true;
    return Object.values(n).some(value => value && typeof value === 'object' && containsBranch(value));
  }
  const compactNumbers = containsBranch(ir);
  function branch(condition, yes, no) {
    emit(condition);
    const outer = w;
    w = new Writer(); emit(yes); const yesBytes = w.finish();
    w = new Writer(); emit(no); const noBytes = w.finish();
    w = outer;
    if (yesBytes.length + 3 > 65535 || noBytes.length > 65535) throw new CompileError('expression complexity limit exceeded');
    w.u8(OP.branchFalse); w.u16(yesBytes.length + 3); w.bytes(yesBytes);
    w.u8(OP.jump); w.u16(noBytes.length); w.bytes(noBytes);
    usesFormat3 = true;
  }
  function emit(n) {
    switch (n.kind) {
      case 'literal':
        if (n.type === 'Bool') { w.u8(OP.bool); w.u8(n.value ? 1 : 0); }
        else if (n.type === 'Int') { usesInt = true; w.u8(OP.int); w.i32(n.value); }
        else if (compactNumbers && Number.isInteger(n.value) && n.value >= 0 && n.value <= 15 && !Object.is(n.value, -0)) w.u8(32 + n.value);
        else { w.u8(OP.number); w.f64(n.value); }
        return;
      case 'input': case 'previous_state': case 'candidate_next':
        w.u8(OP[n.kind === 'input' ? 'input' : n.kind === 'previous_state' ? 'state' : 'next']);
        w.u16(n.index); return;
      case 'true_for_projection': case 'window_projection': case 'schedule_projection': {
        const operation = n.kind === 'true_for_projection' ? 'true-for-read' : n.kind === 'window_projection' ? 'window-read' : 'schedule-read';
        const fields = operation === 'true-for-read' ? ['ok','value','fault','origin','start','end','covered']
          : operation === 'window-read' ? ['ok','value','fault','origin','revision','timestamp','count','quality']
            : ['due','missed','active'];
        w.u8(OP[operation]); w.u16(n.slot); w.u8(fields.indexOf(n.field)); return;
      }
      case 'result_trace':
        emit(n.payload); emit(n.choice); emit(n.origin);
        usesFormat3 = true; w.u8(OP['trace-result']); w.u32(n.site); return;
      case 'integer_negation':
        emit(n.operand); usesInt = true; w.u8(OP['int-neg']); return;
      case 'integer_arithmetic':
        emit(n.left); emit(n.right); usesInt = true; w.u8(OP['int-' + n.operation]); return;
      case 'logical_not':
        emit(n.operand); w.u8(OP.not); return;
      case 'logical_and':
        branch(n.left, n.right, { kind: 'literal', type: 'Bool', value: false }); return;
      case 'logical_or':
        branch(n.left, { kind: 'literal', type: 'Bool', value: true }, n.right); return;
      case 'conditional':
        branch(n.condition, n.whenTrue, n.whenFalse); return;
      case 'comparison':
        emit(n.left); emit(n.right);
        if (n.left.type === 'Int') usesInt = true;
        w.u8(OP[n.operation]); return;
      case 'arithmetic':
        emit(n.left); emit(n.right); w.u8(OP[n.operation]); return;
      case 'conversion':
        emit(n.operand); usesInt = true; usesFormat3 = true; w.u8(OP[n.operation]); return;
      case 'time_guard':
        emit(n.operand); usesFormat3 = true; w.u8(OP[n.operation]); return;
      default: throw new CompileError('invalid semantic expression IR');
    }
  }
  emit(ir);
  return { type: TYPE[ir.type.toLowerCase()], bytes: w.finish(), usesInt, usesFormat3 };
}

function checkedExpression(form, env, allowNext = false) {
  const expression = lowerExpression(form, env, allowNext);
  return { type: TYPE[expression.type.toLowerCase()], expression };
}

function lowerQuery(node) {
  if (node === 'true' || node === 'false') return {kind:'literal',value:node==='true'};
  if (!Array.isArray(node)||node.length<1) throw new CompileError('invalid device query');
  const [head,...args]=node;
  if(head==='has') { if(args.length!==3) throw new CompileError('has expects kind name type'); assertName(args[0],'capability kind'); assertName(args[1],'capability'); return {kind:'capability',capabilityKind:args[0],name:args[1],type:({1:'Bool',2:'Number',3:'Int'})[scalarType(args[2])]}; }
  if(head==='all'||head==='any') { if(args.length<1) throw new CompileError(`${head} needs children`); return {kind:head,children:args.map(lowerQuery)}; }
  if(head==='not') { if(args.length!==1) throw new CompileError('query not expects one child'); return {kind:'not',child:lowerQuery(args[0])}; }
  throw new CompileError(`unknown device query ${head}`);
}

function emitQuery(query) {
  const w=new Writer();
  function emit(node) {
    if(node.kind==='literal'){w.u8(5);w.u8(node.value?1:0);return;}
    if(node.kind==='capability'){w.u8(1);w.str(node.capabilityKind);w.str(node.name);w.u8(TYPE[node.type.toLowerCase()]);return;}
    if(node.kind==='all'||node.kind==='any'){for(const child of node.children)emit(child);w.u8(node.kind==='all'?2:3);w.u16(node.children.length);return;}
    if(node.kind==='not'){emit(node.child);w.u8(4);return;}
    throw new CompileError('invalid semantic device query IR');
  }
  emit(query);return w.finish();
}

function lowerCoreModule(ast) {
  if (!Array.isArray(ast)||ast[0]!=='module'||typeof ast[1]!=='string') throw new CompileError('expected (module NAME ...)');
  const name=ast[1]; assertName(name,'module');
  let version=1, temporalContext=null; const inputs=[], states=[], strategies=[], constraints=[], temporalRootForms=[], objectives=[];
  for (const form of ast.slice(2)) {
    if(!Array.isArray(form)||!form.length) throw new CompileError('invalid module form');
    const [head,...args]=form;
    if(head==='version') { version=Number(args[0]); if(args.length!==1||!Number.isInteger(version)||version<0||version>0xffffffff) throw new CompileError('invalid version'); }
    else if(head==='input') { if(args.length!==2) throw new CompileError('input expects name type'); assertName(args[0],'input'); inputs.push({name:args[0],type:scalarType(args[1])}); }
    else if(head==='state') { if(args.length!==3) throw new CompileError('state expects name type default'); assertName(args[0],'state'); const type=scalarType(args[1]); let value; if(type===TYPE.bool){if(!['true','false'].includes(args[2]))throw new CompileError('bool default expected');value=args[2]==='true';}else if(type===TYPE.int){if(typeof args[2]!=='string'||!/^-?\d+$/.test(args[2]))throw new CompileError('int default expected');const exact=BigInt(args[2]);if(exact < -2147483648n||exact > 2147483647n)throw new CompileError('int default outside i32 range');value=Number(exact);}else{value=Number(args[2]);if(!Number.isFinite(value))throw new CompileError('number default expected');} states.push({name:args[0],type,value}); }
    else if(head==='temporal-context') { if(temporalContext!==null||args.length!==2)throw new CompileError('temporal module requires one temporal-context');temporalContext=args; }
    else if(head==='temporal-root') { if(args.length!==6)throw new CompileError('temporal-root expects tag, name and four input bindings');temporalRootForms.push(args); }
    else if(head==='strategy') strategies.push({raw:form});
    else if(head==='requires') { if(args.length!==2) throw new CompileError('requires expects target prerequisite'); constraints.push({kind:1,names:args}); }
    else if(head==='requires-any') { if(args.length<2||args.length>32) throw new CompileError('requires-any expects target and prerequisites'); constraints.push({kind:3,names:args}); }
    else if(head==='mutex') { if(args.length<2) throw new CompileError('mutex needs at least 2 intents'); constraints.push({kind:2,names:args}); }
    else if(head==='pid-objective') { if(args.length!==15&&args.length!==16)throw new CompileError('pid-objective expects 15 or 16 arguments');objectives.push(args); }
    else throw new CompileError(`unknown module form ${head}`);
  }
  const unique=(xs,label)=>{const s=new Set();for(const x of xs){if(s.has(x.name))throw new CompileError(`duplicate ${label} ${x.name}`);s.add(x.name);}};
  unique(inputs,'input'); unique(states,'state');
  if(inputs.length>128||states.length>128||strategies.length>32||constraints.length>128)throw new CompileError('module resource limit exceeded');
  for(const c of constraints){if(c.names.length>32||new Set(c.names).size!==c.names.length)throw new CompileError('invalid constraint names or arity');for(const n of c.names)assertName(n,'constraint');}
  const env={inputs:new Map(inputs.map((x,i)=>[x.name,{...x,index:i}])),states:new Map(states.map((x,i)=>[x.name,{...x,index:i}]))};
  const rawWindowCount=strategies.reduce((total,{raw})=>total+raw.slice(3).filter(form=>Array.isArray(form)&&form[0]==='window').length,0);
  const contextHeads=['at-pulse','periodic-pulse','cron-pulse','calendar-daily-pulse','tide-run','config-daily-slots-pulse','utc-range'];
  const rawScheduleCount=strategies.reduce((total,{raw})=>total+raw.slice(3).filter(form=>Array.isArray(form)&&['solar-pulse','daily-pulse','daily-slots-pulse','config-stream',...contextHeads].includes(form[0])).length,0);
  const hasContext=strategies.some(({raw})=>raw.slice(3).some(form=>Array.isArray(form)&&['config-stream',...contextHeads,'natural-result','accounting-result'].includes(form[0])));
  const rawNaturalCount=strategies.reduce((total,{raw})=>total+raw.slice(3).filter(form=>Array.isArray(form)&&['natural-result','accounting-result'].includes(form[0])).length,0);
  const hasDaily=strategies.some(({raw})=>raw.slice(3).some(form=>Array.isArray(form)&&form[0]==='daily-pulse'));
  const hasDailySlots=strategies.some(({raw})=>raw.slice(3).some(form=>Array.isArray(form)&&form[0]==='daily-slots-pulse'));
  const hasSolar=strategies.some(({raw})=>raw.slice(3).some(form=>Array.isArray(form)&&form[0]==='solar-pulse'));
  const rawTrueForCount=strategies.reduce((total,{raw})=>total+raw.slice(3).filter(form=>Array.isArray(form)&&form[0]==='true-for').length,0);
  const rawPreludeCount=rawWindowCount+rawScheduleCount+rawTrueForCount+rawNaturalCount;
  const hasSchedules=rawScheduleCount>0;
  const hasTrueFors=rawTrueForCount>0;
  const taggedPreludes=hasSchedules||hasTrueFors||hasContext;
  const hasTemporal=rawPreludeCount>0||temporalContext!==null||temporalRootForms.length>0;
  if(hasTemporal&&rawPreludeCount===0)throw new CompileError('temporal module requires at least one window');
  if(rawPreludeCount>0&&temporalContext===null)throw new CompileError('temporal module requires one temporal-context');
  let temporal=null;
  if(rawPreludeCount>0){
    const [nowName,epochName]=temporalContext;
    const now=env.inputs.get(nowName),epoch=env.inputs.get(epochName);
    if(nowName!=='__gf_now_ms'||epochName!=='__gf_time_epoch'||now?.type!==TYPE.number||epoch?.type!==TYPE.number)throw new CompileError('invalid temporal clock input');
    if(rawWindowCount>0&&temporalRootForms.length===0)throw new CompileError('invalid temporal root count');
    const usedInputs=new Set([now.index,epoch.index]),usedNames=new Set(),roots=[];let previousTag=0;
    for(const args of temporalRootForms){
      const [tagAtom,rootName,...bindingNames]=args;const tag=Number(unsignedAtom(tagAtom,4294967295n,'invalid temporal root tag'));
      if(tag===0||tag<=previousTag)throw new CompileError('invalid temporal root tag');previousTag=tag;
      assertName(rootName,'temporal root');if(usedNames.has(rootName))throw new CompileError('duplicate temporal root name');usedNames.add(rootName);
      const bindings=bindingNames.map(binding=>env.inputs.get(binding));
      const expected=[TYPE.bool,TYPE.number,TYPE.number,TYPE.number];
      if(bindings.some((binding,index)=>!binding||binding.type!==expected[index]))throw new CompileError('invalid temporal root input');
      for(const binding of bindings)if(usedInputs.has(binding.index))throw new CompileError('duplicate temporal input binding');else usedInputs.add(binding.index);
      roots.push({tag,name:rootName,indices:bindings.map(binding=>binding.index)});
    }
    temporal={nowInput:now.index,timeEpochInput:epoch.index,roots,rootIndex:new Map(roots.map((root,index)=>[root.tag,index]))};
  }
  const certifiedRoots=new Map(),certifiedNames=new Map();
  const certifiedInputs=new Set(temporal?[temporal.nowInput,temporal.timeEpochInput,...temporal.roots.flatMap(root=>root.indices)]:[]);
  const compiledStrategies=strategies.map(({raw})=>{
    const [,sname,priorityAtom,...forms]=raw; assertName(sname,'strategy'); const priority=Number(priorityAtom); if(!Number.isInteger(priority)||priority < -2147483648||priority > 2147483647)throw new CompileError('strategy priority must be i32');
    let query=null,seenExecutable=false; const windows=[],schedules=[],trueFors=[],preludes=[],transitions=[],intents=[],windowSites=new Set(),windowNames=new Set(),preludeSites=new Set(),preludeNames=new Set();
    const contextEnv=()=>({...env,windows,schedules,trueFors:hasTrueFors?trueFors:undefined,contextSchedules:hasContext});
    for(const f of forms){if(!Array.isArray(f))throw new CompileError('invalid strategy form');const [h,...a]=f;
      if(h==='device'){if(a.length!==1||query)throw new CompileError('strategy needs one device query');query=lowerQuery(a[0]);}
      else if(h==='window'){
        if(!temporal)throw new CompileError('temporal module requires one temporal-context');
        if(seenExecutable)throw new CompileError(taggedPreludes?'stateful prelude declarations must precede transitions and intents':'window declarations must precede transitions and intents');
        if(a.length!==8)throw new CompileError('window expects site, name, operation, payload type, over, max age, roots and source');
        const [siteAtom,windowName,operationName,payloadName,overAtom,maxAgeAtom,rootForm,sourceForm]=a;
        const site=Number(unsignedAtom(siteAtom,4294967295n,'invalid temporal window site'));
        if(site===0)throw new CompileError('invalid temporal window site');
        if(taggedPreludes){if(preludeSites.has(site))throw new CompileError('duplicate prelude site');preludeSites.add(site);}
        else{if(windowSites.has(site))throw new CompileError('invalid temporal window site');windowSites.add(site);}
        assertName(windowName,'temporal window');
        if(taggedPreludes){if(preludeNames.has(windowName))throw new CompileError('duplicate prelude name');preludeNames.add(windowName);}
        else{if(windowNames.has(windowName))throw new CompileError('duplicate temporal window name');windowNames.add(windowName);}
        const operationCodes={average:0,min:1,max:2,rate:3};
        const operation=Object.hasOwn(operationCodes,operationName)?operationCodes[operationName]:undefined;
        if(operation===undefined)throw new CompileError('invalid temporal operation');
        if(!['number','int'].includes(payloadName)||(operation===0||operation===3)&&payloadName!=='number')throw new CompileError('invalid temporal payload type');
        const payloadType=scalarType(payloadName);
        const overMs=unsignedAtom(overAtom,9007199254740991n,'invalid temporal duration');
        const maxAgeMs=unsignedAtom(maxAgeAtom,9007199254740991n,'invalid temporal duration');
        if(overMs===0n||maxAgeMs===0n)throw new CompileError('invalid temporal duration');
        if(!Array.isArray(rootForm)||rootForm[0]!=='roots'||rootForm.length<2)throw new CompileError('invalid temporal window roots');
        const rootRefs=[];let previousRoot=-1;
        for(const tagAtom of rootForm.slice(1)){
          const tag=Number(unsignedAtom(tagAtom,4294967295n,'invalid temporal window roots')),index=temporal.rootIndex.get(tag);
          if(index===undefined||index<=previousRoot)throw new CompileError('invalid temporal window roots');previousRoot=index;rootRefs.push(index);
        }
        if(!Array.isArray(sourceForm)||sourceForm[0]!=='source'||sourceForm.length!==7)throw new CompileError('window source expects ok, payload, fault, origin, quality and source tag');
        const sourceEnv={...env,windows,schedules:hasSchedules?schedules:undefined,trueFors:hasTrueFors?trueFors:undefined};const expected=[TYPE.bool,payloadType,TYPE.number,TYPE.number,TYPE.number,TYPE.number];
        const source=sourceForm.slice(1).map((expression,index)=>{
          const compiled=checkedExpression(expression,sourceEnv,false);
          if(compiled.type!==expected[index])throw new CompileError('temporal source expression type mismatch');
          return compiled;
        });
        const evidenceDependencies=[...windowQualityDependencies(sourceForm[5])].sort((left,right)=>left-right);
        for(const dependency of evidenceDependencies){
          const upstream=windows[dependency];
          if(!upstream)throw new CompileError('temporal window evidence dependency must be prior');
          if(upstream.rootRefs.some(root=>!rootRefs.includes(root)))throw new CompileError('temporal window evidence roots are incomplete');
        }
        const window={site,name:windowName,operation,payloadType,overMs,maxAgeMs,rootRefs,source,evidenceDependencies};
        windows.push(window);preludes.push({kind:'window',value:window});
      }
      else if(h==='true-for'){
        if(!temporal)throw new CompileError('temporal module requires one temporal-context');
        if(seenExecutable)throw new CompileError('stateful prelude declarations must precede transitions and intents');
        if(a.length!==6)throw new CompileError('true-for expects site, name, source tag, source name, duration and interval inputs');
        const [siteAtom,signalName,tagAtom,sourceName,durationAtom,inputForm]=a;
        const site=Number(unsignedAtom(siteAtom,4294967295n,'invalid true_for site'));
        if(site===0)throw new CompileError('invalid true_for site');
        if(preludeSites.has(site))throw new CompileError('duplicate prelude site');preludeSites.add(site);
        assertName(signalName,'true_for');
        if(preludeNames.has(signalName))throw new CompileError('duplicate prelude name');preludeNames.add(signalName);
        const sourceTag=Number(unsignedAtom(tagAtom,4294967295n,'invalid certified source tag'));
        if(sourceTag===0)throw new CompileError('invalid certified source tag');
        assertName(sourceName,'certified source');
        const durationMs=unsignedAtom(durationAtom,9007199254740991n,'invalid true_for duration');
        if(durationMs===0n)throw new CompileError('invalid true_for duration');
        if(!Array.isArray(inputForm)||inputForm[0]!=='interval-inputs'||inputForm.length!==9)throw new CompileError('invalid certified interval inputs');
        const bindings=inputForm.slice(1).map(name=>env.inputs.get(name));
        const expected=[TYPE.bool,TYPE.number,TYPE.number,TYPE.number,TYPE.number,TYPE.bool,TYPE.number,TYPE.number];
        if(bindings.some((binding,index)=>!binding||binding.type!==expected[index]))throw new CompileError('invalid certified interval input');
        const indices=bindings.map(binding=>binding.index);
        if(new Set(indices).size!==indices.length)throw new CompileError('duplicate certified interval input binding');
        const previous=certifiedRoots.get(sourceTag);
        if(previous){
          if(previous.sourceName!==sourceName||previous.indices.some((index,at)=>index!==indices[at]))throw new CompileError('certified source binding mismatch');
        }else{
          if(certifiedNames.has(sourceName))throw new CompileError('certified source binding mismatch');
          const pointRoot=temporal.roots.find(root=>root.tag===sourceTag||root.name===sourceName);
          if(pointRoot&&(pointRoot.tag!==sourceTag||pointRoot.name!==sourceName))throw new CompileError('certified source binding mismatch');
          if(indices.some(index=>certifiedInputs.has(index)))throw new CompileError('duplicate certified interval input binding');
          for(const index of indices)certifiedInputs.add(index);
          certifiedRoots.set(sourceTag,{sourceName,indices});certifiedNames.set(sourceName,sourceTag);
        }
        const descriptor={site,name:signalName,sourceTag,sourceName,durationMs,indices};
        trueFors.push(descriptor);preludes.push({kind:'true-for',value:descriptor});
      }
      else if(h==='solar-pulse'){
        if(!temporal)throw new CompileError('temporal module requires one temporal-context');
        if(seenExecutable)throw new CompileError('stateful prelude declarations must precede transitions and intents');
        if(![13,15].includes(a.length))throw new CompileError('solar-pulse expects 13 arguments');
        const [siteAtom,scheduleName,timezone,latitudeAtom,longitudeAtom,eventAtom,offsetAtom,basisAtom,clockPolicyAtom,gapAtom,recoveryAtom,fallbackAtom,whenForm]=a;
        const site=Number(unsignedAtom(siteAtom,4294967295n,'invalid schedule site'));
        if(site===0)throw new CompileError('invalid schedule site');
        if(preludeSites.has(site))throw new CompileError('duplicate prelude site');preludeSites.add(site);
        assertName(scheduleName,'schedule');if(preludeNames.has(scheduleName))throw new CompileError('duplicate prelude name');preludeNames.add(scheduleName);
        if(!wellFormedShortString(timezone))throw new CompileError('invalid Solar timezone');
        const latitude=finiteAtom(latitudeAtom,-90,90,'invalid Solar latitude');
        const longitude=finiteAtom(longitudeAtom,-180,180,'invalid Solar longitude');
        const eventCodes={rise:0,set:1};const event=Object.hasOwn(eventCodes,eventAtom)?eventCodes[eventAtom]:undefined;
        if(event===undefined)throw new CompileError('invalid Solar event');
        const offsetMs=signedAtom(offsetAtom,-86400000n,86400000n,'invalid Solar offset');
        if(basisAtom!=='pulse')throw new CompileError('unsupported Solar basis');
        if(clockPolicyAtom!=='trusted_only')throw new CompileError('unsupported Solar clock policy');
        const gapMs=unsignedAtom(gapAtom,9007199254740991n,'invalid schedule gap');if(gapMs===0n)throw new CompileError('invalid schedule gap');
        if(recoveryAtom!=='baseline')throw new CompileError('unsupported Solar recovery');
        if(fallbackAtom!=='skip')throw new CompileError('unsupported Solar fallback');
        const when=checkedExpression(whenForm,{...env,windows,schedules,trueFors:hasTrueFors?trueFors:undefined},false);
        if(when.type!==TYPE.bool)throw new CompileError('schedule predicate must be bool');
        const holdMs=a.length===15?unsignedAtom(a[13],9007199254740991n,'invalid hold duration'):0n;
        const fallbackAtMs=a.length===15?unsignedAtom(a[14],86400000n,'invalid Solar fallback time'):86400000n;
        if(a.length===15&&!holdMs&&fallbackAtMs===86400000n)throw new CompileError('extended Solar policy requires hold or fixed_time');
        const schedule={site,name:scheduleName,timezone,latitude,longitude,event,offsetMs,gapMs,when,
          ...(a.length===15?{holdMs,fallbackAtMs}: {})};
        schedules.push(schedule);preludes.push({kind:'schedule',value:schedule});
      }
      else if(h==='daily-pulse'){
        if(!temporal)throw new CompileError('temporal module requires one temporal-context');
        if(seenExecutable)throw new CompileError('stateful prelude declarations must precede transitions and intents');
        if(a.length!==12)throw new CompileError('daily-pulse expects 12 arguments');
        const [siteAtom,scheduleName,timezone,atAtom,missingAtom,repeatedAtom,basisAtom,clockAtom,gapAtom,recoveryAtom,fallbackAtom,whenForm]=a;
        const site=Number(unsignedAtom(siteAtom,4294967295n,'invalid schedule site'));
        if(site===0||preludeSites.has(site))throw new CompileError('invalid or duplicate prelude site');preludeSites.add(site);
        assertName(scheduleName,'schedule');if(preludeNames.has(scheduleName))throw new CompileError('duplicate prelude name');preludeNames.add(scheduleName);
        if(!wellFormedShortString(timezone))throw new CompileError('invalid Daily timezone');
        const atMs=unsignedAtom(atAtom,86399999n,'invalid Daily at');
        const dstMissing=['skip','next_valid'].indexOf(missingAtom),dstRepeated=['first','second','both','skip'].indexOf(repeatedAtom);
        if(dstMissing<0||dstRepeated<0)throw new CompileError('invalid Daily DST policy');
        if(basisAtom!=='pulse'||clockAtom!=='trusted_only'||recoveryAtom!=='baseline'||fallbackAtom!=='skip')throw new CompileError('unsupported Daily policy');
        const gapMs=unsignedAtom(gapAtom,9007199254740991n,'invalid schedule gap');if(gapMs===0n)throw new CompileError('invalid schedule gap');
        const when=checkedExpression(whenForm,{...env,windows,schedules},false);
        if(when.type!==TYPE.bool)throw new CompileError('invalid Daily predicate');
        const schedule={site,name:scheduleName,timezone,atMs,dstMissing,dstRepeated,gapMs,when};
        schedules.push(schedule);preludes.push({kind:'daily',value:schedule});
      }
      else if(h==='daily-slots-pulse'){
        if(!temporal)throw new CompileError('temporal module requires one temporal-context');
        if(seenExecutable)throw new CompileError('stateful prelude declarations must precede transitions and intents');
        if(a.length!==13)throw new CompileError('daily-slots-pulse expects 13 arguments');
        const [siteAtom,scheduleName,timezone,gridAtom,missingAtom,repeatedAtom,basisAtom,clockAtom,gapAtom,recoveryAtom,fallbackAtom,slotsForm,whenForm]=a;
        const site=Number(unsignedAtom(siteAtom,4294967295n,'invalid schedule site'));
        if(site===0||preludeSites.has(site))throw new CompileError('invalid or duplicate prelude site');preludeSites.add(site);
        assertName(scheduleName,'schedule');if(preludeNames.has(scheduleName))throw new CompileError('duplicate prelude name');preludeNames.add(scheduleName);
        if(!wellFormedShortString(timezone))throw new CompileError('invalid DailySlots timezone');
        const gridMs=unsignedAtom(gridAtom,86399999n,'invalid DailySlots grid');
        if(gridMs!==900000n)throw new CompileError('unsupported DailySlots grid');
        const dstMissing=['skip','next_valid'].indexOf(missingAtom),dstRepeated=['first','second','both','skip'].indexOf(repeatedAtom);
        if(dstMissing<0||dstRepeated<0)throw new CompileError('invalid DailySlots DST policy');
        if(basisAtom!=='pulse'||clockAtom!=='trusted_only'||recoveryAtom!=='baseline'||fallbackAtom!=='skip')throw new CompileError('unsupported DailySlots policy');
        const gapMs=unsignedAtom(gapAtom,9007199254740991n,'invalid schedule gap');if(gapMs===0n)throw new CompileError('invalid schedule gap');
        if(!Array.isArray(slotsForm)||slotsForm[0]!=='slots'||slotsForm.length<2||slotsForm.length>97)throw new CompileError('invalid DailySlots slots');
        const slots=slotsForm.slice(1).map(form=>{
          if(!Array.isArray(form)||form[0]!=='slot'||form.length!==3)throw new CompileError('invalid DailySlots slot');
          const key=Number(unsignedAtom(form[1],1440n,'invalid DailySlots slot key'));
          const minute=Number(unsignedAtom(form[2],1439n,'invalid DailySlots minute'));
          if(key!==minute+1||minute%15)throw new CompileError('invalid DailySlots slot');
          return {key,minute};
        });
        if(slots.some((slot,index)=>index>0&&slot.minute<=slots[index-1].minute))throw new CompileError('invalid DailySlots slot order');
        const when=checkedExpression(whenForm,{...env,windows,schedules},false);
        if(when.type!==TYPE.bool)throw new CompileError('invalid DailySlots predicate');
        const schedule={site,name:scheduleName,timezone,gridMs,dstMissing,dstRepeated,gapMs,slots,when};
        schedules.push(schedule);preludes.push({kind:'daily-slots',value:schedule});
      }
      else if(h==='config-stream'){
        if(!temporal||seenExecutable||a.length!==9)throw new CompileError('invalid config stream prelude');
        const [idAtom,configName,semanticType,kindName,editable,payload,okName,valueName,faultName]=a;
        const site=Number(unsignedAtom(idAtom,4294967295n,'invalid config id'));
        if(!site||preludeSites.has(site))throw new CompileError('invalid or duplicate config id');
        preludeSites.add(site);assertName(configName,'config');
        if(preludeNames.has(configName))throw new CompileError('duplicate prelude name');preludeNames.add(configName);
        if(!wellFormedShortString(semanticType)||!['true','false'].includes(editable)||!Array.isArray(payload))throw new CompileError('invalid config descriptor');
        const kind={Bool:0,Int:1,TimeSlots:3}[kindName]??(kindName===semanticType?2:undefined);
        if(kind===undefined || kind===0&&semanticType!=='Bool'||kind===1&&semanticType!=='Int')throw new CompileError('invalid config payload type');
        let detail;
        if(kind===3){
          if(payload[0]!=='slots'||payload.length<3||[okName,valueName,faultName].some(name=>name!=='none'))throw new CompileError('invalid TimeSlots config');
          const grid=unsignedAtom(payload[1],86400000n,'invalid TimeSlots grid');
          const capacity=Number(unsignedAtom(payload[2],65535n,'invalid TimeSlots capacity'));
          const slots=payload.slice(3).map(atom=>Number(unsignedAtom(atom,1439n,'invalid TimeSlots minute')));
          if(!grid||86400000n%grid||!capacity||slots.length>capacity||slots.some((minute,index)=>index>0&&minute<=slots[index-1]||BigInt(minute)*60000n%grid))throw new CompileError('invalid TimeSlots config');
          detail={grid,capacity,slots,indices:[65535,65535,65535]};
        }else{
          if(payload[0]!=='scalar'||payload.length!==3||!['none','bounds'].includes(Array.isArray(payload[2])?payload[2][0]:payload[2]))throw new CompileError('invalid scalar config');
          const parse=atom=>kind===0?atom==='true'?true:atom==='false'?false:(()=>{throw new CompileError('invalid Bool config');})():kind===1?Number(signedAtom(atom,-2147483648n,2147483647n,'invalid Int config')):finiteAtom(atom,-Infinity,Infinity,'invalid Number config');
          const initial=parse(payload[1]);const bounds=payload[2]==='none'?null:payload[2];
          if(bounds&&(kind===0||bounds.length!==4))throw new CompileError('invalid config bounds');
          const parsedBounds=bounds?bounds.slice(1).map(parse):null;
          const bindings=[okName,valueName,faultName].map(name=>env.inputs.get(name));
          if(bindings.some((entry,index)=>!entry||entry.type!==[TYPE.bool,[TYPE.bool,TYPE.int,TYPE.number][kind],TYPE.number][index]))throw new CompileError('invalid config Result projection');
          if(new Set(bindings.map(entry=>entry.index)).size!==3)throw new CompileError('duplicate config Result projection');
          for(const entry of bindings)if(certifiedInputs.has(entry.index))throw new CompileError('duplicate protected input');else certifiedInputs.add(entry.index);
          detail={initial,bounds:parsedBounds,indices:bindings.map(entry=>entry.index)};
        }
        const config={site,name:configName,semanticType,kind,editable:editable==='true'?1:0,detail};
        schedules.push(config);preludes.push({kind:'config-stream',value:config});
      }
      else if(contextHeads.includes(h)){
        if(!temporal||seenExecutable)throw new CompileError('context schedule requires temporal prelude before execution');
        const [siteAtom,scheduleName,gapAtom,...payload]=a;
        const holdMs=h==='tide-run'&&payload.length===9?unsignedAtom(payload.pop(),9007199254740991n,'invalid hold duration'):null;
        if(holdMs===0n)throw new CompileError('extended Tide policy requires positive hold duration');
        const site=Number(unsignedAtom(siteAtom,4294967295n,'invalid schedule site'));
        if(!site||preludeSites.has(site))throw new CompileError('invalid or duplicate prelude site');
        preludeSites.add(site);assertName(scheduleName,'schedule');
        if(preludeNames.has(scheduleName))throw new CompileError('duplicate prelude name');preludeNames.add(scheduleName);
        const gapMs=unsignedAtom(gapAtom,9007199254740991n,'invalid schedule gap');
        if(!gapMs)throw new CompileError('invalid schedule gap');
        const expected={ 'at-pulse':3,'cron-pulse':10,'calendar-daily-pulse':8,'tide-run':8,'config-daily-slots-pulse':6,'utc-range':5 }[h];
        if(h==='periodic-pulse'?![5,6].includes(payload.length):payload.length!==expected)throw new CompileError(`${h} has invalid arity`);
        const [whenForm,cancelForm]=payload.slice(-2);
        const when=checkedExpression(whenForm,contextEnv(),false),cancel=checkedExpression(cancelForm,contextEnv(),false);
        if(when.type!==TYPE.bool||cancel.type!==TYPE.bool)throw new CompileError('invalid context schedule predicate');
        const data=payload.slice(0,-2);
        const text=value=>{if(!wellFormedShortString(value))throw new CompileError('invalid context text');return value;};
        const dst=value=>{const index=['skip','next_valid'].indexOf(value);if(index<0)throw new CompileError('invalid DST missing policy');return index;};
        const repeated=value=>{const index=['first','second','both','skip'].indexOf(value);if(index<0)throw new CompileError('invalid DST repeated policy');return index;};
        let detail;
        if(h==='at-pulse'){
          detail={at:unsignedAtom(data[0],253402300799999n,'invalid At DateTime')};
        }else if(h==='utc-range'){
          const [timezone,duration,starts]=data;
          if(timezone!=='UTC'||!Array.isArray(starts)||starts[0]!=='starts'||starts.length<2||starts.length>97)throw new CompileError('invalid UTC Range definition');
          const values=starts.slice(1).map(atom=>unsignedAtom(atom,86399999n,'invalid UTC Range start'));
          const length=unsignedAtom(duration,86400000n,'invalid UTC Range duration');
          if(!length||values.some((value,index)=>index>0&&value<=values[index-1])
            ||values.some((value,index)=>(values[(index+1)%values.length]+(index+1===values.length?86400000n:0n))-value<length))throw new CompileError('UTC Range occurrences must not overlap');
          detail={timezone,duration:length,starts:values};
        }else if(h==='periodic-pulse'){
          const [epoch,anchor,configIdAtom,literalAtom]=data;
          const configId=Number(unsignedAtom(configIdAtom,4294967295n,'invalid Periodic config id'));
          if(configId===0&&literalAtom===undefined||configId!==0&&literalAtom!==undefined)throw new CompileError('invalid Periodic interval source');
          detail={epoch:text(epoch),anchor:unsignedAtom(anchor,253402300799999n,'invalid Periodic anchor'),configId,
            literal:literalAtom===undefined?null:unsignedAtom(literalAtom,9007199254740991n,'invalid Periodic interval')};
          if(detail.literal===0n)throw new CompileError('invalid Periodic interval');
        }else if(h==='cron-pulse'){
          const [timezone,missing,fold,...fields]=data;
          detail={timezone:text(timezone),missing:dst(missing),repeated:repeated(fold),fields:fields.map((field,index)=>{
            if(!Array.isArray(field)||field[0]!=='field'||field.length<2||field.length>65)throw new CompileError('invalid Cron field');
            const bounds=[[0,59],[0,23],[1,31],[1,12],[0,6]][index];
            const values=field.slice(1).map(atom=>Number(unsignedAtom(atom,BigInt(bounds[1]),'invalid Cron field value')));
            if(values.some(value=>value<bounds[0])||values.some((value,at)=>at>0&&value<=values[at-1]))throw new CompileError('invalid Cron field order');
            return values;
          })};
          if(detail.fields.length!==5)throw new CompileError('Cron requires five fields');
        }else if(h==='calendar-daily-pulse'){
          const [timezone,at,calendar,offday,missing,fold]=data;
          if(!['workday','offday'].includes(offday))throw new CompileError('invalid WorkCalendar selector');
          detail={timezone:text(timezone),at:unsignedAtom(at,86399999n,'invalid Daily at'),calendar:text(calendar),offday:offday==='offday'?1:0,missing:dst(missing),repeated:repeated(fold)};
        }else if(h==='tide-run'){
          const [timezone,provider,event,offset,run,within]=data;
          if(!['high','low'].includes(event))throw new CompileError('invalid Tide event');
          detail={timezone:text(timezone),provider:text(provider),high:event==='high'?1:0,
            offset:signedAtom(offset,-86400000n,86400000n,'invalid Tide offset'),
            run:unsignedAtom(run,9007199254740991n,'invalid Tide run'),
            within:unsignedAtom(within,9007199254740991n,'invalid Tide within')};
          if(!detail.run||!detail.within)throw new CompileError('invalid Tide duration');
        }else{
          const [timezone,configIdAtom,missing,fold]=data;
          detail={timezone:text(timezone),configId:Number(unsignedAtom(configIdAtom,4294967295n,'invalid TimeSlots config id')),
            missing:dst(missing),repeated:repeated(fold)};
          if(!detail.configId)throw new CompileError('invalid TimeSlots config id');
        }
        const schedule={site,name:scheduleName,gapMs,when,cancel,detail,...(holdMs!==null?{holdMs}: {})};
        schedules.push(schedule);preludes.push({kind:h,value:schedule});
      }
      else if(h==='natural-result'){
        if(!temporal||seenExecutable||a.length!==8)throw new CompileError('invalid natural result prelude');
        const [siteAtom,naturalName,kindName,provider,classification,okName,valueName,faultName]=a;
        const site=Number(unsignedAtom(siteAtom,4294967295n,'invalid natural site'));
        if(!site||preludeSites.has(site))throw new CompileError('invalid or duplicate natural site');
        preludeSites.add(site);assertName(naturalName,'natural result');
        if(preludeNames.has(naturalName))throw new CompileError('duplicate prelude name');preludeNames.add(naturalName);
        if(!['tide','moon'].includes(kindName)||!wellFormedShortString(provider)||!wellFormedShortString(classification))throw new CompileError('invalid natural provider');
        const bindings=[okName,valueName,faultName].map(name=>env.inputs.get(name));
        if(bindings.some((entry,index)=>!entry||entry.type!==[TYPE.bool,TYPE.bool,TYPE.number][index]))throw new CompileError('invalid natural Result projection');
        if(new Set(bindings.map(entry=>entry.index)).size!==3)throw new CompileError('duplicate natural Result projection');
        for(const entry of bindings)if(certifiedInputs.has(entry.index))throw new CompileError('duplicate protected input');else certifiedInputs.add(entry.index);
        preludes.push({kind:'natural-result',value:{site,name:naturalName,kind:kindName==='tide'?0:1,provider,classification,indices:bindings.map(entry=>entry.index)}});
      }
      else if(h==='accounting-result'){
        if(!temporal||seenExecutable||a.length!==8)throw new CompileError('invalid accounting result prelude');
        const [siteAtom,resultName,account,event,timezone,okName,valueName,faultName]=a;
        const site=Number(unsignedAtom(siteAtom,4294967295n,'invalid accounting site'));
        if(!site||preludeSites.has(site))throw new CompileError('invalid or duplicate accounting site');
        preludeSites.add(site);assertName(resultName,'accounting result');
        if(preludeNames.has(resultName))throw new CompileError('duplicate prelude name');preludeNames.add(resultName);
        for(const value of [account,event,timezone])if(!wellFormedShortString(value))throw new CompileError('invalid accounting identity');
        const bindings=[okName,valueName,faultName].map(name=>env.inputs.get(name));
        if(bindings.some((entry,index)=>!entry||entry.type!==[TYPE.bool,TYPE.int,TYPE.number][index]))throw new CompileError('invalid accounting Result projection');
        if(new Set(bindings.map(entry=>entry.index)).size!==3)throw new CompileError('duplicate accounting Result projection');
        for(const entry of bindings)if(certifiedInputs.has(entry.index))throw new CompileError('duplicate protected input');else certifiedInputs.add(entry.index);
        preludes.push({kind:'accounting-result',value:{site,name:resultName,account,event,timezone,indices:bindings.map(entry=>entry.index)}});
      }
      else if(h==='next'){seenExecutable=true;if(a.length!==2)throw new CompileError('next expects state expression');const st=env.states.get(a[0]);if(!st)throw new CompileError(`unknown state ${a[0]}`);const e=checkedExpression(a[1],{...env,windows:temporal?windows:undefined,schedules:hasSchedules?schedules:undefined,trueFors:hasTrueFors?trueFors:undefined,contextSchedules:hasContext},false);if(e.type!==st.type)throw new CompileError(`type mismatch for state ${a[0]}`);transitions.push({index:st.index,type:e.type,expression:e.expression});}
      else if(h==='intent'){seenExecutable=true;if(a.length!==2)throw new CompileError('intent expects name expression');assertName(a[0],'intent');const e=checkedExpression(a[1],{...env,windows:temporal?windows:undefined,schedules:hasSchedules?schedules:undefined,trueFors:hasTrueFors?trueFors:undefined,contextSchedules:hasContext},true);intents.push({name:a[0],type:e.type,expression:e.expression});}
      else throw new CompileError(`unknown strategy form ${h}`);
    }
    if(!query)throw new CompileError(`strategy ${sname} has no device query`); const seen=new Set();for(const t of transitions){if(seen.has(t.index))throw new CompileError('duplicate state transition');seen.add(t.index);} unique(intents,'intent');
    if(states.length+preludes.length>128)throw new CompileError('temporal state limit exceeded');
    if(intents.length>128)throw new CompileError('strategy resource limit exceeded');
    return {name:sname,priority,query,windows,schedules,preludes,transitions,intents};
  });
  unique(compiledStrategies,'strategy'); if(!compiledStrategies.length)throw new CompileError('module needs a strategy');
  for(const c of constraints)for(const s of compiledStrategies){const available=new Map(s.intents.map(i=>[i.name,i.type]));for(const n of c.names){if(!available.has(n))throw new CompileError(`constraint intent ${n} is missing from strategy ${s.name}`);if(available.get(n)!==TYPE.bool)throw new CompileError(`constraint intent ${n} must be bool`);}}
  if(objectives.length&&(objectives.length!==1||compiledStrategies.length!==1||temporal&&!hasContext||hasSchedules&&!hasContext||hasTrueFors))throw new CompileError('PID requires exactly one strategy and no legacy temporal prelude');
  if(objectives.length&&(compiledStrategies[0].transitions.length||compiledStrategies[0].intents.length))throw new CompileError('GFB7 PID objective cannot mix authored transitions or intents');
  const compiledObjectives=objectives.map(args=>{
    const [objectiveName,outputPort,measureName,measureOkName,targetName,safeMaxName,...tail]=args;
    const [targetOkName,periodAtom,lateAtom,directionAtom,...numberAtoms]=hasContext?tail:[null,...tail];
    if(hasContext&&args.length!==16||!hasContext&&args.length!==15)throw new CompileError('PID objective form does not match context format');
    assertName(objectiveName,'PID objective');assertName(outputPort,'PID output port');
    const bindings=[measureName,measureOkName,targetName,safeMaxName].map(name=>env.inputs.get(name));
    if(!bindings[0]||bindings[0].type!==TYPE.number||!bindings[1]||bindings[1].type!==TYPE.bool||!bindings[2]||bindings[2].type!==TYPE.number||!bindings[3]||bindings[3].type!==TYPE.number)throw new CompileError('invalid PID input binding');
    const targetOk=hasContext?env.inputs.get(targetOkName):null;
    if(hasContext&&(!targetOk||targetOk.type!==TYPE.bool))throw new CompileError('invalid PID target Result binding');
    const now=env.inputs.get('__gf_now_ms');if(!now||now.type!==TYPE.number)throw new CompileError('GFB7 PID requires __gf_now_ms Number input');
    const period=unsignedAtom(periodAtom,9007199254740991n,'invalid PID period'),late=unsignedAtom(lateAtom,9007199254740991n,'invalid PID late_after');
    if(period===0n||late<period)throw new CompileError('invalid PID timing');
    const direction=directionAtom==='direct'?0:directionAtom==='reverse'?1:undefined;if(direction===undefined)throw new CompileError('invalid PID direction');
    const numbers=numberAtoms.map((atom,index)=>finiteAtom(atom,index<3?0:-Infinity,Infinity,'invalid PID numeric field'));
    return {name:objectiveName,outputPort,indices:bindings.map(binding=>binding.index),targetOkIndex:targetOk?.index,period,late,direction,numbers};
  });
  if((hasDaily||hasDailySlots)&&(rawWindowCount||rawTrueForCount))throw new CompileError('mixed civil schedule temporal preludes are not executable');
  if(hasDailySlots&&(hasDaily||hasSolar))throw new CompileError('mixed DailySlots schedule kinds are not executable');
  const semanticType = code => ({1:'Bool',2:'Number',3:'Int'})[code];
  const missingPolicy=['skip','next_valid'],repeatedPolicy=['first','second','both','skip'];
  const semanticPrelude=prelude=>{
    const {kind,value}=prelude;
    if(kind==='window'){
      value.operation=['average','min','max','rate'][value.operation];
      value.payloadType=semanticType(value.payloadType);
      value.source=value.source.map(source=>({...source,type:semanticType(source.type)}));
    }else if(kind==='schedule')value.event=['rise','set'][value.event];
    else if(kind==='daily'||kind==='daily-slots'){
      value.dstMissing=missingPolicy[value.dstMissing];value.dstRepeated=repeatedPolicy[value.dstRepeated];
    }else if(kind==='config-stream'){
      value.kind=['Bool','Int','Number','TimeSlots'][value.kind];value.editable=Boolean(value.editable);
    }else if(kind==='natural-result')value.kind=['tide','moon'][value.kind];
    else if(value.detail){
      const detail=value.detail;
      if('missing' in detail)detail.missing=missingPolicy[detail.missing];
      if('repeated' in detail)detail.repeated=repeatedPolicy[detail.repeated];
      if('offday' in detail)detail.offday=detail.offday?'offday':'workday';
      if('high' in detail)detail.high=detail.high?'high':'low';
    }
    if(value.when)value.when={...value.when,type:semanticType(value.when.type)};
    if(value.cancel)value.cancel={...value.cancel,type:semanticType(value.cancel.type)};
    return prelude;
  };
  const semanticStrategies = compiledStrategies.map(strategy => ({
    name:strategy.name,priority:strategy.priority,query:strategy.query,
    transitions:strategy.transitions.map(transition => ({...transition,type:semanticType(transition.type)})),
    intents:strategy.intents.map(intent => ({...intent,type:semanticType(intent.type)})),
    extensions:{preludes:strategy.preludes.map(semanticPrelude)},
  }));
  return {name,version,
    inputs:inputs.map((input,index)=>({...input,index,type:semanticType(input.type)})),
    states:states.map((state,index)=>({...state,index,type:semanticType(state.type)})),
    strategies:semanticStrategies,
    constraints:constraints.map(constraint=>({...constraint,kind:({1:'requires',2:'mutex',3:'requires_any'})[constraint.kind]})),
    temporal:temporal?{nowInput:temporal.nowInput,timeEpochInput:temporal.timeEpochInput,roots:temporal.roots}:null,
    objectives:compiledObjectives.map(objective=>({...objective,direction:objective.direction?'reverse':'direct'}))};
}

function emitGfb(moduleIr) {
  const {name,version,inputs,states,strategies,constraints,temporal,objectives:compiledObjectives}=moduleIr;
  const preludeKinds=new Set(strategies.flatMap(strategy=>strategy.extensions.preludes.map(prelude=>prelude.kind)));
  const hasContext=['config-stream','periodic-pulse','cron-pulse','calendar-daily-pulse','tide-run',
    'config-daily-slots-pulse','natural-result','accounting-result','utc-range','at-pulse'].some(kind=>preludeKinds.has(kind));
  const hasDailySlots=preludeKinds.has('daily-slots'),hasDaily=preludeKinds.has('daily');
  const hasTrueFors=preludeKinds.has('true-for');
  const hasSchedules=[...preludeKinds].some(kind=>kind!=='window'&&kind!=='true-for'&&kind!=='natural-result'&&kind!=='accounting-result');
  const taggedPreludes=hasSchedules||hasTrueFors||hasContext;
  const hasPid=compiledObjectives.length>0;
  const intDeclarations=inputs.some(input=>input.type==='Int')||states.some(state=>state.type==='Int')
    ||strategies.some(strategy=>strategy.intents.some(intent=>intent.type==='Int'));
  const encode = (entry, message = 'strategy resource limit exceeded') => {
    const compiled = emitExpression(entry.expression);
    if (compiled.bytes.length > 4096) throw new CompileError(message);
    return compiled;
  };
  const encodeRecord = entry => { const compiled=encode(entry);return {...entry,...compiled,type:entry.type,expr:compiled.bytes}; };
  const compiledStrategies = strategies.map(strategy => ({...strategy,query:emitQuery(strategy.query),
    preludes:strategy.extensions.preludes,
    windows:strategy.extensions.preludes.filter(prelude=>prelude.kind==='window').map(prelude=>prelude.value),
    transitions: strategy.transitions.map(encodeRecord),
    intents: strategy.intents.map(encodeRecord),
  }));
  if(compiledStrategies.some(strategy=>strategy.query.length>4096))throw new CompileError('strategy resource limit exceeded');
  const intExpressions=compiledStrategies.some(s=>s.transitions.some(t=>t.usesInt)||s.intents.some(i=>i.usesInt));
  const format3=compiledStrategies.some(s=>s.transitions.some(t=>t.usesFormat3)||s.intents.some(i=>i.usesFormat3));
  const extendedNatural=strategies.some(strategy=>strategy.extensions.preludes.some(prelude=>
    prelude.kind==='schedule'&&(prelude.value.holdMs>0n||prelude.value.fallbackAtMs<86400000n)
    ||prelude.kind==='tide-run'&&prelude.value.holdMs>0n));
  const format=preludeKinds.has('at-pulse')?14:extendedNatural?13:preludeKinds.has('utc-range')?12:hasContext?11:hasDailySlots?9:hasDaily?8:hasPid?7:hasTrueFors?6:hasSchedules?5:temporal?4:format3?3:intDeclarations||intExpressions?2:1;
  const w=new Writer();w.bytes(UTF8.encode('GFB1'));w.u16(format);w.str(name);w.u32(version);
  const typeCode=type=>TYPE[type.toLowerCase()];
  w.u16(inputs.length);for(const x of inputs){w.str(x.name);w.u8(typeCode(x.type));}
  w.u16(states.length);for(const x of states){w.str(x.name);w.u8(typeCode(x.type));if(x.type==='Bool')w.u8(x.value?1:0);else if(x.type==='Int')w.i32(x.value);else w.f64(x.value);}
  if(temporal){w.u16(temporal.nowInput);w.u16(temporal.timeEpochInput);w.u16(temporal.roots.length);for(const root of temporal.roots){w.u32(root.tag);w.str(root.name);for(const index of root.indices)w.u16(index);}}
  const missingCode=value=>['skip','next_valid'].indexOf(value),repeatedCode=value=>['first','second','both','skip'].indexOf(value);
  const writeWindow=window=>{w.u32(window.site);w.str(window.name);w.u8(['average','min','max','rate'].indexOf(window.operation));w.u8(typeCode(window.payloadType));w.u64(window.overMs);w.u64(window.maxAgeMs);w.u16(window.rootRefs.length);for(const root of window.rootRefs)w.u16(root);for(const expression of window.source){const bytes=encode(expression).bytes;w.u32(bytes.length);w.bytes(bytes);}};
  const writeSchedule=schedule=>{w.u32(schedule.site);w.str(schedule.name);w.str(schedule.timezone);w.f64(schedule.latitude);w.f64(schedule.longitude);w.u8(schedule.event==='rise'?0:1);w.i64(schedule.offsetMs);w.u8(0);w.u8(0);w.u8(0);w.u8(0);w.u64(schedule.gapMs);const bytes=encode(schedule.when).bytes;w.u32(bytes.length);w.bytes(bytes);if(format===13){w.u64(schedule.holdMs??0n);w.u64(schedule.fallbackAtMs??86400000n);}};
  const writeDaily=schedule=>{w.u32(schedule.site);w.str(schedule.name);w.str(schedule.timezone);w.u64(schedule.atMs);w.u8(missingCode(schedule.dstMissing));w.u8(repeatedCode(schedule.dstRepeated));w.u8(0);w.u8(0);w.u8(0);w.u8(0);w.u64(schedule.gapMs);const bytes=encode(schedule.when,'invalid Daily predicate').bytes;w.u32(bytes.length);w.bytes(bytes);};
  const writeDailySlots=schedule=>{w.u32(schedule.site);w.str(schedule.name);w.str(schedule.timezone);w.u64(schedule.gridMs);w.u8(missingCode(schedule.dstMissing));w.u8(repeatedCode(schedule.dstRepeated));w.u8(0);w.u8(0);w.u8(0);w.u8(0);w.u64(schedule.gapMs);w.u16(schedule.slots.length);for(const slot of schedule.slots){w.u16(slot.key);w.u16(slot.minute);}const bytes=encode(schedule.when,'invalid DailySlots predicate').bytes;w.u32(bytes.length);w.bytes(bytes);};
  const writeTrueFor=signal=>{w.u32(signal.site);w.str(signal.name);w.u32(signal.sourceTag);w.str(signal.sourceName);w.u64(signal.durationMs);for(const index of signal.indices)w.u16(index);};
  const writeContext=prelude=>{const x=prelude.value,d=x.detail;w.u32(x.site);w.str(x.name);if(prelude.kind==='config-stream'){
    w.str(x.semanticType);w.u8(['Bool','Int','Number','TimeSlots'].indexOf(x.kind));w.u8(x.editable?1:0);
    if(x.kind==='TimeSlots'){w.u64(d.grid);w.u16(d.capacity);w.u16(d.slots.length);for(const minute of d.slots)w.u16(minute);}
    else{const put=value=>x.kind==='Bool'?w.u8(value?1:0):x.kind==='Int'?w.i32(value):w.f64(value);put(d.initial);w.u8(d.bounds?1:0);if(d.bounds)for(const value of d.bounds)put(value);}
    for(const index of d.indices)w.u16(index);return;
  }if(prelude.kind==='natural-result'){
    w.u8(x.kind==='tide'?0:1);w.str(x.provider);w.str(x.classification);for(const index of x.indices)w.u16(index);return;
  }if(prelude.kind==='accounting-result'){
    w.str(x.account);w.str(x.event);w.str(x.timezone);for(const index of x.indices)w.u16(index);return;
  }w.u64(x.gapMs);
    if(prelude.kind==='at-pulse'){w.u64(d.at);}
    else if(prelude.kind==='utc-range'){w.str(d.timezone);w.u64(d.duration);w.u16(d.starts.length);for(const start of d.starts)w.u64(start);}
    else if(prelude.kind==='periodic-pulse'){w.str(d.epoch);w.u64(d.anchor);w.u32(d.configId);if(d.configId===0)w.u64(d.literal);}
    else if(prelude.kind==='cron-pulse'){w.str(d.timezone);w.u8(missingCode(d.missing));w.u8(repeatedCode(d.repeated));for(const field of d.fields){w.u8(field.length);for(const value of field)w.u8(value);}}
    else if(prelude.kind==='calendar-daily-pulse'){w.str(d.timezone);w.u64(d.at);w.str(d.calendar);w.u8(d.offday==='offday'?1:0);w.u8(missingCode(d.missing));w.u8(repeatedCode(d.repeated));}
    else if(prelude.kind==='tide-run'){w.str(d.timezone);w.str(d.provider);w.u8(d.high==='high'?1:0);w.i64(d.offset);w.u64(d.run);w.u64(d.within);}
    else {w.str(d.timezone);w.u32(d.configId);w.u8(missingCode(d.missing));w.u8(repeatedCode(d.repeated));}
    for(const expression of [x.when,x.cancel]){const bytes=encode(expression,'invalid context schedule predicate').bytes;w.u32(bytes.length);w.bytes(bytes);}
    if(format===13)w.u64(x.holdMs??0n);
  };
  w.u16(compiledStrategies.length);for(const s of compiledStrategies){w.str(s.name);w.i32(s.priority);w.u32(s.query.length);w.bytes(s.query);if(temporal){if(taggedPreludes){w.u16(s.preludes.length);for(const prelude of s.preludes){const tag={'window':0,'schedule':1,'true-for':2,'daily':3,'daily-slots':4,'periodic-pulse':5,'cron-pulse':6,'calendar-daily-pulse':7,'tide-run':8,'config-daily-slots-pulse':9,'natural-result':10,'accounting-result':11,'config-stream':12,'utc-range':13,'at-pulse':14}[prelude.kind];w.u8(tag);if(tag>=5)writeContext(prelude);else if(prelude.kind==='window')writeWindow(prelude.value);else if(prelude.kind==='schedule')writeSchedule(prelude.value);else if(prelude.kind==='daily')writeDaily(prelude.value);else if(prelude.kind==='daily-slots')writeDailySlots(prelude.value);else writeTrueFor(prelude.value);}}else{w.u16(s.windows.length);for(const window of s.windows)writeWindow(window);}}w.u16(s.transitions.length);for(const t of s.transitions){w.u16(t.index);w.u32(t.expr.length);w.bytes(t.expr);}w.u16(s.intents.length);for(const i of s.intents){w.str(i.name);w.u8(typeCode(i.type));w.u32(i.expr.length);w.bytes(i.expr);}}
  w.u16(constraints.length);for(const c of constraints){w.u8(({requires:1,mutex:2,requires_any:3})[c.kind]);w.u16(c.names.length);for(const n of c.names)w.str(n);}
  if(format===7||format>=11){w.u16(compiledObjectives.length);for(const objective of compiledObjectives){w.str(objective.name);w.str(objective.outputPort);for(const index of objective.indices)w.u16(index);if(format>=11)w.u16(objective.targetOkIndex);w.u64(objective.period);w.u64(objective.late);w.u8(objective.direction==='direct'?0:1);for(const value of objective.numbers)w.f64(value);}}
  return w.finish();
}

function compile(ast) { return emitGfb(lowerCoreModule(ast)); }

export { tokenize, parse, compile, CompileError, lowerCoreModule, emitGfb };
