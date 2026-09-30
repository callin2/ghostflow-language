//! Portable trusted-clock gate for schedule admission.
//!
//! The caller supplies accepted clock facts. This component neither reads a
//! machine clock nor decides occurrences. Clone the gate before staging so a
//! rejected outer transaction can discard all clock changes.

use crate::{Error, Result};

pub const MAX_EXACT_TIME: u64 = 9_007_199_254_740_991;
const MAX_WALL_MS: u64 = 253_402_300_799_999;
const MISSING_WALL_TIME: &str = "MissingWallTime";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClockTrust<'a> {
    Trusted,
    Unknown(&'a str),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClockSnapshot<'a> {
    pub monotonic_ms: u64,
    pub boot_epoch: u64,
    pub wall_ms: Option<u64>,
    pub trust: ClockTrust<'a>,
    pub uncertainty_ms: Option<u64>,
    pub source_revision: Option<&'a str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClockDisposition {
    ClockUnknown,
    BootBaseline,
    RecoveryBaseline,
    ObservationGap,
    Observed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClockObservation<'a> {
    pub disposition: ClockDisposition,
    pub previous_effective_wall_ms: Option<u64>,
    pub current_effective_wall_ms: Option<u64>,
    pub previous_trusted_high_water_ms: Option<u64>,
    pub trusted_high_water_ms: Option<u64>,
    pub uncertainty_ms: Option<u64>,
    pub source_revision: Option<&'a str>,
    pub unknown_reason: Option<&'a str>,
}

/// Owned provenance avoids borrowing the gate's retained clock revision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClockProvenance {
    Snapshot,
    HeldClock { source_revision: Option<String> },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicyClockObservation<'a> {
    pub observation: ClockObservation<'a>,
    pub provenance: ClockProvenance,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct TrustedAnchor {
    monotonic_ms: u64,
    wall_ms: u64,
    uncertainty_ms: Option<u64>,
    source_revision: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScheduleClockGate {
    max_gap_ms: u64,
    boot_epoch: u64,
    last_monotonic_ms: Option<u64>,
    previous_effective_wall_ms: Option<u64>,
    trusted_high_water_ms: Option<u64>,
    ever_trusted: bool,
    trusted_anchor: Option<TrustedAnchor>,
    previous_snapshot_trusted: bool,
}

impl ScheduleClockGate {
    pub fn new(max_gap_ms: u64, boot_epoch: u64) -> Result<Self> {
        if !(1..=MAX_EXACT_TIME).contains(&max_gap_ms) || boot_epoch > MAX_EXACT_TIME {
            return Err(Error::new("invalid schedule clock configuration"));
        }
        Ok(Self {
            max_gap_ms,
            boot_epoch,
            last_monotonic_ms: None,
            previous_effective_wall_ms: None,
            trusted_high_water_ms: None,
            ever_trusted: false,
            trusted_anchor: None,
            previous_snapshot_trusted: false,
        })
    }

    pub fn poll<'a>(&mut self, snapshot: ClockSnapshot<'a>) -> Result<ClockObservation<'a>> {
        self.validate(snapshot)?;
        let previous_wall = self.previous_effective_wall_ms;
        let previous_high_water = self.trusted_high_water_ms;
        let effective_wall = match snapshot.trust {
            ClockTrust::Trusted => snapshot.wall_ms,
            ClockTrust::Unknown(_) => None,
        };
        let unknown_reason = match snapshot.trust {
            ClockTrust::Unknown(reason) => Some(reason),
            ClockTrust::Trusted if snapshot.wall_ms.is_none() => Some(MISSING_WALL_TIME),
            ClockTrust::Trusted => None,
        };

        let disposition = if effective_wall.is_none() {
            ClockDisposition::ClockUnknown
        } else if !self.ever_trusted {
            ClockDisposition::BootBaseline
        } else if previous_wall.is_none() {
            ClockDisposition::RecoveryBaseline
        } else {
            let monotonic_gap = snapshot.monotonic_ms
                - self
                    .last_monotonic_ms
                    .expect("validated accepted predecessor");
            let wall_gap = effective_wall
                .expect("checked")
                .checked_sub(previous_wall.expect("checked"));
            if monotonic_gap > self.max_gap_ms || wall_gap.is_some_and(|gap| gap > self.max_gap_ms)
            {
                ClockDisposition::ObservationGap
            } else {
                ClockDisposition::Observed
            }
        };

        self.last_monotonic_ms = Some(snapshot.monotonic_ms);
        self.previous_effective_wall_ms = effective_wall;
        if let Some(wall_ms) = effective_wall {
            self.trusted_anchor = Some(TrustedAnchor {
                monotonic_ms: snapshot.monotonic_ms,
                wall_ms,
                uncertainty_ms: snapshot.uncertainty_ms,
                source_revision: snapshot.source_revision.map(str::to_owned),
            });
            self.ever_trusted = true;
            self.trusted_high_water_ms = Some(
                self.trusted_high_water_ms
                    .map_or(wall_ms, |previous| previous.max(wall_ms)),
            );
        }
        self.previous_snapshot_trusted = effective_wall.is_some();

        Ok(ClockObservation {
            disposition,
            previous_effective_wall_ms: previous_wall,
            current_effective_wall_ms: effective_wall,
            previous_trusted_high_water_ms: previous_high_water,
            trusted_high_water_ms: self.trusted_high_water_ms,
            uncertainty_ms: snapshot.uncertainty_ms,
            source_revision: snapshot.source_revision,
            unknown_reason,
        })
    }

    /// `None` selects trusted-only admission; `Some(d)` holds strictly before
    /// elapsed `d`, then skips. Anchors live only in this gate's current boot.
    pub fn poll_with_hold<'a>(
        &mut self,
        snapshot: ClockSnapshot<'a>,
        hold_duration_ms: Option<u64>,
    ) -> Result<PolicyClockObservation<'a>> {
        self.validate(snapshot)?;
        if hold_duration_ms.is_some_and(|d| !(1..=MAX_EXACT_TIME).contains(&d)) {
            return Err(Error::new("invalid schedule clock hold duration"));
        }
        let trusted = snapshot.trust == ClockTrust::Trusted && snapshot.wall_ms.is_some();
        if trusted || hold_duration_ms.is_none() {
            let recovering = trusted && self.ever_trusted && !self.previous_snapshot_trusted;
            let mut observation = self.poll(snapshot)?;
            if recovering {
                observation.disposition = ClockDisposition::RecoveryBaseline;
            }
            return Ok(PolicyClockObservation {
                observation,
                provenance: ClockProvenance::Snapshot,
            });
        }
        let held = self.trusted_anchor.as_ref().and_then(|anchor| {
            let elapsed = snapshot.monotonic_ms.checked_sub(anchor.monotonic_ms)?;
            if elapsed >= hold_duration_ms.expect("checked") {
                return None;
            }
            let wall = anchor
                .wall_ms
                .checked_add(elapsed)
                .filter(|v| *v <= MAX_WALL_MS)?;
            let uncertainty = anchor
                .uncertainty_ms?
                .checked_add(elapsed)
                .filter(|v| *v <= MAX_EXACT_TIME)?;
            Some((wall, uncertainty, anchor.source_revision.clone()))
        });
        let Some((wall, uncertainty, source_revision)) = held else {
            return Ok(PolicyClockObservation {
                observation: self.poll(snapshot)?,
                provenance: ClockProvenance::Snapshot,
            });
        };
        let anchor = self.trusted_anchor.clone();
        let high_water = self.trusted_high_water_ms;
        let mut observation = self.poll(ClockSnapshot {
            wall_ms: Some(wall),
            trust: ClockTrust::Trusted,
            uncertainty_ms: Some(uncertainty),
            ..snapshot
        })?;
        self.trusted_anchor = anchor;
        self.trusted_high_water_ms = high_water;
        self.previous_snapshot_trusted = false;
        observation.trusted_high_water_ms = high_water;
        observation.unknown_reason = match snapshot.trust {
            ClockTrust::Unknown(reason) => Some(reason),
            ClockTrust::Trusted => Some(MISSING_WALL_TIME),
        };
        Ok(PolicyClockObservation {
            observation,
            provenance: ClockProvenance::HeldClock { source_revision },
        })
    }

    fn validate(&self, snapshot: ClockSnapshot<'_>) -> Result<()> {
        if snapshot.boot_epoch > MAX_EXACT_TIME || snapshot.boot_epoch != self.boot_epoch {
            return Err(Error::new("schedule clock boot epoch mismatch"));
        }
        if snapshot.monotonic_ms > MAX_EXACT_TIME
            || snapshot
                .wall_ms
                .is_some_and(|wall_ms| wall_ms > MAX_WALL_MS)
            || snapshot
                .uncertainty_ms
                .is_some_and(|uncertainty| uncertainty > MAX_EXACT_TIME)
        {
            return Err(Error::new("schedule clock value is out of range"));
        }
        if self
            .last_monotonic_ms
            .is_some_and(|previous| snapshot.monotonic_ms < previous)
        {
            return Err(Error::new("schedule monotonic clock moved backwards"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unknown(monotonic_ms: u64) -> ClockSnapshot<'static> {
        ClockSnapshot {
            trust: ClockTrust::Unknown("TrustLost"),
            wall_ms: None,
            source_revision: Some("untrusted-r2"),
            ..trusted(monotonic_ms, 0)
        }
    }

    #[test]
    fn held_clock_uses_original_anchor_owned_provenance_and_exact_expiry() {
        let mut gate = ScheduleClockGate::new(100, 7).unwrap();
        gate.poll_with_hold(
            ClockSnapshot {
                uncertainty_ms: Some(4),
                ..trusted(10, 1_000)
            },
            Some(20),
        )
        .unwrap();
        for elapsed in [1, 19] {
            let held = gate
                .poll_with_hold(unknown(10 + elapsed), Some(20))
                .unwrap();
            assert_eq!(
                held.observation.current_effective_wall_ms,
                Some(1_000 + elapsed)
            );
            assert_eq!(held.observation.uncertainty_ms, Some(4 + elapsed));
            assert_eq!(held.observation.trusted_high_water_ms, Some(1_000));
            assert_eq!(held.observation.unknown_reason, Some("TrustLost"));
            assert_eq!(
                held.provenance,
                ClockProvenance::HeldClock {
                    source_revision: Some("clock-r1".to_owned())
                }
            );
        }
        let expired = gate.poll_with_hold(unknown(30), Some(20)).unwrap();
        assert_eq!(
            expired.observation.disposition,
            ClockDisposition::ClockUnknown
        );
        assert_eq!(expired.observation.current_effective_wall_ms, None);
        assert_eq!(expired.observation.trusted_high_water_ms, Some(1_000));
        let recovered = gate.poll_with_hold(trusted(31, 900), Some(20)).unwrap();
        assert_eq!(
            recovered.observation.disposition,
            ClockDisposition::RecoveryBaseline
        );
        assert_eq!(recovered.observation.trusted_high_water_ms, Some(1_000));
    }

    #[test]
    fn held_clock_requires_fresh_known_uncertainty_and_checked_ranges() {
        for baseline in [
            None,
            Some(trusted(0, 1_000)),
            Some(ClockSnapshot {
                uncertainty_ms: Some(MAX_EXACT_TIME),
                ..trusted(0, 1_000)
            }),
            Some(ClockSnapshot {
                uncertainty_ms: Some(0),
                ..trusted(0, MAX_WALL_MS)
            }),
        ] {
            let mut gate = ScheduleClockGate::new(100, 7).unwrap();
            if let Some(snapshot) = baseline {
                gate.poll(snapshot).unwrap();
            }
            let result = gate.poll_with_hold(unknown(1), Some(20)).unwrap();
            assert_eq!(
                result.observation.disposition,
                ClockDisposition::ClockUnknown
            );
            assert_eq!(result.provenance, ClockProvenance::Snapshot);
        }
        let mut gate = ScheduleClockGate::new(100, 7).unwrap();
        gate.poll(ClockSnapshot {
            uncertainty_ms: Some(0),
            ..trusted(0, 1_000)
        })
        .unwrap();
        gate.poll_with_hold(unknown(1), Some(20)).unwrap();
        assert_eq!(
            gate.poll_with_hold(trusted(2, 1_002), Some(20))
                .unwrap()
                .observation
                .disposition,
            ClockDisposition::RecoveryBaseline
        );
        // A trusted-only policy never uses the retained anchor.
        assert_eq!(
            gate.poll_with_hold(unknown(3), None)
                .unwrap()
                .observation
                .disposition,
            ClockDisposition::ClockUnknown
        );
    }

    #[test]
    fn held_clock_rejections_are_atomic_and_owned_revision_outlives_gate() {
        let mut gate = ScheduleClockGate::new(100, 7).unwrap();
        let revision = String::from("temporary-revision");
        gate.poll(ClockSnapshot {
            uncertainty_ms: Some(0),
            source_revision: Some(&revision),
            ..trusted(10, 1_000)
        })
        .unwrap();
        drop(revision);
        let accepted = gate.clone();
        for duration in [0, MAX_EXACT_TIME + 1] {
            assert!(gate.poll_with_hold(unknown(11), Some(duration)).is_err());
            assert_eq!(gate, accepted);
        }
        assert!(gate.poll_with_hold(unknown(9), Some(20)).is_err());
        assert_eq!(gate, accepted);
        let provenance = gate
            .poll_with_hold(unknown(11), Some(20))
            .unwrap()
            .provenance;
        drop(gate);
        assert_eq!(
            provenance,
            ClockProvenance::HeldClock {
                source_revision: Some("temporary-revision".to_owned())
            }
        );
    }

    fn trusted(monotonic_ms: u64, wall_ms: u64) -> ClockSnapshot<'static> {
        ClockSnapshot {
            monotonic_ms,
            boot_epoch: 7,
            wall_ms: Some(wall_ms),
            trust: ClockTrust::Trusted,
            uncertainty_ms: None,
            source_revision: Some("clock-r1"),
        }
    }

    #[test]
    fn gap_uses_consecutive_effective_wall_instead_of_trusted_high_water() {
        let mut gate = ScheduleClockGate::new(100, 7).unwrap();
        let baseline = gate.poll(trusted(0, 1_000)).unwrap();
        assert_eq!(baseline.disposition, ClockDisposition::BootBaseline);
        assert_eq!(baseline.previous_trusted_high_water_ms, None);
        assert_eq!(baseline.trusted_high_water_ms, Some(1_000));

        let rollback = gate.poll(trusted(1, 900)).unwrap();
        assert_eq!(rollback.disposition, ClockDisposition::Observed);
        assert_eq!(rollback.previous_trusted_high_water_ms, Some(1_000));
        assert_eq!(rollback.trusted_high_water_ms, Some(1_000));

        let gap = gate.poll(trusted(2, 1_050)).unwrap();
        assert_eq!(gap.disposition, ClockDisposition::ObservationGap);
        assert_eq!(gap.previous_effective_wall_ms, Some(900));
        assert_eq!(gap.current_effective_wall_ms, Some(1_050));
        assert_eq!(gap.previous_trusted_high_water_ms, Some(1_000));
        assert_eq!(gap.trusted_high_water_ms, Some(1_050));
    }

    #[test]
    fn exact_gap_is_allowed_and_each_clock_rejects_one_past_it() {
        let mut allowed = ScheduleClockGate::new(100, 7).unwrap();
        allowed.poll(trusted(0, 1_000)).unwrap();
        assert_eq!(
            allowed.poll(trusted(100, 1_100)).unwrap().disposition,
            ClockDisposition::Observed
        );

        let mut monotonic_gap = ScheduleClockGate::new(100, 7).unwrap();
        monotonic_gap.poll(trusted(0, 1_000)).unwrap();
        assert_eq!(
            monotonic_gap.poll(trusted(101, 1_050)).unwrap().disposition,
            ClockDisposition::ObservationGap
        );

        let mut wall_gap = ScheduleClockGate::new(100, 7).unwrap();
        wall_gap.poll(trusted(0, 1_000)).unwrap();
        assert_eq!(
            wall_gap.poll(trusted(1, 1_101)).unwrap().disposition,
            ClockDisposition::ObservationGap
        );
    }

    #[test]
    fn unknown_boot_and_recovery_preserve_provenance_without_catchup() {
        let mut gate = ScheduleClockGate::new(100, 7).unwrap();
        let initial_unknown = gate
            .poll(ClockSnapshot {
                monotonic_ms: 0,
                boot_epoch: 7,
                wall_ms: None,
                trust: ClockTrust::Unknown("NoClock"),
                uncertainty_ms: None,
                source_revision: Some("provider-a"),
            })
            .unwrap();
        assert_eq!(initial_unknown.disposition, ClockDisposition::ClockUnknown);
        assert_eq!(initial_unknown.unknown_reason, Some("NoClock"));
        assert_eq!(initial_unknown.source_revision, Some("provider-a"));
        assert_eq!(initial_unknown.uncertainty_ms, None);
        assert_eq!(initial_unknown.trusted_high_water_ms, None);

        assert_eq!(
            gate.poll(trusted(1, 1_000)).unwrap().disposition,
            ClockDisposition::BootBaseline
        );
        let lost = gate
            .poll(ClockSnapshot {
                monotonic_ms: 2,
                boot_epoch: 7,
                wall_ms: Some(1_001),
                trust: ClockTrust::Unknown("TrustLost"),
                uncertainty_ms: Some(7),
                source_revision: Some("opaque/revision"),
            })
            .unwrap();
        assert_eq!(lost.disposition, ClockDisposition::ClockUnknown);
        assert_eq!(lost.previous_effective_wall_ms, Some(1_000));
        assert_eq!(lost.current_effective_wall_ms, None);
        assert_eq!(lost.previous_trusted_high_water_ms, Some(1_000));
        assert_eq!(lost.trusted_high_water_ms, Some(1_000));
        assert_eq!(lost.unknown_reason, Some("TrustLost"));
        assert_eq!(lost.uncertainty_ms, Some(7));
        assert_eq!(lost.source_revision, Some("opaque/revision"));

        let recovered = gate.poll(trusted(3, 5_000)).unwrap();
        assert_eq!(recovered.disposition, ClockDisposition::RecoveryBaseline);
        assert_eq!(recovered.previous_effective_wall_ms, None);
        assert_eq!(recovered.previous_trusted_high_water_ms, Some(1_000));
        assert_eq!(recovered.trusted_high_water_ms, Some(5_000));
    }

    #[test]
    fn trusted_missing_wall_is_unknown_without_fabricated_uncertainty() {
        let mut gate = ScheduleClockGate::new(100, 7).unwrap();
        let observed = gate
            .poll(ClockSnapshot {
                monotonic_ms: 0,
                boot_epoch: 7,
                wall_ms: None,
                trust: ClockTrust::Trusted,
                uncertainty_ms: None,
                source_revision: None,
            })
            .unwrap();
        assert_eq!(observed.disposition, ClockDisposition::ClockUnknown);
        assert_eq!(observed.unknown_reason, Some("MissingWallTime"));
        assert_eq!(observed.uncertainty_ms, None);
        assert_eq!(observed.trusted_high_water_ms, None);
    }

    #[test]
    fn accepted_numeric_endpoints_and_identical_observations_are_stable() {
        assert!(ScheduleClockGate::new(1, 0).is_ok());
        let mut gate = ScheduleClockGate::new(MAX_EXACT_TIME, MAX_EXACT_TIME).unwrap();
        let endpoint = ClockSnapshot {
            monotonic_ms: MAX_EXACT_TIME,
            boot_epoch: MAX_EXACT_TIME,
            wall_ms: Some(MAX_WALL_MS),
            trust: ClockTrust::Trusted,
            uncertainty_ms: Some(MAX_EXACT_TIME),
            source_revision: Some("endpoint"),
        };
        assert_eq!(
            gate.poll(endpoint).unwrap().disposition,
            ClockDisposition::BootBaseline
        );

        let before_repeat = gate.clone();
        let repeated = gate.poll(endpoint).unwrap();
        assert_eq!(repeated.disposition, ClockDisposition::Observed);
        assert_eq!(repeated.previous_effective_wall_ms, Some(MAX_WALL_MS));
        assert_eq!(repeated.current_effective_wall_ms, Some(MAX_WALL_MS));
        assert_eq!(repeated.uncertainty_ms, Some(MAX_EXACT_TIME));
        assert_eq!(gate, before_repeat);

        let mut zero = ScheduleClockGate::new(1, 0).unwrap();
        let zero_observation = zero
            .poll(ClockSnapshot {
                monotonic_ms: 0,
                boot_epoch: 0,
                wall_ms: Some(0),
                trust: ClockTrust::Trusted,
                uncertainty_ms: Some(0),
                source_revision: None,
            })
            .unwrap();
        assert_eq!(zero_observation.disposition, ClockDisposition::BootBaseline);
        assert_eq!(zero_observation.current_effective_wall_ms, Some(0));
        assert_eq!(zero_observation.uncertainty_ms, Some(0));
    }

    #[test]
    fn invalid_snapshots_are_atomic_and_a_cloned_stage_is_discardable() {
        assert_eq!(
            ScheduleClockGate::new(0, 7).unwrap_err().message(),
            "invalid schedule clock configuration"
        );
        assert_eq!(
            ScheduleClockGate::new(MAX_EXACT_TIME + 1, 7)
                .unwrap_err()
                .message(),
            "invalid schedule clock configuration"
        );
        assert_eq!(
            ScheduleClockGate::new(1, MAX_EXACT_TIME + 1)
                .unwrap_err()
                .message(),
            "invalid schedule clock configuration"
        );

        let mut gate = ScheduleClockGate::new(100, 7).unwrap();
        gate.poll(trusted(10, 1_000)).unwrap();
        let accepted = gate.clone();
        let invalid = [
            (
                ClockSnapshot {
                    monotonic_ms: 9,
                    ..trusted(9, 1_001)
                },
                "schedule monotonic clock moved backwards",
            ),
            (
                ClockSnapshot {
                    boot_epoch: 8,
                    ..trusted(11, 1_001)
                },
                "schedule clock boot epoch mismatch",
            ),
            (
                ClockSnapshot {
                    boot_epoch: MAX_EXACT_TIME + 1,
                    ..trusted(11, 1_001)
                },
                "schedule clock boot epoch mismatch",
            ),
            (
                ClockSnapshot {
                    monotonic_ms: MAX_EXACT_TIME + 1,
                    ..trusted(11, 1_001)
                },
                "schedule clock value is out of range",
            ),
            (
                ClockSnapshot {
                    wall_ms: Some(MAX_WALL_MS + 1),
                    ..trusted(11, 1_001)
                },
                "schedule clock value is out of range",
            ),
            (
                ClockSnapshot {
                    uncertainty_ms: Some(MAX_EXACT_TIME + 1),
                    ..trusted(11, 1_001)
                },
                "schedule clock value is out of range",
            ),
        ];
        for (snapshot, message) in invalid {
            assert_eq!(gate.poll(snapshot).unwrap_err().message(), message);
            assert_eq!(gate, accepted);
        }

        let mut staged = gate.clone();
        let staged_observation = staged.poll(trusted(11, 1_001)).unwrap();
        assert_eq!(staged_observation.disposition, ClockDisposition::Observed);
        assert_eq!(gate, accepted);
        let retried_observation = gate.poll(trusted(11, 1_001)).unwrap();
        assert_eq!(retried_observation, staged_observation);
        assert_eq!(gate, staged);
    }
}
