/**
 * GhostFlow control front-end.
 *
 * This file intentionally only lowers a bounded, side-effect-free control AST
 * to the existing GFB1 S-expression compiler.  It does not evaluate source,
 * load modules, or execute user supplied code.
 */
import { compile as compileGfb, CompileError } from './gfb1.mjs';
import { buildSourceTrace } from './source-trace.mjs';
import { checkedAdjacentConstraints } from './constraint-proof.mjs';
import { QUANTITY_TYPES, canonicalUnitFor, isQuantityType, quantityLiteral, quantitySuffixAt } from './quantities.mjs';
import { TIME_TYPES, isTimeType, parseTimeLiteral, validateTimeValue } from './time-literals.mjs';

const INPUT_LIMIT = 128;
const STATE_LIMIT = 128;
const STRATEGY_LIMIT = 32;
const PARSER_DEPTH_LIMIT = 64;
const NODE_LIMIT = 4096;
const EXPANSION_NODE_LIMIT = 4096;
const RESERVED_PREFIX = '__gf_';
const SCALAR_TYPES = new Set(['Bool', 'Int', 'Number', 'Percent', 'Duration', ...TIME_TYPES, ...QUANTITY_TYPES]);
const FAULT_ENUMS = new Map([
  ['SensorFault', ['Disconnected', 'Stale', 'Invalid', 'NotReady']],
  ['ClockFault', ['ClockUnknown', 'ZoneUnsupported']],
  ['CalendarFault', ['ClockUnknown', 'CalendarMissing', 'CalendarOutOfRange', 'ZoneUnsupported']],
  ['TemporalContextFault', ['ClockUnknown', 'LocationUnknown', 'EventUnavailable', 'PredictionMissing', 'PredictionStale', 'ZoneUnsupported']],
  ['AccountingFault', ['ClockUnknown', 'LedgerMissing', 'LedgerCorrupt', 'LedgerIncomplete', 'CountOverflow']],
  ['SettingsFault', ['SettingsInvalid', 'SettingsUnavailable']],
].map(([name, members]) => [name, new Map(members.map((member, index) => [member, index]))]));
const FAULT_MEMBER_NAMES = new Set([...FAULT_ENUMS.values()].flatMap(members => [...members.keys()]));
const KEYWORDS = new Set([
  'control', 'fn', 'purefn', 'input', 'output', 'state', 'config', 'let',
  'type', 'enum', 'sensor', 'signal', 'event', 'schedule', 'timer', 'elapsed',
  'require', 'mutex', 'next', 'if', 'then', 'else', 'case', 'in', 'ok',
  'fault', 'true', 'false', 'adapt', 'constraints', 'check', 'limit',
  'div', 'calendar', 'provider', 'syntax', 'quote', 'instance', 'connect',
]);

export class ControlCompileError extends Error {
  constructor(message, loc, diagnosticCode) {
    super(loc ? `${loc.filename}:${loc.line}:${loc.column}: ${message}` : message);
    this.name = 'ControlCompileError';
    this.filename = loc?.filename;
    this.line = loc?.line;
    this.column = loc?.column;
    this.loc = loc ? { ...loc } : undefined;
    this.diagnosticCode = diagnosticCode;
  }
}

function error(loc, message) { throw new ControlCompileError(message, loc); }
function typeError(loc, message) { throw new ControlCompileError(message, loc, 'GF_TYPE'); }

// Recovery is limited to a completed declaration environment and one validation
// phase. Never continue into lowering with partially populated expressions.
const DIAGNOSTIC_LIMIT = 20;
function checkIndependent(items, check) {
  const errors = new Set();
  for (const item of items) {
    try { check(item); }
    catch (cause) {
      if (!(cause instanceof ControlCompileError) || !cause.loc) {
        throw cause;
      }
      errors.add(cause);
      if (errors.size > DIAGNOSTIC_LIMIT) break;
    }
  }
  if (errors.size) {
    const first = errors.values().next().value;
    first.collectedErrors = [...errors].sort((a, b) =>
      (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0)
      || a.line - b.line || a.column - b.column).slice(0, DIAGNOSTIC_LIMIT);
    if (errors.size > DIAGNOSTIC_LIMIT) first.diagnosticCollection = { limit: DIAGNOSTIC_LIMIT, truncated: true };
    throw first;
  }
}
function parseCron5(source, loc) {
  const fields = source.trim().split(/\s+/);
  if (fields.length !== 5) error(loc, 'cron5 requires exactly five fields');
  if (fields[2] !== '*' && fields[4] !== '*') error(loc, 'cron5 cannot restrict both day-of-month and day-of-week');
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  return fields.map((field, index) => {
    if (field === '*') return null;
    const [minimum, maximum] = bounds[index], values = new Set();
    for (const part of field.split(',')) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!match) error(loc, `cron5 field ${index + 1} has invalid list, range or step syntax`);
      const [, base, stride] = match;
      if (stride !== undefined && base !== '*' && !base.includes('-')) error(loc, 'cron5 step requires * or a range');
      const [start, end] = base === '*' ? [minimum, maximum] : base.includes('-') ? base.split('-').map(Number) : [Number(base), Number(base)];
      const step = stride === undefined ? 1 : Number(stride);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < minimum || end > maximum || start > end) {
        error(loc, `cron5 field ${index + 1} must be within ${minimum}..${maximum}`);
      }
      if (!Number.isSafeInteger(step) || step <= 0) error(loc, 'cron5 step must be a positive integer');
      for (let value = start; value <= end; value += step) values.add(value);
    }
    return [...values].sort((a, b) => a - b);
  });
}
function internal(message) { throw new ControlCompileError(message); }
function isName(name) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name); }
function isReserved(name) { return name.startsWith(RESERVED_PREFIX); }
function semanticType(type) { return { kind: type }; }
function resultType(value, errorType) { return { kind: 'Result', value, error: errorType }; }
function rateType(value) { return { kind: 'Rate', value }; }
const BOOL = semanticType('Bool');
const INT = semanticType('Int');
const NUMBER = semanticType('Number');
const PERCENT = semanticType('Percent');
const DURATION = semanticType('Duration');
function sameType(a, b) {
  return Boolean(a && b && a.kind === b.kind
    && (a.kind !== 'TimeSlots' || a.gridMs === b.gridMs && a.capacity === b.capacity)
    && (a.kind !== 'Result' || sameType(a.value, b.value) && sameType(a.error, b.error))
    && (a.kind !== 'Rate' || sameType(a.value, b.value)));
}
function typeNameOf(type) {
  if (type?.kind === 'Result') return `Result<${typeNameOf(type.value)}, ${typeNameOf(type.error)}>`;
  if (type?.kind === 'Rate') return `Rate<${typeNameOf(type.value)}>`;
  return type?.kind ?? 'unknown';
}
function containsRate(type) { return type?.kind === 'Rate' || type?.kind === 'Result' && containsRate(type.value); }
function isNumeric(type) { return type && (['Int', 'Number', 'Percent', 'Duration'].includes(type.kind) || isQuantityType(type.kind)); }
function gfbType(type) { return type.kind === 'Bool' ? 'bool' : type.kind === 'Int' ? 'int' : 'number'; }
function numberAtom(value) {
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const match = /^(-?)(\d)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) internal(`cannot lower finite number ${text}`);
  const [, sign, first, rest = '', exponentText] = match;
  const digits = `${first}${rest}`;
  const point = 1 + Number(exponentText);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}
function gfbDefault(type, value) { return type.kind === 'Bool' ? (value ? 'true' : 'false') : numberAtom(value); }
function defaultLowered(type) {
  if (type.kind === 'Result') return {
    type, ok: 'false', value: defaultLowered(type.value).sexpr, faultCode: '0', originTag: '0', origins: [], sample: scanSample(),
  };
  return { type, sexpr: type.kind === 'Bool' ? 'false' : type.kind === 'Int' ? ['int', '0'] : '0', constant: type.kind === 'Bool' ? false : 0 };
}
function validationLowered(type) {
  if (type.kind === 'Result') return {
    type, ok: 'false', value: validationLowered(type.value).sexpr, faultCode: '0', originTag: '0', origins: [], sample: scanSample(),
  };
  return { type, sexpr: type.kind === 'Bool' ? 'false' : type.kind === 'Int' ? ['int', '0'] : '0' };
}
function selectLowered(test, yes, no) {
  if (yes.type.kind !== 'Result') return {
    type: yes.type, sexpr: ['if', test, yes.sexpr, no.sexpr],
    constant: undefined,
  };
  return {
    type: yes.type,
    ok: ['if', test, yes.ok, no.ok],
    value: ['if', test, yes.value, no.value],
    faultCode: ['if', test, yes.faultCode, no.faultCode],
    originTag: ['if', test, yes.originTag, no.originTag],
    origins: [...new Map([...(yes.origins ?? []), ...(no.origins ?? [])].map(origin => [origin.tag, origin])).values()],
    sample: selectSample(test, yes.sample, no.sample),
    evidence: selectEvidence(test, yes.evidence, no.evidence),
  };
}
function selectEvidence(test, yes, no) {
  if (!yes && !no) return undefined;
  if (yes === no) return yes;
  return { kind: 'selected', test, yes: yes ?? null, no: no ?? null };
}
function evidenceWindows(evidence, found = new Map()) {
  if (!evidence) return found;
  if (evidence.kind === 'window') found.set(evidence.slot, evidence);
  else if (evidence.kind === 'selected') {
    evidenceWindows(evidence.yes, found);
    evidenceWindows(evidence.no, found);
  }
  return found;
}
function scanSample() {
  return { sourceTag: '0', present: 'true', epoch: '0', id: '0', timestamp: `input.${RESERVED_PREFIX}now_ms`, quality: '0', sources: [] };
}
function selectSample(test, yes = scanSample(), no = scanSample()) {
  return {
    sourceTag: ['if', test, yes.sourceTag, no.sourceTag],
    present: ['if', test, yes.present, no.present],
    epoch: ['if', test, yes.epoch, no.epoch],
    id: ['if', test, yes.id, no.id],
    timestamp: ['if', test, yes.timestamp, no.timestamp],
    quality: ['if', test, yes.quality, no.quality],
    sources: [...new Map([...(yes.sources ?? []), ...(no.sources ?? [])].map(source => [source.tag, source])).values()]
      .sort((left, right) => left.tag - right.tag || left.name.localeCompare(right.name)),
  };
}
function isStaticTransformSyntax(node) {
  return Boolean(node && (node.kind === 'binary' && node.op === '>>'
    ? isStaticTransformSyntax(node.left) && isStaticTransformSyntax(node.right)
    : node.kind === 'call' && ['map', 'and_then', 'recover'].includes(node.name) && !node.named.length && node.args.length === 1));
}

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
    const tagged = /^(datetime|date|time|cron5|day|tide|moon)`/.exec(source.slice(at));
    if (tagged) {
      let raw = '';
      for (let n = 0; n < tagged[0].length; n++) raw += take();
      let closed = false;
      while (at < source.length && source[at] !== '\n' && source[at] !== '\r') {
        const next = take(); raw += next;
        if (next === '`') { closed = true; break; }
      }
      if (!closed) error(start, `unterminated ${tagged[1]} literal`);
      add(tagged[1] === 'cron5' ? 'cron-literal'
        : ['day', 'tide', 'moon'].includes(tagged[1]) ? 'context-literal' : 'time-literal', raw, start); continue;
    }
    const pair = source.slice(at, at + 2);
    if (['<-', '=>', '->', '&&', '||', '|>', '>>', '<=', '>=', '==', '!=', '..'].includes(pair)) {
      take(); take(); add('symbol', pair, start); continue;
    }
    if ('{}()[],:;=<>!+-*/%|\'?.`@$'.includes(c)) { take(); add('symbol', c, start); continue; }
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
      let value;
      try { value = JSON.parse(raw); } catch { error(start, 'invalid string literal'); }
      add('string', value, start);
      continue;
    }
    const rest = source.slice(at);
    const time = /^(\d{1,2}):(\d{2})(?![A-Za-z0-9_])/.exec(rest);
    if (time) {
      for (let n = 0; n < time[0].length; n++) take();
      add('time', time[0], start); continue;
    }
    const numeric = /^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(rest);
    let number = numeric;
    if (numeric) {
      const suffix = quantitySuffixAt(rest, numeric[0].length);
      const end = numeric[0].length + (suffix?.length ?? 0);
      const boundary = suffix && !/[A-Za-z0-9_°Δ/]/.test(rest[end] ?? '');
      if (boundary) number = [numeric[0] + suffix];
      else number = /^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:ms|min|s|h|%)?/.exec(rest);
    }
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
    this.quoteDepth = 0;
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
    const sourceNode = { id: node.id, kind, ...copyLoc(loc) };
    if (kind === 'timer' && fields.call?.kind === 'call') {
      sourceNode.timerMode = fields.call.name === 'continuous_true' ? 'continuous-true' : fields.call.name;
    }
    if (kind === 'signal' && fields.call?.kind === 'call') sourceNode.signalMode = fields.call.name;
    this.nodes.push(sourceNode);
    return node;
  }
  enter(loc) {
    if (++this.depth > PARSER_DEPTH_LIMIT) error(loc, `parser nesting exceeds ${PARSER_DEPTH_LIMIT}`);
  }
  leave() { this.depth--; }
  parsePrelude() {
    const prelude = [];
    const imports = [], importAliases = new Set();
    if (this.matches('purefn')) error(this.current(), 'removed alias purefn; use fn');
    while (this.matches('fn') || this.matches('import') || this.matches('syntax')) {
      if (this.matches('fn')) prelude.push(this.functionDecl());
      else if (this.matches('syntax')) prelude.push(this.syntaxDecl());
      else {
        const declaration = this.importDecl();
        if (importAliases.has(declaration.name)) error(declaration.nameLoc, `duplicate import alias ${declaration.name}`);
        importAliases.add(declaration.name); imports.push(declaration);
      }
    }
    return { prelude, imports };
  }
  parse() {
    const { prelude, imports } = this.parsePrelude();
    if (this.matches('resource') || this.matches('constraints')) {
      if (prelude.length || imports.length) error(this.current(), 'resource policy cannot include control prelude');
      return this.resourcePolicy();
    }
    // Reference documents may be declaration modules without a control shell
    // when they define a reusable objective, degraded policy, or adaptation
    // contract. Preserve the same AST shape so the lowerer can type-check and
    // publish one artifact without requiring a synthetic source wrapper.
    if (!this.matches('control')) {
      const standalone = new Set(['sensor', 'config', 'objective', 'degraded', 'adapt_setting']);
      if (!standalone.has(this.current().value)) this.expect('control', 'expected control declaration');
      const first = this.current();
      const body = [];
      while (!this.matches('')) body.push(this.declaration());
      return { kind: 'control', name: '__document__', loc: copyLoc(first), body: [...prelude, ...body], imports, standalone: true, sourceNodes: this.nodes };
    }
    const start = this.expect('control', 'expected control declaration');
    const name = this.identifier('expected control name');
    this.expect('{', 'expected { after control name');
    const body = [];
    while (!this.matches('}')) {
      if (this.current().kind === 'eof') error(start, 'unclosed control block');
      body.push(this.declaration());
    }
    this.take();
    if (!this.matches('')) error(this.current(), `unexpected trailing token ${this.current().value}`);
    return { kind: 'control', name: name.value, loc: copyLoc(start), body: [...prelude, ...body], imports, sourceNodes: this.nodes };
  }
  resourcePolicy() {
    const loc = copyLoc(this.current()), resources = [], constraints = [], resourcePolicies = [];
    while (this.matches('resource')) {
      const start = this.take(), name = this.identifier('expected resource name');
      this.expect(':', 'expected : after resource name');
      const type = this.identifier('expected resource type');
      this.expect(';', 'expected ; after resource declaration');
      resources.push({ name: name.value, type: type.value, loc: copyLoc(start) });
    }
    while (this.matches('constraints') || this.matches('resource_policy')) {
      if (this.matches('constraints')) constraints.push(this.namedConstraints());
      else resourcePolicies.push(this.sharedResourcePolicy());
    }
    if (!constraints.length && !resourcePolicies.length) error(this.current(), 'resource policy document requires constraints or resource_policy');
    if (!this.matches('')) error(this.current(), `unexpected trailing token ${this.current().value}`);
    return { kind: 'resource-policy', loc, resources, constraints, resourcePolicies, sourceNodes: this.nodes };
  }
  sharedResourcePolicy() {
    const start = this.take(), name = this.identifier('expected resource policy name');
    this.expect('for', 'resource_policy requires for resource');
    const target = this.identifier('expected resource_policy target resource');
    this.expect('{', 'expected { after resource_policy target');
    const fields = {};
    while (!this.matches('}')) {
      if (this.current().kind === 'eof') error(start, 'unclosed resource_policy block');
      const key = this.identifier('expected resource policy field');
      if (!['lease', 'concurrency', 'admission', 'queue', 'preempt'].includes(key.value)) error(key, `unsupported resource policy field ${key.value}`);
      if (fields[key.value]) error(key, `duplicate resource policy field ${key.value}`);
      this.expect('=', `expected = after resource policy field ${key.value}`);
      let value;
      if (key.value === 'concurrency') value = this.current().kind === 'number' ? this.take() : this.identifier('concurrency requires a static Int');
      else if (key.value === 'queue') value = this.resourceQueue();
      else if (key.value === 'preempt') value = this.resourcePreemption();
      else value = this.identifier(`expected ${key.value} policy`);
      fields[key.value] = { value, loc: copyLoc(key) };
      this.expect(';', `expected ; after resource policy field ${key.value}`);
    }
    this.take(); this.maybe(';');
    for (const field of ['lease', 'concurrency', 'admission', 'queue', 'preempt']) {
      if (!fields[field]) error(start, `missing resource policy field ${field}`);
    }
    return { name: name.value, target: target.value, fields, loc: copyLoc(start) };
  }
  resourceQueue() {
    const kind = this.identifier('queue requires reject, fifo, or authority_then_fifo');
    if (kind.value === 'reject') return { kind: 'reject', loc: copyLoc(kind) };
    if (!['fifo', 'authority_then_fifo'].includes(kind.value)) error(kind, 'queue requires reject, fifo, or authority_then_fifo');
    this.expect('(', `expected ( after ${kind.value}`);
    const fields = {};
    while (!this.matches(')')) {
      const key = this.identifier('expected queue field');
      if (!['max', 'expires_after', 'tie'].includes(key.value)) error(key, `unsupported queue field ${key.value}`);
      if (fields[key.value]) error(key, `duplicate queue field ${key.value}`);
      this.expect(':', `expected : after queue field ${key.value}`);
      fields[key.value] = { value: this.take(), loc: copyLoc(key) };
      if (!this.maybe(',')) break;
    }
    this.expect(')', 'expected ) after queue policy');
    for (const field of ['max', 'expires_after', 'tie']) if (!fields[field]) error(kind, `missing queue field ${field}`);
    return { kind: kind.value, fields, loc: copyLoc(kind) };
  }
  resourcePreemption() {
    const kind = this.identifier('preempt requires never or higher_authority');
    if (kind.value === 'never') return { kind: 'never', loc: copyLoc(kind) };
    if (kind.value !== 'higher_authority') error(kind, 'preempt must be never or higher_authority');
    this.expect('(', 'expected ( after higher_authority');
    const fields = {};
    while (!this.matches(')')) {
      const key = this.identifier('expected preemption field');
      if (!['cleanup', 'resume'].includes(key.value)) error(key, `unsupported preemption field ${key.value}`);
      if (fields[key.value]) error(key, `duplicate preemption field ${key.value}`);
      this.expect(':', `expected : after preemption field ${key.value}`);
      fields[key.value] = { value: this.identifier(`expected ${key.value} preemption policy`), loc: copyLoc(key) };
      if (!this.maybe(',')) break;
    }
    this.expect(')', 'expected ) after preemption policy');
    for (const field of ['cleanup', 'resume']) if (!fields[field]) error(kind, `missing preemption field ${field}`);
    return { kind: kind.value, fields, loc: copyLoc(kind) };
  }
  namedConstraints(inline = false) {
    const start = this.take(), name = this.identifier('expected constraints name');
    this.expect('for', 'constraints requires for resource');
    const target = this.identifier('expected constraints target resource');
    this.expect('{', 'expected { after constraints target');
    const rules = []; let safe;
    while (!this.matches('}')) {
      if (this.current().kind === 'eof') error(start, 'unclosed constraints block');
      const kind = this.take();
      if (kind.value === 'exclusive') {
        this.expect('at', 'exclusive requires a stage');
        const stage = this.identifier('expected exclusive stage');
        if (stage.value !== 'admission') error(stage, 'exclusive stage must be admission');
        const members = this.finiteNames('exclusive modes');
        this.expect(';', 'expected ; after exclusive rule');
        rules.push(inline ? this.node('exclusive', kind, { stage: stage.value, members })
          : { kind: 'exclusive', stage: stage.value, members, loc: copyLoc(kind) });
      } else if (kind.value === 'require') {
        this.expect('at', 'require requires a stage');
        const stage = this.identifier('expected require stage');
        if (stage.value !== 'safe_output') error(stage, 'finite-set require stage must be safe_output');
        const predicate = this.constraintPredicate();
        this.expect(';', 'expected ; after require rule');
        rules.push(inline ? this.node('require', kind, { stage: stage.value, predicate })
          : { kind: 'require', stage: stage.value, predicate, loc: copyLoc(kind) });
      } else if (kind.value === 'safe') {
        if (safe !== undefined) error(kind, 'duplicate authored safe vector');
        this.expect('{', 'safe requires { resource = Bool; }');
        safe = [];
        while (!this.matches('}')) {
          if (this.current().kind === 'eof') error(kind, 'unclosed safe vector');
          const resource = this.identifier('expected safe resource alias');
          this.expect('=', 'safe resource requires =');
          const value = this.take();
          if (!['true', 'false'].includes(value.value)) error(value, 'safe value must be a literal Bool');
          this.expect(';', 'expected ; after safe resource value');
          safe.push(inline ? this.node('resource-safe-value', resource, { resource: resource.value, value: value.value === 'true' })
            : { resource: resource.value, value: value.value === 'true', loc: copyLoc(resource) });
        }
        this.take(); this.maybe(';');
      } else error(kind, `unsupported named constraint ${kind.value}; use exclusive at admission or require at safe_output`);
    }
    this.take();
    if (!rules.length) error(start, 'constraints block requires at least one rule');
    if (inline && safe === undefined) error(start, 'shared resource constraints require an authored safe vector');
    if (inline) return this.node('shared-constraints', start, { name: name.value, target: target.value, rules, safe });
    return { name: name.value, target: target.value, rules, ...(safe !== undefined ? { safe } : {}), loc: copyLoc(start) };
  }
  controlConstraints() {
    if (this.tokens[this.at + 2]?.value === 'for') return this.namedConstraints(true);
    if (this.tokens[this.at + 3]?.value === 'limit') return this.accountConstraints();
    const start = this.take(), name = this.identifier('expected constraints name');
    this.expect('{', 'expected { after constraints name');
    const rules = [];
    while (!this.matches('}')) {
      if (this.current().kind === 'eof') error(start, 'unclosed local constraints block');
      if (this.matches('require')) rules.push(this.requirement(true));
      else if (this.matches('mutex')) rules.push(this.mutex());
      else error(this.current(), `unsupported local constraint ${this.current().value}; use require or mutex, and keep accounting limit rules in a separate group`);
    }
    this.take();
    if (!rules.length) error(start, 'local constraints block requires at least one rule');
    return this.node('local-constraints', start, { name: name.value, rules });
  }
  finiteNames(label) {
    this.expect('{', `expected { for ${label}`);
    const names = [];
    if (!this.matches('}')) do {
      const token = this.identifier(`expected ${label} member`);
      names.push({ name: token.value, loc: copyLoc(token) });
    } while (this.maybe(','));
    this.expect('}', `expected } after ${label}`);
    return names;
  }
  constraintPredicate() {
    const left = this.constraintTerm();
    const op = this.current();
    if (['==', '!=', '<', '<=', '>', '>=', '=>'].includes(op.value)) {
      this.take();
      return { kind: op.value === '=>' ? 'implies' : 'compare', op: op.value,
        left, right: this.constraintTerm(), loc: copyLoc(op) };
    }
    return left;
  }
  constraintTerm() {
    const token = this.current();
    if (token.value === 'count_on' || token.value === 'any_on') {
      this.take(); this.expect('(', `expected ( after ${token.value}`);
      const resources = this.finiteNames(`${token.value} resources`);
      this.expect(')', `expected ) after ${token.value}`);
      return { kind: token.value, resources, loc: copyLoc(token) };
    }
    if (token.value === 'true' || token.value === 'false') {
      this.take(); return { kind: 'Bool', value: token.value === 'true', loc: copyLoc(token) };
    }
    if (token.kind === 'number' && /^\d+$/.test(token.value)) {
      this.take();
      const value = Number(token.value);
      if (!Number.isInteger(value) || value < 0 || value > 2147483647) error(token, 'constraint Int literal must be within 0..2147483647');
      return { kind: 'Int', value, loc: copyLoc(token) };
    }
    const name = this.identifier('expected finite-set constraint term');
    this.expect('.', 'resource predicate requires .on');
    this.expect('on', 'resource predicate requires .on');
    return { kind: 'resource-on', resource: name.value, loc: copyLoc(name) };
  }
  importDecl() {
    const start = this.take(), name = this.identifier('expected import alias');
    rejectName(name.value, name, 'import alias');
    this.expect('from', 'expected from after import alias');
    const locator = this.current();
    if (locator.kind !== 'string') error(locator, 'import locator must be a string');
    this.take();
    if (!locator.value.endsWith('.ghost.md') || locator.value.startsWith('/') || locator.value.includes('\\')
      || locator.value.includes('\0') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(locator.value)) {
      error(locator, 'import locator must name a relative canonical .ghost.md document');
    }
    this.expect('revision', 'import requires an immutable revision');
    const revision = this.current();
    if (revision.kind !== 'string') error(revision, 'import revision must be a string');
    this.take();
    if (!revision.value.trim() || revision.value.includes('\0')) error(revision, 'import revision must be a non-empty immutable revision');
    if (revision.value.toLowerCase() === 'latest') error(revision, 'import revision cannot be latest');
    this.expect('sha256', 'import requires a SHA-256 digest');
    const digest = this.current();
    if (digest.kind !== 'string' || !/^[0-9a-f]{64}$/.test(digest.value)) error(digest, 'import sha256 must be a lowercase 64-character hex digest');
    this.take();
    this.expect(';', 'expected ; after import declaration');
    return this.node('import', start, {
      name: name.value, nameLoc: copyLoc(name), locator: locator.value, locatorLoc: copyLoc(locator),
      revision: revision.value, revisionLoc: copyLoc(revision), sha256: digest.value, digestLoc: copyLoc(digest),
    });
  }
  declaration() {
    const token = this.current();
    switch (token.value) {
      case 'input': return this.port('input');
      case 'output': return this.port('output');
      case 'state': return this.state();
      case 'config': return this.config();
      case 'parameter': return this.parameter();
      case 'instance': return this.instance();
      case 'connect': return this.connectPorts();
      case 'let': return this.letDecl();
      case 'type': return this.typeDecl();
      case 'enum': error(token, 'removed alias enum; use type Name = A | B;');
      case 'fn': return this.functionDecl();
      case 'purefn': error(token, 'removed alias purefn; use fn');
      case 'sensor': return this.sensor();
      case 'event': return this.event();
      case 'calendar': return this.logicalProvider('calendar');
      case 'provider': return this.logicalProvider('provider');
      case 'resource': return this.resourceDecl();
      case 'account': return this.accountDecl();
      case 'signal': return this.signal();
      case 'schedule': return this.schedule();
      case 'timer': return this.timer();
      case 'require': return this.requirement();
      case 'mutex': return this.mutex();
      case 'next': error(token, "removed alias next; use stateName' = expression;");
      case 'adapt': return this.adaptPolicy();
      case 'objective': return this.objective();
      case 'degraded': return this.degraded();
      case 'adapt_setting': return this.adaptSetting();
      case 'constraints': return this.controlConstraints();
      case 'check': case 'limit': error(token, `unsupported construct ${token.value}`);
      default:
        if (token.kind === 'identifier' && this.tokens[this.at + 1]?.value === "'") return this.nextStatement(false);
        if (token.kind === 'identifier' && this.tokens[this.at + 1]?.value === '<-') return this.connection();
        if (token.kind === 'symbol' && token.value === '@') error(token, 'unexpected character @');
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
    const type = { name: token.value, loc: copyLoc(token) };
    if (token.value === 'TimeSlots' && this.maybe('<')) {
      type.grid = this.expression(5);
      this.expect(',', 'TimeSlots requires grid and maximum entry count');
      const capacity = this.current();
      if (capacity.kind !== 'number' || !/^\d+$/.test(capacity.value)) error(capacity, 'TimeSlots maximum entry count must be a positive integer literal');
      type.capacity = Number(this.take().value);
      this.expect('>', 'TimeSlots requires closing >');
      return type;
    }
    if (token.value === 'Result' && this.maybe('<')) {
      type.args = [this.typeName()];
      this.expect(',', 'Result type requires payload and error types');
      type.args.push(this.typeName());
      this.expect('>', 'Result type requires closing >');
    }
    return type;
  }
  port(kind) {
    const start = this.take();
    const names = this.names(`expected ${kind} name`);
    this.expect(':', `expected : after ${kind} name`);
    const type = this.typeName();
    if (kind === 'input' && this.matches('=')) {
      error(this.current(), 'input declarations are type-only; the host supplies input values');
    }
    if (kind === 'output' && this.matches('=')) {
      error(this.current(), 'output declarations are type-only; connect each output with `name <- expression;`');
    }
    this.expect(';', `expected ; after ${kind} declaration`);
    return this.node(kind, start, { names: names.map(x => x.value), type, initial: null });
  }
  state() {
    const start = this.take(), name = this.identifier('expected state name');
    this.expect(':'); const type = this.typeName(); this.expect('=', 'state requires an initial value');
    const initial = this.expression(); this.expect(';', 'expected ; after state declaration');
    return this.node('state', start, { name: name.value, type, initial });
  }
  parameter() {
    const start = this.take(), name = this.identifier('expected parameter name');
    this.expect(':', 'expected : after parameter name');
    const type = this.typeName();
    this.expect('=', 'parameter requires a default value');
    const value = this.expression();
    this.expect(';', 'expected ; after parameter declaration');
    return this.node('parameter', start, { name: name.value, type, value });
  }
  instance() {
    const start = this.take(), name = this.identifier('expected instance name');
    this.expect(':', 'expected : after instance name');
    const alias = this.identifier('expected imported definition alias');
    const args = [], names = new Set();
    if (this.maybe('(')) {
      if (!this.matches(')')) do {
        const argument = this.identifier('expected named instance argument');
        if (names.has(argument.value)) error(argument, `duplicate instance argument ${argument.value}`);
        names.add(argument.value);
        this.expect('=', 'instance argument requires =');
        args.push({ name: argument.value, value: this.expression(), loc: copyLoc(argument) });
      } while (this.maybe(','));
      this.expect(')', 'expected ) after instance arguments');
    }
    this.expect(';', 'expected ; after instance declaration');
    return this.node('instance', start, { name: name.value, alias: alias.value, aliasLoc: copyLoc(alias), arguments: args });
  }
  connectPorts() {
    const start = this.take();
    const endpoint = () => {
      const name = this.identifier('expected logical port name');
      const member = this.maybe('.') ? this.identifier('expected instance port name') : null;
      return { path: member ? `${name.value}.${member.value}` : name.value,
        instance: member ? name.value : null, port: member ? member.value : name.value, loc: copyLoc(name) };
    };
    const sink = endpoint();
    this.expect('<-', 'connect requires <-');
    const source = endpoint();
    this.expect(';', 'expected ; after port connection');
    return this.node('connect', start, { sink, source });
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
          if (option.kind !== 'identifier' && option.kind !== 'number' && option.kind !== 'time-literal') error(option, `config option ${key.value} must be a literal`);
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
    this.expect('=', 'type requires ='); const members = [this.enumMember()];
    while (this.maybe('|')) members.push(this.enumMember());
    this.expect(';', 'expected ; after type declaration');
    return this.node('enum', start, { name: name.value, members });
  }
  enumMember() {
    const name = this.identifier('expected enum member');
    const member = { name: name.value, loc: copyLoc(name) };
    if (this.maybe('{')) {
      while (!this.matches('}')) {
        const key = this.identifier('expected enum member option');
        if (key.value !== 'label') error(key, `unsupported enum member option ${key.value}`);
        if (member.label !== undefined) error(key, 'duplicate enum member option label');
        this.expect('=', 'expected = after enum member option label');
        const label = this.current();
        if (label.kind !== 'string') error(label, 'enum member label must be a string');
        if (!label.value.trim()) error(label, 'enum member label must be a non-empty string');
        member.label = this.take().value;
        this.expect(';', 'expected ; after enum member option');
      }
      this.take();
    }
    return member;
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
  expressionType(label) {
    const wrapper = this.identifier(`${label} requires Expr<T>`);
    if (wrapper.value !== 'Expr') error(wrapper, `${label} requires Expr<T>`);
    this.expect('<', `${label} requires Expr<T>`);
    const type = this.typeName();
    this.expect('>', `${label} requires closing >`);
    return type;
  }
  syntaxDecl() {
    const start = this.take(), name = this.identifier('expected syntax macro name');
    this.expect('(', 'expected ( after syntax macro name');
    const params = [];
    if (!this.matches(')')) do {
      const param = this.identifier('expected syntax macro parameter');
      this.expect(':', 'syntax macro parameter requires a type');
      params.push({ name: param.value, type: this.expressionType('syntax macro parameter'), loc: copyLoc(param) });
    } while (this.maybe(','));
    this.expect(')', 'expected ) after syntax macro parameters');
    this.expect(':', 'syntax macro requires a result type');
    const result = this.expressionType('syntax macro result');
    this.expect('{', 'expected { before syntax macro body');
    this.expect('quote', 'syntax macro body must be quote { expression }');
    this.expect('{', 'expected { after quote');
    this.quoteDepth++;
    let body;
    try { body = this.expression(); } finally { this.quoteDepth--; }
    this.expect('}', 'expected } after quoted expression');
    this.expect('}', 'expected } after syntax macro body');
    this.maybe(';');
    return this.node('syntax', start, { name: name.value, params, result, body });
  }
  event() {
    const start = this.take(), name = this.identifier('expected event name');
    this.expect(':', 'expected : after event name');
    const type = this.typeName();
    if (type.name !== 'Event' || type.args) error(type.loc, 'event declaration requires Event type');
    this.expect(';', 'expected ; after event declaration');
    return this.node('event', start, { name: name.value });
  }
  logicalProvider(kind) {
    const start = this.take(), name = this.identifier(`expected ${kind} name`);
    this.expect(':', `expected : after ${kind} name`);
    const type = this.identifier(`expected ${kind} type`);
    this.expect(';', `expected ; after ${kind} declaration`);
    return this.node(kind, start, { name: name.value, providerType: type.value });
  }
  resourceDecl() {
    const start = this.take(), name = this.identifier('expected resource name');
    this.expect(':', 'expected : after resource name');
    const type = this.identifier('expected resource type');
    let typeArgs = null;
    if (this.maybe('<')) {
      typeArgs = [this.typeName()];
      while (this.maybe(',')) typeArgs.push(this.typeName());
      this.expect('>', 'resource type requires closing >');
    }
    this.expect(';', 'expected ; after resource declaration');
    return this.node('resource', start, { name: name.value, type: type.value, typeArgs });
  }
  accountDecl() {
    const start = this.take(), name = this.identifier('expected account name');
    this.expect('=', 'account requires =');
    const value = this.expression();
    this.expect(';', 'expected ; after account declaration');
    return this.node('account', start, { name: name.value, value });
  }
  accountConstraints() {
    const start = this.take(), name = this.identifier('expected constraints name');
    this.expect('{', 'expected { after constraints name');
    const limits = [];
    while (!this.matches('}')) {
      const token = this.expect('limit', 'accounting constraints only support limit rules; keep local output and shared resource rules in separate groups');
      const used = this.call(this.expect('used', 'limit requires used(account, basis)'));
      if (!used.args.length || used.args.length > 2) error(token, 'used requires an account and one time basis');
      const op = this.current();
      if (!['<=', '<'].includes(op.value)) error(op, 'limit requires < or <=');
      this.take(); const bound = this.expression();
      this.expect('{', 'limit requires a policy block');
      const policy = {};
      while (!this.matches('}')) {
        const key = this.identifier('expected limit policy option');
        this.expect('=', `expected = after ${key.value}`);
        if (key.value === 'reserve') policy.reserve = this.expression();
        else if (key.value === 'on_unknown') policy.onUnknown = this.identifier('expected on_unknown policy').value;
        else error(key, `unsupported limit policy option ${key.value}`);
        this.expect(';', 'expected ; after limit policy option');
      }
      this.take(); this.maybe(';');
      limits.push({ used, op: op.value, bound, policy, loc: copyLoc(token) });
    }
    this.take();
    return this.node('account-constraints', start, { name: name.value, limits });
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
    if (kind.value === 'Tide') return this.tideSchedule(start, name);
    if (!['At', 'Daily', 'DailySlots', 'Periodic', 'Cron'].includes(kind.value)) error(kind, 'only At, Daily, DailySlots<15min>, Periodic, Cron, Solar and Tide schedules are supported');
    let interval = null;
    if (kind.value === 'DailySlots') {
      this.expect('<'); interval = this.expression(5); this.expect('>', 'expected > after DailySlots interval');
    }
    this.expect('{', 'expected { after schedule type'); let timezone = null, selected = null, at = null, on = null, calendar = null; const seen = new Set();
    const policy = {}, trigger = {};
    while (!this.matches('}')) {
      const key = this.identifier('expected schedule option');
      if (seen.has(key.value)) error(key, `duplicate ${kind.value} option ${key.value}`);
      seen.add(key.value); this.expect('=');
      if (key.value === 'timezone') { const value = this.current(); if (value.kind !== 'string') error(value, 'timezone must be a string'); timezone = this.take().value; }
      else if (kind.value === 'Periodic' && ['every', 'anchor', 'interval_change'].includes(key.value)) trigger[key.value] = this.expression();
      else if (kind.value === 'Cron' && key.value === 'at') {
        if (this.current().kind !== 'cron-literal') error(this.current(), 'Cron at requires a cron5 tagged literal');
        at = this.take();
      }
      else if (key.value === 'at' && ['Daily', 'At'].includes(kind.value)) at = this.expression();
      else if (key.value === 'on' && kind.value === 'Daily') {
        const value = this.current();
        if (value.kind !== 'context-literal' || !value.value.startsWith('day`')) error(value, 'Daily on requires a day tagged literal');
        on = this.take();
      }
      else if (key.value === 'calendar' && kind.value === 'Daily') calendar = this.identifier('Daily calendar requires a declared calendar');
      else if (key.value === 'selected' && kind.value === 'DailySlots') {
        if (this.maybe('[')) {
          selected = [];
          if (!this.matches(']')) do { const time = this.current(); if (time.kind !== 'time') error(time, 'selected entries must be HH:MM'); selected.push(this.take()); } while (this.maybe(','));
          this.expect(']');
        } else selected = this.identifier('selected requires HH:MM slots or a TimeSlots config');
      } else if (['dst_missing', 'dst_repeated', 'basis', 'when', 'cancel_when', 'clock', 'gap', 'recovery', 'fallback'].includes(key.value)) {
        policy[key.value] = this.expression();
      } else error(key, `unsupported schedule option ${key.value}`);
      this.expect(';', 'expected ; after schedule option');
    }
    this.take(); this.maybe(';');
    return this.node('schedule', start, { name: name.value, scheduleType: kind.value, interval, timezone, selected, at, on, calendar, policy, ...trigger });
  }
  solarSchedule(start, name) {
    this.expect('{', 'expected { after Solar');
    const options = { timezone: null, latitude: null, longitude: null, at: null, fallback: null };
    const policy = {};
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
        policy.fallback = this.expression();
        if (!(policy.fallback.kind === 'reference' && policy.fallback.name === 'skip')
          && !(policy.fallback.kind === 'call' && policy.fallback.name === 'fixed_time')) {
          error(policy.fallback.loc, 'Solar fallback must be skip');
        }
        options.fallback = policy.fallback;
      } else if (['basis', 'when', 'clock', 'gap', 'recovery'].includes(key.value)) {
        policy[key.value] = this.expression();
      } else error(key, `unsupported Solar schedule option ${key.value}`);
      this.expect(';', 'expected ; after Solar schedule option');
    }
    this.take(); this.maybe(';');
    return this.node('schedule', start, { name: name.value, scheduleType: 'Solar', policy, ...options });
  }
  tideSchedule(start, name) {
    this.expect('{', 'expected { after Tide');
    const options = { source: null, timezone: null, at: null };
    const policy = {}, seen = new Set();
    while (!this.matches('}')) {
      const key = this.identifier('expected Tide schedule option');
      if (seen.has(key.value)) error(key, `duplicate Tide schedule option ${key.value}`);
      seen.add(key.value); this.expect('=', `expected = after Tide schedule option ${key.value}`);
      if (key.value === 'source') options.source = this.identifier('Tide source requires a declared TidePredictions provider');
      else if (key.value === 'timezone') {
        const value = this.current(); if (value.kind !== 'string') error(value, 'Tide timezone must be a string');
        options.timezone = this.take().value;
      } else if (key.value === 'at') options.at = this.tideAt();
      else if (['basis', 'when', 'cancel_when', 'clock', 'gap', 'recovery', 'fallback'].includes(key.value)) policy[key.value] = this.expression();
      else error(key, `unsupported Tide schedule option ${key.value}`);
      this.expect(';', 'expected ; after Tide schedule option');
    }
    this.take(); this.maybe(';');
    return this.node('schedule', start, { name: name.value, scheduleType: 'Tide', policy, ...options });
  }
  tideAt() {
    const value = this.current();
    if (value.kind !== 'context-literal' || !value.value.startsWith('tide`')) error(value, 'Tide at must use tide`high` or tide`low`');
    this.take();
    const match = /^tide`(high|low)(?:\s*([+-])\s*(\d+(?:\.\d+)?(?:ms|min|s|h)))?`$/.exec(value.value);
    if (!match) {
      const event = /^tide`([^\s`]+)/.exec(value.value)?.[1];
      if (event && !['high', 'low'].includes(event)) error(value, 'Tide event must be high or low');
      error(value, 'Tide at requires high or low with an optional whole-number Duration offset');
    }
    const [, event, sign, raw] = match;
    const offsetMs = raw ? solarOffsetMilliseconds(raw, sign, value, 'Tide') : 0;
    return { event, offsetMs, loc: copyLoc(value) };
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
  requirement(grouped = false) {
    const start = this.take();
    if (grouped && this.maybe('at')) {
      const stage = this.identifier('expected local require stage');
      if (stage.value !== 'safe_output') error(stage, 'local require stage must be safe_output');
    }
    let value;
    if (this.matches('!')) value = this.expression();
    else {
      const left = this.expression(1); this.expect('=>', 'require supports an implication with =>'); const right = this.expression();
      value = this.node('binary', start, { op: '=>', left, right });
    }
    this.expect(';', 'expected ; after require');
    return this.node('require', start, { value, ...(grouped ? { stage: 'safe_output' } : {}) });
  }
  mutex() {
    const start = this.take(); this.expect('('); const names = this.names('expected mutex output'); this.expect(')'); this.expect(';');
    return this.node('mutex', start, { names: names.map(x => x.value) });
  }
  adaptPolicy() {
    const start = this.take(), name = this.identifier('expected adapt policy name');
    this.expect('{', 'expected { after adapt policy name');
    const strategies = [];
    while (!this.matches('}')) {
      if (this.current().kind === 'eof') error(start, 'unclosed adapt policy');
      strategies.push(this.strategy());
    }
    this.take();
    if (!strategies.length) error(start, 'adapt policy requires at least one strategy');
    return this.node('adapt', start, { name: name.value, strategies });
  }
  objective() {
    const start = this.take(), name = this.identifier('expected objective name');
    this.expect('{', 'expected { after objective name');
    const fields = {};
    while (!this.matches('}')) {
      const key = this.identifier('expected objective field');
      if (fields[key.value]) error(key, `duplicate objective field ${key.value}`);
      this.expect('=', `expected = after objective field ${key.value}`);
      if (key.value === 'measure' || key.value === 'target' || key.value === 'manipulate') fields[key.value] = this.expression();
      else if (key.value === 'output') { fields.outputMin = this.expression(); this.expect('..', 'objective output requires ..'); fields.outputMax = this.expression(); }
      else if (key.value === 'controller') { fields.controller = this.controller(); this.maybe(';'); continue; }
      else error(key, `unsupported objective field ${key.value}`);
      this.expect(';', `expected ; after objective field ${key.value}`);
    }
    this.take(); this.maybe(';');
    return this.node('objective', start, { name: name.value, ...fields });
  }
  controller() {
    const kind = this.identifier('expected controller kind');
    if (!['hysteresis', 'on_off', 'pi', 'pid'].includes(kind.value)) error(kind, 'controller must be hysteresis, on_off, pi or pid');
    this.expect('{', 'expected { after controller kind'); const fields = {};
    while (!this.matches('}')) {
      const key = this.identifier('expected controller field');
      if (fields[key.value]) error(key, `duplicate controller field ${key.value}`);
      this.expect('=', `expected = after controller field ${key.value}`);
      fields[key.value] = this.expression(); this.expect(';', `expected ; after controller field ${key.value}`);
    }
    this.take(); return { kind: kind.value, fields, loc: copyLoc(kind) };
  }
  degraded() {
    const start = this.take(), name = this.identifier('expected degraded policy name');
    this.expect('for', 'degraded requires for objective'); const objective = this.identifier('expected degraded objective');
    this.expect('{', 'expected { after degraded objective'); const branches = []; let otherwise = false, recover = null, resume = null;
    while (!this.matches('}')) {
      if (this.matches('branch')) {
        const branch = this.take(), branchName = this.identifier('expected degraded branch name');
        this.expect('priority', 'degraded branch requires priority'); const priority = this.expression();
        this.expect('when', 'degraded branch requires when'); const sensor = this.identifier('expected degraded sensor');
        this.expect('quality', 'degraded branch requires quality'); this.expect('in', 'degraded quality requires in set');
        this.expect('{'); const quality = this.identifier('expected quality member'); this.expect('}');
        this.expect('use', 'degraded branch requires use objective'); this.expect('objective', 'degraded branch requires objective keyword'); const use = this.identifier('expected fallback objective');
        this.expect('authority', 'degraded branch requires authority'); const authority = this.identifier('expected fallback authority');
        this.expect('output', 'degraded branch requires output range'); const outputMin = this.expression(); this.expect('..'); const outputMax = this.expression();
        this.expect(';'); branches.push({ name: branchName.value, priority, sensor: sensor.value, quality: quality.value, use: use.value, authority: authority.value, outputMin, outputMax, loc: copyLoc(branch) });
      } else if (this.matches('otherwise')) { this.take(); this.expect('disable', 'otherwise must be disable or a complete branch'); this.expect(';'); otherwise = true;
      } else if (this.matches('recover')) { this.take(); const target = this.identifier('expected recovery target'); this.expect('after'); const count = this.expression(); this.expect('samples'); this.expect(';'); recover = { target: target.value, count };
      } else if (this.matches('resume')) { this.take(); this.expect('='); const mode = this.identifier('expected resume policy'); if (!['require_start', 'automatic', 'stay_degraded'].includes(mode.value)) error(mode, 'resume must be require_start, automatic or stay_degraded'); this.expect(';'); resume = mode.value;
      } else error(this.current(), 'unexpected degraded policy field');
    }
    this.take(); this.maybe(';'); return this.node('degraded', start, { name: name.value, objective: objective.value, branches, otherwise, recover, resume });
  }
  adaptSetting() {
    const start = this.take(), name = this.identifier('expected adaptation name'); this.expect('for', 'adapt_setting requires for setting');
    const target = this.identifier('expected adaptation setting'); this.expect('{', 'expected { after adaptation setting'); const fields = {};
    while (!this.matches('}')) { const key = this.identifier('expected adaptation field'); this.expect('=', `expected = after adaptation field ${key.value}`); if (fields[key.value]) error(key, `duplicate adaptation field ${key.value}`); fields[key.value] = this.expression(); if (key.value === 'allowed') { this.expect('..', 'adapt_setting allowed requires ..'); fields.allowedMax = this.expression(); } if (key.value === 'max_change') { this.expect('per', 'max_change requires per duration'); fields.maxChangeWindow = this.expression(); } this.expect(';'); }
    this.take(); this.maybe(';'); return this.node('adapt-setting', start, { name: name.value, target: target.value, fields });
  }
  strategy() {
    const start = this.expect('strategy', 'expected strategy declaration');
    const name = this.identifier('expected strategy name');
    this.expect('priority', 'strategy requires priority');
    const negative = !!this.maybe('-');
    const priorityToken = this.current();
    if (priorityToken.kind !== 'number' || !/^\d+$/.test(priorityToken.value)) error(priorityToken, 'strategy priority must be an i32 integer literal');
    this.take();
    const priority = BigInt(`${negative ? '-' : ''}${priorityToken.value}`);
    if (priority < -2147483648n || priority > 2147483647n) error(priorityToken, 'strategy priority must be in -2147483648..2147483647');
    this.expect('match', 'strategy requires match');
    let match = null;
    if (this.maybe('always')) match = { always: true, capabilities: [] };
    else {
      this.expect('(', 'strategy match requires always or (capabilities)');
      const capabilities = [];
      if (!this.matches(')')) do {
        const role = this.identifier('expected capability role'); this.expect(':', 'expected : after capability role');
        const kind = this.identifier('expected capability kind');
        let type = null;
        if (this.maybe('<')) { type = this.typeName(); this.expect('>', 'expected > after capability type'); }
        capabilities.push({ role: role.value, kind: kind.value, type, loc: copyLoc(role) });
      } while (this.maybe(','));
      this.expect(')', 'expected ) after strategy match');
      if (!capabilities.length) error(start, 'strategy match must name at least one capability');
      match = { always: false, capabilities };
    }
    let where = null;
    if (this.maybe('where')) where = this.expression();
    this.expect('{', 'expected { before strategy body');
    const body = [];
    while (!this.matches('}')) {
      if (this.current().kind === 'eof') error(start, 'unclosed strategy body');
      const token = this.current();
      if (token.value === 'let') body.push(this.letDecl());
      else if (token.kind === 'identifier' && this.tokens[this.at + 1]?.value === '<-') body.push(this.connection());
      else error(token, `unexpected strategy statement ${token.value || 'end of file'}`);
    }
    this.take();
    return this.node('strategy', start, { name: name.value, priority: Number(priority), match, where, body });
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
    if (token.value === '$') {
      if (!this.quoteDepth) error(token, 'splice is only valid inside quote');
      this.expect('(', 'splice requires $(');
      const parameter = this.identifier('splice requires a syntax macro parameter');
      this.expect(')', 'splice requires closing )');
      return this.node('splice', token, { name: parameter.value });
    }
    if (token.value === '@') {
      const name = this.identifier('expected syntax macro name after @');
      if (!this.matches('(')) error(this.current(), `syntax macro ${name.value} requires arguments`);
      return this.call(name, 'macro-call', token);
    }
    if (token.value === '[') {
      const values = [];
      if (!this.matches(']')) do { values.push(this.expression()); } while (this.maybe(','));
      this.expect(']', 'expected ] after list literal');
      return this.node('list', token, { values });
    }
    if (token.kind === 'number' || token.kind === 'time-literal' || token.kind === 'context-literal' || token.kind === 'string') {
      return this.node('literal', token, { raw: token.value });
    }
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
      const value = this.expression(8);
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
  call(name, kind = 'call', loc = name) {
    this.expect('('); const args = [], named = [];
    if (!this.matches(')')) {
      do {
        if (this.current().kind === 'identifier' && this.tokens[this.at + 1]?.value === ':') {
          const label = this.take(); this.take(); named.push({ name: label.value, value: this.expression(), loc: copyLoc(label) });
        } else args.push(this.expression());
      } while (this.maybe(','));
    }
    this.expect(')', 'expected ) after arguments');
    return this.node(kind, loc, { name: name.value, args, named });
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

const BIN_PREC = { '|>': 0, '>>': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 6, '-': 6, '*': 7, '/': 7, 'div': 7, '%': 7 };
function copyLoc(token) { return { filename: token.filename, line: token.line, column: token.column, offset: token.offset, endOffset: token.endOffset, endLine: token.endLine ?? token.line, endColumn: token.endColumn ?? token.column }; }

function rejectName(name, loc, label) {
  if (!isName(name)) error(loc, `invalid ${label} name ${name}`);
  if (isReserved(name)) error(loc, `${label} name ${name} uses reserved ${RESERVED_PREFIX} prefix`);
  // `calendar` is a declaration introducer but remains valid as a function
  // name.  It is parsed contextually after `fn`, so rejecting it here would
  // prevent ordinary helper names from being used in Result provenance code.
  if (KEYWORDS.has(name) && !(label === 'function' && name === 'calendar')) error(loc, `${label} name ${name} is reserved`);
  if (FAULT_MEMBER_NAMES.has(name)) error(loc, `${label} name ${name} is a reserved fault member`);
}
function duration(raw, loc) {
  const units = { ms: 1n, s: 1000n, min: 60_000n, h: 3_600_000n };
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|min|s|h)$/.exec(raw);
  if (!match) return null;
  if (match[1].includes('.')) error(loc, 'Duration literal must use a whole-number unit quantity');
  const milliseconds = BigInt(match[1]) * units[match[2]];
  if (milliseconds > 9007199254740991n) error(loc, 'Duration literal exceeds the maximum 2^53-1 milliseconds');
  return Number(milliseconds);
}
function solarOffsetMilliseconds(raw, sign, loc, label = 'Solar') {
  const match = /^(\d+)(ms|min|s|h)$/.exec(raw);
  if (!match) error(loc, `${label} offset must be an integer duration literal using ms, s, min, or h`);
  const units = { ms: 1n, s: 1000n, min: 60_000n, h: 3_600_000n };
  const magnitude = BigInt(match[1]) * units[match[2]];
  const day = 86_400_000n;
  if (magnitude > day) error(loc, `${label} offset magnitude must not exceed 24h`);
  // The bound above makes this conversion exact.  Duration text itself is
  // parsed as BigInt so fractional values cannot be rounded into a schedule.
  const milliseconds = Number(magnitude);
  return sign === '-' ? -milliseconds : milliseconds;
}
function operatingValue(value, type, loc, label) {
  if (type.kind === 'Bool') {
    if (typeof value !== 'boolean') error(loc, `${label} must be Bool`);
  } else if (type.kind === 'Int') {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) error(loc, `${label} must be a signed 32-bit Int`);
  } else if (type.kind === 'Duration') {
    if (!Number.isSafeInteger(value) || value < 0) error(loc, `${label} must be a non-negative safe integer Duration`);
  } else if (isTimeType(type.kind)) {
    try { validateTimeValue(type.kind, value, label); } catch (cause) { error(loc, cause.message); }
  } else {
    if (!Number.isFinite(value)) error(loc, `${label} must be finite`);
    if (type.kind === 'Percent' && (value < 0 || value > 100)) error(loc, `${label} must be between 0% and 100%`);
    if (type.kind === 'RelativeHumidity' && (value < 0 || value > 1)) error(loc, `${label} must be between 0%RH and 100%RH`);
  }
  return value;
}
function locatedQuantityLiteral(raw, loc) {
  try { return quantityLiteral(raw); }
  catch (cause) { error(loc, cause.message); }
}
function settingValue(raw, type, loc) {
  let value;
  if (type.kind === 'Duration') { value = duration(raw, loc); if (value === null) error(loc, 'Duration setting must use a duration literal'); }
  else if (type.kind === 'Int') {
    if (!/^-?\d+$/.test(String(raw))) error(loc, 'Int setting must use a whole decimal literal');
    value = Number(raw);
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) error(loc, 'Int setting is outside -2147483648..2147483647');
  }
  else if (type.kind === 'Percent') { if (!String(raw).endsWith('%')) error(loc, 'Percent setting must use %'); value = Number(String(raw).slice(0, -1)); }
  else if (type.kind === 'Number') value = Number(raw);
  else if (isTimeType(type.kind)) {
    const match = /^(datetime|date|time)`([\s\S]*)`$/.exec(String(raw));
    if (!match) error(loc, `${type.kind} setting must use a tagged literal`);
    let parsed;
    try { parsed = parseTimeLiteral(match[1], match[2]); } catch (cause) { error(loc, cause.message); }
    if (parsed.type !== type.kind) error(loc, `${type.kind} setting must use a matching tagged literal`);
    value = parsed.value;
  }
  else if (isQuantityType(type.kind)) {
    const parsed = locatedQuantityLiteral(String(raw), loc);
    if (!parsed || parsed.type !== type.kind) error(loc, `${type.kind} setting must use a ${type.kind} unit literal`);
    value = parsed.value;
  }
  else return raw;
  return operatingValue(value, type, loc, 'config setting');
}
function isOperatingConfigLiteral(node, type) {
  if (node.kind === 'literal') {
    if (type.kind === 'Bool') return node.raw === 'true' || node.raw === 'false';
    if (type.kind === 'Int') return /^\d+$/.test(node.raw);
    if (type.kind === 'Duration') return duration(node.raw, node.loc) !== null;
    if (type.kind === 'Percent') return node.raw.endsWith('%');
    if (isTimeType(type.kind)) {
      const match = /^(datetime|date|time)`([\s\S]*)`$/.exec(node.raw);
      if (!match) return false;
      try { return parseTimeLiteral(match[1], match[2]).type === type.kind; } catch { return false; }
    }
    if (isQuantityType(type.kind)) return locatedQuantityLiteral(node.raw, node.loc)?.type === type.kind;
    return type.kind === 'Number' && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(node.raw);
  }
  return (type.kind === 'Int' || type.kind === 'Number' || isQuantityType(type.kind))
    && node.kind === 'unary'
    && node.op === '-'
    && node.value.kind === 'literal'
    && !node.value.parenthesized
    && (type.kind === 'Int'
      ? /^\d+$/.test(node.value.raw)
      : type.kind === 'Number'
      ? /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(node.value.raw)
      : locatedQuantityLiteral(`-${node.value.raw}`, node.loc)?.type === type.kind);
}
function validateNominalConstant(type, value, loc) {
  if (value === undefined) return;
  if (type.kind === 'Int' && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) error(loc, 'constant Int arithmetic overflows');
  if (type.kind === 'Percent' && (!Number.isFinite(value) || value < 0 || value > 100)) error(loc, 'Percent constant must be between 0% and 100%');
  if (type.kind === 'RelativeHumidity' && (!Number.isFinite(value) || value < 0 || value > 1)) error(loc, 'RelativeHumidity constant must be between 0%RH and 100%RH');
  if (type.kind === 'Duration' && (!Number.isSafeInteger(value) || value < 0)) error(loc, 'Duration constant must be a non-negative integer number of milliseconds');
  if (isTimeType(type.kind)) {
    try { validateTimeValue(type.kind, value, `${type.kind} constant`); } catch (cause) { error(loc, cause.message); }
  }
}
function isWholeLiteralNode(node) { return node?.kind === 'literal' && /^\d+$/.test(node.raw); }
function isContextualWholeLiteralNode(node) {
  return isWholeLiteralNode(node)
    || (node?.kind === 'unary' && node.op === '-' && isWholeLiteralNode(node.value));
}
function intLiteral(raw, loc, negative = false) {
  const magnitude = BigInt(raw);
  const value = negative ? -magnitude : magnitude;
  if (value < -2147483648n || value > 2147483647n) error(loc, 'Int literal is outside -2147483648..2147483647');
  return { type: INT, sexpr: ['int', value.toString()], constant: Number(value) };
}
function literal(raw, loc, expected = null) {
  if (raw === 'true' || raw === 'false') return { type: BOOL, sexpr: raw, constant: raw === 'true' };
  const tagged = /^(datetime|date|time)`([\s\S]*)`$/.exec(raw);
  if (tagged) {
    let parsed;
    try { parsed = parseTimeLiteral(tagged[1], tagged[2]); } catch (cause) { error(loc, cause.message); }
    const type = semanticType(parsed.type);
    return { type, sexpr: numberAtom(parsed.value), constant: parsed.value };
  }
  const d = duration(raw, loc); if (d !== null) return { type: DURATION, sexpr: numberAtom(d), constant: d };
  const quantity = locatedQuantityLiteral(raw, loc);
  if (quantity) {
    const type = semanticType(quantity.type);
    validateNominalConstant(type, quantity.value, loc);
    return { type, sexpr: numberAtom(quantity.value), constant: quantity.value };
  }
  if (raw.endsWith('%')) {
    const value = Number(raw.slice(0, -1));
    if (!Number.isFinite(value) || value < 0 || value > 100) error(loc, 'Percent literal must be between 0% and 100%');
    validateNominalConstant(PERCENT, value, loc); return { type: PERCENT, sexpr: numberAtom(value), constant: value };
  }
  if (/^\d+$/.test(raw)) {
    if (expected?.kind === 'Number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) error(loc, 'number literal must be finite');
      return { type: NUMBER, sexpr: numberAtom(value), constant: value };
    }
    return intLiteral(raw, loc);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) error(loc, 'number literal must be finite');
  if (expected?.kind === 'Int') error(loc, 'Int literal must be a whole decimal numeral without a decimal point or exponent');
  return { type: NUMBER, sexpr: numberAtom(value), constant: value };
}
function manifestDescriptor(name, type, extra = {}) {
  return isQuantityType(type.kind)
    ? { name, type: type.kind, canonicalUnit: canonicalUnitFor(type.kind), ...extra }
    : { name, type: type.kind, ...extra };
}
function sexpr(value) {
  if (Array.isArray(value)) return `(${value.map(sexpr).join(' ')})`;
  return String(value);
}

function canonicalModuleForm(value, depth = 0) {
  if (depth > 128) throw new CompileError('syntax nesting limit exceeded');
  return Array.isArray(value)
    ? value.map(child => canonicalModuleForm(child, depth + 1))
    : String(value);
}

function loweredExpressionUsesInt(value) {
  if (!Array.isArray(value)) return false;
  if (value[0] === 'int' || (typeof value[0] === 'string' && value[0].startsWith('int-'))) return true;
  return value.slice(1).some(loweredExpressionUsesInt);
}

// These checks require only the importing document. Imported port types and
// required inputs still require a verified definition closure.
export function validateCompositionStructure(ast) {
  const instances = ast.body.filter(item => item.kind === 'instance');
  const connections = ast.body.filter(item => item.kind === 'connect');
  if (!instances.length && !connections.length) return;
  const aliases = new Set(ast.imports.map(item => item.name));
  const definitions = new Map(), instanceNames = new Set();
  for (const item of ast.body) {
    if (['connection', 'connect', 'next', 'require', 'mutex'].includes(item.kind)) continue;
    for (const name of item.names ?? (item.name ? [item.name] : [])) {
      if (definitions.has(name)) error(item.loc, `duplicate declaration ${name}`);
      definitions.set(name, item.kind);
    }
    if (item.kind === 'instance') {
      rejectName(item.name, item.loc, 'instance');
      if (!aliases.has(item.alias)) error(item.aliasLoc, `unknown import alias ${item.alias}`);
      instanceNames.add(item.name);
    }
  }
  const suppliers = new Map();
  for (const item of ast.body) {
    if (item.kind === 'connection') {
      if (suppliers.has(item.name)) error(item.loc, `duplicate supplier for output ${item.name}`);
      suppliers.set(item.name, item);
    } else if (item.kind === 'connect') {
      for (const endpoint of [item.sink, item.source]) if (endpoint.instance && !instanceNames.has(endpoint.instance)) {
        error(endpoint.loc, `unknown instance ${endpoint.instance}`);
      }
      if (!item.sink.instance && definitions.get(item.sink.port) !== 'output') error(item.sink.loc, 'connect sink must be an instance input or root output');
      if (!item.source.instance && !['input', 'sensor'].includes(definitions.get(item.source.port))) error(item.source.loc, 'connect source must be a root input, root sensor or instance output');
      if (!item.sink.instance && !item.source.instance) error(item.source.loc, 'root output connect source must be an instance output');
      if (suppliers.has(item.sink.path)) error(item.sink.loc, `duplicate supplier for port ${item.sink.path}`);
      suppliers.set(item.sink.path, item);
    }
  }
}

class Lowerer {
  constructor(ast, filename) {
    this.ast = ast; this.filename = filename; this.symbols = new Map(); this.types = new Map(); this.enumMembers = new Map();
    this.functions = new Map(); this.macros = new Map(); this.nexts = new Map(); this.outputs = new Map(); this.states = new Map(); this.timers = new Map(); this.timerStates = new Map();
    this.sensors = new Map(); this.events = new Map(); this.calendars = new Map(); this.providers = new Map(); this.signals = new Map(); this.signalDecls = new Map(); this.resolvingSignals = new Set(); this.generatedSignals = [];
    this.windows = []; this.temporalRoots = new Map(); this.trueFors = []; this.afterEvents = []; this.naturalConditions = []; this.accountingResults = [];
    this.schedules = new Map(); this.lets = new Map(); this.letStates = new Map(); this.resources = new Map(); this.accounts = new Map(); this.expansionNodes = 0; this.manifest = {
      format: 'GhostFlow/control-v1', name: ast.name, inputs: [], outputs: [], sensors: [], schedules: [], timers: [], signals: [], configs: [],
    };
    this.adaptPolicy = null; this.adaptStrategies = []; this.currentStrategy = null;
    this.objectives = new Map(); this.degradedPolicies = new Map(); this.adaptSettings = new Map();
    this.gfbInputs = []; this.gfbStates = []; this.constraints = []; this.hasClock = false;
    this.resultSites = [];
    this.configStreams = [];
    this.usesInt = false;
    this.failedLets = new Map();
    this.syntaxOnly = false;
    this.accountingExecution = false;
    this.standalone = !!ast.standalone;
    this.hasSolarSchedule = ast.body.some(item => item.kind === 'schedule' && item.scheduleType === 'Solar');
  }
  lower({ emitBytecode = true, accountingExecution = false } = {}) {
    if (emitBytecode && this.ast.body.some(item => item.kind === 'shared-constraints')) {
      error(this.ast.body.find(item => item.kind === 'shared-constraints').loc,
        'shared resource constraints require resource binding and runtime enforcement; compile a checked nonexecutable descriptor');
    }
    this.syntaxOnly = !emitBytecode;
    this.accountingExecution = accountingExecution;
    validateCompositionStructure(this.ast);
    if (this.ast.imports.length) error(this.ast.imports[0].loc,
      'import execution requires a verified source closure and composition lowering, which are not yet supported');
    rejectName(this.ast.name, this.ast.loc, 'control');
    this.declare(); this.validateAndPopulate();
    for (const check of this.ast.compositionChecks ?? []) {
      const expected = this.resolveType(check.type);
      const actual = this.expression(check.value, new Map(), { allowNext: true }, [], expected);
      if (!sameType(actual.type, expected)) error(check.value.loc, 'composition output expression type mismatch');
    }
    const transitions = this.transitionForms();
    const intents = this.adaptPolicy ? [] : this.intentForms();
    const hasIntBoundary = this.gfbInputs.some(item => item[2] === 'int')
      || this.gfbStates.some(item => item[2] === 'int')
      || this.manifest.outputs.some(item => item.type === 'Int');
    if (hasIntBoundary || [...transitions, ...intents].some(form => loweredExpressionUsesInt(form[2]))) {
      this.manifest.format = 'GhostFlow/control-v4';
    }
    const windows = this.windowForms();
    this.checkExpressionStacks([...windows.flatMap(form => form[8].slice(1).map((value, index) => ['source', `${form[2]}:${index}`, value])), ...transitions, ...intents]);
    this.checkBudgets();
    // A source control must not activate on a device which lacks one of the
    // actuators it can command.  State-only controls intentionally retain the
    // unconditional query described by the GFB1 `(device true)` contract.
    const deviceQuery = this.manifest.outputs.length === 0
      ? 'true'
      : ['all', ...this.manifest.outputs.map(output => ['has', 'actuator', output.name, gfbType(semanticType(output.type))])];
    const solarForms = this.solarForms();
    const contextForms = emitBytecode ? this.contextForms() : [];
    if (contextForms.some(form => form[0] === 'holiday-daily-pulse') && solarForms.length) {
      error(this.ast.loc, 'Holiday Daily cannot mix with legacy Solar or non-calendar Daily/DailySlots execution');
    }
    const extendedSolar = this.manifest.schedules.some(schedule => schedule.kind === 'solar'
      && (typeof schedule.policy.clock === 'object' || typeof schedule.policy.fallback === 'object'));
    if (emitBytecode && extendedSolar && !this.configStreams.length && (this.manifest.schedules.some(schedule => schedule.kind !== 'solar')
      || this.providers.size)) {
      error(this.ast.loc, 'extended Solar policy execution requires Solar-only schedules without providers or config streams');
    }
    if (contextForms.some(form => form[0] === 'utc-range') && solarForms.length) {
      error(this.ast.loc, 'UTC Range cannot mix with legacy Solar or civil pulse execution');
    }
    if (emitBytecode && this.configStreams.length && solarForms.length) {
      error(this.ast.loc, 'config streams cannot mix with legacy Daily/DailySlots context execution; use fixed let values or a config-aware schedule');
    }
    if (accountingExecution) {
      const bindings = this.manifest.accounts ?? [];
      const constraints = this.manifest.accountingConstraints ?? [];
      if (!bindings.length || bindings.some(binding => binding.persistence !== 'durable'
        || binding.operation === 'on_time' && binding.evidenceBinding.stage !== 'applied'
        || binding.operation === 'count_events' && binding.basis.kind !== 'local_day')
        || constraints.some(group => group.limits.some(limit => limit.basis.kind !== 'rolling' || limit.operator !== '<='))) {
        error(this.ast.loc, 'executable accounting requires durable applied/local_day bindings and <= rolling limits');
      }
      this.manifest.accounting = { bindings, constraints };
      delete this.manifest.accounts;
      delete this.manifest.accountingConstraints;
    }
    if (contextForms.length || accountingExecution) this.manifest.format = 'GhostFlow/control-v10';
    else if (solarForms.some(form => form[0] === 'daily-slots-pulse')) this.manifest.format = 'GhostFlow/control-v8';
    else if (solarForms.some(form => form[0] === 'daily-pulse')) this.manifest.format = 'GhostFlow/control-v7';
    if (this.manifest.schedules.some(schedule => typeof schedule.policy?.clock === 'object'
      || typeof schedule.policy?.fallback === 'object')) this.manifest.format = 'GhostFlow/control-v12';
    if (contextForms.some(form => form[0] === 'at-pulse')) {
      if (solarForms.length || contextForms.some(form => form[0] !== 'at-pulse')
        || ['configs','sensors','providers','calendars','naturalConditions','objectives','resources','adaptSettings','signals']
          .some(key => this.manifest[key]?.length) || this.manifest.accounting) {
        error(this.ast.loc, 'At pulse execution cannot mix with other schedule/provider/config profiles');
      }
      this.manifest.format = 'GhostFlow/control-v13';
    }
    if (contextForms.some(form => form[0] === 'holiday-daily-pulse')) this.manifest.format = 'GhostFlow/control-v14';
    if (contextForms.some(form => form[0] === 'solar-context-pulse')) this.manifest.format = 'GhostFlow/control-v15';
    if (contextForms.some(form => ['calendar-range', 'calendar-result'].includes(form[0]))) this.manifest.format = 'GhostFlow/control-v18';
    const temporalForms = this.windows.length || this.trueFors.length || solarForms.length || contextForms.length ? [
      ['temporal-context', `${RESERVED_PREFIX}now_ms`, `${RESERVED_PREFIX}time_epoch`],
      ...[...this.temporalRoots.values()].sort((left, right) => left.tag - right.tag).map(root =>
        ['temporal-root', String(root.tag), root.name, root.inputs.present, root.inputs.epoch, root.inputs.id, root.inputs.timestamp]),
    ] : [];
    const strategyForms = this.adaptStrategies.length
      ? this.adaptStrategies.map(strategy => [
        'strategy', strategy.name, String(strategy.priority), ['device', ['all', ...[
          ...this.manifest.outputs.map(output => ['has', 'actuator', output.name, gfbType(semanticType(output.type))]),
          ...strategy.match.capabilities.map(capability => ['has', capability.kind, capability.role, gfbType(capability.resolvedType)]),
        ]]], ...transitions, ...this.windowForms(), ...this.trueForForms(),
          ...solarForms, ...contextForms, ...strategy.intents.map(([name, expression]) => ['intent', name, expression]),
      ])
      : [['strategy', 'control', '0', ['device', deviceQuery], ...windows, ...solarForms, ...contextForms, ...this.trueForForms(), ...transitions, ...intents]];
    const constraintProof = checkedAdjacentConstraints(this.constraints);
    const module = ['module', this.ast.name, ['version', '1'], ...this.gfbInputs, ...this.gfbStates, ...temporalForms,
      ...strategyForms, ...(constraintProof?.compiled ?? this.constraints),
      ...[...this.objectives.values()].filter(objective => objective.binding === 'native-temperature-percent-v1').map(objective => [
        'pid-objective', objective.name, objective.bindings.output, objective.bindings.measure,
        objective.bindings.measureOk, objective.bindings.target, objective.bindings.safeMax,
        objective.bindings.targetOk,
        String(objective.controller.periodMs), String(objective.controller.lateAfterMs), objective.controller.direction,
        String(objective.controller.kp), String(objective.controller.ki), String(objective.controller.kd),
        String(objective.controller.bias), String(objective.output.max), String(objective.controller.restart.output),
      ])];
    if (!emitBytecode) return { manifest: this.manifest, sourceMap: this.ast.sourceNodes };
    const policySchedule = this.ast.body.find(item => item.kind === 'schedule' && !isExecutablePulseSchedule(item) && !isExecutableRangeSchedule(item)
      && Object.keys(item.policy ?? {}).some(key => key !== 'fallback'));
    if (policySchedule) error(policySchedule.loc,
      `${policySchedule.scheduleType} policy execution requires verified occurrence provider and native admission bindings`);
    const accountingResource = [...this.resources.values()].some(type => type === 'Station' || type === 'BoolActuator');
    if (!accountingExecution && (accountingResource || this.accounts.size || this.ast.body.some(item => item.kind === 'account-constraints'))) error(this.ast.loc,
      'accounting execution requires verified resource binding, ledger persistence, and runtime enforcement');
    let bytes;
    try {
      if (new TextEncoder().encode(sexpr(module)).length > 1024 * 1024) throw new CompileError('source byte limit exceeded');
      bytes = compileGfb(canonicalModuleForm(module));
    }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      error(this.ast.loc, `GFB1 lowering rejected control: ${message}`);
    }
    const generatedTimers = [];
    for (const node of this.ast.body) if (node.kind === 'timer') {
      const timer = this.timers.get(node.name);
      if (!timer) internal(`timer ${node.name} has no lowered state binding`);
      generatedTimers.push(
        { node, name: timer.sinceState, role: 'since', value: this.timerValue(timer) },
        { node, name: timer.trackingState, role: timer.trackingRole },
      );
    }
    // Every node carries the original filename/line/column, including when a
    // future literate extractor maps this array back to Markdown locations.
    return {
      bytes,
      manifest: this.manifest,
      sourceMap: this.ast.sourceNodes,
      traceMetadata: buildSourceTrace({ ...this.ast, body: this.ast.body.flatMap(item => item.kind === 'local-constraints' ? item.rules : [item]) }, this.constraints, bytes, transitions, intents, generatedTimers, this.resultSites, this.generatedSignals,
        this.windows.map(window => ({
          node: window.item, descriptor: window.descriptor,
          source: {
            ok: window.source.ok, payload: window.source.value, fault: window.source.faultCode,
            origin: window.source.originTag, quality: window.sample.quality, sourceTag: window.sample.sourceTag,
          },
          origins: window.source.origins ?? [],
        })), constraintProof),
    };
  }
  unique(name, loc, category) {
    rejectName(name, loc, category);
    if (this.symbols.has(name)) error(loc, `duplicate name ${name}`);
    this.symbols.set(name, { category, loc });
  }
  resolveType(type) {
    if (type.name === 'TimeSlots') {
      if (!type.grid || !Number.isSafeInteger(type.capacity) || type.capacity <= 0) error(type.loc, 'TimeSlots requires a positive grid and maximum entry count');
      const grid = this.expression(type.grid, new Map(), { allowNext: false }, [], DURATION);
      if (!sameType(grid.type, DURATION) || !Number.isSafeInteger(grid.constant) || grid.constant <= 0 || 86_400_000 % grid.constant !== 0) {
        error(type.grid.loc, 'TimeSlots grid must be a positive Duration that divides 24 hours exactly');
      }
      return { kind: 'TimeSlots', gridMs: grid.constant, capacity: type.capacity };
    }
    if (type.name === 'Result') {
      if (!Array.isArray(type.args) || type.args.length !== 2) error(type.loc, 'Result type requires payload and error types');
      const value = this.resolveType(type.args[0]);
      const fault = this.resolveType(type.args[1]);
      if (!FAULT_ENUMS.has(fault.kind)) error(type.args[1].loc, 'Result error type must be a compiler-owned fault enum');
      if (value.kind === 'Result') error(type.args[0].loc, 'nested Result payload is not supported');
      return resultType(value, fault);
    }
    if (SCALAR_TYPES.has(type.name)) {
      if (type.name === 'Int') this.usesInt = true;
      return semanticType(type.name);
    }
    if (this.types.has(type.name) || FAULT_ENUMS.has(type.name)) return semanticType(type.name);
    error(type.loc, `unknown type ${type.name}`);
  }
  declare() {
    for (const [name, members] of FAULT_ENUMS) this.types.set(name, members);
    for (const item of this.ast.body) if (item.kind === 'enum') {
      if (FAULT_ENUMS.has(item.name) || item.name === 'Result' || item.name === 'Event' || SCALAR_TYPES.has(item.name)) error(item.loc, `type name ${item.name} is reserved`);
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
      else if (['state', 'config', 'parameter', 'let', 'function', 'syntax', 'sensor', 'event', 'calendar', 'provider', 'signal', 'schedule', 'timer', 'resource', 'account', 'account-constraints', 'shared-constraints', 'local-constraints'].includes(item.kind)) this.unique(item.name, item.loc, item.kind);
      else if (item.kind === 'adapt') this.unique(item.name, item.loc, 'adapt policy');
      else if (['objective', 'degraded', 'adapt-setting'].includes(item.kind)) this.unique(item.name, item.loc, item.kind);
    }
    const adaptations = this.ast.body.filter(item => item.kind === 'adapt');
    if (adaptations.length > 1) error(adaptations[1].loc, 'a control may declare only one adapt policy');
    this.adaptPolicy = adaptations[0] ?? null;
  }
  addInput(name, type, loc, user = false) {
    if (this.gfbInputs.some(x => x[1] === name)) error(loc, `duplicate generated input ${name}`);
    this.gfbInputs.push(['input', name, gfbType(type)]);
    if (user) this.manifest.inputs.push(manifestDescriptor(name, type));
  }
  validateAccount(item) {
    const call = item.value;
    if (call.kind !== 'call' || !['on_time', 'count_events'].includes(call.name)) error(item.loc, 'account requires on_time or count_events');
    const first = call.args[0];
    if (!first || first.kind !== 'reference') error(item.loc, 'account target must be a resource or Event');
    if (call.name === 'on_time' && this.resources.get(first.name) === undefined) error(first.loc, `unknown resource ${first.name}`);
    if (call.name === 'count_events' && !this.events.has(first.name)) error(first.loc, `unknown event ${first.name}`);
    const named = new Map(call.named.map(entry => [entry.name, entry.value]));
    const stage = named.get('stage');
    if (call.name === 'on_time' && (!stage || stage.kind !== 'reference' || !['requested', 'safe', 'applied', 'confirmed'].includes(stage.name))) error(item.loc, 'on_time requires stage: requested|safe|applied|confirmed');
    const persistence = named.get('persistence');
    if (!persistence || persistence.kind !== 'reference' || !['durable', 'volatile', 'block_after_restart', 'block_until_day_boundary'].includes(persistence.name)) error(item.loc, 'account requires persistence policy');
    if (call.name === 'count_events') {
      const over = named.get('over');
      if (!over || over.kind !== 'call' || !['local_day', 'rolling'].includes(over.name)) error(item.loc, 'count_events requires over: local_day(...) or rolling(...)');
    }
    const evidenceBinding = call.name === 'on_time'
      ? { kind: 'applied_interval', target: first.name, stage: stage.name, identity: 'receipt_id' }
      : { kind: 'typed_event', target: first.name, identity: 'event_id' };
    const basis = call.name === 'count_events' ? this.accountingBasis(named.get('over'), item.loc) : undefined;
    let resultInputs;
    if (this.accountingExecution && call.name === 'count_events') {
      if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
      if (!this.gfbInputs.some(input => input[1] === `${RESERVED_PREFIX}time_epoch`)) {
        this.addInput(`${RESERVED_PREFIX}time_epoch`, NUMBER, item.loc);
      }
      resultInputs = Object.fromEntries(['ok', 'value', 'fault'].map(role =>
        [role, `${RESERVED_PREFIX}accounting_${item.id}_${role}`]));
      this.addInput(resultInputs.ok, BOOL, item.loc);
      this.addInput(resultInputs.value, INT, item.loc);
      this.addInput(resultInputs.fault, NUMBER, item.loc);
    }
    const descriptor = { name: item.name, operation: call.name, persistence: persistence.name, evidenceBinding,
      ...(basis ? { site: item.id, basis, resultInputs } : {}) };
    this.accounts.set(item.name, descriptor); (this.manifest.accounts ??= []).push(descriptor);
    if (resultInputs) this.accountingResults.push(descriptor);
    this.symbols.get(item.name).type = call.name === 'count_events'
      ? resultType(INT, semanticType('AccountingFault')) : DURATION;
  }
  validateAccountConstraints(item) {
    const limits = item.limits.map(limit => {
      const call = limit.used;
      if (call.kind !== 'call' || call.name !== 'used' || call.args.length !== 2 || call.args[0].kind !== 'reference') error(limit.loc, 'used requires account and time basis');
      const account = this.accounts.get(call.args[0].name);
      if (!account) error(call.args[0].loc, `unknown account ${call.args[0].name}`);
      const basis = call.args[1];
      if (!basis || basis.kind !== 'call' || !['rolling', 'local_day'].includes(basis.name)) error(limit.loc, 'used requires rolling(...) or local_day(...)');
      if (!limit.policy.reserve || limit.policy.onUnknown !== 'block') error(limit.loc, 'limit requires reserve and on_unknown: block');
      const checkedBound = this.expression(limit.bound, new Map(), { allowNext: false }, [], DURATION);
      const checkedReserve = this.expression(limit.policy.reserve, new Map(), { allowNext: false }, [], DURATION);
      if (!sameType(checkedBound.type, DURATION) || !Number.isSafeInteger(checkedBound.constant) || checkedBound.constant <= 0) error(limit.bound.loc, 'accounting limit bound must be a positive constant Duration');
      if (!sameType(checkedReserve.type, DURATION) || !Number.isSafeInteger(checkedReserve.constant) || checkedReserve.constant <= 0) error(limit.policy.reserve.loc, 'accounting reserve must be a positive constant Duration');
      return { account: account.name, operator: limit.op, basis: this.accountingBasis(basis, limit.loc),
        boundMs: checkedBound.constant, reserveMs: checkedReserve.constant,
        persistence: account.persistence, onUnknown: limit.policy.onUnknown };
    });
    (this.manifest.accountingConstraints ??= []).push({ name: item.name, limits });
  }
  accountingBasis(basis, loc) {
    if (basis.named.length || basis.args.length !== 1) error(loc, `${basis.name} accounting basis requires exactly one argument`);
    if (basis.name === 'local_day') {
      const zone = basis.args[0];
      if (zone.kind !== 'literal' || typeof zone.raw !== 'string' || !zone.raw) error(zone.loc, 'local_day requires a non-empty timezone literal');
      return { kind: 'local_day', zone: zone.raw };
    }
    const duration = this.expression(basis.args[0], new Map(), { allowNext: false }, [], DURATION);
    if (!sameType(duration.type, DURATION) || !Number.isSafeInteger(duration.constant) || duration.constant <= 0) error(basis.loc, 'rolling requires a positive constant Duration');
    return { kind: 'rolling', durationMs: duration.constant };
  }
  addState(name, type, value, loc) {
    this.gfbStates.push(['state', name, gfbType(type), gfbDefault(type, value)]);
  }
  generatedName(kind, name) { return `${RESERVED_PREFIX}${kind}_${name}`; }
  validateAndPopulate() {
    if (this.ast.body.some(item => item.kind === 'shared-constraints')) {
      this.manifest.sharedResourceConstraints = checkResourcePolicy({
        inline: true, resources: this.ast.body.filter(item => item.kind === 'resource'),
        constraints: this.ast.body.filter(item => item.kind === 'shared-constraints'),
      }).constraints;
    }
    for (const item of this.ast.body) if (item.kind === 'syntax') this.addMacro(item);
    // Functions are declarations, so calls may precede their definitions both
    // inside the control and in the top-level pure-function prelude.
    for (const item of this.ast.body) if (item.kind === 'function') this.addFunction(item);
    for (const item of this.ast.body) if (item.kind === 'let') this.lets.set(item.name, item);
    for (const item of this.ast.body) {
      if (item.kind === 'resource') {
        if (!['BoolActuator', 'Station', 'ContinuousActuator'].includes(item.type)) error(item.loc, `unsupported resource type ${item.type}`);
        this.resources.set(item.name, item.type); (this.manifest.resources ??= []).push({ name: item.name, type: item.type });
        this.symbols.get(item.name).type = semanticType(item.type);
      }
    }
    for (const item of this.ast.body) {
      if (item.kind === 'account') this.validateAccount(item);
      if (item.kind === 'account-constraints') {
        if (!this.ast.body.some(entry => entry.kind === 'resource' || entry.kind === 'account')) error(item.loc, 'unsupported construct constraints; use the named-constraints parser');
        this.validateAccountConstraints(item);
      }
      if (item.kind === 'input') {
        const type = this.resolveType(item.type); if (!SCALAR_TYPES.has(type.kind)) error(item.type.loc, 'input must use a scalar type');
        for (const name of item.names) { this.addInput(name, type, item.loc, true); this.symbols.get(name).type = type; }
      }
      if (item.kind === 'output') {
        const type = this.resolveType(item.type); if (!SCALAR_TYPES.has(type.kind)) error(item.type.loc, 'output must use a scalar type');
        for (const name of item.names) { this.outputs.set(name, { name, type, loc: item.loc, expression: null }); this.symbols.get(name).type = type; this.manifest.outputs.push(manifestDescriptor(name, type)); }
      }
      if (item.kind === 'state') {
        const type = this.resolveType(item.type); const initial = this.expression(item.initial, new Map(), { allowNext: false }, [], type);
        if (type.kind === 'Result') error(item.type.loc, 'Result cannot be stored in state');
        if (!sameType(initial.type, type) || initial.constant === undefined) error(item.loc, 'state initial value must be a constant of the state type');
        this.states.set(item.name, { ...item, type, initial: initial.constant }); this.symbols.get(item.name).type = type; this.addState(item.name, type, initial.constant, item.loc);
      }
      if (item.kind === 'parameter') {
        const value = this.resolveParameter(item.name);
        (this.manifest.parameters ??= []).push(manifestDescriptor(item.name, value.type, { value: value.constant }));
      }
      if (item.kind === 'config') {
        const type = this.resolveType(item.type); const value = this.expression(item.value, new Map(), { allowNext: false }, [], type);
        if (type.kind === 'Result') error(item.type.loc, 'Result cannot be stored in config');
        if (!sameType(value.type, type) || value.constant === undefined) error(item.loc, 'config value must be a constant of the declared type');
        if (type.kind === 'TimeSlots') {
          const seen = new Set();
          if (value.constant.length > type.capacity) error(item.value.loc, `TimeSlots exceeds maximum capacity ${type.capacity}`);
          for (const ms of value.constant) {
            if (ms % type.gridMs !== 0) error(item.value.loc, `TimeSlots value must align to its ${type.gridMs}ms grid`);
            if (seen.has(ms)) error(item.value.loc, 'TimeSlots values must be unique');
            seen.add(ms);
          }
          value.constant.sort((a, b) => a - b);
        }
        const symbol = this.symbols.get(item.name);
        const resultInputs = type.kind === 'TimeSlots' ? null : Object.fromEntries(['ok', 'value', 'fault'].map(role =>
          [role, `${RESERVED_PREFIX}config_${item.id}_${role}`]));
        if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
        if (!this.gfbInputs.some(input => input[1] === `${RESERVED_PREFIX}time_epoch`)) {
          this.addInput(`${RESERVED_PREFIX}time_epoch`, NUMBER, item.loc);
        }
        if (resultInputs) {
          this.addInput(resultInputs.ok, semanticType('Bool'), item.loc);
          this.addInput(resultInputs.value, type, item.loc);
          this.addInput(resultInputs.fault, semanticType('Number'), item.loc);
        }
        symbol.id = item.id;
        symbol.type = resultType(type, semanticType('SettingsFault'));
        symbol.payloadType = type;
        symbol.value = value;
        symbol.resultInputs = resultInputs;
        this.configStreams.push({ id: item.id, name: item.name, type, resultInputs });
        const settings = item.settings ?? {};
        if (Object.keys(settings).length) {
          if (type.kind === 'TimeSlots') {
            if (item.value.kind !== 'list') error(item.value.loc, 'TimeSlots initial value must be a finite list literal');
            if (settings.min !== undefined || settings.max !== undefined || settings.step !== undefined) error(item.loc, 'TimeSlots config does not use numeric bounds');
          } else {
            if (!isOperatingConfigLiteral(item.value, type)) error(item.value.loc, 'operating config initial value must be a supported literal');
            operatingValue(value.constant, type, item.value.loc, 'operating config initial value');
          }
          const allowed = new Set(['min', 'max', 'step', 'access', 'label']);
          for (const key of Object.keys(settings)) if (!allowed.has(key)) error(item.loc, `unknown config option ${key}`);
          if (!['operator', 'designer'].includes(settings.access ?? '')) error(item.loc, 'config access must be operator or designer');
          if (settings.label !== undefined && (settings.label.length === 0 || settings.label.length > 128)) error(item.loc, 'config label must be 1 to 128 characters');
          if ((type.kind === 'Bool' || type.kind === 'TimeSlots') && ['min', 'max', 'step'].some(key => settings[key] !== undefined)) error(item.loc, `${type.kind} config cannot have numeric bounds`);
          for (const key of ['min', 'max']) if (settings[key] !== undefined) settings[key] = settingValue(settings[key], type, item.loc);
          if (settings.step !== undefined) {
            const stepType = type.kind === 'Temperature' ? semanticType('TemperatureDelta')
              : type.kind === 'Date' ? INT
                : type.kind === 'TimeOfDay' || type.kind === 'DateTime' ? DURATION : type;
            settings.step = settingValue(settings.step, stepType, item.loc);
            if (type.kind === 'Temperature') settings.stepType = 'TemperatureDelta';
            if (type.kind === 'Date') settings.stepType = 'Int';
            if (type.kind === 'TimeOfDay' || type.kind === 'DateTime') settings.stepType = 'Duration';
          }
          if (type.kind !== 'Bool' && type.kind !== 'TimeSlots') {
            if ((!['Int', 'Number', 'Duration', 'Percent'].includes(type.kind) && !isQuantityType(type.kind) && !isTimeType(type.kind)) || settings.min === undefined || settings.max === undefined || settings.step === undefined || settings.step <= 0 || settings.min > settings.max) error(item.loc, 'numeric config requires valid min, max and positive step');
            if (value.constant < settings.min || value.constant > settings.max) error(item.value.loc, 'config initial value is outside settings range');
            const initialMisaligned = type.kind === 'Int' || isTimeType(type.kind)
              ? (value.constant - settings.min) % settings.step !== 0
              : Math.abs((value.constant - settings.min) / settings.step - Math.round((value.constant - settings.min) / settings.step)) > 1e-9;
            if (initialMisaligned) error(item.value.loc, 'config initial value is not aligned to settings.step from settings.min');
            if (type.kind === 'Int' && (settings.max - settings.min) % settings.step !== 0) error(item.loc, 'Int config max is not aligned to settings.step from settings.min');
            if (isTimeType(type.kind) && (settings.max - settings.min) % settings.step !== 0) error(item.loc, 'time config max is not aligned to settings.step from settings.min');
          }
          this.manifest.format = 'GhostFlow/control-v2';
          let displayUnit;
          if (type.kind === 'Temperature') {
            const literal = item.value.kind === 'literal' ? quantityLiteral(item.value.raw) : null;
            if (!literal || (literal.suffix !== '°C' && literal.suffix !== 'K')) error(item.value.loc, 'Temperature operator config display unit must be explicitly °C or K');
            displayUnit = literal.suffix;
          }
          this.manifest.configs.push(manifestDescriptor(item.name, type, type.kind === 'TimeSlots'
            ? { id: item.id, type: `TimeSlots<${type.gridMs}ms,${type.capacity}>`, value: value.constant, gridMs: type.gridMs, capacity: type.capacity, settings }
            : { id: item.id, value: value.constant, settings, initialOffset: item.value.loc.offset, initialEndOffset: item.value.loc.endOffset ?? item.value.loc.offset, ...(displayUnit ? { displayUnit } : {}) }));
        } else this.manifest.configs.push(manifestDescriptor(item.name, type, type.kind === 'TimeSlots'
          ? { id: item.id, type: `TimeSlots<${type.gridMs}ms,${type.capacity}>`, value: value.constant, gridMs: type.gridMs, capacity: type.capacity }
          : { id: item.id, value: value.constant }));
      }
      if (item.kind === 'sensor') this.addSensor(item);
      if (item.kind === 'event') this.events.set(item.name, item);
      if (item.kind === 'calendar') {
        if (!['HolidayCalendar', 'WorkCalendar'].includes(item.providerType)) error(item.loc, `unsupported calendar type ${item.providerType}`);
        const descriptor = { name: item.name, type: item.providerType };
        this.calendars.set(item.name, descriptor); (this.manifest.calendars ??= []).push(descriptor);
      }
      if (item.kind === 'provider') {
        if (!['TidePredictions', 'LunarEphemeris'].includes(item.providerType)) error(item.loc, `unsupported provider type ${item.providerType}`);
        const descriptor = { name: item.name, type: item.providerType };
        this.providers.set(item.name, descriptor); (this.manifest.providers ??= []).push(descriptor);
      }
      if (item.kind === 'schedule') this.addSchedule(item);
      if (item.kind === 'objective') this.addObjective(item);
      if (item.kind === 'degraded') this.addDegraded(item);
      if (item.kind === 'adapt-setting') this.addAdaptSetting(item);
    }
    for (const item of this.ast.body) if (item.kind === 'signal') this.signalDecls.set(item.name, item);
    for (const item of this.ast.body) if (item.kind === 'signal') this.resolveSignal(item.name);
    for (const item of this.ast.body) if (item.kind === 'timer') this.declareTimer(item);
    for (const item of this.ast.body) if (item.kind === 'timer') this.resolveTimer(item.name);
    this.validateFunctionBodies();
    checkIndependent(this.ast.body.filter(item => item.kind === 'let'), item => this.addLet(item));
    checkIndependent(this.ast.body.filter(item => item.kind === 'next'), item => this.addNext(item));
    if (this.adaptPolicy) {
      const connection = this.ast.body.find(item => item.kind === 'connection');
      if (connection) error(connection.loc, 'output connections in an adaptive control belong inside each strategy');
      this.addAdapt(this.adaptPolicy);
    } else {
      checkIndependent(this.ast.body.filter(item => item.kind === 'connection'), item => this.addConnection(item));
      for (const output of this.outputs.values()) {
        if (!output.expression) error(output.loc, `output ${output.name} requires exactly one connection (${output.name} <- expression;)`);
      }
    }
    for (const item of this.ast.body) {
      if (item.kind === 'require' || item.kind === 'mutex') this.addConstraint(item);
      if (item.kind === 'local-constraints') {
        const rules = item.rules.map(rule => {
          if (rule.kind === 'mutex' && new Set(rule.names).size !== rule.names.length) error(rule.loc, 'duplicate local mutex output');
          const before = this.constraints.length;
          this.addConstraint(rule);
          return { kind: rule.kind, stage: 'safe_output', lowered: this.constraints.slice(before), source: { nodeId: rule.id, ...rule.loc } };
        });
        (this.manifest.localConstraints ??= []).push({ name: item.name, scope: 'local_output', rules,
          source: { nodeId: item.id, ...item.loc } });
      }
    }
  }
  addAdapt(item) {
    const strategyNames = new Set();
    if (!this.outputs.size) error(item.loc, 'adapt policy requires at least one output');
    for (const strategy of item.strategies) {
      rejectName(strategy.name, strategy.loc, 'strategy');
      if (strategyNames.has(strategy.name)) error(strategy.loc, `duplicate strategy ${strategy.name}`);
      strategyNames.add(strategy.name);
      if (strategy.where) error(strategy.where.loc, 'strategy where metadata predicates are not yet supported');
      const seenCapabilities = new Set(), matchedSensors = new Set();
      for (const capability of strategy.match.capabilities) {
        const key = `${capability.kind}:${capability.role}`;
        if (seenCapabilities.has(key)) error(capability.loc, `duplicate strategy capability ${key}`);
        seenCapabilities.add(key);
        if (!capability.type) error(capability.loc, 'presence-only strategy match requires host capability selection and is not yet supported');
        let declared;
        if (capability.kind === 'sensor') {
          declared = this.sensors.get(capability.role);
          if (!declared) error(capability.loc, `strategy references unknown sensor ${capability.role}`);
          if (capability.type) {
            const expected = this.resolveType(capability.type);
            if (!sameType(expected, declared.type)) error(capability.type.loc, `strategy sensor ${capability.role} must match ${declared.type.kind}`);
            capability.resolvedType = expected;
          } else capability.resolvedType = declared.type;
          matchedSensors.add(capability.role);
        } else if (capability.kind === 'actuator') {
          declared = this.outputs.get(capability.role);
          if (!declared) error(capability.loc, `strategy references unknown actuator ${capability.role}`);
          if (capability.type) {
            const expected = this.resolveType(capability.type);
            if (!sameType(expected, declared.type)) error(capability.type.loc, `strategy actuator ${capability.role} must match ${declared.type.kind}`);
            capability.resolvedType = expected;
          } else capability.resolvedType = declared.type;
        } else error(capability.loc, `unsupported strategy capability kind ${capability.kind}`);
      }
      const localValues = new Map(), intents = new Map();
      this.currentStrategy = { name: strategy.name, matchedSensors, localValues };
      for (const statement of strategy.body) {
        if (statement.kind === 'let') {
          rejectName(statement.name, statement.loc, 'strategy let');
          if (localValues.has(statement.name) || this.symbols.has(statement.name)) error(statement.loc, `duplicate strategy binding ${statement.name}`);
          const expected = statement.annotation ? this.resolveType(statement.annotation) : null;
          const value = this.expression(statement.value, localValues, { allowNext: false, strategy: strategy.name }, [], expected);
          if (expected && !sameType(value.type, expected)) error(statement.loc, `strategy let ${statement.name} must be ${expected.kind}`);
          if (containsRate(value.type)) error(statement.loc, 'Rate<Q> is expression-only and cannot be bound by let');
          localValues.set(statement.name, value);
        } else if (statement.kind === 'connection') {
          const output = this.outputs.get(statement.name);
          if (!output) error(statement.loc, `unknown output ${statement.name}`);
          if (intents.has(statement.name)) error(statement.loc, `duplicate output connection ${statement.name} in strategy ${strategy.name}`);
          const value = this.expression(statement.value, localValues, { allowNext: false, strategy: strategy.name }, [], output.type);
          if (!sameType(value.type, output.type)) typeError(statement.loc, `output ${statement.name} must be ${output.type.kind}`);
          intents.set(statement.name, value.sexpr);
        }
      }
      for (const output of this.outputs.values()) if (!intents.has(output.name)) {
        error(strategy.loc, `strategy ${strategy.name} must connect output ${output.name}`);
      }
      this.adaptStrategies.push({
        name: strategy.name, priority: strategy.priority, match: strategy.match,
        intents: [...intents.entries()],
      });
      this.manifest.strategies ??= [];
      this.manifest.strategies.push({
        name: strategy.name, priority: strategy.priority,
        match: strategy.match.always ? 'always' : strategy.match.capabilities.map(capability => ({
          role: capability.role, kind: capability.kind, type: capability.resolvedType.kind,
        })),
        outputNames: [...intents.keys()],
      });
      this.currentStrategy = null;
    }
    this.manifest.adaptPolicy = { name: item.name, selection: 'highest-priority-unique' };
  }
  addObjective(item) {
    const measure = item.measure?.kind === 'reference' ? item.measure.name : null;
    const target = item.target?.kind === 'reference' ? item.target.name : null;
    const manipulate = item.manipulate?.kind === 'member' ? item.manipulate.base : null;
    if (!measure || !this.sensors.has(measure)) error(item.measure?.loc ?? item.loc, 'objective measure must reference a declared sensor');
    if (!target || !this.symbols.has(target)) error(item.target?.loc ?? item.loc, 'objective target must reference a declared config or setting');
    if (!manipulate || !this.resources.has(manipulate)) error(item.manipulate?.loc ?? item.loc, 'objective manipulate must reference a declared ContinuousActuator');
    if (!item.outputMin || !item.outputMax || !item.controller) error(item.loc, 'objective requires measure, target, manipulate, output and controller');
    const min = this.expression(item.outputMin, new Map(), { allowNext: false }, [], PERCENT);
    const max = this.expression(item.outputMax, new Map(), { allowNext: false }, [], PERCENT);
    if (min.constant === undefined || max.constant === undefined || min.constant > max.constant) error(item.loc, 'objective output range must be a finite non-inverted Percent range');
    const fields = item.controller.fields;
    const required = item.controller.kind === 'pid' ? ['period','late_after','direction','kp','ki','kd','bias','anti_windup','disabled','transfer','fault','restart']
      : item.controller.kind === 'pi' ? ['period','late_after','direction','kp','ki','bias','anti_windup','disabled','transfer','fault','restart'] : [];
    for (const key of required) if (!fields[key]) error(item.controller.loc, `controller ${item.controller.kind} requires ${key}`);
    if (item.controller.kind !== 'pid') {
      const descriptor = { name: item.name, measure, target, manipulate, output: { min: min.constant, max: max.constant }, controller: item.controller.kind, runtime: 'requires-native-controller-binding' };
      this.objectives.set(item.name, descriptor); (this.manifest.objectives ??= []).push(descriptor);
      return;
    }
    for (const key of Object.keys(fields)) if (!required.includes(key)) error(fields[key].loc, `unsupported PID field ${key}`);
    if (min.constant !== 0) error(item.outputMin.loc, 'native Temperature PID output minimum must be 0%');
    const resource = this.ast.body.find(entry => entry.kind === 'resource' && entry.name === manipulate);
    if (resource?.type !== 'ContinuousActuator' || resource.typeArgs?.length !== 1 || resource.typeArgs[0].name !== 'Percent') {
      error(item.manipulate.loc, 'native Temperature PID manipulate must reference ContinuousActuator<Percent>.position');
    }
    const sensor = this.sensors.get(measure);
    const targetSymbol = this.symbols.get(target);
    if (sensor.type.kind !== 'Temperature' || targetSymbol.category !== 'config' || targetSymbol.payloadType?.kind !== 'Temperature') {
      error(item.loc, 'native PID objective requires Temperature measure and target');
    }
    const constant = (node, expected, label) => {
      const value = this.expression(node, new Map(), { allowNext: false }, [], expected);
      if (value.constant === undefined || !Number.isFinite(value.constant)) error(node.loc, `${label} must be a finite constant ${typeNameOf(expected)}`);
      return value.constant;
    };
    const choice = (node, allowed, label) => {
      if (node.kind !== 'reference' || !allowed.includes(node.name)) error(node.loc, `${label} must be ${allowed.join(' or ')}`);
      return node.name;
    };
    const gain = (node, name, withTime, derivative = false) => {
      if (node.kind !== 'call' || node.name !== name || node.args.length) error(node.loc, `${name} constructor is required`);
      const named = new Map();
      for (const entry of node.named) {
        if (named.has(entry.name)) error(entry.loc, `duplicate ${name} argument ${entry.name}`);
        named.set(entry.name, entry.value);
      }
      const keys = withTime ? ['output', 'error', 'time'] : ['output', 'error'];
      if (named.size !== keys.length || keys.some(key => !named.has(key))) error(node.loc, `${name} requires ${keys.join(', ')}`);
      const output = constant(named.get('output'), PERCENT, `${name} output`);
      const errorValue = constant(named.get('error'), semanticType('TemperatureDelta'), `${name} error`);
      if (output < 0 || errorValue <= 0) error(node.loc, `${name} requires nonnegative output and positive error`);
      if (!withTime) return output / errorValue;
      const timeMs = constant(named.get('time'), DURATION, `${name} time`);
      if (timeMs <= 0) error(node.loc, `${name} time must be positive`);
      const seconds = timeMs / 1000;
      return derivative ? output * seconds / errorValue : output / errorValue / seconds;
    };
    const periodMs = constant(fields.period, DURATION, 'controller period');
    const lateAfterMs = constant(fields.late_after, DURATION, 'controller late_after');
    if (periodMs <= 0 || lateAfterMs < periodMs) error(item.controller.loc, 'PID requires period > 0 and late_after >= period');
    const restart = fields.restart;
    if (restart.kind !== 'call' || restart.name !== 'reset' || restart.args.length || restart.named.length !== 1 || restart.named[0].name !== 'output') {
      error(restart.loc, 'PID restart requires reset(output: Percent)');
    }
    const restartOutput = constant(restart.named[0].value, PERCENT, 'PID restart output');
    const bias = constant(fields.bias, PERCENT, 'PID bias');
    if (bias < min.constant || bias > max.constant) error(fields.bias.loc, 'PID bias must be within the objective output range');
    if (restartOutput < min.constant || restartOutput > max.constant) error(restart.loc, 'PID restart output must be within the objective output range');
    const descriptor = {
      name: item.name, measure, target, manipulate, output: { min: min.constant, max: max.constant },
      controller: {
        kind: 'pid', periodMs, lateAfterMs,
        direction: choice(fields.direction, ['direct', 'reverse'], 'PID direction'),
        kp: gain(fields.kp, 'proportional_gain', false),
        ki: gain(fields.ki, 'integral_gain', true),
        kd: gain(fields.kd, 'derivative_gain', true, true),
        bias,
        antiWindup: choice(fields.anti_windup, ['conditional_safe'], 'PID anti_windup'),
        disabled: choice(fields.disabled, ['track_safe'], 'PID disabled'),
        transfer: choice(fields.transfer, ['track_safe'], 'PID transfer'),
        fault: choice(fields.fault, ['disable'], 'PID fault'),
        restart: { mode: 'reset', output: restartOutput },
      },
      binding: 'native-temperature-percent-v1', executable: false,
    };
    const measureSource = this.sensors.get(measure);
    const targetInput = targetSymbol.resultInputs.value;
    const targetOkInput = targetSymbol.resultInputs.ok;
    const safeMaxInput = this.generatedName('objective_safe_max', item.name);
    if (!this.gfbInputs.some(input => input[1] === `${RESERVED_PREFIX}now_ms`)) this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc);
    this.addInput(safeMaxInput, PERCENT, item.loc);
    descriptor.bindings = {
      output: `${manipulate}.position`, measure: measureSource.valueInput, measureOk: measureSource.okInput,
      target: targetInput, targetOk: targetOkInput, safeMax: safeMaxInput,
    };
    if (this.outputs.has(descriptor.bindings.output)) error(item.manipulate.loc, `objective output collides with authored output ${descriptor.bindings.output}`);
    this.manifest.outputs.push(manifestDescriptor(descriptor.bindings.output, PERCENT));
    this.objectives.set(item.name, descriptor); (this.manifest.objectives ??= []).push(descriptor);
  }
  addDegraded(item) {
    if (!this.objectives.has(item.objective) && !this.standalone) error(item.loc, `unknown degraded objective ${item.objective}`);
    if (this.objectives.get(item.objective)?.binding === 'native-temperature-percent-v1') {
      error(item.loc, 'native PID objective does not support degraded control');
    }
    if (!item.branches.length || !item.otherwise || !item.resume) error(item.loc, 'degraded policy requires at least one branch, exhaustive otherwise and resume');
    const priorities = new Set();
    const branches = item.branches.map(branch => {
      const p = this.expression(branch.priority, new Map(), { allowNext: false }, [], INT); if (!Number.isInteger(p.constant) || p.constant < -2147483648 || p.constant > 2147483647) error(branch.priority.loc, 'degraded priority must be an i32 integer');
      if (priorities.has(p.constant)) error(branch.priority.loc, 'degraded branch priorities must be unique'); priorities.add(p.constant);
      if (!this.sensors.has(branch.sensor) && !this.standalone) error(branch.loc, `unknown degraded sensor ${branch.sensor}`);
      const lo = this.expression(branch.outputMin, new Map(), { allowNext: false }, [], PERCENT); const hi = this.expression(branch.outputMax, new Map(), { allowNext: false }, [], PERCENT);
      if (lo.constant > hi.constant) error(branch.loc, 'degraded output range is inverted');
      return { name: branch.name, priority: p.constant, sensor: branch.sensor, quality: branch.quality, use: branch.use, authority: branch.authority, output: { min: lo.constant, max: hi.constant } };
    });
    this.degradedPolicies.set(item.name, { name: item.name, objective: item.objective, branches, otherwise: 'disable', resume: item.resume, runtime: 'requires-native-fallback-binding' });
    (this.manifest.degraded ??= []).push(this.degradedPolicies.get(item.name));
  }
  addAdaptSetting(item) {
    const target = this.symbols.get(item.target); if (!target || target.category !== 'config') error(item.loc, `adapt_setting target must reference a config ${item.target}`);
    for (const key of ['allowed','max_step','max_change','authority']) if (!item.fields[key]) error(item.loc, `adapt_setting requires ${key}`);
    if (item.fields.controller_transition) error(item.fields.controller_transition.loc, 'adapt_setting cannot reset controller state');
    const allowed = item.fields.allowed; if (!item.fields.allowedMax) error(allowed.loc, 'adapt_setting allowed requires a range');
    const maxChange = item.fields.max_change;
    this.adaptSettings.set(item.name, { name: item.name, target: item.target, targetId: target.id,
      targetType: typeNameOf(target.payloadType), authority: item.fields.authority.name ?? null,
      runtime: 'requires-host-settings-event-validation' });
    (this.manifest.adaptSettings ??= []).push(this.adaptSettings.get(item.name));
  }
  addSensor(item) {
    const type = this.resolveType(item.type); if (!['Bool', 'Number', 'Percent'].includes(type.kind) && !isQuantityType(type.kind)) error(item.type.loc, 'sensor type must be Bool, Number, Percent, or a physical quantity');
    const valueInput = this.generatedName('sensor_value', item.name), okInput = this.generatedName('sensor_ok', item.name);
    const faultInput = this.generatedName('sensor_fault', item.name);
    this.addInput(valueInput, type, item.loc); this.addInput(okInput, BOOL, item.loc); this.addInput(faultInput, NUMBER, item.loc);
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
    let filter = null, window = null, alpha = null;
    if (opts.filter) {
      if (!['Number', 'Percent'].includes(type.kind) && !isQuantityType(type.kind)) error(opts.filter.loc, 'numeric filtering requires a numeric sensor');
      if (opts.filter.kind !== 'call') error(opts.filter.loc, 'filter must be median(N), moving_average(N), or ema(alpha: Number)');
      const filterName = opts.filter.name;
      if (filterName === 'ema') {
        const named = new Map(opts.filter.named.map(entry => [entry.name, entry]));
        if (opts.filter.args.length || opts.filter.named.length !== 1 || !named.has('alpha')) error(opts.filter.loc, 'ema filter requires exactly ema(alpha: Number)');
        alpha = read(named.get('alpha').value, NUMBER, 'ema alpha', true);
        if (!Number.isFinite(alpha) || !(alpha > 0 && alpha <= 1)) error(opts.filter.loc, 'ema alpha must be finite and in (0, 1]');
        filter = 'ema'; window = 1;
      } else {
        if (!['median', 'moving_average'].includes(filterName) || opts.filter.args.length !== 1 || opts.filter.named.length) error(opts.filter.loc, 'filter must be median(N), moving_average(N), or ema(alpha: Number)');
        const n = read(opts.filter.args[0], NUMBER, `${filterName} window`, true);
        if (!Number.isInteger(n) || n < 1 || n > 31 || (filterName === 'median' && n % 2 === 0)) error(opts.filter.loc, `${filterName} window must be ${filterName === 'median' ? 'an odd integer' : 'an integer'} from 1 to 31`);
        filter = filterName; window = n;
      }
    }
    const staleMs = read(opts.staleAfter, DURATION, 'stale_after');
    let recoverSamples = null;
    if (opts.recoverAfter) { recoverSamples = read(opts.recoverAfter, NUMBER, 'recover_after'); if (!Number.isInteger(recoverSamples) || recoverSamples < 1 || recoverSamples > 31) error(opts.recoverAfter.loc, 'recover_after must be an integer from 1 to 31 samples'); }
    if (sampleMs !== null && sampleMs <= 0 || staleMs !== null && staleMs <= 0) error(item.loc, 'sensor durations must be positive');
    const record = manifestDescriptor(item.name, type, { sampleMs, validMin, validMax, filter, window, staleMs, recoverSamples, valueInput, okInput, faultInput });
    if (filter === 'ema') record.alpha = alpha;
    if (item.optional) record.optional = true;
    this.manifest.sensors.push(record); this.sensors.set(item.name, {
      type, valueInput, okInput, faultInput, originTag: item.id, loc: item.loc, descriptor: record,
      sampleInputs: {
        present: this.generatedName('sensor_sample_present', item.name),
        epoch: this.generatedName('sensor_sample_epoch', item.name),
        id: this.generatedName('sensor_sample_id', item.name),
        timestamp: this.generatedName('sensor_sample_timestamp', item.name),
      },
      sampleAllocated: false,
    }); this.symbols.get(item.name).type = resultType(type, semanticType('SensorFault'));
  }
  addSchedule(item) {
    if (item.scheduleType === 'At') {
      if (!item.at) error(item.loc, 'At schedule requires at');
      if (item.timezone !== null || item.policy.dst_missing || item.policy.dst_repeated) error(item.loc, 'At has no timezone or DST fields');
      const at = this.expression(item.at, new Map(), { allowNext: false });
      if (at.type.kind !== 'DateTime' || !Number.isSafeInteger(at.constant)) error(item.at.loc, 'At at must be a constant DateTime');
      if (item.policy.basis?.kind !== 'reference' || item.policy.basis.name !== 'pulse') error(item.loc, 'At executable basis requires pulse');
      return this.addCivilSchedulePolicy(item, { kind: 'at', atMs: at.constant }, false);
    }
    if (item.scheduleType === 'Solar') return this.addSolarSchedule(item);
    if (item.scheduleType === 'Tide') return this.addTideSchedule(item);
    if (item.scheduleType === 'Periodic') return this.addPeriodicSchedule(item);
    if (item.scheduleType === 'Cron') {
      if (!item.at) error(item.loc, 'Cron schedule requires at');
      const cron5 = item.at.value.slice(6, -1);
      const fields = parseCron5(cron5, item.at);
      return this.addCivilSchedulePolicy(item, { kind: 'cron', cron5, fields });
    }
    if (item.scheduleType === 'Daily') {
      if (!item.at) error(item.loc, 'Daily schedule requires at');
      const at = this.expression(item.at, new Map(), { allowNext: false });
      if (at.type.kind !== 'TimeOfDay' || at.constant === undefined) error(item.at.loc, 'Daily at must be a constant TimeOfDay');
      const day = this.resolveScheduleDay(item);
      return this.addCivilSchedulePolicy(item, { kind: 'daily', atMs: at.constant, ...(day ? { day } : {}) });
    }
    const interval = this.expression(item.interval, new Map(), { allowNext: false });
    if (!sameType(interval.type, DURATION) || interval.constant !== 900_000) error(item.interval.loc, 'only DailySlots<15min> is supported');
    if (!item.timezone || !item.timezone.trim()) error(item.loc, 'schedule requires timezone');
    if (!item.selected) error(item.loc, 'schedule requires selected slots');
    let slots = [], selectedConfig = null;
    if (!Array.isArray(item.selected)) {
      selectedConfig = item.selected.value;
      const symbol = this.symbols.get(selectedConfig);
      if (!symbol || symbol.category !== 'config' || symbol.payloadType?.kind !== 'TimeSlots') error(item.selected, 'DailySlots selected reference must name a TimeSlots config');
      if (symbol.payloadType.gridMs !== interval.constant) error(item.selected, `TimeSlots grid ${symbol.payloadType.gridMs}ms does not match DailySlots grid ${interval.constant}ms`);
      slots = symbol.value.constant.map(ms => ms / 60_000);
    } else {
      const seen = new Set();
      for (const time of item.selected) {
        const [hours, minutes] = time.value.split(':').map(Number); const minuteOfDay = hours * 60 + minutes;
        if (hours > 23 || minutes > 59 || (minuteOfDay * 60_000) % interval.constant !== 0) error(time, 'DailySlots<15min> requires a unique 15-minute HH:MM slot');
        if (seen.has(minuteOfDay)) error(time, 'duplicate schedule slot'); seen.add(minuteOfDay); slots.push(minuteOfDay);
      }
    }
    if (Object.keys(item.policy ?? {}).length) {
      return this.addCivilSchedulePolicy(item, { kind: 'daily-slots', gridMs: interval.constant, slots: slots.sort((a, b) => a - b), ...(selectedConfig ? { selectedConfig } : {}) });
    }
    const dueInput = this.generatedName('schedule_due', item.name); this.addInput(dueInput, BOOL, item.loc);
    this.manifest.schedules.push({ name: item.name, timezone: item.timezone, slots, ...(selectedConfig ? { selectedConfig, gridMs: interval.constant } : {}), dueInput }); this.schedules.set(item.name, { dueInput, loc: item.loc }); this.symbols.get(item.name).type = { kind: 'Schedule' };
  }
  resolveScheduleDay(item) {
    if (!item.on && !item.calendar) return null;
    if (!item.on) error(item.loc, 'Daily calendar requires on day rule');
    const match = /^day`([^`]+)`$/.exec(item.on.value);
    if (!match) error(item.on, 'Daily on requires a day tagged literal');
    const kind = match[1];
    if (!['holiday', 'workday', 'offday'].includes(kind)) error(item.on, 'Daily day rule currently requires holiday, workday or offday');
    if (!item.calendar) error(item.on, `Daily ${kind} rule requires calendar`);
    const calendar = this.calendars.get(item.calendar.value);
    if (!calendar) error(item.calendar, `unknown calendar ${item.calendar.value}`);
    const expected = kind === 'holiday' ? 'HolidayCalendar' : 'WorkCalendar';
    if (calendar.type !== expected) error(item.calendar, `${kind} requires ${expected}`);
    return { kind, calendar: calendar.name };
  }
  addPeriodicSchedule(item) {
    for (const field of ['every', 'anchor', 'interval_change']) {
      if (!item[field]) error(item.loc, `Periodic schedule requires ${field}`);
    }
    const config = item.every.kind === 'reference' && this.symbols.get(item.every.name)?.category === 'config'
      ? this.symbols.get(item.every.name) : null;
    const every = config ? config.value : this.expression(item.every, new Map(), { allowNext: false });
    if (!sameType(every.type, DURATION) || !Number.isSafeInteger(every.constant) || every.constant <= 0) {
      error(item.every.loc, 'Periodic every must be a positive Duration constant or config');
    }
    if (config) {
      const declaration = this.manifest.configs.find(entry => entry.id === config.id);
      if (declaration?.settings?.min !== undefined && declaration.settings.min <= 0) {
        error(item.every.loc, 'Periodic interval config minimum must be positive');
      }
    }
    const change = item.interval_change;
    if (change.kind !== 'reference' || !['preserve_anchor', 'preserve_next', 'restart_after_change'].includes(change.name)) {
      error(change.loc, 'Periodic interval_change must be preserve_anchor, preserve_next or restart_after_change');
    }
    const node = item.anchor;
    let anchor;
    if (node.kind === 'reference' && node.name === 'persisted_epoch') {
      anchor = { kind: 'persisted-epoch' };
    } else if (node.kind === 'call' && node.name === 'instant' && node.args.length === 1 && !node.named.length) {
      const value = this.expression(node.args[0], new Map(), { allowNext: false });
      if (value.type.kind !== 'DateTime' || value.constant === undefined) error(node.loc, 'Periodic instant anchor requires constant DateTime');
      anchor = { kind: 'instant', instantMs: value.constant };
    } else if (node.kind === 'call' && node.name === 'civil' && node.args.length === 2 && !node.named.length) {
      const date = this.expression(node.args[0], new Map(), { allowNext: false });
      const time = this.expression(node.args[1], new Map(), { allowNext: false });
      if (date.type.kind !== 'Date' || time.type.kind !== 'TimeOfDay' || date.constant === undefined || time.constant === undefined) {
        error(node.loc, 'Periodic civil anchor requires constant Date and TimeOfDay');
      }
      anchor = { kind: 'civil', date: new Date(date.constant * 86400000).toISOString().slice(0, 10), timeMs: time.constant };
    } else {
      error(node.loc, 'Periodic anchor requires instant(DateTime), civil(Date, TimeOfDay) or persisted_epoch');
    }
    if (anchor.kind !== 'civil' && (item.timezone !== null || item.policy.dst_missing || item.policy.dst_repeated)) {
      error(item.loc, 'Periodic timezone and DST policies require a civil anchor');
    }
    const interval = { expression: config ? item.every.name : every.sexpr, initialMs: every.constant };
    if (config) { interval.config = item.every.name; interval.configId = config.id; }
    return this.addCivilSchedulePolicy(item, { kind: 'periodic', every: interval,
      anchor, intervalChange: change.name }, anchor.kind === 'civil');
  }
  addCivilSchedulePolicy(item, trigger, civil = true) {
      const label = item.scheduleType;
      if (civil) {
        if (!item.timezone || !item.timezone.trim()) error(item.loc, `${label} schedule requires timezone`);
        try { new Intl.DateTimeFormat('en-US', { timeZone: item.timezone }); }
        catch { error(item.loc, `${label} timezone must be a supported IANA timezone`); }
      }
      const options = item.policy;
      for (const name of [...(civil ? ['dst_missing', 'dst_repeated'] : []), 'basis', 'when', 'clock', 'gap', 'recovery', 'fallback']) {
        if (!options[name]) error(item.loc, `${label} schedule requires ${name}`);
      }
      const choice = (name, choices) => {
        const value = options[name];
        if (value.kind !== 'reference' || !choices.includes(value.name)) error(value.loc, `${label} ${name} must be ${choices.join(' or ')}`);
        return value.name;
      };
      const civilPolicy = civil ? {
        timezone: item.timezone,
        dstMissing: choice('dst_missing', ['skip', 'next_valid']),
        dstRepeated: choice('dst_repeated', ['first', 'second', 'both', 'skip']),
      } : {};
      let basis;
      if (options.basis.kind === 'reference' && options.basis.name === 'pulse') {
        if (options.cancel_when) error(options.cancel_when.loc, `${label} pulse basis does not use cancel_when`);
        basis = 'pulse';
      } else if (options.basis.kind === 'call' && options.basis.name === 'range'
        && options.basis.args.length === 1 && !options.basis.named.length) {
        const range = this.expression(options.basis.args[0], new Map(), { allowNext: false }, [], DURATION);
        if (!sameType(range.type, DURATION) || !Number.isSafeInteger(range.constant) || range.constant <= 0) {
          error(options.basis.loc, `${label} range requires a positive Duration`);
        }
        if (!options.cancel_when) error(item.loc, `${label} range basis requires cancel_when`);
        if (civil && (trigger.kind === 'periodic' || item.timezone !== 'UTC')) {
          error(options.basis.loc, `${label} range recurrence non-overlap cannot be proved for this civil timezone or anchor`);
        }
        let minimumSpacing;
        if (trigger.kind === 'daily-slots') {
          const starts = trigger.slots.map(minutes => minutes * 60_000);
          minimumSpacing = starts.length === 1 ? 86_400_000 : Math.min(...starts.map((start, index) => {
            const next = starts[(index + 1) % starts.length] + (index + 1 === starts.length ? 86_400_000 : 0);
            return next - start;
          }));
        } else if (trigger.kind === 'daily') minimumSpacing = 86_400_000;
        else if (trigger.kind === 'periodic') minimumSpacing = trigger.every.initialMs;
        else error(options.basis.loc, `${label} range requires a statically bounded recurrence`);
        if (range.constant > minimumSpacing) error(options.basis.loc, `${label} range occurrences must not overlap`);
        if (trigger.day && (trigger.day.kind === 'holiday' || trigger.atMs + range.constant > 86_400_000)) {
          error(options.basis.loc, 'work calendar Range must stay within one civil date; split overnight intervals into explicit Daily ranges');
        }
        basis = { kind: 'range', durationMs: range.constant };
      } else error(options.basis.loc, `${label} basis must be pulse or range(positive Duration)`);
      const clock = choice('clock', ['trusted_only']);
      const recovery = choice('recovery', ['baseline']);
      const fallback = choice('fallback', ['skip']);
      const gap = options.gap;
      if (gap.kind !== 'call' || gap.name !== 'skip_after' || gap.args.length !== 1 || gap.named.length) {
        error(gap.loc, `${label} gap requires skip_after(positive constant Duration)`);
      }
      const duration = this.expression(gap.args[0], new Map(), { allowNext: false }, [], DURATION);
      if (!sameType(duration.type, DURATION) || !Number.isSafeInteger(duration.constant) || duration.constant <= 0) {
        error(gap.loc, `${label} gap requires skip_after(positive constant Duration)`);
      }
      const predicate = this.expression(options.when, new Map(), { allowNext: false });
      if (!sameType(predicate.type, BOOL)) error(options.when.loc, `${label} when must be Bool`);
      let cancelWhen;
      if (options.cancel_when) {
        const cancel = this.expression(options.cancel_when, new Map(), { allowNext: false });
        if (!sameType(cancel.type, BOOL)) error(options.cancel_when.loc, `${label} cancel_when must be Bool`);
        cancelWhen = cancel.sexpr;
      }
      const slot = this.configStreams.length + (this.configStreams.length && this.hasSolarSchedule
        ? this.manifest.schedules.length
        : this.manifest.schedules.filter(schedule => ['at', 'solar', 'daily', 'daily-slots', 'periodic', 'cron'].includes(schedule.kind)).length);
      this.manifest.schedules.push({
        ...trigger, site: item.id, name: item.name, ...civilPolicy,
        policy: { basis, when: predicate.sexpr, ...(cancelWhen === undefined ? {} : { cancelWhen }),
          clock, gapMs: duration.constant, recovery, fallback },
      });
      this.schedules.set(item.name, { slot, loc: item.loc });
      this.symbols.get(item.name).type = { kind: 'Schedule' };
      if (isExecutablePulseSchedule(item) || isExecutableRangeSchedule(item)) {
        if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
        if (!this.gfbInputs.some(input => input[1] === `${RESERVED_PREFIX}time_epoch`)) this.addInput(`${RESERVED_PREFIX}time_epoch`, NUMBER, item.loc);
        this.schedules.set(item.name, { slot, loc: item.loc, projections: new Set(isExecutableRangeSchedule(item) ? ['due', 'active'] : ['due', 'missed']) });
      }
  }
  addSolarSchedule(item) {
    for (const field of ['timezone', 'latitude', 'longitude', 'at', 'fallback']) {
      if (item[field] === null) error(item.loc, `Solar schedule requires ${field}`);
    }
    if (!item.timezone.trim()) error(item.loc, 'Solar schedule requires a non-empty timezone');
    try { new Intl.DateTimeFormat('en-US', { timeZone: item.timezone }); }
    catch { error(item.loc, 'Solar timezone must be a supported IANA timezone'); }
    const policy = this.naturalSchedulePolicy(item, false);
    if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
    if (!this.gfbInputs.some(input => input[1] === `${RESERVED_PREFIX}time_epoch`)) this.addInput(`${RESERVED_PREFIX}time_epoch`, NUMBER, item.loc);
    const slot = this.configStreams.length ? this.configStreams.length + this.manifest.schedules.length
      : this.manifest.schedules.filter(schedule => ['solar', 'daily'].includes(schedule.kind)).length;
    this.manifest.format = 'GhostFlow/control-v3';
    this.manifest.schedules.push({
      kind: 'solar', site: item.id, name: item.name, timezone: item.timezone,
      latitude: item.latitude, longitude: item.longitude,
      event: item.at.event, offsetMs: item.at.offsetMs, policy,
    });
    this.schedules.set(item.name, { slot, loc: item.loc, projections: new Set(['due', 'missed']) });
    this.symbols.get(item.name).type = { kind: 'Schedule' };
  }
  addTideSchedule(item) {
    for (const field of ['source', 'timezone', 'at']) if (!item[field]) error(item.loc, `Tide schedule requires ${field}`);
    const provider = this.providers.get(item.source.value);
    if (!provider || provider.type !== 'TidePredictions') error(item.source, 'Tide source must name a TidePredictions provider');
    if (!item.timezone.trim()) error(item.loc, 'Tide schedule requires a non-empty timezone');
    try { new Intl.DateTimeFormat('en-US', { timeZone: item.timezone }); }
    catch { error(item.loc, 'Tide timezone must be a supported IANA timezone'); }
    const policy = this.naturalSchedulePolicy(item, true);
    if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
    if (!this.gfbInputs.some(input => input[1] === `${RESERVED_PREFIX}time_epoch`)) this.addInput(`${RESERVED_PREFIX}time_epoch`, NUMBER, item.loc);
    const slot = this.configStreams.length + this.manifest.schedules.length;
    this.manifest.schedules.push({
      kind: 'tide', site: item.id, name: item.name, source: provider.name, timezone: item.timezone,
      event: item.at.event, offsetMs: item.at.offsetMs, policy,
    });
    this.schedules.set(item.name, { slot, loc: item.loc, projections: new Set(['due', 'active']) });
    this.symbols.get(item.name).type = { kind: 'Schedule' };
  }
  naturalSchedulePolicy(item, allowRun) {
    const label = item.scheduleType, options = item.policy ?? {};
    // Syntax-diagnostic fixtures intentionally use a minimal valid schedule
    // shell. Full policy requirements are checked when emitting bytecode or
    // through the public type-check API.
    if ((this.syntaxOnly && Object.keys(options).length < 6)
      || (!this.syntaxOnly && Object.keys(options).length === 1 && options.fallback)) {
      return { basis: 'pulse', when: 'true', clock: 'trusted_only', gapMs: 1, recovery: 'baseline', fallback: 'skip' };
    }
    for (const name of ['basis', 'when', 'clock', 'gap', 'recovery', 'fallback']) {
      if (!options[name]) error(item.loc, `${label} schedule requires ${name}`);
    }
    const choice = (name, values) => {
      const value = options[name];
      if (value.kind !== 'reference' || !values.includes(value.name)) error(value.loc, `${label} ${name} must be ${values.join(' or ')}`);
      return value.name;
    };
    let basis;
    if (options.basis.kind === 'reference' && options.basis.name === 'pulse') basis = 'pulse';
    else if (allowRun && options.basis.kind === 'call' && options.basis.name === 'run'
      && options.basis.args.length === 2 && !options.basis.named.length) {
      const length = this.expression(options.basis.args[0], new Map(), { allowNext: false }, [], DURATION);
      const admission = options.basis.args[1];
      if (!sameType(length.type, DURATION) || length.constant <= 0 || admission.kind !== 'call'
        || admission.name !== 'within' || admission.args.length !== 1 || admission.named.length) {
        error(options.basis.loc, 'Tide run basis requires run(positive Duration, within(positive Duration))');
      }
      const within = this.expression(admission.args[0], new Map(), { allowNext: false }, [], DURATION);
      if (!sameType(within.type, DURATION) || within.constant <= 0) error(admission.loc, 'Tide within requires a positive Duration');
      basis = { kind: 'run', durationMs: length.constant, admission: { kind: 'within', durationMs: within.constant } };
    } else error(options.basis.loc, `${label} basis must be ${allowRun ? 'pulse or run(Duration, within(Duration))' : 'pulse'}`);
    const predicate = this.expression(options.when, new Map(), { allowNext: false });
    if (!sameType(predicate.type, BOOL)) error(options.when.loc, `${label} when must be Bool`);
    const gap = options.gap;
    if (gap.kind !== 'call' || gap.name !== 'skip_after' || gap.args.length !== 1 || gap.named.length) error(gap.loc, `${label} gap requires skip_after(positive constant Duration)`);
    const gapDuration = this.expression(gap.args[0], new Map(), { allowNext: false }, [], DURATION);
    if (!sameType(gapDuration.type, DURATION) || gapDuration.constant <= 0) error(gap.loc, `${label} gap requires skip_after(positive constant Duration)`);
    const result = { basis, when: predicate.sexpr };
    if (options.cancel_when) {
      const cancel = this.expression(options.cancel_when, new Map(), { allowNext: false });
      if (!sameType(cancel.type, BOOL)) error(options.cancel_when.loc, `${label} cancel_when must be Bool`);
      result.cancelWhen = cancel.sexpr;
    }
    const terminalCall = (node, name) => {
      if (node.kind !== 'call' || node.name !== name || node.args.length !== 1
        || node.named.length !== 1 || node.named[0].name !== 'terminal'
        || node.named[0].value.kind !== 'reference' || node.named[0].value.name !== 'skip') {
        error(node.loc, `${label} ${name} requires one argument and terminal: skip`);
      }
    };
    let clock, fallback;
    if (options.clock.kind === 'call' && options.clock.name === 'hold_trusted') {
      terminalCall(options.clock, 'hold_trusted');
      const duration = this.expression(options.clock.args[0], new Map(), { allowNext: false }, [], DURATION);
      if (!sameType(duration.type, DURATION) || !Number.isSafeInteger(duration.constant) || duration.constant <= 0)
        error(options.clock.loc, `${label} hold_trusted requires a positive constant Duration`);
      clock = { kind: 'hold_trusted', durationMs: duration.constant, terminal: 'skip' };
    } else clock = choice('clock', ['trusted_only']);
    if (label === 'Solar' && options.fallback.kind === 'call' && options.fallback.name === 'fixed_time') {
      terminalCall(options.fallback, 'fixed_time');
      const node = options.fallback.args[0];
      if (node.kind !== 'literal' || !node.raw?.startsWith('time`'))
        error(node.loc, 'Solar fixed_time requires a TimeOfDay literal');
      const at = this.expression(node, new Map(), { allowNext: false });
      if (at.type.kind !== 'TimeOfDay') error(node.loc, 'Solar fixed_time requires a TimeOfDay literal');
      fallback = { kind: 'fixed_time', atMs: at.constant, terminal: 'skip' };
    } else fallback = choice('fallback', ['skip']);
    return { ...result, clock, gapMs: gapDuration.constant,
      recovery: choice('recovery', ['baseline']), fallback };
  }
  resolveSignal(name) {
    if (this.signals.has(name)) return this.signals.get(name);
    const item = this.signalDecls.get(name);
    if (!item) internal(`missing signal declaration ${name}`);
    if (this.resolvingSignals.has(name)) error(item.loc, `cyclic signal dependency involving ${name}`);
    this.resolvingSignals.add(name);
    try { this.addSignal(item); }
    finally { this.resolvingSignals.delete(name); }
    return this.signals.get(name);
  }
  addSignal(item) {
    const call = item.call;
    if (call.kind === 'call' && call.name === 'ema') return this.addEmaSignal(item, call);
    if (call.kind === 'call' && ['window_average', 'window_min', 'window_max', 'window_rate'].includes(call.name)) return this.addWindowSignal(item, call);
    if (call.kind === 'call' && call.name === 'debounce') return this.addDebounceSignal(item, call);
    if (call.kind === 'call' && call.name === 'hold_last') return this.addHoldLastSignal(item, call);
    if (call.kind === 'call' && call.name === 'true_for') return this.addTrueForSignal(item, call);
    if (call.kind === 'call' && call.name === 'after_event') return this.addAfterEventSignal(item, call);
    if (call.kind !== 'call' || call.name !== 'hysteresis' || call.args.length !== 1 || call.named.length !== 3) error(call.loc, 'signal requires hysteresis(sensor, on_below:, off_above:, initial:)');
    const sensorRef = call.args[0]; if (sensorRef.kind !== 'reference' || !this.sensors.has(sensorRef.name)) error(sensorRef.loc, 'hysteresis first argument must be a declared sensor');
    const sensor = this.sensors.get(sensorRef.name); const named = new Map(call.named.map(x => [x.name, x]));
    if (!['Number', 'Percent'].includes(sensor.type.kind) && !isQuantityType(sensor.type.kind)) error(sensorRef.loc, 'hysteresis requires a numeric sensor');
    if (named.size !== 3 || !named.has('on_below') || !named.has('off_above') || !named.has('initial')) error(call.loc, 'hysteresis requires on_below, off_above, and initial');
    const below = this.expression(named.get('on_below').value, new Map(), { allowNext: false }, [], sensor.type);
    const above = this.expression(named.get('off_above').value, new Map(), { allowNext: false }, [], sensor.type);
    const initial = this.expression(named.get('initial').value, new Map(), { allowNext: false });
    if (!sameType(below.type, sensor.type) || below.constant === undefined || !sameType(above.type, sensor.type) || above.constant === undefined) error(call.loc, 'hysteresis thresholds must be constant sensor values');
    if (below.constant >= above.constant) error(call.loc, 'hysteresis on_below must be less than off_above');
    if (!sameType(initial.type, BOOL) || initial.constant === undefined) error(call.loc, 'hysteresis initial must be a Bool constant');
    const valueInput = this.generatedName('signal_value', item.name), okInput = this.generatedName('signal_ok', item.name), faultInput = this.generatedName('signal_fault', item.name);
    this.addInput(valueInput, BOOL, item.loc); this.addInput(okInput, BOOL, item.loc); this.addInput(faultInput, NUMBER, item.loc);
    this.manifest.signals.push({ name: item.name, sensor: sensorRef.name, onBelow: below.constant, offAbove: above.constant, initial: initial.constant, valueInput, okInput, faultInput });
    const sample = this.sensorSample(sensorRef.name);
    this.signals.set(item.name, { type: BOOL, valueInput, okInput, faultInput, originTag: item.id, loc: item.loc, sample }); this.symbols.get(item.name).type = resultType(BOOL, semanticType('SensorFault'));
  }
  addEmaSignal(item, call) {
    if (call.args.length !== 1 || call.named.length !== 1 || call.named[0].name !== 'alpha') {
      error(call.loc, 'ema signal requires ema(source, alpha: Number)');
    }
    const source = this.expression(call.args[0], new Map(), { allowNext: false });
    if (source.type.kind !== 'Result' || source.type.error.kind !== 'SensorFault'
        || (!['Number', 'Percent'].includes(source.type.value.kind) && !isQuantityType(source.type.value.kind))) {
      error(call.args[0].loc, 'ema source must be numeric Result<T, SensorFault>');
    }
    const alpha = this.expression(call.named[0].value, new Map(), { allowNext: false }, [], NUMBER);
    if (!sameType(alpha.type, NUMBER) || alpha.constant === undefined || !Number.isFinite(alpha.constant)
        || !(alpha.constant > 0 && alpha.constant <= 1)) error(call.loc, 'ema alpha must be finite and in (0, 1]');
    const sample = source.sample ?? scanSample();
    if (sample.sources.length !== 1) error(call.loc, 'ema signal requires exactly one physical sample lineage');
    if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
    for (const root of sample.sources) this.allocateSampleRoot(root);
    const payloadType = source.type.value;
    const states = Object.fromEntries(['ready', 'value', 'lastSourceTag'].map(role => [role,
      this.generatedName(`ema_${role.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`, item.name)]));
    this.addState(states.ready, BOOL, false, item.loc);
    this.addState(states.value, payloadType, defaultLowered(payloadType).constant ?? 0, item.loc);
    this.addState(states.lastSourceTag, NUMBER, 0, item.loc);
    const sources = sample.sources.map(root => {
      const rootStates = { lastEpoch: `${RESERVED_PREFIX}ema_source_epoch_${item.name}_${root.tag}`,
        lastId: `${RESERVED_PREFIX}ema_source_id_${item.name}_${root.tag}` };
      this.addState(rootStates.lastEpoch, NUMBER, 0, item.loc); this.addState(rootStates.lastId, NUMBER, -1, item.loc);
      return { ...root, states: rootStates };
    });
    const observations = sources.map(root => {
      const inputs = this.sensors.get(root.name).sampleInputs;
      const epoch = `input.${inputs.epoch}`, id = `input.${inputs.id}`, present = `input.${inputs.present}`;
      const epochChanged = ['not', ['eq', epoch, `state.${root.states.lastEpoch}`]];
      const newer = ['and', present, ['or', epochChanged, ['gt', id, `state.${root.states.lastId}`]]];
      const selected = ['eq', sample.sourceTag, numberAtom(root.tag)];
      return { root, epoch, id, newer, fresh: ['and', selected, newer],
        changed: ['and', selected, ['and', present, epochChanged]] };
    });
    const any = values => values.reduce((left, right) => ['or', left, right], 'false');
    const fresh = any(observations.map(observation => observation.fresh));
    const changed = ['or', ['not', ['eq', sample.sourceTag, `state.${states.lastSourceTag}`]],
      any(observations.map(observation => observation.changed))];
    const readyBefore = ['and', `state.${states.ready}`, ['not', changed]];
    const weighted = ['add', ['mul', numberAtom(alpha.constant), source.value],
      ['mul', numberAtom(1 - alpha.constant), `state.${states.value}`]];
    const value = ['if', source.ok, ['if', fresh,
      ['if', readyBefore, weighted, source.value], ['if', readyBefore, `state.${states.value}`, '0']], '0'];
    const ready = ['and', source.ok, ['or', fresh, readyBefore]];
    const next = { ready, value, lastSourceTag: sample.sourceTag };
    const sourceNext = observations.flatMap(({ root, epoch, id, newer }) => [
      [root.states.lastEpoch, ['if', newer, epoch, `state.${root.states.lastEpoch}`]],
      [root.states.lastId, ['if', newer, id, `state.${root.states.lastId}`]],
    ]);
    const descriptor = { kind: 'ema', name: item.name, payloadType: payloadType.kind, errorType: 'SensorFault',
      alpha: alpha.constant, sourceMode: 'sample', clockInput: `${RESERVED_PREFIX}now_ms`, sources, states };
    const lowered = { ...source, value, ok: ready,
      faultCode: ['if', source.ok, '3', source.faultCode],
      originTag: ['if', source.ok, numberAtom(item.id), source.originTag],
      origins: [...(source.origins ?? []), { tag: item.id, nodeId: item.id, kind: 'signal', name: item.name }], sample };
    this.manifest.signals.push(descriptor);
    this.signals.set(item.name, { type: payloadType, lowered, descriptor, states, next, sourceNext, originTag: item.id, loc: item.loc });
    this.symbols.get(item.name).type = lowered.type;
    for (const [role, name] of Object.entries(states)) this.generatedSignals.push({ node: item, role, name });
    for (const root of sources) this.generatedSignals.push(
      { node: item, role: 'sourceEpoch', name: root.states.lastEpoch, sourceTag: root.tag },
      { node: item, role: 'sourceId', name: root.states.lastId, sourceTag: root.tag });
  }
  addAfterEventSignal(item, call) {
    const named = new Map();
    for (const entry of call.named) {
      if (named.has(entry.name)) error(entry.loc, `duplicate after_event argument ${entry.name}`);
      named.set(entry.name, entry);
    }
    if (call.args.length !== 2 || named.size !== 2 || !named.has('window') || !named.has('quality')) {
      error(call.loc, 'after_event requires after_event(event, predicate, window: Duration, quality: measured)');
    }
    const eventRef = call.args[0];
    const event = eventRef.kind === 'reference' ? this.events.get(eventRef.name) : undefined;
    if (!event) error(eventRef.loc, 'after_event first argument must be a declared Event');
    const predicateRef = call.args[1];
    const sensor = predicateRef.kind === 'reference' ? this.sensors.get(predicateRef.name) : undefined;
    if (!sensor || !sameType(sensor.type, BOOL)) {
      error(predicateRef.loc, 'after_event predicate must be a directly declared Bool sensor');
    }
    const quality = named.get('quality').value;
    if (quality.kind !== 'reference' || quality.name !== 'measured') error(quality.loc, 'after_event quality must be measured');
    const windowNode = named.get('window').value;
    let window;
    try { window = this.expression(windowNode, new Map(), { allowNext: false }, [], DURATION); }
    catch (cause) {
      if (cause instanceof ControlCompileError && /Duration constant must be a non-negative integer number of milliseconds$/.test(cause.message)) {
        error(windowNode.loc, 'after_event window must be a positive constant Duration');
      }
      throw cause;
    }
    if (!sameType(window.type, DURATION) || window.constant === undefined || window.constant <= 0) {
      error(windowNode.loc, 'after_event window must be a positive constant Duration');
    }
    const descriptor = {
      kind: 'after-event', name: item.name, site: item.id,
      payloadType: 'Bool', errorType: 'SensorFault', quality: 'measured', windowMs: window.constant,
      event: { name: event.name, tag: event.id }, predicate: { name: predicateRef.name, tag: sensor.originTag },
    };
    this.afterEvents.push({ call, descriptor });
    this.manifest.signals.push(descriptor);
    // The public compiler rejects this signal before bytecode emission. These
    // inert projections permit type checking of downstream Result expressions.
    const lowered = { type: resultType(BOOL, semanticType('SensorFault')),
      ok: 'false', value: 'false', faultCode: '3', originTag: numberAtom(item.id), origins: [] };
    this.signals.set(item.name, { type: BOOL, lowered, descriptor, originTag: item.id, loc: item.loc });
    this.symbols.get(item.name).type = lowered.type;
  }
  addTrueForSignal(item, call) {
    const named = new Map();
    for (const entry of call.named) {
      if (named.has(entry.name)) error(entry.loc, `duplicate true_for argument ${entry.name}`);
      named.set(entry.name, entry);
    }
    if (call.args.length !== 1 || named.size !== 2 || !named.has('duration') || !named.has('quality')) {
      error(call.loc, 'true_for requires true_for(source, duration: Duration, quality: measured)');
    }
    const quality = named.get('quality').value;
    if (quality.kind !== 'reference' || quality.name !== 'measured') error(quality.loc, 'true_for quality must be measured');
    const source = call.args[0];
    const sensor = source.kind === 'reference' ? this.sensors.get(source.name) : undefined;
    if (!sensor || !sameType(sensor.type, BOOL)) error(source.loc, 'true_for source must be a directly declared Bool sensor with certified intervals');
    let duration;
    try { duration = this.expression(named.get('duration').value, new Map(), { allowNext: false }, [], DURATION); }
    catch (cause) {
      if (cause instanceof ControlCompileError && /Duration constant must be a non-negative integer number of milliseconds$/.test(cause.message)) {
        error(named.get('duration').value.loc, 'true_for duration must be a positive constant Duration');
      }
      throw cause;
    }
    if (!sameType(duration.type, DURATION) || duration.constant === undefined || duration.constant <= 0) {
      error(named.get('duration').value.loc, 'true_for duration must be a positive constant Duration');
    }
    if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
    if (!this.gfbInputs.some(input => input[1] === `${RESERVED_PREFIX}time_epoch`)) this.addInput(`${RESERVED_PREFIX}time_epoch`, NUMBER, item.loc);
    if (!sensor.intervalInputs) {
      sensor.intervalInputs = Object.fromEntries(['present', 'epoch', 'id', 'start', 'end', 'value', 'quality', 'fault'].map(field => {
        const name = this.generatedName(`interval_${field}`, source.name);
        this.addInput(name, ['present', 'value'].includes(field) ? BOOL : NUMBER, item.loc);
        return [field, name];
      }));
    }
    const slot = this.trueFors.length;
    const descriptor = {
      kind: 'true-for', name: item.name, site: item.id, slot,
      payloadType: 'Bool', errorType: 'SensorFault', quality: 'measured', durationMs: duration.constant,
      clockInput: `${RESERVED_PREFIX}now_ms`, timeEpochInput: `${RESERVED_PREFIX}time_epoch`,
      sources: [{ name: source.name, tag: sensor.originTag }], intervalInputs: sensor.intervalInputs,
    };
    const read = field => ['true-for-read', String(slot), field];
    const lowered = {
      type: resultType(BOOL, semanticType('SensorFault')), ok: read('ok'), value: read('value'),
      faultCode: read('fault'), originTag: read('origin'),
      origins: [{ tag: item.id, nodeId: item.id, kind: 'signal', name: item.name }],
    };
    this.trueFors.push({ item, descriptor });
    this.manifest.signals.push(descriptor); this.manifest.format = 'GhostFlow/control-v4';
    this.signals.set(item.name, { type: BOOL, lowered, descriptor, originTag: item.id, loc: item.loc });
    this.symbols.get(item.name).type = lowered.type;
  }
  sensorSample(name) {
    const sensor = this.sensors.get(name); if (!sensor) internal(`missing sensor ${name}`);
    const inputs = sensor.sampleInputs;
    return {
      sourceTag: numberAtom(sensor.originTag), present: `input.${inputs.present}`,
      epoch: `input.${inputs.epoch}`, id: `input.${inputs.id}`, timestamp: `input.${inputs.timestamp}`,
      quality: '1',
      sources: [{ name, tag: sensor.originTag }],
    };
  }
  allocateSampleRoot(source) {
    const sensor = this.sensors.get(source.name);
    if (!sensor || sensor.originTag !== source.tag) internal(`invalid debounce sample root ${source.name}`);
    if (sensor.sampleAllocated) return;
    const inputs = sensor.sampleInputs;
    this.addInput(inputs.present, BOOL, sensor.loc); this.addInput(inputs.epoch, NUMBER, sensor.loc);
    this.addInput(inputs.id, NUMBER, sensor.loc); this.addInput(inputs.timestamp, NUMBER, sensor.loc);
    Object.assign(sensor.descriptor, {
      samplePresentInput: inputs.present, sampleEpochInput: inputs.epoch,
      sampleIdInput: inputs.id, sampleTimestampInput: inputs.timestamp,
    });
    sensor.sampleAllocated = true;
  }
  addWindowSignal(item, call) {
    const operation = call.name.slice('window_'.length);
    const named = new Map();
    for (const entry of call.named) {
      if (named.has(entry.name)) error(entry.loc, `duplicate ${call.name} argument ${entry.name}`);
      named.set(entry.name, entry);
    }
    if (call.args.length !== 1 || call.named.length !== 3 || !named.has('over') || !named.has('quality') || !named.has('max_age')) {
      error(call.loc, `${call.name} requires ${call.name}(source, over: Duration, quality: measured, max_age: Duration)`);
    }
    const quality = named.get('quality');
    if (quality.value.kind !== 'reference' || quality.value.name !== 'measured') error(quality.value.loc, `${call.name} quality must be measured`);
    const duration = label => {
      const entry = named.get(label);
      const value = this.expression(entry.value, new Map(), { allowNext: false }, [], DURATION);
      if (!sameType(value.type, DURATION) || value.constant === undefined || value.constant <= 0) error(entry.value.loc, `${call.name} ${label} must be a positive constant Duration`);
      return value.constant;
    };
    const overMs = duration('over'), maxAgeMs = duration('max_age');
    const source = this.expression(call.args[0], new Map(), { allowNext: false });
    if (source.type.kind !== 'Result' || source.type.error.kind !== 'SensorFault') {
      error(call.args[0].loc, operation === 'rate'
        ? 'window_rate source must be Result of a supported linear physical quantity'
        : `${call.name} source must be Result<ordered numeric or physical quantity, SensorFault>`);
    }
    const inputType = source.type.value;
    const aggregateKinds = new Set(['Int', 'Number', 'Percent', ...QUANTITY_TYPES]);
    const rateKinds = new Set(['Temperature', 'TemperatureDelta', 'Pressure', 'VaporPressureDeficit', 'FlowRate', 'Volume', 'Length', 'Irradiance', 'PPFD', 'Energy', 'Power', 'ElectricalCurrent', 'Voltage', 'Conductivity']);
    if (operation === 'rate' ? !rateKinds.has(inputType.kind) : !aggregateKinds.has(inputType.kind)) {
      error(call.args[0].loc, operation === 'rate'
        ? 'window_rate source must be Result of a supported linear physical quantity'
        : `${call.name} source must be Result<ordered numeric or physical quantity, SensorFault>`);
    }
    const sample = source.sample ?? scanSample();
    if (!sample.sources.length) error(call.args[0].loc, `${call.name} measured source requires physical sample lineage`);
    if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
    if (!this.gfbInputs.some(input => input[1] === `${RESERVED_PREFIX}time_epoch`)) this.addInput(`${RESERVED_PREFIX}time_epoch`, NUMBER, item.loc);
    for (const root of sample.sources) {
      this.allocateSampleRoot(root);
      const sensor = this.sensors.get(root.name);
      this.temporalRoots.set(root.tag, { name: root.name, tag: root.tag, inputs: sensor.sampleInputs });
    }
    const outputType = operation === 'rate' ? rateType(inputType) : operation === 'average' && inputType.kind === 'Int' ? NUMBER : inputType;
    const payload = operation === 'average' && inputType.kind === 'Int' ? ['int-to-number', source.value] : source.value;
    const slot = this.windows.length;
    const sources = sample.sources.map(({ name, tag }) => ({ name, tag })).sort((left, right) => left.tag - right.tag);
    const upstreamWindows = [...evidenceWindows(source.evidence).values()]
      .map(({ name, site, slot: upstreamSlot }) => ({ name, site, slot: upstreamSlot }))
      .sort((left, right) => left.slot - right.slot);
    const descriptor = { kind: 'window', name: item.name, site: item.id, slot, operation, payloadType: typeNameOf(outputType), errorType: 'SensorFault', quality: 'measured', overMs, maxAgeMs,
      clockInput: `${RESERVED_PREFIX}now_ms`, timeEpochInput: `${RESERVED_PREFIX}time_epoch`, sources,
      ...(upstreamWindows.length ? { upstreamWindows } : {}) };
    this.windows.push({ descriptor, item, inputType, outputType, source: { ...source, value: payload }, sample });
    this.manifest.signals.push(descriptor); this.manifest.format = 'GhostFlow/control-v4';
    const selfOrigin = { tag: item.id, nodeId: item.id, kind: 'signal', name: item.name };
    const loweredSample = {
      sourceTag: numberAtom(item.id), present: ['window-read', String(slot), 'ok'], epoch: '0',
      id: ['window-read', String(slot), 'revision'], timestamp: ['window-read', String(slot), 'timestamp'],
      quality: ['window-read', String(slot), 'quality'], sources,
    };
    const lowered = {
      type: resultType(outputType, semanticType('SensorFault')), ok: ['window-read', String(slot), 'ok'], value: ['window-read', String(slot), 'value'],
      faultCode: ['window-read', String(slot), 'fault'], originTag: ['window-read', String(slot), 'origin'],
      origins: [...new Map([...(source.origins ?? []), selfOrigin].map(origin => [origin.tag, origin])).values()], sample: loweredSample,
      evidence: { kind: 'window', slot, site: item.id, name: item.name },
    };
    this.signals.set(item.name, { type: outputType, lowered, descriptor, originTag: item.id, loc: item.loc });
    this.symbols.get(item.name).type = lowered.type;
  }
  addDebounceSignal(item, call) {
    const named = new Map();
    for (const entry of call.named) {
      if (named.has(entry.name)) error(entry.loc, `duplicate debounce argument ${entry.name}`);
      named.set(entry.name, entry);
    }
    if (call.args.length !== 1 || call.named.length !== 2 || !named.has('stable_for') || !named.has('initial')) {
      error(call.loc, 'debounce requires debounce(source, stable_for: Duration, initial: value)');
    }
    if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
    const source = this.expression(call.args[0], new Map(), { allowNext: false });
    const resultSource = source.type.kind === 'Result';
    const payloadType = resultSource ? source.type.value : source.type;
    const members = this.types.get(payloadType.kind);
    const finiteEnum = Boolean(members);
    if (payloadType.kind !== 'Bool' && !finiteEnum) error(call.args[0].loc, 'debounce source must be Bool or a named finite enum');
    const stableFor = this.expression(named.get('stable_for').value, new Map(), { allowNext: false }, [], DURATION);
    if (!sameType(stableFor.type, DURATION) || stableFor.constant === undefined || stableFor.constant <= 0) error(named.get('stable_for').loc, 'debounce stable_for must be a positive constant Duration');
    const initial = this.expression(named.get('initial').value, new Map(), { allowNext: false }, [], payloadType);
    if (!sameType(initial.type, payloadType) || initial.constant === undefined) error(named.get('initial').loc, `debounce initial must be a constant ${typeNameOf(payloadType)}`);
    const sample = resultSource ? (source.sample ?? scanSample()) : scanSample();
    for (const root of sample.sources) this.allocateSampleRoot(root);
    const roleName = role => this.generatedName(`debounce_${role.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`, item.name);
    const states = Object.fromEntries(['stable', 'candidate', 'candidateActive', 'candidateSince', 'lastSourceTag'].map(role => [role, roleName(role)]));
    this.addState(states.stable, payloadType, initial.constant, item.loc); this.addState(states.candidate, payloadType, initial.constant, item.loc);
    this.addState(states.candidateActive, BOOL, false, item.loc); this.addState(states.candidateSince, NUMBER, 0, item.loc);
    this.addState(states.lastSourceTag, NUMBER, 0, item.loc);
    const sources = sample.sources.map(({ name, tag: sourceTag }) => {
      const sourceStates = {
        lastEpoch: `${RESERVED_PREFIX}debounce_source_epoch_${item.name}_${sourceTag}`,
        lastId: `${RESERVED_PREFIX}debounce_source_id_${item.name}_${sourceTag}`,
      };
      this.addState(sourceStates.lastEpoch, NUMBER, 0, item.loc);
      this.addState(sourceStates.lastId, NUMBER, -1, item.loc);
      return { name, tag: sourceTag, states: sourceStates };
    });

    const now = `input.${RESERVED_PREFIX}now_ms`, tag = sample.sourceTag;
    const scan = typeof tag === 'string' ? (tag === '0' ? 'true' : 'false') : ['eq', tag, '0'];
    const choose = (condition, yes, no) => condition === 'true' ? yes : condition === 'false' ? no : ['if', condition, yes, no];
    const any = values => values.filter(value => value !== 'false').reduceRight((rest, value) =>
      rest === 'false' ? value : ['or', value, rest], 'false');
    // Compare each physical root directly. Selecting epoch and ID separately
    // repeats the whole lineage selector in every generated state expression.
    const observations = sources.map(sourceRoot => {
      const inputs = this.sensors.get(sourceRoot.name).sampleInputs;
      const selected = typeof tag === 'string' ? (tag === numberAtom(sourceRoot.tag) ? 'true' : 'false') : ['eq', tag, numberAtom(sourceRoot.tag)];
      const epochChanged = ['not', ['eq', `input.${inputs.epoch}`, `state.${sourceRoot.states.lastEpoch}`]];
      const present = `input.${inputs.present}`;
      return {
        fresh: choose(selected, ['and', present, ['or', epochChanged, ['gt', `input.${inputs.id}`, `state.${sourceRoot.states.lastId}`]]], 'false'),
        epochChanged: choose(selected, ['and', present, epochChanged], 'false'),
      };
    });
    const fresh = choose(scan, 'true', any(observations.map(observation => observation.fresh)));
    const observationTime = choose(scan, now, sample.timestamp);
    const rootChanged = ['not', ['eq', tag, `state.${states.lastSourceTag}`]];
    const selectedEpochChanged = any(observations.map(observation => observation.epochChanged));
    const lineageChanged = ['or', rootChanged, selectedEpochChanged];
    const stableBefore = ['if', lineageChanged, gfbDefault(payloadType, initial.constant), `state.${states.stable}`];
    const matchesStable = ['eq', source.value ?? source.sexpr, stableBefore];
    const matchesCandidate = ['eq', source.value ?? source.sexpr, `state.${states.candidate}`];
    const continuing = ['and', `state.${states.candidateActive}`, ['and', ['not', lineageChanged], matchesCandidate]];
    const mature = ['gte', ['sub', observationTime, `state.${states.candidateSince}`], numberAtom(stableFor.constant)];
    const promote = ['and', fresh, ['and', ['not', matchesStable], ['and', continuing, mature]]];
    const good = resultSource ? source.ok : 'true';
    const reset = ['not', good];
    const nextStable = ['if', reset, gfbDefault(payloadType, initial.constant), ['if', promote, source.value ?? source.sexpr, stableBefore]];
    const startsCandidate = ['and', fresh, ['and', ['not', matchesStable], ['not', continuing]]];
    const nextCandidate = ['if', reset, gfbDefault(payloadType, initial.constant), ['if', lineageChanged,
      ['if', startsCandidate, source.value ?? source.sexpr, gfbDefault(payloadType, initial.constant)],
      ['if', startsCandidate, source.value ?? source.sexpr, `state.${states.candidate}`]]];
    const nextActive = ['if', reset, 'false', ['if', lineageChanged, startsCandidate,
      ['if', fresh, ['if', matchesStable, 'false', ['if', promote, 'false', 'true']], `state.${states.candidateActive}`]]];
    const nextSince = ['if', reset, '0', ['if', lineageChanged, ['if', startsCandidate, observationTime, '0'],
      ['if', startsCandidate, observationTime, `state.${states.candidateSince}`]]];
    const next = {
      stable: nextStable, candidate: nextCandidate, candidateActive: nextActive, candidateSince: nextSince,
      lastSourceTag: tag,
    };
    const sourceNext = sources.flatMap(sourceRoot => {
      const sensor = this.sensors.get(sourceRoot.name); if (!sensor?.sampleAllocated) internal(`missing allocated sample root ${sourceRoot.name}`);
      const inputs = sensor.sampleInputs;
      const epoch = `input.${inputs.epoch}`, id = `input.${inputs.id}`, present = `input.${inputs.present}`;
      const oldEpoch = `state.${sourceRoot.states.lastEpoch}`, oldId = `state.${sourceRoot.states.lastId}`;
      const newer = ['and', present, ['if', ['not', ['eq', epoch, oldEpoch]], 'true', ['gt', id, oldId]]];
      return [
        [sourceRoot.states.lastEpoch, ['if', newer, epoch, oldEpoch]],
        [sourceRoot.states.lastId, ['if', newer, id, oldId]],
      ];
    });
    const descriptor = {
      kind: 'debounce', name: item.name, payloadType: payloadType.kind,
      errorType: resultSource ? source.type.error.kind : null,
      sourceMode: sample.sources.length ? 'sample' : 'scan', stableForMs: stableFor.constant, initial: initial.constant,
      clockInput: `${RESERVED_PREFIX}now_ms`, sources, states,
      ...(finiteEnum ? { members: [...members.keys()] } : {}),
    };
    this.manifest.signals.push(descriptor);
    const lowered = resultSource
      ? { ...source, type: resultType(payloadType, source.type.error), value: nextStable, sample }
      : { type: payloadType, sexpr: nextStable };
    this.signals.set(item.name, { type: payloadType, lowered, descriptor, states, next, sourceNext, originTag: item.id, loc: item.loc });
    this.symbols.get(item.name).type = lowered.type;
    for (const [role, name] of Object.entries(states)) this.generatedSignals.push({ node: item, role, name });
    for (const sourceRoot of sources) {
      this.generatedSignals.push(
        { node: item, role: 'sourceEpoch', name: sourceRoot.states.lastEpoch, sourceTag: sourceRoot.tag },
        { node: item, role: 'sourceId', name: sourceRoot.states.lastId, sourceTag: sourceRoot.tag },
      );
    }
  }
  addHoldLastSignal(item, call) {
    const named = new Map();
    for (const entry of call.named) {
      if (named.has(entry.name)) error(entry.loc, `duplicate hold_last argument ${entry.name}`);
      named.set(entry.name, entry);
    }
    if (call.args.length !== 1 || call.named.length !== 2 || !named.has('for_at_most') || !named.has('quality')) {
      error(call.loc, 'hold_last requires hold_last(source, for_at_most: Duration, quality: measured)');
    }
    const quality = named.get('quality');
    if (quality.value.kind !== 'reference' || quality.value.name !== 'measured') error(quality.loc, 'hold_last quality must be measured');
    if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
    const source = this.expression(call.args[0], new Map(), { allowNext: false });
    if (source.type.kind !== 'Result' || source.type.error.kind !== 'SensorFault') error(call.args[0].loc, 'hold_last source must be Result<T, SensorFault>');
    const sample = source.sample ?? scanSample();
    if (!sample.sources.length) error(call.loc, 'hold_last measured source requires physical sample lineage');
    const duration = this.expression(named.get('for_at_most').value, new Map(), { allowNext: false }, [], DURATION);
    if (!sameType(duration.type, DURATION) || duration.constant === undefined || duration.constant <= 0) {
      error(named.get('for_at_most').loc, 'hold_last for_at_most must be a positive constant Duration');
    }
    const payloadType = source.type.value;
    const members = this.types.get(payloadType.kind);
    for (const root of sample.sources) this.allocateSampleRoot(root);
    const roleName = role => this.generatedName(`hold_last_${role.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`, item.name);
    const roles = ['available', 'value', 'heldSourceTag', 'heldEpoch', 'heldId', 'heldTimestamp', 'held', 'age',
      'maskedFaultPresent', 'maskedFaultCode', 'maskedFaultOrigin'];
    const states = Object.fromEntries(roles.map(role => [role, roleName(role)]));
    const defaultValue = defaultLowered(payloadType).constant ?? 0;
    this.addState(states.available, BOOL, false, item.loc); this.addState(states.value, payloadType, defaultValue, item.loc);
    for (const role of ['heldSourceTag', 'heldEpoch']) this.addState(states[role], NUMBER, 0, item.loc);
    this.addState(states.heldId, NUMBER, -1, item.loc); this.addState(states.heldTimestamp, NUMBER, 0, item.loc);
    this.addState(states.held, BOOL, false, item.loc); this.addState(states.age, NUMBER, 0, item.loc);
    this.addState(states.maskedFaultPresent, BOOL, false, item.loc);
    this.addState(states.maskedFaultCode, NUMBER, 3, item.loc); this.addState(states.maskedFaultOrigin, NUMBER, 0, item.loc);
    const sources = sample.sources.map(({ name, tag: sourceTag }) => {
      const sourceStates = {
        lastEpoch: `${RESERVED_PREFIX}hold_last_source_epoch_${item.name}_${sourceTag}`,
        lastId: `${RESERVED_PREFIX}hold_last_source_id_${item.name}_${sourceTag}`,
      };
      this.addState(sourceStates.lastEpoch, NUMBER, 0, item.loc); this.addState(sourceStates.lastId, NUMBER, -1, item.loc);
      return { name, tag: sourceTag, states: sourceStates };
    });
    const choose = (condition, yes, no) => condition === 'true' ? yes : condition === 'false' ? no : ['if', condition, yes, no];
    const any = values => values.filter(value => value !== 'false').reduceRight((rest, value) =>
      rest === 'false' ? value : ['or', value, rest], 'false');
    const observations = sources.map(root => {
      const inputs = this.sensors.get(root.name).sampleInputs;
      const present = `input.${inputs.present}`, epoch = `input.${inputs.epoch}`, id = `input.${inputs.id}`;
      const epochChanged = ['not', ['eq', epoch, `state.${root.states.lastEpoch}`]];
      const newer = ['and', present, ['or', epochChanged, ['gt', id, `state.${root.states.lastId}`]]];
      const selected = ['eq', sample.sourceTag, numberAtom(root.tag)];
      const invalidatesCache = ['and', `state.${states.available}`, ['and', ['eq', `state.${states.heldSourceTag}`, numberAtom(root.tag)], ['and', newer, epochChanged]]];
      return { root, inputs, newer, freshSelected: ['and', selected, newer], invalidatesCache };
    });
    const now = `input.${RESERVED_PREFIX}now_ms`;
    const fresh = any(observations.map(entry => entry.freshSelected));
    const staticallyUnmeasured = sample.quality === '0' || sample.quality === '2';
    const admissibleFresh = staticallyUnmeasured ? 'false'
      : ['and', source.ok, ['and', ['eq', sample.quality, '1'], ['and', fresh, ['lte', sample.timestamp, now]]]];
    const cacheInvalid = any(observations.map(entry => entry.invalidatesCache));
    const retainedAvailable = ['and', `state.${states.available}`, ['not', cacheInvalid]];
    // An impossible admission never evaluates its payload. Still evaluate the
    // Result selector in the committed transition: it can reject or emit trace.
    const nextAvailable = staticallyUnmeasured
      ? ['if', source.ok, retainedAvailable, retainedAvailable]
      : choose(admissibleFresh, 'true', retainedAvailable);
    const nextValue = choose(admissibleFresh, source.value, `state.${states.value}`);
    const nextSourceTag = choose(admissibleFresh, sample.sourceTag, `state.${states.heldSourceTag}`);
    const nextEpoch = choose(admissibleFresh, sample.epoch, `state.${states.heldEpoch}`);
    const nextId = choose(admissibleFresh, sample.id, `state.${states.heldId}`);
    const nextTimestamp = choose(admissibleFresh, sample.timestamp, `state.${states.heldTimestamp}`);
    const freshAge = ['sub', now, sample.timestamp], retainedAge = ['sub', now, `state.${states.heldTimestamp}`];
    const retainedTimeValid = ['lte', `state.${states.heldTimestamp}`, now];
    const retainedHeld = ['and', retainedAvailable, ['and', retainedTimeValid, ['lt', retainedAge, numberAtom(duration.constant)]]];
    const nextAge = choose(admissibleFresh, freshAge, ['if', ['and', retainedAvailable, retainedTimeValid], retainedAge, '0']);
    const nextHeld = choose(admissibleFresh, ['lt', freshAge, numberAtom(duration.constant)], retainedHeld);
    const masked = ['and', retainedHeld, ['not', source.ok]];
    const next = {
      available: nextAvailable, value: nextValue, heldSourceTag: nextSourceTag, heldEpoch: nextEpoch, heldId: nextId,
      heldTimestamp: nextTimestamp, held: nextHeld, age: nextAge, maskedFaultPresent: masked,
      maskedFaultCode: ['if', masked, source.faultCode, '3'], maskedFaultOrigin: ['if', masked, source.originTag, '0'],
    };
    const sourceNext = observations.flatMap(({ root, inputs, newer }) => [
      [root.states.lastEpoch, ['if', newer, `input.${inputs.epoch}`, `state.${root.states.lastEpoch}`]],
      [root.states.lastId, ['if', newer, `input.${inputs.id}`, `state.${root.states.lastId}`]],
    ]);
    const descriptor = {
      kind: 'hold-last', name: item.name, payloadType: payloadType.kind, errorType: 'SensorFault', quality: 'measured',
      forAtMostMs: duration.constant, clockInput: `${RESERVED_PREFIX}now_ms`, sourceMode: 'sample', sources, states,
      ...(members ? { members: [...members.keys()] } : {}),
    };
    this.manifest.signals.push(descriptor);
    const selfOrigin = { tag: item.id, nodeId: item.id, kind: 'signal', name: item.name };
    const loweredSample = {
      sourceTag: nextSourceTag, present: nextHeld, epoch: nextEpoch, id: nextId, timestamp: nextTimestamp,
      // Quality describes successful evidence only; Result.ok gates its use.
      quality: '2', sources: sample.sources,
    };
    const lowered = {
      type: resultType(payloadType, semanticType('SensorFault')), ok: nextHeld, value: nextValue,
      faultCode: '3', originTag: numberAtom(item.id),
      origins: [...new Map([...(source.origins ?? []), selfOrigin].map(origin => [origin.tag, origin])).values()], sample: loweredSample,
    };
    this.signals.set(item.name, { type: payloadType, lowered, descriptor, states, next, sourceNext, originTag: item.id, loc: item.loc });
    this.symbols.get(item.name).type = lowered.type;
    for (const [role, name] of Object.entries(states)) this.generatedSignals.push({ node: item, role, name });
    for (const root of sources) this.generatedSignals.push(
      { node: item, role: 'sourceEpoch', name: root.states.lastEpoch, sourceTag: root.tag },
      { node: item, role: 'sourceId', name: root.states.lastId, sourceTag: root.tag },
    );
  }
  declareTimer(item) {
    const call = item.call;
    if (call.kind !== 'call' || !['elapsed', 'continuous_true'].includes(call.name) || call.args.length !== 1 || call.named.length) {
      error(call.loc, 'timer requires elapsed(state) or continuous_true(Bool)');
    }
    if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, item.loc); this.hasClock = true; }
    const sinceState = this.generatedName('timer_since', item.name);
    this.addState(sinceState, NUMBER, 0, item.loc);
    if (call.name === 'elapsed') {
      const stateRef = call.args[0];
      if (stateRef.kind !== 'reference' || !this.states.has(stateRef.name)) error(stateRef.loc, 'elapsed argument must be a declared state');
      const initState = this.generatedName('timer_initialized', item.name);
      this.addState(initState, BOOL, false, item.loc);
      this.manifest.timers.push({ name: item.name, state: stateRef.name, clockInput: `${RESERVED_PREFIX}now_ms` });
      this.timers.set(item.name, { mode: 'elapsed', state: stateRef.name, sinceState, trackingState: initState, trackingRole: 'initialized', loc: item.loc });
      this.timerStates.set(item.name, 'done');
    } else {
      const wasTrueState = this.generatedName('timer_was_true', item.name);
      this.addState(wasTrueState, BOOL, false, item.loc);
      this.manifest.timers.push({ name: item.name, mode: 'continuous-true', clockInput: `${RESERVED_PREFIX}now_ms` });
      this.timers.set(item.name, { mode: 'continuous-true', conditionNode: call.args[0], condition: null, sinceState, trackingState: wasTrueState, trackingRole: 'wasTrue', loc: item.loc });
    }
    this.symbols.get(item.name).type = DURATION;
  }
  resolveTimer(name) {
    const timer = this.timers.get(name); if (!timer) internal(`missing timer definition ${name}`);
    const status = this.timerStates.get(name);
    if (status === 'done') return timer;
    if (status === 'visiting') error(timer.loc, `cyclic timer definition involving ${name}`);
    this.timerStates.set(name, 'visiting');
    const condition = this.expression(timer.conditionNode, new Map(), { allowNext: false }, [], BOOL);
    if (!sameType(condition.type, BOOL)) error(timer.conditionNode.loc, 'continuous_true argument must be Bool');
    timer.condition = condition.sexpr;
    this.timerStates.set(name, 'done');
    return timer;
  }
  timerValue(timer) {
    const ready = timer.mode === 'continuous-true'
      ? ['and', timer.condition, `state.${timer.trackingState}`]
      : `state.${timer.trackingState}`;
    return ['if', ready, ['sub', `input.${RESERVED_PREFIX}now_ms`, `state.${timer.sinceState}`], '0'];
  }
  addMacro(item) {
    const params = [], names = new Set();
    for (const parameter of item.params) {
      rejectName(parameter.name, parameter.loc, 'syntax macro parameter');
      if (names.has(parameter.name)) error(parameter.loc, `duplicate syntax macro parameter ${parameter.name}`);
      names.add(parameter.name);
      params.push({ ...parameter, resolvedType: this.resolveType(parameter.type) });
    }
    this.macros.set(item.name, { ...item, params, resultType: this.resolveType(item.result) });
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
      const scope = new Map(fn.params.map(parameter => [parameter.name, validationLowered(parameter.resolvedType)]));
      const value = this.expression(fn.body, scope, { allowNext: false, pureFunction: fn.name, validation: true }, [fn.name], fn.resultType);
      if (!sameType(value.type, fn.resultType)) error(fn.loc, `function ${fn.name} returns ${typeNameOf(value.type)}, expected ${typeNameOf(fn.resultType)}`);
    }
  }
  addLet(item) {
    this.resolveLet(item.name);
  }
  resolveParameter(name) {
    const symbol = this.symbols.get(name);
    if (symbol.value) return symbol.value;
    const item = this.ast.body.find(entry => entry.kind === 'parameter' && entry.name === name);
    if (symbol.resolving) error(item.loc, `cyclic parameter default involving ${name}`);
    symbol.resolving = true;
    const type = this.resolveType(item.type);
    const value = this.expression(item.value, new Map(), { allowNext: false, parameterConstant: true }, [], type);
    if (!sameType(value.type, type) || value.constant === undefined) error(item.value.loc, 'parameter default must be a constant of the declared type');
    symbol.type = type; symbol.value = value; symbol.resolving = false;
    return value;
  }
  resolveLet(name) {
    if (this.failedLets.has(name)) throw this.failedLets.get(name);
    try { return this.resolveLetValue(name); }
    catch (cause) {
      if (cause instanceof ControlCompileError) this.failedLets.set(name, cause);
      throw cause;
    }
  }
  resolveLetValue(name) {
    const item = this.lets.get(name); if (!item) internal(`missing let definition ${name}`);
    const status = this.letStates.get(name);
    if (status === 'done') return this.symbols.get(name).value;
    if (status === 'visiting') error(item.loc, `cyclic let definition involving ${name}`);
    this.letStates.set(name, 'visiting');
    const annotation = item.annotation ? this.resolveType(item.annotation) : null;
    if (!annotation && isStaticTransformSyntax(item.value)) {
      const value = { type: semanticType('StaticTransform'), transformNode: item.value };
      this.symbols.get(item.name).type = value.type; this.symbols.get(item.name).value = value;
      this.letStates.set(name, 'done');
      return value;
    }
    if (!annotation && item.value.kind === 'reference' && this.lets.has(item.value.name)) {
      const target = this.resolveLet(item.value.name);
      if (target.type.kind === 'StaticTransform') {
        this.symbols.get(item.name).type = target.type; this.symbols.get(item.name).value = target;
        this.letStates.set(name, 'done');
        return target;
      }
    }
    const value = this.expression(item.value, new Map(), { allowNext: false }, [], annotation);
    const resolvedAnnotation = annotation ?? value.type;
    if (!sameType(resolvedAnnotation, value.type)) error(item.loc, `let ${item.name} does not match annotation ${resolvedAnnotation.kind}`);
    if (containsRate(resolvedAnnotation)) error(item.loc, 'Rate<Q> is expression-only and cannot be bound by let');
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
    if (!sameType(value.type, output.type)) typeError(item.loc, `output ${item.name} must be ${output.type.kind}`);
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
    if (node.kind === 'splice') {
      const value = options.macroArguments?.get(node.name);
      if (!value) error(node.loc, `unknown syntax macro parameter ${node.name}`);
      return value;
    }
    if (node.kind === 'list') {
      if (expected?.kind !== 'TimeSlots') error(node.loc, 'list literals are only valid for TimeSlots config values');
      const values = node.values.map(value => recurse(value, locals, options, semanticType('TimeOfDay')));
      if (values.some(value => value.type.kind !== 'TimeOfDay' || value.constant === undefined)) error(node.loc, 'TimeSlots entries must be constant TimeOfDay values');
      return { type: expected, sexpr: '0', constant: values.map(value => value.constant) };
    }
    if (node.kind === 'literal') return literal(node.raw, node.loc, expected);
    if (node.kind === 'reference') {
      if (locals.has(node.name)) return locals.get(node.name);
      const member = this.enumMembers.get(node.name); if (member) return { type: semanticType(member.type), sexpr: String(member.value), constant: member.value };
      const expectedMembers = expected && FAULT_ENUMS.get(expected.kind);
      if (expectedMembers?.has(node.name)) return { type: expected, sexpr: String(expectedMembers.get(node.name)), constant: expectedMembers.get(node.name) };
      const faultCandidates = [...FAULT_ENUMS].filter(([, members]) => members.has(node.name));
      if (faultCandidates.length === 1) {
        const [faultName, members] = faultCandidates[0];
        return { type: semanticType(faultName), sexpr: String(members.get(node.name)), constant: members.get(node.name) };
      }
      if (faultCandidates.length > 1) error(node.loc, `ambiguous fault member ${node.name} requires an expected fault type`);
      const symbol = this.symbols.get(node.name); if (!symbol) error(node.loc, `unknown identifier ${node.name}`);
      if (options.pureFunction && symbol.category !== 'function') error(node.loc, `fn ${options.pureFunction} cannot capture global ${node.name}`);
      if (options.macroDefinition && symbol.category !== 'function') error(node.loc, `syntax macro ${options.macroDefinition} cannot capture global ${node.name}`);
      if (symbol.category === 'input') return { type: symbol.type, sexpr: `input.${node.name}` };
      if (symbol.category === 'state') return { type: symbol.type, sexpr: `state.${node.name}` };
      if (options.parameterConstant && !['parameter', 'function'].includes(symbol.category)) error(node.loc, 'parameter default must be a constant independent of inputs, state and settings');
      if (symbol.category === 'parameter') return this.resolveParameter(node.name);
      if (symbol.category === 'config') {
        if (!symbol.resultInputs) error(node.loc, `TimeSlots config ${node.name} requires a schedule consumer`);
        const inputs = symbol.resultInputs;
        return {
          type: symbol.type,
          ok: `input.${inputs.ok}`, value: `input.${inputs.value}`,
          faultCode: `input.${inputs.fault}`, originTag: numberAtom(symbol.id),
          origins: [{ tag: symbol.id, nodeId: symbol.id,
            kind: 'config', name: node.name }], sample: scanSample(),
        };
      }
      if (symbol.category === 'let') return this.resolveLet(node.name);
      if (symbol.category === 'timer') {
        const timer = this.resolveTimer(node.name);
        return { type: DURATION, sexpr: this.timerValue(timer) };
      }
      if (symbol.category === 'schedule') error(node.loc, `schedule ${node.name} must be read as ${node.name}.due`);
      if (symbol.category === 'sensor' || symbol.category === 'signal') {
        if (symbol.category === 'sensor' && this.ast.body.some(item => item.kind === 'sensor' && item.name === node.name && item.optional)
          && !this.currentStrategy?.matchedSensors.has(node.name)) {
          error(node.loc, `optional sensor ${node.name} may only be read inside a strategy that matches it`);
        }
        const source = this.sensors.get(node.name) ?? this.resolveSignal(node.name);
        if (source.descriptor?.kind === 'after-event') {
          error(node.loc, `after_event signal ${node.name} requires after_event_for, after_event_any, or after_event_all`);
        }
        if (source.lowered) return source.lowered;
        return {
          type: resultType(source.type, semanticType('SensorFault')),
          ok: `input.${source.okInput}`, value: `input.${source.valueInput}`,
          faultCode: `input.${source.faultInput}`, originTag: numberAtom(source.originTag),
          origins: [{ tag: source.originTag, nodeId: source.originTag, kind: symbol.category, name: node.name }],
          sample: source.sample ?? this.sensorSample(node.name),
        };
      }
      if (symbol.category === 'function') error(node.loc, `function ${node.name} requires arguments`);
      error(node.loc, `unsupported reference ${node.name}`);
    }
    if (node.kind === 'member') {
      if (['input', 'state', 'next'].includes(node.base)) {
        error(node.loc, `removed qualified reference ${node.base}.${node.member}; use the direct canonical name`);
      }
      if (node.member === 'due' && !locals.has(node.base) && this.schedules.has(node.base)) {
        if (options.pureFunction) error(node.loc, `fn ${options.pureFunction} cannot capture global ${node.base}`);
        const schedule = this.schedules.get(node.base);
        return { type: BOOL, sexpr: schedule.slot === undefined
          ? `input.${schedule.dueInput}` : ['schedule-read', String(schedule.slot), 'due'] };
      }
      if (node.member === 'active' && !locals.has(node.base) && this.schedules.has(node.base)) {
        if (options.pureFunction) error(node.loc, `fn ${options.pureFunction} cannot capture global ${node.base}`);
        const schedule = this.schedules.get(node.base);
        return { type: BOOL, sexpr: schedule.slot === undefined
          ? `input.${schedule.activeInput ?? schedule.dueInput}` : ['schedule-read', String(schedule.slot), 'active'] };
      }
      if (node.member === 'missed' && !locals.has(node.base) && this.schedules.has(node.base)) {
        if (options.pureFunction) error(node.loc, `fn ${options.pureFunction} cannot capture global ${node.base}`);
        const schedule = this.schedules.get(node.base);
        if (!schedule.projections?.has('missed')) error(node.loc, `schedule ${node.base} does not expose .missed`);
        return { type: BOOL, sexpr: ['schedule-read', String(schedule.slot), 'missed'] };
      }
      if (node.member === 'count' && !locals.has(node.base) && this.accounts.has(node.base)) {
        if (options.pureFunction) error(node.loc, `fn ${options.pureFunction} cannot capture global ${node.base}`);
        if (options.macroDefinition) error(node.loc, `syntax macro ${options.macroDefinition} cannot capture global ${node.base}`);
        const account = this.accounts.get(node.base);
        if (account.operation !== 'count_events') error(node.loc, 'only event accounts expose .count');
        return {
          type: resultType(INT, semanticType('AccountingFault')),
          ok: account.resultInputs ? `input.${account.resultInputs.ok}` : `account.${node.base}.count.ok`,
          value: account.resultInputs ? `input.${account.resultInputs.value}` : `account.${node.base}.count.value`,
          faultCode: account.resultInputs ? `input.${account.resultInputs.fault}` : `account.${node.base}.count.fault`,
          originTag: '0', origins: [],
        };
      }
      error(node.loc, `unknown member ${node.base}.${node.member}`);
    }
    if (node.kind === 'nextReference') {
      if (options.pureFunction) error(node.loc, `fn ${options.pureFunction} cannot read primed state ${node.name}'`);
      if (!options.allowNext) error(node.loc, 'next state references are allowed only in output expressions');
      const state = this.states.get(node.name); if (!state) error(node.loc, `unknown state ${node.name}`);
      return { type: state.type, sexpr: `next.${node.name}` };
    }
    if (node.kind === 'unary') {
      if (node.op === '-' && isWholeLiteralNode(node.value) && (!expected || expected.kind === 'Int')) {
        return intLiteral(node.value.raw, node.loc, true);
      }
      if (node.op === '-' && node.value.kind === 'literal' && !node.value.parenthesized && locatedQuantityLiteral(node.value.raw, node.loc)) {
        return literal(`-${node.value.raw}`, node.loc, expected);
      }
      const value = recurse(node.value, locals, options, expected);
      if (node.op === '!') { if (!sameType(value.type, BOOL)) error(node.loc, '! requires Bool'); return { type: BOOL, sexpr: ['not', value.sexpr], constant: value.constant === undefined ? undefined : !value.constant }; }
      if (node.op === '-') {
        if (!isNumeric(value.type)) error(node.loc, 'unary - requires numeric value');
        if (isQuantityType(value.type.kind) && !LINEAR_QUANTITIES.has(value.type.kind)) error(node.loc, `unary - is not defined for ${value.type.kind}`);
        const constant = value.constant === undefined ? undefined : -value.constant;
        validateNominalConstant(value.type, constant, node.loc);
        let lowered = value.type.kind === 'Int' ? ['int-neg', value.sexpr] : ['sub', '0', value.sexpr];
        if (value.type.kind === 'Duration' && constant === undefined) lowered = ['check-duration', lowered];
        return { type: value.type, sexpr: lowered, constant };
      }
    }
    if (node.kind === 'binary') return this.binary(node, recurse, expected, locals, options, callStack);
    if (node.kind === 'if') {
      const test = recurse(node.test);
      let yes, no;
      if (!expected && isContextualWholeLiteralNode(node.yes) && !isContextualWholeLiteralNode(node.no)) {
        no = recurse(node.no); yes = recurse(node.yes, locals, options, no.type);
      } else {
        yes = recurse(node.yes, locals, options, expected);
        no = recurse(node.no, locals, options, expected ?? (isContextualWholeLiteralNode(node.no) ? yes.type : null));
      }
      if (!sameType(test.type, BOOL)) error(node.test.loc, 'if condition must be Bool'); if (!sameType(yes.type, no.type)) error(node.loc, 'if branches must have the same type');
      if (yes.type.kind === 'Result') return selectLowered(test.sexpr, yes, no);
      return { type: yes.type, sexpr: ['if', test.sexpr, yes.sexpr, no.sexpr], constant: test.constant === undefined ? undefined : (test.constant ? yes.constant : no.constant) };
    }
    if (node.kind === 'in') {
      const left = recurse(node.left); const values = node.values.map(value => recurse(value)); for (const value of values) if (!sameType(left.type, value.type)) error(value.type?.loc ?? node.loc, 'in values must match the tested value type');
      let out = null; for (const value of values) { const equal = ['eq', left.sexpr, value.sexpr]; out = out ? ['or', out, equal] : equal; }
      return { type: BOOL, sexpr: out, constant: left.constant === undefined || values.some(x => x.constant === undefined) ? undefined : values.some(x => x.constant === left.constant) };
    }
    if (node.kind === 'case') return this.caseExpression(node, locals, options, callStack, expected);
    if (node.kind === 'macro-call') return this.macroExpression(node, locals, options, callStack, expected);
    if (node.kind === 'call') return this.callExpression(node, locals, options, callStack, expected);
    error(node.loc, `unsupported expression node ${node.kind}`);
  }
  macroExpression(node, locals, options, callStack, expected = null) {
    const macro = this.macros.get(node.name);
    if (!macro) error(node.loc, `unknown syntax macro ${node.name}`);
    if (node.named.length || node.args.length !== macro.params.length) {
      error(node.loc, `syntax macro ${node.name} expects ${macro.params.length} arguments`);
    }
    const stack = options.macroStack ?? [];
    if (stack.includes(node.name)) error(node.loc, `recursive syntax macro ${node.name} is not supported`);
    const argumentsByName = new Map();
    for (let index = 0; index < macro.params.length; index++) {
      const parameter = macro.params[index];
      const value = this.expression(node.args[index], locals, options, callStack, parameter.resolvedType);
      if (!sameType(value.type, parameter.resolvedType)) {
        error(node.args[index].loc, `argument ${index + 1} to syntax macro ${node.name} must be ${typeNameOf(parameter.resolvedType)}, got ${typeNameOf(value.type)}`);
      }
      argumentsByName.set(parameter.name, value);
    }
    const value = this.expression(macro.body, new Map(), {
      ...options,
      macroArguments: argumentsByName,
      macroStack: [...stack, node.name],
      macroDefinition: node.name,
    }, callStack, macro.resultType);
    if (!sameType(value.type, macro.resultType)) {
      error(macro.loc, `syntax macro ${node.name} returns ${typeNameOf(value.type)}, expected ${typeNameOf(macro.resultType)}`);
    }
    if (expected && !sameType(value.type, expected)) {
      error(node.loc, `syntax macro ${node.name} produces ${typeNameOf(value.type)}, expected ${typeNameOf(expected)}`);
    }
    return value;
  }
  binary(node, recurse, expected, locals, options, callStack) {
    if (node.op === '|>') {
      const value = recurse(node.left);
      return this.applyTransform(node.right, value, locals, options, callStack);
    }
    if (node.op === '>>') error(node.loc, '>> is valid only inside a static Result transform pipeline');
    let left, right;
    if (isContextualWholeLiteralNode(node.left) && !isContextualWholeLiteralNode(node.right)) {
      right = recurse(node.right);
      const inferred = (node.op === '*' && isQuantityType(right.type.kind)) ? NUMBER : right.type;
      left = recurse(node.left, undefined, undefined, inferred);
    } else if (isContextualWholeLiteralNode(node.right) && !isContextualWholeLiteralNode(node.left)) {
      left = recurse(node.left);
      const inferred = ((node.op === '*' || node.op === '/') && isQuantityType(left.type.kind)) ? NUMBER : left.type;
      right = recurse(node.right, undefined, undefined, inferred);
    } else {
      left = recurse(node.left, undefined, undefined, expected);
      right = recurse(node.right, undefined, undefined, expected);
    }
    const op = node.op;
    if (left.type?.kind === 'Result' || right.type?.kind === 'Result') {
      error(node.loc, `${op} cannot use Result directly; handle ok(...) and fault(...) with case`);
    }
    if (op === '&&' || op === '||') { if (!sameType(left.type, BOOL) || !sameType(right.type, BOOL)) error(node.loc, `${op} requires Bool operands`); return { type: BOOL, sexpr: [op === '&&' ? 'and' : 'or', left.sexpr, right.sexpr], constant: left.constant === undefined || right.constant === undefined ? undefined : (op === '&&' ? left.constant && right.constant : left.constant || right.constant) }; }
    if (['==', '!='].includes(op)) { if (!sameType(left.type, right.type)) error(node.loc, `${op} requires values of the same type`); const eq = left.constant === undefined || right.constant === undefined ? undefined : left.constant === right.constant; return { type: BOOL, sexpr: op === '==' ? ['eq', left.sexpr, right.sexpr] : ['not', ['eq', left.sexpr, right.sexpr]], constant: eq === undefined ? undefined : (op === '==' ? eq : !eq) }; }
    if (['<', '<=', '>', '>='].includes(op)) { if ((!isNumeric(left.type) && left.type?.kind !== 'Rate' && !['DateTime', 'TimeOfDay'].includes(left.type?.kind)) || !sameType(left.type, right.type)) error(node.loc, `${op} requires matching ordered types`); const values = left.constant === undefined || right.constant === undefined ? undefined : ({ '<': left.constant < right.constant, '<=': left.constant <= right.constant, '>': left.constant > right.constant, '>=': left.constant >= right.constant })[op]; return { type: BOOL, sexpr: [{ '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' }[op], left.sexpr, right.sexpr], constant: values }; }
    if (['+', '-', '*', '/', 'div', '%'].includes(op)) {
      const rule = arithmeticRule(op, left.type, right.type, node.loc);
      const type = rule.type;
      const leftConstant = left.constant === undefined || rule.durationOperand !== 'left' ? left.constant : left.constant / 1000;
      const rightConstant = right.constant === undefined || rule.durationOperand !== 'right' ? right.constant : right.constant / 1000;
      const constants = leftConstant === undefined || rightConstant === undefined ? undefined : arithmetic(op, leftConstant, rightConstant, node.loc);
      validateNominalConstant(type, constants, node.loc);
      const head = type.kind === 'Int'
        ? ({ '+': 'int-add', '-': 'int-sub', '*': 'int-mul', div: 'int-div', '%': 'int-rem' })[op]
        : ({ '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' })[op];
      const loweredLeft = rule.durationOperand === 'left' ? ['div', left.sexpr, '1000'] : left.sexpr;
      const loweredRight = rule.durationOperand === 'right' ? ['div', right.sexpr, '1000'] : right.sexpr;
      let lowered = [head, loweredLeft, loweredRight];
      if (type.kind === 'Duration' && constants === undefined) lowered = ['check-duration', lowered];
      if (type.kind === 'DateTime' && constants === undefined) lowered = ['check-datetime', lowered];
      return { type, sexpr: lowered, constant: constants };
    }
    if (op === '=>') error(node.loc, '=> is only valid in require declarations');
    error(node.loc, `unsupported operator ${op}`);
  }
  applyTransform(node, value, locals, options, callStack) {
    if (node.kind === 'reference' && this.lets.has(node.name)) {
      const alias = this.resolveLet(node.name);
      if (alias.type.kind !== 'StaticTransform') error(node.loc, `${node.name} is not a static Result transform`);
      return this.applyTransform(alias.transformNode, value, locals, options, callStack);
    }
    if (node.kind === 'binary' && node.op === '>>') {
      return this.applyTransform(node.right, this.applyTransform(node.left, value, locals, options, callStack), locals, options, callStack);
    }
    if (node.kind !== 'call' || node.named.length) error(node.loc, 'Result pipeline requires a compiler-known static transform');
    if (node.name === 'map') {
      if (node.args.length !== 1 || value.type.kind !== 'Result') error(node.loc, 'map expects one transform and a Result value');
      const mapped = this.applyValueTransform(node.args[0], { type: value.type.value, sexpr: value.value }, locals, options, callStack);
      if (mapped.type.kind === 'Result') error(node.loc, 'map transform must return a non-Result value');
      return { ...value, type: resultType(mapped.type, value.type.error), value: mapped.sexpr };
    }
    if (node.name === 'and_then') {
      if (node.args.length !== 1 || value.type.kind !== 'Result') error(node.loc, 'and_then expects one transform and a Result value');
      const chained = this.applyValueTransform(node.args[0], { type: value.type.value, sexpr: value.value }, locals, options, callStack);
      if (chained.type.kind !== 'Result' || !sameType(chained.type.error, value.type.error)) error(node.loc, 'and_then transform must return Result<U, E> with the same error type');
      const fallback = defaultLowered(chained.type.value).sexpr;
      return {
        type: chained.type,
        ok: ['if', value.ok, chained.ok, 'false'],
        value: ['if', value.ok, chained.value, fallback],
        faultCode: ['if', value.ok, chained.faultCode, value.faultCode],
        originTag: ['if', value.ok, chained.originTag, value.originTag],
        origins: [...new Map([...(value.origins ?? []), ...(chained.origins ?? [])].map(origin => [origin.tag, origin])).values()],
        sample: value.sample ?? scanSample(),
        evidence: value.evidence ?? chained.evidence,
      };
    }
    if (node.name === 'recover') {
      if (node.args.length !== 1 || value.type.kind !== 'Result') error(node.loc, 'recover expects one default and a Result value');
      const fallback = this.expression(node.args[0], locals, options, callStack, value.type.value);
      if (!sameType(fallback.type, value.type.value)) error(node.args[0].loc, `recover default must be ${typeNameOf(value.type.value)}`);
      const payload = ['if', value.ok, value.value, fallback.sexpr];
      const choice = ['if', value.ok, '0', ['add', value.faultCode, '1']];
      const origin = ['if', value.ok, '0', value.originTag];
      const site = this.recordResultSite(node, 'recover', value.type.error.kind, value.origins, options);
      return { type: value.type.value, sexpr: ['trace-result', String(site), payload, choice, origin] };
    }
    error(node.loc, `unsupported Result transform ${node.name}`);
  }
  applyValueTransform(node, value, locals, options, callStack) {
    if (node.kind === 'call' && node.name === 'below') {
      if (node.args.length !== 1 || node.named.length) error(node.loc, 'below expects one limit');
      if (!isNumeric(value.type) && value.type.kind !== 'Rate' && !['DateTime', 'TimeOfDay'].includes(value.type.kind)) error(node.loc, `below is not defined for ${typeNameOf(value.type)}`);
      const limit = this.expression(node.args[0], locals, options, callStack, value.type);
      if (!sameType(limit.type, value.type)) error(node.args[0].loc, `below limit must be ${typeNameOf(value.type)}`);
      return { type: BOOL, sexpr: ['lt', value.sexpr, limit.sexpr] };
    }
    if (node.kind !== 'reference') error(node.loc, 'map/and_then requires a named fn or below(limit)');
    const fn = this.functions.get(node.name);
    if (!fn || fn.params.length !== 1) error(node.loc, `transform ${node.name} must name a unary fn`);
    if (!sameType(value.type, fn.params[0].resolvedType)) error(node.loc, `transform ${node.name} expects ${typeNameOf(fn.params[0].resolvedType)}`);
    if (callStack.includes(node.name)) error(node.loc, `recursive fn ${node.name} is not supported`);
    const scope = new Map(); scope.set(fn.params[0].name, value);
    const out = this.expression(fn.body, scope, { ...options, pureFunction: node.name }, [...callStack, node.name], fn.resultType);
    if (!sameType(out.type, fn.resultType)) error(fn.loc, `function ${node.name} returns ${typeNameOf(out.type)}, expected ${typeNameOf(fn.resultType)}`);
    return out;
  }
  recordResultSite(node, kind, errorType, origins = [], options = {}) {
    if (options.validation) return node.id;
    let entry = this.resultSites.find(site => site.site === node.id);
    if (!entry) {
      entry = { site: node.id, nodeId: node.id, kind, errorType, source: { ...node.loc }, origins: [] };
      this.resultSites.push(entry);
    } else if (entry.kind !== kind || entry.errorType !== errorType) internal(`Result trace site ${node.id} changed meaning`);
    const known = new Set(entry.origins.map(origin => origin.tag));
    for (const origin of origins ?? []) if (!known.has(origin.tag)) { entry.origins.push({ ...origin }); known.add(origin.tag); }
    entry.origins.sort((left, right) => left.tag - right.tag);
    return node.id;
  }
  callExpression(node, locals, options, callStack, expected = null) {
    if (node.name === 'after_event_any' || node.name === 'after_event_all') {
      const mode = node.name.slice('after_event_'.length);
      if (node.args.length !== 1 || node.named.length || node.args[0].kind !== 'reference') {
        error(node.loc, `${node.name} expects one after_event signal`);
      }
      const signal = this.resolveSignal(node.args[0].name);
      if (signal.descriptor?.kind !== 'after-event') error(node.args[0].loc, `${node.name} expects an after_event signal`);
      const projections = signal.descriptor.projections ??= [];
      if (!projections.includes(mode)) projections.push(mode);
      const projectionInputs = signal.descriptor.projectionInputs ??= {};
      if (!projectionInputs[mode]) {
        const value = this.generatedName(`after_event_${mode}_value`, node.args[0].name);
        const ok = this.generatedName(`after_event_${mode}_ok`, node.args[0].name);
        const fault = this.generatedName(`after_event_${mode}_fault`, node.args[0].name);
        this.addInput(value, BOOL, node.loc);
        this.addInput(ok, BOOL, node.loc);
        this.addInput(fault, NUMBER, node.loc);
        projectionInputs[mode] = { value, ok, fault };
      }
      const inputs = projectionInputs[mode];
      return {
        type: resultType(BOOL, semanticType('SensorFault')),
        ok: `input.${inputs.ok}`, value: `input.${inputs.value}`,
        faultCode: `input.${inputs.fault}`, originTag: numberAtom(signal.originTag),
        origins: [{ tag: signal.originTag, nodeId: signal.originTag, kind: 'signal', name: node.args[0].name }],
        afterEventProjection: { signal: node.args[0].name, mode },
      };
    }
    if (node.name === 'ifthenelse') {
      error(node.loc, 'removed alias ifthenelse; use if condition then value else value');
    }
    if (node.name === 'elapsed' || node.name === 'hysteresis' || node.name === 'median') error(node.loc, `${node.name} is only valid in its declaration`);
    if (node.name === 'calendar_is') {
      if (node.args.length !== 2 || node.named.length) error(node.loc, 'calendar_is expects a calendar and one day classification');
      const calendarRef = node.args[0];
      const calendar = calendarRef.kind === 'reference' ? this.calendars.get(calendarRef.name) : null;
      if (!calendar) error(calendarRef.loc, 'calendar_is first argument must name a typed calendar');
      if (options.pureFunction) error(calendarRef.loc, `fn ${options.pureFunction} cannot capture global ${calendarRef.name}`);
      const selector = node.args[1];
      const match = selector.kind === 'literal' ? /^day`(workday|offday|holiday)`$/.exec(selector.raw) : null;
      if (!match) error(selector.loc, 'calendar_is requires day`workday`, day`offday` or day`holiday`');
      if (calendar.type !== (match[1] === 'holiday' ? 'HolidayCalendar' : 'WorkCalendar')) error(calendarRef.loc, 'calendar_is calendar type does not match day selector');
      const projectionInputs = Object.fromEntries(['ok', 'value', 'fault'].map(role => [role, this.generatedName(`calendar_${node.id}`, role)]));
      for (const role of ['ok', 'value', 'fault']) this.addInput(projectionInputs[role], role === 'fault' ? NUMBER : BOOL, node.loc);
      if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, node.loc); this.hasClock = true; }
      if (!this.gfbInputs.some(input => input[1] === `${RESERVED_PREFIX}time_epoch`)) this.addInput(`${RESERVED_PREFIX}time_epoch`, NUMBER, node.loc);
      (this.manifest.calendarConditions ??= []).push({ site: node.id, calendar: calendar.name, classification: match[1], timezone: 'UTC',
        result: { value: 'Bool', error: 'CalendarFault' }, projectionInputs });
      return { type: resultType(BOOL, semanticType('CalendarFault')), ok: `input.${projectionInputs.ok}`, value: `input.${projectionInputs.value}`,
        faultCode: `input.${projectionInputs.fault}`, originTag: numberAtom(node.id),
        origins: [{ tag: node.id, nodeId: node.id, kind: 'calendar-condition', name: 'calendar_is' }], sample: scanSample() };
    }
    if (node.name === 'tide_is' || node.name === 'moon_is') {
      if (node.args.length !== 2 || node.named.length) error(node.loc, `${node.name} expects a provider and one classification`);
      const providerRef = node.args[0];
      if (providerRef.kind !== 'reference') error(providerRef.loc, `${node.name} first argument must name a provider`);
      const provider = this.providers.get(providerRef.name);
      const providerType = node.name === 'tide_is' ? 'TidePredictions' : 'LunarEphemeris';
      if (!provider || provider.type !== providerType) error(providerRef.loc, `${node.name} requires a ${providerType} provider`);
      if (options.pureFunction) error(providerRef.loc, `fn ${options.pureFunction} cannot capture global ${providerRef.name}`);
      const classificationNode = node.args[1];
      const tag = node.name === 'tide_is' ? 'tide' : 'moon';
      const match = classificationNode.kind === 'literal'
        ? new RegExp(`^${tag}\x60([^\x60]*)\x60$`).exec(classificationNode.raw) : null;
      const allowed = node.name === 'tide_is'
        ? ['spring', 'neap']
        : ['new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous', 'full', 'waning_gibbous', 'last_quarter', 'waning_crescent'];
      if (!match || !allowed.includes(match[1])) error(classificationNode.loc, `${node.name} classification must be ${allowed.join(' or ')}`);
      const projectionInputs = {
        ok: this.generatedName(`natural_${node.id}`, 'ok'),
        value: this.generatedName(`natural_${node.id}`, 'value'),
        fault: this.generatedName(`natural_${node.id}`, 'fault'),
      };
      this.addInput(projectionInputs.ok, BOOL, node.loc);
      this.addInput(projectionInputs.value, BOOL, node.loc);
      this.addInput(projectionInputs.fault, NUMBER, node.loc);
      if (!this.hasClock) { this.addInput(`${RESERVED_PREFIX}now_ms`, NUMBER, node.loc); this.hasClock = true; }
      if (!this.gfbInputs.some(input => input[1] === `${RESERVED_PREFIX}time_epoch`)) this.addInput(`${RESERVED_PREFIX}time_epoch`, NUMBER, node.loc);
      const descriptor = {
        site: node.id, operation: node.name, provider: provider.name, classification: match[1],
        result: { value: 'Bool', error: 'TemporalContextFault' }, projectionInputs,
      };
      this.naturalConditions.push({ ...descriptor, loc: node.loc });
      (this.manifest.naturalConditions ??= []).push(descriptor);
      return {
        type: resultType(BOOL, semanticType('TemporalContextFault')),
        ok: `input.${projectionInputs.ok}`, value: `input.${projectionInputs.value}`,
        faultCode: `input.${projectionInputs.fault}`, originTag: numberAtom(node.id),
        origins: [{ tag: node.id, nodeId: node.id, kind: 'natural-condition', name: node.name }],
        sample: scanSample(),
      };
    }
    if (node.name === 'ok' || node.name === 'fault') {
      if (node.args.length !== 1 || node.named.length) error(node.loc, `${node.name} expects one argument`);
      if (expected?.kind !== 'Result') error(node.loc, `${node.name} requires an expected Result<T, E> type`);
      if (node.name === 'ok') {
        const payload = this.expression(node.args[0], locals, options, callStack, expected.value);
        if (!sameType(payload.type, expected.value)) error(node.args[0].loc, `ok payload must be ${typeNameOf(expected.value)}`);
        return { type: expected, ok: 'true', value: payload.sexpr, faultCode: '0', originTag: '0', origins: [], sample: scanSample() };
      }
      const reason = this.expression(node.args[0], locals, options, callStack, expected.error);
      if (!sameType(reason.type, expected.error)) error(node.args[0].loc, `fault reason must be ${typeNameOf(expected.error)}`);
      return {
        type: expected, ok: 'false', value: defaultLowered(expected.value).sexpr,
        faultCode: reason.sexpr, originTag: numberAtom(node.id),
        origins: [{ tag: node.id, nodeId: node.id, kind: 'fault' }], sample: scanSample(),
      };
    }
    if (node.name === 'rate') {
      if (expected?.kind !== 'Rate') error(node.loc, 'rate requires an expected Rate<Q> context');
      const named = new Map();
      for (const entry of node.named) {
        if (named.has(entry.name)) error(entry.loc, `duplicate rate argument ${entry.name}`);
        named.set(entry.name, entry);
      }
      if (node.args.length || node.named.length !== 2 || !named.has('delta') || !named.has('time')) error(node.loc, 'rate expects rate(delta: quantity, time: Duration)');
      const deltaType = expected.value.kind === 'Temperature' ? semanticType('TemperatureDelta') : expected.value;
      const delta = this.expression(named.get('delta').value, locals, options, callStack);
      if (!sameType(delta.type, deltaType)) error(named.get('delta').value.loc, expected.value.kind === 'Temperature'
        ? 'rate delta must be TemperatureDelta for Rate<Temperature>'
        : `rate delta must be ${typeNameOf(deltaType)} for ${typeNameOf(expected)}`);
      const time = this.expression(named.get('time').value, locals, options, callStack, DURATION);
      if (!sameType(time.type, DURATION)) error(named.get('time').value.loc, 'rate time must be Duration');
      if (time.constant !== undefined && time.constant <= 0) error(named.get('time').value.loc, 'rate time must be a positive Duration');
      const lowered = ['div', delta.sexpr, ['div', time.sexpr, '1000']];
      const constant = delta.constant === undefined || time.constant === undefined ? undefined : delta.constant / (time.constant / 1000);
      if (constant !== undefined && !Number.isFinite(constant)) error(node.loc, 'constant arithmetic result is not finite');
      return { type: expected, sexpr: lowered, constant };
    }
    if (node.name === 'number') {
      if (node.args.length !== 1 || node.named.length) error(node.loc, 'number expects one Int argument');
      const value = this.expression(node.args[0], locals, options, callStack, INT);
      if (!sameType(value.type, INT)) error(node.args[0].loc, 'number argument must be Int');
      return {
        type: NUMBER,
        sexpr: value.constant === undefined ? ['int-to-number', value.sexpr] : numberAtom(value.constant),
        constant: value.constant,
      };
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
      return {
        type: INT,
        sexpr: constant === undefined ? [node.name.replaceAll('_', '-'), value.sexpr] : ['int', String(constant)],
        constant,
      };
    }
    const fn = this.functions.get(node.name); if (!fn) error(node.loc, `unknown function ${node.name}`);
    if (node.named.length || node.args.length !== fn.params.length) error(node.loc, `function ${node.name} expects ${fn.params.length} arguments`);
    if (callStack.includes(node.name)) error(node.loc, `recursive fn ${node.name} is not supported`);
    const args = node.args.map((arg, index) => this.expression(arg, locals, options, callStack, fn.params[index]?.resolvedType));
    for (let i = 0; i < args.length; i++) if (!sameType(args[i].type, fn.params[i].resolvedType)) error(node.args[i].loc, `argument ${i + 1} to ${node.name} must be ${fn.params[i].resolvedType.kind}`);
    const scope = new Map(); for (let i = 0; i < args.length; i++) scope.set(fn.params[i].name, args[i]);
    const value = this.expression(fn.body, scope, { ...options, pureFunction: node.name }, [...callStack, node.name], fn.resultType); if (!sameType(value.type, fn.resultType)) error(fn.loc, `function ${node.name} returns ${value.type.kind}, expected ${fn.resultType.kind}`); return value;
  }
  caseExpression(node, locals, options, callStack, expected = null) {
    const value = this.expression(node.value, locals, options, callStack);
    if (value.type.kind === 'Result') return this.resultCase(node, value, locals, options, callStack, expected);
    if (!this.types.has(value.type.kind)) error(node.value.loc, 'case requires an enum or sensor/signal result');
    const members = this.types.get(value.type.kind); const byName = new Map(); for (const branch of node.branches) { if (branch.binding !== null) error(branch.loc, 'enum case members do not take bindings'); if (!members.has(branch.name)) error(branch.loc, `unknown ${value.type.kind} member ${branch.name}`); if (byName.has(branch.name)) error(branch.loc, `duplicate case member ${branch.name}`); byName.set(branch.name, branch); }
    if (byName.size !== members.size) error(node.loc, `case for ${value.type.kind} must be exhaustive`);
    let result = null, resultType = null;
    for (const [member, ordinal] of [...members.entries()].reverse()) {
      const branch = byName.get(member); const body = this.expression(branch.body, locals, options, callStack, expected ?? resultType); if (resultType && !sameType(resultType, body.type)) error(branch.loc, 'case branches must have the same type'); resultType = body.type;
      result = result ? selectLowered(['eq', value.sexpr, String(ordinal)], body, result) : body;
    }
    return result;
  }
  resultCase(node, value, locals, options, callStack, expected = null) {
    const byName = new Map();
    for (const branch of node.branches) { if (!['ok', 'fault'].includes(branch.name)) error(branch.loc, 'Result case supports only ok(...) and fault(...)'); if (byName.has(branch.name)) error(branch.loc, `duplicate ${branch.name} branch`); if (branch.binding === null) error(branch.loc, `${branch.name} branch requires a binding`); byName.set(branch.name, branch); }
    if (!byName.has('ok') || !byName.has('fault')) error(node.loc, 'Result case must handle ok(...) and fault(...)');
    const ok = byName.get('ok'), fault = byName.get('fault');
    if (ok.binding !== '_') rejectName(ok.binding, ok.loc, 'case binding');
    if (fault.binding !== '_') rejectName(fault.binding, fault.loc, 'case binding');
    const okScope = new Map(locals); if (ok.binding !== '_') okScope.set(ok.binding, { type: value.type.value, sexpr: value.value });
    const faultScope = new Map(locals); if (fault.binding !== '_') faultScope.set(fault.binding, { type: value.type.error, sexpr: value.faultCode });
    const yes = this.expression(ok.body, okScope, options, callStack, expected);
    const no = this.expression(fault.body, faultScope, options, callStack, expected ?? yes.type);
    if (!sameType(yes.type, no.type)) error(node.loc, 'case branches must have the same type');
    const selected = selectLowered(value.ok, yes, no);
    if (selected.type.kind === 'Result') return selected;
    const site = this.recordResultSite(node, 'case', value.type.error.kind, value.origins, options);
    return {
      ...selected,
      sexpr: ['trace-result', String(site), selected.sexpr,
        ['if', value.ok, '0', ['add', value.faultCode, '1']],
        ['if', value.ok, '0', value.originTag]],
    };
  }
  transitionForms() {
    const forms = [];
    for (const [name, state] of this.states) { const next = this.nexts.get(name); forms.push(['next', name, next ? next.value.sexpr : `state.${name}`]); }
    for (const timer of this.timers.values()) {
      const now = `input.${RESERVED_PREFIX}now_ms`;
      if (timer.mode === 'continuous-true') {
        forms.push(['next', timer.sinceState, ['if', ['not', timer.condition], now,
          ['if', ['not', `state.${timer.trackingState}`], now, `state.${timer.sinceState}`]]]);
        forms.push(['next', timer.trackingState, timer.condition]);
      } else {
        const candidate = this.nexts.get(timer.state)?.value.sexpr ?? `state.${timer.state}`;
        const unchanged = ['eq', candidate, `state.${timer.state}`];
        forms.push(['next', timer.sinceState, ['if', ['not', `state.${timer.trackingState}`], now,
          ['if', unchanged, `state.${timer.sinceState}`, now]]]);
        forms.push(['next', timer.trackingState, 'true']);
      }
    }
    for (const signal of this.signals.values()) if (signal.next) {
      for (const [role, value] of Object.entries(signal.next)) forms.push(['next', signal.states[role], value]);
      for (const [name, value] of signal.sourceNext ?? []) forms.push(['next', name, value]);
    }
    return forms;
  }
  trueForForms() {
    return this.trueFors.map(({ descriptor }) => [
      'true-for', String(descriptor.site), descriptor.name,
      String(descriptor.sources[0].tag), descriptor.sources[0].name,
      numberAtom(descriptor.durationMs),
      ['interval-inputs', ...['present', 'epoch', 'id', 'start', 'end', 'value', 'quality', 'fault'].map(field => descriptor.intervalInputs[field])],
    ]);
  }
  solarForms() {
    return this.manifest.schedules.filter(schedule => schedule.kind === 'solar' && !this.configStreams.length
      || ['daily', 'daily-slots'].includes(schedule.kind) && schedule.policy.basis === 'pulse'
        && schedule.policy.clock === 'trusted_only' && !schedule.day && !schedule.selectedConfig).map(schedule => schedule.kind === 'daily' ? [
      'daily-pulse', String(schedule.site), schedule.name, schedule.timezone, String(schedule.atMs),
      schedule.dstMissing, schedule.dstRepeated, schedule.policy.basis, schedule.policy.clock,
      String(schedule.policy.gapMs), schedule.policy.recovery, schedule.policy.fallback, schedule.policy.when,
    ] : schedule.kind === 'daily-slots' ? [
      'daily-slots-pulse', String(schedule.site), schedule.name, schedule.timezone, String(schedule.gridMs),
      schedule.dstMissing, schedule.dstRepeated, schedule.policy.basis, schedule.policy.clock,
      String(schedule.policy.gapMs), schedule.policy.recovery, schedule.policy.fallback,
      ['slots', ...schedule.slots.map(minute => ['slot', String(minute + 1), String(minute)])], schedule.policy.when,
    ] : [
      'solar-pulse', String(schedule.site), schedule.name, schedule.timezone,
      String(schedule.latitude), String(schedule.longitude), schedule.event,
      String(schedule.offsetMs), schedule.policy.basis, 'trusted_only',
      String(schedule.policy.gapMs), schedule.policy.recovery, 'skip',
      schedule.policy.when,
      ...(typeof schedule.policy.clock === 'object' || typeof schedule.policy.fallback === 'object'
        ? [String(schedule.policy.clock.durationMs ?? 0), String(schedule.policy.fallback.atMs ?? 86400000)] : []),
    ]);
  }
  contextForms() {
    const configForms = this.configStreams.map(stream => {
      const config = this.manifest.configs.find(item => item.id === stream.id);
      if (!config) internal(`missing config stream ${stream.name}`);
      const type = stream.type;
      const payload = type.kind === 'TimeSlots'
        ? ['slots', String(type.gridMs), String(type.capacity), ...config.value.map(ms => String(ms / 60_000))]
        : ['scalar', gfbDefault(type, config.value), config.settings?.min === undefined ? 'none'
          : ['bounds', ...['min', 'max', 'step'].map(key => gfbDefault(type, config.settings[key]))]];
      const inputs = stream.resultInputs;
      return ['config-stream', String(stream.id), stream.name, config.type, type.kind,
        config.settings?.access === 'operator' ? 'true' : 'false', payload,
        inputs?.ok ?? 'none', inputs?.value ?? 'none', inputs?.fault ?? 'none'];
    });
    const scheduleForms = this.manifest.schedules.filter(schedule => schedule.kind === 'solar' && this.configStreams.length
      || schedule.kind === 'at' || schedule.policy?.basis?.kind === 'range'
      || ['periodic', 'cron', 'tide'].includes(schedule.kind)
      || schedule.kind === 'daily' && schedule.day?.calendar
      || schedule.kind === 'daily-slots' && schedule.selectedConfig).map(schedule => {
      const base = [String(schedule.site), schedule.name, String(schedule.policy.gapMs)];
      const when = schedule.policy.when, cancel = schedule.policy.cancelWhen ?? 'false';
      if (schedule.kind === 'solar') {
        const atoms = new Set();
        const collect = value => { if (Array.isArray(value)) value.forEach(collect);
          else for (const atom of String(value).match(/[^\s()]+/g) ?? []) atoms.add(atom); };
        collect(when);
        const deps = this.configStreams.filter(stream => stream.resultInputs
          && Object.values(stream.resultInputs).some(input => atoms.has(`input.${input}`)))
          .map(stream => stream.id).sort((a, b) => a - b);
        schedule.configIds = deps;
        return ['solar-context-pulse', ...base, schedule.timezone, String(schedule.latitude), String(schedule.longitude),
          schedule.event, String(schedule.offsetMs), String(schedule.policy.fallback.atMs ?? 86400000),
          ['config-deps', ...deps.map(String)], when, cancel, String(schedule.policy.clock.durationMs ?? 0)];
      }
      if (schedule.kind === 'at') return ['at-pulse', ...base, String(schedule.atMs), when, cancel];
      if (schedule.policy.basis?.kind === 'range') {
        if (schedule.timezone !== 'UTC' || schedule.selectedConfig
          || !['daily', 'daily-slots'].includes(schedule.kind)) error(this.ast.loc, 'executable Range requires immutable UTC Daily or DailySlots');
        const starts = schedule.kind === 'daily' ? [schedule.atMs] : schedule.slots.map(minute => minute * 60_000);
        if (schedule.day) return ['calendar-range', ...base, 'UTC', String(schedule.policy.basis.durationMs), ['starts', ...starts.map(String)],
          schedule.day.calendar, schedule.day.kind, when, cancel];
        return ['utc-range', ...base, 'UTC', String(schedule.policy.basis.durationMs), ['starts', ...starts.map(String)], when, cancel];
      }
      if (schedule.kind === 'periodic') {
        const config = this.manifest.configs.find(item => item.id === schedule.every.configId);
        if (config && config.type !== 'Duration' || schedule.anchor.kind !== 'instant'
          || schedule.intervalChange !== 'preserve_anchor' || schedule.policy.basis !== 'pulse') {
          error(this.ast.loc, 'Periodic executable slice requires instant anchor, Duration interval and preserve_anchor pulse');
        }
        return ['periodic-pulse', ...base, `instant:${schedule.anchor.instantMs}`, String(schedule.anchor.instantMs),
          String(config?.id ?? 0), ...(config ? [] : [String(schedule.every.initialMs)]), when, cancel];
      }
      if (schedule.kind === 'cron') {
        if (schedule.policy.basis !== 'pulse') error(this.ast.loc, 'Cron executable slice requires pulse');
        return ['cron-pulse', ...base, schedule.timezone, schedule.dstMissing, schedule.dstRepeated,
          ...schedule.fields.map((field, index) => ['field', ...(field ?? Array.from({ length: [60, 24, 31, 12, 7][index] }, (_, at) => at + (index === 2 || index === 3 ? 1 : 0)))]), when, cancel];
      }
      if (schedule.kind === 'daily') {
        if (schedule.policy.basis !== 'pulse') error(this.ast.loc, 'calendar Daily executable slice requires pulse');
        if (schedule.day.kind === 'holiday') return ['holiday-daily-pulse', ...base, schedule.timezone,
          String(schedule.atMs), schedule.day.calendar, schedule.dstMissing, schedule.dstRepeated, when, cancel];
        return ['calendar-daily-pulse', ...base, schedule.timezone, String(schedule.atMs), schedule.day.calendar,
          schedule.day.kind, schedule.dstMissing, schedule.dstRepeated, when, cancel];
      }
      if (schedule.kind === 'tide') {
        if (schedule.policy.basis?.kind !== 'run') error(this.ast.loc, 'Tide executable slice requires Run basis');
        return ['tide-run', ...base, schedule.timezone, schedule.source, schedule.event, String(schedule.offsetMs),
          String(schedule.policy.basis.durationMs), String(schedule.policy.basis.admission.durationMs), when, cancel,
          ...(typeof schedule.policy.clock === 'object' ? [String(schedule.policy.clock.durationMs)] : [])];
      }
      const config = this.manifest.configs.find(item => item.name === schedule.selectedConfig);
      if (!config || schedule.policy.basis !== 'pulse') error(this.ast.loc, 'TimeSlots executable slice requires config and pulse');
      return ['config-daily-slots-pulse', ...base, schedule.timezone, String(config.id),
        schedule.dstMissing, schedule.dstRepeated, when, cancel];
    });
    const naturalForms = this.manifest.naturalConditions?.map(condition => [
      'natural-result', String(condition.site), `natural_${condition.site}`,
      condition.operation === 'tide_is' ? 'tide' : 'moon', condition.provider, condition.classification,
      condition.projectionInputs.ok, condition.projectionInputs.value, condition.projectionInputs.fault,
    ]) ?? [];
    const accountingForms = this.accountingResults.map(account => [
      'accounting-result', String(account.site), `accounting_${account.site}`, account.name,
      account.evidenceBinding.target, account.basis.zone,
      account.resultInputs.ok, account.resultInputs.value, account.resultInputs.fault,
    ]);
    const calendarForms = (this.manifest.calendarConditions ?? []).map(condition => ['calendar-result', String(condition.site), `calendar_${condition.site}`,
      condition.calendar, condition.classification, condition.timezone,
      ...['ok','value','fault'].map(role => condition.projectionInputs[role])]);
    return [...configForms, ...scheduleForms, ...naturalForms, ...accountingForms, ...calendarForms];
  }
  windowForms() {
    return this.windows.map(({ descriptor, source, sample, outputType }) => [
      'window', String(descriptor.site), descriptor.name, descriptor.operation, gfbType(outputType),
      numberAtom(descriptor.overMs), numberAtom(descriptor.maxAgeMs),
      ['roots', ...descriptor.sources.map(root => String(root.tag))],
      ['source', source.ok, source.value, source.faultCode, source.originTag, sample.quality, sample.sourceTag],
    ]);
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
    if (this.gfbStates.length + this.windows.length + this.trueFors.length
      + this.manifest.schedules.filter(schedule => ['solar', 'daily'].includes(schedule.kind)).length > STATE_LIMIT) error(this.ast.loc, 'temporal state limit exceeded');
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

const LINEAR_QUANTITIES = new Set([
  'TemperatureDelta', 'Pressure', 'VaporPressureDeficit', 'FlowRate', 'Volume',
  'Length', 'Irradiance', 'PPFD', 'Energy', 'Power', 'ElectricalCurrent',
  'Voltage', 'Conductivity',
]);

function arithmeticRule(op, left, right, loc) {
  if (left.kind === 'DateTime' && right.kind === 'Duration' && (op === '+' || op === '-')) return { type: semanticType('DateTime') };
  if (isTimeType(left.kind) || isTimeType(right.kind)) error(loc, `${op} is not defined for ${left.kind} and ${right.kind}`);
  if (!isNumeric(left) || !isNumeric(right)) error(loc, `${op} requires numeric operands`);
  if (isQuantityType(left.kind) || isQuantityType(right.kind)) {
    const result = kind => ({ type: semanticType(kind) });
    if (op === '/' && left.kind === 'RelativeHumidity' && right.kind === 'RelativeHumidity') return result('Number');
    if (op === '-' && left.kind === 'Temperature' && right.kind === 'Temperature') return result('TemperatureDelta');
    if ((op === '+' || op === '-') && left.kind === 'Temperature' && right.kind === 'TemperatureDelta') return result('Temperature');
    if ((op === '+' || op === '-') && sameType(left, right) && LINEAR_QUANTITIES.has(left.kind)) return result(left.kind);
    if (op === '*' && sameType(left, NUMBER) && LINEAR_QUANTITIES.has(right.kind)) return result(right.kind);
    if (op === '*' && sameType(right, NUMBER) && LINEAR_QUANTITIES.has(left.kind)) return result(left.kind);
    if (op === '/' && sameType(right, NUMBER) && LINEAR_QUANTITIES.has(left.kind)) return result(left.kind);
    if (op === '/' && sameType(left, right) && LINEAR_QUANTITIES.has(left.kind)) return result('Number');
    if (op === '*' && ((left.kind === 'FlowRate' && right.kind === 'Duration') || (right.kind === 'FlowRate' && left.kind === 'Duration'))) return { type: semanticType('Volume'), durationOperand: left.kind === 'Duration' ? 'left' : 'right' };
    if (op === '/' && left.kind === 'Volume' && right.kind === 'Duration') return { type: semanticType('FlowRate'), durationOperand: 'right' };
    if (op === '*' && ((left.kind === 'Power' && right.kind === 'Duration') || (right.kind === 'Power' && left.kind === 'Duration'))) return { type: semanticType('Energy'), durationOperand: left.kind === 'Duration' ? 'left' : 'right' };
    if (op === '/' && left.kind === 'Energy' && right.kind === 'Duration') return { type: semanticType('Power'), durationOperand: 'right' };
    if (op === '*' && ((left.kind === 'Voltage' && right.kind === 'ElectricalCurrent') || (right.kind === 'Voltage' && left.kind === 'ElectricalCurrent'))) return result('Power');
    error(loc, `${op} is not defined for ${left.kind} and ${right.kind}`);
  }
  if (left.kind === 'Int' || right.kind === 'Int') {
    if (!sameType(left, right)) error(loc, `${op} does not implicitly mix ${left.kind} and ${right.kind}`);
    if (op === '/') error(loc, '/ is not defined for Int operands; use div or convert both operands to Number');
    if (['+', '-', '*', 'div', '%'].includes(op)) return { type: INT };
  }
  if (op === 'div' || op === '%') error(loc, `${op} requires Int operands`);
  if (op === '+' || op === '-') { if (!sameType(left, right)) error(loc, `${op} does not implicitly mix ${left.kind} and ${right.kind}`); return { type: left }; }
  if (op === '*') { if (sameType(left, NUMBER)) return { type: right }; if (sameType(right, NUMBER)) return { type: left }; error(loc, '* requires a Number scale factor'); }
  if (op === '/') { if (sameType(right, NUMBER)) return { type: left }; if (sameType(left, right)) return { type: NUMBER }; error(loc, '/ requires a Number divisor or matching units'); }
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
  if (head === 'window-read' || head === 'true-for-read' || head === 'schedule-read') return 1;
  if (['not', 'check-duration', 'check-datetime', 'int-neg', 'int-to-number', 'int-exact', 'int-floor', 'int-ceil', 'int-trunc', 'int-nearest-even'].includes(head)) return expressionStack(args[0]);
  if (head === 'if') {
    const condition = expressionStack(args[0]); const yes = expressionStack(args[1]); const no = expressionStack(args[2]);
    return Math.max(condition, 1 + yes, 2 + no);
  }
  if (head === 'trace-result') {
    const payload = expressionStack(args[1]), choice = expressionStack(args[2]), origin = expressionStack(args[3]);
    return Math.max(payload, 1 + choice, 2 + origin);
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

function checkResourcePolicy(ast) {
  const resources = new Map(), constraints = new Set(), policyNames = new Set();
  for (const resource of ast.resources) {
    rejectName(resource.name, resource.loc, 'resource');
    if (resources.has(resource.name)) error(resource.loc, `duplicate resource ${resource.name}`);
    if (!(ast.inline ? ['Station', 'BoolActuator', 'ContinuousActuator'] : ['Station', 'BoolActuator']).includes(resource.type)) error(resource.loc, `unsupported resource type ${resource.type}`);
    if (ast.inline && resource.typeArgs) error(resource.loc, 'shared resource declarations require a finite concrete resource type');
    resources.set(resource.name, resource.type);
  }
  const finiteSet = (members, loc, type) => {
    const seen = new Set();
    if (members.length > 128) error(loc, 'finite resource set exceeds 128 members');
    return members.map(member => {
      if (seen.has(member.name)) error(member.loc, `duplicate resource ${member.name} in finite set`);
      seen.add(member.name);
      if (!resources.has(member.name)) error(member.loc, `unknown resource ${member.name}`);
      if (resources.get(member.name) !== type) error(member.loc, `${member.name} must be a ${type} resource`);
      return member.name;
    });
  };
  const term = node => {
    if (node.kind === 'count_on' || node.kind === 'any_on') {
      const names = finiteSet(node.resources, node.loc, 'BoolActuator');
      return { type: node.kind === 'count_on' ? 'Int' : 'Bool', value: {
        kind: node.kind, resources: names,
        ...(names.length ? {} : { constant: node.kind === 'count_on' ? 0 : false }),
      } };
    }
    if (node.kind === 'resource-on') {
      if (!resources.has(node.resource)) error(node.loc, `unknown resource ${node.resource}`);
      if (resources.get(node.resource) !== 'BoolActuator') error(node.loc, `${node.resource} must be a BoolActuator resource`);
      return { type: 'Bool', value: { kind: 'resource-on', resource: node.resource } };
    }
    if (node.kind === 'Int' || node.kind === 'Bool') return { type: node.kind, value: { kind: node.kind, value: node.value } };
    const left = term(node.left), right = term(node.right);
    if (left.type !== right.type) error(node.loc, `constraint ${node.op} requires matching types`);
    if (node.kind === 'implies' && left.type !== 'Bool') error(node.loc, 'constraint implication requires Bool terms');
    if (node.kind === 'compare' && !['==', '!='].includes(node.op) && left.type !== 'Int') {
      error(node.loc, `constraint ${node.op} requires Int terms`);
    }
    return { type: 'Bool', value: { kind: node.kind, op: node.op, left: left.value, right: right.value } };
  };
  const groups = ast.constraints.map(group => {
    rejectName(group.name, group.loc, 'constraints');
    if (constraints.has(group.name)) error(group.loc, `duplicate constraints ${group.name}`);
    constraints.add(group.name);
    if (!resources.has(group.target)) error(group.loc, `unknown resource ${group.target}`);
    if (!(ast.inline ? ['Station', 'BoolActuator'] : ['Station']).includes(resources.get(group.target))) {
      error(group.loc, `constraints target ${group.target} must be a ${ast.inline ? 'Station or BoolActuator' : 'Station'} resource`);
    }
    const rules = group.rules.map(rule => {
      if (rule.kind === 'exclusive') {
        if (rule.members.length < 2) error(rule.loc, 'exclusive requires at least two modes');
        if (rule.members.length > 128) error(rule.loc, 'exclusive finite mode set exceeds 128 members');
        const seen = new Set();
        const members = rule.members.map(member => {
          rejectName(member.name, member.loc, 'mode');
          if (seen.has(member.name)) error(member.loc, `duplicate exclusive mode ${member.name}`);
          seen.add(member.name); return member.name;
        });
        return { kind: rule.kind, stage: rule.stage, members,
          ...(ast.inline ? { source: { nodeId: rule.id, ...rule.loc } } : {}) };
      }
      const predicate = term(rule.predicate);
      if (predicate.type !== 'Bool') error(rule.loc, 'require predicate must be Bool');
      return { kind: rule.kind, stage: rule.stage, predicate: predicate.value,
        ...(ast.inline ? { source: { nodeId: rule.id, ...rule.loc } } : {}) };
    });
    if (ast.inline || group.safe !== undefined) {
      if (!Array.isArray(group.safe)) error(group.loc, 'shared resource constraints require an authored safe vector');
      const outputs = new Set(resources.get(group.target) === 'BoolActuator' ? [group.target] : []);
      const refs = node => {
        if (node.resources) for (const name of node.resources) outputs.add(name);
        if (node.kind === 'resource-on') outputs.add(node.resource);
        if (node.left) refs(node.left);
        if (node.right) refs(node.right);
      };
      for (const rule of rules) if (rule.kind === 'require') refs(rule.predicate);
      const safeValues = new Map();
      if (group.safe.length > 128 || outputs.size > 128) error(group.loc, 'authored safe vector exceeds 128 resources');
      const safe = group.safe.map(entry => {
        if (safeValues.has(entry.resource)) error(entry.loc, `duplicate safe resource ${entry.resource}`);
        if (!resources.has(entry.resource)) error(entry.loc, `unknown safe resource ${entry.resource}`);
        if (resources.get(entry.resource) !== 'BoolActuator') error(entry.loc, `safe resource ${entry.resource} must be a BoolActuator`);
        if (!outputs.has(entry.resource)) error(entry.loc, `safe resource ${entry.resource} is outside the protected finite output set`);
        if (typeof entry.value !== 'boolean') error(entry.loc, 'safe value must be a literal Bool');
        safeValues.set(entry.resource, entry.value);
        return { resource: entry.resource, value: entry.value,
          ...(ast.inline ? { source: { nodeId: entry.id, ...entry.loc } } : {}) };
      });
      for (const output of outputs) if (!safeValues.has(output)) error(group.loc, `authored safe vector is missing protected resource ${output}`);
      const evaluate = node => {
        if (node.kind === 'Bool' || node.kind === 'Int') return node.value;
        if (node.kind === 'resource-on') return safeValues.get(node.resource);
        if (node.kind === 'count_on') return node.resources.filter(name => safeValues.get(name)).length;
        if (node.kind === 'any_on') return node.resources.some(name => safeValues.get(name));
        const left = evaluate(node.left), right = evaluate(node.right);
        switch (node.op) {
          case '=>': return !left || right;
          case '==': return left === right;
          case '!=': return left !== right;
          case '<': return left < right;
          case '<=': return left <= right;
          case '>': return left > right;
          case '>=': return left >= right;
          default: error(group.loc, 'unsupported finite safe predicate');
        }
      };
      for (const rule of rules) if (rule.kind === 'require' && !evaluate(rule.predicate)) {
        error(group.loc, 'authored safe vector does not satisfy every mandatory require at safe_output');
      }
      return { name: group.name, target: group.target, scope: 'shared_resource', rules, safe,
        modes: [...new Set(rules.filter(rule => rule.kind === 'exclusive').flatMap(rule => rule.members))],
        outputs: [...outputs], ...(ast.inline ? { source: { nodeId: group.id, ...group.loc } } : {}) };
    }
    return { name: group.name, target: group.target, rules };
  });
  const policies = (ast.resourcePolicies ?? []).map(policy => {
    rejectName(policy.name, policy.loc, 'resource policy');
    if (policyNames.has(policy.name) || constraints.has(policy.name)) error(policy.loc, `duplicate policy name ${policy.name}`);
    policyNames.add(policy.name);
    if (!resources.has(policy.target)) error(policy.loc, `unknown resource ${policy.target}`);
    if (resources.get(policy.target) !== 'BoolActuator') error(policy.loc, `resource policy target ${policy.target} must be a BoolActuator`);
    const lease = policy.fields.lease.value;
    if (lease.value !== 'session') error(lease, 'lease must be session');
    const concurrencyToken = policy.fields.concurrency.value;
    if (concurrencyToken.kind !== 'number' || !/^\d+$/.test(concurrencyToken.value)
      || Number(concurrencyToken.value) < 1 || Number(concurrencyToken.value) > 2147483647) {
      error(concurrencyToken, 'concurrency must be a positive static Int');
    }
    const admission = policy.fields.admission.value;
    if (admission.value !== 'reserve_all') error(admission, 'admission must be reserve_all');
    const queueNode = policy.fields.queue.value;
    let queue;
    if (queueNode.kind === 'reject') queue = { kind: 'reject' };
    else {
      const maxToken = queueNode.fields.max.value;
      if (maxToken.kind !== 'number' || !/^\d+$/.test(maxToken.value)
        || Number(maxToken.value) < 1 || Number(maxToken.value) > 2147483647) {
        error(maxToken, 'queue max must be a positive static Int');
      }
      const expiryToken = queueNode.fields.expires_after.value;
      const expiresAfterMs = expiryToken.kind === 'number' ? duration(expiryToken.value, expiryToken) : null;
      if (!Number.isSafeInteger(expiresAfterMs) || expiresAfterMs <= 0) error(expiryToken, 'queue expiry must be a positive Duration');
      const tie = queueNode.fields.tie.value;
      if (tie.kind !== 'identifier' || tie.value !== 'request_id') error(tie, 'queue tie must be request_id');
      queue = { kind: queueNode.kind, max: Number(maxToken.value), expiresAfterMs, tie: tie.value };
    }
    const preemptNode = policy.fields.preempt.value;
    let preempt;
    if (preemptNode.kind === 'never') preempt = 'never';
    else {
      const cleanup = preemptNode.fields.cleanup.value;
      const resume = preemptNode.fields.resume.value;
      if (cleanup.value !== 'required') error(cleanup, 'higher_authority cleanup must be required');
      if (!['requeue', 'cancel'].includes(resume.value)) error(resume, 'higher_authority resume must be requeue or cancel');
      preempt = { kind: 'higher_authority', cleanup: cleanup.value, resume: resume.value };
    }
    return { name: policy.name, target: policy.target, lease: lease.value,
      concurrency: Number(concurrencyToken.value), admission: admission.value, queue, preempt };
  });
  return { format: 'GhostFlow/resource-policy-v1', resources: [...resources].map(([name, type]) => ({ name, type })),
    constraints: groups, ...(policies.length ? { resourcePolicies: policies } : {}) };
}

/** Compile control source to existing GFB1 bytes plus its host-only companion manifest. */
export function compileControl(source, { filename = '<control>', emitBytecode = true } = {}) {
  if (typeof filename !== 'string' || !filename) internal('filename must be a non-empty string');
  const ast = new ControlParser(source, filename).parse();
  if (ast.kind === 'control' && ast.body.some(item => item.kind === 'shared-constraints')) {
    error(ast.body.find(item => item.kind === 'shared-constraints').loc,
      'shared resource constraints require resource binding and runtime enforcement; compile a checked nonexecutable descriptor');
  }
  if (ast.kind === 'resource-policy') {
    checkResourcePolicy(ast);
    error(ast.loc, ast.resourcePolicies?.length
      ? 'resource policy execution requires bounded queue and resource runtime binding'
      : 'named constraints require resource binding and runtime enforcement');
  }
  const lowered = new Lowerer(ast, filename).lower({ emitBytecode });
  if (lowered.manifest.signals.some(signal => signal.kind === 'after-event'
    && !signal.projections?.length)) {
    error(ast.loc, 'after_event requires an explicit after_event_any or after_event_all projection');
  }
  return lowered;
}

/** Compile the bounded accounting slice to one executable GFB10 control. */
export function compileAccountingControl(source, { filename = '<control>' } = {}) {
  if (typeof filename !== 'string' || !filename) internal('filename must be a non-empty string');
  const ast = new ControlParser(source, filename).parse();
  if (ast.kind !== 'control' || !ast.body.some(item => item.kind === 'account' || item.kind === 'account-constraints')) {
    error(ast.loc, 'expected a control with accounting declarations');
  }
  return new Lowerer(ast, filename).lower({ emitBytecode: true, accountingExecution: true });
}

/** Only this bounded civil pulse slice has a VM/provider transport. */
export function isExecutablePulseSchedule(item) {
  return item.scheduleType === 'Solar' || item.scheduleType === 'At' || (item.scheduleType === 'Daily'
    && (!item.on && !item.calendar || item.on && item.calendar && ['day`workday`', 'day`offday`', 'day`holiday`'].includes(item.on.value))
    && item.at?.kind === 'literal' && item.at.raw.startsWith('time`')
    && item.policy?.basis?.name === 'pulse' && item.policy?.clock?.name === 'trusted_only')
    || (item.scheduleType === 'DailySlots' && item.selected
    && item.policy?.basis?.name === 'pulse' && item.policy?.clock?.name === 'trusted_only')
    || (item.scheduleType === 'Periodic' && item.anchor?.kind === 'call' && item.anchor.name === 'instant'
    && item.interval_change?.name === 'preserve_anchor'
    && item.policy?.basis?.name === 'pulse' && item.policy?.clock?.name === 'trusted_only')
    || (item.scheduleType === 'Cron' && item.policy?.basis?.name === 'pulse'
    && item.policy?.clock?.name === 'trusted_only')
    || (item.scheduleType === 'Tide' && item.policy?.basis?.name === 'run'
    && ['trusted_only', 'hold_trusted'].includes(item.policy?.clock?.name));
}

/** Immutable UTC recurrence only; other accepted Range variants stay descriptors. */
export function isExecutableRangeSchedule(item) {
  return item.timezone === 'UTC' && item.policy?.basis?.kind === 'call'
    && item.policy.basis.name === 'range' && item.policy?.clock?.name === 'trusted_only'
    && (item.scheduleType === 'Daily' && (!item.on && !item.calendar || item.on && item.calendar && ['day`workday`','day`offday`'].includes(item.on.value))
      && item.at?.kind === 'literal' && item.at.raw.startsWith('time`')
      || item.scheduleType === 'DailySlots' && Array.isArray(item.selected) && item.selected.length > 0);
}

/** Internal composition adapter. The public API accepts canonical documents. */
export function compileComposedControl(ast, filename) {
  return new Lowerer(ast, filename).lower();
}

/** Compile a standalone host policy to a checked, non-control artifact. */
export function compileResourcePolicyArtifact(source, { filename = '<policy>' } = {}) {
  if (typeof filename !== 'string' || !filename) internal('filename must be a non-empty string');
  const ast = new ControlParser(source, filename).parse();
  if (ast.kind !== 'resource-policy') error(ast.loc, 'expected standalone resource policy document');
  const manifest = checkResourcePolicy(ast);
  const bytes = new TextEncoder().encode(JSON.stringify({
    format: 'GhostFlow/resource-policy-artifact-v1',
    policy: manifest,
  }));
  return { bytes, manifest, sourceMap: ast.sourceNodes };
}

/** Checked in-control shared resource contract; it cannot be installed as GFB. */
export function compileControlPolicyDescriptorArtifact(source, { filename = '<control>' } = {}) {
  const ast = new ControlParser(source, filename).parse();
  if (ast.kind !== 'control' || !ast.body.some(item => item.kind === 'shared-constraints')) {
    error(ast.loc, 'expected a control with shared resource constraints');
  }
  const checked = new Lowerer(ast, filename).lower({ emitBytecode: false });
  const manifest = { format: 'GhostFlow/control-policy-descriptor-v1', executable: false,
    requiredRuntimeContracts: ['bound-shared-resources', 'admission-exclusivity', 'safe-output-resource-requirements'],
    control: checked.manifest };
  const bytes = new TextEncoder().encode(JSON.stringify({
    format: 'GhostFlow/control-policy-descriptor-artifact-v1', executable: false,
    controlSource: source, manifest,
  }));
  // A checked descriptor carries canonical intent provenance, but owns no
  // executable storage bindings or runtime constraint observations. The bound
  // compiler supplies those from the actual guarded request program.
  return { bytes, manifest, sourceMap: checked.sourceMap,
    traceMetadata: { bindings: [], constraints: [], resultSites: [] } };
}

/** Internal bound-profile lowering. Never returns an unguarded shared-policy program. */
export function compileBoundControlPolicyArtifact(source, { filename, envelope } = {}) {
  const ast = new ControlParser(source, filename).parse();
  if (ast.kind !== 'control' || !ast.body.some(item => item.kind === 'shared-constraints')) {
    error(ast.loc, 'bound resource execution requires an in-control shared policy');
  }
  const checked = new Lowerer(ast, filename).lower({ emitBytecode: false });
  const requestAst = { ...ast, body: ast.body.filter(item => !['shared-constraints', 'resource'].includes(item.kind)) };
  const candidate = new Lowerer(requestAst, filename).lower();
  if (![1, 3].includes(new DataView(candidate.bytes.buffer, candidate.bytes.byteOffset).getUint16(4, true))
    || checked.manifest.outputs.some(port => port.type !== 'Bool')
    || checked.manifest.inputs.some(port => port.type !== 'Bool')) {
    error(ast.loc, 'bound resource execution supports only a Bool GFB1 v1/v3 control; contextual, accounting, continuous and other profiles require separate integration');
  }
  if (typeof envelope !== 'function') error(ast.loc, 'bound resource execution requires a compiled policy envelope');
  const bytes = envelope(candidate.bytes, checked.manifest, candidate.traceMetadata.constraints);
  if (!(bytes instanceof Uint8Array) || bytes.length < candidate.bytes.length + 10
    || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'GFB1'
    || new DataView(bytes.buffer, bytes.byteOffset).getUint16(4, true) !== 17
    || new DataView(bytes.buffer, bytes.byteOffset).getUint32(6, true) !== candidate.bytes.length
    || candidate.bytes.some((byte, index) => bytes[index + 10] !== byte)) {
    error(ast.loc, 'bound resource execution requires the guarded GFB17 envelope');
  }
  return { ...candidate, bytes, manifest: { ...checked.manifest, format: 'GhostFlow/control-v17' } };
}

/** Type-checked schedule contract. These bytes cannot be loaded as control bytecode. */
export function compileScheduleDescriptorArtifact(source, { filename = '<control>' } = {}) {
  const ast = new ControlParser(source, filename).parse();
  if (ast.kind !== 'control' || !ast.body.some(item => item.kind === 'schedule'
    && item.scheduleType !== 'Solar' && Object.keys(item.policy ?? {}).some(key => key !== 'fallback'))) {
    error(ast.loc, 'expected a control with an explicit schedule policy');
  }
  const checked = new Lowerer(ast, filename).lower({ emitBytecode: false });
  const manifest = { format: 'GhostFlow/schedule-descriptor-v1', control: checked.manifest };
  const bytes = new TextEncoder().encode(JSON.stringify({
    format: 'GhostFlow/schedule-descriptor-artifact-v1', executable: false,
    controlSource: source, manifest,
  }));
  return { bytes, manifest, sourceMap: checked.sourceMap };
}

/** Locate deferred temporal operators without treating arbitrary source text as syntax. */
export function hasTemporalDescriptorCalls(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.kind === 'call' && ['after_event', 'tide_is', 'moon_is'].includes(node.name)) return true;
  return Object.values(node).some(value => Array.isArray(value)
    ? value.some(hasTemporalDescriptorCalls) : hasTemporalDescriptorCalls(value));
}

/** Checked temporal contract; never an executable substitute for temporal evaluation. */
export function compileTemporalDescriptorArtifact(source, { filename = '<control>' } = {}) {
  const ast = new ControlParser(source, filename).parse();
  if (ast.kind !== 'control') error(ast.loc, 'expected a control with temporal evidence or natural conditions');
  const checked = new Lowerer(ast, filename).lower({ emitBytecode: false });
  const afterEvent = checked.manifest.signals.some(signal => signal.kind === 'after-event');
  const natural = Boolean(checked.manifest.naturalConditions?.length);
  // An uncalled function may contain a temporal call without producing a site.
  if (!afterEvent && !natural) return new Lowerer(ast, filename).lower();
  if (natural && !afterEvent) return new Lowerer(ast, filename).lower();
  if (!natural && checked.manifest.signals
    .filter(signal => signal.kind === 'after-event')
    .every(signal => signal.projections?.length > 0)) {
    return new Lowerer(ast, filename).lower();
  }
  const manifest = {
    format: 'GhostFlow/temporal-descriptor-v1', executable: false,
    requiredRuntimeContracts: [
      ...(afterEvent ? ['identified-event-delivery', 'per-identity-result-projection'] : []),
      ...(natural ? ['natural-provider-observations'] : []),
    ],
    control: checked.manifest,
  };
  const bytes = new TextEncoder().encode(JSON.stringify({
    format: 'GhostFlow/temporal-descriptor-artifact-v1', executable: false,
    controlSource: source, manifest,
  }));
  return { bytes, manifest, sourceMap: checked.sourceMap };
}

/** Parse and type-check control source without selecting a bytecode format. */
export function typeCheckControl(source, { filename = '<control>' } = {}) {
  if (typeof filename !== 'string' || !filename) internal('filename must be a non-empty string');
  const ast = new ControlParser(source, filename).parse();
  if (ast.kind === 'resource-policy') return { manifest: checkResourcePolicy(ast), sourceMap: ast.sourceNodes };
  return new Lowerer(ast, filename).lower({ emitBytecode: false });
}

export function parseControl(source, { filename = '<control>' } = {}) {
  return new ControlParser(source, filename).parse();
}

/** Internal adapter helper: the same header grammar without composing control bodies. */
export function parseControlImports(source, { filename = '<control>' } = {}) {
  return new ControlParser(source, filename).parsePrelude().imports;
}

export { CompileError };
