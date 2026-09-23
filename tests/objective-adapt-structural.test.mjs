import test from 'node:test';
import assert from 'node:assert/strict';
import { typeCheckControl } from '../tools/control.mjs';
const objective = `control ObjectiveTest {
sensor inside_temperature: Temperature;
config target_temperature: Temperature = 25°C { min = 10°C; max = 40°C; step = 0.5Δ°C; access = operator; label = "Target"; }
resource roof_vent: ContinuousActuator;
objective greenhouse_temperature { measure = inside_temperature; target = target_temperature; manipulate = roof_vent.position; output = 0% .. 80%; controller = pid { period = 10s; late_after = 30s; direction = reverse; kp = proportional_gain(output: 2%, error: 1Δ°C); ki = integral_gain(output: 0.1%, error: 1Δ°C, time: 1s); kd = derivative_gain(output: 1%, time: 1s, error: 1Δ°C); bias = 0%; anti_windup = conditional_safe; disabled = track_safe; transfer = track_safe; fault = disable; restart = reset(output: 0%); } }
}`;
test('continuous objective produces structural manifest', () => { const r = typeCheckControl(objective); assert.equal(r.manifest.objectives[0].controller, 'pid'); });
test('degraded control requires exhaustive otherwise', () => { assert.throws(() => typeCheckControl('control X { sensor s: Temperature; degraded D for missing { branch B priority 1 when s quality in { measured } use objective O authority automatic_degraded output 0% .. 30%; otherwise disable; resume = require_start; } }'), /unknown degraded objective|requires at least one branch/); });
test('bounded adaptation produces host binding manifest', () => { const r = typeCheckControl('control X { config target: Pressure = 1.0kPa { min = 0.7kPa; max = 1.2kPa; step = 0.05kPa; access = operator; label = "VPD"; } adapt_setting policy for target { allowed = 0.7kPa .. 1.2kPa; max_step = 0.05kPa; max_change = 0.05kPa per 1h; authority = optimizer; } }'); assert.equal(r.manifest.adaptSettings[0].target, 'target'); });
