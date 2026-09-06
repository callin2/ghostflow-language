/**
 * Bounded parser for GhostFlow's named, host-owned constraint declarations.
 *
 * This intentionally recognises only the static templates in CONSTRAINTS.md.
 * It does not load bindings, evaluate expressions, or decide host policy.
 */

const SOURCE_BYTE_LIMIT = 256 * 1024;
const TOKEN_LIMIT = 8192;
const NESTING_LIMIT = 32;
const GROUP_LIMIT = 128;
const RULE_LIMIT = 1024;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DURATION_UNITS = new Map([
  ['ms', 1], ['s', 1000], ['min', 60_000], ['h', 3_600_000],
]);

export class ConstraintCompileError extends Error {
  constructor(message, loc) {
    super(loc ? `${loc.filename}:${loc.line}:${loc.column}: ${message}` : message);
    this.name = 'ConstraintCompileError';
    this.filename = loc?.filename;
    this.line = loc?.line;
    this.column = loc?.column;
  }
}

function fail(loc, message) { throw new ConstraintCompileError(message, loc); }

function tokenizeConstraints(source, filename) {
  if (typeof source !== 'string') throw new TypeError('constraint source must be a string');
  if (new TextEncoder().encode(source).length > SOURCE_BYTE_LIMIT) {
    fail({ filename, line: 1, column: 1 }, `source byte limit exceeded (${SOURCE_BYTE_LIMIT})`);
  }
  const tokens = [];
  let at = 0, line = 1, column = 1, nesting = 0;
  const loc = () => ({ filename, line, column, offset: at });
  const take = () => {
    const char = source[at++];
    if (char === '\n') { line++; column = 1; } else column++;
    return char;
  };
  const add = (kind, value, start) => {
    if (tokens.length >= TOKEN_LIMIT) fail(start, `token limit exceeded (${TOKEN_LIMIT})`);
    tokens.push({ kind, value, ...start });
  };

  while (at < source.length) {
    const char = source[at];
    if (/\s/.test(char)) { take(); continue; }
    if (char === '/' && source[at + 1] === '/') {
      while (at < source.length && source[at] !== '\n') take();
      continue;
    }
    const start = loc();
    const pair = source.slice(at, at + 2);
    if (['=>', '<=', '==', '&&'].includes(pair)) {
      take(); take(); add('symbol', pair, start); continue;
    }
    if ('{}(),;.<>'.includes(char)) {
      if (char === '{' || char === '(') {
        if (++nesting > NESTING_LIMIT) fail(start, `parser nesting exceeds ${NESTING_LIMIT}`);
      } else if (char === '}' || char === ')') {
        nesting = Math.max(0, nesting - 1);
      }
      take(); add('symbol', char, start); continue;
    }
    if (char === '"') {
      let raw = take(), closed = false;
      while (at < source.length) {
        const next = take(); raw += next;
        if (next === '"') { closed = true; break; }
        if (next === '\\') {
          if (at >= source.length) break;
          raw += take();
        }
      }
      if (!closed) fail(start, 'unterminated string literal');
      try { add('string', JSON.parse(raw), start); } catch { fail(start, 'invalid string literal'); }
      continue;
    }
    const rest = source.slice(at);
    const duration = /^(\d+)(ms|min|s|h)(?![A-Za-z0-9_])/.exec(rest);
    if (duration) {
      for (let i = 0; i < duration[0].length; i++) take();
      add('duration', duration[0], start); continue;
    }
    const integer = /^\d+(?![A-Za-z0-9_])/.exec(rest);
    if (integer) {
      for (let i = 0; i < integer[0].length; i++) take();
      add('integer', integer[0], start); continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (identifier) {
      for (let i = 0; i < identifier[0].length; i++) take();
      add('identifier', identifier[0], start); continue;
    }
    fail(start, `unexpected character ${JSON.stringify(char)}`);
  }
  tokens.push({ kind: 'eof', value: '', filename, line, column, offset: at });
  return tokens;
}

class Parser {
  constructor(source, filename) {
    this.tokens = tokenizeConstraints(source, filename);
    this.at = 0;
    this.depth = 0;
    this.ruleCount = 0;
  }
  current() { return this.tokens[this.at]; }
  matches(value) { return this.current().value === value; }
  take() { return this.tokens[this.at++]; }
  maybe(value) { return this.matches(value) ? this.take() : null; }
  expect(value, message = `expected ${value}`) {
    if (!this.matches(value)) fail(this.current(), message);
    return this.take();
  }
  identifier(message = 'expected identifier') {
    const token = this.current();
    if (token.kind !== 'identifier' || !IDENTIFIER.test(token.value)) fail(token, message);
    this.take();
    return token;
  }
  enter(loc) {
    if (++this.depth > NESTING_LIMIT) fail(loc, `parser nesting exceeds ${NESTING_LIMIT}`);
  }
  leave() { this.depth--; }
  rule(rule) {
    if (++this.ruleCount > RULE_LIMIT) fail(this.current(), `rule count exceeds ${RULE_LIMIT}`);
    return rule;
  }
  parse() {
    const groups = [];
    const names = new Set();
    while (this.current().kind !== 'eof') {
      const start = this.expect('constraints', 'expected constraints declaration');
      if (groups.length >= GROUP_LIMIT) fail(start, `group count exceeds ${GROUP_LIMIT}`);
      const name = this.identifier('expected constraint group name');
      if (names.has(name.value)) fail(name, `duplicate constraint group ${name.value}`);
      names.add(name.value);
      this.expect('{', 'expected { after constraint group name'); this.enter(start);
      const rules = [];
      while (!this.matches('}')) {
        if (this.current().kind === 'eof') fail(start, 'unclosed constraints block');
        rules.push(this.rule(this.declaration()));
      }
      this.take(); this.leave();
      groups.push({ name: name.value, rules });
    }
    return { format: 'GhostFlow/constraints-v1', groups };
  }
  declaration() {
    const token = this.current();
    switch (token.value) {
      case 'exclusive': return this.exclusive();
      case 'allow': return this.allow();
      case 'require': return this.require();
      case 'limit': return this.limit();
      case 'once': return this.once();
      case 'check': return this.check();
      case 'warn': fail(token, 'unsupported constraint expression warn'); break;
      default: fail(token, `unsupported constraint expression ${token.value || 'end of file'}`);
    }
  }
  bindings(message) {
    const values = [this.identifier(message).value];
    while (this.maybe(',')) values.push(this.identifier(message).value);
    return values;
  }
  pumpMember(member, message) {
    const pump = this.identifier(message);
    this.expect('.', `expected .${member} after pump binding`);
    const actual = this.identifier(`expected ${member} after .`);
    if (actual.value !== member) fail(actual, `expected pump.${member} binding`);
    return pump.value;
  }
  exclusive() {
    this.take(); this.expect('(', 'expected ( after exclusive'); this.enter(this.current());
    const activities = this.bindings('expected activity identifier');
    this.expect(')', 'expected ) after exclusive activities'); this.leave();
    this.expect(';', 'expected ; after exclusive');
    if (activities.length < 2) fail(this.current(), 'exclusive requires at least two activities');
    return { kind: 'exclusive', activities };
  }
  allow() {
    const start = this.take();
    const target = this.identifier('expected allow target');
    this.expect('(', `expected ( after allow ${target.value}`); this.enter(start);
    if (target.value === 'enter') {
      const modes = this.bindings('expected mode identifier');
      this.expect(')', 'expected ) after enter modes'); this.leave();
      this.expect('only', 'expected only when after allow enter'); this.expect('when', 'expected when after only');
      this.expect('mode', 'unsupported allow enter condition; expected mode == Stopped && stopped(station)');
      this.expect('==', 'unsupported allow enter condition; expected mode == Stopped && stopped(station)');
      this.expect('Stopped', 'unsupported allow enter condition; expected mode == Stopped && stopped(station)');
      this.expect('&&', 'unsupported allow enter condition; expected mode == Stopped && stopped(station)');
      this.expect('stopped', 'unsupported allow enter condition; expected mode == Stopped && stopped(station)');
      this.expect('(', 'expected ( after stopped'); this.enter(start);
      const station = this.identifier('expected station identifier').value;
      this.expect(')', 'expected ) after stopped station'); this.leave();
      this.expect(';', 'expected ; after allow enter');
      return { kind: 'enterStopped', modes, station };
    }
    if (target.value === 'apply') {
      const settings = this.identifier('expected settings identifier').value;
      this.expect(')', 'expected ) after apply settings'); this.leave();
      this.expect('only', 'expected only when after allow apply'); this.expect('when', 'expected when after only');
      this.expect('mode', 'unsupported allow apply condition; expected mode == Configure && stopped(station)');
      this.expect('==', 'unsupported allow apply condition; expected mode == Configure && stopped(station)');
      this.expect('Configure', 'unsupported allow apply condition; expected mode == Configure && stopped(station)');
      this.expect('&&', 'unsupported allow apply condition; expected mode == Configure && stopped(station)');
      this.expect('stopped', 'unsupported allow apply condition; expected mode == Configure && stopped(station)');
      this.expect('(', 'expected ( after stopped'); this.enter(start);
      const station = this.identifier('expected station identifier').value;
      this.expect(')', 'expected ) after stopped station'); this.leave();
      this.expect(';', 'expected ; after allow apply');
      return { kind: 'configureOnly', settings, station };
    }
    fail(target, `unsupported allow target ${target.value}`);
  }
  require() {
    const start = this.take();
    const head = this.identifier('expected require expression');
    if (head.value === 'count_on') {
      this.expect('(', 'expected ( after count_on'); this.enter(start);
      const pump = this.pumpMember('valves', 'expected pump binding');
      this.expect(')', 'expected ) after count_on binding'); this.leave();
      this.expect('<=', 'expected <= after count_on');
      const max = this.integer('expected non-negative integer valve maximum');
      this.expect(';', 'expected ; after max-valves requirement');
      return { kind: 'maxValves', pump, max };
    }
    if (head.value === 'pump_capacity') {
      this.expect('(', 'expected ( after pump_capacity'); this.enter(start);
      const pump = this.identifier('expected pump identifier').value;
      this.expect(')', 'expected ) after pump_capacity binding'); this.leave();
      this.expect('==', 'expected == Pass after pump_capacity');
      this.expect('Pass', 'expected Pass after pump_capacity ==');
      this.expect(';', 'expected ; after capacity requirement');
      return { kind: 'capacityCheck', pump, required: true };
    }
    const pump = this.memberFrom(head, 'on', 'unsupported require constraint');
    this.expect('=>', 'unsupported require constraint; expected pump.on => any_on(pump.valves)');
    this.expect('any_on', 'unsupported require constraint; expected pump.on => any_on(pump.valves)');
    this.expect('(', 'expected ( after any_on'); this.enter(start);
    const valvePump = this.pumpMember('valves', 'expected pump binding');
    this.expect(')', 'expected ) after any_on binding'); this.leave();
    this.expect(';', 'expected ; after pump requirement');
    if (pump !== valvePump) fail(head, 'pump.on and pump.valves must use the same pump binding');
    return { kind: 'pumpNeedsValve', pump };
  }
  memberFrom(root, member, message) {
    this.expect('.', `expected .${member} after pump binding`);
    const actual = this.identifier(`expected ${member} after .`);
    if (actual.value !== member) fail(actual, message);
    return root.value;
  }
  integer(message) {
    const token = this.current();
    if (token.kind !== 'integer') fail(token, message);
    this.take();
    const value = Number(token.value);
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
      fail(token, 'integer limit must be between 0 and 2147483647');
    }
    return value;
  }
  duration() {
    const token = this.current();
    if (token.kind !== 'duration') fail(token, 'expected integer duration using ms, s, min, or h');
    this.take();
    const match = /^(\d+)(ms|min|s|h)$/.exec(token.value);
    const amount = Number(match[1]), multiplier = DURATION_UNITS.get(match[2]);
    const value = amount * multiplier;
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(value) || value > 2_147_483_647) {
      fail(token, 'duration limit must be a positive i32 millisecond value');
    }
    return value;
  }
  limit() {
    const start = this.take(); this.expect('on_time', 'unsupported limit constraint; expected on_time(pump) <= duration per day(timezone)');
    this.expect('(', 'expected ( after on_time'); this.enter(start);
    const pump = this.identifier('expected pump identifier').value;
    this.expect(')', 'expected ) after on_time pump'); this.leave();
    this.expect('<=', 'expected <= after on_time'); const limitMs = this.duration();
    this.expect('per', 'expected per day after duration'); this.expect('day', 'expected day after per');
    this.expect('(', 'expected ( after day'); this.enter(start);
    const timezone = this.current();
    if (timezone.kind !== 'string') fail(timezone, 'expected timezone string');
    this.take(); this.expect(')', 'expected ) after timezone'); this.leave();
    this.expect(';', 'expected ; after daily limit');
    if (timezone.value.length === 0 || timezone.value.length > 128) fail(timezone, 'timezone must be a non-empty string up to 128 characters');
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone.value }); }
    catch { fail(timezone, `invalid IANA timezone ${JSON.stringify(timezone.value)}`); }
    return { kind: 'dailyLimit', pump, limitMs, timezone: timezone.value };
  }
  once() {
    this.take(); const schedule = this.identifier('expected schedule identifier').value;
    this.expect('per', 'expected per occurrence after schedule'); this.expect('occurrence', 'expected occurrence after per');
    this.expect(';', 'expected ; after once rule');
    return { kind: 'once', schedule };
  }
  check() {
    const start = this.take(); this.expect('pump_capacity', 'unsupported check constraint; expected pump_capacity(pump)');
    this.expect('(', 'expected ( after pump_capacity'); this.enter(start);
    const pump = this.identifier('expected pump identifier').value;
    this.expect(')', 'expected ) after pump_capacity binding'); this.leave();
    this.expect(';', 'expected ; after capacity check');
    return { kind: 'capacityCheck', pump, required: false };
  }
}

/** Compile a standalone .ghost rules source to a host-policy artifact. */
export function compileConstraints(source, { filename = 'constraints.ghost' } = {}) {
  return new Parser(source, String(filename)).parse();
}

export { tokenizeConstraints };
