// A small, reproducible source family for the admitted Bool profile.
// Expression nodes are phase typed by construction: next reads are only made
// for output expressions, never for state transitions.
export const generatedSeed = 0x590b001;
export const generatedCaseCount = 16;

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

const literal = value => ({ kind: 'literal', value });
const read = (name, candidate = false) => ({ kind: 'read', name, candidate });
const negate = value => ({ kind: 'negate', value });
const binary = (op, left, right) => ({ kind: 'binary', op, left, right });
const branch = (condition, yes, no) => ({ kind: 'branch', condition, yes, no });

export function renderExpression(node) {
  switch (node.kind) {
    case 'literal': return String(node.value);
    case 'read': return `${node.name}${node.candidate ? "'" : ''}`;
    case 'negate': return `!(${renderExpression(node.value)})`;
    case 'binary': return `(${renderExpression(node.left)} ${node.op} ${renderExpression(node.right)})`;
    case 'branch': return `(if ${renderExpression(node.condition)} then ${renderExpression(node.yes)} else ${renderExpression(node.no)})`;
    default: throw new Error(`unknown generated Bool expression ${node.kind}`);
  }
}

function inspect(node, visit) {
  visit(node);
  for (const key of ['value', 'left', 'right', 'condition', 'yes', 'no']) {
    if (node[key] && typeof node[key] === 'object') inspect(node[key], visit);
  }
}

export function generatedCase(index, seed = generatedSeed) {
  if (!Number.isInteger(index) || index < 0 || index >= generatedCaseCount) throw new RangeError('generated case index');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('generated seed');
  const next = random((seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0);
  const stateCount = 1 + index % 4;
  const outputCount = 1 + Math.floor(index / 4) % 3;
  const states = Array.from({ length: stateCount }, (_, i) => ({ name: `s${i}`, initial: (next() & 1) === 1 }));
  // A multi-state case always contains both initial values.
  if (stateCount > 1) { states[0].initial = false; states[1].initial = true; }
  const pick = () => states[next() % stateCount].name;
  const transition = i => {
    if (index % 4 === 1 && i < 2) return read(states[1 - i].name); // old-state swap
    switch ((index + i) % 5) {
      case 0: return negate(read(pick()));
      case 1: return binary('&&', read(pick()), literal((next() & 1) === 1));
      case 2: return binary('||', read(pick()), negate(read(pick())));
      case 3: return branch(read(pick()), literal(true), read(pick()));
      default: return read(pick());
    }
  };
  const transitions = states.flatMap((state, i) => index % 3 === 0 && i === stateCount - 1
    ? [] : [{ name: state.name, expression: transition(i) }]);
  const output = i => {
    const old = read(pick()), candidate = read(pick(), true);
    switch ((index + i) % 5) {
      case 0: return candidate;
      case 1: return binary('&&', candidate, negate(old));
      case 2: return binary('||', old, candidate);
      case 3: return branch(negate(old), candidate, literal(false));
      default: return branch(candidate, binary('&&', old, literal(true)), negate(read(pick(), true)));
    }
  };
  const outputs = Array.from({ length: outputCount }, (_, i) => ({ name: `o${i}`, expression: output(i) }));
  const declarations = [
    ...states.map(s => `  state ${s.name}: Bool = ${s.initial};`),
    ...outputs.map(o => `  output ${o.name}: Bool;`),
  ];
  const assignments = [
    ...transitions.map(t => `  ${t.name}' = ${renderExpression(t.expression)};`),
    ...outputs.map(o => `  ${o.name} <- ${renderExpression(o.expression)};`),
  ];
  // Half of cases place transitions ahead of their declarations.
  const body = index % 2 ? [...declarations, ...assignments] : [...assignments, ...declarations];
  const name = `BoolGenerated${index.toString().padStart(2, '0')}`;
  const filename = `generated/${name}.ghost.md`;
  const source = `# Generated Bool case ${index}\n\nSeed: ${seed}.\n\n\`\`\`ghost\ncontrol ${name} {\n${body.join('\n')}\n}\n\`\`\`\n`;
  const features = new Set();
  for (const expression of [...transitions, ...outputs].map(x => x.expression)) inspect(expression, node => {
    if (node.kind === 'read' && node.candidate) features.add('candidate');
    if (node.kind === 'negate') features.add('negation');
    if (node.kind === 'binary') features.add(node.op);
    if (node.kind === 'branch') features.add('if');
  });
  if (index % 4 === 1) features.add('swap');
  if (transitions.length < states.length) features.add('retained');
  if (index % 2 === 0) features.add('forward');
  features.add('grouping');
  return { index, seed, name, filename, source, states, transitions, outputs, features: [...features].sort() };
}

export function generatedCases(seed = generatedSeed) {
  return Array.from({ length: generatedCaseCount }, (_, i) => generatedCase(i, seed));
}
