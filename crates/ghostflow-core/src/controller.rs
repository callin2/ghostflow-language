//! Native temperature/Percent PID policy for the first continuous objective.
//! Measurement and target use Kelvin; gains use percentage points, delta Kelvin
//! and seconds. The compiler owns nominal unit checking. This slice supports a
//! zero-based output range, conditional_safe, track_safe, reset and fault=disable.
//! Returned safe targets are intents, never evidence of actuator application.

use crate::schedule_clock::MAX_EXACT_TIME;
use crate::{Error, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Direct,
    Reverse,
}

#[derive(Clone, Copy, Debug)]
pub struct PidConfig {
    pub period_ms: u64,
    pub late_after_ms: u64,
    pub direction: Direction,
    /// Percentage points per delta Kelvin.
    pub kp: f64,
    /// Percentage points per delta Kelvin per second.
    pub ki: f64,
    /// Percentage points times seconds per delta Kelvin.
    pub kd: f64,
    pub bias_percent: f64,
    pub output_max_percent: f64,
    pub restart_percent: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PidDecision {
    Updated,
    Held,
    Disabled,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PidResult {
    pub requested_percent: f64,
    pub safe_percent: f64,
    pub decision: PidDecision,
}

#[derive(Clone, Copy, Debug)]
struct Previous {
    at_ms: u64,
    error: f64,
    measurement: f64,
}

#[derive(Clone, Debug)]
pub struct Pid {
    config: PidConfig,
    last_poll_ms: Option<u64>,
    next_update_ms: Option<u64>,
    previous: Option<Previous>,
    integral: f64,
    started: bool,
    result: PidResult,
}

#[derive(Clone, Debug)]
pub struct PidStage {
    controller: Pid,
    pub result: PidResult,
}

impl Pid {
    pub fn new(config: PidConfig) -> Result<Self> {
        if config.period_ms == 0
            || config.late_after_ms < config.period_ms
            || config.late_after_ms > MAX_EXACT_TIME
            || [config.kp, config.ki, config.kd]
                .iter()
                .any(|v| !v.is_finite() || *v < 0.0)
            || [
                config.bias_percent,
                config.output_max_percent,
                config.restart_percent,
            ]
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=100.0).contains(v))
            || config.restart_percent > config.output_max_percent
        {
            return Err(Error::new("invalid temperature PID configuration"));
        }
        Ok(Self {
            config,
            last_poll_ms: None,
            next_update_ms: None,
            previous: None,
            integral: 0.0,
            started: false,
            result: PidResult {
                requested_percent: 0.0,
                safe_percent: 0.0,
                decision: PidDecision::Disabled,
            },
        })
    }

    /// Stage one accepted observation. None denotes an inadmissible measurement.
    /// The safety ceiling is supplied by native arbitration/constraints, not by
    /// the actuator driver. It can reduce a held output between PID deadlines.
    pub fn begin(
        &self,
        now_ms: u64,
        measurement_kelvin: Option<f64>,
        target_kelvin: f64,
        safe_max_percent: f64,
    ) -> Result<PidStage> {
        if now_ms > MAX_EXACT_TIME || self.last_poll_ms.is_some_and(|last| now_ms < last) {
            return Err(Error::new("invalid PID monotonic time"));
        }
        if !safe_max_percent.is_finite() || !(0.0..=100.0).contains(&safe_max_percent) {
            return Err(Error::new("invalid PID safety ceiling"));
        }
        let mut controller = self.clone();
        controller.last_poll_ms = Some(now_ms);
        let valid = measurement_kelvin.filter(|v| v.is_finite() && *v >= 0.0);
        if valid.is_none() || !target_kelvin.is_finite() || target_kelvin < 0.0 {
            controller.disable();
        } else if controller.next_update_ms.is_some_and(|next| now_ms < next) {
            controller.result.safe_percent =
                controller.result.requested_percent.min(safe_max_percent);
            controller.result.decision = if controller.previous.is_some() {
                PidDecision::Held
            } else {
                PidDecision::Disabled
            };
        } else if let Some(measurement) = valid {
            controller.update(now_ms, measurement, target_kelvin, safe_max_percent)?;
        }
        Ok(PidStage {
            result: controller.result,
            controller,
        })
    }

    pub fn commit(&mut self, stage: PidStage) {
        *self = stage.controller;
    }

    fn disable(&mut self) {
        self.previous = None;
        self.result = PidResult {
            requested_percent: 0.0,
            safe_percent: 0.0,
            decision: PidDecision::Disabled,
        };
    }

    fn update(&mut self, now_ms: u64, measurement: f64, target: f64, safe_max: f64) -> Result<()> {
        let config = self.config;
        let next = self.next_update_ms.unwrap_or(now_ms);
        let periods = (now_ms - next) / config.period_ms + 1;
        self.next_update_ms = periods
            .checked_mul(config.period_ms)
            .and_then(|d| next.checked_add(d))
            .filter(|next| *next <= MAX_EXACT_TIME);
        if self.next_update_ms.is_none() {
            return Err(Error::new("PID deadline is out of range"));
        }
        if self
            .previous
            .is_some_and(|previous| now_ms - previous.at_ms > config.late_after_ms)
        {
            self.disable();
            return Ok(());
        }
        let sign = if config.direction == Direction::Direct {
            1.0
        } else {
            -1.0
        };
        let error = sign * (target - measurement);
        let proportional = config.kp * error;
        let (candidate_integral, derivative) = if let Some(previous) = self.previous {
            let dt = (now_ms - previous.at_ms) as f64 / 1_000.0;
            let integral = if config.ki == 0.0 {
                self.integral
            } else {
                self.integral + config.ki * (previous.error * 0.5 + error * 0.5) * dt
            };
            let derivative = if config.kd == 0.0 {
                0.0
            } else {
                -sign * config.kd * ((measurement - previous.measurement) / dt)
            };
            (integral, derivative)
        } else {
            let track = if self.started {
                self.result.safe_percent
            } else {
                config.restart_percent
            };
            self.integral = track - config.bias_percent - proportional;
            (self.integral, 0.0)
        };
        let candidate = config.bias_percent + proportional + candidate_integral + derivative;
        if ![
            error,
            proportional,
            candidate_integral,
            derivative,
            candidate,
        ]
        .iter()
        .all(|v| v.is_finite())
        {
            self.disable();
            return Ok(());
        }
        let safe = candidate
            .clamp(0.0, config.output_max_percent)
            .min(safe_max);
        // Compare unclamped demand with safe, including objective saturation.
        let integral = if (candidate - safe) * error > 0.0 {
            self.integral
        } else {
            candidate_integral
        };
        let demand = config.bias_percent + proportional + integral + derivative;
        if !demand.is_finite() {
            self.disable();
            return Ok(());
        }
        let requested = demand.clamp(0.0, config.output_max_percent);
        self.integral = integral;
        self.started = true;
        self.previous = Some(Previous {
            at_ms: now_ms,
            error,
            measurement,
        });
        self.result = PidResult {
            requested_percent: requested,
            safe_percent: requested.min(safe_max),
            decision: PidDecision::Updated,
        };
        Ok(())
    }
}
