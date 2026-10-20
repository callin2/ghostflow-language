/** Content-free, optional compiler observations. No transport or artifact fields.
 * Detector v1 counts authored root AST occurrences, including unused branches.
 * ast.* counts parser constructs; type.* counts explicit supported annotations;
 * call.* counts supported builtin spellings. These are a separate detector
 * vocabulary, not a claim of full feature-catalog or dynamic execution coverage.
 * Imported definitions, expanded instances, unsupported constructs and partial
 * parses are unmeasured, never reported as zero usage.
 */
export const COMPILER_TELEMETRY_PHASES = Object.freeze(['extract', 'parse', 'compile_lower_encode', 'postprocess']);
export const COMPILER_DIAGNOSTIC_CODES = Object.freeze(['GF_LITERATE', 'GF_PARSE', 'GF_SEMANTIC', 'GF_TYPE', 'GF_IMPORT', 'GF_HARDWARE', 'GF_INTENT_PROVENANCE', 'GF_INTENT_EVIDENCE', 'GF_UNKNOWN']);
const kinds = Object.freeze(['control', 'resource-policy', 'import', 'input', 'output', 'state', 'parameter', 'instance', 'connect', 'config', 'let', 'enum', 'function', 'syntax', 'event', 'sensor', 'signal', 'schedule', 'timer', 'next', 'connection', 'require', 'mutex', 'adapt', 'objective', 'degraded', 'adapt-setting', 'strategy', 'account', 'account-constraints', 'resource', 'shared-constraints', 'local-constraints', 'exclusive', 'resource-safe-value', 'binary', 'unary', 'literal', 'reference', 'nextReference', 'member', 'if', 'case', 'in', 'list', 'splice', 'call']);
const types = Object.freeze(['Bool', 'Int', 'Number', 'Percent', 'Duration', 'Result', 'Rate']);
const calls = Object.freeze(['continuous_true', 'true_for', 'elapsed', 'debounce', 'hysteresis', 'lowpass', 'moving_average', 'after_event', 'after_event_any', 'after_event_all', 'count_events', 'hold_last', 'calendar_is', 'instant']);
export const COMPILER_FEATURE_IDS = Object.freeze([...kinds.map(id => `ast.${id}`), ...types.map(id => `type.${id}`), ...calls.map(id => `call.${id}`)].sort());
const featureIds = new Set(COMPILER_FEATURE_IDS), codes = new Set(COMPILER_DIAGNOSTIC_CODES);

function observe(callback, value) {
  try {
    // Rejected async observers must never become unhandled rejections.
    Promise.resolve(callback(value)).catch(() => {});
  } catch { /* Observers cannot change compilation. */ }
}

export function createCompilerTelemetry(callback) {
  if (typeof callback !== 'function') return null;
  let phase, started, ast;
  const clock = () => globalThis.performance.now();
  const emit = value => observe(callback, value);
  const close = () => {
    if (phase) emit({ event: 'compiler.phase', phase, durationMs: Math.max(0, clock() - started) });
    phase = undefined;
  };
  return {
    phase(next) { close(); phase = next; started = clock(); },
    ast(value) { ast = value; },
    diagnostics(error) {
      const diagnostics = error?.diagnosticEnvelope?.diagnostics ?? [{ code: error?.diagnosticCode }];
      const counts = new Map();
      for (const diagnostic of diagnostics) {
        const code = codes.has(diagnostic.code) ? diagnostic.code : 'GF_UNKNOWN';
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      for (const [code, count] of counts) emit({ event: 'compiler.diagnostic', code,
        category: code === 'GF_UNKNOWN' ? 'unknown' : 'validation', count,
        truncated: error?.diagnosticEnvelope?.collection?.truncated === true });
    },
    finish() {
      close();
      // Only completed root parses are measured. Never count generated/expanded ASTs.
      if (!ast) return;
      const counts = new Map(), seen = new Set();
      const add = id => { if (featureIds.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1); };
      const annotation = type => {
        if (!type || typeof type !== 'object') return;
        add(`type.${type.name}`);
        for (const argument of type.args ?? []) annotation(argument);
      };
      const visit = value => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) { for (const item of value) visit(item); return; }
        if (value.loc && typeof value.kind === 'string') {
          add(`ast.${value.kind}`);
          if (value.kind === 'call') add(`call.${value.name}`);
        }
        for (const key of ['type', 'annotation', 'result']) annotation(value[key]);
        for (const [key, child] of Object.entries(value)) {
          if (!['sourceNodes', 'loc', 'extracted'].includes(key)) visit(child);
        }
      };
      visit(ast);
      emit({ event: 'compiler.features', features: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => ({ id, count })),
        coverage: 'static', detectorVersion: 1, scope: 'root', detectorSupport: 'authored-ast-subset' });
    },
  };
}
