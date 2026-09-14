#!/usr/bin/env node
// Optional provenance check.  It deliberately requires an explicit path to a
// checked-out/installable SunCalc 2.0.2 package; it never follows sibling worktrees.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const referenceDir = process.env.GHOSTFLOW_SUNCALC_REFERENCE_DIR;
if (!referenceDir) {
  throw new Error('set GHOSTFLOW_SUNCALC_REFERENCE_DIR to a SunCalc 2.0.2 package directory');
}
const packageJson = JSON.parse(fs.readFileSync(path.join(referenceDir, 'package.json'), 'utf8'));
if (packageJson.version !== '2.0.2') {
  throw new Error(`SunCalc reference must be 2.0.2, got ${String(packageJson.version)}`);
}
const { getTimes } = await import(pathToFileURL(path.join(referenceDir, 'index.js')).href);
const resolvedProvider = path.dirname(fileURLToPath(import.meta.resolve('suncalc')));
if (fs.realpathSync(resolvedProvider) !== fs.realpathSync(referenceDir)) {
  throw new Error('the JavaScript SolarSchedule provider does not resolve to GHOSTFLOW_SUNCALC_REFERENCE_DIR');
}
const { SolarSchedule } = await import(new URL('../runtimes/wasm/solar-schedule.mjs', import.meta.url));
const vectors = fs.readFileSync(new URL('../tests/solar-reference-vectors.txt', import.meta.url), 'utf8')
  .trim().split('\n').filter(line => line && !line.startsWith('#'));
for (const line of vectors) {
  const [year, month, day, latitude, longitude, event, expected] = line.split('|');
  const noon = Date.parse(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T12:00:00Z`);
  const actual = getTimes(new Date(noon), Number(latitude), Number(longitude), 0)[event === 'rise' ? 'sunrise' : 'sunset']?.getTime();
  if (!Number.isFinite(actual) || !Number.isFinite(Number(expected)) || Math.abs(actual - Number(expected)) > 1) {
    throw new Error(`SunCalc vector mismatch: ${line}; got ${actual}`);
  }
}
const parityVectors = fs.readFileSync(new URL('../tests/solar-provider-parity-vectors.txt', import.meta.url), 'utf8')
  .trim().split('\n').filter(line => line && !line.startsWith('#'));
for (const line of parityVectors) {
  const [name, timezone, latitude, longitude, event, offsetMs, previewWallMs, date, eventWallMs, scheduledWallMs] = line.split('|');
  const numeric = [latitude, longitude, offsetMs, previewWallMs, eventWallMs, scheduledWallMs].map(Number);
  if (numeric.some(value => !Number.isFinite(value))) throw new Error(`non-finite parity vector: ${line}`);
  const host = new SolarSchedule({ kind: 'solar', name: 'sun', timezone, latitude: numeric[0], longitude: numeric[1],
    event, offsetMs: numeric[2], fallback: 'skip' });
  const preview = host.preview(numeric[3]);
  if (preview.date !== date || !Number.isFinite(preview.eventWallMs) || !Number.isFinite(preview.scheduledWallMs)
    || Math.abs(preview.eventWallMs - numeric[4]) > 1 || Math.abs(preview.scheduledWallMs - numeric[5]) > 1) {
    throw new Error(`SolarSchedule preview mismatch: ${line}; got ${JSON.stringify(preview)}`);
  }
  if (host.poll({ nowMs: 0, wallMs: numeric[5] - 1, trusted: true }).reason !== 'BootBaseline') {
    throw new Error(`SolarSchedule boot baseline mismatch: ${line}`);
  }
  const pulse = host.poll({ nowMs: 1, wallMs: numeric[5], trusted: true });
  if (!pulse.due || pulse.date !== date || !Number.isFinite(pulse.eventWallMs) || !Number.isFinite(pulse.scheduledWallMs)) {
    throw new Error(`SolarSchedule pulse mismatch: ${line}; got ${JSON.stringify(pulse)}`);
  }
}
console.log(`PASS — ${vectors.length} SunCalc calculations and ${parityVectors.length} SolarSchedule preview/pulse vectors`);
