import { inspectSourceChanges, sourceChangeInventory } from './source-changes.mjs';

const targetKey = target => JSON.stringify([target.kind, target.name, target.part]);
const idPattern = /^[A-Za-z0-9_.:-]{1,100}$/;
const ruleKinds = new Set(['control', 'let', 'state', 'next', 'timer', 'schedule', 'connection', 'connect',
  'enum', 'function', 'event', 'signal', 'parameter', 'instance', 'import', 'syntax', 'resource', 'account',
  'require', 'mutex', 'adapt', 'adapt-setting', 'objective', 'degraded', 'strategy', 'exclusive',
  'account-constraints', 'local-constraints', 'shared-constraints', 'continuous-policy', 'continuous-entry', 'resource-safe-value']);

function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    throw new TypeError(`update request requires exactly ${fields.join(', ')}`);
  }
}

function names(value, limit, label) {
  if (!Array.isArray(value) || value.length > limit || value.some(name => typeof name !== 'string' || !idPattern.test(name))
    || new Set(value).size !== value.length) throw new TypeError(`invalid ${label}`);
}

function category(target) {
  exact(target, ['kind', 'name', 'part']);
  if (typeof target.name !== 'string' || !target.name || target.name.length > 256 || /[\u0000-\u001f]/.test(target.name)) {
    throw new TypeError('invalid update target name');
  }
  if (target.kind === 'config' && target.part === 'default') return 'config-default';
  if (target.kind === 'config' && target.part === 'definition') return 'config-definition';
  if (target.part !== 'declaration') throw new TypeError('invalid update target part');
  if (['input', 'output', 'calendar', 'provider'].includes(target.kind)) return 'logical-io';
  if (target.kind === 'hardware' && target.name === 'hardware') return 'hardware';
  if (ruleKinds.has(target.kind)) return 'control-rule';
  throw new TypeError('unknown update target kind');
}

/** Preflight a typed change-scope request. It does not edit source or install anything.
 * Natural-language interpretation and source generation stay with Authoring. */
export function planSourceUpdate(document, request, { editor } = {}) {
  if (!['simple', 'full'].includes(editor)) throw new TypeError('editor must be simple or full');
  exact(request, ['format', 'sourceSha256', 'items']);
  if (request.format !== 'GhostFlow/update-request-v1' || !/^[a-f0-9]{64}$/.test(request.sourceSha256)
    || !Array.isArray(request.items) || request.items.length < 1 || request.items.length > 64) throw new TypeError('invalid update request');
  const inventory = sourceChangeInventory(document);
  if (inventory.sha256 !== request.sourceSha256) throw new Error('stale update source');
  const existing = new Map(inventory.targets.map(entry => [targetKey(entry.target), entry]));
  const items = new Map(), edits = new Set(), reasons = new Map();
  for (const item of request.items) {
    exact(item, ['id', 'summary', 'changes', 'requires', 'usesInputs']);
    if (typeof item.id !== 'string' || !idPattern.test(item.id) || items.has(item.id)
      || typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 1000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item.summary)
      || !Array.isArray(item.changes) || item.changes.length < 1 || item.changes.length > 16) throw new TypeError('invalid update item');
    names(item.requires, 64, 'dependency list'); names(item.usesInputs, 128, 'input list');
    const causes = new Set();
    for (const change of item.changes) {
      exact(change, ['operation', 'target']);
      const kind = category(change.target), key = targetKey(change.target), before = existing.get(key);
      if (!['add', 'remove', 'modify'].includes(change.operation) || edits.has(key)) throw new TypeError('invalid or duplicate update edit');
      if (change.operation === 'add' ? !!before : !before) throw new TypeError('update target existence does not match operation');
      if (kind === 'config-default' && change.operation !== 'modify') throw new TypeError('config default is changed through its existing definition');
      edits.add(key);
      if (editor === 'simple' && (['logical-io', 'hardware'].includes(kind) || change.target.kind === 'import')) causes.add('outside-editor-scope');
    }
    if (editor === 'simple' && item.usesInputs.some(name => !inventory.usedInputNames.includes(name))) causes.add('input-not-in-use');
    items.set(item.id, item); reasons.set(item.id, causes);
  }
  const visiting = new Set(), done = new Set();
  const visit = id => {
    if (visiting.has(id)) throw new TypeError('update dependency cycle');
    if (done.has(id)) return;
    const item = items.get(id);
    if (!item) throw new TypeError('unknown update dependency');
    visiting.add(id);
    for (const dependency of item.requires) {
      visit(dependency);
      if (reasons.get(dependency).size) reasons.get(id).add('deferred-dependency');
    }
    visiting.delete(id); done.add(id);
  };
  for (const id of items.keys()) visit(id);
  return { format: 'GhostFlow/update-plan-v1', sourceSha256: inventory.sha256, editor,
    apply: [...items.keys()].filter(id => !reasons.get(id).size),
    deferred: [...items.keys()].filter(id => reasons.get(id).size).map(id => ({ id, reasons: [...reasons.get(id)] })) };
}

/** Check the actual candidate against the previously reviewed scope. This does
 * not replace compilation, host metadata checks, authorisation or installation. */
export function verifySourceUpdate(beforeDocument, afterDocument, request, { editor, approved } = {}) {
  const plan = planSourceUpdate(beforeDocument, request, { editor });
  names(approved, 64, 'approval');
  if (approved.some(id => !plan.apply.includes(id))) throw new TypeError('approval includes an unavailable item');
  const selected = request.items.filter(item => approved.includes(item.id));
  if (selected.some(item => item.requires.some(id => !approved.includes(id)))) throw new TypeError('approval omits a dependency');
  const allowed = new Set(selected.flatMap(item => item.changes.map(change => JSON.stringify([targetKey(change.target), change.operation]))));
  const report = inspectSourceChanges(beforeDocument, afterDocument);
  const unexpectedChanges = report.changes.filter(change => !allowed.has(JSON.stringify([targetKey(change.target), change.operation])));
  const newInputNames = editor === 'simple'
    ? [...new Set([...report.afterInventory.usedInputNames.filter(name => !report.beforeInventory.usedInputNames.includes(name)),
      ...report.afterInventory.unresolvedReferenceNames.filter(name => !report.beforeInventory.unresolvedReferenceNames.includes(name))])]
    : [];
  return { format: 'GhostFlow/update-scope-check-v1', ok: !unexpectedChanges.length && !newInputNames.length,
    beforeSha256: report.beforeSha256, afterSha256: report.afterSha256, unexpectedChanges, newInputNames, changes: report.changes };
}
