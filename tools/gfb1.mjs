class CompileError extends Error {}

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

function compileExpr(node, env, allowNext=false) {
  let w = new Writer();
  let depth = 0, nodes = 0, usesInt = false, usesFormat3 = false;
  function containsBranch(n) {
    return Array.isArray(n) && (['if', 'and', 'or'].includes(n[0]) || n.slice(1).some(containsBranch));
  }
  const compactNumbers = containsBranch(node);
  function emitBranch(condition, yes, no, logicalOperator = null) {
    if (emit(condition)!==TYPE.bool) throw new CompileError(logicalOperator ? `${logicalOperator} expects bools` : 'if condition must be bool');
    const outer = w;
    w = new Writer(); const yesType = emit(yes), yesBytes = w.finish();
    w = new Writer(); const noType = emit(no), noBytes = w.finish();
    w = outer;
    if (yesType!==noType) throw new CompileError(logicalOperator ? `${logicalOperator} expects bools` : 'if branches must have same type');
    if (yesBytes.length+3>65535 || noBytes.length>65535) throw new CompileError('expression complexity limit exceeded');
    w.u8(OP.branchFalse); w.u16(yesBytes.length+3); w.bytes(yesBytes);
    w.u8(OP.jump); w.u16(noBytes.length); w.bytes(noBytes);
    usesFormat3 = true;
    return yesType;
  }
  function emit(n) {
    if (++depth > 128 || ++nodes > 4096) throw new CompileError('expression complexity limit exceeded');
    try { return emitNode(n); } finally { depth--; }
  }
  function emitNode(n) {
    if (n === 'true' || n === 'false') { w.u8(OP.bool); w.u8(n === 'true' ? 1 : 0); return TYPE.bool; }
    if (typeof n === 'string' && /^-?(\d+(\.\d*)?|\.\d+)$/.test(n)) {
      const value = Number(n);
      if (!Number.isFinite(value)) throw new CompileError('non-finite number');
      if (compactNumbers && Number.isInteger(value) && value>=0 && value<=15 && !Object.is(value,-0)) w.u8(32+value);
      else { w.u8(OP.number); w.f64(value); }
      return TYPE.number;
    }
    if (typeof n === 'string') {
      const dot=n.indexOf('.'); if (dot<1) throw new CompileError(`unknown atom ${n}`);
      const ns=n.slice(0,dot), name=n.slice(dot+1);
      if (ns==='input') { const x=env.inputs.get(name); if(!x) throw new CompileError(`unknown input ${name}`); w.u8(OP.input); w.u16(x.index); return x.type; }
      if (ns==='state') { const x=env.states.get(name); if(!x) throw new CompileError(`unknown state ${name}`); w.u8(OP.state); w.u16(x.index); return x.type; }
      if (ns==='next') { if(!allowNext) throw new CompileError('next.* is allowed only in intents'); const x=env.states.get(name); if(!x) throw new CompileError(`unknown state ${name}`); w.u8(OP.next); w.u16(x.index); return x.type; }
      throw new CompileError(`unknown namespace ${ns}`);
    }
    if (!Array.isArray(n) || n.length<1) throw new CompileError('invalid expression');
    const [head, ...args]=n;
    if (head==='true-for-read') {
      if (!env.trueFors) throw new CompileError('true-for-read requires GFB format 6');
      if (args.length!==2) throw new CompileError('true-for-read expects slot and field');
      const slot=Number(unsignedAtom(args[0],65535n,'true_for projection index'));
      if (!env.trueFors[slot]) throw new CompileError('true_for projection index');
      const field=new Map([['ok',0],['value',1],['fault',2],['origin',3],['start',4],['end',5],['covered',6]]).get(args[1]);
      if (field===undefined) throw new CompileError('true_for projection field');
      w.u8(OP[head]);w.u16(slot);w.u8(field);
      return field<=1?TYPE.bool:TYPE.number;
    }
    if (head==='window-read') {
      if (!env.windows) throw new CompileError('window-read requires GFB format 4');
      if (args.length!==2) throw new CompileError('window-read expects slot and field');
      const slotValue=unsignedAtom(args[0],65535n,'temporal projection index');
      const slot=Number(slotValue), window=env.windows[slot];
      if (!window) throw new CompileError('temporal projection index');
      const fields=new Map([['ok',0],['value',1],['fault',2],['origin',3],['revision',4],['timestamp',5],['count',6],['quality',7]]);
      const field=fields.get(args[1]); if(field===undefined)throw new CompileError('temporal projection field');
      w.u8(OP[head]);w.u16(slot);w.u8(field);
      return field===0?TYPE.bool:field===1?window.payloadType:TYPE.number;
    }
    if (head==='schedule-read') {
      if (!env.schedules) throw new CompileError('schedule-read requires GFB format 5');
      if (args.length!==2) throw new CompileError('schedule-read expects slot and field');
      const slotValue=unsignedAtom(args[0],65535n,'schedule projection index');
      const slot=Number(slotValue), schedule=env.schedules[slot];
      if (!schedule) throw new CompileError('schedule projection index');
      const field=new Map([['due',0],['missed',1]]).get(args[1]);
      if (field===undefined) throw new CompileError('schedule projection field');
      w.u8(OP[head]);w.u16(slot);w.u8(field);
      return TYPE.bool;
    }
    if (head==='trace-result') {
      if(args.length!==4 || typeof args[0]!=='string' || !/^\d+$/.test(args[0]) || Number(args[0])<1 || Number(args[0])>4294967295) throw new CompileError('trace-result expects a positive u32 site, payload, Number choice and Number origin');
      const type=emit(args[1]);
      if(emit(args[2])!==TYPE.number || emit(args[3])!==TYPE.number) throw new CompileError('trace-result metadata must be Number');
      usesFormat3=true; w.u8(OP[head]); w.u32(Number(args[0])); return type;
    }
    if (head==='int') { if(args.length!==1 || typeof args[0] !== 'string' || !/^-?\d+$/.test(args[0])) throw new CompileError('int expects one signed decimal i32 literal'); const value=BigInt(args[0]);if(value < -2147483648n || value > 2147483647n)throw new CompileError('int literal outside i32 range');usesInt=true;w.u8(OP.int);w.i32(Number(value));return TYPE.int; }
    if (head==='int-neg') { if(args.length!==1 || emit(args[0])!==TYPE.int) throw new CompileError('int-neg expects Int');usesInt=true;w.u8(OP[head]);return TYPE.int; }
    if (['int-add','int-sub','int-mul','int-div','int-rem'].includes(head)) { if(args.length!==2)throw new CompileError(`${head} expects 2 arguments`);const a=emit(args[0]),b=emit(args[1]);if(a!==TYPE.int||b!==TYPE.int)throw new CompileError(`${head} expects Int operands`);usesInt=true;w.u8(OP[head]);return TYPE.int; }
    if (head==='not') { if(args.length!==1 || emit(args[0])!==TYPE.bool) throw new CompileError('not expects bool'); w.u8(OP.not); return TYPE.bool; }
    if (head==='and' || head==='or') { if(args.length!==2) throw new CompileError(`${head} expects 2 arguments`); return head==='and' ? emitBranch(args[0],args[1],'false',head) : emitBranch(args[0],'true',args[1],head); }
    if (['eq','lt','lte','gt','gte'].includes(head)) { if(args.length!==2) throw new CompileError(`${head} expects 2 arguments`); const a=emit(args[0]),b=emit(args[1]); if(a!==b || (head!=='eq'&&a!==TYPE.number&&a!==TYPE.int)) throw new CompileError(`bad operands for ${head}`); if(a===TYPE.int)usesInt=true;w.u8(OP[head]); return TYPE.bool; }
    if (['add','sub','mul','div'].includes(head)) { if(args.length!==2) throw new CompileError(`${head} expects 2 arguments`); const a=emit(args[0]),b=emit(args[1]); if(a!==TYPE.number||b!==TYPE.number) throw new CompileError(`${head} expects numbers`); w.u8(OP[head]); return TYPE.number; }
    if (head==='if') { if(args.length!==3) throw new CompileError('if expects 3 arguments'); return emitBranch(...args); }
    if (['int-to-number','int-exact','int-floor','int-ceil','int-trunc','int-nearest-even'].includes(head)) {
      const sourceType = head==='int-to-number' ? TYPE.int : TYPE.number;
      if (args.length!==1 || emit(args[0])!==sourceType) throw new CompileError(`${head} expects one ${sourceType===TYPE.int?'Int':'Number'} operand`);
      usesInt = true; usesFormat3 = true;
      w.u8(OP[head]);
      return head==='int-to-number' ? TYPE.number : TYPE.int;
    }
    if (head==='check-duration' || head==='check-datetime') {
      if (args.length!==1 || emit(args[0])!==TYPE.number) throw new CompileError(`${head} expects one Number operand`);
      usesFormat3 = true; w.u8(OP[head]); return TYPE.number;
    }
    throw new CompileError(`unknown expression ${head}`);
  }
  const type=emit(node); return {type, bytes:w.finish(),usesInt,usesFormat3};
}

function compileQuery(node) {
  const w=new Writer();
  function emit(n) {
    if (n === 'true' || n === 'false') { w.u8(5); w.u8(n === 'true' ? 1 : 0); return; }
    if (!Array.isArray(n)||n.length<1) throw new CompileError('invalid device query');
    const [head,...args]=n;
    if(head==='has') { if(args.length!==3) throw new CompileError('has expects kind name type'); assertName(args[0],'capability kind'); assertName(args[1],'capability'); w.u8(1); w.str(args[0]); w.str(args[1]); w.u8(scalarType(args[2])); return; }
    if(head==='all'||head==='any') { if(args.length<1) throw new CompileError(`${head} needs children`); for(const a of args) emit(a); w.u8(head==='all'?2:3); w.u16(args.length); return; }
    if(head==='not') { if(args.length!==1) throw new CompileError('query not expects one child'); emit(args[0]); w.u8(4); return; }
    throw new CompileError(`unknown device query ${head}`);
  }
  emit(node); return w.finish();
}

function compile(ast) {
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
    else if(head==='pid-objective') { if(args.length!==15)throw new CompileError('pid-objective expects 15 arguments');objectives.push(args); }
    else throw new CompileError(`unknown module form ${head}`);
  }
  const unique=(xs,label)=>{const s=new Set();for(const x of xs){if(s.has(x.name))throw new CompileError(`duplicate ${label} ${x.name}`);s.add(x.name);}};
  unique(inputs,'input'); unique(states,'state');
  if(inputs.length>128||states.length>128||strategies.length>32||constraints.length>128)throw new CompileError('module resource limit exceeded');
  for(const c of constraints){if(c.names.length>32||new Set(c.names).size!==c.names.length)throw new CompileError('invalid constraint names or arity');for(const n of c.names)assertName(n,'constraint');}
  const env={inputs:new Map(inputs.map((x,i)=>[x.name,{...x,index:i}])),states:new Map(states.map((x,i)=>[x.name,{...x,index:i}]))};
  const rawWindowCount=strategies.reduce((total,{raw})=>total+raw.slice(3).filter(form=>Array.isArray(form)&&form[0]==='window').length,0);
  const rawScheduleCount=strategies.reduce((total,{raw})=>total+raw.slice(3).filter(form=>Array.isArray(form)&&['solar-pulse','daily-pulse'].includes(form[0])).length,0);
  const hasDaily=strategies.some(({raw})=>raw.slice(3).some(form=>Array.isArray(form)&&form[0]==='daily-pulse'));
  const rawTrueForCount=strategies.reduce((total,{raw})=>total+raw.slice(3).filter(form=>Array.isArray(form)&&form[0]==='true-for').length,0);
  const rawPreludeCount=rawWindowCount+rawScheduleCount+rawTrueForCount;
  const hasSchedules=rawScheduleCount>0;
  const hasTrueFors=rawTrueForCount>0;
  const taggedPreludes=hasSchedules||hasTrueFors;
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
    for(const f of forms){if(!Array.isArray(f))throw new CompileError('invalid strategy form');const [h,...a]=f;
      if(h==='device'){if(a.length!==1||query)throw new CompileError('strategy needs one device query');query=compileQuery(a[0]);}
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
          const compiled=compileExpr(expression,sourceEnv,false);
          if(compiled.type!==expected[index])throw new CompileError('temporal source expression type mismatch');
          if(compiled.bytes.length>4096)throw new CompileError('strategy resource limit exceeded');
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
        if(a.length!==13)throw new CompileError('solar-pulse expects 13 arguments');
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
        const when=compileExpr(whenForm,{...env,windows,schedules,trueFors:hasTrueFors?trueFors:undefined},false);
        if(when.type!==TYPE.bool)throw new CompileError('schedule predicate must be bool');
        if(when.bytes.length>4096)throw new CompileError('strategy resource limit exceeded');
        const schedule={site,name:scheduleName,timezone,latitude,longitude,event,offsetMs,gapMs,when};
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
        const when=compileExpr(whenForm,{...env,windows,schedules},false);
        if(when.type!==TYPE.bool||when.bytes.length>4096)throw new CompileError('invalid Daily predicate');
        const schedule={site,name:scheduleName,timezone,atMs,dstMissing,dstRepeated,gapMs,when};
        schedules.push(schedule);preludes.push({kind:'daily',value:schedule});
      }
      else if(h==='next'){seenExecutable=true;if(a.length!==2)throw new CompileError('next expects state expression');const st=env.states.get(a[0]);if(!st)throw new CompileError(`unknown state ${a[0]}`);const e=compileExpr(a[1],{...env,windows:temporal?windows:undefined,schedules:hasSchedules?schedules:undefined,trueFors:hasTrueFors?trueFors:undefined},false);if(e.type!==st.type)throw new CompileError(`type mismatch for state ${a[0]}`);transitions.push({index:st.index,type:e.type,usesInt:e.usesInt,usesFormat3:e.usesFormat3,expr:e.bytes});}
      else if(h==='intent'){seenExecutable=true;if(a.length!==2)throw new CompileError('intent expects name expression');assertName(a[0],'intent');const e=compileExpr(a[1],{...env,windows:temporal?windows:undefined,schedules:hasSchedules?schedules:undefined,trueFors:hasTrueFors?trueFors:undefined},true);intents.push({name:a[0],type:e.type,usesInt:e.usesInt,usesFormat3:e.usesFormat3,expr:e.bytes});}
      else throw new CompileError(`unknown strategy form ${h}`);
    }
    if(!query)throw new CompileError(`strategy ${sname} has no device query`); const seen=new Set();for(const t of transitions){if(seen.has(t.index))throw new CompileError('duplicate state transition');seen.add(t.index);} unique(intents,'intent');
    if(states.length+preludes.length>128)throw new CompileError('temporal state limit exceeded');
    if(intents.length>128||query.length>4096||transitions.some(t=>t.expr.length>4096)||intents.some(i=>i.expr.length>4096))throw new CompileError('strategy resource limit exceeded');
    return {name:sname,priority,query,windows,schedules,preludes,transitions,intents};
  });
  unique(compiledStrategies,'strategy'); if(!compiledStrategies.length)throw new CompileError('module needs a strategy');
  for(const c of constraints)for(const s of compiledStrategies){const available=new Map(s.intents.map(i=>[i.name,i.type]));for(const n of c.names){if(!available.has(n))throw new CompileError(`constraint intent ${n} is missing from strategy ${s.name}`);if(available.get(n)!==TYPE.bool)throw new CompileError(`constraint intent ${n} must be bool`);}}
  const intDeclarations=inputs.some(x=>x.type===TYPE.int)||states.some(x=>x.type===TYPE.int)||compiledStrategies.some(s=>s.intents.some(i=>i.type===TYPE.int));
  const intExpressions=compiledStrategies.some(s=>s.transitions.some(t=>t.usesInt)||s.intents.some(i=>i.usesInt));
  const format3=compiledStrategies.some(s=>s.transitions.some(t=>t.usesFormat3)||s.intents.some(i=>i.usesFormat3));
  if(objectives.length&&(objectives.length!==1||compiledStrategies.length!==1||temporal||hasSchedules||hasTrueFors))throw new CompileError('GFB7 requires exactly one strategy and one non-temporal PID objective');
  if(objectives.length&&(compiledStrategies[0].transitions.length||compiledStrategies[0].intents.length))throw new CompileError('GFB7 PID objective cannot mix authored transitions or intents');
  const compiledObjectives=objectives.map(args=>{
    const [objectiveName,outputPort,measureName,measureOkName,targetName,safeMaxName,periodAtom,lateAtom,directionAtom,...numberAtoms]=args;
    assertName(objectiveName,'PID objective');assertName(outputPort,'PID output port');
    const bindings=[measureName,measureOkName,targetName,safeMaxName].map(name=>env.inputs.get(name));
    if(!bindings[0]||bindings[0].type!==TYPE.number||!bindings[1]||bindings[1].type!==TYPE.bool||!bindings[2]||bindings[2].type!==TYPE.number||!bindings[3]||bindings[3].type!==TYPE.number)throw new CompileError('invalid PID input binding');
    const now=env.inputs.get('__gf_now_ms');if(!now||now.type!==TYPE.number)throw new CompileError('GFB7 PID requires __gf_now_ms Number input');
    const period=unsignedAtom(periodAtom,9007199254740991n,'invalid PID period'),late=unsignedAtom(lateAtom,9007199254740991n,'invalid PID late_after');
    if(period===0n||late<period)throw new CompileError('invalid PID timing');
    const direction=directionAtom==='direct'?0:directionAtom==='reverse'?1:undefined;if(direction===undefined)throw new CompileError('invalid PID direction');
    const numbers=numberAtoms.map((atom,index)=>finiteAtom(atom,index<3?0:-Infinity,Infinity,'invalid PID numeric field'));
    return {name:objectiveName,outputPort,indices:bindings.map(binding=>binding.index),period,late,direction,numbers};
  });
  if(hasDaily&&(rawWindowCount||rawTrueForCount))throw new CompileError('mixed Daily temporal preludes are not executable');
  const format=hasDaily?8:objectives.length?7:hasTrueFors?6:hasSchedules?5:temporal?4:format3?3:intDeclarations||intExpressions?2:1;
  const w=new Writer();w.bytes(UTF8.encode('GFB1'));w.u16(format);w.str(name);w.u32(version);
  w.u16(inputs.length);for(const x of inputs){w.str(x.name);w.u8(x.type);}
  w.u16(states.length);for(const x of states){w.str(x.name);w.u8(x.type);if(x.type===TYPE.bool)w.u8(x.value?1:0);else if(x.type===TYPE.int)w.i32(x.value);else w.f64(x.value);}
  if(temporal){w.u16(temporal.nowInput);w.u16(temporal.timeEpochInput);w.u16(temporal.roots.length);for(const root of temporal.roots){w.u32(root.tag);w.str(root.name);for(const index of root.indices)w.u16(index);}}
  const writeWindow=window=>{w.u32(window.site);w.str(window.name);w.u8(window.operation);w.u8(window.payloadType);w.u64(window.overMs);w.u64(window.maxAgeMs);w.u16(window.rootRefs.length);for(const root of window.rootRefs)w.u16(root);for(const expression of window.source){w.u32(expression.bytes.length);w.bytes(expression.bytes);}};
  const writeSchedule=schedule=>{w.u32(schedule.site);w.str(schedule.name);w.str(schedule.timezone);w.f64(schedule.latitude);w.f64(schedule.longitude);w.u8(schedule.event);w.i64(schedule.offsetMs);w.u8(0);w.u8(0);w.u8(0);w.u8(0);w.u64(schedule.gapMs);w.u32(schedule.when.bytes.length);w.bytes(schedule.when.bytes);};
  const writeDaily=schedule=>{w.u32(schedule.site);w.str(schedule.name);w.str(schedule.timezone);w.u64(schedule.atMs);w.u8(schedule.dstMissing);w.u8(schedule.dstRepeated);w.u8(0);w.u8(0);w.u8(0);w.u8(0);w.u64(schedule.gapMs);w.u32(schedule.when.bytes.length);w.bytes(schedule.when.bytes);};
  const writeTrueFor=signal=>{w.u32(signal.site);w.str(signal.name);w.u32(signal.sourceTag);w.str(signal.sourceName);w.u64(signal.durationMs);for(const index of signal.indices)w.u16(index);};
  w.u16(compiledStrategies.length);for(const s of compiledStrategies){w.str(s.name);w.i32(s.priority);w.u32(s.query.length);w.bytes(s.query);if(temporal){if(taggedPreludes){w.u16(s.preludes.length);for(const prelude of s.preludes){w.u8(prelude.kind==='window'?0:prelude.kind==='schedule'?1:prelude.kind==='daily'?3:2);if(prelude.kind==='window')writeWindow(prelude.value);else if(prelude.kind==='schedule')writeSchedule(prelude.value);else if(prelude.kind==='daily')writeDaily(prelude.value);else writeTrueFor(prelude.value);}}else{w.u16(s.windows.length);for(const window of s.windows)writeWindow(window);}}w.u16(s.transitions.length);for(const t of s.transitions){w.u16(t.index);w.u32(t.expr.length);w.bytes(t.expr);}w.u16(s.intents.length);for(const i of s.intents){w.str(i.name);w.u8(i.type);w.u32(i.expr.length);w.bytes(i.expr);}}
  w.u16(constraints.length);for(const c of constraints){w.u8(c.kind);w.u16(c.names.length);for(const n of c.names)w.str(n);}
  if(format===7){w.u16(compiledObjectives.length);for(const objective of compiledObjectives){w.str(objective.name);w.str(objective.outputPort);for(const index of objective.indices)w.u16(index);w.u64(objective.period);w.u64(objective.late);w.u8(objective.direction);for(const value of objective.numbers)w.f64(value);}}
  return w.finish();
}

export { tokenize, parse, compile, CompileError };
