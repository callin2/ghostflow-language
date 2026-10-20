import { pathToFileURL } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { buildPortablePackage, serializePortablePackage } from '../tools/portable-package.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { dailySlotsRange } from './helpers/range-source.mjs';

const encoder = new TextEncoder();
export const publicKeyBytes = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex');
const privateKey = await crypto.subtle.importKey('pkcs8', Buffer.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'), 'Ed25519', false, ['sign']);
export const rangeIdentity = {
  compilerRevision: 'c0bef0e', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
  runtimeAbi: 'GhostFlow/context-scan-abi-v5',
  requiredCapabilities: [{ kind: 'actuator', name: 'pump', type: 'bool' }],
  bindingRevision: 'virtual-two-output-v1',
};

export async function civilRangeFixture(scenario = 'valid') {
  const wrapped = scenario.startsWith('lifecycle-');
  let source = dailySlotsRange({ timezone: 'Asia/Seoul', selected: '[22:00]', duration: '7h' });
  if (scenario.includes('predicate')) source = source.replace('control PlannedWatering {', 'control PlannedWatering {\n state gate: Bool = true;').replace('when = true;', 'when = gate && (2.0 > 1.0);').replace('cancel_when = false;', 'cancel_when = !gate;');
  if (scenario.includes('operators')) source = source.replace('control PlannedWatering {', 'control PlannedWatering {\n state count: Int = 2;\n state value: Number = 2.0;\n state gate: Bool = true;')
    .replace('when = true;', 'when = (if gate then (count + 1 > 0) else (count - 1 <= 2)) && ((-count * 2 div 2 % 2) == 0) && (number(count) == value) && (int_exact(value) == count) && (int_floor(value) == count) && (int_ceil(value) == count) && (int_trunc(value) == count) && (int_nearest_even(value) == count) && (((value + 2.0 - 1.0) * 2.0 / 2.0) >= 1.0) && ((value < 3.0) || !gate);')
    .replace('cancel_when = false;', 'cancel_when = !gate;');
  if (scenario.includes('predicate-result')) source = source.replace('control PlannedWatering {', 'control PlannedWatering {\n input request: Bool;').replace('when = gate && (2.0 > 1.0);', 'when = (request |> recover(false)) && gate;');
  if (wrapped) source = source.replace('control PlannedWatering {', 'control PlannedWatering {\n type RestartReason = PowerOn | Brownout | Watchdog | Software | Unknown;\n input restart_reason: RestartReason;\n input restart_event: Bool;').replace('pump <- watering.active;', 'pump <- watering.active || restart_event;');
  const compilation = await compileSource(source, { filename: 'civil-range-package.ghost.md' });
  const identity = structuredClone(rangeIdentity);
  if (scenario.includes('predicate-result')) identity.requiredCapabilities.push({ kind: 'sensor', name: 'request', type: 'bool' });
  const result = structuredClone(await buildPortablePackage(compilation, identity, {
    signers: [{ keyId: 'test-current-2026', privateKey }], verifyCompilation: compileSource,
  }));
  const name = wrapped ? scenario.slice('lifecycle-'.length) : scenario;
  if (name === 'valid' || name === 'predicate-valid' || name === 'operators-valid' || name === 'predicate-result-valid') return result;
  const manifest = JSON.parse(Buffer.from(result.payload.manifest.contentBase64, 'base64').toString('utf8'));
  const schedule = manifest.schedules[0];
  if (name === 'wrong-zone') schedule.timezone = 'Asia/Tokyo';
  else if (name === 'wrong-slots') schedule.slots[0] += 15;
  else if (name === 'wrong-duration') schedule.policy.basis.durationMs += 1;
  else if (name === 'wrong-site') schedule.site += 1;
  else if (name === 'wrong-name') schedule.name = 'forged';
  else if (name === 'wrong-gap') schedule.policy.gapMs += 1;
  else if (name === 'wrong-dst') schedule.dstRepeated = 'second';
  else if (name === 'wrong-when') schedule.policy.when = 'false';
  else if (name === 'wrong-cancel') schedule.policy.cancelWhen = 'true';
  else if (name === 'predicate-tamper') schedule.policy.when[2][2] = '3';
  else if (name === 'predicate-result-tamper') schedule.policy.when[2] = 'false';
  else if (name === 'missing-schedule') manifest.schedules = [];
  else if (name === 'duplicate-schedule') manifest.schedules.push(structuredClone(schedule));
  else if (name === 'extra-policy') schedule.policy.forged = true;
  else if (name === 'wrong-format') { manifest.format = 'GhostFlow/control-v10'; result.payload.manifest.format = manifest.format; }
  else if (name === 'wrong-abi') result.payload.identity.runtimeAbi = 'GhostFlow/framed-scan-abi-v1';
  else if (name === 'wrong-header') {
    const bytes = Buffer.from(result.payload.bytecode.contentBase64, 'base64'); bytes.writeUInt16LE(20, 4);
    result.payload.bytecode.contentBase64 = bytes.toString('base64'); result.payload.bytecode.version = '20';
    result.payload.bytecode.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
    manifest.bytecodeSha256 = result.payload.bytecode.sha256;
  } else if (name === 'extra-config') manifest.configs.push({ name: 'forged', type: 'Bool', value: false });
  else throw new Error(`unknown civil Range fixture: ${scenario}`);
  const manifestBytes = encoder.encode(canonicalJson(manifest));
  result.payload.manifest.contentBase64 = Buffer.from(manifestBytes).toString('base64');
  result.payload.manifest.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', manifestBytes)).toString('hex');
  const payloadBytes = encoder.encode(canonicalJson(result.payload));
  result.payloadSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', payloadBytes)).toString('hex');
  result.signatures = [{ algorithm: 'Ed25519', keyId: 'test-current-2026', signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', privateKey, payloadBytes)).toString('base64') }];
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(serializePortablePackage(await civilRangeFixture(process.argv[2])));
}
