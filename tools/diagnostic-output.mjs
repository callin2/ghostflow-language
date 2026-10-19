/** Human-readable diagnostics shared by CLI and browser-safe package creation. */
export function formatDiagnostic(diagnostic) {
  if (typeof diagnostic === 'string') return `warning: ${diagnostic}`;
  const start = diagnostic.span?.start;
  const location = diagnostic.span?.file && start
    ? `${diagnostic.span.file}:${start.line}:${start.column}: ` : '';
  const severity = diagnostic.severity ?? 'warning';
  const code = diagnostic.code ? ` ${diagnostic.code}` : '';
  const hint = diagnostic.hint ? `\n${diagnostic.hint}` : '';
  return `${location}${severity}${code}: ${diagnostic.message}${hint}`;
}

/** Diagnostics are advisory output and never become signed artifact fields. */
export function reportWarnings(warnings, onDiagnostic = diagnostic => console.warn(formatDiagnostic(diagnostic))) {
  for (const warning of warnings ?? []) {
    onDiagnostic(typeof warning === 'string' ? { severity: 'warning', message: warning } : warning);
  }
}
