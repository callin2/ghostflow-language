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
                    self.ema + alpha * (value - self.ema)
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
            fault: None,
            recover_count: 0,
            diagnostics: [None; MAX_DIAGNOSTICS],
            diagnostic_count: 0,
        })
    }

    pub fn config(&self) -> SensorConfig {
        self.config
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
            return Reading {
                value: self.state.filtered,
                quality: fault.quality(),
            };
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
        self.fault = None;
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
    fn diagnostic_ring_is_bounded_without_read_panics() {
        let mut s = sensor(Filter::Median(1), 1);
        for epoch in 0..=MAX_DIAGNOSTICS as u64 + 2 {
            assert!(s.update(Sample::good(epoch, 1, epoch, 10.0), epoch).is_ok());
        }
        assert_eq!(s.diagnostic_count(), MAX_DIAGNOSTICS + 2);
        assert_eq!(s.diagnostics().count(), MAX_DIAGNOSTICS);
        assert!(s.diagnostic(MAX_DIAGNOSTICS).is_none());
    }
}
