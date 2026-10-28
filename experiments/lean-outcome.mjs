const infrastructureDiagnostic = /unknown identifier|unknown constant|could not import|unknown module|failed to load|no such file|timed out|maximum recursion depth|maximum number of heartbeats|out of memory/i;

export function leanOutcomeMatches(result, log, expectedSuccess, diagnostic) {
  if (result.error || result.signal || !Number.isInteger(result.status) || infrastructureDiagnostic.test(log)) return false;
  if (!expectedSuccess && (typeof diagnostic !== 'string' || diagnostic.length === 0)) return false;
  return (result.status === 0) === expectedSuccess
    && (!diagnostic || log.includes(diagnostic))
    && (!expectedSuccess || !log.includes('sorryAx'));
}
