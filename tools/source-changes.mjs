import { extractLiterate } from './literate.mjs';
import { parseControl } from './control.mjs';
import { parseHardwareFrontMatter } from './hardware-frontmatter.mjs';
import { sha256Hex } from './sha256.mjs';

const key = target => JSON.stringify([target.kind, target.name, target.part]);
const sorted = values => [...new Set(values)].sort();

function canonical(value, ast = false) {
  if (Array.isArray(value)) return value.map(item => canonical(item, ast));
  if (!value || typeof value !== 'object') return value;
  // Some schedule fields retain lexer tokens rather than expression nodes.
  if (ast && Object.hasOwn(value, 'offset') && Object.hasOwn(value, 'filename') && value.kind) {
    return { kind: value.kind, value: value.value };
  }
  return Object.fromEntries(Object.keys(value).sort().filter(name => !ast ||
    !['id', 'loc', 'sourceNodes', 'parenthesized'].includes(name) && !name.endsWith('Loc'))
    .map(name => [name, canonical(value[name], ast)]));
}

// References come from parser nodes, including scoped function and case bodies.
function references(value, bound = new Set(), found = new Set(), callables = new Set(), enumMembers = new Set()) {
  const visit = (child, scope = bound) => references(child, scope, found, callables, enumMembers);
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const child of value) visit(child);
    return found;
  }
  // Match Lowerer.expression: locals, enum members, then declared symbols.
  // Explicit schema lookups below resolve their declarations independently.
  if (['reference', 'nextReference'].includes(value.kind) && !bound.has(value.name)
    && (value.kind !== 'reference' || !enumMembers.has(value.name))) found.add(value.name);
  if (value.kind === 'member' && !bound.has(value.base)) found.add(value.base);
  if (['call', 'macro-call'].includes(value.kind) && callables.has(value.name) && !bound.has(value.name)) found.add(value.name);
  if (value.kind === 'call' && ['calendar_is', 'tide_is', 'moon_is'].includes(value.name)
    && value.args[0]?.kind === 'reference') found.add(value.args[0].name);
  if (value.kind === 'signal' && value.call?.kind === 'call') {
    const slot = { hysteresis: 0, true_for: 0, after_event: 1 }[value.call.name];
    const sensor = slot === undefined ? null : value.call.args[slot];
    if (sensor?.kind === 'reference') found.add(sensor.name);
  }
  if (value.kind === 'objective' && value.measure?.kind === 'reference') found.add(value.measure.name);
  if (['function', 'syntax'].includes(value.kind)) {
    const local = new Set([...bound, ...value.params.map(param => param.name)]);
    visit(value.body, local);
    return found;
  }
  if (value.kind === 'case') {
    visit(value.value);
    for (const branch of value.branches) visit(branch.body,
      branch.binding ? new Set([...bound, branch.binding]) : bound);
    return found;
  }
  if (value.kind === 'strategy') {
    for (const capability of value.match.capabilities) found.add(capability.role);
    visit(value.where);
    const local = new Set(bound);
    for (const statement of value.body) {
      visit(statement, local);
      if (statement.kind === 'let') local.add(statement.name);
    }
    return found;
  }
  if (value.kind === 'schedule') {
    for (const token of [value.calendar, value.selected, value.source]) if (token?.kind === 'identifier') found.add(token.value);
    // These positions are policy choices in the schedule schema, rather than
    // ordinary variable expressions. Do not hide identically named when inputs.
    const choices = {
      basis: ['pulse'], clock: ['trusted_only'], recovery: ['baseline'], fallback: ['skip'],
      dst_missing: ['skip', 'next_valid'], dst_repeated: ['first', 'second', 'both', 'skip'],
      anchor: ['persisted_epoch'], interval_change: ['preserve_anchor', 'preserve_next', 'restart_after_change'],
    };
    const policyValue = (field, expression) => {
      if (expression?.kind === 'reference' && choices[field]?.includes(expression.name)) return;
      if (['clock', 'fallback'].includes(field) && expression?.kind === 'call') {
        visit(expression.args);
        for (const option of expression.named) {
          if (option.name !== 'terminal' || option.value.kind !== 'reference' || option.value.name !== 'skip') visit(option.value);
        }
      } else visit(expression);
    };
    for (const [field, expression] of Object.entries(value.policy)) policyValue(field, expression);
    for (const [field, expression] of Object.entries(value)) {
      if (field !== 'policy' && field !== 'loc') policyValue(field, expression);
    }
    return found;
  }
  if (value.kind === 'degraded') {
    found.add(value.objective);
    for (const branch of value.branches) {
      found.add(branch.sensor);
      found.add(branch.use);
    }
  }
  if (value.kind === 'adapt-setting') found.add(value.target);
  if (value.kind === 'instance') found.add(value.alias);
  if (value.kind === 'connect') {
    const endpoint = value.source;
    found.add(endpoint.instance ?? endpoint.port);
  }
  for (const [name, child] of Object.entries(value)) {
    if (name !== 'loc' && !name.endsWith('Loc') && name !== 'sourceNodes') visit(child);
  }
  return found;
}

/** Structural language evidence only; compilation, live settings and host-owned
 * admission metadata require their respective owners' checks. */
export function sourceChangeInventory(document) {
  const extracted = extractLiterate(document);
  const ast = parseControl(extracted.code);
  if (ast.kind !== 'control') throw new TypeError(`unsupported source-change root ${ast.kind}; expected control`);
  const hardware = parseHardwareFrontMatter(document);
  const callables = new Set([...ast.imports, ...ast.body].filter(node => ['import', 'function', 'syntax'].includes(node.kind)).map(node => node.name));
  const enumMembers = new Set(ast.body.filter(node => node.kind === 'enum').flatMap(node => node.members.map(member => member.name)));
  const inputReferences = new Set();
  const entries = new Map(), declarations = new Map();
  const add = (category, target, value) => {
    const identity = key(target);
    if (entries.has(identity)) throw new TypeError(`duplicate or ambiguous declaration target ${identity}`);
    entries.set(identity, { category, target, value: canonical(value, category !== 'hardware'),
      referencedNames: category === 'hardware' ? [] : sorted(references(value, new Set(), new Set(), callables)) });
    if (category !== 'hardware') references(value, new Set(), inputReferences, callables, enumMembers);
  };
  const declare = (name, kind) => {
    if (declarations.has(name)) throw new TypeError(`duplicate or ambiguous declaration name ${name} (${declarations.get(name)}, ${kind})`);
    declarations.set(name, kind);
  };
  add('control-rule', { kind: 'control', name: ast.name, part: 'declaration' }, { kind: ast.kind, name: ast.name, standalone: !!ast.standalone });
  for (const node of [...ast.imports, ...ast.body]) {
    const kind = node.kind === 'sensor' ? 'input' : node.kind;
    if (['input', 'output', 'calendar', 'provider'].includes(kind)) {
      for (const name of node.names ?? [node.name]) {
        declare(name, kind);
        const { names, ...single } = node;
        add('logical-io', { kind, name, part: 'declaration' }, { ...single, kind, name });
      }
      continue;
    }
    if (node.kind === 'config') {
      declare(node.name, kind);
      const { value, ...definition } = node;
      add('config-definition', { kind, name: node.name, part: 'definition' }, definition);
      add('config-default', { kind, name: node.name, part: 'default' }, value);
      continue;
    }
    // Statements can share their destination's name; defining declarations cannot.
    if (node.name && !['connection', 'next'].includes(kind)) declare(node.name, kind);
    const name = node.name ?? (kind === 'connect'
      ? `${node.sink.instance ? `${node.sink.instance}.` : ''}${node.sink.port}`
      : sha256Hex(JSON.stringify(canonical(node, true))));
    add('control-rule', { kind, name, part: 'declaration' }, node);
  }
  if (hardware) add('hardware', { kind: 'hardware', name: 'hardware', part: 'declaration' },
    { format: hardware.format, declaration: hardware.request ?? hardware.hardware });
  const targets = [...entries.values()].sort((a, b) => key(a.target).localeCompare(key(b.target)));
  const declaredInputNames = sorted([...declarations].filter(([, kind]) => ['input', 'calendar', 'provider'].includes(kind)).map(([name]) => name));
  const referencedNames = sorted(targets.flatMap(entry => entry.referencedNames));
  const knownNames = new Set([...declarations.keys(), ...enumMembers]);
  return { format: 'GhostFlow/source-change-inventory-v1', sha256: sha256Hex(document), targets,
    declaredInputNames, usedInputNames: declaredInputNames.filter(name => inputReferences.has(name)),
    referencedNames, unresolvedReferenceNames: referencedNames.filter(name => !knownNames.has(name)) };
}

export function inspectSourceChanges(beforeDocument, afterDocument) {
  const before = sourceChangeInventory(beforeDocument), after = sourceChangeInventory(afterDocument);
  const old = new Map(before.targets.map(entry => [key(entry.target), entry]));
  const next = new Map(after.targets.map(entry => [key(entry.target), entry]));
  const changes = [];
  for (const identity of sorted([...old.keys(), ...next.keys()])) {
    const previous = old.get(identity), current = next.get(identity);
    if (JSON.stringify(previous?.value) === JSON.stringify(current?.value)) continue;
    const entry = current ?? previous;
    // Addition/removal includes a config's initial default in its definition evidence.
    if (entry.category === 'config-default') {
      const definitionKey = key({ ...entry.target, part: 'definition' });
      if (!old.has(definitionKey) || !next.has(definitionKey)) continue;
    }
    const declarationValue = (inventory, item) => {
      if (!item) return null;
      if (entry.category === 'config-definition' && (!previous || !current)) {
        return { ...item.value, value: inventory.get(key({ ...entry.target, part: 'default' })).value };
      }
      return item.value;
    };
    changes.push({ category: entry.category, target: entry.target,
      operation: !previous ? 'add' : !current ? 'remove' : 'modify',
      before: declarationValue(old, previous), after: declarationValue(next, current) });
  }
  return { format: 'GhostFlow/source-changes-v1', beforeSha256: before.sha256, afterSha256: after.sha256,
    documentChanged: beforeDocument !== afterDocument, changes, beforeInventory: before, afterInventory: after };
}
