use super::*;
use context_vm::*;
use schedule_clock::{ClockSnapshot, ClockTrust};
use schedule_vm::{PulseDescriptor, ScheduleRequirements, ScheduleStrategy};

fn calendar18_program(with_range: bool) -> Module {
    let descriptor = PulseDescriptor::Calendar(CalendarDescriptor {
        site: 7,
        name: "working".into(),
        calendar: "workers".into(),
        selector: work_calendar::DaySelector::Workday,
        timezone: "UTC".into(),
        ok_input: 2,
        value_input: 3,
        fault_input: 4,
    });
    let mut program = module(descriptor, true);
    program.format_version = 18;
    for (index, suffix) in [(2, "ok"), (3, "value"), (4, "fault")] {
        program.inputs[index].name = format!("__gf_calendar_7_{suffix}");
    }
    program.strategies[0].intents = vec![
        Intent {
            name: "ok".into(),
            value_type: Type::Bool,
            expression: vec![3, 2, 0],
        },
        Intent {
            name: "value".into(),
            value_type: Type::Bool,
            expression: vec![3, 3, 0],
        },
        Intent {
            name: "fault".into(),
            value_type: Type::Number,
            expression: vec![3, 4, 0],
        },
    ];
    if with_range {
        let schedules = &mut program.schedules.as_mut().unwrap().strategies[0];
        schedules
            .schedules
            .push(PulseDescriptor::Context(ScheduleDescriptor {
                clock_hold_ms: None,
                site: 8,
                name: "work-range".into(),
                gap_ms: 1_000,
                definition: ScheduleDefinition::CalendarRange {
                    timezone: "UTC".into(),
                    starts_ms: vec![100],
                    duration_ms: 200,
                    calendar: "workers".into(),
                    offday: false,
                },
                when: vec![1, 1],
                cancel: vec![1, 0],
            }));
        schedules
            .prelude
            .push(schedule_vm::PreludeEntry::Schedule(1));
        program.strategies[0].intents.push(Intent {
            name: "active".into(),
            value_type: Type::Bool,
            expression: vec![58, 1, 0, 2],
        });
    }
    program
}

fn calendar18_activation(epoch: u64) -> context_runtime::Activation {
    let mut activation = calendar_activation(epoch, 8);
    activation.bindings[0].timezone = "UTC".into();
    activation
}

fn calendar18_snapshot() -> work_calendar::WorkCalendarSnapshot {
    let mut snapshot = calendar_snapshot("r1");
    snapshot.timezone = "UTC".into();
    snapshot.expires_at_ms = 86_400_000 * 7;
    snapshot.covered_to_date_exclusive = 7;
    snapshot
}

fn calendar18_facts(
    with_range: bool,
    snapshot: Option<work_calendar::WorkCalendarSnapshot>,
) -> context_runtime::Facts {
    let mut facts = calendar_facts(snapshot);
    if !with_range {
        facts.schedules.pop();
    }
    for evidence in &mut facts.schedules {
        evidence.coverage_end_ms = 86_400_000 * 7;
    }
    facts
}

fn calendar18_runtime(with_range: bool, epoch: u64) -> Runtime {
    let mut runtime = Runtime::new(8);
    runtime.install(calendar18_program(with_range), false);
    runtime
        .activate_with_context(&calendar18_activation(epoch))
        .unwrap();
    runtime
}

#[test]
fn calendar18_result_uses_current_trusted_day_and_preserves_fault_codes() {
    let mut runtime = calendar18_runtime(false, 1);
    let snapshot = calendar18_snapshot();
    // Thursday is work, explicit Friday holiday is off, Sunday is off,
    // Monday is work. Date is derived in Rust, not supplied as a host Boolean.
    for (mono, day, expected) in [(0, 0, true), (1, 1, false), (2, 3, false), (3, 4, true)] {
        inputs(&mut runtime, 1, mono, None);
        let row = runtime
            .tick_with_context(
                clock(1, mono, day * 86_400_000),
                &calendar18_facts(false, Some(snapshot.clone())),
            )
            .unwrap();
        assert_eq!(row.requested_intents["ok"], Value::Bool(true));
        assert_eq!(row.requested_intents["value"], Value::Bool(expected));
        assert_eq!(row.requested_intents["fault"], Value::Number(0.0));
    }
    for (mono, wall, data, trust, expected) in [
        (4, 0, None, ClockTrust::Trusted, 1),
        (
            5,
            7 * 86_400_000,
            Some(snapshot.clone()),
            ClockTrust::Trusted,
            2,
        ),
        (
            6,
            0,
            Some({
                let mut expired = snapshot.clone();
                expired.expires_at_ms = 0;
                expired
            }),
            ClockTrust::Trusted,
            2,
        ),
        (7, 0, Some(snapshot), ClockTrust::Unknown("lost"), 0),
    ] {
        // A distinct expired envelope needs its own revision.
        let data = data.map(|mut s| {
            if s.expires_at_ms == 0 {
                s.revision = "expired".into();
            }
            s
        });
        inputs(&mut runtime, 1, mono, None);
        let row = runtime
            .tick_with_context(
                ClockSnapshot {
                    trust,
                    ..clock(1, mono, wall)
                },
                &calendar18_facts(false, data),
            )
            .unwrap();
        assert_eq!(row.requested_intents["ok"], Value::Bool(false));
        assert_eq!(row.requested_intents["value"], Value::Bool(false));
        assert_eq!(
            row.requested_intents["fault"],
            Value::Number(expected as f64)
        );
    }
    for suffix in ["ok", "value", "fault"] {
        assert!(runtime
            .set_input(
                &format!("__gf_calendar_7_{suffix}"),
                if suffix == "fault" {
                    Value::Number(0.0)
                } else {
                    Value::Bool(true)
                }
            )
            .is_err());
    }
}

#[test]
fn calendar18_query_and_range_share_atomic_immutable_snapshot_and_checkpoint_history() {
    let mut runtime = calendar18_runtime(true, 1);
    let snapshot = calendar18_snapshot();
    let before = runtime.context_checkpoint().unwrap();
    for data in [
        None,
        Some({
            let mut s = snapshot.clone();
            s.revision = "r2".into();
            s
        }),
    ] {
        let mut facts = calendar18_facts(true, Some(snapshot.clone()));
        facts.schedules[1].calendar = data;
        inputs(&mut runtime, 1, 100, None);
        assert!(runtime
            .tick_with_context(clock(1, 100, 100), &facts)
            .is_err());
        assert_eq!(runtime.context_checkpoint().unwrap(), before);
        assert!(runtime.journal.is_empty());
    }
    let mut missing = calendar18_facts(true, Some(snapshot.clone()));
    missing.schedules.remove(0);
    inputs(&mut runtime, 1, 100, None);
    assert!(runtime
        .tick_with_context(clock(1, 100, 100), &missing)
        .is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), before);
    inputs(&mut runtime, 1, 0, None);
    runtime
        .tick_with_context(
            clock(1, 0, 100),
            &calendar18_facts(true, Some(snapshot.clone())),
        )
        .unwrap();
    let checkpoint = runtime.context_checkpoint().unwrap();
    let mut reboot = calendar18_runtime(true, 2);
    reboot.restore_context_checkpoint(&checkpoint).unwrap();
    let mut changed = snapshot;
    changed.weekly_work_mask = 0;
    inputs(&mut reboot, 2, 0, None);
    assert!(reboot
        .tick_with_context(clock(2, 0, 100), &calendar18_facts(true, Some(changed)))
        .is_err());
    assert_eq!(reboot.context_checkpoint().unwrap(), checkpoint);
}

#[test]
fn calendar18_range_missing_or_offday_denies_admission_but_active_deadline_is_monotonic() {
    let mut runtime = calendar18_runtime(true, 1);
    inputs(&mut runtime, 1, 0, None);
    let row = runtime
        .tick_with_context(clock(1, 0, 100), &calendar18_facts(true, None))
        .unwrap();
    assert_eq!(row.requested_intents["active"], Value::Bool(false));
    assert!(row
        .context_trace
        .iter()
        .any(|o| o.site == 8 && o.decision == "Unknown(CalendarMissing)"));
    inputs(&mut runtime, 1, 1, None);
    let row = runtime
        .tick_with_context(
            clock(1, 1, 101),
            &calendar18_facts(true, Some(calendar18_snapshot())),
        )
        .unwrap();
    assert_eq!(row.requested_intents["active"], Value::Bool(true));
    assert!(row
        .context_trace
        .iter()
        .any(|o| o.site == 8 && o.decision == "Due" && o.provider_revision == "r1"));
    // A new off-day revision does not reclassify the admitted occurrence.
    let mut off_revision = calendar18_snapshot();
    off_revision.revision = "off-revision".into();
    off_revision.weekly_work_mask = 0;
    inputs(&mut runtime, 1, 2, None);
    let row = runtime
        .tick_with_context(
            clock(1, 2, 102),
            &calendar18_facts(true, Some(off_revision)),
        )
        .unwrap();
    assert_eq!(row.requested_intents["value"], Value::Bool(false));
    assert_eq!(row.requested_intents["active"], Value::Bool(true));
    assert!(row
        .context_trace
        .iter()
        .any(|o| o.site == 8 && o.provider_revision == "r1"));
    // Loss of calendar and a wall correction do not retime or cancel admission.
    inputs(&mut runtime, 1, 199, None);
    let row = runtime
        .tick_with_context(clock(1, 199, 86_400_100), &calendar18_facts(true, None))
        .unwrap();
    assert_eq!(row.requested_intents["active"], Value::Bool(true));
    assert!(row
        .context_trace
        .iter()
        .any(|o| o.site == 8 && o.provider_revision == "r1"));
    inputs(&mut runtime, 1, 200, None);
    let row = runtime
        .tick_with_context(clock(1, 200, 86_400_100), &calendar18_facts(true, None))
        .unwrap();
    assert_eq!(row.requested_intents["active"], Value::Bool(false));
    let mut off_runtime = calendar18_runtime(true, 1);
    inputs(&mut off_runtime, 1, 0, None);
    let row = off_runtime
        .tick_with_context(
            clock(1, 0, 86_400_100),
            &calendar18_facts(true, Some(calendar18_snapshot())),
        )
        .unwrap();
    assert_eq!(row.requested_intents["active"], Value::Bool(false));
    assert!(row
        .context_trace
        .iter()
        .any(|o| o.site == 8 && o.decision == "ExcludedDay"));
}

#[test]
fn calendar18_query_revision_capacity_rejects_without_committing_clock_or_history() {
    let mut runtime = calendar18_runtime(false, 1);
    // Activation's capacity of eight bounds retained calendar revisions too.
    for mono in 0..8 {
        let mut snapshot = calendar18_snapshot();
        snapshot.revision = format!("revision-{mono}");
        inputs(&mut runtime, 1, mono, None);
        runtime
            .tick_with_context(clock(1, mono, 0), &calendar18_facts(false, Some(snapshot)))
            .unwrap();
    }
    let checkpoint = runtime.context_checkpoint().unwrap();
    let mut excess = calendar18_snapshot();
    excess.revision = "revision-over-capacity".into();
    inputs(&mut runtime, 1, 10, None);
    assert!(runtime
        .tick_with_context(clock(1, 10, 0), &calendar18_facts(false, Some(excess)))
        .is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), checkpoint);
    // Reuse the same immutable envelope at an earlier accepted monotonic tick.
    let mut known = calendar18_snapshot();
    known.revision = "revision-0".into();
    inputs(&mut runtime, 1, 8, None);
    runtime
        .tick_with_context(clock(1, 8, 0), &calendar18_facts(false, Some(known)))
        .unwrap();
}

#[test]
fn calendar18_framed_scan_derives_clock_and_results_rejecting_caller_projections_atomically() {
    let mut program = calendar18_program(true);
    program.inputs.push(field("permit", Value::Bool(true)));
    let mut runtime = Runtime::new(8);
    runtime.install(program, false);
    runtime
        .activate_with_context(&calendar18_activation(1))
        .unwrap();
    let mut driver = runtime.into_scan_driver();
    let pristine = driver.runtime().context_checkpoint().unwrap();
    let frame = scan::ScanFrameV1 {
        scan_id: 0,
        logical_time_ms: 0,
        inputs: vec![scan::ScanInput {
            name: "permit".into(),
            value: Value::Bool(true),
        }],
    };
    let facts = calendar18_facts(true, Some(calendar18_snapshot()));
    for (name, value) in [
        ("__gf_time_epoch", Value::Number(1.0)),
        ("__gf_calendar_7_ok", Value::Bool(true)),
        ("__gf_calendar_7_value", Value::Bool(true)),
        ("__gf_calendar_7_fault", Value::Number(0.0)),
    ] {
        let mut forged = frame.clone();
        forged.inputs[0] = scan::ScanInput {
            name: name.into(),
            value,
        };
        assert_eq!(
            driver
                .scan_with_context(forged, clock(1, 0, 100), &facts)
                .unwrap_err()
                .to_string(),
            "reserved input is runtime-derived"
        );
        assert_eq!(driver.runtime().context_checkpoint().unwrap(), pristine);
        assert_eq!(driver.next_scan_id(), Some(0));
    }
    assert!(driver
        .scan_with_context(frame.clone(), clock(1, 0, 100), &Default::default())
        .is_err());
    assert_eq!(driver.runtime().context_checkpoint().unwrap(), pristine);
    let outcome = driver
        .scan_with_context(frame, clock(1, 0, 100), &facts)
        .unwrap();
    assert_eq!(outcome.trace.inputs["__gf_time_epoch"], Value::Number(1.0));
    assert_eq!(
        outcome.trace.inputs["__gf_calendar_7_ok"],
        Value::Bool(true)
    );
    assert_eq!(
        outcome.trace.inputs["__gf_calendar_7_value"],
        Value::Bool(true)
    );
    assert_eq!(outcome.trace.safe_intents["active"], Value::Bool(true));
    assert_eq!(driver.next_scan_id(), Some(1));
}

fn calendar_program() -> Module {
    let descriptor = |site| {
        PulseDescriptor::Context(ScheduleDescriptor {
            clock_hold_ms: None,
            site,
            name: format!("calendar-{site}"),
            gap_ms: 60,
            definition: ScheduleDefinition::CalendarDaily {
                timezone: "Asia/Seoul".into(),
                at_ms: 0,
                calendar: "workers".into(),
                offday: false,
                dst_missing: 0,
                dst_repeated: 0,
            },
            when: vec![1, 1],
            cancel: vec![1, 0],
        })
    };
    let mut program = module(descriptor(7), false);
    let schedules = &mut program.schedules.as_mut().unwrap().strategies[0];
    schedules.schedules.push(descriptor(8));
    schedules
        .prelude
        .push(schedule_vm::PreludeEntry::Schedule(1));
    program
}
fn calendar_activation(epoch: u64, capacity: usize) -> context_runtime::Activation {
    context_runtime::Activation {
        boot_epoch: epoch,
        terminal_capacity: capacity,
        bindings: vec![ProviderBinding {
            provider: "workers".into(),
            kind: 2,
            namespace: "calendar".into(),
            station: "farm".into(),
            binding_revision: "installation-1".into(),
            location: "farm".into(),
            timezone: "Asia/Seoul".into(),
            criteria: "reviewed".into(),
            max_uncertainty_ms: 0,
        }],
    }
}
fn calendar_snapshot(revision: &str) -> work_calendar::WorkCalendarSnapshot {
    work_calendar::WorkCalendarSnapshot {
        calendar_id: "workers".into(),
        revision: revision.into(),
        timezone: "Asia/Seoul".into(),
        covered_from_date: 0,
        covered_to_date_exclusive: 20_000,
        expires_at_ms: 100_000,
        weekly_work_mask: 0b0111110,
        holiday_policy: work_calendar::DayClass::Off,
        holidays: vec![1],
        exceptions: vec![],
    }
}
fn calendar_facts(snapshot: Option<work_calendar::WorkCalendarSnapshot>) -> context_runtime::Facts {
    context_runtime::Facts {
        schedules: [7, 8]
            .into_iter()
            .map(|site| ScheduleEvidence {
                site,
                coverage_start_ms: 0,
                coverage_end_ms: 100_000,
                provider: None,
                calendar: snapshot.clone(),
                rows: vec![],
            })
            .collect(),
        ..Default::default()
    }
}
fn calendar_runtime(epoch: u64, capacity: usize) -> Runtime {
    let mut runtime = Runtime::new(8);
    runtime.install(calendar_program(), false);
    runtime
        .activate_with_context(&calendar_activation(epoch, capacity))
        .unwrap();
    runtime
}

#[test]
fn calendar_same_scan_rejects_presence_revision_and_content_disagreement_atomically() {
    let mut runtime = calendar_runtime(1, 8);
    let pristine = runtime.context_checkpoint().unwrap();
    for other in [
        None,
        Some(calendar_snapshot("r2")),
        Some({
            let mut changed = calendar_snapshot("r1");
            changed.holidays = vec![2];
            changed
        }),
    ] {
        let mut facts = calendar_facts(Some(calendar_snapshot("r1")));
        facts.schedules[1].calendar = other;
        inputs(&mut runtime, 1, 10, Some(1));
        assert!(runtime
            .tick_with_context(clock(1, 10, 10), &facts)
            .unwrap_err()
            .to_string()
            .contains("inconsistent shared calendar snapshot"));
        assert_eq!(runtime.context_checkpoint().unwrap(), pristine);
        assert_eq!(runtime.state("counter"), Some(Value::Int(10)));
        assert!(runtime.safe_intents.is_empty());
        assert!(runtime.journal.is_empty());
    }
    // A rejected future clock was not committed: an earlier valid scan succeeds.
    inputs(&mut runtime, 1, 0, Some(2));
    runtime
        .tick_with_context(clock(1, 0, 0), &calendar_facts(None))
        .unwrap();
    assert_eq!(runtime.state("counter"), Some(Value::Int(5)));
}

#[test]
fn holiday_and_workday_sites_share_one_calendar_envelope() {
    let mut program = calendar_program();
    let PulseDescriptor::Context(descriptor) =
        &mut program.schedules.as_mut().unwrap().strategies[0].schedules[1]
    else {
        unreachable!()
    };
    descriptor.definition = ScheduleDefinition::HolidayDaily {
        timezone: "Asia/Seoul".into(),
        at_ms: 0,
        calendar: "workers".into(),
        dst_missing: 0,
        dst_repeated: 0,
    };
    program.format_version = 15;
    let mut runtime = Runtime::new(8);
    runtime.install(program, false);
    runtime
        .activate_with_context(&calendar_activation(1, 8))
        .unwrap();
    let before = runtime.context_checkpoint().unwrap();
    let mut facts = calendar_facts(Some(calendar_snapshot("r1")));
    facts.schedules[1].calendar = None;
    inputs(&mut runtime, 1, 0, Some(1));
    assert!(runtime
        .tick_with_context(clock(1, 0, 0), &facts)
        .unwrap_err()
        .to_string()
        .contains("inconsistent shared calendar snapshot"));
    assert_eq!(runtime.context_checkpoint().unwrap(), before);
    inputs(&mut runtime, 1, 0, Some(1));
    runtime
        .tick_with_context(
            clock(1, 0, 0),
            &calendar_facts(Some(calendar_snapshot("r1"))),
        )
        .unwrap();
}

#[test]
fn calendar_revisions_are_immutable_across_ticks_and_checkpoint_restore() {
    let mut runtime = calendar_runtime(1, 8);
    for (mono, revision) in [(0, "r1"), (1, "r2")] {
        inputs(&mut runtime, 1, mono, Some(1));
        runtime
            .tick_with_context(
                clock(1, mono, mono),
                &calendar_facts(Some(calendar_snapshot(revision))),
            )
            .unwrap();
    }
    let checkpoint = runtime.context_checkpoint().unwrap();
    assert_eq!(&checkpoint[..6], b"GFCX\x04\x00");
    let mut reboot = calendar_runtime(2, 8);
    reboot.restore_context_checkpoint(&checkpoint).unwrap();
    assert_eq!(reboot.context_checkpoint().unwrap(), checkpoint);
    for (runtime, epoch) in [(&mut runtime, 1), (&mut reboot, 2)] {
        let mut changed = calendar_snapshot("r1");
        changed.weekly_work_mask = 0;
        inputs(runtime, epoch, 5, Some(1));
        assert!(runtime
            .tick_with_context(clock(epoch, 5, 5), &calendar_facts(Some(changed)))
            .unwrap_err()
            .to_string()
            .contains("calendar revision contents changed"));
        assert_eq!(runtime.context_checkpoint().unwrap(), checkpoint);
        inputs(runtime, epoch, 5, Some(1));
        runtime
            .tick_with_context(
                clock(epoch, 5, 5),
                &calendar_facts(Some(calendar_snapshot("r1"))),
            )
            .unwrap();
    }
}

#[test]
fn calendar_rejected_tick_does_not_poison_revision_and_capacity_fails_closed() {
    let mut runtime = calendar_runtime(1, 1);
    let before = runtime.context_checkpoint().unwrap();
    inputs(&mut runtime, 1, 0, Some(0));
    assert!(runtime
        .tick_with_context(
            clock(1, 0, 0),
            &calendar_facts(Some(calendar_snapshot("r1")))
        )
        .is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), before);
    let mut changed = calendar_snapshot("r1");
    changed.holidays = vec![2];
    inputs(&mut runtime, 1, 0, Some(1));
    runtime
        .tick_with_context(clock(1, 0, 0), &calendar_facts(Some(changed)))
        .unwrap();
    let committed = runtime.context_checkpoint().unwrap();
    inputs(&mut runtime, 1, 1, Some(1));
    assert!(runtime
        .tick_with_context(
            clock(1, 1, 1),
            &calendar_facts(Some(calendar_snapshot("r2")))
        )
        .unwrap_err()
        .to_string()
        .contains("calendar revision capacity exceeded"));
    assert_eq!(runtime.context_checkpoint().unwrap(), committed);
}

#[test]
fn calendar_history_entry_and_aggregate_cell_limits_are_bounded() {
    let mut runtime = calendar_runtime(1, 256);
    for mono in 0..128 {
        inputs(&mut runtime, 1, mono, Some(1));
        runtime
            .tick_with_context(
                clock(1, mono, mono),
                &calendar_facts(Some(calendar_snapshot(&format!("r{mono:03}")))),
            )
            .unwrap();
    }
    let before = runtime.context_checkpoint().unwrap();
    inputs(&mut runtime, 1, 128, Some(1));
    assert!(runtime
        .tick_with_context(
            clock(1, 128, 128),
            &calendar_facts(Some(calendar_snapshot("overflow")))
        )
        .unwrap_err()
        .to_string()
        .contains("calendar revision capacity exceeded"));
    assert_eq!(runtime.context_checkpoint().unwrap(), before);

    let mut runtime = calendar_runtime(1, 8);
    let mut full = calendar_snapshot("full");
    full.holidays = (0..4096).collect();
    full.exceptions = (0..4096)
        .map(|date| work_calendar::DayException {
            date,
            class: work_calendar::DayClass::Work,
        })
        .collect();
    inputs(&mut runtime, 1, 0, Some(1));
    runtime
        .tick_with_context(clock(1, 0, 0), &calendar_facts(Some(full.clone())))
        .unwrap();
    let checkpoint = runtime.context_checkpoint().unwrap();
    let mut reboot = calendar_runtime(2, 8);
    reboot.restore_context_checkpoint(&checkpoint).unwrap();
    inputs(&mut reboot, 2, 0, Some(1));
    // Reusing a retained snapshot costs no additional cells.
    reboot
        .tick_with_context(clock(2, 0, 0), &calendar_facts(Some(full)))
        .unwrap();
    inputs(&mut reboot, 2, 1, Some(1));
    assert!(reboot
        .tick_with_context(
            clock(2, 1, 1),
            &calendar_facts(Some(calendar_snapshot("extra")))
        )
        .unwrap_err()
        .to_string()
        .contains("calendar revision capacity exceeded"));
    assert_eq!(reboot.context_checkpoint().unwrap(), checkpoint);
}

fn checkpoint_checksum(bytes: &mut [u8]) {
    let length = bytes.len() - 4;
    let mut crc = !0u32;
    for byte in &bytes[..length] {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320u32 & 0u32.wrapping_sub(crc & 1));
        }
    }
    bytes[length..].copy_from_slice(&(!crc).to_le_bytes());
}

#[test]
fn calendar_checkpoint_rejects_old_version_invalid_bounds_and_duplicate_history() {
    let mut runtime = calendar_runtime(1, 8);
    inputs(&mut runtime, 1, 0, Some(1));
    runtime
        .tick_with_context(
            clock(1, 0, 0),
            &calendar_facts(Some(calendar_snapshot("r1"))),
        )
        .unwrap();
    let checkpoint = runtime.context_checkpoint().unwrap();
    let binding_length = u32::from_le_bytes(checkpoint[14..18].try_into().unwrap()) as usize;
    let count_offset = 18 + binding_length;
    let record_start = count_offset + 2;
    let mut fields = record_start;
    for _ in 0..3 {
        fields += 2 + usize::from(u16::from_le_bytes(
            checkpoint[fields..fields + 2].try_into().unwrap(),
        ));
    }
    // Three strings, date bounds, expiry, weekly mask, holiday class, holiday count/data, exceptions count.
    let record_end = fields + 8 + 8 + 2 + 2 + 4 + 2;
    let mut old = checkpoint.clone();
    old[4] = 2;
    let mut capacity = checkpoint.clone();
    capacity[count_offset..count_offset + 2].copy_from_slice(&129u16.to_le_bytes());
    let mut bad_class = checkpoint.clone();
    bad_class[fields + 17] = 2;
    let mut bad_date = checkpoint.clone();
    bad_date[fields..fields + 4].copy_from_slice(&(-1i32).to_le_bytes());
    let mut bad_holidays = checkpoint.clone();
    bad_holidays[fields + 18..fields + 20].copy_from_slice(&4097u16.to_le_bytes());
    let mut unbound = checkpoint.clone();
    unbound[record_start + 2] = b'X';
    let mut bad_text = checkpoint.clone();
    bad_text[record_start..record_start + 2].copy_from_slice(&129u16.to_le_bytes());
    let mut duplicate = checkpoint.clone();
    duplicate.splice(
        record_end..record_end,
        checkpoint[record_start..record_end].iter().copied(),
    );
    duplicate[count_offset..count_offset + 2].copy_from_slice(&2u16.to_le_bytes());
    for mut invalid in [
        old,
        capacity,
        bad_class,
        bad_date,
        bad_holidays,
        unbound,
        bad_text,
        duplicate,
    ] {
        checkpoint_checksum(&mut invalid);
        let mut reboot = calendar_runtime(2, 8);
        let pristine = reboot.context_checkpoint().unwrap();
        assert!(reboot.restore_context_checkpoint(&invalid).is_err());
        assert_eq!(reboot.context_checkpoint().unwrap(), pristine);
    }
}

fn field(name: &str, value: Value) -> Field {
    Field {
        name: name.into(),
        value_type: value.value_type(),
        default: value,
    }
}
fn clock(epoch: u64, mono: u64, wall: u64) -> ClockSnapshot<'static> {
    ClockSnapshot {
        boot_epoch: epoch,
        monotonic_ms: mono,
        wall_ms: Some(wall),
        uncertainty_ms: Some(0),
        trust: ClockTrust::Trusted,
        source_revision: Some("clock-1"),
    }
}
fn module(descriptor: PulseDescriptor, natural: bool) -> Module {
    let mut inputs = vec![
        field("__gf_now_ms", Value::Number(0.0)),
        field("__gf_time_epoch", Value::Number(0.0)),
    ];
    if natural {
        inputs.extend([
            field("__gf_natural_7_ok", Value::Bool(false)),
            field("__gf_natural_7_value", Value::Bool(false)),
            field("__gf_natural_7_fault", Value::Number(0.0)),
        ]);
    } else {
        inputs.push(field("rhs", Value::Int(1)));
    }
    Module {
        resource_policy: None,
        lifecycle: None,
        fingerprint: 85,
        format_version: 11,
        name: "context-transaction".into(),
        version: 1,
        inputs,
        states: if natural {
            vec![]
        } else {
            vec![field("counter", Value::Int(10))]
        },
        strategies: vec![Strategy {
            name: "control".into(),
            priority: 0,
            query: vec![5, 1],
            result_trace_bound: 0,
            transitions: if natural {
                vec![]
            } else {
                vec![Transition {
                    state_index: 0,
                    expression: vec![4, 0, 0, 3, 2, 0, 28],
                }]
            },
            intents: vec![Intent {
                name: "allowed".into(),
                value_type: Type::Bool,
                expression: if natural {
                    vec![3, 3, 0]
                } else {
                    vec![58, 0, 0, 0]
                },
            }],
        }],
        constraints: vec![],
        temporal: Some(temporal_vm::TemporalRequirements {
            now_input: 0,
            time_epoch_input: 1,
            roots: vec![],
            strategies: vec![temporal_vm::TemporalStrategy {
                name: "control".into(),
                windows: vec![],
            }],
        }),
        schedules: Some(ScheduleRequirements {
            strategies: vec![ScheduleStrategy {
                name: "control".into(),
                schedules: vec![descriptor],
                prelude: vec![schedule_vm::PreludeEntry::Schedule(0)],
            }],
        }),
        true_fors: None,
        objective: None,
    }
}
fn periodic() -> Module {
    let mut program = module(
        PulseDescriptor::Context(ScheduleDescriptor {
            clock_hold_ms: None,
            site: 7,
            name: "periodic".into(),
            gap_ms: 60,
            definition: ScheduleDefinition::Periodic {
                epoch_id: "instant:100".into(),
                anchor_ms: 100,
                every: DurationSetting {
                    id: 6,
                    name: "interval".into(),
                    operator_editable: true,
                    initial_ms: 10,
                    min_ms: 1,
                    max_ms: 1000,
                    step_ms: 1,
                },
            },
            when: vec![1, 1],
            cancel: vec![1, 0],
        }),
        false,
    );
    program.inputs.extend([
        field("__gf_config_6_ok", Value::Bool(true)),
        field("__gf_config_6_value", Value::Number(10.0)),
        field("__gf_config_6_fault", Value::Number(0.0)),
    ]);
    let strategy = &mut program.schedules.as_mut().unwrap().strategies[0];
    strategy
        .schedules
        .push(PulseDescriptor::Config(settings_stream::ConfigDescriptor {
            id: 6,
            name: "interval".into(),
            semantic_type: "Duration".into(),
            kind: 2,
            operator_editable: true,
            initial: settings_stream::ConfigValue::Scalar(Value::Number(10.0)),
            bounds: Some((
                Value::Number(1.0),
                Value::Number(1000.0),
                Value::Number(1.0),
            )),
            grid_ms: 0,
            capacity: 0,
            ok_input: 3,
            value_input: 4,
            fault_input: 5,
        }));
    strategy
        .prelude
        .push(schedule_vm::PreludeEntry::Schedule(1));
    program
}
fn inputs(runtime: &mut Runtime, epoch: u64, mono: u64, rhs: Option<i32>) {
    runtime
        .set_input("__gf_now_ms", Value::Number(mono as f64))
        .unwrap();
    runtime
        .set_input("__gf_time_epoch", Value::Number(epoch as f64))
        .unwrap();
    if let Some(rhs) = rhs {
        runtime.set_input("rhs", Value::Int(rhs)).unwrap();
    }
}
fn periodic_facts() -> context_runtime::Facts {
    context_runtime::Facts {
        schedules: vec![ScheduleEvidence {
            site: 7,
            coverage_start_ms: 0,
            coverage_end_ms: 1000,
            provider: None,
            calendar: None,
            rows: vec![],
        }],
        ..Default::default()
    }
}

fn utc_range_program() -> Module {
    let mut program = module(
        PulseDescriptor::Context(ScheduleDescriptor {
            clock_hold_ms: None,
            site: 7,
            name: "planned".into(),
            gap_ms: 60,
            definition: ScheduleDefinition::UtcRange {
                starts_ms: vec![100],
                duration_ms: 100,
                duration: DurationSetting {
                    id: 0,
                    name: String::new(),
                    operator_editable: false,
                    initial_ms: 100,
                    min_ms: 100,
                    max_ms: 100,
                    step_ms: 1,
                },
                start: DurationSetting {
                    id: 0,
                    name: String::new(),
                    operator_editable: false,
                    initial_ms: 100,
                    min_ms: 100,
                    max_ms: 100,
                    step_ms: 1,
                },
            },
            when: vec![1, 1],
            cancel: vec![1, 0],
        }),
        false,
    );
    program.format_version = 12;
    program.strategies[0].intents[0].expression = vec![58, 0, 0, 2];
    program
}

#[test]
fn utc_range_context_failure_rolls_back_and_checkpoint_never_resumes() {
    let mut runtime = Runtime::new(8);
    runtime.install(utc_range_program(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    let pristine = runtime.context_checkpoint().unwrap();
    inputs(&mut runtime, 1, 0, Some(0));
    assert!(runtime
        .tick_with_context(clock(1, 0, 140), &periodic_facts())
        .is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), pristine);
    inputs(&mut runtime, 1, 0, Some(1));
    let admitted = runtime
        .tick_with_context(clock(1, 0, 140), &periodic_facts())
        .unwrap();
    assert_eq!(admitted.requested_intents["allowed"], Value::Bool(true));
    assert!(admitted.context_trace.iter().any(|o| o.decision == "Due"));
    let checkpoint = runtime.context_checkpoint().unwrap();
    let mut reboot = Runtime::new(8);
    reboot.install(utc_range_program(), false);
    reboot
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    reboot.restore_context_checkpoint(&checkpoint).unwrap();
    inputs(&mut reboot, 2, 0, Some(1));
    let restored = reboot
        .tick_with_context(clock(2, 0, 150), &periodic_facts())
        .unwrap();
    assert_eq!(restored.requested_intents["allowed"], Value::Bool(false));
    assert!(restored.context_trace.iter().all(|o| o.decision != "Due"));
    assert_eq!(reboot.context_checkpoint().unwrap(), checkpoint);
}

fn framed_periodic() -> scan::ScanDriver {
    let mut runtime = Runtime::new(8);
    runtime.install(periodic(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    runtime.into_scan_driver()
}

fn context_frame(scan_id: u64, time: u64, rhs: i32) -> scan::ScanFrameV1 {
    scan::ScanFrameV1 {
        scan_id,
        logical_time_ms: time,
        inputs: vec![scan::ScanInput {
            name: "rhs".into(),
            value: Value::Int(rhs),
        }],
    }
}

#[test]
fn context_scan_latches_host_epoch_and_commits_periodic_intents() {
    let mut driver = framed_periodic();
    let first = driver
        .scan_with_context(context_frame(0, 0, 1), clock(1, 0, 99), &periodic_facts())
        .unwrap();
    assert_eq!(first.trace.inputs["__gf_now_ms"], Value::Number(0.0));
    assert_eq!(first.trace.inputs["__gf_time_epoch"], Value::Number(1.0));
    assert_eq!(first.trace.safe_intents["allowed"], Value::Bool(false));
    let due = driver
        .scan_with_context(context_frame(1, 1, 1), clock(1, 1, 100), &periodic_facts())
        .unwrap();
    assert_eq!(due.scan_id, 1);
    assert_eq!(due.logical_time_ms, 1);
    assert_eq!(due.trace.safe_intents["allowed"], Value::Bool(true));
    assert_eq!(driver.next_scan_id(), Some(2));
    assert_eq!(driver.scan_last_time_ms(), Some(1));
    assert!(driver
        .scan_with_context(context_frame(2, 0, 1), clock(1, 0, 101), &periodic_facts())
        .is_err());
    assert!(driver
        .scan_with_context(context_frame(2, 2, 1), clock(2, 2, 101), &periodic_facts())
        .is_err());
    assert_eq!(driver.next_scan_id(), Some(2));
    assert_eq!(driver.scan_last_time_ms(), Some(1));
}

#[test]
fn context_scan_rejects_inconsistent_frames_without_mutation() {
    let mut driver = framed_periodic();
    let before = driver.runtime().context_checkpoint().unwrap();
    assert!(driver
        .scan_with_context(context_frame(0, 0, 1), clock(1, 1, 99), &periodic_facts())
        .is_err());
    for name in ["__gf_now_ms", "__gf_time_epoch"] {
        let mut frame = context_frame(0, 0, 1);
        frame.inputs[0].name = name.into();
        frame.inputs[0].value = Value::Number(0.0);
        let error = driver
            .scan_with_context(frame, clock(1, 0, 99), &periodic_facts())
            .unwrap_err();
        assert_eq!(error.to_string(), "reserved input is runtime-derived");
    }
    assert!(driver
        .scan_with_context(context_frame(1, 0, 1), clock(1, 0, 99), &periodic_facts())
        .is_err());
    for epoch in [scan::SCAN_FRAME_V1_MAX_EXACT_INTEGER + 1, u64::MAX] {
        assert!(driver
            .scan_with_context(
                context_frame(0, 0, 1),
                clock(epoch, 0, 99),
                &periodic_facts()
            )
            .is_err());
    }
    assert!(driver.scan(context_frame(0, 0, 1)).is_err());
    assert_eq!(driver.runtime().context_checkpoint().unwrap(), before);
    assert_eq!(driver.next_scan_id(), Some(0));
    assert_eq!(driver.scan_last_time_ms(), None);
    assert!(driver.runtime().journal.is_empty());
    let accepted = driver
        .scan_with_context(context_frame(0, 0, 1), clock(1, 0, 99), &periodic_facts())
        .unwrap();
    assert_eq!((accepted.scan_id, accepted.logical_time_ms), (0, 0));
}

#[test]
fn context_scan_failure_keeps_occurrence_and_sequence_available_for_retry() {
    let mut driver = framed_periodic();
    driver
        .scan_with_context(context_frame(0, 0, 1), clock(1, 0, 99), &periodic_facts())
        .unwrap();
    let before = driver.runtime().context_checkpoint().unwrap();
    for (rhs, facts) in [
        (1, context_runtime::Facts::default()),
        (0, periodic_facts()),
    ] {
        assert!(driver
            .scan_with_context(context_frame(1, 1, rhs), clock(1, 1, 100), &facts)
            .is_err());
        assert_eq!(driver.runtime().context_checkpoint().unwrap(), before);
        assert_eq!(driver.runtime().state("counter"), Some(Value::Int(10)));
        assert_eq!(driver.runtime().journal.len(), 1);
        assert!(driver.runtime().inputs.iter().all(Option::is_none));
        assert_eq!(driver.next_scan_id(), Some(1));
        assert_eq!(driver.scan_last_time_ms(), Some(0));
    }
    let retry = driver
        .scan_with_context(context_frame(1, 1, 1), clock(1, 1, 100), &periodic_facts())
        .unwrap();
    assert_eq!(retry.trace.safe_intents["allowed"], Value::Bool(true));
    assert_eq!(driver.next_scan_id(), Some(2));
}

#[test]
fn rejected_vm_scan_rolls_back_live_event_then_durable_restore_keeps_accepted_phase() {
    let mut runtime = Runtime::new(8);
    runtime.install(periodic(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    inputs(&mut runtime, 1, 0, Some(1));
    runtime
        .tick_with_context(clock(1, 0, 99), &periodic_facts())
        .unwrap();
    let before = runtime.context_checkpoint().unwrap();
    let mut facts = periodic_facts();
    facts.settings = Some(SettingsEvent {
        program_fingerprint: 85,
        origin: SettingsOrigin::OperatorEdit,
        event_id: "change-1".into(),
        base_revision: 0,
        position: 2,
        changes: vec![SettingChange {
            id: 6,
            semantic_type: "Duration".into(),
            result: Ok(settings_stream::ConfigValue::Scalar(Value::Number(20.0))),
        }],
    });
    inputs(&mut runtime, 1, 1, Some(0));
    assert!(runtime.tick_with_context(clock(1, 1, 100), &facts).is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), before);
    assert_eq!(runtime.journal.len(), 1);
    inputs(&mut runtime, 1, 1, Some(1));
    let accepted = runtime.tick_with_context(clock(1, 1, 100), &facts).unwrap();
    assert_eq!(accepted.requested_intents["allowed"], Value::Bool(false));
    let state = runtime.context_state_json().unwrap();
    assert!(state.contains("\"settingsRevision\":1"));
    assert!(state.contains("\"emissionRevision\":1"));
    assert!(!state.contains("\"sourceRevision\":1"));
    assert!(state.contains("\"value\":20"));
    let checkpoint = runtime.context_checkpoint().unwrap();
    assert!(runtime.restore_context_checkpoint(&checkpoint).is_err());

    let mut reboot = Runtime::new(8);
    reboot.install(periodic(), false);
    reboot
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    let pristine = reboot.context_checkpoint().unwrap();
    let mut corrupt = checkpoint.clone();
    corrupt[20] ^= 1;
    assert!(reboot.restore_context_checkpoint(&corrupt).is_err());
    assert_eq!(reboot.context_checkpoint().unwrap(), pristine);
    reboot.restore_context_checkpoint(&checkpoint).unwrap();
    assert_eq!(reboot.context_state_json().unwrap(), state);
    inputs(&mut reboot, 2, 0, Some(1));
    assert_eq!(
        reboot
            .tick_with_context(clock(2, 0, 140), &periodic_facts())
            .unwrap()
            .requested_intents["allowed"],
        Value::Bool(false)
    );
    inputs(&mut reboot, 2, 20, Some(1));
    assert_eq!(
        reboot
            .tick_with_context(clock(2, 20, 160), &periodic_facts())
            .unwrap()
            .requested_intents["allowed"],
        Value::Bool(true)
    );
}

#[test]
fn settings_provenance_zero_cannot_restore_changed_value_or_fault_and_rejection_keeps_owner() {
    for result in [
        Ok(settings_stream::ConfigValue::Scalar(Value::Number(20.0))),
        Err(settings_stream::SETTINGS_UNAVAILABLE),
    ] {
        let mut driver = framed_periodic();
        let mut facts = periodic_facts();
        facts.settings = Some(SettingsEvent {
            program_fingerprint: 85,
            event_id: "provenance-guard".into(),
            base_revision: 0,
            position: 1,
            origin: SettingsOrigin::ProducerObservation,
            changes: vec![SettingChange {
                id: 6,
                semantic_type: if result.is_ok() {
                    "Duration".into()
                } else {
                    String::new()
                },
                result,
            }],
        });
        driver
            .scan_with_context(context_frame(0, 0, 1), clock(1, 0, 99), &facts)
            .unwrap();
        let saved = driver.runtime().context_checkpoint().unwrap();
        let mut offset = 14;
        offset += 4 + u32::from_le_bytes(saved[offset..offset + 4].try_into().unwrap()) as usize;
        assert_eq!(&saved[offset..offset + 2], &[0, 0]);
        offset += 2 + 8;
        let events = u16::from_le_bytes(saved[offset..offset + 2].try_into().unwrap());
        offset += 2;
        for _ in 0..events {
            offset +=
                2 + u16::from_le_bytes(saved[offset..offset + 2].try_into().unwrap()) as usize;
        }
        assert_eq!(
            u16::from_le_bytes(saved[offset..offset + 2].try_into().unwrap()),
            1
        );
        offset += 2;
        assert_eq!(
            u32::from_le_bytes(saved[offset..offset + 4].try_into().unwrap()),
            6
        );
        let mut bad = saved.clone();
        bad[offset + 12..offset + 20].copy_from_slice(&0u64.to_le_bytes());
        bad[offset + 20..offset + 28].copy_from_slice(&u64::MAX.to_le_bytes());
        checkpoint_checksum(&mut bad);
        let mut owner = framed_periodic();
        let before = owner.runtime().context_checkpoint().unwrap();
        assert!(owner
            .restore_context_checkpoint(&bad)
            .unwrap_err()
            .to_string()
            .contains("initial config provenance"));
        assert_eq!(owner.runtime().context_checkpoint().unwrap(), before);
        assert!(owner.runtime().journal().is_empty());
        assert_eq!(owner.next_scan_id(), Some(0));
        owner.restore_context_checkpoint(&saved).unwrap();
        assert_eq!(
            owner.runtime().context_state_json().unwrap(),
            driver.runtime().context_state_json().unwrap()
        );
    }
}

#[test]
fn natural_results_are_protected_and_wrong_station_rejects_without_consuming_scan() {
    let descriptor = PulseDescriptor::Natural(NaturalDescriptor {
        site: 7,
        name: "natural".into(),
        kind: natural_context::NaturalKind::Tide,
        provider: "harbor".into(),
        classification: "neap".into(),
        ok_input: 2,
        value_input: 3,
        fault_input: 4,
    });
    let binding = ProviderBinding {
        provider: "harbor".into(),
        kind: 0,
        namespace: "provider".into(),
        station: "station-1".into(),
        binding_revision: "binding-1".into(),
        location: "site-1".into(),
        timezone: "Asia/Seoul".into(),
        criteria: "classification-1".into(),
        max_uncertainty_ms: 10,
    };
    let mut runtime = Runtime::new(8);
    runtime.install(module(descriptor, true), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![binding.clone()],
        })
        .unwrap();
    assert!(runtime
        .set_input("__gf_natural_7_value", Value::Bool(true))
        .is_err());
    let observation = ProviderObservation {
        binding,
        provider_revision: "prediction-1".into(),
        coverage_start_ms: 0,
        coverage_end_ms: 100,
        expires_at_ms: 90,
        uncertainty_ms: 0,
        fault: None,
        classifications: vec!["neap".into()],
    };
    let mut facts = context_runtime::Facts {
        natural: vec![observation],
        ..Default::default()
    };
    inputs(&mut runtime, 1, 0, None);
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 0, 50), &facts)
            .unwrap()
            .requested_intents["allowed"],
        Value::Bool(true)
    );
    facts.natural[0].binding.station = "wrong-station".into();
    inputs(&mut runtime, 1, 1, None);
    assert!(runtime.tick_with_context(clock(1, 1, 51), &facts).is_err());
    assert_eq!(runtime.journal.len(), 1);
    inputs(&mut runtime, 1, 1, None);
    let missing = runtime
        .tick_with_context(clock(1, 1, 51), &Default::default())
        .unwrap();
    assert_eq!(missing.tick, 2);
    assert_eq!(missing.requested_intents["allowed"], Value::Bool(false));
    assert!(missing.context_trace[0]
        .decision
        .contains("PredictionMissing"));

    let mut driver = runtime.into_scan_driver();
    let mut frame = scan::ScanFrameV1 {
        scan_id: 0,
        logical_time_ms: 2,
        inputs: vec![scan::ScanInput {
            name: "__gf_natural_7_value".into(),
            value: Value::Bool(true),
        }],
    };
    assert!(driver
        .scan_with_context(frame.clone(), clock(1, 2, 52), &Default::default())
        .is_err());
    frame.inputs.remove(0);
    let missing = driver
        .scan_with_context(frame, clock(1, 2, 52), &Default::default())
        .unwrap();
    assert_eq!(missing.trace.safe_intents["allowed"], Value::Bool(false));
}

#[test]
fn one_scan_rejects_mixed_provider_revisions_before_committing_any_state() {
    let descriptor = PulseDescriptor::Natural(NaturalDescriptor {
        site: 7,
        name: "natural".into(),
        kind: natural_context::NaturalKind::Tide,
        provider: "harbor".into(),
        classification: "neap".into(),
        ok_input: 2,
        value_input: 3,
        fault_input: 4,
    });
    let mut program = module(descriptor, true);
    let strategy = &mut program.schedules.as_mut().unwrap().strategies[0];
    strategy
        .schedules
        .push(PulseDescriptor::Context(ScheduleDescriptor {
            clock_hold_ms: None,
            site: 8,
            name: "run".into(),
            gap_ms: 60,
            definition: ScheduleDefinition::TideRun {
                timezone: "UTC".into(),
                provider: "harbor".into(),
                high: true,
                offset_ms: 0,
                run_ms: 10,
                within_ms: 20,
            },
            when: vec![1, 1],
            cancel: vec![1, 0],
        }));
    strategy
        .prelude
        .push(schedule_vm::PreludeEntry::Schedule(1));
    let binding = ProviderBinding {
        provider: "harbor".into(),
        kind: 0,
        namespace: "provider".into(),
        station: "station-1".into(),
        binding_revision: "binding-1".into(),
        location: "site-1".into(),
        timezone: "UTC".into(),
        criteria: "criteria-1".into(),
        max_uncertainty_ms: 10,
    };
    let observation = ProviderObservation {
        binding: binding.clone(),
        provider_revision: "revision-1".into(),
        coverage_start_ms: 0,
        coverage_end_ms: 100,
        expires_at_ms: 99,
        uncertainty_ms: 0,
        fault: None,
        classifications: vec!["neap".into()],
    };
    let mut facts = context_runtime::Facts {
        natural: vec![observation.clone()],
        schedules: vec![ScheduleEvidence {
            site: 8,
            coverage_start_ms: 0,
            coverage_end_ms: 100,
            provider: Some(observation),
            calendar: None,
            rows: vec![],
        }],
        ..Default::default()
    };
    let mut runtime = Runtime::new(8);
    runtime.install(program, false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![binding],
        })
        .unwrap();
    inputs(&mut runtime, 1, 0, None);
    let pristine = runtime.context_checkpoint().unwrap();
    facts.schedules[0]
        .provider
        .as_mut()
        .unwrap()
        .provider_revision = "revision-2".into();
    assert!(runtime
        .tick_with_context(clock(1, 0, 50), &facts)
        .unwrap_err()
        .to_string()
        .contains("inconsistent shared provider"));
    assert_eq!(runtime.context_checkpoint().unwrap(), pristine);
    facts.schedules[0]
        .provider
        .as_mut()
        .unwrap()
        .provider_revision = "revision-1".into();
    facts.schedules[0]
        .provider
        .as_mut()
        .unwrap()
        .classifications = vec!["spring".into()];
    assert!(runtime.tick_with_context(clock(1, 0, 50), &facts).is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), pristine);
    facts.schedules[0]
        .provider
        .as_mut()
        .unwrap()
        .classifications
        .clear();
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 0, 50), &facts)
            .unwrap()
            .tick,
        1
    );
}

#[test]
fn periodic_rejects_extraneous_provider_rows_even_on_boot() {
    let mut runtime = Runtime::new(8);
    runtime.install(periodic(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    inputs(&mut runtime, 1, 0, Some(1));
    let mut facts = periodic_facts();
    facts.schedules[0].rows.push(Occurrence {
        source_day: 0,
        slot_key: 0,
        minute_of_day: 0,
        fold: 0,
        event_id: String::new(),
        event_kind: 0,
        instant_ms: Some(100),
        withdrawn: false,
        provider_revision: String::new(),
        context_revision: String::new(),
    });
    assert!(runtime.tick_with_context(clock(1, 0, 99), &facts).is_err());
    assert!(runtime.journal.is_empty());
}

#[test]
fn config_only_aggregate_fault_is_current_and_durable_then_recovers() {
    use settings_stream::{ConfigDescriptor, ConfigValue};
    let mut program = periodic();
    program.strategies[0].transitions.clear();
    program.strategies[0].intents[0].expression = vec![3, 3, 0]; // current Result.ok
    program.inputs.extend([
        field("__gf_config_8_ok", Value::Bool(true)),
        field("__gf_config_8_value", Value::Number(30.0)),
        field("__gf_config_8_fault", Value::Number(0.0)),
    ]);
    let strategy = &mut program.schedules.as_mut().unwrap().strategies[0];
    strategy.schedules.remove(0);
    strategy
        .schedules
        .push(PulseDescriptor::Config(ConfigDescriptor {
            id: 8,
            name: "duration".into(),
            semantic_type: "Duration".into(),
            kind: 2,
            operator_editable: true,
            initial: ConfigValue::Scalar(Value::Number(30.0)),
            bounds: Some((
                Value::Number(10.0),
                Value::Number(100.0),
                Value::Number(10.0),
            )),
            grid_ms: 0,
            capacity: 0,
            ok_input: 6,
            value_input: 7,
            fault_input: 8,
        }));
    strategy.prelude = vec![
        schedule_vm::PreludeEntry::Schedule(0),
        schedule_vm::PreludeEntry::Schedule(1),
    ];
    let mut runtime = Runtime::new(8);
    runtime.install(program.clone(), false);
    let activation = context_runtime::Activation {
        boot_epoch: 1,
        terminal_capacity: 16,
        bindings: vec![],
    };
    runtime.activate_with_context(&activation).unwrap();
    inputs(&mut runtime, 1, 0, Some(1));
    assert!(runtime
        .set_input("__gf_config_6_value", Value::Number(900.0))
        .is_err());
    let initial = runtime
        .tick_with_context(clock(1, 0, 100), &Default::default())
        .unwrap();
    assert_eq!(initial.inputs["__gf_config_6_value"], Value::Number(10.0));
    let mut facts = context_runtime::Facts {
        settings: Some(SettingsEvent {
            program_fingerprint: 85,
            origin: SettingsOrigin::OperatorEdit,
            event_id: "group-error".into(),
            base_revision: 0,
            position: 2,
            changes: vec![
                SettingChange {
                    id: 6,
                    semantic_type: "Duration".into(),
                    result: Ok(ConfigValue::Scalar(Value::Number(20.0))),
                },
                SettingChange {
                    id: 8,
                    semantic_type: "Duration".into(),
                    result: Ok(ConfigValue::Scalar(Value::Number(999.0))),
                },
            ],
        }),
        ..Default::default()
    };
    inputs(&mut runtime, 1, 1, Some(1));
    let fault = runtime.tick_with_context(clock(1, 1, 101), &facts).unwrap();
    assert_eq!(fault.inputs["__gf_config_6_ok"], Value::Bool(false));
    assert_eq!(fault.inputs["__gf_config_8_ok"], Value::Bool(false));
    assert_eq!(fault.requested_intents["allowed"], Value::Bool(false));
    let checkpoint = runtime.context_checkpoint().unwrap();
    let state = runtime.context_state_json().unwrap();
    assert!(state.contains("SettingsInvalid"));
    assert!(!state.contains("\"value\":10"));
    inputs(&mut runtime, 1, 2, Some(1));
    assert!(runtime.tick_with_context(clock(1, 2, 102), &facts).is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), checkpoint);
    let mut reboot = Runtime::new(8);
    reboot.install(program, false);
    reboot
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            ..activation
        })
        .unwrap();
    reboot.restore_context_checkpoint(&checkpoint).unwrap();
    assert_eq!(reboot.context_state_json().unwrap(), state);
    inputs(&mut reboot, 2, 0, Some(1));
    let still_fault = reboot
        .tick_with_context(clock(2, 0, 200), &Default::default())
        .unwrap();
    assert_eq!(still_fault.inputs["__gf_config_6_ok"], Value::Bool(false));
    let event = facts.settings.as_mut().unwrap();
    event.event_id = "recovery".into();
    event.base_revision = 1;
    event.position = 2;
    event.changes[1].result = Ok(ConfigValue::Scalar(Value::Number(40.0)));
    inputs(&mut reboot, 2, 1, Some(1));
    let recovered = reboot.tick_with_context(clock(2, 1, 201), &facts).unwrap();
    assert_eq!(recovered.inputs["__gf_config_6_value"], Value::Number(20.0));
    assert_eq!(recovered.inputs["__gf_config_8_value"], Value::Number(40.0));
    assert_eq!(recovered.requested_intents["allowed"], Value::Bool(true));
    let before_mixed = reboot.context_checkpoint().unwrap();
    let event = facts.settings.as_mut().unwrap();
    event.event_id = "mixed-faults".into();
    event.base_revision = 2;
    event.position = 3;
    event.changes[0].result = Err(0);
    event.changes[1].result = Err(1);
    inputs(&mut reboot, 2, 2, Some(1));
    assert!(reboot.tick_with_context(clock(2, 2, 202), &facts).is_err());
    assert_eq!(reboot.context_checkpoint().unwrap(), before_mixed);
}

#[test]
fn timeslots_consumers_share_keys_and_fault_without_historical_fallback() {
    use settings_stream::ConfigValue;
    let mut program = periodic();
    let strategy = &mut program.schedules.as_mut().unwrap().strategies[0];
    let PulseDescriptor::Config(config) = &mut strategy.schedules[1] else {
        panic!()
    };
    config.kind = 3;
    config.semantic_type = "TimeSlots<60000ms,3>".into();
    config.initial = ConfigValue::Slots(vec![(1, 1)]);
    config.bounds = None;
    config.grid_ms = 60_000;
    config.capacity = 3;
    config.ok_input = u16::MAX;
    config.value_input = u16::MAX;
    config.fault_input = u16::MAX;
    let PulseDescriptor::Context(schedule) = &mut strategy.schedules[0] else {
        panic!()
    };
    schedule.definition = ScheduleDefinition::ConfigDailySlots {
        config_id: 6,
        timezone: "UTC".into(),
        setting: "interval".into(),
        operator_editable: true,
        grid_ms: 60_000,
        capacity: 3,
        initial_minutes: vec![1],
        range_duration_ms: None,
        dst_missing: 0,
        dst_repeated: 0,
    };
    let mut second = schedule.clone();
    second.site = 9;
    second.name = "second".into();
    strategy.schedules.push(PulseDescriptor::Context(second));
    strategy
        .prelude
        .push(schedule_vm::PreludeEntry::Schedule(2));
    let mut runtime = Runtime::new(8);
    runtime.install(program.clone(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    let mut facts = periodic_facts();
    let mut second = facts.schedules[0].clone();
    second.site = 9;
    facts.schedules.push(second);
    inputs(&mut runtime, 1, 0, Some(1));
    runtime.tick_with_context(clock(1, 0, 10), &facts).unwrap();
    facts.settings = Some(SettingsEvent {
        program_fingerprint: 85,
        origin: SettingsOrigin::OperatorEdit,
        event_id: "slots-ok".into(),
        base_revision: 0,
        position: 2,
        changes: vec![SettingChange {
            id: 6,
            semantic_type: "TimeSlots<60000ms,3>".into(),
            result: Ok(ConfigValue::Slots(vec![(1, 2), (0, 3)])),
        }],
    });
    inputs(&mut runtime, 1, 1, Some(1));
    runtime.tick_with_context(clock(1, 1, 11), &facts).unwrap();
    assert!(runtime
        .context_state_json()
        .unwrap()
        .contains("\"key\":2,\"minuteOfDay\":3"));
    let event = facts.settings.as_mut().unwrap();
    event.event_id = "slots-fault".into();
    event.base_revision = 1;
    event.position = 3;
    event.changes[0].result = Err(1);
    inputs(&mut runtime, 1, 2, Some(1));
    let trace = runtime.tick_with_context(clock(1, 2, 12), &facts).unwrap();
    assert_eq!(
        trace
            .context_trace
            .iter()
            .filter(|o| o.decision == "Unknown(SettingsUnavailable)")
            .count(),
        2
    );
    let snapshot = runtime.context_checkpoint().unwrap();
    let state = runtime.context_state_json().unwrap();
    assert!(!state.contains("\"result\":{\"ok\":true,\"value\":{\"kind\":\"slots\",\"entries\""));
    let mut reboot = Runtime::new(8);
    reboot.install(program, false);
    reboot
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    reboot.restore_context_checkpoint(&snapshot).unwrap();
    assert_eq!(reboot.context_state_json().unwrap(), state);
}

#[test]
fn timeslots_checkpoint_restore_uses_authored_grid_and_capacity() {
    use settings_stream::ConfigValue;
    for (grid_ms, capacity, minute) in [(60_000, 3, 1), (900_000, 8, 15)] {
        let mut program = periodic();
        let strategy = &mut program.schedules.as_mut().unwrap().strategies[0];
        let PulseDescriptor::Config(config) = &mut strategy.schedules[1] else {
            panic!()
        };
        config.kind = 3;
        config.semantic_type = format!("TimeSlots<{grid_ms}ms,{capacity}>");
        config.initial = ConfigValue::Slots(vec![(1, minute)]);
        config.bounds = None;
        config.grid_ms = grid_ms;
        config.capacity = capacity;
        config.ok_input = u16::MAX;
        config.value_input = u16::MAX;
        config.fault_input = u16::MAX;
        let PulseDescriptor::Context(schedule) = &mut strategy.schedules[0] else {
            panic!()
        };
        schedule.definition = ScheduleDefinition::ConfigDailySlots {
            config_id: 6,
            timezone: "UTC".into(),
            setting: "interval".into(),
            operator_editable: true,
            grid_ms,
            capacity,
            initial_minutes: vec![minute],
            range_duration_ms: None,
            dst_missing: 0,
            dst_repeated: 0,
        };
        let mut runtime = Runtime::new(8);
        runtime.install(program.clone(), false);
        runtime
            .activate_with_context(&context_runtime::Activation {
                boot_epoch: 1,
                terminal_capacity: 8,
                bindings: vec![],
            })
            .unwrap();
        let checkpoint = runtime.context_checkpoint().unwrap();
        let mut reboot = Runtime::new(8);
        reboot.install(program, false);
        reboot
            .activate_with_context(&context_runtime::Activation {
                boot_epoch: 2,
                terminal_capacity: 8,
                bindings: vec![],
            })
            .unwrap();
        reboot.restore_context_checkpoint(&checkpoint).unwrap();
        assert_eq!(
            reboot.context_state_json().unwrap(),
            runtime.context_state_json().unwrap()
        );
    }
}

#[test]
fn readonly_stream_accepts_producer_fault_and_initial_recovery_but_not_value_edit() {
    use settings_stream::ConfigValue;
    let mut program = periodic();
    program.strategies[0].transitions.clear();
    program.strategies[0].intents[0].expression = vec![3, 3, 0];
    let strategy = &mut program.schedules.as_mut().unwrap().strategies[0];
    strategy.schedules.remove(0);
    strategy.prelude = vec![schedule_vm::PreludeEntry::Schedule(0)];
    let PulseDescriptor::Config(config) = &mut strategy.schedules[0] else {
        panic!()
    };
    config.operator_editable = false;
    let mut runtime = Runtime::new(8);
    runtime.install(program.clone(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    let initial = runtime.context_checkpoint().unwrap();
    let mut facts = context_runtime::Facts {
        settings: Some(SettingsEvent {
            program_fingerprint: 85,
            origin: SettingsOrigin::OperatorEdit,
            event_id: "producer-outage".into(),
            base_revision: 0,
            position: 1,
            changes: vec![SettingChange {
                id: 6,
                semantic_type: String::new(),
                result: Err(1),
            }],
        }),
        ..Default::default()
    };
    inputs(&mut runtime, 1, 0, Some(1));
    assert!(runtime.tick_with_context(clock(1, 0, 0), &facts).is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), initial);
    facts.settings.as_mut().unwrap().origin = SettingsOrigin::ProducerObservation;
    inputs(&mut runtime, 1, 0, Some(1));
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 0, 0), &facts)
            .unwrap()
            .requested_intents["allowed"],
        Value::Bool(false)
    );
    let fault_snapshot = runtime.context_checkpoint().unwrap();
    let mut restored = Runtime::new(8);
    restored.install(program, false);
    restored
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    restored
        .restore_context_checkpoint(&fault_snapshot)
        .unwrap();
    let event = facts.settings.as_mut().unwrap();
    event.event_id = "producer-recovery".into();
    event.base_revision = 1;
    event.position = 2;
    event.changes[0].semantic_type = "Duration".into();
    event.changes[0].result = Ok(ConfigValue::Scalar(Value::Number(20.0)));
    inputs(&mut runtime, 1, 1, Some(1));
    assert!(runtime.tick_with_context(clock(1, 1, 1), &facts).is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), fault_snapshot);
    facts.settings.as_mut().unwrap().changes[0].result =
        Ok(ConfigValue::Scalar(Value::Number(10.0)));
    inputs(&mut runtime, 1, 1, Some(1));
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 1, 1), &facts)
            .unwrap()
            .requested_intents["allowed"],
        Value::Bool(true)
    );
}

#[test]
fn pid_reads_staged_config_result_and_rolls_back_with_failed_vm() {
    use settings_stream::ConfigValue;
    let mut program = periodic();
    let schedule = &mut program.schedules.as_mut().unwrap().strategies[0];
    schedule.schedules.remove(0);
    let PulseDescriptor::Config(config) = &mut schedule.schedules[0] else {
        unreachable!()
    };
    config.semantic_type = "Temperature".into();
    config.initial = ConfigValue::Scalar(Value::Number(298.0));
    config.bounds = Some((
        Value::Number(290.0),
        Value::Number(310.0),
        Value::Number(1.0),
    ));
    schedule.prelude = vec![schedule_vm::PreludeEntry::Schedule(0)];
    program.strategies[0].intents[0].expression = vec![3, 3, 0];
    program.inputs.extend([
        field("measure", Value::Number(303.0)),
        field("measure_ok", Value::Bool(true)),
        field("safe_max", Value::Number(80.0)),
    ]);
    program.objective = Some(objective_vm::ObjectiveDescriptor {
        name: "temperature".into(),
        output: "vent".into(),
        measure_input: 6,
        measure_ok_input: 7,
        target_input: 4,
        target_ok_input: Some(3),
        safe_max_input: 8,
        config: controller::PidConfig {
            period_ms: 10_000,
            late_after_ms: 30_000,
            direction: controller::Direction::Reverse,
            kp: 2.0,
            ki: 0.0,
            kd: 0.0,
            bias_percent: 0.0,
            output_max_percent: 80.0,
            restart_percent: 0.0,
        },
    });
    let mut runtime = Runtime::new(8);
    runtime.install(program, false);
    runtime
        .add_capability(Capability {
            kind: "actuator".into(),
            name: "vent".into(),
            value_type: Type::Number,
        })
        .unwrap();
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    let inputs = |runtime: &mut Runtime, epoch, mono, rhs| {
        inputs(runtime, epoch, mono, rhs);
        runtime
            .set_input(
                "measure",
                Value::Number(if mono == 0 {
                    298.0
                } else if mono == 42_000 {
                    304.0
                } else {
                    303.0
                }),
            )
            .unwrap();
        runtime.set_input("measure_ok", Value::Bool(true)).unwrap();
        runtime.set_input("safe_max", Value::Number(80.0)).unwrap();
    };
    let mut facts = context_runtime::Facts {
        solars: vec![],
        natural: vec![],
        schedules: vec![],
        settings: None,
        accounting: vec![],
    };
    for mono in [0, 10_000] {
        inputs(&mut runtime, 1, mono, Some(1));
        runtime
            .tick_with_context(clock(1, mono, mono), &facts)
            .unwrap();
    }
    assert_eq!(runtime.safe_intents["vent"], Value::Number(10.0));
    let emission = |id: &str, revision, position, result| SettingsEvent {
        program_fingerprint: 85,
        event_id: id.into(),
        base_revision: revision,
        position,
        origin: SettingsOrigin::OperatorEdit,
        changes: vec![SettingChange {
            id: 6,
            semantic_type: "Temperature".into(),
            result,
        }],
    };
    facts.settings = Some(emission(
        "new-target",
        0,
        3,
        Ok(ConfigValue::Scalar(Value::Number(300.0))),
    ));
    inputs(&mut runtime, 1, 20_000, Some(0));
    let before = runtime.context_checkpoint().unwrap();
    assert!(runtime
        .tick_with_context(clock(1, 20_000, 20_000), &facts)
        .is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), before);
    assert_eq!(runtime.safe_intents["vent"], Value::Number(10.0));
    inputs(&mut runtime, 1, 20_000, Some(1));
    let record = runtime
        .tick_with_context(clock(1, 20_000, 20_000), &facts)
        .unwrap();
    assert_eq!(record.safe_intents["vent"], Value::Number(6.0));
    assert_eq!(record.inputs["__gf_config_6_value"], Value::Number(300.0));
    facts.settings = Some(emission(
        "target-unavailable",
        1,
        4,
        Err(settings_stream::SETTINGS_UNAVAILABLE),
    ));
    inputs(&mut runtime, 1, 21_000, Some(1));
    let record = runtime
        .tick_with_context(clock(1, 21_000, 21_000), &facts)
        .unwrap();
    assert_eq!(record.safe_intents["vent"], Value::Number(0.0));
    assert_eq!(record.safe_intents["allowed"], Value::Bool(false));
    facts.settings = Some(emission(
        "target-recovered",
        2,
        5,
        Ok(ConfigValue::Scalar(Value::Number(301.0))),
    ));
    inputs(&mut runtime, 1, 22_000, Some(1));
    runtime
        .tick_with_context(clock(1, 22_000, 22_000), &facts)
        .unwrap();
    facts.settings = None;
    inputs(&mut runtime, 1, 32_000, Some(1));
    // Existing track_safe policy reinitializes on the first recovered deadline.
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 32_000, 32_000), &facts)
            .unwrap()
            .safe_intents["vent"],
        Value::Number(0.0)
    );
    inputs(&mut runtime, 1, 42_000, Some(1));
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 42_000, 42_000), &facts)
            .unwrap()
            .safe_intents["vent"],
        Value::Number(2.0)
    );
}

fn solar_config_program() -> Module {
    let mut program = periodic();
    program.format_version = 16;
    let PulseDescriptor::Context(d) =
        &mut program.schedules.as_mut().unwrap().strategies[0].schedules[0]
    else {
        unreachable!()
    };
    d.gap_ms = 172_800_000;
    d.definition = ScheduleDefinition::SolarContext {
        timezone: "UTC".into(),
        latitude: 37.0,
        longitude: 127.0,
        event: 0,
        offset_ms: 0,
        fallback_time_ms: None,
        config_ids: vec![6],
    };
    // Explicit fault fallback true cannot override a referenced settings fault.
    d.when = vec![1, 1];
    program
}
fn solar_config_runtime(epoch: u64) -> Runtime {
    let mut runtime = Runtime::new(8);
    runtime.install(solar_config_program(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: epoch,
            terminal_capacity: 8,
            bindings: vec![],
        })
        .unwrap();
    runtime
}
fn solar_config_facts() -> context_runtime::Facts {
    context_runtime::Facts {
        solars: vec![SolarContextEvidence {
            site: 7,
            timezone: "UTC".into(),
            latitude: 37.0,
            longitude: 127.0,
            event: 0,
            offset_ms: 0,
            coverage_start_ms: 0,
            coverage_end_ms: 172_800_000,
            rows: vec![
                solar_admission::SolarFact::available(0, 100, "provider-1", "position-1"),
                solar_admission::SolarFact::available(1, 86_400_100, "provider-1", "position-1"),
            ],
        }],
        ..Default::default()
    }
}
fn solar_settings(
    id: &str,
    revision: u64,
    position: u64,
    result: std::result::Result<settings_stream::ConfigValue, u8>,
) -> SettingsEvent {
    SettingsEvent {
        program_fingerprint: 85,
        event_id: id.into(),
        base_revision: revision,
        position: position + 1,
        origin: SettingsOrigin::OperatorEdit,
        changes: vec![SettingChange {
            id: 6,
            semantic_type: "Duration".into(),
            result,
        }],
    }
}

#[test]
fn solar_config_fault_forces_recovery_baseline_without_catchup() {
    let mut runtime = solar_config_runtime(1);
    let mut facts = solar_config_facts();
    inputs(&mut runtime, 1, 0, Some(1));
    runtime.tick_with_context(clock(1, 0, 90), &facts).unwrap();
    for (position, wall, revision, id, fault) in
        [(1, 100, 0, "unavailable", 1), (2, 110, 1, "invalid", 0)]
    {
        facts.settings = Some(solar_settings(id, revision, position, Err(fault)));
        inputs(&mut runtime, 1, position, Some(1));
        let record = runtime
            .tick_with_context(clock(1, position, wall), &facts)
            .unwrap();
        assert_eq!(record.requested_intents["allowed"], Value::Bool(false));
        assert!(record.context_trace.iter().any(|o| o.decision
            == if fault == 0 {
                "Unknown(SettingsInvalid)"
            } else {
                "Unknown(SettingsUnavailable)"
            }));
    }
    facts.settings = Some(solar_settings(
        "recovered",
        2,
        3,
        Ok(settings_stream::ConfigValue::Scalar(Value::Number(20.0))),
    ));
    inputs(&mut runtime, 1, 3, Some(1));
    let recovered = runtime.tick_with_context(clock(1, 3, 120), &facts).unwrap();
    assert_eq!(recovered.requested_intents["allowed"], Value::Bool(false));
    assert!(recovered
        .context_trace
        .iter()
        .any(|o| o.decision == "RecoveryBaseline"));
    facts.settings = None;
    inputs(&mut runtime, 1, 4, Some(1));
    let next_day = runtime
        .tick_with_context(clock(1, 4, 86_400_100), &facts)
        .unwrap();
    assert_eq!(next_day.requested_intents["allowed"], Value::Bool(true));
    let checkpoint = runtime.context_checkpoint().unwrap();
    let mut reboot = solar_config_runtime(2);
    reboot.restore_context_checkpoint(&checkpoint).unwrap();
    for (mono, wall) in [(0, 86_400_090), (1, 86_400_100)] {
        inputs(&mut reboot, 2, mono, Some(1));
        let record = reboot
            .tick_with_context(clock(2, mono, wall), &facts)
            .unwrap();
        assert_eq!(record.requested_intents["allowed"], Value::Bool(false));
    }
}

#[test]
fn solar_config_due_and_settings_and_clock_rollback_as_one_transaction() {
    let mut runtime = solar_config_runtime(1);
    let mut facts = solar_config_facts();
    inputs(&mut runtime, 1, 0, Some(1));
    runtime.tick_with_context(clock(1, 0, 90), &facts).unwrap();
    let checkpoint = runtime.context_checkpoint().unwrap();
    facts.settings = Some(solar_settings(
        "new-value",
        0,
        1,
        Ok(settings_stream::ConfigValue::Scalar(Value::Number(20.0))),
    ));
    inputs(&mut runtime, 1, 1, Some(0));
    assert!(runtime.tick_with_context(clock(1, 1, 100), &facts).is_err());
    assert_eq!(runtime.context_checkpoint().unwrap(), checkpoint);
    assert_eq!(runtime.journal.len(), 1);
    inputs(&mut runtime, 1, 1, Some(1));
    let retry = runtime.tick_with_context(clock(1, 1, 100), &facts).unwrap();
    assert_eq!(retry.requested_intents["allowed"], Value::Bool(true));
    assert!(runtime.context_state_json().unwrap().contains("20"));
    facts.settings = None;
    inputs(&mut runtime, 1, 2, Some(1));
    assert_eq!(
        runtime
            .tick_with_context(clock(1, 2, 100), &facts)
            .unwrap()
            .requested_intents["allowed"],
        Value::Bool(false)
    );
}

#[test]
fn solar_config_immutable_binding_and_missing_or_civil_facts_reject_atomically() {
    let mut runtime = solar_config_runtime(1);
    let pristine = runtime.context_checkpoint().unwrap();
    for mutation in 0..9 {
        let mut facts = solar_config_facts();
        match mutation {
            0 => facts.solars.clear(),
            1 => facts.solars[0].latitude = 38.0,
            2 => facts.solars[0].longitude = 126.0,
            3 => facts.solars[0].timezone = "Asia/Seoul".into(),
            4 => facts.solars[0].event = 1,
            5 => facts.solars[0].offset_ms = 1,
            6 => facts.solars.push(facts.solars[0].clone()),
            7 => facts.schedules = periodic_facts().schedules,
            _ => {
                facts.solars[0].rows[0].availability =
                    solar_admission::SolarFactAvailability::Unavailable;
                facts.solars[0].rows[0].scheduled_wall_ms = None;
                facts.solars[0].rows[0].fallback_wall_ms = Some(100);
                facts.solars[0].rows[0].unavailable_reason = None;
            }
        }
        inputs(&mut runtime, 1, 0, Some(1));
        assert!(runtime.tick_with_context(clock(1, 0, 90), &facts).is_err());
        assert_eq!(runtime.context_checkpoint().unwrap(), pristine);
        assert!(runtime.journal.is_empty());
    }
}

#[test]
fn framed_context_commits_native_identity_and_retries_rejected_emissions() {
    use scan::{ScanFrameV1, ScanInput};
    let mut runtime = Runtime::new(8);
    runtime.install(periodic(), false);
    runtime
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 1,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    let mut driver = runtime.into_scan_driver();
    let frame = |id, time, rhs| ScanFrameV1 {
        scan_id: id,
        logical_time_ms: time,
        inputs: vec![ScanInput {
            name: "rhs".into(),
            value: Value::Int(rhs),
        }],
    };
    let mut facts = periodic_facts();
    let first = driver
        .scan_with_context(frame(0, 0, 1), clock(1, 0, 99), &facts)
        .unwrap();
    assert_eq!((first.scan_id, first.logical_time_ms), (0, 0));
    let before = driver.runtime().context_checkpoint().unwrap();
    facts.settings = Some(SettingsEvent {
        program_fingerprint: 85,
        event_id: "framed-change".into(),
        base_revision: 0,
        position: 2,
        origin: SettingsOrigin::OperatorEdit,
        changes: vec![SettingChange {
            id: 6,
            semantic_type: "Duration".into(),
            result: Ok(settings_stream::ConfigValue::Scalar(Value::Number(20.0))),
        }],
    });
    assert!(driver
        .scan_with_context(frame(1, 1, 0), clock(1, 1, 100), &facts)
        .is_err());
    assert_eq!(driver.next_scan_id(), Some(1));
    assert_eq!(driver.scan_last_time_ms(), Some(0));
    assert_eq!(driver.runtime().context_checkpoint().unwrap(), before);
    assert!(driver
        .scan_with_context(frame(1, 1, 1), clock(1, 2, 101), &facts)
        .is_err());
    let mut forged = frame(1, 1, 1);
    forged.inputs[0] = ScanInput {
        name: "__gf_config_6_value".into(),
        value: Value::Number(999.0),
    };
    assert!(driver
        .scan_with_context(forged, clock(1, 1, 100), &facts)
        .is_err());
    let second = driver
        .scan_with_context(frame(1, 1, 1), clock(1, 1, 100), &facts)
        .unwrap();
    assert_eq!((second.scan_id, second.logical_time_ms), (1, 1));
    assert_eq!(
        second.trace.inputs["__gf_config_6_value"],
        Value::Number(20.0)
    );
    assert_eq!(driver.next_scan_id(), Some(2));
    assert!(driver
        .scan_with_context(frame(1, 2, 1), clock(1, 2, 101), &facts)
        .is_err());
    let snapshot = driver.runtime().context_checkpoint().unwrap();
    assert!(driver.restore_context_checkpoint(&snapshot).is_err());
    let mut reboot = Runtime::new(8);
    reboot.install(periodic(), false);
    reboot
        .activate_with_context(&context_runtime::Activation {
            boot_epoch: 2,
            terminal_capacity: 16,
            bindings: vec![],
        })
        .unwrap();
    let mut reboot = reboot.into_scan_driver();
    reboot.restore_context_checkpoint(&snapshot).unwrap();
    assert_eq!(
        reboot.runtime().context_state_json().unwrap(),
        driver.runtime().context_state_json().unwrap()
    );
    let new_frame = frame(0, 0, 1);
    assert_eq!(
        reboot
            .scan_with_context(new_frame, clock(2, 0, 101), &periodic_facts())
            .unwrap()
            .scan_id,
        0
    );
}
