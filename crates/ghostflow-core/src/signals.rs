//! Bounded, deterministic sensor conditioning for the GhostFlow runtimes.
//!
//! The implementation deliberately uses fixed arrays.  A reading never touches
//! the filesystem and never allocates; only a new physical sample changes the
//! filter state.

use core::fmt;

pub const MAX_WINDOW: usize = 31;
pub const MAX_DIAGNOSTICS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Quality {
    NotReady = 0,
    Good = 1,
    Disconnected = 2,
    Stale = 3,
    Invalid = 4,
}

impl Quality {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::NotReady),
            1 => Some(Self::Good),
            2 => Some(Self::Disconnected),
            3 => Some(Self::Stale),
            4 => Some(Self::Invalid),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SensorFault {
    NotReady,
    Disconnected,
    Stale,
    Invalid,
    SourceChanged,
    ClockBackward,
    FutureTimestamp,
}

impl SensorFault {
    pub fn quality(self) -> Quality {
        match self {
            Self::NotReady => Quality::NotReady,
            Self::Disconnected => Quality::Disconnected,
            Self::Stale => Quality::Stale,
            Self::Invalid | Self::SourceChanged | Self::ClockBackward | Self::FutureTimestamp => {
                Quality::Invalid
            }
        }
    }

    pub fn is_quality_fault(self) -> bool {
        matches!(
            self,
            Self::NotReady | Self::Disconnected | Self::Stale | Self::Invalid
        )
    }
}

impl fmt::Display for SensorFault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::NotReady => "sensor not ready",
            Self::Disconnected => "sensor disconnected",
            Self::Stale => "sensor sample is stale",
            Self::Invalid => "sensor sample is invalid",
            Self::SourceChanged => "sensor source epoch changed",
            Self::ClockBackward => "sensor clock moved backward",
            Self::FutureTimestamp => "sensor sample timestamp is in the future",
        };
        f.write_str(text)
    }
}

impl std::error::Error for SensorFault {}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Filter {
    Median(usize),
    MovingAverage(usize),
    Ema(f64),
}

pub type FilterKind = Filter;

impl Filter {
    pub const fn median(window: usize) -> Self {
        Self::Median(window)
    }
    pub const fn moving_average(window: usize) -> Self {
        Self::MovingAverage(window)
    }
    pub const fn ema(alpha: f64) -> Self {
        Self::Ema(alpha)
    }

    pub fn window(self) -> usize {
        match self {
            Self::Median(n) | Self::MovingAverage(n) => n,
            Self::Ema(_) => 1,
        }
    }

    pub fn validate(self) -> Result<(), SensorFault> {
        match self {
            Self::Median(n) | Self::MovingAverage(n) if !(1..=MAX_WINDOW).contains(&n) => {
                Err(SensorFault::Invalid)
            }
            Self::Ema(alpha) if !alpha.is_finite() || !(0.0 < alpha && alpha <= 1.0) => {
                Err(SensorFault::Invalid)
            }
            _ => Ok(()),
        }
    }

    /// Fixed upper-bound cost used by a host/compiler resource report.
    pub const fn cost(self) -> FilterCost {
        match self {
            Self::Median(_) => MEDIAN_COST,
            Self::MovingAverage(_) => MOVING_AVERAGE_COST,
            Self::Ema(_) => EMA_COST,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FilterCost {
    pub state_values: usize,
    pub scratch_values: usize,
    pub comparisons: usize,
    pub arithmetic_operations: usize,
}

pub const MEDIAN_COST: FilterCost = FilterCost {
    state_values: MAX_WINDOW,
    scratch_values: MAX_WINDOW,
    comparisons: 465,
    arithmetic_operations: 0,
};
pub const MOVING_AVERAGE_COST: FilterCost = FilterCost {
    state_values: MAX_WINDOW + 1,
    scratch_values: 0,
    comparisons: 0,
    arithmetic_operations: 3,
};
pub const EMA_COST: FilterCost = FilterCost {
    state_values: 1,
    scratch_values: 0,
    comparisons: 0,
    arithmetic_operations: 3,
};
pub const HYSTERESIS_COST: FilterCost = FilterCost {
    state_values: 1,
    scratch_values: 0,
    comparisons: 2,
    arithmetic_operations: 0,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HysteresisConfig {
    pub on_below: f64,
    pub off_above: f64,
    pub initial: bool,
}

impl HysteresisConfig {
    fn validate(self) -> Result<(), SensorFault> {
        if !self.on_below.is_finite()
            || !self.off_above.is_finite()
            || self.on_below >= self.off_above
        {
            return Err(SensorFault::Invalid);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SensorConfig {
    pub filter: Filter,
    pub valid_min: f64,
    pub valid_max: f64,
    pub stale_after_ms: u64,
    pub recover_samples: usize,
    pub hysteresis: Option<HysteresisConfig>,
}

impl SensorConfig {
    pub fn new(
        filter: Filter,
        valid_min: f64,
        valid_max: f64,
        stale_after_ms: u64,
        recover_samples: usize,
    ) -> Self {
        Self {
            filter,
            valid_min,
            valid_max,
            stale_after_ms,
            recover_samples,
            hysteresis: None,
        }
    }

    pub fn with_hysteresis(mut self, on_below: f64, off_above: f64, initial: bool) -> Self {
        self.hysteresis = Some(HysteresisConfig {
            on_below,
            off_above,
            initial,
        });
        self
    }

    fn validate(self) -> Result<(), SensorFault> {
        self.filter.validate()?;
        if !self.valid_min.is_finite()
            || !self.valid_max.is_finite()
            || self.valid_min > self.valid_max
            || self.recover_samples == 0
            || self.recover_samples > MAX_WINDOW
        {
            return Err(SensorFault::Invalid);
        }
        if let Some(hysteresis) = self.hysteresis {
            hysteresis.validate()?;
        }
        Ok(())
    }
}

impl Default for SensorConfig {
    fn default() -> Self {
        Self::new(Filter::Median(1), 0.0, 100.0, 3_000, 1)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sample {
    pub epoch: u64,
    pub id: u64,
    pub timestamp_ms: u64,
    pub value: f64,
    pub quality: Quality,
}

pub type SensorSample = Sample;

impl Sample {
    pub const fn new(epoch: u64, id: u64, timestamp_ms: u64, value: f64, quality: Quality) -> Self {
        Self {
            epoch,
            id,
            timestamp_ms,
            value,
            quality,
        }
    }

    pub const fn good(epoch: u64, id: u64, timestamp_ms: u64, value: f64) -> Self {
        Self::new(epoch, id, timestamp_ms, value, Quality::Good)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateResult {
    Accepted,
    Duplicate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Diagnostic {
    SourceEpochChanged { previous: u64, current: u64 },
    DuplicateSample { epoch: u64, id: u64 },
    ClockBackward,
    FutureTimestamp,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reading {
    pub value: f64,
    pub quality: Quality,
}

impl Reading {
    pub fn ok(self) -> bool {
        self.quality == Quality::Good
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HysteresisReading {
    pub value: bool,
    pub quality: Quality,
}

#[derive(Clone)]
struct FilterState {
    values: [f64; MAX_WINDOW],
    len: usize,
    next: usize,
    sum: f64,
    ema: f64,
    ema_ready: bool,
    filtered: f64,
}

impl FilterState {
    const fn new() -> Self {
        Self {
            values: [0.0; MAX_WINDOW],
            len: 0,
            next: 0,
            sum: 0.0,
            ema: 0.0,
            ema_ready: false,
            filtered: 0.0,
        }
    }

    fn reset(&mut self) {
        *self = Self::new();
    }

    fn push(&mut self, filter: Filter, value: f64) -> Result<bool, SensorFault> {
        match filter {
            Filter::Median(window) => {
                if self.len < window {
                    self.values[self.len] = value;
                    self.len += 1;
                } else {
                    self.values[self.next] = value;
                    self.next = (self.next + 1) % window;
                }
                if self.len < window {
                    return Ok(false);
                }
                let mut sorted = [0.0; MAX_WINDOW];
                sorted[..window].copy_from_slice(&self.values[..window]);
                for i in 1..window {
                    let item = sorted[i];
                    let mut j = i;
                    while j > 0 && sorted[j - 1] > item {
                        sorted[j] = sorted[j - 1];
                        j -= 1;
                    }
                    sorted[j] = item;
                }
                self.filtered = sorted[window / 2];
            }
            Filter::MovingAverage(window) => {
                if self.len < window {
                    self.values[self.len] = value;
                    self.len += 1;
                    self.sum += value;
                } else {
                    self.sum -= self.values[self.next];
                    self.values[self.next] = value;
                    self.sum += value;
                    self.next = (self.next + 1) % window;
                }
                if !self.sum.is_finite() {
                    return Err(SensorFault::Invalid);
                }
                if self.len < window {
                    return Ok(false);
                }
                self.filtered = self.sum / window as f64;
            }
            Filter::Ema(alpha) => {
                self.ema = if self.ema_ready {
                    alpha * value + (1.0 - alpha) * self.ema
                } else {
                    value
                };
                if !self.ema.is_finite() {
                    return Err(SensorFault::Invalid);
                }
                self.ema_ready = true;
                self.filtered = self.ema;
                self.len = 1;
            }
        }
        Ok(true)
    }

    fn ready(&self, filter: Filter) -> bool {
        match filter {
            Filter::Ema(_) => self.ema_ready,
            Filter::Median(n) | Filter::MovingAverage(n) => self.len >= n,
        }
    }
}

/// Fixed-size conditioner state. Cloning retains the complete filter history,
/// sample identity, recovery state and diagnostics for an in-memory transaction.
#[derive(Clone)]
pub struct Sensor {
    config: SensorConfig,
    state: FilterState,
    current_epoch: Option<u64>,
    last_sample_id: Option<u64>,
    last_sample_timestamp: Option<u64>,
    last_physical_sample_time: Option<u64>,
    last_now_ms: Option<u64>,
    fault: Option<SensorFault>,
    recover_count: usize,
    hysteresis_value: bool,
    diagnostics: [Option<Diagnostic>; MAX_DIAGNOSTICS],
    diagnostic_count: usize,
}

impl Sensor {
    pub fn new(config: SensorConfig) -> Result<Self, SensorFault> {
        config.validate()?;
        Ok(Self {
            hysteresis_value: config.hysteresis.map(|h| h.initial).unwrap_or(false),
            config,
            state: FilterState::new(),
            current_epoch: None,
            last_sample_id: None,
            last_sample_timestamp: None,
            last_physical_sample_time: None,
            last_now_ms: None,
            fault: Some(SensorFault::NotReady),
            recover_count: 0,
            diagnostics: [None; MAX_DIAGNOSTICS],
            diagnostic_count: 0,
        })
    }

    pub fn config(&self) -> SensorConfig {
        self.config
    }

    /// Epoch, ID and timestamp of the last accepted physical observation,
    /// including observations whose quality is faulty or not ready.
    /// Duplicate/older IDs and reads leave this identity unchanged.
    pub fn accepted_sample_identity(&self) -> Option<(u64, u64, u64)> {
        Some((
            self.current_epoch?,
            self.last_sample_id?,
            self.last_sample_timestamp?,
        ))
    }

    pub fn update(&mut self, sample: Sample, now_ms: u64) -> Result<UpdateResult, SensorFault> {
        let epoch_changed = self.current_epoch != Some(sample.epoch);
        if !epoch_changed {
            if let Some(previous_now) = self.last_now_ms {
                if now_ms < previous_now {
                    self.record(Diagnostic::ClockBackward);
                    return Err(SensorFault::ClockBackward);
                }
            }
        }
        self.last_now_ms = Some(now_ms);
        if sample.timestamp_ms > now_ms {
            self.record(Diagnostic::FutureTimestamp);
            return Err(SensorFault::FutureTimestamp);
        }

        if epoch_changed {
            if let Some(previous) = self.current_epoch {
                self.record(Diagnostic::SourceEpochChanged {
                    previous,
                    current: sample.epoch,
                });
            }
            self.reset_processing();
            self.current_epoch = Some(sample.epoch);
            self.last_sample_id = None;
            self.last_sample_timestamp = None;
        } else if let Some(last_id) = self.last_sample_id {
            if sample.id <= last_id {
                self.record(Diagnostic::DuplicateSample {
                    epoch: sample.epoch,
                    id: sample.id,
                });
                return Ok(UpdateResult::Duplicate);
            }
        }
        if let Some(last_timestamp) = self.last_sample_timestamp {
            if sample.timestamp_ms < last_timestamp {
                self.record(Diagnostic::ClockBackward);
                return Err(SensorFault::ClockBackward);
            }
        }
        self.last_sample_id = Some(sample.id);
        self.last_sample_timestamp = Some(sample.timestamp_ms);

        if self.is_stale(now_ms) {
            self.reset_processing();
            self.fault = Some(SensorFault::Stale);
        }
        if sample.quality != Quality::Good
            || !sample.value.is_finite()
            || sample.value < self.config.valid_min
            || sample.value > self.config.valid_max
        {
            let fault = match sample.quality {
                Quality::Disconnected => SensorFault::Disconnected,
                Quality::Stale => SensorFault::Stale,
                Quality::NotReady => SensorFault::NotReady,
                Quality::Invalid | Quality::Good => SensorFault::Invalid,
            };
            self.reset_processing();
            self.fault = Some(fault);
            self.hysteresis_value = self.initial_hysteresis();
            return Err(fault);
        }

        self.last_physical_sample_time = Some(sample.timestamp_ms);
        let was_fault = self.fault.is_some();
        if self.state.push(self.config.filter, sample.value).is_err() {
            self.reset_processing();
            self.fault = Some(SensorFault::Invalid);
            return Err(SensorFault::Invalid);
        }
        if was_fault {
            self.recover_count = self.recover_count.saturating_add(1);
        }
        let filter_ready = self.state.ready(self.config.filter);
        if was_fault && !(filter_ready && self.recover_count >= self.config.recover_samples) {
            self.fault = Some(SensorFault::NotReady);
            return Err(SensorFault::NotReady);
        }
        if filter_ready {
            self.fault = None;
            self.recover_count = 0;
            self.apply_hysteresis(self.state.filtered);
            Ok(UpdateResult::Accepted)
        } else {
            Err(SensorFault::NotReady)
        }
    }

    /// Compatibility API matching the language contract: only a good value is Ok.
    pub fn reading(&self, now_ms: u64) -> Result<f64, SensorFault> {
        let reading = self.read(now_ms);
        if reading.quality == Quality::Good {
            Ok(reading.value)
        } else {
            Err(self.fault_for(reading.quality))
        }
    }

    pub fn read(&self, now_ms: u64) -> Reading {
        if self.last_now_ms.is_some_and(|last| now_ms < last) {
            return Reading {
                value: self.state.filtered,
                quality: Quality::Invalid,
            };
        }
        if let Some(fault) = self.fault {
            // Preparation does not make an old accepted observation fresh.
            // Explicit producer faults still propagate immediately.
            if fault != SensorFault::NotReady || !self.is_stale(now_ms) {
                return Reading {
                    value: self.state.filtered,
                    quality: fault.quality(),
                };
            }
        }
        if self.is_stale(now_ms) {
            return Reading {
                value: self.state.filtered,
                quality: Quality::Stale,
            };
        }
        if !self.state.ready(self.config.filter) {
            return Reading {
                value: self.state.filtered,
                quality: Quality::NotReady,
            };
        }
        Reading {
            value: self.state.filtered,
            quality: Quality::Good,
        }
    }

    pub fn quality(&self, now_ms: u64) -> Quality {
        self.read(now_ms).quality
    }
    pub fn value(&self, now_ms: u64) -> Option<f64> {
        let reading = self.read(now_ms);
        reading.ok().then_some(reading.value)
    }

    pub fn read_hysteresis(&self, now_ms: u64) -> HysteresisReading {
        let reading = self.read(now_ms);
        HysteresisReading {
            value: if reading.quality == Quality::Good {
                self.hysteresis_value
            } else {
                self.initial_hysteresis()
            },
            quality: reading.quality,
        }
    }

    pub fn hysteresis(&self, now_ms: u64) -> HysteresisReading {
        self.read_hysteresis(now_ms)
    }

    pub fn reset(&mut self) {
        self.reset_processing();
        self.current_epoch = None;
        self.last_sample_id = None;
        self.last_sample_timestamp = None;
        self.last_physical_sample_time = None;
        self.last_now_ms = None;
    }

    pub fn diagnostics(&self) -> impl Iterator<Item = Diagnostic> + '_ {
        let retained = self.diagnostic_count.min(MAX_DIAGNOSTICS);
        let first = if self.diagnostic_count > MAX_DIAGNOSTICS {
            self.diagnostic_count % MAX_DIAGNOSTICS
        } else {
            0
        };
        (0..retained).filter_map(move |index| self.diagnostics[(first + index) % MAX_DIAGNOSTICS])
    }
    pub fn diagnostic_count(&self) -> usize {
        self.diagnostic_count
    }
    pub fn diagnostic(&self, index: usize) -> Option<Diagnostic> {
        let retained = self.diagnostic_count.min(MAX_DIAGNOSTICS);
        if index >= retained {
            return None;
        }
        let first = if self.diagnostic_count > MAX_DIAGNOSTICS {
            self.diagnostic_count % MAX_DIAGNOSTICS
        } else {
            0
        };
        self.diagnostics[(first + index) % MAX_DIAGNOSTICS]
    }
    pub fn last_physical_sample_time(&self) -> Option<u64> {
        self.last_physical_sample_time
    }
    pub fn filter_cost(&self) -> FilterCost {
        self.config.filter.cost()
    }

    fn initial_hysteresis(&self) -> bool {
        self.config.hysteresis.map(|h| h.initial).unwrap_or(false)
    }
    fn fault_for(&self, quality: Quality) -> SensorFault {
        match quality {
            Quality::NotReady => SensorFault::NotReady,
            Quality::Disconnected => SensorFault::Disconnected,
            Quality::Stale => SensorFault::Stale,
            Quality::Invalid => SensorFault::Invalid,
            Quality::Good => SensorFault::Invalid,
        }
    }
    fn is_stale(&self, now_ms: u64) -> bool {
        self.last_physical_sample_time
            .is_some_and(|last| now_ms.saturating_sub(last) >= self.config.stale_after_ms)
    }
    fn apply_hysteresis(&mut self, value: f64) {
        if let Some(h) = self.config.hysteresis {
            if value < h.on_below {
                self.hysteresis_value = true;
            } else if value > h.off_above {
                self.hysteresis_value = false;
            }
        }
    }
    fn reset_processing(&mut self) {
        self.state.reset();
        self.last_physical_sample_time = None;
        self.fault = Some(SensorFault::NotReady);
        self.recover_count = 0;
        self.hysteresis_value = self.initial_hysteresis();
    }
    fn record(&mut self, diagnostic: Diagnostic) {
        let index = self.diagnostic_count % MAX_DIAGNOSTICS;
        self.diagnostics[index] = Some(diagnostic);
        self.diagnostic_count = self.diagnostic_count.saturating_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sensor(filter: Filter, recover: usize) -> Sensor {
        Sensor::new(
            SensorConfig::new(filter, 0.0, 100.0, 3_000, recover)
                .with_hysteresis(30.0, 35.0, false),
        )
        .unwrap()
    }
    fn good(id: u64, time: u64, value: f64) -> Sample {
        Sample::good(1, id, time, value)
    }

    #[test]
    fn recovery_threshold_applies_on_startup_reset_and_source_epoch() {
        for threshold in 1..=MAX_WINDOW {
            let mut s = sensor(Filter::Median(1), threshold);
            for epoch in 1..=3 {
                if epoch == 2 {
                    s.reset();
                }
                for id in 1..=threshold as u64 {
                    let expected = if id == threshold as u64 {
                        Ok(UpdateResult::Accepted)
                    } else {
                        Err(SensorFault::NotReady)
                    };
                    assert_eq!(
                        s.update(Sample::good(epoch, id, id, 0.0), id),
                        expected,
                        "threshold {threshold}, epoch {epoch}, observation {id}"
                    );
                    let quality = if id == threshold as u64 {
                        Quality::Good
                    } else {
                        Quality::NotReady
                    };
                    for _ in 0..3 {
                        assert_eq!(s.read(id).quality, quality);
                    }
                    assert_eq!(
                        s.update(Sample::good(epoch, id, id, 99.0), id),
                        Ok(UpdateResult::Duplicate)
                    );
                    assert_eq!(s.read(id).quality, quality);
                }
                assert_eq!(s.reading(threshold as u64), Ok(0.0));
            }
        }
    }

    #[test]
    fn interrupted_recovery_needs_a_new_full_sequence_and_expired_preparation_is_stale() {
        let mut s = sensor(Filter::Median(1), 3);
        assert_eq!(s.update(good(1, 1, 0.0), 1), Err(SensorFault::NotReady));
        assert_eq!(s.update(good(2, 2, 0.0), 2), Err(SensorFault::NotReady));
        assert_eq!(
            s.update(Sample::new(1, 3, 3, 0.0, Quality::Invalid), 3),
            Err(SensorFault::Invalid)
        );
        for id in 4..=6 {
            let expected = if id == 6 {
                Ok(UpdateResult::Accepted)
            } else {
                Err(SensorFault::NotReady)
            };
            assert_eq!(s.update(good(id, id, 0.0), id), expected);
        }
        assert_eq!(
            s.update(Sample::good(2, 1, 7, 0.0), 7),
            Err(SensorFault::NotReady)
        );
        assert_eq!(s.read(3007).quality, Quality::Stale);
        // Reads and duplicate identities cannot turn partial preparation into Good.
        assert_eq!(
            s.update(Sample::good(2, 1, 7, 99.0), 3007),
            Ok(UpdateResult::Duplicate)
        );
        assert_eq!(s.read(3007).quality, Quality::Stale);
        for id in 2..=4 {
            let now = 3006 + id;
            let expected = if id == 4 {
                Ok(UpdateResult::Accepted)
            } else {
                Err(SensorFault::NotReady)
            };
            assert_eq!(s.update(Sample::good(2, id, now, 0.0), now), expected);
        }
        assert_eq!(s.reading(3010), Ok(0.0));
    }

    #[test]
    fn median_needs_full_window_and_rejects_noise() {
        let mut s = sensor(Filter::Median(5), 3);
        for (id, value) in [28.0, 29.0, 90.0, 28.0].into_iter().enumerate() {
            assert_eq!(
                s.update(good(id as u64, id as u64, value), id as u64),
                Err(SensorFault::NotReady)
            );
        }
        assert_eq!(s.update(good(4, 4, 29.0), 4), Ok(UpdateResult::Accepted));
        assert_eq!(
            s.read(4),
            Reading {
                value: 29.0,
                quality: Quality::Good
            }
        );
    }

    #[test]
    fn accepted_identity_stays_bound_to_the_conditioned_reading() {
        let mut s = sensor(Filter::Ema(1.0), 1);
        assert_eq!(s.accepted_sample_identity(), None);
        s.update(Sample::good(0, 0, 0, 10.0), 0).unwrap();
        assert_eq!(s.accepted_sample_identity(), Some((0, 0, 0)));
        s.update(Sample::good(0, 10, 100, 20.0), 100).unwrap();
        for id in [10, 5] {
            assert_eq!(
                s.update(Sample::good(0, id, 150, 99.0), 150),
                Ok(UpdateResult::Duplicate)
            );
            assert_eq!(s.accepted_sample_identity(), Some((0, 10, 100)));
            assert_eq!(s.reading(150), Ok(20.0));
        }
        assert_eq!(
            s.update(Sample::new(0, 11, 151, 0.0, Quality::Disconnected), 151),
            Err(SensorFault::Disconnected)
        );
        assert_eq!(s.accepted_sample_identity(), Some((0, 11, 151)));
        assert_eq!(s.read(151).quality, Quality::Disconnected);
        assert_eq!(s.accepted_sample_identity(), Some((0, 11, 151)));
        s.update(Sample::good(1, 0, 152, 30.0), 152).unwrap();
        assert_eq!(s.accepted_sample_identity(), Some((1, 0, 152)));
        s.reset();
        assert_eq!(s.accepted_sample_identity(), None);
        let max = 9_007_199_254_740_991;
        s.update(Sample::good(max, max, max, 40.0), max).unwrap();
        assert_eq!(s.accepted_sample_identity(), Some((max, max, max)));
    }

    #[test]
    fn moving_average_is_bounded_and_exact() {
        let mut s = sensor(Filter::MovingAverage(3), 1);
        assert!(s.update(good(1, 1, 10.0), 1).is_err());
        assert!(s.update(good(2, 2, 20.0), 2).is_err());
        assert_eq!(s.update(good(3, 3, 30.0), 3), Ok(UpdateResult::Accepted));
        assert_eq!(s.reading(3), Ok(20.0));
        assert!(Sensor::new(SensorConfig::new(
            Filter::MovingAverage(32),
            0.0,
            100.0,
            1,
            1
        ))
        .is_err());
    }

    #[test]
    fn ema_seeds_from_first_sample() {
        let mut s = sensor(Filter::Ema(0.5), 1);
        assert_eq!(s.update(good(1, 1, 20.0), 1), Ok(UpdateResult::Accepted));
        assert_eq!(s.reading(1), Ok(20.0));
        assert_eq!(s.update(good(2, 2, 40.0), 2), Ok(UpdateResult::Accepted));
        assert_eq!(s.reading(2), Ok(30.0));
    }

    #[test]
    fn invalid_and_disconnected_are_immediate_and_reset() {
        let mut s = sensor(Filter::Median(1), 1);
        assert!(s.update(good(1, 1, 10.0), 1).is_ok());
        assert_eq!(
            s.update(Sample::new(1, 2, 2, 10.0, Quality::Disconnected), 2),
            Err(SensorFault::Disconnected)
        );
        assert_eq!(s.read(2).quality, Quality::Disconnected);
        assert_eq!(s.update(good(3, 3, f64::NAN), 3), Err(SensorFault::Invalid));
        assert_eq!(s.read(3).quality, Quality::Invalid);
    }

    #[test]
    fn stale_uses_physical_sample_time_not_read_time() {
        let mut s = sensor(Filter::Median(1), 1);
        assert!(s.update(good(1, 100, 10.0), 100).is_ok());
        assert_eq!(s.read(3_099).quality, Quality::Good);
        assert_eq!(s.read(3_100).quality, Quality::Stale);
    }

    #[test]
    fn ref_04_023_stale_boundary_uses_sample_time_not_filter_evaluation() {
        let mut s = sensor(Filter::Median(1), 1);
        let sample = good(1, 1_000, 42.0);
        assert_eq!(s.update(sample, 1_500), Ok(UpdateResult::Accepted));
        for now in [1_500, 2_500] {
            assert_eq!(s.reading(now), Ok(42.0));
            assert_eq!(s.quality(now), Quality::Good);
            assert_eq!(s.accepted_sample_identity(), Some((1, 1, 1_000)));
        }
        assert_eq!(s.update(sample, 3_999), Ok(UpdateResult::Duplicate));
        assert_eq!(s.reading(3_999), Ok(42.0));
        assert_eq!(s.quality(3_999), Quality::Good);
        assert_eq!(s.reading(4_000), Err(SensorFault::Stale));
        assert_eq!(s.quality(4_000), Quality::Stale);
        assert_eq!(s.update(sample, 4_001), Ok(UpdateResult::Duplicate));
        assert_eq!(s.reading(4_001), Err(SensorFault::Stale));
        assert_eq!(s.accepted_sample_identity(), Some((1, 1, 1_000)));
    }

    #[test]
    fn recovery_requires_both_filter_and_recover_count() {
        let mut s = sensor(Filter::Median(5), 3);
        for id in 1..=4 {
            assert_eq!(s.update(good(id, id, 20.0), id), Err(SensorFault::NotReady));
        }
        assert_eq!(s.update(good(5, 5, 20.0), 5), Ok(UpdateResult::Accepted));
        assert_eq!(
            s.update(Sample::new(1, 6, 6, 20.0, Quality::Invalid), 6),
            Err(SensorFault::Invalid)
        );
        for id in 7..=10 {
            assert_eq!(s.update(good(id, id, 20.0), id), Err(SensorFault::NotReady));
        }
        assert_eq!(s.update(good(11, 11, 20.0), 11), Ok(UpdateResult::Accepted));
    }

    #[test]
    fn duplicate_ids_do_not_update_filter_or_freshness() {
        let mut s = sensor(Filter::Median(2), 1);
        assert!(s.update(good(1, 100, 10.0), 100).is_err());
        assert_eq!(
            s.update(good(1, 101, 90.0), 101),
            Ok(UpdateResult::Duplicate)
        );
        assert_eq!(s.read(3_100).quality, Quality::Stale);
        assert_eq!(s.diagnostic_count(), 1);
    }

    #[test]
    fn hysteresis_preserves_state_only_while_quality_is_good() {
        let mut s = sensor(Filter::Median(1), 1);
        assert!(s.update(good(1, 1, 20.0), 1).is_ok());
        assert_eq!(
            s.read_hysteresis(1),
            HysteresisReading {
                value: true,
                quality: Quality::Good
            }
        );
        assert!(s.update(good(2, 2, 32.0), 2).is_ok());
        assert_eq!(s.read_hysteresis(2).value, true);
        assert_eq!(
            s.update(Sample::new(1, 3, 3, 0.0, Quality::Disconnected), 3),
            Err(SensorFault::Disconnected)
        );
        assert_eq!(
            s.read_hysteresis(3),
            HysteresisReading {
                value: false,
                quality: Quality::Disconnected
            }
        );
    }

    #[test]
    fn ref_04_019_hysteresis_strict_boundaries_and_fault_result() {
        let mut sensor = sensor(Filter::Median(1), 1);
        let cases = [
            (30.0, false),
            (29.0, true),
            (33.0, true),
            (35.0, true),
            (36.0, false),
        ];
        for (index, (value, expected)) in cases.into_iter().enumerate() {
            let id = index as u64 + 1;
            assert_eq!(
                sensor.update(good(id, id, value), id),
                Ok(UpdateResult::Accepted)
            );
            assert_eq!(
                sensor.read_hysteresis(id),
                HysteresisReading {
                    value: expected,
                    quality: Quality::Good
                }
            );
        }
        assert_eq!(
            sensor.update(Sample::new(1, 6, 6, 36.0, Quality::Invalid), 6),
            Err(SensorFault::Invalid)
        );
        assert_eq!(
            sensor.read_hysteresis(6),
            HysteresisReading {
                value: false,
                quality: Quality::Invalid
            }
        );
    }

    #[test]
    fn repeated_reads_at_same_time_are_observationally_pure() {
        let mut s = sensor(Filter::Median(1), 1);
        assert!(s.update(good(1, 100, 20.0), 100).is_ok());
        let first = s.read(100);
        let first_hysteresis = s.read_hysteresis(100);
        for _ in 0..16 {
            assert_eq!(s.read(100), first);
            assert_eq!(s.read_hysteresis(100), first_hysteresis);
        }
        assert_eq!(
            s.update(good(2, 101, 32.0), 101),
            Ok(UpdateResult::Accepted)
        );
        assert_eq!(s.read(101).quality, Quality::Good);
        assert_eq!(s.read_hysteresis(101).value, true);
    }

    #[test]
    fn source_epoch_and_clock_diagnostics_are_explicit() {
        let mut s = sensor(Filter::Median(1), 1);
        assert!(s.update(good(1, 10, 10.0), 10).is_ok());
        assert!(s.update(good(1, 11, 11.0), 11).is_ok());
        assert_eq!(
            s.update(Sample::good(2, 1, 0, 12.0), 0),
            Ok(UpdateResult::Accepted)
        );
        assert!(s
            .diagnostics()
            .any(|d| matches!(d, Diagnostic::SourceEpochChanged { .. })));
        assert!(s.update(Sample::good(2, 2, 9, 13.0), 9).is_ok());
        assert_eq!(
            s.update(Sample::good(2, 3, 8, 13.0), 8),
            Err(SensorFault::ClockBackward)
        );
        assert!(s.diagnostics().any(|d| d == Diagnostic::ClockBackward));
    }

    #[test]
    fn cloned_snapshot_restores_median_window_and_hysteresis_without_reset() {
        let mut s = sensor(Filter::Median(3), 1);
        for (id, value) in [(1, 20.0), (2, 30.0), (3, 40.0)] {
            let _ = s.update(good(id, id, value), id);
        }
        assert_eq!(s.reading(3), Ok(30.0));
        assert!(!s.hysteresis(3).value);
        let checkpoint = s.clone();
        s.update(good(4, 10, 0.0), 10).unwrap();
        s.update(good(5, 20, 0.0), 20).unwrap();
        assert!(s.hysteresis(20).value);
        s = checkpoint;
        assert_eq!(s.reading(3), Ok(30.0));
        assert!(!s.hysteresis(3).value);
        assert_eq!(s.accepted_sample_identity(), Some((1, 3, 3)));
        s.update(good(4, 4, 80.0), 4).unwrap();
        assert_eq!(s.reading(4), Ok(40.0));
    }

    #[test]
    fn cloned_snapshot_restores_ema_fault_recovery_clock_and_diagnostics() {
        let mut s = sensor(Filter::Ema(0.5), 2);
        assert_eq!(s.update(good(1, 1, 20.0), 1), Err(SensorFault::NotReady));
        s.update(good(2, 2, 40.0), 2).unwrap();
        let ready = s.clone();
        s.update(good(3, 3, 80.0), 3).unwrap();
        assert_eq!(s.reading(3), Ok(55.0));
        s = ready;
        s.update(good(3, 3, 60.0), 3).unwrap();
        assert_eq!(s.reading(3), Ok(45.0));
        assert_eq!(
            s.update(Sample::new(1, 4, 4, 0.0, Quality::Disconnected), 4),
            Err(SensorFault::Disconnected)
        );
        assert_eq!(s.update(good(5, 5, 20.0), 5), Err(SensorFault::NotReady));
        assert_eq!(s.update(good(5, 5, 99.0), 5), Ok(UpdateResult::Duplicate));
        let checkpoint = s.clone();
        let diagnostics: Vec<_> = s.diagnostics().collect();
        s.update(good(6, 6, 40.0), 6).unwrap();
        assert_eq!(s.reading(6), Ok(30.0));
        assert_eq!(
            s.update(Sample::good(2, 0, 7, 99.0), 7),
            Err(SensorFault::NotReady)
        );
        assert_eq!(
            s.update(Sample::good(2, 1, 6, 99.0), 6),
            Err(SensorFault::ClockBackward)
        );
        s.reset();
        s = checkpoint;
        assert_eq!(s.config(), sensor(Filter::Ema(0.5), 2).config());
        assert_eq!(s.reading(5), Err(SensorFault::NotReady));
        assert_eq!(s.accepted_sample_identity(), Some((1, 5, 5)));
        assert_eq!(s.diagnostics().collect::<Vec<_>>(), diagnostics);
        assert_eq!(s.diagnostic_count(), 1);
        s.update(good(6, 6, 40.0), 6).unwrap();
        assert_eq!(s.reading(6), Ok(30.0));
    }

    #[test]
    fn sensor_snapshot_is_fixed_inline_memory() {
        assert!(!std::mem::needs_drop::<Sensor>());
        assert!(!std::mem::needs_drop::<FilterState>());
        let s = sensor(Filter::Median(MAX_WINDOW), MAX_WINDOW);
        assert_eq!(std::mem::size_of_val(&s), std::mem::size_of_val(&s.clone()));
        println!(
            "Sensor={} bytes, FilterState={} bytes",
            std::mem::size_of::<Sensor>(),
            std::mem::size_of::<FilterState>()
        );
    }

    #[test]
    fn diagnostic_ring_is_bounded_without_read_panics() {
        let mut s = sensor(Filter::Median(1), 1);
        for epoch in 0..=MAX_DIAGNOSTICS as u64 + 2 {
            assert!(s.update(Sample::good(epoch, 1, epoch, 10.0), epoch).is_ok());
        }
        assert_eq!(s.diagnostic_count(), MAX_DIAGNOSTICS + 2);
        assert_eq!(s.diagnostics().count(), MAX_DIAGNOSTICS);
        assert!(s.diagnostic(MAX_DIAGNOSTICS).is_none());
    }

    #[test]
    fn ref_04_010_invalid_seven_duplicate_eight_and_sample_time_freshness() {
        let mut s = Sensor::new(SensorConfig::new(Filter::Median(3), 0.0, 100.0, 300, 1)).unwrap();
        for (id, timestamp) in [(1, 0), (2, 10)] {
            assert_eq!(
                s.update(good(id, timestamp, 20.0), timestamp),
                Err(SensorFault::NotReady)
            );
        }
        s.update(good(3, 20, 20.0), 20).unwrap();
        assert_eq!(s.reading(20), Ok(20.0));
        for now in [110, 120, 130] {
            let updated = s.update(good(7, 100, 101.0), now);
            if now == 110 {
                assert_eq!(updated, Err(SensorFault::Invalid));
            } else {
                assert_eq!(updated, Ok(UpdateResult::Duplicate));
            }
            assert_eq!(s.reading(now), Err(SensorFault::Invalid));
            assert_eq!(s.accepted_sample_identity(), Some((1, 7, 100)));
        }
        assert_eq!(
            s.update(good(8, 140, 29.0), 150),
            Err(SensorFault::NotReady)
        );
        assert_eq!(
            s.update(good(8, 140, 29.0), 160),
            Ok(UpdateResult::Duplicate)
        );
        assert_eq!(s.reading(170), Err(SensorFault::NotReady));
        assert_eq!(s.accepted_sample_identity(), Some((1, 8, 140)));
        assert_eq!(
            s.update(good(9, 180, 31.0), 190),
            Err(SensorFault::NotReady)
        );
        s.update(good(10, 200, 33.0), 210).unwrap();
        assert_eq!(s.reading(210), Ok(31.0));
        assert_eq!(s.reading(499), Ok(31.0));
        assert_eq!(s.reading(500), Err(SensorFault::Stale));
        assert_eq!(s.accepted_sample_identity(), Some((1, 10, 200)));

        // Separate recovery from filter readiness, so duplicate/read increments
        // cannot be hidden by an incomplete filter window.
        let mut recovery =
            Sensor::new(SensorConfig::new(Filter::Median(1), 0.0, 100.0, 300, 5)).unwrap();
        assert_eq!(
            recovery.update(good(7, 70, 101.0), 70),
            Err(SensorFault::Invalid)
        );
        assert_eq!(
            recovery.update(good(8, 80, 29.0), 80),
            Err(SensorFault::NotReady)
        );
        assert_eq!(recovery.recover_count, 1);
        for now in [81, 82] {
            assert_eq!(
                recovery.update(good(8, 80, 29.0), now),
                Ok(UpdateResult::Duplicate)
            );
            assert_eq!(recovery.reading(now), Err(SensorFault::NotReady));
            assert_eq!(recovery.recover_count, 1);
        }
        assert_eq!(recovery.reading(83), Err(SensorFault::NotReady));
        assert_eq!(recovery.recover_count, 1);
        for id in [9, 10, 11] {
            assert_eq!(
                recovery.update(good(id, id * 10, 29.0), id * 10),
                Err(SensorFault::NotReady)
            );
            assert_eq!(recovery.recover_count, (id - 7) as usize);
        }
        recovery.update(good(12, 120, 29.0), 120).unwrap();
        assert_eq!(recovery.reading(120), Ok(29.0));
    }

    #[test]
    fn ref_04_011_recovery_does_not_cross_epochs_and_fresh_sensor_starts_empty() {
        let config = SensorConfig::new(Filter::Median(5), 0.0, 100.0, 300, 3);
        let mut s = Sensor::new(config).unwrap();
        for (index, value) in [10.0, 20.0, 30.0, 40.0, 50.0].into_iter().enumerate() {
            let id = index as u64 + 1;
            let now = index as u64 * 10;
            let _ = s.update(Sample::good(1, id, now, value), now);
        }
        assert_eq!(s.reading(40), Ok(30.0));
        assert_eq!(
            s.update(Sample::new(1, 6, 50, 0.0, Quality::Disconnected), 50),
            Err(SensorFault::Disconnected)
        );
        for (index, value) in [10.0, 11.0, 12.0].into_iter().enumerate() {
            let id = index as u64 + 7;
            let now = 60 + index as u64 * 10;
            assert_eq!(
                s.update(Sample::good(1, id, now, value), now),
                Err(SensorFault::NotReady)
            );
        }
        for (index, value) in [70.0, 75.0, 80.0, 85.0, 90.0].into_iter().enumerate() {
            let id = index as u64 + 1;
            let now = 100 + index as u64 * 10;
            let result = s.update(Sample::good(2, id, now, value), now);
            if id < 5 {
                assert_eq!(result, Err(SensorFault::NotReady));
            } else {
                assert_eq!(result, Ok(UpdateResult::Accepted));
            }
            assert_eq!(s.accepted_sample_identity(), Some((2, id, now)));
            if id == 2 {
                assert_eq!(
                    s.update(Sample::good(2, id, now, value), 111),
                    Ok(UpdateResult::Duplicate)
                );
                assert_eq!(s.reading(112), Err(SensorFault::NotReady));
                assert_eq!(s.accepted_sample_identity(), Some((2, id, now)));
            }
        }
        assert_eq!(s.reading(140), Ok(80.0));
        let mut fresh = Sensor::new(config).unwrap();
        assert_eq!(fresh.reading(141), Err(SensorFault::NotReady));
        assert_eq!(fresh.accepted_sample_identity(), None);
        for (index, value) in [20.0, 25.0, 30.0, 35.0, 40.0].into_iter().enumerate() {
            let id = index as u64 + 1;
            let now = 150 + index as u64 * 10;
            let result = fresh.update(Sample::good(2, id, now, value), now);
            if id < 5 {
                assert_eq!(result, Err(SensorFault::NotReady));
            } else {
                assert_eq!(result, Ok(UpdateResult::Accepted));
            }
        }
        assert_eq!(fresh.reading(190), Ok(30.0));
    }

    #[test]
    fn ref_04_012_exact_stale_boundary_and_default_reset_clear_old_sample() {
        let config = SensorConfig::new(Filter::Median(1), 0.0, 100.0, 3_000, 1);
        let mut s = Sensor::new(config).unwrap();
        s.update(Sample::good(1, 1, 0, 20.0), 0).unwrap();
        assert_eq!(
            s.update(Sample::good(1, 1, 0, 20.0), 2_999),
            Ok(UpdateResult::Duplicate)
        );
        assert_eq!(s.reading(2_999), Ok(20.0));
        assert_eq!(s.reading(3_000), Err(SensorFault::Stale));
        assert_eq!(s.accepted_sample_identity(), Some((1, 1, 0)));
        assert_eq!(s.last_physical_sample_time(), Some(0));
        s.reset();
        assert_eq!(s.accepted_sample_identity(), None);
        assert_eq!(s.last_physical_sample_time(), None);
        assert_eq!(s.value(3_001), None);
        assert_eq!(s.reading(0), Err(SensorFault::NotReady));
        assert_eq!(s.reading(3_001), Err(SensorFault::NotReady));
        let mut fresh = Sensor::new(config).unwrap();
        assert_eq!(fresh.accepted_sample_identity(), None);
        assert_eq!(fresh.reading(0), Err(SensorFault::NotReady));
        fresh.update(Sample::good(1, 1, 1, 20.0), 1).unwrap();
        assert_eq!(fresh.reading(1), Ok(20.0));
        assert_eq!(
            fresh.update(Sample::new(1, 2, 2, 0.0, Quality::Disconnected), 2),
            Err(SensorFault::Disconnected)
        );
        assert_eq!(fresh.reading(2), Err(SensorFault::Disconnected));
        fresh.update(Sample::good(1, 3, 3, 20.0), 3).unwrap();
        assert_eq!(
            fresh.update(Sample::good(1, 4, 4, 101.0), 4),
            Err(SensorFault::Invalid)
        );
        assert_eq!(fresh.reading(4), Err(SensorFault::Invalid));
    }
}
