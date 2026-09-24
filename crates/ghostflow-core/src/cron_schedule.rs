//! Cron source-slot validation. DST resolution changes the planned instant,
//! not the civil fields that identify the source occurrence.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CronFields {
    pub minutes: u64,
    pub hours: u32,
    pub days_of_month: u32,
    pub months: u16,
    pub days_of_week: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CivilSlot {
    pub source_day: i32,
    pub minute_of_day: u16,
    /// 0 means an unambiguous time. 1 and 2 identify repeated folds.
    pub fold: u8,
    pub scheduled_wall_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RepeatedPolicy {
    First,
    Second,
    Both,
    Skip,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CronError {
    InvalidDescriptor,
    InvalidSourceSlot,
    FieldMismatch,
    FoldMismatch,
}

impl CronFields {
    pub fn from_values(fields: &[Vec<u8>; 5]) -> Result<Self, CronError> {
        let mut masks = [0u64; 5];
        for (index, values) in fields.iter().enumerate() {
            let (low, high) = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)][index];
            if values.is_empty()
                || values.len() > 60
                || values.windows(2).any(|pair| pair[0] >= pair[1])
                || values.iter().any(|value| *value < low || *value > high)
            {
                return Err(CronError::InvalidDescriptor);
            }
            for value in values {
                masks[index] |= 1u64 << value;
            }
        }
        let result = Self {
            minutes: masks[0],
            hours: masks[1] as u32,
            days_of_month: masks[2] as u32,
            months: masks[3] as u16,
            days_of_week: masks[4] as u8,
        };
        result.validate()?;
        Ok(result)
    }

    pub fn validate(self) -> Result<(), CronError> {
        if self.minutes == 0
            || self.minutes >> 60 != 0
            || self.hours == 0
            || self.hours >> 24 != 0
            || self.days_of_month & !0xffff_fffe != 0
            || self.days_of_month == 0
            || self.months & !0x1ffe != 0
            || self.months == 0
            || self.days_of_week == 0
            || self.days_of_week & !0x7f != 0
        {
            return Err(CronError::InvalidDescriptor);
        }
        Ok(())
    }

    pub fn validate_source(
        self,
        slot: CivilSlot,
        repeated: RepeatedPolicy,
    ) -> Result<(), CronError> {
        self.validate()?;
        if !(0..=2_932_896).contains(&slot.source_day)
            || slot.minute_of_day >= 1440
            || slot.fold > 2
            || slot.scheduled_wall_ms > 253_402_300_799_999
        {
            return Err(CronError::InvalidSourceSlot);
        }
        let minute = slot.minute_of_day % 60;
        let hour = slot.minute_of_day / 60;
        let (year, month, day) = civil_from_days(slot.source_day as i64);
        if !(1970..=9999).contains(&year)
            || self.minutes & (1 << minute) == 0
            || self.hours & (1 << hour) == 0
            || self.days_of_month & (1 << day) == 0
            || self.months & (1 << month) == 0
            || self.days_of_week & (1 << ((slot.source_day + 4) % 7)) == 0
        {
            return Err(CronError::FieldMismatch);
        }
        if match repeated {
            RepeatedPolicy::First => slot.fold == 2,
            RepeatedPolicy::Second => slot.fold == 1,
            RepeatedPolicy::Both => false,
            RepeatedPolicy::Skip => slot.fold != 0,
        } {
            return Err(CronError::FoldMismatch);
        }
        Ok(())
    }
}

fn civil_from_days(days: i64) -> (i32, u8, u8) {
    // Public-domain algorithm by Howard Hinnant; Unix day zero is 1970-01-01.
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    (
        (year + i64::from(month <= 2)) as i32,
        month as u8,
        day as u8,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn weekdays_at_six() -> CronFields {
        CronFields {
            minutes: 1,
            hours: 1 << 6,
            days_of_month: 0xffff_fffe,
            months: 0x1ffe,
            days_of_week: 0b0111110,
        }
    }
    #[test]
    fn source_civil_slot_matches_weekday_even_when_resolved_instant_moves() {
        // 1970-01-05 was Monday. The provider may move a next_valid source slot.
        let source = CivilSlot {
            source_day: 4,
            minute_of_day: 360,
            fold: 0,
            scheduled_wall_ms: 4 * 86_400_000 + 7 * 3_600_000,
        };
        assert_eq!(
            weekdays_at_six().validate_source(source, RepeatedPolicy::First),
            Ok(())
        );
        assert_eq!(
            weekdays_at_six().validate_source(
                CivilSlot {
                    source_day: 2,
                    ..source
                },
                RepeatedPolicy::First
            ),
            Err(CronError::FieldMismatch)
        );
    }
    #[test]
    fn fold_policy_and_source_minute_are_strict() {
        let slot = CivilSlot {
            source_day: 4,
            minute_of_day: 360,
            fold: 2,
            scheduled_wall_ms: 1,
        };
        assert_eq!(
            weekdays_at_six().validate_source(slot, RepeatedPolicy::First),
            Err(CronError::FoldMismatch)
        );
        assert_eq!(
            weekdays_at_six().validate_source(slot, RepeatedPolicy::Both),
            Ok(())
        );
        assert_eq!(
            weekdays_at_six().validate_source(
                CivilSlot {
                    minute_of_day: 361,
                    ..slot
                },
                RepeatedPolicy::Both
            ),
            Err(CronError::FieldMismatch)
        );
    }
}
