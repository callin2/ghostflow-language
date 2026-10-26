import { mapSourcePosition } from './literate.mjs';

const FORMAT = 'GhostFlow/behavior-projection-v1';
const MAX_ROOTS = 64;
const MAX_NODES = 512;
const MAX_DEPTH = 32;
const MAX_TEXT_LENGTH = 4096;
const COMPARE_OPERATORS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const LOGIC_OPERATORS = new Map([['&&', 'and'], ['||', 'or']]);

class ProjectionLimitError extends Error {}

function expressionText(node, depth = 0) {
  if (!node || typeof node !== 'object') return '<unknown>';
  if (depth > MAX_DEPTH) throw new ProjectionLimitError('expression depth');
  const child = value => expressionText(value, depth + 1);
  let text;
  switch (node.kind) {
    case 'literal': text = node.raw; break;
    case 'reference': text = node.name; break;
    case 'nextReference': text = `${node.name}'`; break;
    case 'member': text = `${node.base}.${node.member}`; break;
    case 'binary': text = `(${child(node.left)} ${node.op} ${child(node.right)})`; break;
    case 'unary': text = `${node.op}${child(node.value)}`; break;
    case 'if': text = `if ${child(node.test)} then ${child(node.yes)} else ${child(node.no)}`; break;
    case 'case': text = `case ${child(node.value)} { ${node.branches.map(branch =>
      `${branch.name}${branch.binding === null ? '' : `(${branch.binding})`} => ${child(branch.body)};`).join(' ')} }`; break;
    case 'call':
    case 'macro-call': {
      const positional = node.args.map(child);
      const named = node.named.map(argument => `${argument.name}: ${child(argument.value)}`);
      text = `${node.kind === 'macro-call' ? '@' : ''}${node.name}(${[...positional, ...named].join(', ')})`;
      break;
    }
    case 'list': text = `[${node.values.map(child).join(', ')}]`; break;
    case 'in': text = `${child(node.left)} in {${node.values.map(child).join(', ')}}`; break;
    default: text = `<${node.kind}>`; break;
  }
  if (text.length > MAX_TEXT_LENGTH) throw new ProjectionLimitError('expression text');
  return text;
}

function literalKind(raw) {
  if (raw === 'true' || raw === 'false') return 'Bool';
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) return 'Number';
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)[A-Za-z%°]+$/.test(raw)) return 'Quantity';
  if (/^[A-Za-z]+`/.test(raw)) return 'Tagged';
  return 'String';
}

function symbolKinds(ast) {
  const symbols = new Map();
  const declarations = new Map();
  for (const item of ast.body ?? []) {
    if (item.kind === 'sensor') symbols.set(item.name, 'input');
    else if (item.kind === 'input') for (const name of item.names) symbols.set(name, 'input');
    else if (item.kind === 'state') symbols.set(item.name, 'state-before');
    else if (['parameter', 'config'].includes(item.kind)) symbols.set(item.name, 'local');
    else if (item.kind === 'let') declarations.set(item.name, item.value);
    else if (item.kind === 'signal' || item.kind === 'timer') declarations.set(item.name, item.call);
  }
  return { symbols, declarations };
}

function projectExpression(node, context, depth = 0) {
  if (depth > MAX_DEPTH) throw new ProjectionLimitError('expression depth');
  if (++context.count > MAX_NODES) throw new ProjectionLimitError('expression count');
  const child = value => projectExpression(value, context, depth + 1);
  const unavailable = (reason, expression = node) => ({
    kind: 'unavailable',
    reason,
    expressionKind: expression.kind,
    text: expressionText(expression),
    sourceNodeId: expression.id,
  });
  switch (node.kind) {
    case 'literal':
      return { kind: 'literal', valueKind: literalKind(node.raw), value: node.raw, sourceNodeId: node.id };
    case 'reference': {
      const readKind = context.bindings.has(node.name) ? 'local' : context.symbols.get(node.name);
      if (readKind) return { kind: 'read', name: node.name, readKind, sourceNodeId: node.id };
      const declaration = context.declarations.get(node.name);
      return declaration
        ? unavailable('unsupported-derived-reference', declaration)
        : unavailable('unsupported-reference');
    }
    case 'nextReference':
      return context.symbols.get(node.name) === 'state-before'
        ? { kind: 'read', name: node.name, readKind: 'state-after', sourceNodeId: node.id }
        : unavailable('unsupported-reference');
    case 'binary': {
      if (COMPARE_OPERATORS.has(node.op)) {
        return { kind: 'compare', op: node.op, left: child(node.left), right: child(node.right), sourceNodeId: node.id };
      }
      const logic = LOGIC_OPERATORS.get(node.op);
      return logic
        ? { kind: 'logic', op: logic, children: [child(node.left), child(node.right)], sourceNodeId: node.id }
        : unavailable('unsupported-construct');
    }
    case 'unary':
      return node.op === '!'
        ? { kind: 'logic', op: 'not', children: [child(node.value)], sourceNodeId: node.id }
        : unavailable('unsupported-construct');
    case 'if':
      return {
        kind: 'conditional', test: child(node.test), whenTrue: child(node.yes), whenFalse: child(node.no),
        sourceNodeId: node.id,
      };
    case 'case': {
      const ok = node.branches.find(branch => branch.name === 'ok');
      const fault = node.branches.find(branch => branch.name === 'fault');
      if (node.branches.length !== 2 || !ok || !fault || ok.binding === null || fault.binding === null) {
        return unavailable('unsupported-case');
      }
      const bindings = context.bindings;
      context.bindings = new Set([...bindings, ok.binding]);
      const okBody = child(ok.body);
      context.bindings = new Set([...bindings, fault.binding]);
      const faultBody = child(fault.body);
      context.bindings = bindings;
      return {
        kind: 'result-case', value: child(node.value),
        ok: { binding: ok.binding, body: okBody }, fault: { binding: fault.binding, body: faultBody },
        sourceNodeId: node.id,
      };
    }
    default:
      return unavailable('unsupported-construct');
  }
}

function rootSource(node, extractionMap) {
  const original = mapSourcePosition(extractionMap, node.loc.line, node.loc.column);
  return original
    ? { filename: original.file, line: original.line, column: original.column }
    : { filename: node.loc.filename, line: node.loc.line, column: node.loc.column };
}

export function emitBehaviorProjection({ ast, manifest, sourceSha256, bytecodeSha256, extractionMap }) {
  const unavailable = reason => ({
    format: FORMAT, sourceSha256, bytecodeSha256, status: 'unavailable', reason, roots: [],
  });
  if (ast.kind !== 'control' || !manifest?.format?.startsWith('GhostFlow/control-')) {
    return unavailable('non-control-artifact');
  }
  if (ast.imports?.length) return unavailable('unsupported-construct');
  if ((ast.body ?? []).some(item => item.kind === 'adapt')) return unavailable('unsupported-construct');
  const roots = (ast.body ?? []).filter(item => item.kind === 'connection' || item.kind === 'next');
  if (roots.length > MAX_ROOTS) return unavailable('projection-limit');
  const { symbols, declarations } = symbolKinds(ast);
  const context = { symbols, declarations, bindings: new Set(), count: 0 };
  try {
    return {
      format: FORMAT,
      sourceSha256,
      bytecodeSha256,
      status: 'available',
      roots: roots.map(root => {
        const target = root.kind === 'connection'
          ? { kind: 'output', name: root.name }
          : { kind: 'state-next', name: root.name };
        return {
          id: `${sourceSha256}:${root.id}`,
          target,
          expression: projectExpression(root.value, context),
          source: rootSource(root, extractionMap),
        };
      }),
    };
  } catch (error) {
    if (error instanceof ProjectionLimitError) return unavailable('projection-limit');
    throw error;
  }
}
