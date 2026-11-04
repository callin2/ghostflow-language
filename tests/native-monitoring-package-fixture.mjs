import { compileSource } from '../tools/compile-source.mjs';
import { buildPortablePackage, serializePortablePackage } from '../tools/portable-package.mjs';

const source = `\`\`\`ghost
control Finite {
  config first_time: Duration = 10s { min = 1s; max = 60s; step = 1s; access = operator; }
  config rest_time: Duration = 5s { min = 1s; max = 60s; step = 1s; access = operator; }
  type Phase = Idle | First | Rest;
  state phase: Phase = Idle;
  timer age = elapsed(phase);
  let first = first_time |> recover(0ms);
  let rest = rest_time |> recover(0ms);
  input start: Bool;
  phase' = case phase {
    Idle => if (start |> recover(false)) then First else Idle;
    First => if age >= first then Rest else First;
    Rest => if age >= rest then Idle else Rest;
  };
  output pump: Bool;
  pump <- phase' == First;
}
\`\`\``;
const compilation = await compileSource(source, { filename: 'finite-monitoring.ghost.md', onDiagnostic: () => {} });
const privateKey = await crypto.subtle.importKey('pkcs8', Buffer.from(
  '302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'), 'Ed25519', false, ['sign']);
const signed = await buildPortablePackage(compilation, {
  compilerRevision: 'c0bef0e', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
  runtimeAbi: 'GhostFlow/context-scan-abi-v5', bindingRevision: 'virtual-two-output-v1',
  requiredCapabilities: [{ kind: 'actuator', name: 'pump', type: 'bool' }, { kind: 'sensor', name: 'start', type: 'bool' }],
}, {
  signers: [{ keyId: 'test-current-2026', privateKey }],
  verifyCompilation: (text, options) => compileSource(text, { ...options, onDiagnostic: () => {} }),
  onDiagnostic: () => {},
});
process.stdout.write(serializePortablePackage(signed));
