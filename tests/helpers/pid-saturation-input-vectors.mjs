// Explicit canonical input revision; historical pid-saturation-vectors.mjs is retained.
// Observation channels do not drive the controller or define a physical Driver ABI.
export const pidSaturationSource = `control SaturatedTemperature {
  input inside_temperature: Temperature;
  config target_temperature: Temperature = 25°C { min = 10°C; max = 40°C; step = 0.5Δ°C; access = operator; label = "Target"; }
  input driver_applied: Percent;
  input position_feedback: Percent;
  input feedback_good: Bool;
  input driver_revision, feedback_epoch, feedback_id, feedback_at_ms: Int;
  resource roof_vent: ContinuousActuator<Percent>;
  objective greenhouse_temperature {
    measure = inside_temperature; target = target_temperature;
    manipulate = roof_vent.position; output = 0% .. 100%;
    controller = pid {
      period = 10s; late_after = 30s; direction = reverse;
      kp = proportional_gain(output: 2%, error: 1Δ°C);
      ki = integral_gain(output: 0.1%, error: 1Δ°C, time: 1s);
      kd = derivative_gain(output: 0%, time: 1s, error: 1Δ°C);
      bias = 0%; anti_windup = conditional_safe;
      disabled = track_safe; transfer = track_safe; fault = disable;
      restart = reset(output: 92%);
    }
  }
}`;

export const pidActivation = { bootEpoch: 7, terminalCapacity: 8, bindings: [] };
export const pidClock = nowMs => ({ monotonicMs: nowMs, bootEpoch: 7,
  wallMs: null, uncertaintyMs: null, trusted: false,
  unknownReason: 'monotonic PID fixture', sourceRevision: null });

export function pidSaturationSteps({ applied = 20, feedback = 17, good = true } = {}) {
  // Four constrained deadlines span 40 seconds. At each, an unguarded integral
  // would add 0.1 * 5 * 10 = 5 points; the release oracle exposes that growth.
  return [0, 10_000, 20_000, 30_000, 40_000, 50_000].map((nowMs, id) => ({
    nowMs,
    samples: {
      ...Object.fromEntries(Object.entries({ driver_applied: applied, position_feedback: feedback,
        feedback_good: good, driver_revision: 3, feedback_epoch: 9,
        feedback_id: id + 1, feedback_at_ms: nowMs }).map(([name, value]) => [name,
          { epoch: 1, id: id + 1, timestampMs: nowMs, quality: 'Good', value }])),
      inside_temperature: { epoch: 1, id: id + 1,
      timestampMs: nowMs, value: 303.15, quality: 'Good' } },
    objectiveSafeMax: { greenhouse_temperature: id === 5 ? 100 : 20 },
    contextFacts: { clock: pidClock(nowMs), natural: [], schedules: [], settings: null },
  }));
}

export function pidStages(trace, policy) {
  // Values come from accepted execution, including the distinct public fixture
  // channels. Policy comes from the compiled, verified objective descriptor.
  return { antiWindup: policy,
    requested: trace.requested['roof_vent.position'],
    safe: trace.safe['roof_vent.position'],
    appliedObservation: { percent: trace.inputs.__gf_sensor_value_driver_applied,
      driverRevision: trace.inputs.__gf_sensor_value_driver_revision },
    feedbackObservation: { percent: trace.inputs.__gf_sensor_value_position_feedback,
      good: trace.inputs.__gf_sensor_value_feedback_good, epoch: trace.inputs.__gf_sensor_value_feedback_epoch,
      id: trace.inputs.__gf_sensor_value_feedback_id, atMs: trace.inputs.__gf_sensor_value_feedback_at_ms } };
}
