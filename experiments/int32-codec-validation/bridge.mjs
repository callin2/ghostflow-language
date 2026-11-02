import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileSourceSync } from '../../tools/compile-source.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const values = [-2147483648, -2147483647, -16777217, -16777216, -65537,
  -65536, -257, -256, -255, -129, -128, -1, 0, 1, 127, 128, 255, 256, 257,
  65535, 65536, 65537, 16777215, 16777216, 16777217, 2147483646, 2147483647];

export function fixtureSource() {
  return '# Signed i32 codec compiler witnesses\n\n```ghost\ncontrol Int32CodecWitnesses {\n  input clock: Bool;\n'
    + values.map((n, i) => `  state s${i}: Int = ${n};\n  output literal${i}, held${i}: Int;\n  literal${i} <- ${n};\n  held${i} <- s${i};\n`).join('')
    + '}\n```\n';
}

class Reader {
  constructor(bytes) { this.bytes = bytes; this.at = 0; }
  take(n) {
    assert.ok(Number.isSafeInteger(n) && n >= 0 && this.at + n <= this.bytes.length, 'truncated module');
    const result = this.bytes.slice(this.at, this.at + n); this.at += n; return result;
  }
  u8() { return this.take(1)[0]; }
  u16() { const b = this.take(2); return b[0] + 256*b[1]; }
  u32() { return this.take(4).reduce((n, b, i) => n + b*256**i, 0); }
  string() { return new TextDecoder('utf-8', { fatal: true }).decode(this.take(this.u16())); }
  expression() { const size = this.u32(), offset = this.at; return { offset, bytes: [...this.take(size)] }; }
}

// A deliberately narrow structural reader locates bytes in the real emitted
// GFB2 module. Lean, rather than a copied Rust reader, checks their signed value.
export function inspectModule(bytes) {
  const r = new Reader(bytes), records = [];
  assert.equal(new TextDecoder().decode(r.take(4)), 'GFB1');
  assert.equal(r.u16(), 2, 'fixture requires GFB2');
  assert.equal(r.string(), 'Int32CodecWitnesses'); assert.equal(r.u32(), 1);
  assert.equal(r.u16(), 3);
  for (const type of [1, 1, 2]) { r.string(); assert.equal(r.u8(), type); }
  assert.equal(r.u16(), values.length);
  values.forEach((value, i) => {
    assert.equal(r.string(), `s${i}`); assert.equal(r.u8(), 3);
    const offset = r.at;
    records.push({ kind: 'initial', index: i, value, offset, bytes: [...r.take(4)] });
  });
  assert.equal(r.u16(), 1); assert.equal(r.string(), 'control'); assert.equal(r.u32(), 0);
  r.take(r.u32()); // Capability query is outside the codec claim.
  assert.equal(r.u16(), values.length);
  values.forEach((_, i) => {
    assert.equal(r.u16(), i);
    assert.deepEqual(r.expression().bytes, [4, i % 256, Math.floor(i / 256)]);
  });
  assert.equal(r.u16(), 2*values.length);
  values.forEach((value, i) => {
    assert.equal(r.string(), `literal${i}`); assert.equal(r.u8(), 3);
    const literal = r.expression();
    assert.equal(literal.bytes.length, 5); assert.equal(literal.bytes[0], 23, 'Int literal opcode');
    records.push({ kind: 'literal', index: i, value, offset: literal.offset + 1, bytes: literal.bytes.slice(1) });
    assert.equal(r.string(), `held${i}`); assert.equal(r.u8(), 3);
    assert.deepEqual(r.expression().bytes, [4, i % 256, Math.floor(i / 256)]);
  });
  assert.equal(r.u16(), 0); assert.equal(r.at, bytes.length, 'trailing module bytes');
  return records;
}

export function compileEvidence(source = fixtureSource()) {
  const compiled = compileSourceSync(source, { filename: 'int32-codec.ghost.md' });
  return { source, compiled, records: inspectModule(compiled.bytes) };
}

const integer = n => `(${n} : Int)`;
const list = bs => `[${bs.join(', ')}]`;

export function theoremInput(bytes, records) {
  return ['import Int32Codec', 'open Int32Codec', 'set_option maxRecDepth 10000',
    'set_option maxHeartbeats 2000000', `def artifactBytes : List Nat := ${list([...bytes])}`,
    ...records.flatMap((r, i) => [
      `theorem witness${i} : decode ((artifactBytes.drop ${r.offset}).take 4) = some ${integer(r.value)} := by decide`,
      `theorem canonical${i} : encode ${integer(r.value)} = ((artifactBytes.drop ${r.offset}).take 4) :=`,
      `  decode_canonical _ _ witness${i}`,
    ])].join('\n') + '\n';
}

export function mutations(evidence) {
  const negative = evidence.records.find(r => r.kind === 'literal' && r.value === -2147483648);
  const positive = evidence.records.find(r => r.kind === 'literal' && r.value === 65537);
  const initial = evidence.records.find(r => r.kind === 'initial' && r.value === -1);
  return [
    { name: 'big-endian-literal', record: positive, changed: [...positive.bytes].reverse(), reason: 'little-endian value equality' },
    { name: 'negative-sign-bit-cleared', record: negative, changed: [0, 0, 0, 0], reason: 'signed negative value equality' },
    { name: 'negative-initial-zero-extended', record: initial, changed: [255, 255, 255, 0], reason: 'signed initial value equality' },
  ].map(({ record, changed, ...mutation }) => {
    const bytes = evidence.compiled.bytes.slice(); bytes.set(changed, record.offset);
    const expected = record.value < 0 ? `(${record.value})` : `${record.value}`;
    return { ...mutation, offset: record.offset, oldBytes: record.bytes, newBytes: changed,
      diagnostic: "tactic 'decide' proved that the proposition\n"
        + `  decode (List.take 4 (List.drop ${record.offset} artifactBytes)) = some ${expected}\nis false`,
      bytes, theorem: theoremInput(bytes, [record]) };
  });
}
