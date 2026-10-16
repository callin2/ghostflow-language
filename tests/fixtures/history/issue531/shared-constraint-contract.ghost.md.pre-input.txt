# A complete checked shared resource contract

This one-control document is a checked **nonexecutable descriptor**. Its
software-only logical mapping is fully shown below. It neither installs a
control nor protects physical outputs: runtime enforcement is the separate
contract tracked by #158. Input and output names are logical ports, and the
resource IDs below name virtual resources rather than discovered hardware.

The explicit safe values select pump=false and valve=true for this virtual
loop. They satisfy the authored pump-needs-valve requirement. This is not an
all-OFF default or a physical sequencing instruction.

```ghost
control SharedPumpPolicy {
  resource station: Station;
  resource pump1: BoolActuator;
  resource valve1: BoolActuator;
  input automatic, manual, pump_request, valve_request: Bool;
  output pump, valve: Bool;
  pump <- pump_request;
  valve <- valve_request;
  constraints SharedRules for station {
    exclusive at admission { automatic, manual };
    require at safe_output pump1.on => any_on({ valve1 });
    safe { pump1 = false; valve1 = true; }
  }
}
```

Run the following JavaScript from the repository root to validate only the
logical mapping. The hashes come from this exact document and checked artifact;
the installation mapping supplies identity and typed ports, not another program
or a replacement policy. All resource aliases and modes have explicit mappings.
Changing a policy, prose revision, artifact or binding requires revalidation.

```js
import fs from 'node:fs';
import { compileSourceSync } from './tools/compile-source.mjs';
import { validateResourceConstraintBinding } from './runtimes/node/resource-constraints-binding.mjs';

const filename = 'examples/shared-constraint-contract.ghost.md';
const compilation = compileSourceSync(fs.readFileSync(filename, 'utf8'), { filename });
const mapping = {
  format: 'GhostFlow/resource-constraints-binding-v1',
  revision: 'virtual-installation-r1',
  sourceDocumentSha256: compilation.sourceDocument.sha256,
  artifactSha256: compilation.manifest.bytecodeSha256,
  resources: [
    { name: 'station', resourceId: 'virtual/loop' },
    { name: 'pump1', resourceId: 'virtual/pump', output: 'pump' },
    { name: 'valve1', resourceId: 'virtual/valve', output: 'valve' },
  ],
  modes: [
    { group: 'SharedRules', name: 'automatic', input: 'automatic' },
    { group: 'SharedRules', name: 'manual', input: 'manual' },
  ],
};
const validated = validateResourceConstraintBinding(compilation, mapping);
console.log(validated.executable); // false: validation grants no execution
```

Missing/mismatched identities or ports, stale hashes, aliased resource IDs,
duplicate exclusive inputs and policy fields in the mapping reject. Both native
and WASM module loaders reject these descriptor bytes, even if a caller changes
the JSON `executable` flag. Admission arbitration, ongoing safe transitions,
recovery and a sole writer covering every use path must be implemented and
verified before this shared contract can execute. No physical output ABI is
defined by this logical mapping.
