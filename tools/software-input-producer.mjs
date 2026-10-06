// A session-local producer for explicit simulator observations. A scan without
// supplied values produces no samples. This does not diagnose physical contacts.
export class SoftwareInputProducer {
  constructor(manifest) {
    this.names = new Set((manifest.sensors ?? []).map(sensor => sensor.name));
    this.accepted = new Map();
  }

  stage(values, nowMs) {
    const inputs = {}, samples = {}, next = new Map(this.accepted);
    for (const [name, value] of Object.entries(values)) {
      if (!this.names.has(name)) { inputs[name] = value; continue; }
      const id = (next.get(name) ?? 0) + 1;
      samples[name] = { epoch: 1, id, timestampMs: nowMs, quality: 'Good', value };
      next.set(name, id);
    }
    return { inputs, samples, commit: () => { this.accepted = next; } };
  }
}

// Reference console projection of a completed input observation. Unknown quality
// stays unobserved; a healthy false remains false. No contact diagnosis is inferred.
export function readInputObservation(scan, name) {
  const inputs = scan?.inputs;
  if (!inputs) return undefined;
  if (Object.hasOwn(inputs, name)) return inputs[name];
  return inputs[`__gf_sensor_ok_${name}`] === true
    ? inputs[`__gf_sensor_value_${name}`] : undefined;
}
