import { canonicalJson } from './canonical-json.mjs';
import { sha256Hex } from './sha256.mjs';

const CHECKER = 'GhostFlow/adjacent-constraint-effect-checker-v1';
const MAX_NAMES = 8;
const MAX_CONSTRAINTS = 128;
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const digest = value => sha256Hex(canonicalJson(value));
const RULE = 'adjacent-exact-ordered-bool-constraint-v1';
const SCOPE = 'GhostFlow/bool-output-constraint-effect-v1';
function certificateDigest(proof) {
  const { certificateSha256: _digest, ...content } = proof;
  return digest(content);
}

// Deliberately separate from candidate selection. This models the portable
// core's Bool constraint effect, including ordered fault spelling and duplicate
// mutex names. It never models a source Boolean require as a predicate.
function effect(form, values, faults = []) {
  const [kind, ...names] = form;
  const on = name => values[name] === true;
  const blocked = kind === 'mutex'
    ? (names.filter(on).length > 1 ? names.filter(on) : [])
    : (on(names[0]) && !names.slice(1).some(on) ? [names[0]] : []);
  const fault = blocked.length ? (kind === 'mutex'
    ? `mutex:${names.join(',')}` : `requires:${names[0]}:${names.slice(1).join('|')}`) : null;
  return {
    blocked: [...new Set(blocked)].sort(),
    faults: [...new Set([...faults, ...(fault ? [fault] : [])])].sort(),
    safe: { ...values, ...Object.fromEntries(blocked.map(name => [name, false])) },
  };
}

export function verifyConstraintProof(proof) {
  if (!proof || Object.keys(proof).sort().join(',') !== 'certificateSha256,checker,compiled,compiledSha256,original,originalSha256,rule,scope,sourceToCompiled,status'
      || proof.checker !== CHECKER || !Array.isArray(proof.original)
      || !Array.isArray(proof.compiled) || !Array.isArray(proof.sourceToCompiled)
      || proof.original.length > MAX_CONSTRAINTS || proof.original.length !== proof.sourceToCompiled.length) {
    throw new Error('invalid constraint proof shape or budget');
  }
  if (proof.rule !== RULE || proof.scope !== SCOPE || proof.status !== 'independently-verified'
      || proof.originalSha256 !== digest(proof.original) || proof.compiledSha256 !== digest(proof.compiled)
      || proof.certificateSha256 !== certificateDigest(proof)) throw new Error('constraint proof identity or digest mismatch');
  let compiledIndex = -1;
  let merged = false;
  for (let i = 0; i < proof.original.length; i++) {
    const form = proof.original[i];
    if (!Array.isArray(form) || !['requires', 'requires-any', 'mutex'].includes(form[0])
        || form.length < 3 || form.length > 33 || (form[0] === 'requires' && form.length !== 3)
        || (form[0] === 'requires-any' && form.length < 4)
        || new Set(form.slice(1)).size !== form.length - 1
        || form.slice(1).some(name => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
      throw new Error('invalid constraint proof domain');
    }
    const index = proof.sourceToCompiled[i];
    const duplicate = i > 0 && index === compiledIndex;
    if (duplicate) {
      if (!equal(form, proof.original[i - 1])) throw new Error('replacement is not an adjacent exact duplicate');
      const names = [...new Set(form.slice(1))].sort();
      if (names.length > MAX_NAMES || form.length - 1 > 32) throw new Error('constraint proof truth-table budget exceeded');
      for (let mask = 0; mask < 2 ** names.length; mask++) {
        const values = Object.fromEntries(names.map((name, bit) => [name, Boolean(mask & (1 << bit))]));
        const original = effect(form, values);
        const replacement = effect(proof.compiled[index], values);
        if (!equal(original, replacement)
            || !equal(effect(form, original.safe, original.faults).safe, original.safe)
            || !equal(effect(form, original.safe, original.faults).faults, original.faults)) {
          throw new Error('constraint effect/idempotence certificate failed');
        }
      }
      merged = true;
    } else {
      compiledIndex++;
      if (index !== compiledIndex || !equal(form, proof.compiled[index])) throw new Error('constraint proof changes retained order or effect');
    }
  }
  if (!merged || compiledIndex + 1 !== proof.compiled.length) throw new Error('constraint proof has no replacement or extra compiled checks');
  return true;
}

export function checkedAdjacentConstraints(original, check = verifyConstraintProof) {
  if (original.length > MAX_CONSTRAINTS) return null;
  const compiled = [];
  const sourceToCompiled = [];
  for (let i = 0; i < original.length; i++) {
    const form = original[i];
    const eligible = new Set(form.slice(1)).size <= MAX_NAMES && form.length - 1 <= 32;
    if (!eligible || i === 0 || !equal(form, original[i - 1])) compiled.push(form);
    sourceToCompiled.push(compiled.length - 1);
  }
  if (compiled.length === original.length) return null;
  const proof = { checker: CHECKER, rule: RULE, scope: SCOPE, status: 'independently-verified',
    original: original.map(form => [...form]), compiled: compiled.map(form => [...form]), sourceToCompiled,
    originalSha256: digest(original), compiledSha256: digest(compiled) };
  proof.certificateSha256 = certificateDigest(proof);
  // Optional candidate/checker failure never creates a source-language error.
  try { if (check(proof) !== true) return null; } catch { return null; }
  return proof;
}
