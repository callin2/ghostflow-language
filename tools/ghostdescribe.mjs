#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decode, encode } from '@toon-format/toon';
import { TARGET_QUERY_MAX_BYTES, TARGET_QUERY_RESULT, queryTarget } from './target-query.mjs';

function argsOf(args) {
  let request, format = 'toon', seenFormat = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--request' && !request && args[i + 1]) { request = args[++i]; continue; }
    if (args[i] === '--format' && !seenFormat && ['json', 'toon'].includes(args[i + 1])) { format = args[++i]; seenFormat = true; continue; }
    throw new Error(`unsupported or incomplete argument ${args[i]}`);
  }
  if (!request) throw new Error('--request requires a JSON or TOON file');
  return { request, format };
}
function read(filename) {
  if (fs.statSync(filename).size > TARGET_QUERY_MAX_BYTES) throw new Error('request byte limit exceeded');
  const bytes = fs.readFileSync(filename);
  if (bytes.byteLength > TARGET_QUERY_MAX_BYTES) throw new Error('request byte limit exceeded');
  const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return value.trimStart().startsWith('{') ? JSON.parse(value) : decode(value, { strict: true });
}
function emit(value, format) { process.stdout.write(`${format === 'json' ? JSON.stringify(value) : encode(value)}\n`); }

export function runDescribeCli(args) {
  let format = args.includes('json') ? 'json' : 'toon';
  try {
    const parsed = argsOf(args);
    format = parsed.format;
    const result = queryTarget(read(parsed.request));
    emit(result, format);
    if (result.outcome === 'incomplete') process.exitCode = 1;
  } catch (error) {
    emit({ schema: TARGET_QUERY_RESULT, outcome: 'rejected', error: {
      code: error.code ?? 'GF_TARGET_QUERY', message: String(error.message).slice(0, 4096),
      ...(error.path ? { path: error.path } : {}) } }, format);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runDescribeCli(process.argv.slice(2));
}
