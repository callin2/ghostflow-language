// Explicit canonical input fixture revision; retained scan oracle unchanged.
export const sensorFaultTimerSource = `control ContinuousSensorFault {
  input high: Number { filter = median(1); recover_after = 1 samples; stale_after = 10s; }
  let safe_high = case high { ok(value) => value > 30.0; fault(_) => false; };
  timer hot_for = continuous_true(safe_high);
  output ready: Bool;
  ready <- hot_for >= 900ms;
}`;

// T01-FAULT: a fault is an accepted false tick, not a rejected scan or a pause.
export const sensorFaultTimerScans = [
  { nowMs: 0, quality: 'Good', elapsed: 0, ready: false },
  { nowMs: 900, quality: 'Good', elapsed: 900, ready: true },
  { nowMs: 901, quality: 'Disconnected', elapsed: 0, ready: false },
  { nowMs: 1200, quality: 'Good', elapsed: 0, ready: false },
  { nowMs: 1200, quality: 'Good', elapsed: 0, ready: false },
  { nowMs: 1300, quality: 'Good', elapsed: 100, ready: false },
  { nowMs: 2100, quality: 'Good', elapsed: 900, ready: true },
];
