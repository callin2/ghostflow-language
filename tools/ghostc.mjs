#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileSource, writeArtifact } from './toolchain.mjs';

export { compileSource } from './toolchain.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const names = args.filter(arg => arg !== '--check');
  if (!names[0] || (!check && !names[1]) || names.length > 2 || names.some(arg => arg.startsWith('--'))) {
    console.error('usage: ghostc <input.ghost.md> <output.gfb>\n       ghostc --check <input.ghost.md>');
    process.exitCode = 2;
  } else {
    try {
      const result = await compileSource(fs.readFileSync(names[0], 'utf8'), { filename: names[0] });
      if (!check) writeArtifact(result, names[1]);
      console.log(`${names[0]}: ${result.bytes.length} bytes; ${result.manifest ? 'control-v1 + host manifest' : 'MVP GFB1'}${check ? ' (checked)' : ` -> ${names[1]}`}`);
      for (const warning of result.warnings ?? []) console.warn(`warning: ${typeof warning === 'string' ? warning : warning.message}`);
    } catch (error) {
      console.error(`ghostc: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
