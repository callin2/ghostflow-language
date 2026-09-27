// Semantic expression nodes. Wire opcodes and GFB profiles belong to the emitter.
export class CompileError extends Error {}

const TYPES = { 1: 'Bool', 2: 'Number', 3: 'Int' };
const typeOf = value => TYPES[value] ?? value;
const unaryInt = new Set(['int-neg']);
const binaryInt = new Set(['int-add', 'int-sub', 'int-mul', 'int-div', 'int-rem']);
const comparisons = new Set(['eq', 'lt', 'lte', 'gt', 'gte']);
const arithmetic = new Set(['add', 'sub', 'mul', 'div']);
const conversions = new Set(['int-to-number', 'int-exact', 'int-floor', 'int-ceil', 'int-trunc', 'int-nearest-even']);

function unsigned(atom, max, message) {
  if (typeof atom !== 'string' || !/^\d+$/.test(atom)) throw new CompileError(message);
  const value = BigInt(atom);
  if (value > max) throw new CompileError(message);
  return Number(value);
}

export function lowerExpression(form, env, allowNext = false) {
  let depth = 0, nodes = 0;
  function lower(value) {
    if (++depth > 128 || ++nodes > 4096) throw new CompileError('expression complexity limit exceeded');
    try { return one(value); } finally { depth--; }
  }
  function one(value) {
    if (value === 'true' || value === 'false') return { kind: 'literal', type: 'Bool', value: value === 'true' };
    if (typeof value === 'string' && /^-?(\d+(\.\d*)?|\.\d+)$/.test(value)) {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new CompileError('non-finite number');
      return { kind: 'literal', type: 'Number', value: number };
    }
    if (typeof value === 'string') {
      const dot = value.indexOf('.');
      if (dot < 1) throw new CompileError(`unknown atom ${value}`);
      const namespace = value.slice(0, dot), name = value.slice(dot + 1);
      if (namespace === 'next' && !allowNext) throw new CompileError('next.* is allowed only in intents');
      const bindings = namespace === 'input' ? env.inputs : namespace === 'state' || namespace === 'next' ? env.states : null;
      if (!bindings) throw new CompileError(`unknown namespace ${namespace}`);
      const binding = bindings.get(name);
      if (!binding) throw new CompileError(`unknown ${namespace === 'next' ? 'state' : namespace} ${name}`);
      return { kind: namespace === 'state' ? 'previous_state' : namespace === 'next' ? 'candidate_next' : 'input',
        type: typeOf(binding.type), name, index: binding.index };
    }
    if (!Array.isArray(value) || !value.length) throw new CompileError('invalid expression');
    const [head, ...args] = value;
    if (head === 'true-for-read' || head === 'window-read' || head === 'schedule-read') {
      const profile = { 'true-for-read': ['trueFors', 'true-for-read requires GFB format 6', 'true-for-read expects slot and field', 'true_for projection index'],
        'window-read': ['windows', 'window-read requires GFB format 4', 'window-read expects slot and field', 'temporal projection index'],
        'schedule-read': ['schedules', 'schedule-read requires GFB format 5', 'schedule-read expects slot and field', 'schedule projection index'] }[head];
      const [key, missing, arity, badIndex] = profile;
      if (!env[key]) throw new CompileError(missing);
      if (args.length !== 2) throw new CompileError(arity);
      const slot = unsigned(args[0], 65535n, badIndex), binding = env[key][slot];
      if (!binding) throw new CompileError(badIndex);
      const fields = head === 'true-for-read' ? ['ok','value','fault','origin','start','end','covered']
        : head === 'window-read' ? ['ok','value','fault','origin','revision','timestamp','count','quality']
          : ['due','missed','active'];
      const field = fields.indexOf(args[1]);
      if (field < 0) throw new CompileError(head === 'true-for-read' ? 'true_for projection field' : head === 'window-read' ? 'temporal projection field' : 'schedule projection field');
      if (head === 'schedule-read' && field === 2 && !env.contextSchedules) throw new CompileError('schedule active requires GFB10');
      const type = head === 'schedule-read' || head === 'true-for-read' && field <= 1 || head === 'window-read' && field === 0
        ? 'Bool' : head === 'window-read' && field === 1 ? typeOf(binding.payloadType) : 'Number';
      return { kind: head === 'window-read' ? 'window_projection' : head === 'schedule-read' ? 'schedule_projection' : 'true_for_projection',
        type, slot, field: fields[field] };
    }
    if (head === 'trace-result') {
      if (args.length !== 4 || typeof args[0] !== 'string' || !/^\d+$/.test(args[0]) || Number(args[0]) < 1 || Number(args[0]) > 4294967295)
        throw new CompileError('trace-result expects a positive u32 site, payload, Number choice and Number origin');
      const payload = lower(args[1]), choice = lower(args[2]);
      if (choice.type !== 'Number') throw new CompileError('trace-result metadata must be Number');
      const origin = lower(args[3]);
      if (origin.type !== 'Number') throw new CompileError('trace-result metadata must be Number');
      return { kind: 'result_trace', type: payload.type, site: Number(args[0]), payload, choice, origin };
    }
    if (head === 'int') {
      if (args.length !== 1 || typeof args[0] !== 'string' || !/^-?\d+$/.test(args[0])) throw new CompileError('int expects one signed decimal i32 literal');
      const number = BigInt(args[0]);
      if (number < -2147483648n || number > 2147483647n) throw new CompileError('int literal outside i32 range');
      return { kind: 'literal', type: 'Int', value: Number(number) };
    }
    if (unaryInt.has(head)) {
      if (args.length !== 1) throw new CompileError('int-neg expects Int');
      const operand = lower(args[0]);
      if (operand.type !== 'Int') throw new CompileError('int-neg expects Int');
      return { kind: 'integer_negation', type: 'Int', operand };
    }
    if (binaryInt.has(head)) {
      if (args.length !== 2) throw new CompileError(`${head} expects 2 arguments`);
      const left = lower(args[0]), right = lower(args[1]);
      if (left.type !== 'Int' || right.type !== 'Int') throw new CompileError(`${head} expects Int operands`);
      return { kind: 'integer_arithmetic', operation: head.slice(4), type: 'Int', left, right };
    }
    if (head === 'not') {
      if (args.length !== 1) throw new CompileError('not expects bool');
      const operand = lower(args[0]);
      if (operand.type !== 'Bool') throw new CompileError('not expects bool');
      return { kind: 'logical_not', type: 'Bool', operand };
    }
    if (head === 'and' || head === 'or' || head === 'if') {
      if (args.length !== (head === 'if' ? 3 : 2)) throw new CompileError(head === 'if' ? 'if expects 3 arguments' : `${head} expects 2 arguments`);
      const condition = lower(args[0]);
      if (condition.type !== 'Bool') throw new CompileError(head === 'if' ? 'if condition must be bool' : `${head} expects bools`);
      const whenTrue = lower(args[1]), whenFalse = head === 'if' ? lower(args[2]) : null;
      // The GFB branch also emits one implicit Bool literal for and/or.
      if (head !== 'if' && ++nodes > 4096) throw new CompileError('expression complexity limit exceeded');
      if (head === 'if' && whenTrue.type !== whenFalse.type) throw new CompileError('if branches must have same type');
      if (head !== 'if' && whenTrue.type !== 'Bool') throw new CompileError(`${head} expects bools`);
      return head === 'if' ? { kind: 'conditional', type: whenTrue.type, condition, whenTrue, whenFalse }
        : { kind: head === 'and' ? 'logical_and' : 'logical_or', type: 'Bool', left: condition, right: whenTrue };
    }
    if (comparisons.has(head) || arithmetic.has(head)) {
      if (args.length !== 2) throw new CompileError(`${head} expects 2 arguments`);
      const left = lower(args[0]), right = lower(args[1]);
      if (comparisons.has(head)) {
        if (left.type !== right.type || head !== 'eq' && !['Number','Int'].includes(left.type)) throw new CompileError(`bad operands for ${head}`);
        return { kind: 'comparison', operation: head, type: 'Bool', left, right };
      }
      if (left.type !== 'Number' || right.type !== 'Number') throw new CompileError(`${head} expects numbers`);
      return { kind: 'arithmetic', operation: head, type: 'Number', left, right };
    }
    if (conversions.has(head) || head === 'check-duration' || head === 'check-datetime') {
      const sourceType = head === 'int-to-number' ? 'Int' : 'Number';
      const message = conversions.has(head) ? `${head} expects one ${sourceType} operand` : `${head} expects one Number operand`;
      if (args.length !== 1) throw new CompileError(message);
      const operand = lower(args[0]);
      if (operand.type !== sourceType) throw new CompileError(message);
      return { kind: conversions.has(head) ? 'conversion' : 'time_guard', operation: head,
        type: head === 'int-to-number' || !conversions.has(head) ? 'Number' : 'Int', operand };
    }
    throw new CompileError(`unknown expression ${head}`);
  }
  return lower(form);
}
