#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileConstraints } from './constraints.mjs';

export { compileConstraints, ConstraintCompileError, tokenizeConstraints } from './constraints.mjs';

function usage() {
  return 'usage: ghostrules <input.ghost> <output.json>\n       ghostrules --check <input.ghost>';
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const names = args.filter(arg => arg !== '--check');
  if (!names[0] || (!check && !names[1]) || names.length > 2 || names.some(arg => arg.startsWith('--'))) {
    console.error(usage());
    process.exitCode = 2;
  } else {
    try {
      const artifact = compileConstraints(fs.readFileSync(names[0], 'utf8'), { filename: names[0] });
      if (!check) fs.writeFileSync(names[1], `${JSON.stringify(artifact, null, 2)}\n`);
      const count = artifact.groups.reduce((total, group) => total + group.rules.length, 0);
      console.log(`${names[0]}: ${artifact.groups.length} groups, ${count} rules${check ? ' (checked)' : ` -> ${names[1]}`}`);
    } catch (error) {
      console.error(`ghostrules: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
