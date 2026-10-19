const REASON_MEMBERS = Object.freeze(['PowerOn', 'Brownout', 'Watchdog', 'Software', 'Unknown']);
const RESERVED = new Set(['restart_reason', 'restart_event']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function exactKeys(value, required, label) {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}

/** Validate the explicit lifecycle manifest mirror. Returns null when absent. */
export function validateLifecycleManifest(manifestValue) {
  const manifest = object(manifestValue, 'manifest');
  const ports = Array.isArray(manifest.inputs) ? manifest.inputs : [];
  const reservedPorts = ports.filter(port => RESERVED.has(port?.name));
  if (!Object.hasOwn(manifest, 'lifecycle')) {
    if (reservedPorts.length) throw new Error('reserved restart inputs require lifecycle metadata');
    return null;
  }

  const lifecycle = object(manifest.lifecycle, 'manifest.lifecycle');
  exactKeys(lifecycle, ['format', 'restartReasonInput', 'restartReasonMembers', 'restartEventInput'], 'manifest.lifecycle');
  if (lifecycle.format !== 'GhostFlow/lifecycle-v1' || lifecycle.restartReasonInput !== 'restart_reason'
    || lifecycle.restartEventInput !== 'restart_event') throw new Error('unsupported lifecycle descriptor');
  if (!Array.isArray(lifecycle.restartReasonMembers) || lifecycle.restartReasonMembers.length !== REASON_MEMBERS.length) {
    throw new Error('lifecycle restart reason members are invalid');
  }
  const members = lifecycle.restartReasonMembers.map((member, value) => {
    object(member, `manifest.lifecycle.restartReasonMembers[${value}]`);
    exactKeys(member, ['name', 'value'], `manifest.lifecycle.restartReasonMembers[${value}]`);
    if (member.name !== REASON_MEMBERS[value] || member.value !== value) throw new Error('lifecycle restart reason members are invalid');
    return Object.freeze({ name: member.name, value });
  });
  for (const [name, expectedType] of [['restart_reason', 'RestartReason'], ['restart_event', 'Bool']]) {
    const matches = ports.filter(port => port?.name === name);
    if (matches.length !== 1 || matches[0].type !== expectedType) throw new Error(`lifecycle input ${name} must occur once with type ${expectedType}`);
  }
  if (new Set(ports.map(port => port?.name)).size !== ports.length) throw new Error('manifest inputs contain duplicate names');
  if (reservedPorts.length !== 2) throw new Error('lifecycle restart inputs are incomplete');
  return Object.freeze({
    format: lifecycle.format,
    restartReasonInput: lifecycle.restartReasonInput,
    restartReasonMembers: Object.freeze(members),
    restartEventInput: lifecycle.restartEventInput,
  });
}

/** Return manifest inputs available to physical/software frame callers. */
export function physicalManifestInputs(manifestValue) {
  const manifest = object(manifestValue, 'manifest');
  const lifecycle = validateLifecycleManifest(manifest);
  if (!Array.isArray(manifest.inputs)) throw new TypeError('manifest.inputs must be an array');
  if (!lifecycle) return manifest.inputs;
  return manifest.inputs.filter(input => input.name !== lifecycle.restartReasonInput && input.name !== lifecycle.restartEventInput);
}
