import { compileSource as compileProductSource } from '../../tools/toolchain.mjs';

/** Test construction helper: the product compiler always receives CommonMark. */
export function literateDocument(code) {
  return `\`\`\`ghost\n${code}\n\`\`\`\n`;
}

/** Compile inline test programs as newly authored literate documents, never as a plain-source fallback. */
export function compileSource(code, { filename = 'program.ghost', ...options } = {}) {
  if (filename.endsWith('.ghost.md')) return compileProductSource(code, { filename, ...options });
  return compileProductSource(literateDocument(code), { filename: `${filename}.md`, ...options });
}
