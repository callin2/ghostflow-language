#!/usr/bin/env node
// PlantUML diagram pipeline for authored documentation.
//
//   npm run docs:diagrams:fetch                 place the pinned PlantUML jar in .cache/plantuml/ (sha256 verified)
//   npm run docs:diagrams:fetch -- --from JAR   copy a local jar instead of downloading (still sha256 verified)
//   npm run docs:diagrams                       render every docs/diagrams/**/*.puml to a sibling .svg
//   npm run docs:diagrams -- --stale            render only diagrams whose SVG is missing or stale
//   npm run docs:diagrams -- FILE…              render only the listed .puml files
//   npm run docs:diagrams:check                 verify every SVG matches its current .puml (no Java needed)
//
// Options: --root DIR renders/checks the docs/diagrams tree under DIR instead of
// this repository (the pin and jar still come from this repository);
// --jobs N sets render parallelism.
// Rendering needs Java 17+ (`PLANTUML_JAVA`, then `$JAVA_HOME/bin/java`, then `java`).
// `PLANTUML_JAR` may point at a jar elsewhere; it must match the pinned sha256.
// Each SVG carries a `ghostflow-diagram` comment with the sha256 of its .puml
// source (plus the shared style when the source includes it), so the check is
// deterministic on any machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DIAGRAM_ROOT = 'docs/diagrams';
export const STYLE = 'docs/diagrams/_style.puml';
export const LANGUAGES = Object.freeze(['en', 'ko', 'zh', 'es', 'ja']);
const TOOL_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PIN = 'tools/plantuml.json';
const MARKER = /<!-- ghostflow-diagram source-sha256=([a-f0-9]{64}) plantuml=([^\s]+) -->/;
const STYLE_INCLUDE = /^[ \t]*!include(?:_once)?[ \t]+(?:\.\.\/)?_style\.puml[ \t]*$/m;

const sha256 = data => createHash('sha256').update(data).digest('hex');
const posix = file => file.split(path.sep).join('/');

export function listDiagrams(root) {
  const found = [];
  const walk = dir => {
    if (!fs.existsSync(path.join(root, dir))) return;
    for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${dir}/${item.name}`;
      if (item.isDirectory()) walk(file);
      else if (item.isFile() && item.name !== '.DS_Store') found.push(file);
    }
  };
  walk(DIAGRAM_ROOT);
  return found;
}

// Shared includes start with `_` and never render on their own.
export const isSource = file => file.endsWith('.puml') && !path.posix.basename(file).startsWith('_');

// The digest covers the source and, only when the source includes it, the
// shared style. Including the style is optional.
export function sourceDigest(root, puml) {
  const source = fs.readFileSync(path.join(root, puml));
  const usesStyle = STYLE_INCLUDE.test(source.toString('utf8')) && fs.existsSync(path.join(root, STYLE));
  return sha256(usesStyle ? Buffer.concat([source, Buffer.from('\0'), fs.readFileSync(path.join(root, STYLE))]) : source);
}

function diagramState(root, file, version, set) {
  const svg = file.replace(/\.puml$/, '.svg');
  if (!set.has(svg)) return `missing rendered SVG: ${svg}`;
  const marker = MARKER.exec(fs.readFileSync(path.join(root, svg), 'utf8'));
  if (!marker) return `SVG lacks ghostflow-diagram marker (re-render): ${svg}`;
  if (marker[1] !== sourceDigest(root, file)) return `stale SVG (re-render): ${svg}`;
  if (marker[2] !== version) return `SVG rendered with PlantUML ${marker[2]}, pinned ${version} (re-render): ${svg}`;
  return null;
}

export function checkDiagrams(root, version = readPin().version) {
  const files = listDiagrams(root), set = new Set(files), problems = [];
  for (const file of files) {
    if (isSource(file)) {
      const name = path.posix.basename(file, '.puml');
      const language = /\.([a-z]{2})$/.exec(name)?.[1];
      if (language && !LANGUAGES.includes(language)) problems.push(`unsupported diagram language: ${file}`);
      if (language && !set.has(file.replace(new RegExp(`\\.${language}\\.puml$`), '.puml'))) problems.push(`translated diagram without English base: ${file}`);
      const problem = diagramState(root, file, version, set);
      if (problem) problems.push(problem);
    } else if (file.endsWith('.svg')) {
      if (!set.has(file.replace(/\.svg$/, '.puml'))) problems.push(`SVG without PlantUML source: ${file}`);
    } else if (!file.endsWith('.puml')) problems.push(`unexpected file in ${DIAGRAM_ROOT}: ${file}`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return { diagrams: files.filter(isSource).length };
}

export function staleDiagrams(root, version = readPin().version) {
  const files = listDiagrams(root), set = new Set(files);
  return files.filter(file => isSource(file) && diagramState(root, file, version, set));
}

export function stampSvg(svgText, digest, version) {
  const cleaned = svgText.replace(new RegExp(MARKER.source, 'g'), '');
  const open = cleaned.indexOf('<svg');
  const end = open < 0 ? -1 : cleaned.indexOf('>', open);
  if (end < 0) throw new Error('PlantUML output is not SVG');
  return `${cleaned.slice(0, end + 1)}<!-- ghostflow-diagram source-sha256=${digest} plantuml=${version} -->${cleaned.slice(end + 1)}`;
}

export function readPin() {
  const pin = JSON.parse(fs.readFileSync(path.join(TOOL_ROOT, PIN), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pin.version || '')) throw new Error(`${PIN}: invalid version`);
  if (pin.sha256 && !/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error(`${PIN}: invalid sha256`);
  return pin;
}

// .cache/ is ignored by Git, so the jar is never committed.
export const jarPath = pin => process.env.PLANTUML_JAR
  ? path.resolve(process.env.PLANTUML_JAR)
  : path.join(TOOL_ROOT, '.cache', 'plantuml', `plantuml-${pin.version}.jar`);

async function fetchJar({ pinDigest = false, from } = {}) {
  const pin = readPin();
  const target = path.join(TOOL_ROOT, '.cache', 'plantuml', `plantuml-${pin.version}.jar`);
  let data;
  if (from) data = fs.readFileSync(path.resolve(from));
  else if (fs.existsSync(target)) data = fs.readFileSync(target);
  else {
    const url = pin.url.replaceAll('{version}', pin.version);
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`download failed ${response.status}: ${url}`);
    data = Buffer.from(await response.arrayBuffer());
  }
  const digest = sha256(data);
  if (!pin.sha256) {
    if (!pinDigest) throw new Error(`${PIN} has no sha256; verify the release and rerun with --pin to record ${digest}`);
    fs.writeFileSync(path.join(TOOL_ROOT, PIN), `${JSON.stringify({ ...pin, sha256: digest }, null, 2)}\n`);
    console.log(`Pinned PlantUML ${pin.version} sha256 ${digest}`);
  } else if (digest !== pin.sha256) throw new Error(`PlantUML jar sha256 ${digest} does not match pinned ${pin.sha256}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target) || sha256(fs.readFileSync(target)) !== digest) fs.writeFileSync(target, data);
  return target;
}

function javaCommand() {
  if (process.env.PLANTUML_JAVA) return process.env.PLANTUML_JAVA;
  if (process.env.JAVA_HOME) return path.join(process.env.JAVA_HOME, 'bin', 'java');
  return 'java';
}

// Renders one source through -pipe so the output name never depends on an
// `@startuml NAME` label; includes resolve relative to the source directory.
function renderOne(java, jar, root, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(java, ['-Djava.awt.headless=true', '-Dfile.encoding=UTF-8', '-jar', jar,
      '-tsvg', '-charset', 'UTF-8', '-nometadata', '-failfast2', '-pipe'], { cwd: path.dirname(path.join(root, file)) });
    const out = [], err = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      const svg = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8').split('\n').filter(line => line && !/Secure coding|NSApplicationDelegate/.test(line)).join('\n');
      if (code !== 0 || !svg.includes('<svg') || /Syntax Error\?|An error has occured/i.test(svg)) {
        reject(new Error(`PlantUML failed for ${file} (exit ${code})${stderr ? `\n${stderr}` : ''}`));
      } else resolve(svg);
    });
    child.stdin.end(fs.readFileSync(path.join(root, file)));
  });
}

export async function renderDiagrams(root, files = [], { jobs = Math.min(8, os.cpus().length), stale = false } = {}) {
  const pin = readPin();
  const jar = jarPath(pin);
  if (!fs.existsSync(jar) || !pin.sha256 || sha256(fs.readFileSync(jar)) !== pin.sha256) throw new Error('PlantUML jar missing or unverified; run npm run docs:diagrams:fetch');
  let sources = files.length ? files.map(file => posix(path.relative(root, path.resolve(root, file)))) : listDiagrams(root).filter(isSource);
  for (const file of sources) if (!file.startsWith(`${DIAGRAM_ROOT}/`) || !isSource(file) || !fs.existsSync(path.join(root, file))) throw new Error(`not a diagram source: ${file}`);
  if (stale) { const pending = new Set(staleDiagrams(root, pin.version)); sources = sources.filter(file => pending.has(file)); }
  const java = javaCommand(), failures = [];
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const file = sources[next++];
      try {
        const svg = await renderOne(java, jar, root, file);
        fs.writeFileSync(path.join(root, file.replace(/\.puml$/, '.svg')), stampSvg(svg, sourceDigest(root, file), pin.version));
      } catch (error) { failures.push(error.message); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
  if (failures.length) throw new Error(failures.join('\n'));
  return sources.length;
}

function parseArgs(argv) {
  const options = { files: [] };
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    const value = () => { const next = argv[++at]; if (next === undefined) throw new Error(`${arg} needs a value`); return next; };
    if (arg === '--check') options.check = true;
    else if (arg === '--fetch') options.fetch = true;
    else if (arg === '--pin') options.pin = true;
    else if (arg === '--stale') options.stale = true;
    else if (arg === '--from') options.from = value();
    else if (arg === '--root') options.root = path.resolve(value());
    else if (arg === '--jobs') options.jobs = Number(value());
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else options.files.push(arg);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const root = options.root ?? TOOL_ROOT;
    if (options.check) console.log(`Documentation diagrams: PASS (${checkDiagrams(root).diagrams} diagrams)`);
    else if (options.fetch) console.log(`PlantUML jar: ${posix(path.relative(TOOL_ROOT, await fetchJar({ pinDigest: options.pin, from: options.from })))}`);
    else {
      const count = await renderDiagrams(root, options.files.map(file => path.relative(root, path.resolve(file))), { jobs: options.jobs, stale: options.stale });
      if (!options.files.length) checkDiagrams(root);
      console.log(`Rendered ${count} diagram(s)`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
