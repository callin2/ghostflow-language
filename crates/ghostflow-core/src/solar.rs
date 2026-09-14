//! Portable sea-level sunrise and sunset scheduling.
//!
//! This is a direct, dependency-free port of the sun-time portion of SunCalc
//! 2.0.2.  See `docs/SUNCALC-ATTRIBUTION.md` for the retained attribution and
//! license notice.  The caller owns clock acquisition and trust; this module
//! does not read a machine clock or perform I/O.

use std::fmt;

pub const SOLAR_CALCULATION: &str = "suncalc-2.0.2/sea-level";

const DAY_MS: u64 = 86_400_000;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_WALL_MS: u64 = 253_402_300_799_999;
const MAX_CACHE: usize = 8;
const PI: f64 = std::f64::consts::PI;
const RAD: f64 = PI / 180.0;
const J1970: f64 = 2_440_588.0;
const J2000: f64 = 2_451_545.0;
const J0: f64 = 0.0009;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClockSnapshot {
    pub now_ms: u64,
    pub wall_ms: Option<u64>,
    pub trusted: bool,
}

impl ClockSnapshot {
    /// Checks representable monotonic and wall-clock bounds. A missing wall clock is
    /// valid input, but is always treated as untrusted by [`SolarSchedule::poll`].
    pub fn validate(self) -> Result<(), String> {
        if self.now_ms > MAX_SAFE_INTEGER {
            return Err("nowMs must be a nonnegative safe integer".into());
        }
        if self.wall_ms.is_some_and(|wall_ms| wall_ms > MAX_WALL_MS) {
            return Err("wall time must be before year 10000".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SolarDescriptor {
    pub name: String,
    pub timezone: String,
    pub latitude: f64,
    pub longitude: f64,
    pub event: String,
    pub offset_ms: i64,
    pub fallback: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SolarOccurrence {
    pub date: String,
    pub event_wall_ms: Option<u64>,
    pub scheduled_wall_ms: Option<u64>,
    pub reason: Option<&'static str>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SolarPoll {
    pub due: bool,
    pub reason: &'static str,
    pub occurrence: Option<SolarOccurrence>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Timezone {
    Utc,
    Seoul,
}

impl Timezone {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "UTC" | "Etc/UTC" => Ok(Self::Utc),
            "Asia/Seoul" => Ok(Self::Seoul),
            _ => Err(format!(
                "unsupported solar timezone {value:?}; supported: Asia/Seoul, UTC, Etc/UTC"
            )),
        }
    }

    fn offset_ms(self) -> i64 {
        match self {
            Self::Utc => 0,
            Self::Seoul => 9 * 60 * 60 * 1000,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CivilDate {
    year: i32,
    month: u8,
    day: u8,
}

impl fmt::Display for CivilDate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
}

/// A bounded, in-process solar occurrence provider for a single descriptor.
#[derive(Clone, Debug)]
pub struct SolarSchedule {
    descriptor: SolarDescriptor,
    timezone: Timezone,
    cache: Vec<(CivilDate, SolarOccurrence)>,
    last_now_ms: Option<u64>,
    wall_high_ms: Option<u64>,
    trusted: bool,
}

impl SolarSchedule {
    pub fn new(desc: SolarDescriptor) -> Result<Self, String> {
        validate_descriptor(&desc)?;
        let timezone = Timezone::parse(&desc.timezone)?;
        Ok(Self {
            descriptor: desc,
            timezone,
            cache: Vec::new(),
            last_now_ms: None,
            wall_high_ms: None,
            trusted: false,
        })
    }

    pub fn poll(&mut self, snapshot: ClockSnapshot) -> Result<SolarPoll, String> {
        snapshot.validate()?;
        let previous_now_ms = self.last_now_ms;
        if previous_now_ms.is_some_and(|previous| snapshot.now_ms < previous) {
            return Err("monotonic clock moved backwards".into());
        }
        self.last_now_ms = Some(snapshot.now_ms);

        // No wall value is never upgraded to a plausible current time.
        let trusted = snapshot.trusted && snapshot.wall_ms.is_some();
        if !trusted {
            self.trusted = false;
            return Ok(SolarPoll {
                due: false,
                reason: "UntrustedClock",
                occurrence: None,
            });
        }
        let wall_ms = snapshot.wall_ms.expect("checked above");
        let recovered = !self.trusted;
        self.trusted = true;
        let previous_wall_ms = self.wall_high_ms;
        self.wall_high_ms =
            Some(previous_wall_ms.map_or(wall_ms, |previous| previous.max(wall_ms)));

        let Some(previous_wall_ms) = previous_wall_ms else {
            return Ok(SolarPoll {
                due: false,
                reason: "BootBaseline",
                occurrence: None,
            });
        };
        if recovered {
            return Ok(SolarPoll {
                due: false,
                reason: "ClockRecoveryBaseline",
                occurrence: None,
            });
        }
        if wall_ms <= previous_wall_ms {
            return Ok(SolarPoll {
                due: false,
                reason: "AlreadyObserved",
                occurrence: None,
            });
        }
        if wall_ms - previous_wall_ms > 60_000
            || snapshot.now_ms - previous_now_ms.expect("baseline has a previous monotonic scan")
                > 60_000
        {
            return Ok(SolarPoll {
                due: false,
                reason: "ClockGapSkipped",
                occurrence: None,
            });
        }

        let offset = i128::from(self.descriptor.offset_ms);
        let first_date = self.date_for_ms(i128::from(previous_wall_ms) - offset);
        let second_date = self.date_for_ms(i128::from(wall_ms) - offset);
        let dates = if first_date == second_date {
            [Some(first_date), None]
        } else {
            [Some(first_date), Some(second_date)]
        };
        let mut unavailable = None;
        for date in dates.into_iter().flatten() {
            let occurrence = self.for_date(date);
            if occurrence.reason.is_some() {
                unavailable = occurrence.reason;
            }
            if let Some(at) = occurrence.scheduled_wall_ms {
                if at > previous_wall_ms && at <= wall_ms {
                    return Ok(SolarPoll {
                        due: true,
                        reason: "SolarEvent",
                        occurrence: Some(occurrence),
                    });
                }
            }
        }
        Ok(SolarPoll {
            due: false,
            reason: unavailable.unwrap_or("OutsideSolarEvent"),
            occurrence: None,
        })
    }

    pub fn preview(&mut self, wall_ms: u64) -> Result<SolarOccurrence, String> {
        if wall_ms > MAX_WALL_MS {
            return Err("wall time must be before year 10000".into());
        }
        Ok(self.for_date(self.date_for_ms(i128::from(wall_ms))))
    }

    fn date_for_ms(&self, wall_ms: i128) -> CivilDate {
        let local_ms = wall_ms + i128::from(self.timezone.offset_ms());
        let days = local_ms.div_euclid(i128::from(DAY_MS));
        civil_from_days(days as i64)
    }

    fn for_date(&mut self, date: CivilDate) -> SolarOccurrence {
        if let Some((_, occurrence)) = self.cache.iter().find(|(cached, _)| *cached == date) {
            return occurrence.clone();
        }
        let supported = (2000..=2100).contains(&date.year);
        let event_wall_ms = if supported {
            self.event_for_local_date(date)
        } else {
            None
        };
        let scheduled_wall_ms = event_wall_ms.and_then(|event_ms| {
            let scheduled = i128::from(event_ms) + i128::from(self.descriptor.offset_ms);
            u64::try_from(scheduled).ok()
        });
        let occurrence = SolarOccurrence {
            date: date.to_string(),
            event_wall_ms,
            scheduled_wall_ms,
            reason: event_wall_ms.is_none().then_some(if supported {
                "NoSolarEvent"
            } else {
                "UnsupportedSolarDate"
            }),
        };
        self.cache.push((date, occurrence.clone()));
        if self.cache.len() > MAX_CACHE {
            self.cache.remove(0);
        }
        occurrence
    }

    // Keep this search identical to the JavaScript host adapter.  `getTimes`
    // starts from a UTC solar day, whereas the descriptor identifies the
    // natural event's civil date in its requested timezone.  A longitude and
    // timezone can put that event in an adjacent UTC day.
    fn event_for_local_date(&self, date: CivilDate) -> Option<u64> {
        [-1_i64, 0, 1]
            .into_iter()
            .filter_map(|shift| {
                let utc_date =
                    civil_from_days(days_from_civil(date.year, date.month, date.day) + shift);
                let instant = solar_event_ms(
                    utc_date,
                    self.descriptor.latitude,
                    self.descriptor.longitude,
                    &self.descriptor.event,
                )?;
                (self.date_for_ms(i128::from(instant)) == date).then_some(instant)
            })
            .min()
    }
}

fn validate_descriptor(desc: &SolarDescriptor) -> Result<(), String> {
    if !valid_name(&desc.name) {
        return Err("invalid Solar name".into());
    }
    if desc.timezone.trim().is_empty() {
        return Err("Solar timezone is required".into());
    }
    if !desc.latitude.is_finite() || desc.latitude.abs() > 90.0 {
        return Err("Solar latitude is out of range".into());
    }
    if !desc.longitude.is_finite() || desc.longitude.abs() > 180.0 {
        return Err("Solar longitude is out of range".into());
    }
    if desc.event != "rise" && desc.event != "set" {
        return Err("Solar event must be rise or set".into());
    }
    if desc.offset_ms.unsigned_abs() > DAY_MS {
        return Err("Solar offset must be integer milliseconds within 24 hours".into());
    }
    if desc.fallback != "skip" {
        return Err("Solar requires explicit fallback skip".into());
    }
    Ok(())
}

fn valid_name(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == b'_') || value.len() > 128 {
        return false;
    }
    bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

// Howard Hinnant's public-domain civil-date conversion, with the epoch changed
// to Unix day zero.  It deliberately works outside the solar event range so a
// preview can still identify an unsupported local date without consulting a TZ DB.
fn civil_from_days(days: i64) -> CivilDate {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let month_prime = (5 * doy + 2) / 153;
    let day = doy - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    CivilDate {
        year: (year + i64::from(month <= 2)) as i32,
        month: month as u8,
        day: day as u8,
    }
}

fn days_from_civil(year: i32, month: u8, day: u8) -> i64 {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = i64::from(month);
    let day = i64::from(day);
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn solar_event_ms(date: CivilDate, latitude: f64, longitude: f64, event: &str) -> Option<u64> {
    let noon_ms =
        days_from_civil(date.year, date.month, date.day) as f64 * DAY_MS as f64 + 43_200_000.0;
    let lw = RAD * -longitude;
    let phi = RAD * latitude;
    let d = js_round(to_days(noon_ms) - J0 - lw / (2.0 * PI));
    let mut transit = d + J0 + lw / (2.0 * PI);
    for _ in 0..3 {
        let hour_angle = wrap_pi(sidereal_time(transit, lw) - sun_coords(to_days_tt(transit)).0);
        transit -= hour_angle / (2.0 * PI);
    }
    let declination = sun_coords(to_days_tt(transit)).1;
    let sign = if event == "rise" { -1.0 } else { 1.0 };
    let mut result = set_j(-0.833 * RAD, transit, sign, lw, phi, declination)?;
    // SunCalc returns a Date, whose TimeClip operation truncates a positive
    // fractional epoch millisecond.  Supported dates are all positive.
    result = (result + J2000 + 0.5 - J1970) * DAY_MS as f64;
    if result.is_finite() && result >= 0.0 && result <= MAX_WALL_MS as f64 {
        Some(result as u64)
    } else {
        None
    }
}

fn to_days(ms: f64) -> f64 {
    ms / DAY_MS as f64 - 0.5 + J1970 - J2000
}

fn to_days_tt(days: f64) -> f64 {
    days + delta_t(days) / 86_400.0
}

fn delta_t(days: f64) -> f64 {
    let year = 2000.0 + days / 365.2425;
    if year < 1920.0 {
        let t = year - 1900.0;
        -2.79 + t * (1.494_119 + t * (-0.059_893_9 + t * (0.006_196_6 - t * 0.000_197)))
    } else if year < 1941.0 {
        let t = year - 1920.0;
        21.20 + t * (0.844_93 + t * (-0.076_100 + t * 0.002_0936))
    } else if year < 1961.0 {
        let t = year - 1950.0;
        29.07 + t * (0.407 + t * (-1.0 / 233.0 + t / 2547.0))
    } else if year < 1986.0 {
        let t = year - 1975.0;
        45.45 + t * (1.067 + t * (-1.0 / 260.0 - t / 718.0))
    } else if year < 2005.0 {
        let t = year - 2000.0;
        63.86
            + t * (0.3345
                + t * (-0.060_374 + t * (0.001_7275 + t * (0.000_651_814 + t * 0.000_023_735_99))))
    } else if year < 2050.0 {
        let t = year - 2000.0;
        62.92 + t * (0.32217 + t * 0.005_589)
    } else {
        let t = (year - 1820.0) / 100.0;
        -20.0 + 32.0 * t * t - 0.5628 * (2150.0 - year)
    }
}

fn sun_coords(days: f64) -> (f64, f64) {
    let t = days / 36_525.0;
    let l0 = RAD * (280.46646 + t * (36_000.76983 + t * 0.000_3032));
    let mean_anomaly = RAD * (357.52911 + t * (35_999.05029 - t * 0.000_1537));
    let sin_m = mean_anomaly.sin();
    let cos_m = mean_anomaly.cos();
    let center = RAD
        * ((1.914_602 - t * (0.004_817 + t * 0.000_014)) * sin_m
            + (0.019_993 - 0.000_101 * t) * 2.0 * sin_m * cos_m
            + 0.000_289 * sin_m * (3.0 - 4.0 * sin_m * sin_m));
    let omega = RAD * (125.04 - 1934.136 * t);
    let longitude = l0 + center - RAD * (0.00569 + 0.00478 * omega.sin());
    let obliquity = RAD * (23.439291 - t * (0.0130042 + t * (0.00000016 - t * 0.000000504)))
        + RAD * 0.00256 * omega.cos();
    (
        (obliquity.cos() * longitude.sin()).atan2(longitude.cos()),
        (obliquity.sin() * longitude.sin()).asin(),
    )
}

fn sidereal_time(days: f64, lw: f64) -> f64 {
    RAD * (280.460_618_37 + 360.985_647_366_29 * days) - lw
}

fn altitude(hour_angle: f64, phi: f64, declination: f64) -> f64 {
    (phi.sin() * declination.sin() + phi.cos() * declination.cos() * hour_angle.cos()).asin()
}

fn wrap_pi(angle: f64) -> f64 {
    angle - 2.0 * PI * js_round(angle / (2.0 * PI))
}

fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn set_j(
    h0: f64,
    transit: f64,
    sign: f64,
    lw: f64,
    phi: f64,
    declination_at_transit: f64,
) -> Option<f64> {
    let cos_h0 = (h0.sin() - phi.sin() * declination_at_transit.sin())
        / (phi.cos() * declination_at_transit.cos());
    if !(-1.0..=1.0).contains(&cos_h0) {
        return None;
    }
    let mut days = transit + sign * cos_h0.acos() / (2.0 * PI);
    for _ in 0..2 {
        let (right_ascension, declination) = sun_coords(to_days_tt(days));
        let hour_angle = wrap_pi(sidereal_time(days, lw) - right_ascension);
        let altitude = altitude(hour_angle, phi, declination);
        let sin_hour_angle = phi.cos() * declination.cos() * hour_angle.sin();
        if sin_hour_angle.abs() < 1e-6 {
            break;
        }
        days += (altitude - h0) / (2.0 * PI * sin_hour_angle);
    }
    Some(days)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor(timezone: &str, event: &str, offset_ms: i64) -> SolarDescriptor {
        SolarDescriptor {
            name: "sun".into(),
            timezone: timezone.into(),
            latitude: 37.5665,
            longitude: 126.978,
            event: event.into(),
            offset_ms,
            fallback: "skip".into(),
        }
    }

    #[test]
    fn reference_vectors_match_suncalc_within_one_millisecond() {
        let mut seen = 0;
        for line in include_str!("../../../tests/solar-reference-vectors.txt")
            .lines()
            .skip(1)
        {
            let fields: Vec<_> = line.split('|').collect();
            if fields.len() != 7 {
                continue;
            }
            seen += 1;
            let date = CivilDate {
                year: fields[0].parse().unwrap(),
                month: fields[1].parse().unwrap(),
                day: fields[2].parse().unwrap(),
            };
            let actual = solar_event_ms(
                date,
                fields[3].parse().unwrap(),
                fields[4].parse().unwrap(),
                fields[5],
            );
            let expected = fields.get(6).and_then(|value| value.parse::<u64>().ok());
            assert_eq!(actual.is_none(), expected.is_none(), "{line}");
            if let (Some(actual), Some(expected)) = (actual, expected) {
                assert!(
                    actual.abs_diff(expected) <= 1,
                    "{line}: expected {expected}, got {actual}"
                );
            }
        }
        assert!(seen >= 8, "reference vectors must not be silently omitted");
    }

    #[test]
    fn provider_preview_and_pulse_match_js_local_date_selection() {
        let mut seen = 0;
        for line in include_str!("../../../tests/solar-provider-parity-vectors.txt")
            .lines()
            .filter(|line| !line.starts_with('#'))
        {
            if line.is_empty() {
                continue;
            }
            let fields: Vec<_> = line.split('|').collect();
            assert_eq!(fields.len(), 10, "{line}");
            let expected_event: u64 = fields[8].parse().unwrap();
            let expected_scheduled: u64 = fields[9].parse().unwrap();
            let mut schedule = SolarSchedule::new(SolarDescriptor {
                name: "sun".into(),
                timezone: fields[1].into(),
                latitude: fields[2].parse().unwrap(),
                longitude: fields[3].parse().unwrap(),
                event: fields[4].into(),
                offset_ms: fields[5].parse().unwrap(),
                fallback: "skip".into(),
            })
            .unwrap();
            let preview = schedule.preview(fields[6].parse().unwrap()).unwrap();
            assert_eq!(preview.date, fields[7], "{line}");
            assert!(
                preview.event_wall_ms.unwrap().abs_diff(expected_event) <= 1,
                "{line}: preview event {preview:?}"
            );
            assert!(
                preview
                    .scheduled_wall_ms
                    .unwrap()
                    .abs_diff(expected_scheduled)
                    <= 1,
                "{line}: preview event {preview:?}"
            );

            // Allow the declared one-millisecond calculation tolerance while
            // proving the provider still emits one pulse across the JS event.
            let before = expected_scheduled - 2;
            let after = expected_scheduled + 2;
            assert_eq!(
                schedule
                    .poll(ClockSnapshot {
                        now_ms: 0,
                        wall_ms: Some(before),
                        trusted: true,
                    })
                    .unwrap()
                    .reason,
                "BootBaseline",
                "{line}"
            );
            let due = schedule
                .poll(ClockSnapshot {
                    now_ms: 4,
                    wall_ms: Some(after),
                    trusted: true,
                })
                .unwrap();
            assert!(due.due, "{line}: {due:?}");
            assert_eq!(due.occurrence.unwrap().date, fields[7], "{line}");
            seen += 1;
        }
        assert_eq!(seen, 5);
    }

    #[test]
    fn preview_uses_natural_local_date_before_offset() {
        let mut schedule =
            SolarSchedule::new(descriptor("Asia/Seoul", "rise", 30 * 60 * 1000)).unwrap();
        let preview = schedule.preview(1_789_333_967_357).unwrap();
        assert_eq!(preview.date, "2026-09-14");
        assert_eq!(preview.event_wall_ms, Some(1_789_333_967_357));
        assert_eq!(preview.scheduled_wall_ms, Some(1_789_335_767_357));
        assert_eq!(preview.reason, None);
    }

    #[test]
    fn poll_matches_boundary_and_clock_rules() {
        let event = 1_789_333_967_357;
        let mut schedule = SolarSchedule::new(descriptor("Asia/Seoul", "rise", 0)).unwrap();
        assert_eq!(
            schedule
                .poll(ClockSnapshot {
                    now_ms: 0,
                    wall_ms: Some(event - 1),
                    trusted: true
                })
                .unwrap()
                .reason,
            "BootBaseline"
        );
        let due = schedule
            .poll(ClockSnapshot {
                now_ms: 1,
                wall_ms: Some(event),
                trusted: true,
            })
            .unwrap();
        assert!(due.due);
        assert_eq!(due.reason, "SolarEvent");
        assert_eq!(due.occurrence.unwrap().event_wall_ms, Some(event));
        assert_eq!(
            schedule
                .poll(ClockSnapshot {
                    now_ms: 2,
                    wall_ms: Some(event - 1),
                    trusted: true
                })
                .unwrap()
                .reason,
            "AlreadyObserved"
        );
        assert_eq!(
            schedule
                .poll(ClockSnapshot {
                    now_ms: 3,
                    wall_ms: None,
                    trusted: true
                })
                .unwrap()
                .reason,
            "UntrustedClock"
        );
        assert_eq!(
            schedule
                .poll(ClockSnapshot {
                    now_ms: 4,
                    wall_ms: Some(event + 1),
                    trusted: true
                })
                .unwrap()
                .reason,
            "ClockRecoveryBaseline"
        );
        assert_eq!(
            schedule
                .poll(ClockSnapshot {
                    now_ms: 3,
                    wall_ms: Some(event + 2),
                    trusted: true
                })
                .unwrap_err(),
            "monotonic clock moved backwards"
        );
    }

    #[test]
    fn pulse_timing_keeps_the_original_event_date_across_offsets() {
        let event = 1_789_333_967_357;
        for offset_ms in [-30 * 60 * 1000, 30 * 60 * 1000] {
            let scheduled = u64::try_from(i128::from(event) + i128::from(offset_ms)).unwrap();
            let mut schedule =
                SolarSchedule::new(descriptor("Asia/Seoul", "rise", offset_ms)).unwrap();
            assert_eq!(
                schedule
                    .poll(ClockSnapshot {
                        now_ms: 0,
                        wall_ms: Some(scheduled - 1),
                        trusted: true,
                    })
                    .unwrap()
                    .reason,
                "BootBaseline"
            );
            let due = schedule
                .poll(ClockSnapshot {
                    now_ms: 1,
                    wall_ms: Some(scheduled),
                    trusted: true,
                })
                .unwrap();
            assert!(due.due, "offset {offset_ms}");
            let occurrence = due.occurrence.unwrap();
            assert_eq!(occurrence.date, "2026-09-14");
            assert_eq!(occurrence.event_wall_ms, Some(event));
            assert_eq!(occurrence.scheduled_wall_ms, Some(scheduled));
        }
    }

    #[test]
    fn gap_and_missing_events_are_skipped() {
        let event = 1_789_333_967_357;
        let mut schedule = SolarSchedule::new(descriptor("Asia/Seoul", "rise", 0)).unwrap();
        schedule
            .poll(ClockSnapshot {
                now_ms: 0,
                wall_ms: Some(event - 61_000),
                trusted: true,
            })
            .unwrap();
        assert_eq!(
            schedule
                .poll(ClockSnapshot {
                    now_ms: 61_001,
                    wall_ms: Some(event),
                    trusted: true
                })
                .unwrap()
                .reason,
            "ClockGapSkipped"
        );

        let mut polar = descriptor("UTC", "rise", 0);
        polar.latitude = 78.2232;
        polar.longitude = 15.6469;
        let mut polar = SolarSchedule::new(polar).unwrap();
        let preview = polar.preview(1_766_318_400_000).unwrap();
        assert_eq!(preview.reason, Some("NoSolarEvent"));

        let mut unsupported = SolarSchedule::new(descriptor("UTC", "rise", 0)).unwrap();
        assert_eq!(
            unsupported.preview(915_148_800_000).unwrap().reason,
            Some("UnsupportedSolarDate")
        );
    }

    #[test]
    fn validation_is_bounded_and_explicit() {
        assert!(SolarSchedule::new(descriptor("America/New_York", "rise", 0)).is_err());
        let mut invalid = descriptor("UTC", "rise", 0);
        invalid.fallback = "next".into();
        assert!(SolarSchedule::new(invalid).is_err());
        let mut invalid = descriptor("UTC", "rise", 0);
        invalid.latitude = f64::NAN;
        assert!(SolarSchedule::new(invalid).is_err());
        assert!(ClockSnapshot {
            now_ms: 0,
            wall_ms: Some(MAX_WALL_MS + 1),
            trusted: true
        }
        .validate()
        .is_err());
        let unsafe_now = ClockSnapshot {
            now_ms: MAX_SAFE_INTEGER + 1,
            wall_ms: None,
            trusted: false,
        };
        assert_eq!(
            unsafe_now.validate().unwrap_err(),
            "nowMs must be a nonnegative safe integer"
        );
        let mut schedule = SolarSchedule::new(descriptor("UTC", "rise", 0)).unwrap();
        assert_eq!(
            schedule.poll(unsafe_now).unwrap_err(),
            "nowMs must be a nonnegative safe integer"
        );
    }
}
