import { mapSourcePosition } from './literate.mjs';

// Coverage is structural and statement-local; a declaration link cannot cover
// later behavior, and neither prose nor a link proves the author's intent true.
const BEHAVIOR_KINDS = new Set([
  'connection', 'next', 'require', 'mutex', 'let', 'function', 'signal', 'schedule', 'timer',
]);
const LIMIT = 20;
const NESTED_BEHAVIOR_KINDS = new Set(['connection', 'connect', 'next', 'require', 'mutex']);
const UNSUPPORTED_BEHAVIOR_KINDS = new Set([
  'adapt', 'objective', 'account', 'account-constraints', 'local-constraints',
  'shared-constraints', 'adapt-setting', 'degraded',
]);

export const INTENT_LINK_EXAMPLE = `<!-- ghostflow:anchor id=GF-ASSUME-FOLLOW kind=assumption status=unconfirmed origin=ai -->
> Candidate policy for review: follow a healthy input; turn the lamp off on input fault.

\`\`\`ghost
control Follow {
  input request: Bool;
  output lamp: Bool;
  // ghostflow:link id=GF-ASSUME-FOLLOW relation=assumes
  lamp <- request |> recover(false);
}
\`\`\``;

const HINT = `Add a standalone ghostflow:anchor HTML comment before the top-level paragraph or block quote that states the actual reason. Inside the ghost fence, put a ghostflow:link with the same id immediately before each target statement; no blank line or ordinary comment may intervene. Prefer an existing applicable anchor; use a unique id for a new anchor.
Choose implements, constrains, fallback, or assumes to match the relationship. Use kind=intent status=confirmed origin=user only for intent actually confirmed by the user. An AI assumption must remain kind=assumption status=unconfirmed origin=ai with relation=assumes. Compilation does not confirm it.
Copyable standalone example (replace the candidate policy after review; recover(false) is an explicit example fault policy):
${INTENT_LINK_EXAMPLE}`;

/** Called only after normal compilation and explicit-link validation succeed. */
export function collectIntentLinkDiagnostics({ ast, extraction, intentLinks = [], composition }) {
  const diagnostics = [];
  let missing = 0;
  const units = composition ? [...composition.units.values()] : [{ ast, extraction }];
  for (const unit of units) {
    // Standalone resource-policy descriptors have no executable control body.
    if (!Array.isArray(unit.ast.body)) continue;
    const isRoot = unit.ast === ast || unit.ast.loc.filename === ast.loc.filename;
    // Imported but uninstantiated definitions do not contribute behavior.
    const instantiated = composition && !isRoot
      ? new Set(composition.result.sourceMap.filter(node => node.instance && node.filename === unit.ast.loc.filename)
        .map(node => node.definitionNodeId)) : null;
    const linkedIds = new Set((composition ? unit.intentMetadata?.intentLinks ?? [] : intentLinks).map(link => link.nodeId));
    const topLevelIds = new Set(unit.ast.body.map(node => node.id));
    const candidates = [...unit.ast.body.filter(node => BEHAVIOR_KINDS.has(node.kind) || UNSUPPORTED_BEHAVIOR_KINDS.has(node.kind)),
      ...unit.ast.sourceNodes.filter(node => NESTED_BEHAVIOR_KINDS.has(node.kind)
        && (!topLevelIds.has(node.id) || node.kind === 'connect')).map(node => ({ ...node, loc: node }))]
      .sort((a, b) => a.loc.line - b.loc.line || a.loc.column - b.loc.column);
    for (const node of candidates) {
      if (linkedIds.has(node.id)
          || (instantiated && !instantiated.has(node.id))) continue;
      const start = mapSourcePosition(unit.extraction.sourceMap, node.loc.line, node.loc.column);
      if (!start) continue;
      missing++;
      if (diagnostics.length === LIMIT) continue;
      const end = mapSourcePosition(unit.extraction.sourceMap, node.loc.endLine, node.loc.endColumn);
      const unsupported = !topLevelIds.has(node.id) || node.kind === 'connect' || UNSUPPORTED_BEHAVIOR_KINDS.has(node.kind);
      diagnostics.push({
        code: unsupported ? 'GF_INTENT_LINK_COVERAGE_UNSUPPORTED' : 'GF_INTENT_LINK_MISSING', severity: 'warning',
        message: `No explicit intent link covers this ${node.kind} statement; its stated intent cannot be traced.`,
        span: { file: start.file.replaceAll('\\', '/'), start: { line: start.line, column: start.column },
          ...(end ? { end: { line: end.line, column: end.column } } : {}) },
        hint: (unsupported
          ? 'This statement has no supported intent-link target in the current contract. Do not insert an orphan link here. The example below shows standalone top-level link syntax, not an immediate repair for this statement. Extending target support requires a separate contract change.\n' : '')
          + HINT + (isRoot ? '' : '\nThis statement belongs to an instantiated import. Add its anchor and link in the original definition document. Root links cannot cover imported statements.'),
        reference: 'docs/INTENT-ANCHOR-MAP.md#default-behavior-coverage-warnings',
      });
    }
  }
  return { diagnostics, ...(missing > LIMIT ? { collection: { limit: LIMIT, truncated: true } } : {}) };
}
