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

const TYPE = { bool: 1, number: 2 };
const OP = { bool:1, number:2, input:3, state:4, next:5, not:10, and:11, or:12,
  eq:13, lt:14, lte:15, gt:16, gte:17, if:18, add:19, sub:20, mul:21, div:22 };

class Writer {
  constructor() { this.parts = []; }
  bytes(v) { this.parts.push(v instanceof Uint8Array ? v : new Uint8Array(v)); }
  u8(v) { const b=new Uint8Array(1); new DataView(b.buffer).setUint8(0,v); this.parts.push(b); }
  u16(v) { const b=new Uint8Array(2); new DataView(b.buffer).setUint16(0,v,true); this.parts.push(b); }
  u32(v) { const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,v,true); this.parts.push(b); }
  i32(v) { const b=new Uint8Array(4); new DataView(b.buffer).setInt32(0,v,true); this.parts.push(b); }
  f64(v) { const b=new Uint8Array(8); new DataView(b.buffer).setFloat64(0,v,true); this.parts.push(b); }
  str(s) { const b=UTF8.encode(s); if (b.length>65535) throw new CompileError('string too long'); this.u16(b.length); this.bytes(b); }
  finish() { const size=this.parts.reduce((total,part)=>total+part.byteLength,0); const out=new Uint8Array(size); let at=0; for(const part of this.parts){out.set(part,at);at+=part.byteLength;} return globalThis.Buffer?.from ? globalThis.Buffer.from(out) : out; }
}

function assertName(name, label) {
  if (typeof name !== 'string' || name.length > 128 || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name))
    throw new CompileError(`invalid ${label} name: ${name}`);
}

function scalarType(name) {
  if (!TYPE[name]) throw new CompileError(`unknown type ${name}`);
  return TYPE[name];
}

function compileExpr(node, env, allowNext=false) {
  const w = new Writer();
  let depth = 0, nodes = 0;
  function emit(n) {
    if (++depth > 128 || ++nodes > 4096) throw new CompileError('expression complexity limit exceeded');
    try { return emitNode(n); } finally { depth--; }
  }
  function emitNode(n) {
    if (n === 'true' || n === 'false') { w.u8(OP.bool); w.u8(n === 'true' ? 1 : 0); return TYPE.bool; }
    if (typeof n === 'string' && /^-?(\d+(\.\d*)?|\.\d+)$/.test(n)) { if (!Number.isFinite(Number(n))) throw new CompileError('non-finite number'); w.u8(OP.number); w.f64(Number(n)); return TYPE.number; }
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
    if (head==='not') { if(args.length!==1 || emit(args[0])!==TYPE.bool) throw new CompileError('not expects bool'); w.u8(OP.not); return TYPE.bool; }
    if (head==='and' || head==='or') { if(args.length!==2) throw new CompileError(`${head} expects 2 arguments`); const a=emit(args[0]),b=emit(args[1]); if(a!==TYPE.bool||b!==TYPE.bool) throw new CompileError(`${head} expects bools`); w.u8(OP[head]); return TYPE.bool; }
    if (['eq','lt','lte','gt','gte'].includes(head)) { if(args.length!==2) throw new CompileError(`${head} expects 2 arguments`); const a=emit(args[0]),b=emit(args[1]); if(a!==b || (head!=='eq'&&a!==TYPE.number)) throw new CompileError(`bad operands for ${head}`); w.u8(OP[head]); return TYPE.bool; }
    if (['add','sub','mul','div'].includes(head)) { if(args.length!==2) throw new CompileError(`${head} expects 2 arguments`); const a=emit(args[0]),b=emit(args[1]); if(a!==TYPE.number||b!==TYPE.number) throw new CompileError(`${head} expects numbers`); w.u8(OP[head]); return TYPE.number; }
    if (head==='if') { if(args.length!==3) throw new CompileError('if expects 3 arguments'); if(emit(args[0])!==TYPE.bool) throw new CompileError('if condition must be bool'); const a=emit(args[1]),b=emit(args[2]); if(a!==b) throw new CompileError('if branches must have same type'); w.u8(OP.if); return a; }
    throw new CompileError(`unknown expression ${head}`);
  }
  const type=emit(node); return {type, bytes:w.finish()};
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
  let version=1; const inputs=[], states=[], strategies=[], constraints=[];
  for (const form of ast.slice(2)) {
    if(!Array.isArray(form)||!form.length) throw new CompileError('invalid module form');
    const [head,...args]=form;
    if(head==='version') { version=Number(args[0]); if(args.length!==1||!Number.isInteger(version)||version<0||version>0xffffffff) throw new CompileError('invalid version'); }
    else if(head==='input') { if(args.length!==2) throw new CompileError('input expects name type'); assertName(args[0],'input'); inputs.push({name:args[0],type:scalarType(args[1])}); }
    else if(head==='state') { if(args.length!==3) throw new CompileError('state expects name type default'); assertName(args[0],'state'); const type=scalarType(args[1]); let value; if(type===TYPE.bool){if(!['true','false'].includes(args[2]))throw new CompileError('bool default expected');value=args[2]==='true';}else{value=Number(args[2]);if(!Number.isFinite(value))throw new CompileError('number default expected');} states.push({name:args[0],type,value}); }
    else if(head==='strategy') strategies.push({raw:form});
    else if(head==='requires') { if(args.length!==2) throw new CompileError('requires expects target prerequisite'); constraints.push({kind:1,names:args}); }
    else if(head==='requires-any') { if(args.length<2||args.length>32) throw new CompileError('requires-any expects target and prerequisites'); constraints.push({kind:3,names:args}); }
    else if(head==='mutex') { if(args.length<2) throw new CompileError('mutex needs at least 2 intents'); constraints.push({kind:2,names:args}); }
    else throw new CompileError(`unknown module form ${head}`);
  }
  const unique=(xs,label)=>{const s=new Set();for(const x of xs){if(s.has(x.name))throw new CompileError(`duplicate ${label} ${x.name}`);s.add(x.name);}};
  unique(inputs,'input'); unique(states,'state');
  if(inputs.length>128||states.length>128||strategies.length>32||constraints.length>128)throw new CompileError('module resource limit exceeded');
  for(const c of constraints){if(c.names.length>32||new Set(c.names).size!==c.names.length)throw new CompileError('invalid constraint names or arity');for(const n of c.names)assertName(n,'constraint');}
  const env={inputs:new Map(inputs.map((x,i)=>[x.name,{...x,index:i}])),states:new Map(states.map((x,i)=>[x.name,{...x,index:i}]))};
  const compiledStrategies=strategies.map(({raw})=>{
    const [,sname,priorityAtom,...forms]=raw; assertName(sname,'strategy'); const priority=Number(priorityAtom); if(!Number.isInteger(priority)||priority < -2147483648||priority > 2147483647)throw new CompileError('strategy priority must be i32');
    let query=null; const transitions=[],intents=[];
    for(const f of forms){if(!Array.isArray(f))throw new CompileError('invalid strategy form');const [h,...a]=f;
      if(h==='device'){if(a.length!==1||query)throw new CompileError('strategy needs one device query');query=compileQuery(a[0]);}
      else if(h==='next'){if(a.length!==2)throw new CompileError('next expects state expression');const st=env.states.get(a[0]);if(!st)throw new CompileError(`unknown state ${a[0]}`);const e=compileExpr(a[1],env,false);if(e.type!==st.type)throw new CompileError(`type mismatch for state ${a[0]}`);transitions.push({index:st.index,expr:e.bytes});}
      else if(h==='intent'){if(a.length!==2)throw new CompileError('intent expects name expression');assertName(a[0],'intent');const e=compileExpr(a[1],env,true);intents.push({name:a[0],type:e.type,expr:e.bytes});}
      else throw new CompileError(`unknown strategy form ${h}`);
    }
    if(!query)throw new CompileError(`strategy ${sname} has no device query`); const seen=new Set();for(const t of transitions){if(seen.has(t.index))throw new CompileError('duplicate state transition');seen.add(t.index);} unique(intents,'intent');
    if(intents.length>128||query.length>4096||transitions.some(t=>t.expr.length>4096)||intents.some(i=>i.expr.length>4096))throw new CompileError('strategy resource limit exceeded');
    return {name:sname,priority,query,transitions,intents};
  });
  unique(compiledStrategies,'strategy'); if(!compiledStrategies.length)throw new CompileError('module needs a strategy');
  for(const c of constraints)for(const s of compiledStrategies){const available=new Map(s.intents.map(i=>[i.name,i.type]));for(const n of c.names){if(!available.has(n))throw new CompileError(`constraint intent ${n} is missing from strategy ${s.name}`);if(available.get(n)!==TYPE.bool)throw new CompileError(`constraint intent ${n} must be bool`);}}
  const w=new Writer();w.bytes(UTF8.encode('GFB1'));w.u16(1);w.str(name);w.u32(version);
  w.u16(inputs.length);for(const x of inputs){w.str(x.name);w.u8(x.type);}
  w.u16(states.length);for(const x of states){w.str(x.name);w.u8(x.type);if(x.type===TYPE.bool)w.u8(x.value?1:0);else w.f64(x.value);}
  w.u16(compiledStrategies.length);for(const s of compiledStrategies){w.str(s.name);w.i32(s.priority);w.u32(s.query.length);w.bytes(s.query);w.u16(s.transitions.length);for(const t of s.transitions){w.u16(t.index);w.u32(t.expr.length);w.bytes(t.expr);}w.u16(s.intents.length);for(const i of s.intents){w.str(i.name);w.u8(i.type);w.u32(i.expr.length);w.bytes(i.expr);}}
  w.u16(constraints.length);for(const c of constraints){w.u8(c.kind);w.u16(c.names.length);for(const n of c.names)w.str(n);}
  return w.finish();
}

export { tokenize, parse, compile, CompileError };
