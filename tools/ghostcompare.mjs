#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decode, encode } from '@toon-format/toon';
import { BEHAVIOR_COMPARISON_LIMITS, compareBehavior } from './behavior-comparison.mjs';

function arguments_(args) {
  let requestPath, format = 'toon', formatSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--request' && !requestPath && args[index + 1]) { requestPath = args[++index]; continue; }
    if (args[index] === '--format' && !formatSeen && ['json', 'toon'].includes(args[index + 1])) {
      format = args[++index]; formatSeen = true; continue;
    }
    throw new Error(`unsupported or incomplete argument ${args[index]}`);
  }
  if (!requestPath) throw new Error('--request requires a JSON or TOON file');
  return { requestPath, format };
}
function readRequest(filename) {
  if (fs.statSync(filename).size > BEHAVIOR_COMPARISON_LIMITS.requestBytes) throw new Error('request byte limit exceeded');
  const bytes = fs.readFileSync(filename);
  if (bytes.byteLength > BEHAVIOR_COMPARISON_LIMITS.requestBytes) throw new Error('request byte limit exceeded');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return text.trimStart().startsWith('{') ? JSON.parse(text) : decode(text, { strict: true });
}
function output(result, format) {
  process.stdout.write(format === 'json' ? `${JSON.stringify(result)}\n` : `${encode(result)}\n`);
}

export async function runCompareCli(args) {
  let format = args.includes('json') ? 'json' : 'toon';
  try {
    const parsed = arguments_(args);
    format = parsed.format;
    const request = readRequest(parsed.requestPath);
    const result = await compareBehavior(request);
    output(result, format);
    if (result.outcome !== 'completed') process.exitCode = 1;
  } catch (error) {
    output({ format: 'GhostFlow/behavior-comparison-result-v1', outcome: 'rejected',
      error: { code: error.code ?? 'GF_BEHAVIOR_COMPARISON', message: String(error.message).slice(0, 4096),
        ...(error.path ? { path: error.path } : {}) } }, format);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runCompareCli(process.argv.slice(2));
}
