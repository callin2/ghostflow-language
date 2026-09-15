import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPortablePackage, serializePortablePackage } from '../tools/portable-package.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const encoder = new TextEncoder();

function hexBytes(value) {
  return Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16));
}

function concat(...parts) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

const privateDer = concat(
  hexBytes('302e020100300506032b657004220420'),
  hexBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'),
);
const privateKey = await crypto.subtle.importKey('pkcs8', privateDer, 'Ed25519', false, ['sign']);
const identity = {
  compilerRevision: 'c0bef0e',
  runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
  runtimeAbi: 'GhostFlow/framed-scan-abi-v1',
  requiredCapabilities: [
    { kind: 'actuator', name: 'pump', type: 'bool' },
    { kind: 'actuator', name: 'valve', type: 'bool' },
    { kind: 'input', name: 'start', type: 'bool' },
    { kind: 'input', name: 'stop', type: 'bool' },
  ],
  bindingRevision: 'virtual-two-output-v1',
};
const source = fs.readFileSync(path.join(root, 'examples/tutorial/01-latch.ghost.md'), 'utf8');
const compilation = await compileSource(source, { filename: '01-latch.ghost.md' });
const packageValue = await buildPortablePackage(compilation, identity, {
  signers: [{ keyId: 'test-current-2026', privateKey }],
  verifyCompilation: (text, { filename }) => compileSource(text, { filename }),
});
const scenario = process.argv[2] ?? 'valid';
if (scenario === 'valid') {
  process.stdout.write(serializePortablePackage(packageValue));
} else if (scenario === 'unsupported-bytecode-version') {
  const candidate = JSON.parse(JSON.stringify(packageValue));
  candidate.payload.bytecode.version = '2';
  const payloadBytes = encoder.encode(canonicalJson(candidate.payload));
  const payloadDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', payloadBytes));
  candidate.payloadSha256 = Array.from(payloadDigest, byte => byte.toString(16).padStart(2, '0')).join('');
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, payloadBytes));
  candidate.signatures = [{
    algorithm: 'Ed25519',
    keyId: 'test-current-2026',
    signatureBase64: Buffer.from(signature).toString('base64'),
  }];
  process.stdout.write(serializePortablePackage(candidate));
} else {
  throw new Error(`unknown native fixture scenario: ${scenario}`);
}
