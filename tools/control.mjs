/**
 * GhostFlow control front-end.
 *
 * This file intentionally only lowers a bounded, side-effect-free control AST
 * to the existing GFB1 S-expression compiler.  It does not evaluate source,
 * load modules, or execute user supplied code.
 */
import { tokenize as sexprTokenize, parse as sexprParse, compile as compileGfb, CompileError } from './gfb1.mjs';
import { buildSourceTrace } from './source-trace.mjs';

const INPUT_LIMIT = 128;
const STATE_LIMIT = 128;
const STRATEGY_LIMIT = 32;
const PARSER_DEPTH_LIMIT = 64;
const NODE_LIMIT = 4096;
const EXPANSION_NODE_LIMIT = 4096;
const RESERVED_PREFIX = '__gf_';
const SCALAR_TYPES = new Set(['Bool', 'Int', 'Number', 'Percent', 'Duration']);
const KEYWORDS = new Set([
  'control', 'fn', 'purefn', 'input', 'output', 'state', 'config', 'let',
  'type', 'enum', 'sensor', 'signal', 'schedule', 'timer', 'elapsed',
  'require', 'mutex', 'next', 'if', 'then', 'else', 'case', 'in', 'ok',
  'fault', 'true', 'false', 'adapt', 'constraints', 'check', 'limit',
  'div',
]);

export class ControlCompileError extends Error {
  constructor(message, loc) {
    super(loc ? `${loc.filename}:${loc.line}:${loc.column}: ${message}` : message);
    this.name = 'ControlCompileError';
    this.filename = loc?.filename;
    this.line = loc?.line;
    this.column = loc?.column;
  }
}

function error(loc, message) { throw new ControlCompileError(message, loc); }
function internal(message) { throw new ControlCompileError(message); }
function isName(name) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name); }
function isReserved(name) { return name.startsWith(RESERVED_PREFIX); }
function semanticType(type) { return { kind: type }; }
const BOOL = semanticType('Bool');
const INT = semanticType('Int');
const NUMBER = semanticType('Number');
const PERCENT = semanticType('Percent');
const DURATION = semanticType('Duration');
function sameType(a, b) { return a && b && a.kind === b.kind; }
function isNumeric(type) { return type && ['Int', 'Number', 'Percent', 'Duration'].includes(type.kind); }
function gfbType(type) { return type.kind === 'Bool' ? 'bool' : type.kind === 'Int' ? 'int' : 'number'; }
function gfbDefault(type, value) { return type.kind === 'Bool' ? (value ? 'true' : 'false') : String(value); }

function tokeniseControl(source, filename) {
  if (typeof source !== 'string') internal('control source must be a string');
  if (source.length > 256 * 1024) internal('control source exceeds 256 KiB parser limit');
  const tokens = [];
  let at = 0, line = 1, column = 1;
  const loc = () => ({ filename, line, column, offset: at });
  const take = () => {
    const c = source[at++];
    if (c === '\n') { line++; column = 1; } else column++;
    return c;
  };
  const add = (kind, value, start) => {
    if (tokens.length >= 8192) error(start, 'token limit exceeded (8192)');
    tokens.push({ kind, value, ...start, endLine: line, endColumn: column, endOffset: at });
  };
  while (at < source.length) {
    const c = source[at];
    if (/\s/.test(c)) { take(); continue; }
    if (c === '/' && source[at + 1] === '/') {
      while (at < source.length && source[at] !== '\n') take();
      continue;
    }
    const start = loc();
    const pair = source.slice(at, at + 2);
    if (['<-', '=>', '->', '&&', '||', '<=', '>=', '==', '!=', '..'].includes(pair)) {
      take(); take(); add('symbol', pair, start); continue;
    }
    if ('{}()[],:;=<>!+-*/%|\'?.`'.includes(c)) { take(); add('symbol', c, start); continue; }
    if (c === '"') {
      let raw = take(), closed = false;
      while (at < source.length) {
        const next = take(); raw += next;
        if (next === '"') { closed = true; break; }
        if (next === '\\') {
          if (at >= source.length) break;
          raw += take();
        }
      }
      if (!closed) error(start, 'unterminated string literal');
      try { add('string', JSON.parse(raw), start); } catch { error(start, 'invalid string literal'); }
      continue;
    }
    const rest = source.slice(at);
    const time = /^(\d{1,2}):(\d{2})(?![A-Za-z0-9_])/.exec(rest);
    if (time) {
      for (let n = 0; n < time[0].length; n++) take();
      add('time', time[0], start); continue;
    }
    const number = /^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:ms|min|s|h|%)?/.exec(rest);
    if (number) {
      for (let n = 0; n < number[0].length; n++) take();
      add('number', number[0], start); continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (ident) {
      for (let n = 0; n < ident[0].length; n++) take();
      add('identifier', ident[0], start); continue;
    }
    error(start, `unexpected character ${JSON.stringify(c)}`);
  }
  tokens.push({ kind: 'eof', value: '', filename, line, column, offset: at, endLine: line, endColumn: column });
  return tokens;
}

class ControlParser {
  constructor(source, filename) {
    this.tokens = tokeniseControl(source, filename);
    this.at = 0;
    this.depth = 0;
    this.nodes = [];
    this.nextNodeId = 1;
  }
  current() { return this.tokens[this.at]; }
  matches(value) { return this.current().value === value; }
  take() { return this.tokens[this.at++]; }
  maybe(value) { if (this.matches(value)) return this.take(); return null; }
  expect(value, message = `expected ${value}`) {
    if (!this.matches(value)) error(this.current(), message);
    return this.take();
  }
  identifier(message = 'expected identifier') {
    const token = this.current();
    if (token.kind !== 'identifier') error(token, message);
    this.take();
    return token;
  }
  node(kind, loc, fields = {}) {
    if (this.nodes.length >= NODE_LIMIT) error(loc, `AST node limit exceeded (${NODE_LIMIT})`);
    const node = { id: this.nextNodeId++, kind, loc: copyLoc(loc), ...fields };
    this.nodes.push({ id: node.id, kind, ...copyLoc(loc) });
    return node;
  }
  enter(loc) {
    if (++this.depth > PARSER_DEPTH_LIMIT) error(loc, `parser nesting exceeds ${PARSER_DEPTH_LIMIT}`);
  }
  leave() { this.depth--; }
  parse() {
    const prelude = [];
    while (this.matches('fn') || this.matches('purefn')) prelude.push(this.functionDecl());
    const start = this.expect('control', 'expected control declaration');
    const name = this.identifier('expected control name');
    this.expect('{', 'expected { after control name');
    const body = [];
    while (!this.matches('}')) {
      if (this.current().kind === 'eof') error(start, 'unclosed control block');
      body.push(this.declaration());
    }
    this.take();
    this.expect('');
    return { kind: 'control', name: name.value, loc: copyLoc(start), body: [...prelude, ...body], sourceNodes: this.nodes };
  }
  declaration() {
    const token = this.current();
    switch (token.value) {
      case 'input': return this.port('input');
      case 'output': return this.port('output');
      case 'state': return this.state();
      case 'config': return this.config();
      case 'let': return this.letDecl();
      case 'type': return this.typeDecl();
      case 'enum': return this.enumDecl();
      case 'fn': case 'purefn': return this.functionDecl();
      case 'sensor': return this.sensor();
      case 'signal': return this.signal();
      case 'schedule': return this.schedule();
      case 'timer': return this.timer();
      case 'require': return this.requirement();
      case 'mutex': return this.mutex();
      case 'next': return this.nextStatement(true);
      case 'adapt': error(token, 'unsupported construct adapt');
      case 'constraints': error(token, 'unsupported construct constraints; use the named-constraints parser');
      case 'check': case 'limit': error(token, `unsupported construct ${token.value}`);
      default:
        if (token.kind === 'identifier' && this.tokens[this.at + 1]?.value === "'") return this.nextStatement(false);
        if (token.kind === 'identifier' && this.tokens[this.at + 1]?.value === '<-') return this.connection();
        error(token, `unexpected declaration ${token.value || 'end of file'}`);
    }
  }
  names(message) {
    const names = [this.identifier(message)];
    while (this.maybe(',')) names.push(this.identifier(message));
    return names;
  }
  typeName() {
    const token = this.identifier('expected type name');
    return { name: token.value, loc: copyLoc(token) };
  }
  port(kind) {
    const start = this.take();
    const names = this.names(`expected ${kind} name`);
    this.expect(':', `expected : after ${kind} name`);
    const type = this.typeName();
    if (kind === 'output' && this.matches('=')) {
      error(this.current(), 'output declarations are type-only; connect each output with `name <- expression;`');
    }
    let initial = null;
    if (this.maybe('=')) initial = this.expression();
    this.expect(';', `expected ; after ${kind} declaration`);
    return this.node(kind, start, { names: names.map(x => x.value), type, initial });
  }
  state() {
    const start = this.take(), name = this.identifier('expected state name');
    this.expect(':'); const type = this.typeName(); this.expect('=', 'state requires an initial value');
    const initial = this.expression(); this.expect(';', 'expected ; after state declaration');
    return this.node('state', start, { name: name.value, type, initial });
  }
  config() {
    const start = this.take(), name = this.identifier('expected config name');
    this.expect(':'); const type = this.typeName(); this.expect('=', 'config requires a value');
    const value = this.expression();
    const settings = {};
    if (this.maybe('{')) {
      while (!this.matches('}')) {
        const key = this.identifier('expected config option');
        if (settings[key.value] !== undefined) error(key, `duplicate config option ${key.value}`);
        this.expect('=', `expected = after config option ${key.value}`);
        const minus = this.maybe('-');
        const option = this.current();
        if (key.value === 'label') {
          if (minus) error(minus, 'config label must be a string');
          if (option.kind !== 'string') error(option, 'config label must be a string');
          settings[key.value] = this.take().value;
        } else {
          if (minus && option.kind !== 'number') error(option, 'config option negative value must be a number literal');
          if (option.kind !== 'identifier' && option.kind !== 'number') error(option, `config option ${key.value} must be a literal`);
          settings[key.value] = `${minus ? '-' : ''}${this.take().value}`;
        }
        this.expect(';', 'expected ; after config option');
      }
      this.take();
    }
    if (!settings || Object.keys(settings).length === 0) this.expect(';', 'expected ; after config declaration');
    else this.maybe(';');
    return this.node('config', start, { name: name.value, type, value, settings });
  }
  letDecl() {
    const start = this.take(), name = this.identifier('expected let name');
    let annotation = null;
    if (this.maybe(':')) annotation = this.typeName();
    this.expect('=', 'let requires ='); const value = this.expression(); this.expect(';', 'expected ; after let declaration');
    return this.node('let', start, { name: name.value, annotation, value });
  }
  typeDecl() {
    const start = this.take(), name = this.identifier('expected type name');
    this.expect('=', 'type requires ='); const members = [this.identifier('expected enum member')];
    while (this.maybe('|')) members.push(this.identifier('expected enum member'));
    this.expect(';', 'expected ; after type declaration');
    return this.node('enum', start, { name: name.value, members: members.map(x => ({ name: x.value, loc: copyLoc(x) })) });
  }
  enumDecl() {
    const start = this.take(), name = this.identifier('expected enum name');
    const members = [];
    if (this.maybe('=')) {
      members.push(this.identifier('expected enum member'));
      while (this.maybe('|')) members.push(this.identifier('expected enum member'));
      this.expect(';', 'expected ; after enum declaration');
    } else {
      this.expect('{', 'expected { after enum name');
      while (!this.matches('}')) {
        members.push(this.identifier('expected enum member'));
        if (!this.maybe(',')) this.maybe(';');
      }
      this.take(); this.maybe(';');
    }
    return this.node('enum', start, { name: name.value, members: members.map(x => ({ name: x.value, loc: copyLoc(x) })) });
  }
  functionDecl() {
    const start = this.take(), name = this.identifier('expected function name');
    this.expect('(', 'expected ( after function name'); const params = [];
    if (!this.matches(')')) {
      do {
        const param = this.identifier('expected parameter name'); this.expect(':', 'parameter requires a type');
        params.push({ name: param.value, type: this.typeName(), loc: copyLoc(param) });
      } while (this.maybe(','));
    }
    this.expect(')'); this.expect('->', 'function requires -> result type'); const result = this.typeName();
    this.expect('{', 'expected { before function body'); const body = this.expression(); this.maybe(';');
    this.expect('}', 'expected } after function body'); this.maybe(';');
    return this.node('function', start, { name: name.value, params, result, body });
  }
  sensor() {
    const start = this.take(), name = this.identifier('expected sensor name'); const optional = !!this.maybe('?');
    this.expect(':'); const type = this.typeName(); const options = {};
    if (this.maybe('{')) {
      while (!this.matches('}')) {
        const key = this.identifier('expected sensor option'); this.expect('=', `expected = after ${key.value}`);
        if (key.value === 'valid') {
          options.validMin = this.expression(); this.expect('..', 'valid expects ..'); options.validMax = this.expression();
        } else if (key.value === 'filter') options.filter = this.expression();
        else if (key.value === 'sample') options.sample = this.expression();
        else if (key.value === 'stale_after') options.staleAfter = this.expression();
        else if (key.value === 'recover_after') {
          options.recoverAfter = this.expression(); this.expect('samples', 'recover_after expects samples');
        } else error(key, `unsupported sensor option ${key.value}`);
        this.expect(';', 'expected ; after sensor option');
      }
      this.take(); this.maybe(';');
    } else this.expect(';', 'expected ; after sensor declaration');
    return this.node('sensor', start, { name: name.value, optional, type, options });
  }
  signal() {
    const start = this.take(), name = this.identifier('expected signal name'); this.expect('=', 'signal requires =');
    const call = this.expression(); this.expect(';', 'expected ; after signal declaration');
    return this.node('signal', start, { name: name.value, call });
  }
  schedule() {
    const start = this.take(), name = this.identifier('expected schedule name'); this.expect(':');
    const kind = this.identifier('expected schedule type');
    if (kind.value === 'Solar') return this.solarSchedule(start, name);
    if (kind.value !== 'DailySlots') error(kind, 'only DailySlots<15min> schedules are supported (or Solar)');
    this.expect('<'); const interval = this.expression(4); this.expect('>', 'expected > after DailySlots interval');
    this.expect('{', 'expected { after schedule type'); let timezone = null, selected = null;
    while (!this.matches('}')) {
      const key = this.identifier('expected schedule option'); this.expect('=');
      if (key.value === 'timezone') { const value = this.current(); if (value.kind !== 'string') error(value, 'timezone must be a string'); timezone = this.take().value; }
      else if (key.value === 'selected') {
        this.expect('['); selected = [];
        if (!this.matches(']')) do { const time = this.current(); if (time.kind !== 'time') error(time, 'selected entries must be HH:MM'); selected.push(this.take()); } while (this.maybe(','));
        this.expect(']');
      } else error(key, `unsupported schedule option ${key.value}`);
      this.expect(';', 'expected ; after schedule option');
    }
    this.take(); this.maybe(';');
    return this.node('schedule', start, { name: name.value, scheduleType: 'DailySlots', interval, timezone, selected });
  }
  solarSchedule(start, name) {
    this.expect('{', 'expected { after Solar');
    const options = { timezone: null, latitude: null, longitude: null, at: null, fallback: null };
    const seen = new Set();
    while (!this.matches('}')) {
      const key = this.identifier('expected Solar schedule option');
      if (seen.has(key.value)) error(key, `duplicate Solar schedule option ${key.value}`);
      seen.add(key.value);
      this.expect('=', `expected = after Solar schedule option ${key.value}`);
      if (key.value === 'timezone') {
        const value = this.current();
        if (value.kind !== 'string') error(value, 'Solar timezone must be a string');
        options.timezone = this.take().value;
      } else if (key.value === 'latitude' || key.value === 'longitude') {
        options[key.value] = this.solarCoordinate(key, key.value);
      } else if (key.value === 'at') {
        options.at = this.solarAt();
      } else if (key.value === 'fallback') {
        const value = this.identifier('Solar fallback must be skip');
        if (value.value !== 'skip') error(value, 'Solar fallback must be skip');
        options.fallback = value.value;
      } else error(key, `unsupported Solar schedule option ${key.value}`);
      this.expect(';', 'expected ; after Solar schedule option');
    }
    this.take(); this.maybe(';');
    return this.node('schedule', start, { name: name.value, scheduleType: 'Solar', ...options });
  }
  solarCoordinate(key, label) {
    const minus = this.maybe('-');
    const value = this.current();
    if (value.kind !== 'number' || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.value)) {
      error(value, `Solar ${label} must be a signed finite numeric literal`);
    }
    this.take();
    const coordinate = Number(`${minus ? '-' : ''}${value.value}`);
    const limit = label === 'latitude' ? 90 : 180;
    if (!Number.isFinite(coordinate) || coordinate < -limit || coordinate > limit) {
      error(value, `Solar ${label} must be between ${-limit} and ${limit}`);
    }
    return coordinate;
  }
  solarAt() {
    const tag = this.identifier('Solar at must use sun`rise` or sun`set`');
    if (tag.value !== 'sun') error(tag, 'Solar at must use sun`rise` or sun`set`');
    this.expect('`', 'Solar at must use a sun tagged literal');
    const event = this.identifier('Solar event must be rise or set');
    if (event.value !== 'rise' && event.value !== 'set') error(event, 'Solar event must be rise or set');
    let offsetMs = 0;
    if (this.matches('+') || this.matches('-')) {
      const sign = this.take().value;
      const duration = this.current();
      if (duration.kind !== 'number') error(duration, 'Solar offset must be an integer duration literal');
      this.take();
      offsetMs = solarOffsetMilliseconds(duration.value, sign, duration);
    }
    this.expect('`', 'Solar at tagged literal must end with `');
    return { event: event.value, offsetMs };
  }
  timer() {
    const start = this.take(), name = this.identifier('expected timer name'); this.expect('=');
    const call = this.expression(); this.expect(';', 'expected ; after timer declaration');
    return this.node('timer', start, { name: name.value, call });
  }
  nextStatement(withKeyword) {
    const start = this.take(); const name = withKeyword ? this.identifier('expected state name') : start;
    if (!withKeyword) this.expect("'");
    this.expect('=', 'next state requires ='); const value = this.expression(); this.expect(';', 'expected ; after next state');
    return this.node('next', start, { name: name.value, value });
  }
  connection() {
    const name = this.identifier('expected output name'), start = name;
    this.expect('<-', 'output connection requires <-'); const value = this.expression(); this.expect(';', 'expected ; after output connection');
    return this.node('connection', start, { name: name.value, value });
  }
  requirement() {
    const start = this.take();
    let value;
    if (this.matches('!')) value = this.expression();
    else {
      const left = this.expression(1); this.expect('=>', 'require supports an implication with =>'); const right = this.expression();
      value = this.node('binary', start, { op: '=>', left, right });
    }
    this.expect(';', 'expected ; after require');
    return this.node('require', start, { value });
  }
  mutex() {
    const start = this.take(); this.expect('('); const names = this.names('expected mutex output'); this.expect(')'); this.expect(';');
    return this.node('mutex', start, { names: names.map(x => x.value) });
  }
  expression(min = 0) {
    this.enter(this.current());
    try {
      let left = this.prefix();
      for (;;) {
        const token = this.current();
        if (token.value === 'in' && 4 >= min) { this.take(); left = this.inSet(token, left); continue; }
        const precedence = BIN_PREC[token.value];
        if (precedence === undefined || precedence < min) break;
        this.take(); const right = this.expression(precedence + 1);
        left = this.node('binary', token, { op: token.value, left, right });
      }
      return left;
    } finally { this.leave(); }
  }
  prefix() {
    const token = this.take();
    if (token.kind === 'number') return this.node('literal', token, { raw: token.value });
    if (token.kind === 'identifier') {
      if (token.value === 'true' || token.value === 'false') return this.node('literal', token, { raw: token.value });
      if (token.value === 'if') {
        const test = this.expression(); this.expect('then', 'if requires then'); const yes = this.expression(); this.expect('else', 'if requires else');
        return this.node('if', token, { test, yes, no: this.expression() });
      }
      if (token.value === 'case') return this.caseExpression(token);
      if (token.value === 'adapt' || token.value === 'constraints') error(token, `unsupported construct ${token.value}`);
      if (this.matches('(')) return this.call(token);
      if (this.maybe('.')) {
        const member = this.identifier('expected member after .');
        return this.node('member', token, { base: token.value, member: member.value });
      }
      if (this.maybe("'")) return this.node('nextReference', token, { name: token.value });
      return this.node('reference', token, { name: token.value });
    }
    if (token.value === '!' || token.value === '-') {
      const value = this.expression(7);
      return this.node('unary', token, {
        op: token.value,
        value,
        loc: { ...copyLoc(token), endOffset: value.loc.endOffset, endLine: value.loc.endLine, endColumn: value.loc.endColumn },
      });
    }
    if (token.value === '(') {
      const value = this.expression(); this.expect(')', 'expected )');
      // Keep grouping provenance for source-span consumers. Lowering otherwise
      // intentionally treats parentheses as transparent.
      return { ...value, parenthesized: true };
    }
    error(token, `expected expression, found ${token.value || 'end of file'}`);
  }
  call(name) {
    this.expect('('); const args = [], named = [];
    if (!this.matches(')')) {
      do {
        if (this.current().kind === 'identifier' && this.tokens[this.at + 1]?.value === ':') {
          const label = this.take(); this.take(); named.push({ name: label.value, value: this.expression(), loc: copyLoc(label) });
        } else args.push(this.expression());
      } while (this.maybe(','));
    }
    this.expect(')', 'expected ) after arguments');
    return this.node('call', name, { name: name.value, args, named });
  }
  inSet(token, left) {
    this.expect('{', 'in requires {'); const values = [];
    if (!this.matches('}')) do { values.push(this.expression()); } while (this.maybe(','));
    this.expect('}', 'expected } after in set');
    if (!values.length) error(token, 'in set must not be empty');
    return this.node('in', token, { left, values });
  }
  caseExpression(token) {
    const value = this.expression(); this.expect('{', 'case requires {'); const branches = [];
    while (!this.matches('}')) {
      const pattern = this.identifier('expected case pattern'); let binding = null;
      if (this.maybe('(')) { const bound = this.current(); if (bound.kind !== 'identifier') error(bound, 'expected case binding'); binding = this.take().value; this.expect(')'); }
      this.expect('=>', 'case pattern requires =>'); const body = this.expression(); this.maybe(';');
      branches.push({ name: pattern.value, binding, body, loc: copyLoc(pattern) });
    }
    this.take();
    return this.node('case', token, { value, branches });
  }
}

const BIN_PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '+': 5, '-': 5, '*': 6, '/': 6, 'div': 6, '%': 6 };
function copyLoc(token) { return { filename: token.filename, line: token.line, column: token.column, offset: token.offset, endOffset: token.endOffset, endLine: token.endLine ?? token.line, endColumn: token.endColumn ?? token.column }; }

function rejectName(name, loc, label) {
  if (!isName(name)) error(loc, `invalid ${label} name ${name}`);
  if (isReserved(name)) error(loc, `${label} name ${name} uses reserved ${RESERVED_PREFIX} prefix`);
  if (KEYWORDS.has(name)) error(loc, `${label} name ${name} is reserved`);
}
function duration(raw, loc) {
  const units = { ms: 1, s: 1000, min: 60_000, h: 3_600_000 };
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|min|s|h)$/.exec(raw);
  if (!match) return null;
  if (match[1].includes('.')) error(loc, 'Duration literal must use a whole-number unit quantity');
  const value = Number(match[1]) * units[match[2]];
  if (!Number.isInteger(value) || !Number.isFinite(value) || value < 0) error(loc, 'Duration must be a non-negative integer number of milliseconds');
  return value;
}
function solarOffsetMilliseconds(raw, sign, loc) {
  const match = /^(\d+)(ms|min|s|h)$/.exec(raw);
  if (!match) error(loc, 'Solar offset must be an integer duration literal using ms, s, min, or h');
  const units = { ms: 1n, s: 1000n, min: 60_000n, h: 3_600_000n };
  const magnitude = BigInt(match[1]) * units[match[2]];
  const day = 86_400_000n;
  if (magnitude > day) error(loc, 'Solar offset magnitude must not exceed 24h');
  // The bound above makes this conversion exact.  Duration text itself is
  // parsed as BigInt so fractional values cannot be rounded into a schedule.
  const milliseconds = Number(magnitude);
  return sign === '-' ? -milliseconds : milliseconds;
}
function operatingValue(value, type, loc, label) {
  if (type.kind === 'Bool') {
    if (typeof value !== 'boolean') error(loc, `${label} must be Bool`);
  } else if (type.kind === 'Duration') {
    if (!Number.isSafeInteger(value) || value < 0) error(loc, `${label} must be a non-negative safe integer Duration`);
  } else {
    if (!Number.isFinite(value)) error(loc, `${label} must be finite`);
    if (type.kind === 'Percent' && (value < 0 || value > 100)) error(loc, `${label} must be between 0% and 100%`);
  }
  return value;
}
function settingValue(raw, type, loc) {
  let value;
  if (type.kind === 'Duration') { value = duration(raw, loc); if (value === null) error(loc, 'Duration setting must use a duration literal'); }
  else if (type.kind === 'Percent') { if (!String(raw).endsWith('%')) error(loc, 'Percent setting must use %'); value = Number(String(raw).slice(0, -1)); }
  else if (type.kind === 'Number') value = Number(raw);
  else return raw;
  return operatingValue(value, type, loc, 'config setting');
}
function isOperatingConfigLiteral(node, type) {
  if (node.kind === 'literal') {
    if (type.kind === 'Bool') return node.raw === 'true' || node.raw === 'false';
    if (type.kind === 'Duration') return duration(node.raw, node.loc) !== null;
    if (type.kind === 'Percent') return node.raw.endsWith('%');
    return type.kind === 'Number' && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(node.raw);
  }
  return type.kind === 'Number'
    && node.kind === 'unary'
    && node.op === '-'
    && node.value.kind === 'literal'
    && !node.value.parenthesized
    && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(node.value.raw);
}
function validateNominalConstant(type, value, loc) {
  if (value === undefined) return;
  if (type.kind === 'Int' && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) error(loc, 'constant Int arithmetic overflows');
  if (type.kind === 'Percent' && (!Number.isFinite(value) || value < 0 || value > 100)) error(loc, 'Percent constant must be between 0% and 100%');
  if (type.kind === 'Duration' && (!Number.isFinite(value) || value < 0 || !Number.isInteger(value))) error(loc, 'Duration constant must be a non-negative integer number of milliseconds');
}
function isWholeLiteralNode(node) { return node?.kind === 'literal' && /^\d+$/.test(node.raw); }
function intLiteral(raw, loc, negative = false) {
  const magnitude = BigInt(raw);
  const value = negative ? -magnitude : magnitude;
  if (value < -2147483648n || value > 2147483647n) error(loc, 'Int literal is outside -2147483648..2147483647');
  return { type: INT, sexpr: ['int', value.toString()], constant: Number(value) };
}
function literal(raw, loc, expected = null) {
  if (raw === 'true' || raw === 'false') return { type: BOOL, sexpr: raw, constant: raw === 'true' };
  const d = duration(raw, loc); if (d !== null) return { type: DURATION, sexpr: String(d), constant: d };
  if (raw.endsWith('%')) {
    const value = Number(raw.slice(0, -1));
    if (!Number.isFinite(value) || value < 0 || value > 100) error(loc, 'Percent literal must be between 0% and 100%');
    validateNominalConstant(PERCENT, value, loc); return { type: PERCENT, sexpr: String(value), constant: value };
  }
  if (/^\d+$/.test(raw)) {
    if (expected?.kind === 'Number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) error(loc, 'number literal must be finite');
      return { type: NUMBER, sexpr: String(value), constant: value };
    }
    return intLiteral(raw, loc);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) error(loc, 'number literal must be finite');
  if (expected?.kind === 'Int') error(loc, 'Int literal must be a whole decimal numeral without a decimal point or exponent');
  return { type: NUMBER, sexpr: String(value), constant: value };
}
function sexpr(value) {
  if (Array.isArray(value)) return `(${value.map(sexpr).join(' ')})`;
  return String(value);
}

class Lowerer {
  constructor(ast, filename) {
    this.ast = ast; this.filename = filename; this.symbols = new Map(); this.types = new Map(); this.enumMembers = new Map();
    this.functions = new Map(); this.nexts = new Map(); this.outputs = new Map(); this.states = new Map(); this.timers = new Map();
    this.sensors = new Map(); this.signals = new Map(); this.schedules = new Map(); this.lets = new Map(); this.letStates = new Map(); this.expansionNodes = 0; this.manifest = {
      format: 'GhostFlow/control-v1', name: ast.name, inputs: [], outputs: [], sensors: [], schedules: [], timers: [], signals: [], configs: [],
    };
    this.gfbInputs = []; this.gfbStates = []; this.constraints = []; this.hasClock = false;
    this.usesInt = false;
    this.hasSolarSchedule = ast.body.some(item => item.kind === 'schedule' && item.scheduleType === 'Solar');
  }
  lower({ emitBytecode = true } = {}) {
    rejectName(this.ast.name, this.ast.loc, 'control');
    this.declare(); this.validateAndPopulate();
    if (this.usesInt) this.manifest.format = 'GhostFlow/control-v4';
    const transitions = this.transitionForms();
    const intents = this.intentForms();
    this.checkExpressionStacks([...transitions, ...intents]);
    this.checkBudgets();
    // A source control must not activate on a device which lacks one of the
    // actuators it can command.  State-only controls intentionally retain the
    // unconditional query described by the GFB1 `(device true)` contract.
    const deviceQuery = this.manifest.outputs.length === 0
      ? 'true'
      : ['all', ...this.manifest.outputs.map(output => ['has', 'actuator', output.name, gfbType(semanticType(output.type))])];
    const module = ['module', this.ast.name, ['version', '1'], ...this.gfbInputs, ...this.gfbStates,
      ['strategy', 'control', '0', ['device', deviceQuery], ...transitions, ...intents], ...this.constraints];
    if (!emitBytecode) return { manifest: this.manifest, sourceMap: this.ast.sourceNodes };
    let bytes;
    try { bytes = compileGfb(sexprParse(sexprTokenize(sexpr(module)))); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      error(this.ast.loc, `GFB1 lowering rejected control: ${message}`);
    }
    const generatedTimers = [];
    for (const node of this.ast.body) if (node.kind === 'timer') {
      const timer = this.timers.get(node.name);
      if (!timer) internal(`timer ${node.name} has no lowered state binding`);
      generatedTimers.push(
        { node, name: timer.sinceState, role: 'since' },
        { node, name: timer.initState, role: 'initialized' },
      );
    }
    // Every node carries the original filename/line/column, including when a
    // future literate extractor maps this array back to Markdown locations.
    return {
      bytes,
      manifest: this.manifest,
      sourceMap: this.ast.sourceNodes,
      traceMetadata: buildSourceTrace(this.ast, this.constraints, bytes, transitions, intents, generatedTimers),
    };
  }
  unique(name, loc, category) {
    rejectName(name, loc, category);
    if (this.symbols.has(name)) error(loc, `duplicate name ${name}`);
    this.symbols.set(name, { category, loc });
  }
  resolveType(type) {
    if (SCALAR_TYPES.has(type.name)) {
      if (type.name === 'Int') this.usesInt = true;
      return semanticType(type.name);
    }
    if (this.types.has(type.name)) return semanticType(type.name);
    error(type.loc, `unknown type ${type.name}`);
  }
  declare() {
    for (const item of this.ast.body) if (item.kind === 'enum') {
      this.unique(item.name, item.loc, 'type');
      if (!item.members.length) error(item.loc, 'enum needs at least one member');
      const values = new Map();
      for (const member of item.members) {
        rejectName(member.name, member.loc, 'enum member');
        if (values.has(member.name) || this.enumMembers.has(member.name)) error(member.loc, `duplicate enum member ${member.name}`);
        values.set(member.name, values.size); this.enumMembers.set(member.name, { type: item.name, value: values.size - 1, loc: member.loc });
      }
      this.types.set(item.name, values);
    }
    for (const item of this.ast.body) {
      if (item.kind === 'enum') continue;
      if (item.kind === 'input' || item.kind === 'output') for (const name of item.names) this.unique(name, item.loc, item.kind);
      else if (['state', 'config', 'let', 'function', 'sensor', 'signal', 'schedule', 'timer'].includes(item.kind)) this.unique(item.name, item.loc, item.kind);
    }
  }
  addInput(name, type, loc, user = false) {
    if (this.gfbInputs.some(x => x[1] === name)) error(loc, `duplicate generated input ${name}`);
    this.gfbInputs.push(['input', name, gfbType(type)]);
    if (user) this.manifest.inputs.push({ name, type: type.kind });
  }
  addState(name, type, value, loc) {
    this.gfbStates.push(['state', name, gfbType(type), gfbDefault(type, value)]);
  }
  generatedName(kind, name) { return `${RESERVED_PREFIX}${kind}_${name}`; }
  validateAndPopulate() {
    // Functions are declarations, so calls may precede their definitions both
    // inside the control and in the top-level pure-function prelude.
    for (const item of this.ast.body) if (item.kind === 'function') this.addFunction(item);
    for (const item of this.ast.body) {
      if (item.kind === 'input') {
        const type = this.resolveType(item.type); if (!SCALAR_TYPES.has(type.kind)) error(item.type.loc, 'input must use a scalar type');
        for (const name of item.names) { this.addInput(name, type, item.loc, true); this.symbols.get(name).type = type; }
      }
      if (item.kind === 'output') {
        const type = this.resolveType(item.type); if (!SCALAR_TYPES.has(type.kind)) error(item.type.loc, 'output must use a scalar type');
        for (const name of item.names) { this.outputs.set(name, { name, type, loc: item.loc, expression: null }); this.symbols.get(name).type = type; this.manifest.outputs.push({ name, type: type.kind }); }
      }
      if (item.kind === 'state') {
        const type = this.resolveType(item.type); const initial = this.expression(item.initial, new Map(), { allowNext: false }, [], type);
        if (!sameType(initial.type, type) || initial.constant === undefined) error(item.loc, 'state initial value must be a constant of the state type');
        this.states.set(item.name, { ...item, type, initial: initial.constant }); this.symbols.get(item.name).type = type; this.addState(item.name, type, initial.constant, item.loc);
      }
      if (item.kind === 'config') {
        const type = this.resolveType(item.type); const value = this.expression(item.value, new Map(), { allowNext: false }, [], type);
        if (!sameType(value.type, type) || value.constant === undefined) error(item.loc, 'config value must be a constant of the declared type');
        this.symbols.get(item.name).type = type; this.symbols.get(item.name).value = value;
        const settings = item.settings ?? {};
        if (Object.keys(settings).length) {
          if (this.hasSolarSchedule) error(item.loc, 'Solar schedules cannot be combined with operating settings metadata yet');
          if (!isOperatingConfigLiteral(item.value, type)) error(item.value.loc, 'operating config initial value must be a supported literal');
          operatingValue(value.constant, type, item.value.loc, 'operating config initial value');
          const allowed = new Set(['min', 'max', 'step', 'access', 'apply', 'label']);
          for (const key of Object.keys(settings)) if (!allowed.has(key)) error(item.loc, `unknown config option ${key}`);
          if (!['operator', 'designer'].includes(settings.access ?? '')) error(item.loc, 'config access must be operator or designer');
          if ((settings.apply ?? 'stopped') !== 'stopped') error(item.loc, 'config apply must be stopped');
          if (settings.label !== undefined && (settings.label.length === 0 || settings.label.length > 128)) error(item.loc, 'config label must be 1 to 128 characters');
          if (type.kind === 'Bool' && ['min', 'max', 'step'].some(key => settings[key] !== undefined)) error(item.loc, 'Bool config cannot have numeric bounds');
          for (const key of ['min', 'max', 'step']) if (settings[key] !== undefined) settings[key] = settingValue(settings[key], type, item.loc);
          if (type.kind !== 'Bool') {
            if (!['Number', 'Duration', 'Percent'].includes(type.kind) || settings.min === undefined || settings.max === undefined || settings.step === undefined || settings.step <= 0 || settings.min > settings.max) error(item.loc, 'numeric config requires valid min, max and positive step');
            if (value.constant < settings.min || value.constant > settings.max) error(item.value.loc, 'config initial value is outside settings range');
            if (Math.abs((value.constant - settings.min) / settings.step - Math.round((value.constant - settings.min) / settings.step)) > 1e-9) error(item.value.loc, 'config initial value is not aligned to settings.step from settings.min');
          }
          this.manifest.format = 'GhostFlow/control-v2';
          this.manifest.configs.push({ name: item.name, type: type.kind, value: value.constant, settings, initialOffset: item.value.loc.offset, initialEndOffset: item.value.loc.endOffset ?? item.value.loc.offset });
        } else this.manifest.configs.push({ name: item.name, type: type.kind, value: value.constant });
      }
      if (item.kind === 'sensor') this.addSensor(item);
      if (item.kind === 'schedule') this.addSchedule(item);
    }
    for (const item of this.ast.body) if (item.kind === 'signal') this.addSignal(item);
    for (const item of this.ast.body) if (item.kind === 'timer') this.addTimer(item);
    this.validateFunctionBodies();
    for (const item of this.ast.body) if (item.kind === 'let') this.lets.set(item.name, item);
    for (const item of this.ast.body) if (item.kind === 'let') this.addLet(item);
    for (const item of this.ast.body) if (item.kind === 'next') this.addNext(item);
    for (const item of this.ast.body) if (item.kind === 'connection') this.addConnection(item);
    for (const output of this.outputs.values()) {
      if (!output.expression) error(output.loc, `output ${output.name} requires exactly one connection (${output.name} <- expression;)`);
    }
    for (const item of this.ast.body) if (item.kind === 'require' || item.kind === 'mutex') this.addConstraint(item);
  }
  addSensor(item) {
    const type = this.resolveType(item.type); if (!['Bool', 'Number', 'Percent'].includes(type.kind)) error(item.type.loc, 'sensor type must be Bool, Number, or Percent');
    const valueInput = this.generatedName('sensor_value', item.name), okInput = this.generatedName('sensor_ok', item.name);
    this.addInput(valueInput, type, item.loc); this.addInput(okInput, BOOL, item.loc);
    const opts = item.options;
    const read = (node, expected, label, required = false) => {
      if (!node) { if (required) error(item.loc, `sensor ${item.name} requires ${label}`); return null; }
      const out = this.expression(node, new Map(), { allowNext: false }, [], expected);
      if (!sameType(out.type, expected) || out.constant === undefined) error(node.loc, `${label} must be a constant ${expected.kind}`);
      return out.constant;
    };
    const sampleMs = read(opts.sample, DURATION, 'sample');
    const validMin = read(opts.validMin, type, 'valid lower bound'); const validMax = read(opts.validMax, type, 'valid upper bound');
    if ((validMin === null) !== (validMax === null)) error(item.loc, 'valid requires both lower and upper bounds');
    if (validMin !== null && validMin > validMax) error(item.loc, 'sensor valid range is inverted');
    let filter = null, window = null;
    if (opts.filter) {
      if (!['Number', 'Percent'].includes(type.kind)) error(opts.filter.loc, 'median filtering requires a Number or Percent sensor');
      if (opts.filter.kind !== 'call' || opts.filter.name !== 'median' || opts.filter.args.length !== 1 || opts.filter.named.length) error(opts.filter.loc, 'only filter = median(N) is supported');
      const n = read(opts.filter.args[0], NUMBER, 'median window', true);
      if (!Number.isInteger(n) || n < 1 || n > 31 || n % 2 === 0) error(opts.filter.loc, 'median window must be an odd integer from 1 to 31');
      filter = 'median'; window = n;
    }
    const staleMs = read(opts.staleAfter, DURATION, 'stale_after');
    let recoverSamples = null;
    if (opts.recoverAfter) { recoverSamples = read(opts.recoverAfter, NUMBER, 'recover_after'); if (!Number.isInteger(recoverSamples) || recoverSamples < 1 || recoverSamples > 31) error(opts.recoverAfter.loc, 'recover_after must be an integer from 1 to 31 samples'); }
    if (sampleMs !== null && sampleMs <= 0 || staleMs !== null && staleMs <= 0) error(item.loc, 'sensor durations must be positive');
    const record = { name: item.name, type: type.kind, sampleMs, validMin, validMax, filter, window, staleMs, recoverSamples, valueInput, okInput };
    if (item.optional) record.optional = true;
    this.manifest.sensors.push(record); this.sensors.set(item.name, { type, valueInput, okInput, loc: item.loc }); this.symbols.get(item.name).type = { kind: 'Result', value: type };
  }
  addSchedule(item) {
    if (item.scheduleType === 'Solar') return this.addSolarSchedule(item);
    const interval = this.expression(item.interval, new Map(), { allowNext: false });
    if (!sameType(interval.type, DURATION) || interval.constant !== 900_000) error(item.interval.loc, 'only DailySlots<15min> is supported');
    if (!item.timezone || !item.timezone.trim()) error(item.loc, 'schedule requires timezone');
    if (!item.selected) error(item.loc, 'schedule requires selected slots');
    const slots = []; const seen = new Set();
    for (const time of item.selected) {
      const [hours, minutes] = time.value.split(':').map(Number); const minuteOfDay = hours * 60 + minutes;
      if (hours > 23 || minutes > 59 || minuteOfDay % 15 !== 0) error(time, 'DailySlots<15min> requires a unique 15-minute HH:MM slot');
      if (seen.has(minuteOfDay)) error(time, 'duplicate schedule slot'); seen.add(minuteOfDay); slots.push(minuteOfDay);
    }
    const dueInput = this.generatedName('schedule_due', item.name); this.addInput(dueInput, BOOL, item.loc);
    this.manifest.schedules.push({ name: item.name, timezone: item.timezone, slots, dueInput }); this.schedules.set(item.name, { dueInput, loc: item.loc }); this.symbols.get(item.name).type = { kind: 'Schedule' };
  }
  addSolarSchedule(item) {
    for (const field of ['timezone', 'latitude', 'longitude', 'at', 'fallback']) {
      if (item[field] === null) error(item.loc, `Solar schedule requires ${field}`);
    }
    if (!item.timezone.trim()) error(item.loc, 'Solar schedule requires a non-empty timezone');
    try { new Intl.DateTimeFormat('en-US', { timeZone: item.timezone }); }
    catch { error(item.loc, 'Solar timezone must be a supported IANA timezone'); }
    const dueInput = this.generatedName('schedule_due', item.name);
    this.addInput(dueInput, BOOL, item.loc);
    this.manifest.format = 'GhostFlow/control-v3';
    this.manifest.schedules.push({
      kind: 'solar', name: item.name, timezone: item.timezone,
      latitude: item.latitude, longitude: item.longitude,
      event: item.at.event, offsetMs: item.at.offsetMs,
      fallback: item.fallback, dueInput,
    });
    this.schedules.set(item.name, { dueInput, loc: item.loc });
    this.symbols.get(item.name).type = { kind: 'Schedule' };
  }
  addSignal(item) {
    const call = item.call;
    if (call.kind !== 'call' || call.name !== 'hysteresis' || call.args.length !== 1 || call.named.length !== 3) error(call.loc, 'signal requires hysteresis(sensor, on_below:, off_above:, initial:)');
    const sensorRef = call.args[0]; if (sensorRef.kind !== 'reference' || !this.sensors.has(sensorRef.name)) error(sensorRef.loc, 'hysteresis first argument must be a declared sensor');
    const sensor = this.sensors.get(sensorRef.name); const named = new Map(call.named.map(x => [x.name, x]));
    if (!['Number', 'Percent'].includes(sensor.type.kind)) error(sensorRef.loc, 'hysteresis requires a Number or Percent sensor');
    if (named.size !== 3 || !named.has('on_below') || !named.has('off_above') || !named.has('initial')) error(call.loc, 'hysteresis requires on_below, off_above, and initial');
    const below = this.expression(named.get('on_below').value, new Map(), { allowNext: false }); const above = this.expression(named.get('off_above').value, new Map(), { allowNext: false }); const initial = this.expression(named.get('initial').value, new Map(), { allowNext: false });
    if (!sameType(below.type, sensor.type) || below.constant === undefined || !sameType(above.type, sensor.type) || above.constant === undefined) error(call.loc, 'hysteresis thresholds must be constant sensor values');
    if (below.constant >= above.constant) error(call.loc, 'hysteresis on_below must be less than off_above');
    if (!sameType(initial.type, BOOL) || initial.constant === undefined) error(call.loc, 'hysteresis initial must be a Bool constant');
    const valueInput = this.generatedName('signal_value', item.name), okInput = this.generatedName('signal_ok', item.name); this.addInput(valueInput, BOOL, item.loc); this.addInput(okInput, BOOL, item.loc);
    this.manifest.signals.push({ name: item.name, sensor: sensorRef.name, onBelow: below.constant, offAbove: above.constant, initial: initial.constant, valueInput, okInput });
    this.signals.set(item.name, { type: BOOL, valueInput, okInput, loc: item.loc }); this.symbols.get(item.name).type = { kind: 'Result', value: BOOL };
  }
  addTimer(item) {
    const call = item.call;
    if (call.kind !== 'call' || call.name !== 'elapsed' || call.args.length !== 1 || call.named.length) error(call.loc, 'timer requires elapsed(state)');
    const stateRef = call.args[0]; if (stateRef.kind !== 'reference' || !this.states.has(stateRef.name)) error(stateRef.loc, 'elapsed argument must be a declared state');
    if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
    const sinceState = this.generatedName('timer_since', item.name), initState = this.generatedName('timer_initialized', item.name);
    this.addState(sinceState, NUMBER, 0, item.loc); this.addState(initState, BOOL, false, item.loc);
    this.manifest.timers.push({ name: item.name, state: stateRef.name, clockInput: `${RESERVED_PREFIX}now_ms` });
    this.timers.set(item.name, { state: stateRef.name, sinceState, initState, loc: item.loc }); this.symbols.get(item.name).type = DURATION;
  }
  addFunction(item) {
    if (this.functions.has(item.name)) error(item.loc, `duplicate function ${item.name}`);
    const params = []; const names = new Set();
    for (const parameter of item.params) {
      rejectName(parameter.name, parameter.loc, 'function parameter'); if (names.has(parameter.name)) error(parameter.loc, `duplicate function parameter ${parameter.name}`); names.add(parameter.name);
      params.push({ ...parameter, resolvedType: this.resolveType(parameter.type) });
    }
    this.functions.set(item.name, { ...item, params, resultType: this.resolveType(item.result) });
  }
  validateFunctionBodies() {
    for (const fn of this.functions.values()) {
      const scope = new Map(fn.params.map(parameter => [parameter.name, {
        type: parameter.resolvedType,
        sexpr: gfbDefault(parameter.resolvedType, parameter.resolvedType.kind === 'Bool' ? false : 0),
      }]));
      const value = this.expression(fn.body, scope, { allowNext: false, pureFunction: fn.name }, [fn.name], fn.resultType);
      if (!sameType(value.type, fn.resultType)) error(fn.loc, `function ${fn.name} returns ${value.type.kind}, expected ${fn.resultType.kind}`);
    }
  }
  addLet(item) {
    this.resolveLet(item.name);
  }
  resolveLet(name) {
    const item = this.lets.get(name); if (!item) internal(`missing let definition ${name}`);
    const status = this.letStates.get(name);
    if (status === 'done') return this.symbols.get(name).value;
    if (status === 'visiting') error(item.loc, `cyclic let definition involving ${name}`);
    this.letStates.set(name, 'visiting');
    const annotation = item.annotation ? this.resolveType(item.annotation) : null;
    const value = this.expression(item.value, new Map(), { allowNext: false }, [], annotation);
    const resolvedAnnotation = annotation ?? value.type;
    if (!sameType(resolvedAnnotation, value.type)) error(item.loc, `let ${item.name} does not match annotation ${resolvedAnnotation.kind}`);
    this.symbols.get(item.name).type = resolvedAnnotation; this.symbols.get(item.name).value = value;
    this.letStates.set(name, 'done');
    return value;
  }
  addNext(item) {
    const state = this.states.get(item.name); if (!state) error(item.loc, `unknown state ${item.name}`);
    if (this.nexts.has(item.name)) error(item.loc, `duplicate next state ${item.name}`);
    const value = this.expression(item.value, new Map(), { allowNext: false }, [], state.type);
    if (!sameType(value.type, state.type)) error(item.loc, `next state ${item.name} must be ${state.type.kind}`);
    this.nexts.set(item.name, { ...item, value });
  }
  addConnection(item) {
    const output = this.outputs.get(item.name); if (!output) error(item.loc, `unknown output ${item.name}`);
    if (output.expression) error(item.loc, `duplicate output connection ${item.name}`);
    const value = this.expression(item.value, new Map(), { allowNext: true }, [], output.type);
    if (!sameType(value.type, output.type)) error(item.loc, `output ${item.name} must be ${output.type.kind}`);
    output.expression = value;
  }
  addConstraint(item) {
    if (item.kind === 'mutex') { this.addMutex(item.names, item.loc); return; }
    const expression = item.value;
    if (expression.kind === 'binary' && expression.op === '=>') {
      const target = this.outputName(expression.left, 'require implication target'); const prereqs = this.disjunction(expression.right);
      if (prereqs.length === 1) this.constraints.push(['requires', target, prereqs[0]]);
      else this.constraints.push(['requires-any', target, ...prereqs]);
      return;
    }
    if (expression.kind === 'unary' && expression.op === '!' && expression.value.kind === 'binary' && expression.value.op === '&&') { this.addMutex(this.conjunction(expression.value), item.loc); return; }
    error(item.loc, 'unsupported require: use output => output, output => (a || b), or !(a && b)');
  }
  outputName(node, label) {
    if (node.kind !== 'reference' || !this.outputs.has(node.name)) error(node.loc, `${label} must be a Bool output`);
    const output = this.outputs.get(node.name); if (!sameType(output.type, BOOL)) error(node.loc, `${label} must be a Bool output`); return node.name;
  }
  disjunction(node) { return node.kind === 'binary' && node.op === '||' ? [...this.disjunction(node.left), ...this.disjunction(node.right)] : [this.outputName(node, 'require prerequisite')]; }
  conjunction(node) { return node.kind === 'binary' && node.op === '&&' ? [...this.conjunction(node.left), ...this.conjunction(node.right)] : [this.outputName(node, 'mutex member')]; }
  addMutex(names, loc) { if (names.length < 2 || names.length > 32) error(loc, 'mutex needs 2 to 32 Bool outputs'); for (const name of names) this.outputName({ kind: 'reference', name, loc }, 'mutex member'); this.constraints.push(['mutex', ...names]); }
  expression(node, locals, options, callStack = [], expected = null) {
    if (++this.expansionNodes > EXPANSION_NODE_LIMIT) error(node.loc, `function expansion exceeds ${EXPANSION_NODE_LIMIT} node budget`);
    const recurse = (child, childLocals = locals, childOptions = options, childExpected = null) => this.expression(child, childLocals, childOptions, callStack, childExpected);
    if (node.kind === 'literal') return literal(node.raw, node.loc, expected);
    if (node.kind === 'reference') {
      if (locals.has(node.name)) return locals.get(node.name);
      const member = this.enumMembers.get(node.name); if (member) return { type: semanticType(member.type), sexpr: String(member.value), constant: member.value };
      const symbol = this.symbols.get(node.name); if (!symbol) error(node.loc, `unknown identifier ${node.name}`);
      if (options.pureFunction && symbol.category !== 'function') error(node.loc, `purefn ${options.pureFunction} cannot capture global ${node.name}`);
      if (symbol.category === 'input') return { type: symbol.type, sexpr: `input.${node.name}` };
      if (symbol.category === 'state') return { type: symbol.type, sexpr: `state.${node.name}` };
      if (symbol.category === 'config') return symbol.value;
      if (symbol.category === 'let') return this.resolveLet(node.name);
      if (symbol.category === 'timer') {
        const timer = this.timers.get(node.name); if (!timer) error(node.loc, `timer ${node.name} is not ready`);
        return { type: DURATION, sexpr: ['if', `state.${timer.initState}`, ['sub', `input.${RESERVED_PREFIX}now_ms`, `state.${timer.sinceState}`], '0'] };
      }
      if (symbol.category === 'schedule') error(node.loc, `schedule ${node.name} must be read as ${node.name}.due`);
      if (symbol.category === 'sensor' || symbol.category === 'signal') error(node.loc, `${symbol.category} ${node.name} must be handled with case ok(...) / fault(...)`);
      if (symbol.category === 'function') error(node.loc, `function ${node.name} requires arguments`);
      error(node.loc, `unsupported reference ${node.name}`);
    }
    if (node.kind === 'member') {
      if (options.pureFunction && ['input', 'state', 'next'].includes(node.base)) error(node.loc, `purefn ${options.pureFunction} cannot capture global ${node.base}.${node.member}`);
      if (node.base === 'input') {
        const symbol = this.symbols.get(node.member); if (!symbol || symbol.category !== 'input') error(node.loc, `unknown input ${node.member}`);
        return { type: symbol.type, sexpr: `input.${node.member}` };
      }
      if (node.base === 'state') {
        const state = this.states.get(node.member); if (!state) error(node.loc, `unknown state ${node.member}`);
        return { type: state.type, sexpr: `state.${node.member}` };
      }
      if (node.base === 'next') {
        if (!options.allowNext) error(node.loc, 'next state references are allowed only in output expressions');
        const state = this.states.get(node.member); if (!state) error(node.loc, `unknown state ${node.member}`);
        return { type: state.type, sexpr: `next.${node.member}` };
      }
      if (node.member === 'due' && this.schedules.has(node.base)) return { type: BOOL, sexpr: `input.${this.schedules.get(node.base).dueInput}` };
      error(node.loc, `unknown member ${node.base}.${node.member}`);
    }
    if (node.kind === 'nextReference') {
      if (options.pureFunction) error(node.loc, `purefn ${options.pureFunction} cannot capture global next.${node.name}`);
      if (!options.allowNext) error(node.loc, 'next state references are allowed only in output expressions');
      const state = this.states.get(node.name); if (!state) error(node.loc, `unknown state ${node.name}`);
      return { type: state.type, sexpr: `next.${node.name}` };
    }
    if (node.kind === 'unary') {
      if (node.op === '-' && isWholeLiteralNode(node.value) && (!expected || expected.kind === 'Int')) {
        return intLiteral(node.value.raw, node.loc, true);
      }
      const value = recurse(node.value, locals, options, expected);
      if (node.op === '!') { if (!sameType(value.type, BOOL)) error(node.loc, '! requires Bool'); return { type: BOOL, sexpr: ['not', value.sexpr], constant: value.constant === undefined ? undefined : !value.constant }; }
      if (node.op === '-') { if (!isNumeric(value.type)) error(node.loc, 'unary - requires numeric value'); const constant = value.constant === undefined ? undefined : -value.constant; validateNominalConstant(value.type, constant, node.loc); return { type: value.type, sexpr: value.type.kind === 'Int' ? ['int-neg', value.sexpr] : ['sub', '0', value.sexpr], constant }; }
    }
    if (node.kind === 'binary') return this.binary(node, recurse, expected);
    if (node.kind === 'if') {
      const test = recurse(node.test);
      let yes, no;
      if (!expected && isWholeLiteralNode(node.yes) && !isWholeLiteralNode(node.no)) {
        no = recurse(node.no); yes = recurse(node.yes, locals, options, no.type);
      } else {
        yes = recurse(node.yes, locals, options, expected);
        no = recurse(node.no, locals, options, expected ?? (isWholeLiteralNode(node.no) ? yes.type : null));
      }
      if (!sameType(test.type, BOOL)) error(node.test.loc, 'if condition must be Bool'); if (!sameType(yes.type, no.type)) error(node.loc, 'if branches must have the same type');
      return { type: yes.type, sexpr: ['if', test.sexpr, yes.sexpr, no.sexpr], constant: test.constant === undefined ? undefined : (test.constant ? yes.constant : no.constant) };
    }
    if (node.kind === 'in') {
      const left = recurse(node.left); const values = node.values.map(value => recurse(value)); for (const value of values) if (!sameType(left.type, value.type)) error(value.type?.loc ?? node.loc, 'in values must match the tested value type');
      let out = null; for (const value of values) { const equal = ['eq', left.sexpr, value.sexpr]; out = out ? ['or', out, equal] : equal; }
      return { type: BOOL, sexpr: out, constant: left.constant === undefined || values.some(x => x.constant === undefined) ? undefined : values.some(x => x.constant === left.constant) };
    }
    if (node.kind === 'case') return this.caseExpression(node, locals, options, callStack);
    if (node.kind === 'call') return this.callExpression(node, locals, options, callStack);
    error(node.loc, `unsupported expression node ${node.kind}`);
  }
  binary(node, recurse, expected) {
    let left, right;
    if (isWholeLiteralNode(node.left) && !isWholeLiteralNode(node.right)) {
      right = recurse(node.right); left = recurse(node.left, undefined, undefined, right.type);
    } else if (isWholeLiteralNode(node.right) && !isWholeLiteralNode(node.left)) {
      left = recurse(node.left); right = recurse(node.right, undefined, undefined, left.type);
    } else {
      left = recurse(node.left, undefined, undefined, expected);
      right = recurse(node.right, undefined, undefined, expected);
    }
    const op = node.op;
    if (op === '&&' || op === '||') { if (!sameType(left.type, BOOL) || !sameType(right.type, BOOL)) error(node.loc, `${op} requires Bool operands`); return { type: BOOL, sexpr: [op === '&&' ? 'and' : 'or', left.sexpr, right.sexpr], constant: left.constant === undefined || right.constant === undefined ? undefined : (op === '&&' ? left.constant && right.constant : left.constant || right.constant) }; }
    if (['==', '!='].includes(op)) { if (!sameType(left.type, right.type)) error(node.loc, `${op} requires values of the same type`); const eq = left.constant === undefined || right.constant === undefined ? undefined : left.constant === right.constant; return { type: BOOL, sexpr: op === '==' ? ['eq', left.sexpr, right.sexpr] : ['not', ['eq', left.sexpr, right.sexpr]], constant: eq === undefined ? undefined : (op === '==' ? eq : !eq) }; }
    if (['<', '<=', '>', '>='].includes(op)) { if (!isNumeric(left.type) || !sameType(left.type, right.type)) error(node.loc, `${op} requires matching numeric types`); const values = left.constant === undefined || right.constant === undefined ? undefined : ({ '<': left.constant < right.constant, '<=': left.constant <= right.constant, '>': left.constant > right.constant, '>=': left.constant >= right.constant })[op]; return { type: BOOL, sexpr: [{ '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' }[op], left.sexpr, right.sexpr], constant: values }; }
    if (['+', '-', '*', '/', 'div', '%'].includes(op)) {
      const type = arithmeticType(op, left.type, right.type, node.loc); const constants = left.constant === undefined || right.constant === undefined ? undefined : arithmetic(op, left.constant, right.constant, node.loc);
      validateNominalConstant(type, constants, node.loc);
      const head = type.kind === 'Int'
        ? ({ '+': 'int-add', '-': 'int-sub', '*': 'int-mul', div: 'int-div', '%': 'int-rem' })[op]
        : ({ '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' })[op];
      return { type, sexpr: [head, left.sexpr, right.sexpr], constant: constants };
    }
    if (op === '=>') error(node.loc, '=> is only valid in require declarations');
    error(node.loc, `unsupported operator ${op}`);
  }
  callExpression(node, locals, options, callStack) {
    if (node.name === 'ifthenelse') {
      if (node.args.length !== 3 || node.named.length) error(node.loc, 'ifthenelse requires three positional arguments');
      return this.expression({ kind: 'if', loc: node.loc, test: node.args[0], yes: node.args[1], no: node.args[2] }, locals, options, callStack);
    }
    if (node.name === 'elapsed' || node.name === 'hysteresis' || node.name === 'median') error(node.loc, `${node.name} is only valid in its declaration`);
    if (node.name === 'number') {
      if (node.args.length !== 1 || node.named.length) error(node.loc, 'number expects one Int argument');
      const value = this.expression(node.args[0], locals, options, callStack, INT);
      if (!sameType(value.type, INT)) error(node.args[0].loc, 'number argument must be Int');
      return { type: NUMBER, sexpr: ['int-to-number', value.sexpr], constant: value.constant };
    }
    if (['int_exact', 'int_floor', 'int_ceil', 'int_trunc', 'int_nearest_even'].includes(node.name)) {
      if (node.args.length !== 1 || node.named.length) error(node.loc, `${node.name} expects one Number argument`);
      const value = this.expression(node.args[0], locals, options, callStack, NUMBER);
      if (!sameType(value.type, NUMBER)) error(node.args[0].loc, `${node.name} argument must be Number`);
      let constant;
      if (value.constant !== undefined) {
        if (node.name === 'int_exact' && !Number.isInteger(value.constant)) error(node.loc, 'int_exact constant must be integral');
        constant = ({ int_exact: x => x, int_floor: Math.floor, int_ceil: Math.ceil, int_trunc: Math.trunc,
          int_nearest_even: x => { const floor = Math.floor(x), fraction = x - floor; return fraction < 0.5 ? floor : fraction > 0.5 ? floor + 1 : floor % 2 === 0 ? floor : floor + 1; } })[node.name](value.constant);
        if (!Number.isInteger(constant) || constant < -2147483648 || constant > 2147483647) error(node.loc, 'integer conversion constant is outside -2147483648..2147483647');
      }
      return { type: INT, sexpr: [node.name.replaceAll('_', '-'), value.sexpr], constant };
    }
    const fn = this.functions.get(node.name); if (!fn) error(node.loc, `unknown function ${node.name}`);
    if (node.named.length || node.args.length !== fn.params.length) error(node.loc, `function ${node.name} expects ${fn.params.length} arguments`);
    if (callStack.includes(node.name)) error(node.loc, `recursive purefn ${node.name} is not supported`);
    const args = node.args.map((arg, index) => this.expression(arg, locals, options, callStack, fn.params[index]?.resolvedType));
    for (let i = 0; i < args.length; i++) if (!sameType(args[i].type, fn.params[i].resolvedType)) error(node.args[i].loc, `argument ${i + 1} to ${node.name} must be ${fn.params[i].resolvedType.kind}`);
    const scope = new Map(locals); for (let i = 0; i < args.length; i++) scope.set(fn.params[i].name, args[i]);
    const value = this.expression(fn.body, scope, { ...options, pureFunction: node.name }, [...callStack, node.name], fn.resultType); if (!sameType(value.type, fn.resultType)) error(fn.loc, `function ${node.name} returns ${value.type.kind}, expected ${fn.resultType.kind}`); return value;
  }
  caseExpression(node, locals, options, callStack) {
    if (node.value.kind === 'reference' && (this.sensors.has(node.value.name) || this.signals.has(node.value.name))) {
      const source = this.sensors.get(node.value.name) ?? this.signals.get(node.value.name);
      return this.resultCase(node, { type: { kind: 'Result', value: source.type } }, locals, options, callStack);
    }
    const value = this.expression(node.value, locals, options, callStack);
    if (value.type.kind === 'Result') return this.resultCase(node, value, locals, options, callStack);
    if (!this.types.has(value.type.kind)) error(node.value.loc, 'case requires an enum or sensor/signal result');
    const members = this.types.get(value.type.kind); const byName = new Map(); for (const branch of node.branches) { if (branch.binding !== null) error(branch.loc, 'enum case members do not take bindings'); if (!members.has(branch.name)) error(branch.loc, `unknown ${value.type.kind} member ${branch.name}`); if (byName.has(branch.name)) error(branch.loc, `duplicate case member ${branch.name}`); byName.set(branch.name, branch); }
    if (byName.size !== members.size) error(node.loc, `case for ${value.type.kind} must be exhaustive`);
    let result = null, resultType = null;
    for (const [member, ordinal] of [...members.entries()].reverse()) {
      const branch = byName.get(member); const body = this.expression(branch.body, locals, options, callStack); if (resultType && !sameType(resultType, body.type)) error(branch.loc, 'case branches must have the same type'); resultType = body.type;
      result = result ? ['if', ['eq', value.sexpr, String(ordinal)], body.sexpr, result] : body.sexpr;
    }
    return { type: resultType, sexpr: result };
  }
  resultCase(node, value, locals, options, callStack) {
    const source = node.value.kind === 'reference' ? (this.sensors.get(node.value.name) ?? this.signals.get(node.value.name)) : null;
    if (!source) error(node.value.loc, 'case result must be a sensor or signal name'); const byName = new Map();
    for (const branch of node.branches) { if (!['ok', 'fault'].includes(branch.name)) error(branch.loc, 'sensor case supports only ok(...) and fault(...)'); if (byName.has(branch.name)) error(branch.loc, `duplicate ${branch.name} branch`); if (branch.binding === null) error(branch.loc, `${branch.name} branch requires a binding`); byName.set(branch.name, branch); }
    if (!byName.has('ok') || !byName.has('fault')) error(node.loc, 'sensor case must handle ok(...) and fault(...)');
    const ok = byName.get('ok'), fault = byName.get('fault'); const okScope = new Map(locals); if (ok.binding !== '_') okScope.set(ok.binding, { type: source.type, sexpr: `input.${source.valueInput}` });
    const faultScope = new Map(locals); const yes = this.expression(ok.body, okScope, options, callStack), no = this.expression(fault.body, faultScope, options, callStack); if (!sameType(yes.type, no.type)) error(node.loc, 'case branches must have the same type');
    return { type: yes.type, sexpr: ['if', `input.${source.okInput}`, yes.sexpr, no.sexpr] };
  }
  transitionForms() {
    const forms = [];
    for (const [name, state] of this.states) { const next = this.nexts.get(name); forms.push(['next', name, next ? next.value.sexpr : `state.${name}`]); }
    for (const timer of this.timers.values()) {
      const state = this.states.get(timer.state); const candidate = this.nexts.get(timer.state)?.value.sexpr ?? `state.${timer.state}`;
      const unchanged = ['eq', candidate, `state.${timer.state}`]; const now = `input.${RESERVED_PREFIX}now_ms`;
      forms.push(['next', timer.sinceState, ['if', ['not', `state.${timer.initState}`], now, ['if', unchanged, `state.${timer.sinceState}`, now]]]);
      forms.push(['next', timer.initState, 'true']);
    }
    return forms;
  }
  intentForms() {
    const forms = [];
    for (const output of this.outputs.values()) {
      forms.push(['intent', output.name, output.expression.sexpr]);
    }
    return forms;
  }
  checkBudgets() {
    if (this.gfbInputs.length > INPUT_LIMIT) error(this.ast.loc, `input budget exceeded (${INPUT_LIMIT})`);
    if (this.gfbStates.length > STATE_LIMIT) error(this.ast.loc, `state budget exceeded (${STATE_LIMIT})`);
    if (STRATEGY_LIMIT < 1) error(this.ast.loc, 'strategy budget is invalid');
    if (this.constraints.some(x => x.length - 1 > 32)) error(this.ast.loc, 'constraint arity exceeds 32');
  }
  checkExpressionStacks(forms) {
    for (const form of forms) {
      if (expressionTreeNodes(form[2]) > EXPANSION_NODE_LIMIT) error(this.ast.loc, `function expansion exceeds ${EXPANSION_NODE_LIMIT} node budget`);
      const peak = expressionStack(form[2]);
      if (peak > 128) error(this.ast.loc, `expression stack budget exceeded (128) for ${form[1]}`);
    }
  }
}

function arithmeticType(op, left, right, loc) {
  if (!isNumeric(left) || !isNumeric(right)) error(loc, `${op} requires numeric operands`);
  if (left.kind === 'Int' || right.kind === 'Int') {
    if (!sameType(left, right)) error(loc, `${op} does not implicitly mix ${left.kind} and ${right.kind}`);
    if (op === '/') error(loc, '/ is not defined for Int operands; use div or convert both operands to Number');
    if (['+', '-', '*', 'div', '%'].includes(op)) return INT;
  }
  if (op === 'div' || op === '%') error(loc, `${op} requires Int operands`);
  if (op === '+' || op === '-') { if (!sameType(left, right)) error(loc, `${op} does not implicitly mix ${left.kind} and ${right.kind}`); return left; }
  if (op === '*') { if (sameType(left, NUMBER)) return right; if (sameType(right, NUMBER)) return left; error(loc, '* requires a Number scale factor'); }
  if (op === '/') { if (sameType(right, NUMBER)) return left; if (sameType(left, right)) return NUMBER; error(loc, '/ requires a Number divisor or matching units'); }
  error(loc, `unsupported arithmetic ${op}`);
}
function arithmetic(op, left, right, loc) {
  if ((op === '/' || op === 'div' || op === '%') && right === 0) error(loc, op === '/' ? 'constant division by zero' : 'constant integer division by zero');
  const value = ({ '+': left + right, '-': left - right, '*': left * right, '/': left / right,
    div: Math.trunc(left / right), '%': left % right })[op];
  if (!Number.isFinite(value)) error(loc, 'constant arithmetic result is not finite'); return value;
}

// GFB1 is postfix.  This calculates the largest live operand count without
// executing values, mirroring the VM's fixed 128-slot stack budget.
function expressionStack(node) {
  if (!Array.isArray(node)) return 1;
  const [head, ...args] = node;
  if (head === 'int') return 1;
  if (['not', 'int-neg', 'int-to-number', 'int-exact', 'int-floor', 'int-ceil', 'int-trunc', 'int-nearest-even'].includes(head)) return expressionStack(args[0]);
  if (head === 'if') {
    const condition = expressionStack(args[0]); const yes = expressionStack(args[1]); const no = expressionStack(args[2]);
    return Math.max(condition, 1 + yes, 2 + no);
  }
  if (['and', 'or', 'eq', 'lt', 'lte', 'gt', 'gte', 'add', 'sub', 'mul', 'div', 'int-add', 'int-sub', 'int-mul', 'int-div', 'int-rem'].includes(head)) {
    const left = expressionStack(args[0]), right = expressionStack(args[1]); return Math.max(left, 1 + right);
  }
  return 129; // Should be unreachable after typed lowering; reject conservatively.
}

function expressionTreeNodes(node) {
  let count = 0;
  const visit = value => {
    if (++count > EXPANSION_NODE_LIMIT) return;
    if (Array.isArray(value)) for (const child of value) { visit(child); if (count > EXPANSION_NODE_LIMIT) return; }
  };
  visit(node);
  return count;
}

/** Compile control source to existing GFB1 bytes plus its host-only companion manifest. */
export function compileControl(source, { filename = '<control>' } = {}) {
  if (typeof filename !== 'string' || !filename) internal('filename must be a non-empty string');
  const ast = new ControlParser(source, filename).parse();
  return new Lowerer(ast, filename).lower();
}

/** Parse and type-check control source without selecting a bytecode format. */
export function typeCheckControl(source, { filename = '<control>' } = {}) {
  if (typeof filename !== 'string' || !filename) internal('filename must be a non-empty string');
  const ast = new ControlParser(source, filename).parse();
  return new Lowerer(ast, filename).lower({ emitBytecode: false });
}

export function parseControl(source, { filename = '<control>' } = {}) {
  return new ControlParser(source, filename).parse();
}

export { CompileError };
