import { Parser } from 'commonmark';
import { canonicalJson } from './canonical-json.mjs';
import { sha256Hex } from './sha256.mjs';
import { extractLiterate } from './literate.mjs';
import { parseControl, compileControl } from './control.mjs';
import { check, fail, frozen, bound, validateLegacyAdmission as validateBoundLegacyAdmission } from './legacy-admission-contract.mjs';
export { LegacyAdmissionError, preflightLegacyAdmission } from './legacy-admission-contract.mjs';
const DIRECTIVE = 'ghostflow:legacy-scalar-admission';
const FORMAT = 'GhostFlow/legacy-scalar-admission-v1';
const POLICY = 'required-current-bool-snapshot';

export function legacyAdmissionInputs(ast, record) {
  if (ast.kind !== 'control' || ast.imports?.length || ast.body.some(node => ['syntax','macro','function','input','shared-constraints','account','account-constraints'].includes(node.kind))) {
    fail('Legacy migration supports only standalone ordinary Bool input controls', 'legacy_admission_unsupported');
  }
  const ports = ast.body.filter(node => node.kind === 'sensor');
  if (!ports.length || ports.some(node => node.type?.name !== 'Bool' || node.optional || Object.keys(node.options ?? {}).length)) {
    fail('Legacy migration requires unconditioned required Bool inputs', 'legacy_admission_unsupported');
  }
  const inputs = ports.map(node => ({ name: node.name, type: 'Bool' }));
  if (record && canonicalJson(inputs) !== canonicalJson(record.inputs)) fail('Legacy admission declarations changed');
  return inputs;
}

export function previewLegacyScalarMigration(source, { filename = 'program.ghost.md', sourceInputContract } = {}) {
  if (sourceInputContract !== undefined && sourceInputContract !== POLICY) fail('Unsupported source input contract', 'legacy_admission_unsupported');
  if (inspectLegacyAdmissionSource(source)) fail('Source already declares legacy admission', 'legacy_migration_not_required');
  const code = extractLiterate(source, { filename }).code;
  const ast = parseControl(code, { filename });
  const inputs = legacyAdmissionInputs(ast);
  // Already valid quality-aware programs must not acquire an unrelated contract.
  let currentValid = false; try { compileControl(code, { filename }); currentValid = true; } catch { /* checked below with the explicit raw contract */ }
  if (currentValid && sourceInputContract !== POLICY) fail('Source needs an explicit known legacy input contract', 'legacy_migration_not_required');
  try { compileControl(code, { filename, rawSnapshotInputs: inputs.map(input => input.name) }); }
  catch { fail('Source is outside the supported legacy Bool migration subset', 'legacy_admission_unsupported'); }
  const embedded = check({ format: FORMAT, contractVersion: 1, policy: POLICY, originalSourceSha256: sha256Hex(source), inputs });
  const document = `${source}${source.endsWith('\n') ? '' : '\n'}\n## Legacy input admission / 기존 입력 검증\n\n<!-- ghostflow:legacy-scalar-admission-v1 ${canonicalJson(embedded)} -->\n\nLegacy input migration: required Bool snapshots are admitted before execution; missing or invalid frames do not commit.\n기존 입력 이전: 필수 Bool 스냅샷을 실행 전에 검사하며 누락되거나 잘못된 프레임은 커밋하지 않습니다.\n`;
  const legacyAdmission = bound(embedded, document);
  if (canonicalJson(inspectLegacyAdmissionSource(document)) !== canonicalJson(embedded)) fail('Source cannot carry a standalone admission directive', 'legacy_admission_unsupported');
  const receiptBody = { format: 'GhostFlow/legacy-scalar-migration-receipt-v1', contractVersion: 1,
    originalSourceSha256: embedded.originalSourceSha256, convertedSourceSha256: sha256Hex(document), contractSha256: legacyAdmission.sha256 };
  const receipt = { ...receiptBody, previewSha256: sha256Hex(canonicalJson(receiptBody)) };
  return frozen({ format: 'GhostFlow/legacy-scalar-migration-preview-v1', document, receipt, legacyAdmission });
}


/** Only top-level HTML directives are executable metadata; fenced examples are prose. */
export function inspectLegacyAdmissionSource(source, { filename = 'program.ghost.md', bound: bindSource = false } = {}) {
  if (typeof source !== 'string') fail('Legacy admission source must be text');
  if (!source.includes(DIRECTIVE)) return null;
  const walker = new Parser().parse(source).walker(); let event, found = null;
  while ((event = walker.next())) {
    const node = event.node;
    if (!event.entering || node.type !== 'html_block' || !node.literal.includes(DIRECTIVE)) continue;
    if (node.parent?.type !== 'document' || found) fail('Legacy admission directive must occur once at document level');
    const match = /^<!-- ghostflow:legacy-scalar-admission-v1 (\{[^\n]*\}) -->\s*$/.exec(node.literal);
    if (!match) fail('Malformed or unsupported legacy admission directive');
    let record; try { record = JSON.parse(match[1]); } catch { fail('Malformed legacy admission directive JSON'); }
    if (canonicalJson(record) !== match[1]) fail('Legacy admission directive must use canonical JSON');
    found = check(record);
  }
  return found && bindSource ? bound(found,source) : found;
}

export function assertLegacyAdmissionTarget(source, { supported } = {}) {
  const record = inspectLegacyAdmissionSource(source);
  if (record && supported !== true) fail('This target cannot enforce legacy input admission', 'legacy_admission_unsupported');
}


export function validateLegacyAdmission(compilation) {
  const contract = validateBoundLegacyAdmission(compilation);
  if (!contract && compilation.sourceDocument !== undefined) {
    const source = typeof compilation.sourceDocument === 'string' ? compilation.sourceDocument : compilation.sourceDocument?.text;
    if (inspectLegacyAdmissionSource(source)) fail('Source admission directive requires bound artifact metadata');
  }
  if (contract && compilation.sourceDocument !== undefined) {
    const source = typeof compilation.sourceDocument === 'string' ? compilation.sourceDocument : compilation.sourceDocument?.text;
    const embedded = inspectLegacyAdmissionSource(source);
    if (!embedded || canonicalJson(bound(embedded, source)) !== canonicalJson(contract)) fail('Legacy admission source binding mismatch');
    legacyAdmissionInputs(parseControl(extractLiterate(source).code), embedded);
  }
  return contract;
}
