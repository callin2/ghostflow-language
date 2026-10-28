import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileSource } from '../../tools/compile-source.mjs';
import { parseControl } from '../../tools/control.mjs';
import { extractLiterate } from '../../tools/literate.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const reject = message => { throw new Error(`Bool validator admission: ${message}`); };
const requireThat = (condition, message) => { if (!condition) reject(message); };

class Reader {
  constructor(bytes, base = 0) { this.bytes = bytes; this.at = 0; this.base = base; }
  take(length) {
    requireThat(Number.isSafeInteger(length) && length >= 0 && length <= this.bytes.length - this.at, 'truncated bytes');
    const result = this.bytes.slice(this.at, this.at + length);
    this.at += length;
    return result;
  }
  u8() { return this.take(1)[0]; }
  u16() { const b = this.take(2); return b[0] + b[1] * 256; }
  u32() { const b = this.take(4); return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true); }
  string() { return new TextDecoder('utf-8', { fatal: true }).decode(this.take(this.u16())); }
  done() { requireThat(this.at === this.bytes.length, 'trailing bytes'); }
  expression() {
    const length = this.u32(), offset = this.base + this.at, bytes = this.take(length);
    requireThat(length > 0 && length <= 4096, 'expression byte limit');
    return { offset, length, bytes: [...bytes], wire: decodeExpression(bytes) };
  }
}

export function wireBytes(wire) {
  switch (wire.kind) {
    case 'literal': return [1, wire.raw];
    case 'read': return [wire.opcode, wire.low, wire.high];
    case 'negate': return [...wireBytes(wire.value), 10];
    case 'branch': return [...wireBytes(wire.condition), 30, ...wire.falseOffset,
      ...wireBytes(wire.yes), 31, ...wire.jumpOffset, ...wireBytes(wire.no)];
    default: return reject('unsupported wire constructor');
  }
}

export function decodeExpression(bytes, depth = 0) {
  requireThat(depth <= 128, 'expression nesting limit');
  const reader = new Reader(bytes), stack = [];
  const pop = () => { requireThat(stack.length > 0, 'expression stack underflow'); return stack.pop(); };
  while (reader.at < bytes.length) {
    const opcode = reader.u8();
    if (opcode === 1) {
      const raw = reader.u8();
      requireThat(raw === 0 || raw === 1, 'noncanonical Bool literal');
      stack.push({ kind: 'literal', raw });
    } else if ([3, 4, 5].includes(opcode)) {
      stack.push({ kind: 'read', opcode, low: reader.u8(), high: reader.u8() });
    } else if (opcode === 10) {
      stack.push({ kind: 'negate', value: pop() });
    } else if (opcode === 30) {
      const condition = pop(), falseOffset = [...reader.take(2)];
      const falseLength = falseOffset[0] + 256 * falseOffset[1];
      requireThat(falseLength >= 3, 'branch false offset');
      const yes = decodeExpression(reader.take(falseLength - 3), depth + 1);
      requireThat(reader.u8() === 31, 'missing branch jump');
      const jumpOffset = [...reader.take(2)], noLength = jumpOffset[0] + 256 * jumpOffset[1];
      const no = decodeExpression(reader.take(noLength), depth + 1);
      stack.push({ kind: 'branch', condition, falseOffset, yes, jumpOffset, no });
    } else reject(`unsupported expression opcode ${opcode}`);
    requireThat(stack.length <= 128, 'expression stack limit');
  }
  reader.done();
  requireThat(stack.length === 1, 'expression must produce exactly one Bool');
  assert.deepEqual(wireBytes(stack[0]), [...bytes]);
  return stack[0];
}

function capabilityQuery(bytes, outputNames) {
  const reader = new Reader(bytes), names = [];
  while (reader.at < bytes.length && bytes[reader.at] === 1) {
    reader.u8();
    requireThat(reader.string() === 'actuator', 'unsupported capability kind');
    names.push(reader.string());
    requireThat(reader.u8() === 1, 'non-Bool capability');
  }
  if (names.length === 0) {
    requireThat(reader.u8() === 5 && reader.u8() === 1, 'unsupported empty capability query');
  } else {
    requireThat(reader.u8() === 2 && reader.u16() === names.length, 'unsupported capability query');
  }
  reader.done();
  assert.deepEqual(names, outputNames, 'capability names differ from declared outputs');
}

export function decodeModule(bytes) {
  requireThat(bytes instanceof Uint8Array && bytes.length <= 1024 * 1024, 'artifact byte limit');
  const reader = new Reader(bytes);
  requireThat(new TextDecoder().decode(reader.take(4)) === 'GFB1', 'unsupported magic');
  const format = reader.u16();
  requireThat(format === 1 || format === 3, `unsupported GFB format ${format}`);
  const name = reader.string(), version = reader.u32();
  requireThat(version === 1, 'unsupported module version');
  const inputCountOffset = reader.at;
  requireThat(reader.u16() === 0, 'external input and Result profiles unsupported');
  const stateCountOffset = reader.at;
  const states = Array.from({ length: reader.u16() }, () => {
    const name = reader.string(), typeOffset = reader.at;
    requireThat(reader.u8() === 1, 'non-Bool state');
    const initialOffset = reader.at, initial = reader.u8();
    requireThat(initial <= 1, 'noncanonical initial Bool');
    return { name, initial: initial === 1, typeOffset, initialOffset };
  });
  requireThat(reader.u16() === 1, 'requires exactly one strategy');
  requireThat(reader.string() === 'control' && reader.u32() === 0, 'unsupported strategy');
  const query = reader.take(reader.u32());
  const transitions = Array.from({ length: reader.u16() }, () => {
    const targetOffset = reader.at, target = reader.u16();
    return { target, targetOffset, ...reader.expression() };
  });
  const outputs = Array.from({ length: reader.u16() }, () => {
    const name = reader.string();
    requireThat(reader.u8() === 1, 'non-Bool output');
    return { name, ...reader.expression() };
  });
  requireThat(reader.u16() === 0, 'constraints unsupported');
  reader.done();
  requireThat(new Set(states.map(x => x.name)).size === states.length, 'duplicate state');
  requireThat(new Set(outputs.map(x => x.name)).size === outputs.length, 'duplicate output');
  requireThat(new Set(transitions.map(x => x.target)).size === transitions.length, 'duplicate transition');
  requireThat(transitions.every(x => x.target < states.length), 'transition target out of range');
  assert.deepEqual(transitions.map(x => x.target), states.map((_, index) => index), 'transition targets must cover state declaration order');
  capabilityQuery(query, outputs.map(x => x.name));
  function references(wire, allowNext) {
    if (wire.kind === 'read') {
      requireThat(wire.opcode === 4 || allowNext && wire.opcode === 5, 'unsupported read namespace');
      requireThat(wire.low + 256 * wire.high < states.length, 'state read out of range');
    } else if (wire.kind === 'negate') references(wire.value, allowNext);
    else if (wire.kind === 'branch') {
      requireThat(format === 3, 'branch requires format 3');
      for (const child of [wire.condition, wire.yes, wire.no]) references(child, allowNext);
    }
  }
  for (const transition of transitions) references(transition.wire, false);
  for (const output of outputs) references(output.wire, true);
  return { format, name, version, inputCountOffset, stateCountOffset, states, transitions, outputs };
}

export function projectSource(source, filename) {
  const extracted = extractLiterate(source, { filename }), ast = parseControl(extracted.code, { filename });
  requireThat(ast.kind === 'control' && ast.imports.length === 0, 'unsupported source root or imports');
  const declarations = ast.body.filter(x => x.kind === 'state'), outputs = ast.body.filter(x => x.kind === 'output');
  requireThat(declarations.every(x => x.type.name === 'Bool' && ['true', 'false'].includes(x.initial?.raw)), 'unsupported state declaration');
  requireThat(outputs.every(x => x.type.name === 'Bool' && x.initial === null), 'unsupported output declaration');
  const states = declarations.map(x => ({ name: x.name, initial: x.initial.raw === 'true' }));
  const indexes = new Map(states.map((x, index) => [x.name, index]));
  const outputNames = outputs.flatMap(x => x.names);
  requireThat(new Set([...indexes.keys(), ...outputNames]).size === states.length + outputNames.length, 'duplicate source name');
  function expression(node, allowNext, depth = 0) {
    requireThat(depth <= 128, 'source expression nesting limit');
    const child = value => expression(value, allowNext, depth + 1);
    if (node.kind === 'literal' && ['true', 'false'].includes(node.raw)) return { kind: 'literal', value: node.raw === 'true' };
    if (node.kind === 'reference' || node.kind === 'nextReference') {
      requireThat(indexes.has(node.name), 'non-state reference');
      requireThat(allowNext || node.kind === 'reference', 'next-state read in transition');
      return { kind: node.kind === 'reference' ? 'previous' : 'next', index: indexes.get(node.name) };
    }
    if (node.kind === 'unary' && node.op === '!') return { kind: 'negate', value: child(node.value) };
    if (node.kind === 'if') return { kind: 'branch', condition: child(node.test), yes: child(node.yes), no: child(node.no) };
    if (node.kind === 'binary' && node.op === '&&') return { kind: 'branch', condition: child(node.left), yes: child(node.right), no: { kind: 'literal', value: false } };
    if (node.kind === 'binary' && node.op === '||') return { kind: 'branch', condition: child(node.left), yes: { kind: 'literal', value: true }, no: child(node.right) };
    return reject(`unsupported source expression ${node.kind}`);
  }
  const transitions = [], connections = [];
  for (const node of ast.body) {
    if (node.kind === 'next') {
      requireThat(indexes.has(node.name), 'unknown transition target');
      transitions.push({ target: indexes.get(node.name), expression: expression(node.value, false) });
    } else if (node.kind === 'connection') {
      requireThat(outputNames.includes(node.name), 'unknown output connection');
      connections.push({ name: node.name, expression: expression(node.value, true) });
    } else requireThat(['state', 'output'].includes(node.kind), `unsupported source declaration ${node.kind}`);
  }
  requireThat(new Set(transitions.map(x => x.target)).size === transitions.length, 'duplicate source transition');
  assert.deepEqual(connections.map(x => x.name), outputNames, 'output declaration/connection order or completeness');
  const completeTransitions = states.map((_, target) => transitions.find(x => x.target === target)
    ?? { target, expression: { kind: 'previous', index: target } });
  return { name: ast.name, states, transitions: completeTransitions, outputs: connections, extracted: extracted.code };
}

export async function compileEvidence(source, filename) {
  const projected = projectSource(source, filename), compiled = await compileSource(source, { filename });
  const decoded = validateArtifact(projected, compiled.bytes);
  return { schemaVersion: 1, source: { filename, text: source, sha256: sha256(source) },
    artifact: { bytes: [...compiled.bytes], sha256: sha256(compiled.bytes) },
    projection: projected, decoded,
    manifestSha256: sha256(JSON.stringify(compiled.manifest)),
    trust: ['production literate extraction/parser and AST projection', 'outer module decoder and literal serializer',
      'modeled structured byte execution correspondence to Rust', 'Lean kernel and standard logical foundations'] };
}

export function validateArtifact(projected, artifactBytes) {
  const decoded = decodeModule(artifactBytes);
  assert.equal(decoded.name, projected.name, 'module name differs from source');
  assert.deepEqual(decoded.states.map(({ name, initial }) => ({ name, initial })), projected.states,
    'state declarations or initial values differ from source');
  assert.deepEqual(decoded.transitions.map(x => x.target), projected.transitions.map(x => x.target), 'transition targets differ from source');
  assert.deepEqual(decoded.outputs.map(x => x.name), projected.outputs.map(x => x.name), 'output names differ from source');
  return decoded;
}

export function leanExpr(e) {
  switch (e.kind) {
    case 'literal': return `(.literal ${e.value})`;
    case 'previous': return `(.previous ${e.index})`;
    case 'next': return `(.next ${e.index} rfl)`;
    case 'negate': return `(.negate ${leanExpr(e.value)})`;
    case 'branch': return `(.branch ${leanExpr(e.condition)} ${leanExpr(e.yes)} ${leanExpr(e.no)})`;
    default: return reject('unsupported Lean expression');
  }
}

export function leanWire(w) {
  switch (w.kind) {
    case 'literal': return `(.literal ${w.raw})`;
    case 'read': return `(.read ${w.opcode} ${w.low} ${w.high})`;
    case 'negate': return `(.negate ${leanWire(w.value)})`;
    case 'branch': return `(.branch ${leanWire(w.condition)} ${w.falseOffset.join(' ')} ${leanWire(w.yes)} ${w.jumpOffset.join(' ')} ${leanWire(w.no)})`;
    default: return reject('unsupported Lean wire');
  }
}

export function theoremInput(evidence) {
  const { projection, decoded, artifact } = evidence;
  const lines = ['import BoolTranslation', 'open BoolTranslation', 'set_option maxRecDepth 4096',
    'set_option maxHeartbeats 2000000', `def artifactBytes : List Nat := ${JSON.stringify(artifact.bytes)}`];
  for (const [group, allowNext] of [['transitions', false], ['outputs', true]]) {
    decoded[group].forEach((entry, index) => {
      const name = `${group}${index}`;
      lines.push(`def ${name}Source : Expr ${allowNext} := ${leanExpr(projection[group][index].expression)}`,
        `def ${name}Wire : Wire := ${leanWire(entry.wire)}`,
        `theorem ${name}Bound : bytes ${name}Wire = (artifactBytes.drop ${entry.offset}).take ${entry.length} := by decide`,
        `theorem ${name}Accepted : check ${name}Source ${name}Wire = true := by decide`,
        `theorem ${name}Preserved (env : Env) (stack : List Bool) : Executes ((artifactBytes.drop ${entry.offset}).take ${entry.length}) env stack (eval ${name}Source env :: stack) := by`,
        `  rw [← ${name}Bound]`, `  exact check_executes ${name}Source ${name}Wire ${name}Accepted env stack`);
    });
    const refs = suffix => `[${decoded[group].map((_, i) => `${group}${i}${suffix}`).join(', ')}]`;
    lines.push(`def ${group}Source : List (Expr ${allowNext}) := ${refs('Source')}`,
      `def ${group}Wire : List Wire := ${refs('Wire')}`,
      `theorem ${group}Accepted : checkList ${group}Source ${group}Wire = true := by decide`);
  }
  lines.push(`def targets : List Nat := ${JSON.stringify(decoded.transitions.map(x => x.target))}`,
    'theorem artifactTickPreserved (env : Env) : byteTick transitionsWire targets outputsWire env = some (sourceTick transitionsSource targets outputsSource env) :=',
    '  simultaneous_tick transitionsSource transitionsWire outputsSource outputsWire targets transitionsAccepted outputsAccepted env',
    '#print axioms artifactTickPreserved');
  return lines.join('\n') + '\n';
}
