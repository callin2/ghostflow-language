//! Bounded WorkCalendar snapshot evaluation for a scheduled local date.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarFault {
    CalendarMissing,
    CalendarOutOfRange,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DayClass {
    Work,
    Off,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DaySelector {
    Workday,
    Offday,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DayException {
    pub date: i32,
    pub class: DayClass,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkCalendarSnapshot {
    pub calendar_id: String,
    pub revision: String,
    pub timezone: String,
    pub covered_from_date: i32,
    pub covered_to_date_exclusive: i32,
    pub expires_at_ms: u64,
    /// Bit zero is Sunday, bit six is Saturday.
    pub weekly_work_mask: u8,
    pub holiday_policy: DayClass,
    pub holidays: Vec<i32>,
    pub exceptions: Vec<DayException>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DayQuery<'a> {
    pub calendar_id: &'a str,
    pub timezone: &'a str,
    pub date: i32,
    pub selector: DaySelector,
    pub now_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DayResult<'a> {
    pub value: Result<bool, CalendarFault>,
    pub revision: Option<&'a str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarInputError {
    InvalidSnapshot,
    BindingMismatch,
}

pub fn evaluate<'a>(
    query: DayQuery<'a>,
    snapshot: Option<&'a WorkCalendarSnapshot>,
) -> Result<DayResult<'a>, CalendarInputError> {
    let Some(snapshot) = snapshot else {
        return Ok(DayResult {
            value: Err(CalendarFault::CalendarMissing),
            revision: None,
        });
    };
    if snapshot.calendar_id != query.calendar_id || snapshot.timezone != query.timezone {
        return Err(CalendarInputError::BindingMismatch);
    }
    if snapshot.calendar_id.is_empty()
        || snapshot.timezone.is_empty()
        || snapshot.revision.is_empty()
        || snapshot.covered_from_date < 0
        || snapshot.covered_to_date_exclusive > 2_932_897
        || snapshot.covered_from_date >= snapshot.covered_to_date_exclusive
        || snapshot.weekly_work_mask & 0x80 != 0
        || snapshot.holidays.len() > 4096
        || snapshot.exceptions.len() > 4096
        || snapshot.holidays.iter().any(|day| {
            *day < snapshot.covered_from_date || *day >= snapshot.covered_to_date_exclusive
        })
        || snapshot.exceptions.iter().any(|entry| {
            entry.date < snapshot.covered_from_date
                || entry.date >= snapshot.covered_to_date_exclusive
        })
        || snapshot.holidays.windows(2).any(|pair| pair[0] >= pair[1])
        || snapshot
            .exceptions
            .windows(2)
            .any(|pair| pair[0].date >= pair[1].date)
    {
        return Err(CalendarInputError::InvalidSnapshot);
    }
    let revision = Some(snapshot.revision.as_str());
    if query.date < snapshot.covered_from_date
        || query.date >= snapshot.covered_to_date_exclusive
        || query.now_ms >= snapshot.expires_at_ms
    {
        return Ok(DayResult {
            value: Err(CalendarFault::CalendarOutOfRange),
            revision,
        });
    }
    let class = if let Ok(index) = snapshot
        .exceptions
        .binary_search_by_key(&query.date, |entry| entry.date)
    {
        snapshot.exceptions[index].class
    } else if snapshot.holidays.binary_search(&query.date).is_ok() {
        snapshot.holiday_policy
    } else {
        // 1970-01-01 was Thursday; Sunday is weekday zero.
        let weekday = ((query.date + 4) % 7) as u8;
        if snapshot.weekly_work_mask & (1 << weekday) != 0 {
            DayClass::Work
        } else {
            DayClass::Off
        }
    };
    Ok(DayResult {
        value: Ok(matches!(
            (query.selector, class),
            (DaySelector::Workday, DayClass::Work) | (DaySelector::Offday, DayClass::Off)
        )),
        revision,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> WorkCalendarSnapshot {
        WorkCalendarSnapshot {
            calendar_id: "workers".into(),
            revision: "r2".into(),
            timezone: "Asia/Seoul".into(),
            covered_from_date: 0,
            covered_to_date_exclusive: 7,
            expires_at_ms: 1_000,
            weekly_work_mask: 0b0111110,
            holiday_policy: DayClass::Off,
            holidays: vec![1],
            exceptions: vec![DayException {
                date: 1,
                class: DayClass::Work,
            }],
        }
    }
    fn query(date: i32, selector: DaySelector) -> DayQuery<'static> {
        DayQuery {
            calendar_id: "workers",
            timezone: "Asia/Seoul",
            date,
            selector,
            now_ms: 500,
        }
    }

    #[test]
    fn exception_precedes_holiday_and_weekly_pattern() {
        let calendar = snapshot();
        assert_eq!(
            evaluate(query(1, DaySelector::Workday), Some(&calendar))
                .unwrap()
                .value,
            Ok(true)
        );
        assert_eq!(
            evaluate(query(2, DaySelector::Workday), Some(&calendar))
                .unwrap()
                .value,
            Ok(false)
        );
        assert_eq!(
            evaluate(query(4, DaySelector::Workday), Some(&calendar))
                .unwrap()
                .value,
            Ok(true)
        );
    }

    #[test]
    fn missing_expired_and_out_of_coverage_are_unknown() {
        let calendar = snapshot();
        assert_eq!(
            evaluate(query(1, DaySelector::Offday), None).unwrap().value,
            Err(CalendarFault::CalendarMissing)
        );
        assert_eq!(
            evaluate(query(7, DaySelector::Offday), Some(&calendar))
                .unwrap()
                .value,
            Err(CalendarFault::CalendarOutOfRange)
        );
        let mut q = query(1, DaySelector::Offday);
        q.now_ms = 1_000;
        assert_eq!(
            evaluate(q, Some(&calendar)).unwrap().value,
            Err(CalendarFault::CalendarOutOfRange)
        );
    }

    #[test]
    fn malformed_exception_order_and_binding_reject() {
        let mut calendar = snapshot();
        calendar.exceptions.push(DayException {
            date: 1,
            class: DayClass::Off,
        });
        assert_eq!(
            evaluate(query(1, DaySelector::Offday), Some(&calendar)),
            Err(CalendarInputError::InvalidSnapshot)
        );
        calendar.exceptions.pop();
        let mut q = query(1, DaySelector::Workday);
        q.timezone = "UTC";
        assert_eq!(
            evaluate(q, Some(&calendar)),
            Err(CalendarInputError::BindingMismatch)
        );
    }
}
