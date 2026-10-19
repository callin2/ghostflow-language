// Test producer for fixtures with explicit software observations. Each supplied
// value is an observation, including repeated false/zero; a clock-only scan
// supplies nothing. This never infers a physical fault from a Boolean value.
export function softwareQualityObservations(runtime) {
  const step = runtime.step.bind(runtime);
  const producers = new Set(runtime.manifest.sensors.map(sensor => sensor.name));
  let accepted = new Map();
  runtime.step = frame => {
    const next = new Map(accepted);
    const inputs = {}, samples = { ...frame.samples };
    for (const [name, value] of Object.entries(frame.inputs ?? {})) {
      if (!producers.has(name)) { inputs[name] = value; continue; }
      const previous = accepted.get(name);
      const observation = {
        epoch: 1, id: (previous?.id ?? 0) + 1, timestampMs: frame.nowMs,
        quality: 'Good', value,
      };
      if (Object.hasOwn(samples, name)) throw new Error(`duplicate fixture observation ${name}`);
      samples[name] = observation;
      next.set(name, observation);
    }
    const result = step({ ...frame, inputs, samples });
    accepted = next;
    return result;
  };
  return runtime;
}

// Native/ABI fixtures supply the same explicit software observation through
// compiler-generated typed-quality rails, never through a legacy raw input.
export function softwareQualityRails(artifact, values, id, timestampMs) {
  const rails = {};
  for (const [name, value] of Object.entries(values)) {
    const sensor = artifact.manifest.sensors.find(item => item.name === name);
    if (!sensor) { rails[name] = value; continue; }
    rails[sensor.valueInput] = value;
    rails[sensor.okInput] = true;
    rails[sensor.faultInput] = 0;
    if (sensor.samplePresentInput) {
      rails[sensor.samplePresentInput] = true;
      rails[sensor.sampleEpochInput] = 1;
      rails[sensor.sampleIdInput] = id;
      rails[sensor.sampleTimestampInput] = timestampMs;
    }
  }
  return rails;
}

// Codec fixtures explicitly supply healthy software observations through the
// real typed-quality ABI. Unknown/generated names still use the native setter.
export function softwareQualityAbi(runtime, artifact) {
  const setters = Object.fromEntries(['setBool', 'setNumber', 'setInt'].filter(name => typeof runtime[name] === 'function')
    .map(name => [name, runtime[name].bind(runtime)]));
  for (const [method, setter] of Object.entries(setters)) {
    runtime[method] = (name, value) => {
      const sensor = artifact.manifest.sensors.find(item => item.name === name);
      if (!sensor) return setter(name, value);
      setter(sensor.valueInput, value);
      setters.setBool(sensor.okInput, true);
      setters.setNumber(sensor.faultInput, 0);
    };
  }
  if (typeof runtime.scan === 'function') {
    const scan = runtime.scan.bind(runtime);
    runtime.scan = frame => scan({ ...frame, inputs: Object.entries(softwareQualityRails(artifact,
      Object.fromEntries(frame.inputs.map(input => [input.name, input.value])), frame.scanId + 1, frame.logicalTimeMs))
      .map(([name, value]) => ({ name, value })) });
  }
  return runtime;
}

export function softwareQualityCsv(artifact, observations) {
  const rows = observations.map((values, index) => softwareQualityRails(artifact, values, index + 1,
    values.__gf_now_ms ?? index));
  const names = Object.keys(rows[0]);
  return `${names.join(',')}\n${rows.map(row => names.map(name => row[name]).join(',')).join('\n')}\n`;
}
