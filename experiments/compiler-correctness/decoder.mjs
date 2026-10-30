// Bounded, independent reader for the GFB1/2/3 module framing needed by #590.
// Expression instructions are opaque length-delimited bytes here. This reader
// checks the wire's constraint list, not the behavior of those expressions.

const utf8 = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

class Reader {
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('GFB bytes required');
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }
  take(count) {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.bytes.length - this.offset) {
      throw new Error(`truncated GFB at byte ${this.offset}`);
    }
    const start = this.offset;
    this.offset += count;
    return this.bytes.subarray(start, this.offset);
  }
  u8() { return this.take(1)[0]; }
  u16() { const value = this.view.getUint16(this.offset, true); this.take(2); return value; }
  u32() { const value = this.view.getUint32(this.offset, true); this.take(4); return value; }
  i32() { const value = this.view.getInt32(this.offset, true); this.take(4); return value; }
  text() {
    const bytes = this.take(this.u16());
    const result = utf8.decode(bytes);
    if (!result || bytes.length > 128 || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(result)) {
      throw new Error(`invalid GFB name at byte ${this.offset}`);
    }
    return result;
  }
  expression() { return this.take(this.u32()); }
}

export function decodeConstraintModule(bytes) {
  const r = new Reader(bytes);
  if (utf8.decode(r.take(4)) !== 'GFB1') throw new Error('invalid GFB magic');
  const version = r.u16();
  if (![1, 2, 3].includes(version)) throw new Error(`unsupported GFB profile ${version}`);
  const name = r.text();
  const moduleVersion = r.u32();
  const inputs = [];
  for (let count = r.u16(); count > 0; count--) {
    const field = r.text(), type = r.u8();
    if (![1, 2, 3].includes(type)) throw new Error('invalid GFB input type');
    inputs.push({ name: field, type });
  }
  const states = [];
  for (let count = r.u16(); count > 0; count--) {
    const field = r.text(), type = r.u8();
    if (![1, 2, 3].includes(type)) throw new Error('invalid GFB state type');
    r.take(type === 1 ? 1 : type === 3 ? 4 : 8);
    states.push({ name: field, type });
  }
  const strategies = [];
  for (let count = r.u16(); count > 0; count--) {
    const strategy = r.text(), priority = r.i32();
    r.expression();
    const transitions = [];
    for (let n = r.u16(); n > 0; n--) {
      transitions.push({ stateIndex: r.u16(), expressionLength: r.expression().length });
    }
    const intents = [];
    for (let n = r.u16(); n > 0; n--) {
      const intent = r.text(), type = r.u8();
      if (![1, 2, 3].includes(type)) throw new Error('invalid GFB intent type');
      intents.push({ name: intent, type, expressionLength: r.expression().length });
    }
    strategies.push({ name: strategy, priority, transitions, intents });
  }
  const constraintsOffset = r.offset;
  const constraints = [];
  for (let count = r.u16(); count > 0; count--) {
    const code = r.u8(), size = r.u16();
    const kind = { 1: 'requires', 2: 'mutex', 3: 'requires-any' }[code];
    if (!kind || size < 2 || size > 32 || kind === 'requires' && size !== 2 || kind === 'requires-any' && size < 3) {
      throw new Error('invalid GFB constraint kind or arity');
    }
    const names = Array.from({ length: size }, () => r.text());
    constraints.push([kind, ...names]);
  }
  if (r.offset !== bytes.length) throw new Error(`trailing GFB bytes at ${r.offset}`);
  return { version, name, moduleVersion, inputs, states, strategies, constraints, constraintsOffset };
}

export function replaceConstraints(bytes, original) {
  const module = decodeConstraintModule(bytes);
  if (!Array.isArray(original) || original.length > 128) throw new Error('constraint count out of range');
  const chunks = [bytes.subarray(0, module.constraintsOffset), u16(original.length)];
  for (const form of original) {
    const [kind, ...names] = form;
    const code = { requires: 1, mutex: 2, 'requires-any': 3 }[kind];
    if (!code || names.length < 2 || names.length > 32 || code === 1 && names.length !== 2 || code === 3 && names.length < 3) {
      throw new Error('invalid original constraint form');
    }
    chunks.push(Uint8Array.of(code), u16(names.length));
    for (const name of names) {
      const value = encoder.encode(name);
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) || !value.length || value.length > 128) throw new Error('invalid constraint name');
      chunks.push(u16(value.length), value);
    }
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

function u16(value) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}
