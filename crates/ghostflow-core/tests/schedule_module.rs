use ghostflow_core::schedule_vm::{PreludeEntry, PulseDescriptor, SolarEvent};
use ghostflow_core::temporal::TargetBudget;
use ghostflow_core::temporal_runtime::TemporalActivation;
use ghostflow_core::{Module, Runtime, Value};

fn string(b: &mut Vec<u8>, s: &str) {
    b.extend((s.len() as u16).to_le_bytes());
    b.extend(s.as_bytes());
}
fn blob(b: &mut Vec<u8>, code: &[u8]) {
    b.extend((code.len() as u32).to_le_bytes());
    b.extend(code);
}
#[derive(Clone)]
struct Solar {
    site: u32,
    name: String,
    zone: String,
    latitude: f64,
    longitude: f64,
    event: u8,
    offset: i64,
    policies: [u8; 4],
    gap: u64,
    when: Vec<u8>,
}
impl Default for Solar {
    fn default() -> Self {
        Self {
            site: 7,
            name: "dawn".into(),
            zone: "Europe/Paris".into(),
            latitude: 48.8,
            longitude: 2.3,
            event: 0,
            offset: -1000,
            policies: [0; 4],
            gap: 60_000,
            when: vec![1, 1],
        }
    }
}
impl Solar {
    fn bytes(&self) -> Vec<u8> {
        let mut b = vec![1];
        b.extend(self.site.to_le_bytes());
        string(&mut b, &self.name);
        string(&mut b, &self.zone);
        b.extend(self.latitude.to_le_bytes());
        b.extend(self.longitude.to_le_bytes());
        b.push(self.event);
        b.extend(self.offset.to_le_bytes());
        b.extend(self.policies);
        b.extend(self.gap.to_le_bytes());
        blob(&mut b, &self.when);
        b
    }
}
fn window(site: u32, name: &str, ok: &[u8]) -> Vec<u8> {
    let mut b = vec![0];
    b.extend(site.to_le_bytes());
    string(&mut b, name);
    b.extend([0, 2]);
    b.extend(1000u64.to_le_bytes());
    b.extend(500u64.to_le_bytes());
    b.extend([1, 0, 0, 0]); // one root, index zero
    for code in [ok, &[34], &[35], &[33], &[33], &[33]] {
        blob(&mut b, code);
    }
    b
}
#[derive(Clone)]
struct Fixture {
    version: u16,
    roots: bool,
    states: u16,
    entries: Vec<Vec<u8>>,
    transition: Option<Vec<u8>>,
    output: Vec<u8>,
    output_type: u8,
    query: Vec<u8>,
    empty_first_strategy: bool,
}
impl Default for Fixture {
    fn default() -> Self {
        Self {
            version: 5,
            roots: false,
            states: 0,
            entries: vec![Solar::default().bytes()],
            transition: None,
            output: vec![58, 0, 0, 0],
            output_type: 1,
            query: vec![5, 1],
            empty_first_strategy: false,
        }
    }
}
impl Fixture {
    fn bytes(&self) -> Vec<u8> {
        let mut b = b"GFB1".to_vec();
        b.extend(self.version.to_le_bytes());
        string(&mut b, "schedule");
        b.extend(1u32.to_le_bytes());
        let inputs = if self.roots { 6u16 } else { 2 };
        b.extend(inputs.to_le_bytes());
        for (name, ty) in [
            ("__gf_now_ms", 2),
            ("__gf_time_epoch", 2),
            ("present", 1),
            ("epoch", 2),
            ("id", 2),
            ("timestamp", 2),
        ]
        .into_iter()
        .take(inputs as usize)
        {
            string(&mut b, name);
            b.push(ty);
        }
        b.extend(self.states.to_le_bytes());
        for i in 0..self.states {
            string(&mut b, &format!("s{i}"));
            b.extend([1, 0]);
        }
        if self.version >= 4 {
            b.extend([0, 0, 1, 0]);
            b.extend(u16::from(self.roots).to_le_bytes());
            if self.roots {
                b.extend(1u32.to_le_bytes());
                string(&mut b, "sensor");
                b.extend([2, 0, 3, 0, 4, 0, 5, 0]);
            }
        }
        let strategies = if self.empty_first_strategy { 2u16 } else { 1 };
        b.extend(strategies.to_le_bytes());
        for s in 0..strategies {
            string(&mut b, if s == 0 { "main" } else { "second" });
            b.extend(0i32.to_le_bytes());
            blob(&mut b, &self.query);
            let empty = self.empty_first_strategy && s == 0;
            if self.version >= 4 {
                b.extend((if empty { 0 } else { self.entries.len() as u16 }).to_le_bytes());
                if !empty {
                    for entry in &self.entries {
                        b.extend(entry);
                    }
                }
            }
            b.extend(u16::from(self.transition.is_some() && !empty).to_le_bytes());
            if !empty {
                if let Some(code) = &self.transition {
                    b.extend([0, 0]);
                    blob(&mut b, code);
                }
            }
            b.extend([1, 0]);
            string(&mut b, "due");
            b.push(if empty { 1 } else { self.output_type });
            blob(&mut b, if empty { &[1, 0] } else { &self.output });
        }
        b.extend([0, 0]);
        if matches!(self.version, 7 | 11 | 12) {
            b.extend([0, 0]); // objective count
        }
        b
    }
}
fn rejected(f: &Fixture, message: &str) {
    match Module::load(&f.bytes()) {
        Err(error) => assert_eq!(error.message(), message),
        Ok(_) => panic!("accepted invalid module: {message}"),
    }
}

fn utc_range(starts: &[u64], duration: u64, zone: &str) -> Vec<u8> {
    let mut bytes = vec![13];
    bytes.extend(7u32.to_le_bytes());
    string(&mut bytes, "planned");
    bytes.extend(60_000u64.to_le_bytes());
    string(&mut bytes, zone);
    bytes.extend(duration.to_le_bytes());
    bytes.extend((starts.len() as u16).to_le_bytes());
    for start in starts {
        bytes.extend(start.to_le_bytes());
    }
    blob(&mut bytes, &[1, 1]);
    blob(&mut bytes, &[1, 0]);
    bytes
}

#[test]
fn gfb12_range_loads_active_and_rejects_old_profiles_and_malformed_recurrences() {
    let mut fixture = Fixture {
        version: 12,
        entries: vec![utc_range(&[0, 900_000], 900_000, "UTC")],
        output: vec![58, 0, 0, 2],
        ..Default::default()
    };
    let module = Module::load(&fixture.bytes()).unwrap();
    assert!(matches!(
        &module.schedule_requirements().unwrap().strategies[0].schedules[0],
        PulseDescriptor::Context(ghostflow_core::context_vm::ScheduleDescriptor {
            definition: ghostflow_core::context_vm::ScheduleDefinition::UtcRange { .. },
            ..
        })
    ));
    for version in [5, 8, 9, 10, 11] {
        fixture.version = version;
        rejected(&fixture, "invalid prelude kind");
    }
    fixture.version = 12;
    for (starts, duration) in [
        (vec![], 1),
        (vec![0], 0),
        (vec![0, 0], 1),
        (vec![900_000, 0], 1),
        (vec![86_400_000], 1),
        (vec![0, 900_000], 900_001),
        (vec![0, 86_399_999], 2),
        (vec![0], 86_400_001),
        (vec![0; 97], 1),
    ] {
        fixture.entries = vec![utc_range(&starts, duration, "UTC")];
        assert!(
            Module::load(&fixture.bytes()).is_err(),
            "accepted {starts:?}/{duration}"
        );
    }
    fixture.entries = vec![utc_range(&[0], 1, "Etc/UTC")];
    rejected(&fixture, "Range requires UTC timezone");
    fixture.entries = vec![Solar::default().bytes()];
    fixture.output = vec![58, 0, 0, 0];
    rejected(&fixture, "GFB format 12 requires UTC Range");
}

#[test]
fn gfb5_schedule_only_loads_but_cannot_activate_or_hot_swap() {
    let module = Module::load(&Fixture::default().bytes()).unwrap();
    let requirements = module.schedule_requirements().unwrap();
    let PulseDescriptor::Solar(s) = &requirements.strategies[0].schedules[0] else {
        panic!("expected Solar descriptor");
    };
    assert_eq!(
        (s.site, s.name.as_str(), s.timezone.as_str()),
        (7, "dawn", "Europe/Paris")
    );
    assert_eq!(
        (s.latitude, s.longitude, s.event, s.offset_ms, s.gap_ms),
        (48.8, 2.3, SolarEvent::Rise, -1000, 60_000)
    );
    assert_eq!(
        requirements.strategies[0].prelude,
        [PreludeEntry::Schedule(0)]
    );
    assert!(module.temporal_requirements().unwrap().roots.is_empty());
    let mut runtime = Runtime::new(2);
    runtime.install(module, false);
    assert_eq!(
        runtime.activate().unwrap_err().message(),
        "schedule activation requires runtime bindings"
    );
    assert!(runtime.active_strategy().is_none());
    assert_eq!(
        runtime
            .hot_swap(Module::load(&Fixture::default().bytes()).unwrap())
            .unwrap_err()
            .message(),
        "schedule activation requires runtime bindings"
    );
    let activation = TemporalActivation {
        root_density: vec![],
        time_epoch: 1,
        budget: TargetBudget {
            max_retained_samples: 10,
            max_bytes: 1_000_000,
        },
    };
    assert_eq!(
        runtime
            .activate_with_temporal(&activation)
            .unwrap_err()
            .message(),
        "schedule activation requires runtime bindings"
    );
    assert_eq!(
        runtime.plan_temporal(&activation).unwrap_err().message(),
        "schedule activation requires runtime bindings"
    );
    assert!(runtime.active_strategy().is_none());
    assert!(runtime.temporal_resource_report().is_none());
    assert!(runtime.tick().is_err());
}

#[test]
fn gfb5_mixed_preludes_verify_prior_typed_reads_in_both_directions() {
    let solar = Solar {
        when: vec![57, 0, 0, 0],
        ..Solar::default()
    };
    let f = Fixture {
        roots: true,
        entries: vec![
            window(1, "before", &[1, 1]),
            solar.bytes(),
            window(2, "after", &[58, 0, 0, 0]),
        ],
        states: 1,
        transition: Some(vec![58, 0, 0, 0]),
        ..Fixture::default()
    };
    let module = Module::load(&f.bytes()).unwrap();
    assert_eq!(
        module.schedule_requirements().unwrap().strategies[0].prelude,
        [
            PreludeEntry::Window(0),
            PreludeEntry::Schedule(0),
            PreludeEntry::Window(1)
        ]
    );
    assert_eq!(
        module.temporal_requirements().unwrap().strategies[0]
            .windows
            .len(),
        2
    );
}

#[test]
fn gfb5_forward_projection_and_wrong_type_are_rejected() {
    for (code, message) in [
        (vec![58, 0, 0, 0], "schedule projection index"),
        (vec![57, 0, 0, 0], "temporal projection index"),
        (vec![33], "schedule predicate must be Bool"),
        (vec![1, 1, 1, 0], "expression result count"),
        (vec![10], "stack underflow"),
    ] {
        let f = Fixture {
            entries: vec![Solar {
                when: code,
                ..Solar::default()
            }
            .bytes()],
            ..Fixture::default()
        };
        rejected(&f, message);
    }
    let f = Fixture {
        roots: true,
        entries: vec![
            window(1, "before", &[58, 0, 0, 0]),
            Solar::default().bytes(),
        ],
        ..Fixture::default()
    };
    rejected(&f, "schedule projection index");
    let f = Fixture {
        roots: true,
        entries: vec![
            Solar::default().bytes(),
            window(1, "after", &[58, 0, 0, 0, 33, 19]),
        ],
        ..Fixture::default()
    };
    rejected(&f, "arithmetic expects numbers");
}

#[test]
fn gfb5_projection_fields_indices_and_older_profiles_are_strict() {
    Module::load(
        &Fixture {
            output: vec![58, 0, 0, 1],
            ..Fixture::default()
        }
        .bytes(),
    )
    .expect("missed is schedule projection field 1");
    for (code, message) in [
        (vec![58, 1, 0, 0], "schedule projection index"),
        (vec![58, 0, 0, 2], "schedule projection field"),
        (vec![58, 0], "truncated bytecode"),
    ] {
        rejected(
            &Fixture {
                output: code,
                ..Fixture::default()
            },
            message,
        );
    }
    rejected(
        &Fixture {
            output_type: 2,
            ..Fixture::default()
        },
        "intent type mismatch",
    );
    for version in 1..=3 {
        rejected(
            &Fixture {
                version,
                ..Fixture::default()
            },
            "schedule projection requires GFB format 5",
        );
    }
    let mut entry = window(1, "window", &[1, 1]);
    entry.remove(0);
    rejected(
        &Fixture {
            version: 4,
            roots: true,
            entries: vec![entry],
            ..Fixture::default()
        },
        "schedule projection requires GFB format 5",
    );
}

#[test]
fn gfb5_descriptor_domains_are_validated() {
    let cases = [
        (
            Solar {
                site: 0,
                ..Solar::default()
            },
            "invalid prelude site",
        ),
        (
            Solar {
                latitude: 90.1,
                ..Solar::default()
            },
            "invalid solar latitude",
        ),
        (
            Solar {
                longitude: -180.1,
                ..Solar::default()
            },
            "invalid solar longitude",
        ),
        (
            Solar {
                latitude: f64::NAN,
                ..Solar::default()
            },
            "non-finite number",
        ),
        (
            Solar {
                event: 2,
                ..Solar::default()
            },
            "invalid solar event",
        ),
        (
            Solar {
                offset: 86_400_001,
                ..Solar::default()
            },
            "invalid solar offset",
        ),
        (
            Solar {
                offset: -86_400_001,
                ..Solar::default()
            },
            "invalid solar offset",
        ),
        (
            Solar {
                gap: 0,
                ..Solar::default()
            },
            "invalid schedule gap",
        ),
        (
            Solar {
                gap: 9_007_199_254_740_992,
                ..Solar::default()
            },
            "invalid schedule gap",
        ),
        (
            Solar {
                zone: "".into(),
                ..Solar::default()
            },
            "identifier byte limit",
        ),
        (
            Solar {
                zone: "a".repeat(129),
                ..Solar::default()
            },
            "identifier byte limit",
        ),
    ];
    for (solar, message) in cases {
        rejected(
            &Fixture {
                entries: vec![solar.bytes()],
                ..Fixture::default()
            },
            message,
        );
    }
    for i in 0..4 {
        let mut solar = Solar::default();
        solar.policies[i] = 1;
        rejected(
            &Fixture {
                entries: vec![solar.bytes()],
                ..Fixture::default()
            },
            "unsupported schedule policy",
        );
    }
    for sign in [-1., 1.] {
        Module::load(
            &Fixture {
                entries: vec![Solar {
                    latitude: sign * 90.,
                    longitude: sign * 180.,
                    offset: sign as i64 * 86_400_000,
                    gap: 9_007_199_254_740_991,
                    zone: "a".repeat(128),
                    event: 1,
                    ..Solar::default()
                }
                .bytes()],
                ..Fixture::default()
            }
            .bytes(),
        )
        .unwrap();
    }
}

#[test]
fn gfb5_shared_prelude_identity_and_budget_are_checked() {
    for entries in [
        vec![Solar::default().bytes(), window(7, "other", &[1, 1])],
        vec![window(7, "other", &[1, 1]), Solar::default().bytes()],
    ] {
        rejected(
            &Fixture {
                roots: true,
                entries,
                ..Fixture::default()
            },
            "invalid prelude site",
        );
    }
    rejected(
        &Fixture {
            roots: true,
            entries: vec![window(1, "dawn", &[1, 1]), Solar::default().bytes()],
            ..Fixture::default()
        },
        "duplicate prelude name",
    );
    rejected(
        &Fixture {
            entries: vec![vec![2]],
            ..Fixture::default()
        },
        "invalid prelude kind",
    );
    rejected(
        &Fixture {
            states: 128,
            ..Fixture::default()
        },
        "prelude state limit exceeded",
    );
    Module::load(
        &Fixture {
            states: 127,
            ..Fixture::default()
        }
        .bytes(),
    )
    .unwrap();
    rejected(
        &Fixture {
            entries: vec![],
            output: vec![1, 0],
            ..Fixture::default()
        },
        "GFB format 5 requires a schedule",
    );
    rejected(
        &Fixture {
            roots: true,
            entries: vec![window(1, "mean", &[1, 1])],
            output: vec![1, 0],
            ..Fixture::default()
        },
        "GFB format 5 requires a schedule",
    );
}

#[test]
fn gfb5_truncation_expression_limits_and_invalid_utf8_are_rejected() {
    let bytes = Fixture::default().bytes();
    for end in 0..bytes.len() {
        assert!(Module::load(&bytes[..end]).is_err(), "truncation {end}");
    }
    let mut extra = bytes.clone();
    extra.push(0);
    assert_eq!(
        Module::load(&extra).err().unwrap().message(),
        "trailing module bytes"
    );
    let mut invalid = bytes;
    let at = invalid
        .windows(12)
        .position(|s| s == b"Europe/Paris")
        .unwrap();
    invalid[at] = 255;
    assert_eq!(
        Module::load(&invalid).err().unwrap().message(),
        "invalid UTF-8"
    );
    let mut when = vec![1, 1];
    when.extend(vec![10; 4094]);
    Module::load(
        &Fixture {
            entries: vec![Solar {
                when: when.clone(),
                ..Solar::default()
            }
            .bytes()],
            ..Fixture::default()
        }
        .bytes(),
    )
    .unwrap();
    when.push(10);
    rejected(
        &Fixture {
            entries: vec![Solar {
                when,
                ..Solar::default()
            }
            .bytes()],
            ..Fixture::default()
        },
        "expression byte limit",
    );
}

#[test]
fn gfb5_schedule_in_unselected_strategy_still_blocks_activation() {
    let f = Fixture {
        empty_first_strategy: true,
        ..Fixture::default()
    };
    let mut runtime = Runtime::new(1);
    runtime.install(Module::load(&f.bytes()).unwrap(), false);
    assert_eq!(
        runtime.activate().unwrap_err().message(),
        "schedule activation requires runtime bindings"
    );
}

#[test]
fn gfb5_hot_swap_rejection_preserves_active_program_pending_inputs_and_journal() {
    let f = Fixture {
        version: 3,
        output: vec![3, 0, 0],
        output_type: 2,
        ..Fixture::default()
    };
    let mut runtime = Runtime::new(3);
    runtime.install(Module::load(&f.bytes()).unwrap(), false);
    runtime.activate().unwrap();
    runtime
        .set_input("__gf_now_ms", Value::Number(10.))
        .unwrap();
    runtime
        .set_input("__gf_time_epoch", Value::Number(1.))
        .unwrap();
    let first = runtime.tick().unwrap().to_json();
    runtime
        .set_input("__gf_now_ms", Value::Number(20.))
        .unwrap();
    runtime
        .set_input("__gf_time_epoch", Value::Number(1.))
        .unwrap();
    assert_eq!(
        runtime
            .hot_swap(Module::load(&Fixture::default().bytes()).unwrap())
            .unwrap_err()
            .message(),
        "schedule activation requires runtime bindings"
    );
    assert_eq!(runtime.active_strategy(), Some("main"));
    assert_eq!(runtime.journal().front().unwrap().to_json(), first);
    let second = runtime.tick().unwrap();
    assert_eq!(second.tick, 2);
    assert_eq!(second.requested_intents["due"], Value::Number(20.));
}

#[test]
fn gfb5_int_capability_predicate_and_declaration_keep_int_types() {
    let mut query = vec![1];
    string(&mut query, "output");
    string(&mut query, "count");
    query.push(3);
    let solar = Solar {
        when: vec![23, 1, 0, 0, 0, 23, 2, 0, 0, 0, 14],
        ..Solar::default()
    };
    let f = Fixture {
        query,
        entries: vec![solar.bytes()],
        output_type: 3,
        output: vec![23, 42, 0, 0, 0],
        ..Fixture::default()
    };
    Module::load(&f.bytes()).unwrap();
    rejected(
        &Fixture {
            output_type: 2,
            ..f
        },
        "intent type mismatch",
    );
}

#[test]
fn gfb5_marker_walkers_parse_schedule_reads_in_predicates_and_window_quality() {
    // Bool payload, zero choice/origin, site 10. A later predicate wraps a schedule read.
    let traced = |mut value: Vec<u8>, site: u8| {
        value.extend([32, 32, 56, site, 0, 0, 0]);
        value
    };
    let first = Solar {
        when: traced(vec![1, 1], 10),
        ..Solar::default()
    };
    let second = Solar {
        site: 8,
        name: "dusk".into(),
        when: traced(vec![58, 0, 0, 0], 11),
        ..Solar::default()
    };
    let mut w = window(9, "mean", &[58, 1, 0, 0]);
    // Rebuild its six source blobs so the quality metadata walker sees op58 in a conditional.
    w.truncate(w.len() - (8 + 5 * 5)); // ok blob 8 bytes; other five blobs 5 each
    for code in [
        vec![58, 1, 0, 0],
        vec![34],
        vec![35],
        vec![33],
        vec![58, 1, 0, 0, 30, 4, 0, 33, 31, 1, 0, 32],
        vec![33],
    ] {
        blob(&mut w, &code);
    }
    let f = Fixture {
        roots: true,
        entries: vec![first.bytes(), second.bytes(), w],
        output: traced(vec![58, 1, 0, 0], 12),
        ..Fixture::default()
    };
    Module::load(&f.bytes()).unwrap();
}

#[test]
fn gfb5_predicate_cannot_read_next_or_exceed_existing_stack_limit() {
    rejected(
        &Fixture {
            states: 1,
            entries: vec![Solar {
                when: vec![5, 0, 0],
                ..Solar::default()
            }
            .bytes()],
            ..Fixture::default()
        },
        "next outside intent",
    );
    let mut when = [1, 1].repeat(128);
    when.extend(vec![13; 127]);
    Module::load(
        &Fixture {
            entries: vec![Solar {
                when,
                ..Solar::default()
            }
            .bytes()],
            ..Fixture::default()
        }
        .bytes(),
    )
    .unwrap();
    let mut when = [1, 1].repeat(129);
    when.extend(vec![13; 128]);
    rejected(
        &Fixture {
            entries: vec![Solar {
                when,
                ..Solar::default()
            }
            .bytes()],
            ..Fixture::default()
        },
        "stack limit",
    );
}

fn solar_activation() -> ghostflow_core::solar_runtime::SolarActivation {
    ghostflow_core::solar_runtime::SolarActivation {
        boot_epoch: 3,
        terminal_capacity: 8,
    }
}

#[test]
fn framed_solar_checkpoint_restores_terminal_identity_in_a_new_clock_run() {
    use ghostflow_core::{
        scan::ScanFrameV1,
        schedule_clock::{ClockSnapshot, ClockTrust},
        solar_admission::{SolarFact, SolarFacts},
        solar_runtime::SolarInput,
    };
    let fixture = Fixture::default();
    let fresh = || {
        let mut runtime = Runtime::new(4);
        runtime.install(Module::load(&fixture.bytes()).unwrap(), false);
        runtime.activate_with_solar(&solar_activation()).unwrap();
        runtime.into_scan_driver()
    };
    let frame = |scan_id, logical_time_ms| ScanFrameV1 {
        scan_id,
        logical_time_ms,
        inputs: vec![],
    };
    let clock = |monotonic_ms, wall_ms| ClockSnapshot {
        monotonic_ms,
        boot_epoch: 3,
        wall_ms: Some(wall_ms),
        trust: ClockTrust::Trusted,
        uncertainty_ms: None,
        source_revision: Some("clock-v1"),
    };
    let rows = [SolarFact::available(0, 1000, "solar-v1", "zone-v1")];
    let facts = [SolarInput {
        site: 7,
        facts: SolarFacts {
            coverage_from_wall_ms: 0,
            coverage_to_wall_ms: 2000,
            rows: &rows,
        },
    }];
    let mut driver = fresh();
    driver
        .scan_with_solar(frame(0, 0), clock(0, 999), &facts)
        .unwrap();
    let before = driver.runtime().solar_checkpoint().unwrap();
    assert!(driver
        .scan_with_solar(frame(1, 1), clock(2, 1000), &facts)
        .is_err());
    assert_eq!(driver.runtime().solar_checkpoint().unwrap(), before);
    assert!(
        driver
            .scan_with_solar(frame(1, 1), clock(1, 1000), &facts)
            .unwrap()
            .trace
            .schedule_trace[0]
            .due
    );
    let checkpoint = driver.runtime().solar_checkpoint().unwrap();
    assert_ne!(checkpoint, before);
    assert!(driver.restore_solar_checkpoint(&checkpoint).is_err());
    let mut reboot_runtime = Runtime::new(4);
    reboot_runtime.install(Module::load(&fixture.bytes()).unwrap(), false);
    reboot_runtime
        .activate_with_solar(&ghostflow_core::solar_runtime::SolarActivation {
            boot_epoch: 7,
            ..solar_activation()
        })
        .unwrap();
    let mut reboot = reboot_runtime.into_scan_driver();
    let reboot_clock = |now, wall| ClockSnapshot {
        boot_epoch: 7,
        ..clock(now, wall)
    };
    reboot.restore_solar_checkpoint(&checkpoint).unwrap();
    // Invalid payloads with a valid checksum still reject atomically.
    let seal = |bytes: &mut Vec<u8>| {
        let mut crc = !0u32;
        for byte in &bytes[..bytes.len() - 4] {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb8_8320u32 & 0u32.wrapping_sub(crc & 1));
            }
        }
        let end = bytes.len();
        bytes[end - 4..].copy_from_slice(&(!crc).to_le_bytes());
    };
    for (offset, value) in [(16, 8), (25, 255)] {
        let mut malformed = checkpoint.clone();
        malformed[offset] = value;
        seal(&mut malformed);
        assert!(reboot.restore_solar_checkpoint(&malformed).is_err());
        assert_eq!(reboot.runtime().solar_checkpoint().unwrap(), checkpoint);
    }
    // A correctly sealed envelope must still respect the selected capacity and
    // must not restore duplicate terminal identities.
    let mut two_days = checkpoint.clone();
    two_days[20..22].copy_from_slice(&2u16.to_le_bytes());
    two_days.splice(26..26, 1u32.to_le_bytes());
    seal(&mut two_days);
    let mut bounded = Runtime::new(4);
    bounded.install(Module::load(&fixture.bytes()).unwrap(), false);
    bounded
        .activate_with_solar(&ghostflow_core::solar_runtime::SolarActivation {
            terminal_capacity: 1,
            ..solar_activation()
        })
        .unwrap();
    let bounded_before = bounded.solar_checkpoint().unwrap();
    assert!(bounded.restore_solar_checkpoint(&two_days).is_err());
    assert_eq!(bounded.solar_checkpoint().unwrap(), bounded_before);
    let mut duplicates = two_days;
    duplicates[26..30].copy_from_slice(&0u32.to_le_bytes());
    seal(&mut duplicates);
    assert!(reboot.restore_solar_checkpoint(&duplicates).is_err());
    assert_eq!(reboot.runtime().solar_checkpoint().unwrap(), checkpoint);
    assert!(reboot
        .restore_solar_checkpoint(&vec![0; 20 + 128 * (6 + 4096 * 4) + 1])
        .is_err());
    assert!(
        !reboot
            .scan_with_solar(frame(0, 0), reboot_clock(0, 999), &facts)
            .unwrap()
            .trace
            .schedule_trace[0]
            .due
    );
    assert!(
        !reboot
            .scan_with_solar(frame(1, 1), reboot_clock(1, 1000), &facts)
            .unwrap()
            .trace
            .schedule_trace[0]
            .due
    );
    for end in 0..checkpoint.len() {
        assert!(
            fresh()
                .restore_solar_checkpoint(&checkpoint[..end])
                .is_err(),
            "truncation {end}"
        );
    }
    for index in 0..checkpoint.len() {
        let mut corrupt = checkpoint.clone();
        corrupt[index] ^= 1;
        assert!(
            fresh().restore_solar_checkpoint(&corrupt).is_err(),
            "corruption {index}"
        );
    }
    let mut different = Runtime::new(2);
    different.install(
        Module::load(
            &Fixture {
                output: vec![1, 0],
                ..fixture
            }
            .bytes(),
        )
        .unwrap(),
        false,
    );
    different.activate_with_solar(&solar_activation()).unwrap();
    assert!(different.restore_solar_checkpoint(&checkpoint).is_err());
}

#[test]
fn framed_solar_downstream_failure_keeps_checkpoint_clock_and_sequence_retryable() {
    use ghostflow_core::{
        scan::{ScanFrameV1, ScanInput},
        schedule_clock::{ClockSnapshot, ClockTrust},
        solar_admission::{SolarFact, SolarFacts},
        solar_runtime::SolarInput,
    };
    let mut fixture = Fixture::default();
    fixture.states = 1;
    fixture.transition = Some(vec![58, 0, 0, 0]);
    fixture.output_type = 2;
    fixture.output = vec![33, 3, 0, 0, 2];
    fixture.output.extend(11f64.to_le_bytes());
    fixture.output.extend([20, 22]);
    let mut runtime = Runtime::new(4);
    runtime.install(Module::load(&fixture.bytes()).unwrap(), false);
    runtime.activate_with_solar(&solar_activation()).unwrap();
    let mut driver = runtime.into_scan_driver();
    let frame = |scan_id, logical_time_ms| ScanFrameV1 {
        scan_id,
        logical_time_ms,
        inputs: vec![],
    };
    let clock = |monotonic_ms, wall_ms| ClockSnapshot {
        monotonic_ms,
        boot_epoch: 3,
        wall_ms: Some(wall_ms),
        trust: ClockTrust::Trusted,
        uncertainty_ms: None,
        source_revision: None,
    };
    let rows = [SolarFact::available(0, 1000, "solar", "zone")];
    let facts = [SolarInput {
        site: 7,
        facts: SolarFacts {
            coverage_from_wall_ms: 0,
            coverage_to_wall_ms: 2000,
            rows: &rows,
        },
    }];
    driver
        .scan_with_solar(frame(0, 10), clock(10, 999), &facts)
        .unwrap();
    let before = driver.runtime().solar_checkpoint().unwrap();
    assert_eq!(
        driver
            .scan_with_solar(frame(1, 11), clock(11, 1000), &facts)
            .unwrap_err()
            .message(),
        "division by zero"
    );
    assert_eq!(driver.next_scan_id(), Some(1));
    assert_eq!(driver.scan_last_time_ms(), Some(10));
    assert_eq!(driver.runtime().journal().len(), 1);
    assert_eq!(driver.runtime().solar_checkpoint().unwrap(), before);
    let mut forged = frame(1, 12);
    forged.inputs.push(ScanInput {
        name: "__gf_time_epoch".into(),
        value: Value::Number(3.0),
    });
    assert!(driver
        .scan_with_solar(forged, clock(12, 1000), &facts)
        .is_err());
    assert!(
        driver
            .scan_with_solar(frame(1, 12), clock(12, 1000), &facts)
            .unwrap()
            .trace
            .schedule_trace[0]
            .due
    );
}

#[test]
fn paused_solar_observations_consume_without_executing_a_frame_and_restore_on_reboot() {
    use ghostflow_core::{
        scan::ScanFrameV1,
        schedule_clock::{ClockSnapshot, ClockTrust},
        solar_admission::{SolarFact, SolarFacts},
        solar_runtime::SolarInput,
    };
    let fixture = Fixture {
        states: 1,
        transition: Some(vec![1, 1]),
        ..Fixture::default()
    };
    let fresh = |boot_epoch| {
        let mut runtime = Runtime::new(4);
        runtime.install(Module::load(&fixture.bytes()).unwrap(), false);
        runtime
            .activate_with_solar(&ghostflow_core::solar_runtime::SolarActivation {
                boot_epoch,
                ..solar_activation()
            })
            .unwrap();
        runtime.into_scan_driver()
    };
    let clock = |boot_epoch, monotonic_ms, wall_ms, trust| ClockSnapshot {
        boot_epoch,
        monotonic_ms,
        wall_ms: Some(wall_ms),
        trust,
        uncertainty_ms: None,
        source_revision: Some("actual-wall-provider"),
    };
    let rows = [SolarFact::available(0, 1000, "solar-v1", "zone-v1")];
    let facts = [SolarInput {
        site: 7,
        facts: SolarFacts {
            coverage_from_wall_ms: 0,
            coverage_to_wall_ms: 200_000,
            rows: &rows,
        },
    }];
    for observations in [vec![999, 1000, 900], vec![999, 100_000]] {
        let mut driver = fresh(3);
        let before = driver.runtime().solar_checkpoint().unwrap();
        for wall in observations {
            // The program clock freezes while real trusted wall observations advance.
            driver
                .observe_solar_paused(clock(3, 0, wall, ClockTrust::Trusted), &facts)
                .unwrap();
            assert_eq!(driver.runtime().state("s0"), Some(Value::Bool(false)));
            assert_eq!(driver.runtime().intent("due"), None);
            assert!(driver.runtime().journal().is_empty());
            assert_eq!(driver.next_scan_id(), Some(0));
            assert_eq!(driver.scan_last_time_ms(), None);
        }
        let checkpoint = driver.runtime().solar_checkpoint().unwrap();
        assert_ne!(checkpoint, before);
        let bad = [SolarInput {
            site: 8,
            facts: facts[0].facts,
        }];
        assert!(driver
            .observe_solar_paused(clock(3, 0, 1001, ClockTrust::Trusted), &bad)
            .is_err());
        assert!(driver
            .observe_solar_paused(clock(4, 0, 1001, ClockTrust::Trusted), &facts)
            .is_err());
        assert_eq!(driver.runtime().solar_checkpoint().unwrap(), checkpoint);
        // Clock trust is supplied faithfully. Recovery cannot revive the consumed day.
        driver
            .observe_solar_paused(
                clock(3, 0, 1001, ClockTrust::Unknown("RTC unavailable")),
                &facts,
            )
            .unwrap();
        driver
            .observe_solar_paused(clock(3, 0, 1002, ClockTrust::Trusted), &facts)
            .unwrap();
        let outcome = driver
            .scan_with_solar(
                ScanFrameV1 {
                    scan_id: 0,
                    logical_time_ms: 1,
                    inputs: vec![],
                },
                clock(3, 1, 1003, ClockTrust::Trusted),
                &facts,
            )
            .unwrap();
        assert!(!outcome.trace.schedule_trace[0].due);
        assert_eq!(driver.runtime().journal().len(), 1);
        assert_eq!(driver.runtime().state("s0"), Some(Value::Bool(true)));
        let mut reboot = fresh(7);
        reboot.restore_solar_checkpoint(&checkpoint).unwrap();
        let first = reboot
            .scan_with_solar(
                ScanFrameV1 {
                    scan_id: 0,
                    logical_time_ms: 0,
                    inputs: vec![],
                },
                clock(7, 0, 999, ClockTrust::Trusted),
                &facts,
            )
            .unwrap();
        assert!(!first.trace.schedule_trace[0].due);
        let crossed = reboot
            .scan_with_solar(
                ScanFrameV1 {
                    scan_id: 1,
                    logical_time_ms: 1,
                    inputs: vec![],
                },
                clock(7, 1, 1000, ClockTrust::Trusted),
                &facts,
            )
            .unwrap();
        assert!(!crossed.trace.schedule_trace[0].due);
    }
}

fn daily_entry(repeated: u8, when: &[u8]) -> Vec<u8> {
    let mut b = vec![3];
    b.extend(7u32.to_le_bytes());
    string(&mut b, "morning");
    string(&mut b, "Asia/Seoul");
    b.extend(23_400_000u64.to_le_bytes());
    b.extend([0, repeated, 0, 0, 0, 0]);
    b.extend(60_000u64.to_le_bytes());
    blob(&mut b, when);
    b
}

fn daily_fixture() -> Fixture {
    Fixture {
        version: 8,
        entries: vec![daily_entry(0, &[1, 1])],
        ..Fixture::default()
    }
}

fn daily_slots_entry(slots: &[(u16, u16)], repeated: u8, when: &[u8]) -> Vec<u8> {
    let mut b = vec![4];
    b.extend(7u32.to_le_bytes());
    string(&mut b, "selected");
    string(&mut b, "Asia/Seoul");
    b.extend(900_000u64.to_le_bytes());
    b.extend([0, repeated, 0, 0, 0, 0]);
    b.extend(60_000u64.to_le_bytes());
    b.extend((slots.len() as u16).to_le_bytes());
    for (key, minute) in slots {
        b.extend(key.to_le_bytes());
        b.extend(minute.to_le_bytes());
    }
    blob(&mut b, when);
    b
}

fn daily_slots_fixture() -> Fixture {
    Fixture {
        version: 9,
        entries: vec![daily_slots_entry(&[(1, 0), (376, 25 * 15)], 0, &[1, 1])],
        ..Fixture::default()
    }
}

fn slot_fact(
    source_day: i32,
    slot_key: u16,
    minute_of_day: u16,
    scheduled_wall_ms: u64,
) -> ghostflow_core::solar_admission::SolarFact {
    ghostflow_core::solar_admission::SolarFact {
        fallback_wall_ms: None,
        unavailable_reason: None,
        source_day,
        slot_key,
        minute_of_day,
        fold: 0,
        scheduled_wall_ms: Some(scheduled_wall_ms),
        provider_revision: "iana-v1".into(),
        context_revision: "zone-v1".into(),
        availability: ghostflow_core::solar_admission::SolarFactAvailability::Available,
    }
}

fn daily_tick<'a>(
    runtime: &'a mut Runtime,
    now: u64,
    wall: u64,
    rows: &[ghostflow_core::solar_admission::SolarFact],
    kind: ghostflow_core::solar_runtime::ScheduleKind,
    coverage_to: u64,
) -> ghostflow_core::Result<&'a ghostflow_core::TickRecord> {
    use ghostflow_core::{
        schedule_clock::{ClockSnapshot, ClockTrust},
        solar_admission::SolarFacts,
        solar_runtime::ScheduleInput,
    };
    runtime.set_input("__gf_now_ms", Value::Number(now as f64))?;
    runtime.set_input("__gf_time_epoch", Value::Number(3.0))?;
    let clock = ClockSnapshot {
        monotonic_ms: now,
        boot_epoch: 3,
        wall_ms: Some(wall),
        trust: ClockTrust::Trusted,
        uncertainty_ms: Some(0),
        source_revision: Some("clock-v1"),
    };
    let facts = [ScheduleInput {
        site: 7,
        kind,
        facts: SolarFacts {
            coverage_from_wall_ms: 0,
            coverage_to_wall_ms: coverage_to,
            rows,
        },
    }];
    if kind == ghostflow_core::solar_runtime::ScheduleKind::DailySlots {
        runtime.tick_with_daily_slots(clock, &facts)
    } else {
        runtime.tick_with_schedules(clock, &facts)
    }
}

#[test]
fn daily_gfb8_descriptor_and_transport_are_distinct_and_checked() {
    use ghostflow_core::solar_admission::SolarFact;
    use ghostflow_core::solar_runtime::ScheduleKind;
    let module = Module::load(&daily_fixture().bytes()).unwrap();
    let PulseDescriptor::Daily(d) =
        &module.schedule_requirements().unwrap().strategies[0].schedules[0]
    else {
        panic!("Daily descriptor required");
    };
    assert_eq!((d.at_ms, d.dst_missing, d.dst_repeated), (23_400_000, 0, 0));
    let mut runtime = Runtime::new(8);
    runtime.install(module, false);
    assert!(runtime.activate_with_solar(&solar_activation()).is_err());
    runtime
        .activate_with_schedules(&solar_activation())
        .unwrap();
    let rows = [SolarFact::available(0, 1000, "iana-v1", "zone-v1")];
    assert!(daily_tick(&mut runtime, 0, 900, &rows, ScheduleKind::Solar, 2000).is_err());
    assert!(
        !daily_tick(&mut runtime, 0, 900, &rows, ScheduleKind::Daily, 2000)
            .unwrap()
            .schedule_trace[0]
            .due
    );
    assert!(solar_tick(&mut runtime, 100, 1000, &rows).is_err());
    let tick = daily_tick(&mut runtime, 100, 1000, &rows, ScheduleKind::Daily, 2000).unwrap();
    assert_eq!(tick.safe_intents["due"], Value::Bool(true));
    assert_eq!(
        tick.schedule_trace[0].observations[0].context_revision,
        "zone-v1"
    );
    let mut old = daily_fixture();
    old.version = 5;
    assert!(Module::load(&old.bytes()).is_err());
    let mut invalid = daily_fixture();
    invalid.entries = vec![daily_entry(4, &[1, 1])];
    assert!(Module::load(&invalid.bytes()).is_err());
    let mut no_daily = Fixture::default();
    no_daily.version = 8;
    assert!(Module::load(&no_daily.bytes()).is_err());
}

#[test]
fn daily_native_transaction_rolls_back_and_stale_coverage_preserves_unknown_reason() {
    use ghostflow_core::solar_admission::SolarFact;
    use ghostflow_core::solar_runtime::ScheduleKind::Daily;
    let mut fixture = daily_fixture();
    fixture.states = 1;
    fixture.transition = Some(vec![58, 0, 0, 0]);
    fixture.output_type = 2;
    fixture.output = vec![33, 3, 0, 0, 2];
    fixture.output.extend(11f64.to_le_bytes());
    fixture.output.extend([20, 22]);
    let mut runtime = Runtime::new(8);
    runtime.install(Module::load(&fixture.bytes()).unwrap(), false);
    runtime
        .activate_with_schedules(&solar_activation())
        .unwrap();
    let rows = [SolarFact::available(0, 1000, "iana-v1", "zone-v1")];
    daily_tick(&mut runtime, 10, 999, &rows, Daily, 2000).unwrap();
    assert_eq!(
        daily_tick(&mut runtime, 11, 1000, &rows, Daily, 2000)
            .unwrap_err()
            .message(),
        "division by zero"
    );
    assert_eq!(runtime.journal().len(), 1);
    assert_eq!(runtime.state("s0"), Some(Value::Bool(false)));
    assert!(
        daily_tick(&mut runtime, 12, 1000, &rows, Daily, 2000)
            .unwrap()
            .schedule_trace[0]
            .due
    );
    let stale = daily_tick(&mut runtime, 13, 2001, &rows, Daily, 2000).unwrap();
    assert!(!stale.schedule_trace[0].due);
    assert_eq!(
        stale.schedule_trace[0].unknown_reason.as_deref(),
        Some("IncompleteCoverage")
    );
    assert!(stale.to_json().contains("IncompleteCoverage"));
}

#[test]
fn daily_unavailable_context_preserves_reason_instead_of_ordinary_false() {
    use ghostflow_core::{
        solar_admission::{SolarDecision, SolarFact, SolarFactAvailability},
        solar_runtime::ScheduleKind::Daily,
    };
    let mut runtime = Runtime::new(8);
    runtime.install(Module::load(&daily_fixture().bytes()).unwrap(), false);
    runtime
        .activate_with_schedules(&solar_activation())
        .unwrap();
    let mut row = SolarFact::available(0, 1000, "iana-v1", "zone-v1");
    row.availability = SolarFactAvailability::Unavailable;
    row.scheduled_wall_ms = None;
    let tick = daily_tick(&mut runtime, 0, 900, &[row], Daily, 2000).unwrap();
    assert_eq!(tick.schedule_trace[0].decision, SolarDecision::Unknown);
    assert_eq!(
        tick.schedule_trace[0].unknown_reason.as_deref(),
        Some("OccurrenceUnavailable")
    );
    assert_eq!(
        tick.schedule_trace[0].observations[0].context_revision,
        "zone-v1"
    );
    assert_eq!(
        tick.schedule_trace[0].observations[0].provider_revision,
        "iana-v1"
    );
}

#[test]
fn daily_slots_gfb9_uses_descriptor_slot_identity_and_native_ledger() {
    use ghostflow_core::solar_admission::SolarDecision;
    use ghostflow_core::solar_runtime::ScheduleKind::DailySlots;

    let module = Module::load(&daily_slots_fixture().bytes()).unwrap();
    let PulseDescriptor::DailySlots(d) =
        &module.schedule_requirements().unwrap().strategies[0].schedules[0]
    else {
        panic!("DailySlots descriptor required");
    };
    assert_eq!(d.slots, [(1, 0), (376, 375)]);
    assert_eq!((d.grid_ms, d.dst_missing, d.dst_repeated), (900_000, 0, 0));

    let mut runtime = Runtime::new(8);
    runtime.install(module, false);
    runtime
        .activate_with_schedules(&solar_activation())
        .unwrap();
    let row = [slot_fact(4, 376, 375, 1000)];
    assert!(
        !daily_tick(&mut runtime, 0, 999, &row, DailySlots, 2000)
            .unwrap()
            .schedule_trace[0]
            .due
    );
    let tick = daily_tick(&mut runtime, 1, 1000, &row, DailySlots, 2000).unwrap();
    assert!(tick.schedule_trace[0].due);
    assert_eq!(tick.schedule_trace[0].observations[0].slot_key, 376);
    assert!(tick.to_json().contains("\"occurrenceId\":\"7:4:376:0\""));

    let corrected = [slot_fact(4, 376, 375, 1100)];
    let duplicate = daily_tick(&mut runtime, 2, 1100, &corrected, DailySlots, 2000).unwrap();
    assert!(!duplicate.schedule_trace[0].due);
    assert_eq!(
        duplicate.schedule_trace[0].decision,
        SolarDecision::AlreadyTerminal
    );
}

#[test]
fn framed_daily_slots_rejected_scan_preserves_sequence_state_and_admission_for_retry() {
    use ghostflow_core::{
        scan::{ScanFrameV1, ScanInput},
        schedule_clock::{ClockSnapshot, ClockTrust},
        solar_admission::SolarFacts,
        solar_runtime::{ScheduleInput, ScheduleKind},
    };
    // Reuse the existing downstream-error fixture: time 11 divides by zero
    // after admission staging, rather than merely failing transport validation.
    let mut fixture = daily_slots_fixture();
    fixture.states = 1;
    fixture.transition = Some(vec![58, 0, 0, 0]);
    fixture.output_type = 2;
    fixture.output = vec![33, 3, 0, 0, 2];
    fixture.output.extend(11f64.to_le_bytes());
    fixture.output.extend([20, 22]);
    let mut runtime = Runtime::new(8);
    runtime.install(Module::load(&fixture.bytes()).unwrap(), false);
    runtime
        .activate_with_schedules(&solar_activation())
        .unwrap();
    let mut driver = runtime.into_scan_driver();
    let rows = [slot_fact(4, 376, 375, 1000)];
    let facts = [ScheduleInput {
        site: 7,
        kind: ScheduleKind::DailySlots,
        facts: SolarFacts {
            coverage_from_wall_ms: 0,
            coverage_to_wall_ms: 2000,
            rows: &rows,
        },
    }];
    let frame = |scan_id, logical_time_ms| ScanFrameV1 {
        scan_id,
        logical_time_ms,
        inputs: vec![],
    };
    let clock = |monotonic_ms, wall_ms| ClockSnapshot {
        monotonic_ms,
        boot_epoch: 3,
        wall_ms: Some(wall_ms),
        uncertainty_ms: Some(0),
        source_revision: Some("clock-v1"),
        trust: ClockTrust::Trusted,
    };
    driver
        .scan_with_schedules(frame(0, 10), clock(10, 999), &facts, 3)
        .unwrap();
    assert_eq!(
        driver
            .scan_with_schedules(frame(1, 11), clock(11, 1000), &facts, 3)
            .unwrap_err()
            .message(),
        "division by zero"
    );
    assert_eq!(driver.next_scan_id(), Some(1));
    assert_eq!(driver.scan_last_time_ms(), Some(10));
    assert_eq!(driver.runtime().journal().len(), 1);
    assert_eq!(driver.runtime().state("s0"), Some(Value::Bool(false)));
    assert!(driver
        .scan_with_schedules(frame(1, 12), clock(13, 1000), &facts, 3)
        .is_err());
    let mut forged = frame(1, 12);
    forged.inputs.push(ScanInput {
        name: "__gf_time_epoch".into(),
        value: Value::Number(3.0),
    });
    assert!(driver
        .scan_with_schedules(forged, clock(12, 1000), &facts, 3)
        .is_err());
    let admitted = driver
        .scan_with_schedules(frame(1, 12), clock(12, 1000), &facts, 3)
        .unwrap();
    assert_eq!((admitted.scan_id, admitted.logical_time_ms), (1, 12));
    assert!(admitted.trace.schedule_trace[0].due);
    assert!(driver
        .scan_with_schedules(frame(1, 12), clock(12, 1000), &facts, 3)
        .is_err());
    let next = driver
        .scan_with_schedules(frame(2, 13), clock(13, 1100), &facts, 3)
        .unwrap();
    assert!(!next.trace.schedule_trace[0].due);
    assert_eq!(driver.runtime().journal().len(), 3);
}

#[test]
fn daily_slots_gfb9_rejects_wrong_descriptor_or_fact_identity() {
    use ghostflow_core::solar_runtime::ScheduleKind::DailySlots;

    for slots in [
        &[][..],
        &[(2, 0)][..],
        &[(1, 1)][..],
        &[(16, 15), (1, 0)][..],
        &[(u16::MAX, u16::MAX)][..],
    ] {
        let mut fixture = daily_slots_fixture();
        fixture.entries = vec![daily_slots_entry(slots, 0, &[1, 1])];
        assert!(Module::load(&fixture.bytes()).is_err());
    }
    let mut wrong_kind = daily_slots_fixture();
    wrong_kind.entries = vec![daily_entry(0, &[1, 1])];
    assert!(Module::load(&wrong_kind.bytes()).is_err());

    let mut runtime = Runtime::new(8);
    runtime.install(Module::load(&daily_slots_fixture().bytes()).unwrap(), false);
    runtime
        .activate_with_schedules(&solar_activation())
        .unwrap();
    let wrong = [slot_fact(4, 377, 375, 1000)];
    assert_eq!(
        daily_tick(&mut runtime, 0, 999, &wrong, DailySlots, 2000)
            .unwrap_err()
            .message(),
        "DailySlots fact violates descriptor"
    );
    let valid = [slot_fact(4, 376, 375, 1000)];
    assert!(daily_tick(&mut runtime, 0, 999, &valid, DailySlots, 2000).is_ok());
}

#[test]
fn daily_slots_capacity_and_downstream_failure_roll_back_the_whole_tick() {
    use ghostflow_core::solar_runtime::ScheduleKind::DailySlots;

    let mut fixture = daily_slots_fixture();
    fixture.states = 1;
    fixture.transition = Some(vec![58, 0, 0, 0]);
    fixture.output_type = 2;
    fixture.output = vec![33, 3, 0, 0, 2];
    fixture.output.extend(11f64.to_le_bytes());
    fixture.output.extend([20, 22]);
    let mut runtime = Runtime::new(8);
    runtime.install(Module::load(&fixture.bytes()).unwrap(), false);
    runtime
        .activate_with_schedules(&solar_activation())
        .unwrap();
    let row = [slot_fact(4, 376, 375, 1000)];
    daily_tick(&mut runtime, 10, 999, &row, DailySlots, 2000).unwrap();
    assert_eq!(
        daily_tick(&mut runtime, 11, 1000, &row, DailySlots, 2000)
            .unwrap_err()
            .message(),
        "division by zero"
    );
    assert_eq!(runtime.journal().len(), 1);
    assert_eq!(runtime.state("s0"), Some(Value::Bool(false)));
    assert!(
        daily_tick(&mut runtime, 12, 1000, &row, DailySlots, 2000)
            .unwrap()
            .schedule_trace[0]
            .due
    );

    let mut capacity = Runtime::new(8);
    capacity.install(Module::load(&daily_slots_fixture().bytes()).unwrap(), false);
    capacity
        .activate_with_schedules(&ghostflow_core::solar_runtime::SolarActivation {
            boot_epoch: 3,
            terminal_capacity: 1,
        })
        .unwrap();
    let first = [slot_fact(4, 1, 0, 1000)];
    daily_tick(&mut capacity, 0, 999, &first, DailySlots, 2000).unwrap();
    daily_tick(&mut capacity, 1, 1000, &first, DailySlots, 2000).unwrap();
    let second = [slot_fact(4, 376, 375, 1100)];
    assert_eq!(
        daily_tick(&mut capacity, 2, 1100, &second, DailySlots, 2000)
            .unwrap_err()
            .message(),
        "solar terminal ledger capacity exceeded"
    );
    assert_eq!(capacity.journal().len(), 2);
}
fn solar_tick<'a>(
    runtime: &'a mut Runtime,
    now: u64,
    wall: u64,
    rows: &[ghostflow_core::solar_admission::SolarFact],
) -> ghostflow_core::Result<&'a ghostflow_core::TickRecord> {
    use ghostflow_core::{
        schedule_clock::{ClockSnapshot, ClockTrust},
        solar_admission::SolarFacts,
        solar_runtime::SolarInput,
    };
    runtime.set_input("__gf_now_ms", Value::Number(now as f64))?;
    runtime.set_input("__gf_time_epoch", Value::Number(3.0))?;
    runtime.tick_with_solar(
        ClockSnapshot {
            monotonic_ms: now,
            boot_epoch: 3,
            wall_ms: Some(wall),
            trust: ClockTrust::Trusted,
            uncertainty_ms: Some(0),
            source_revision: Some("clock-v1"),
        },
        &[SolarInput {
            site: 7,
            facts: SolarFacts {
                coverage_from_wall_ms: 0,
                coverage_to_wall_ms: 200_000_000,
                rows,
            },
        }],
    )
}
#[test]
fn solar_native_module_admits_facts_using_bytecode_predicate_and_records_outcome() {
    use ghostflow_core::solar_admission::{SolarDecision, SolarFact};
    let mut runtime = Runtime::new(4);
    runtime.install(Module::load(&Fixture::default().bytes()).unwrap(), false);
    runtime.activate_with_solar(&solar_activation()).unwrap();
    let facts = [SolarFact::available(0, 1000, "solar-v1", "zone-v1")];
    assert_eq!(
        solar_tick(&mut runtime, 0, 999, &facts)
            .unwrap()
            .safe_intents["due"],
        Value::Bool(false)
    );
    let tick = solar_tick(&mut runtime, 1, 1000, &facts).unwrap();
    assert_eq!(tick.safe_intents["due"], Value::Bool(true));
    assert_eq!(tick.schedule_trace[0].decision, SolarDecision::Due);
    assert!(tick.to_json().contains("\"scheduleTrace\""));
    assert_eq!(
        solar_tick(&mut runtime, 2, 1000, &facts)
            .unwrap()
            .safe_intents["due"],
        Value::Bool(false)
    );
}

#[test]
fn solar_vm_rejects_plain_ticks_and_rewind_without_losing_the_bound_session() {
    let mut runtime = Runtime::new(4);
    runtime.install(Module::load(&Fixture::default().bytes()).unwrap(), false);
    runtime.activate_with_solar(&solar_activation()).unwrap();
    assert_eq!(
        runtime.tick().unwrap_err().message(),
        "solar tick requires activated occurrence bindings"
    );
    solar_tick(&mut runtime, 0, 999, &[]).unwrap();
    assert_eq!(
        runtime.rewind(1).unwrap_err().message(),
        "solar rewind requires checkpoint support"
    );
    assert!(runtime.activate_with_solar(&solar_activation()).is_err());
    assert_eq!(solar_tick(&mut runtime, 1, 1000, &[]).unwrap().tick, 2);
}
#[test]
fn solar_false_predicate_terminalizes_crossing_instead_of_delayed_execution() {
    use ghostflow_core::solar_admission::{SolarDecision, SolarFact};
    let mut fixture = Fixture::default();
    let mut solar = Solar::default();
    // Predicate becomes true after tick 1; the occurrence is already terminal.
    solar.when = vec![3, 0, 0, 33, 16]; // now > 1
    fixture.entries = vec![solar.bytes()];
    let mut runtime = Runtime::new(4);
    runtime.install(Module::load(&fixture.bytes()).unwrap(), false);
    runtime.activate_with_solar(&solar_activation()).unwrap();
    let facts = [SolarFact::available(0, 1000, "solar", "zone")];
    solar_tick(&mut runtime, 0, 999, &facts).unwrap();
    let crossing = solar_tick(&mut runtime, 1, 1000, &facts).unwrap();
    assert_eq!(
        crossing.schedule_trace[0].decision,
        SolarDecision::ConditionsFalseAtPulse
    );
    assert_eq!(crossing.safe_intents["due"], Value::Bool(false));
    assert_eq!(
        solar_tick(&mut runtime, 2, 1001, &facts)
            .unwrap()
            .safe_intents["due"],
        Value::Bool(false)
    );
}
#[test]
fn solar_downstream_error_rolls_back_terminal_clock_scalar_and_journal_state() {
    use ghostflow_core::solar_admission::{SolarDecision, SolarFact};
    let mut fixture = Fixture::default();
    fixture.states = 1;
    fixture.transition = Some(vec![58, 0, 0, 0]);
    fixture.output_type = 2;
    fixture.output = vec![33, 3, 0, 0, 2]; // 1 / (now - 11)
    fixture.output.extend(11f64.to_le_bytes());
    fixture.output.extend([20, 22]);
    let mut runtime = Runtime::new(4);
    runtime.install(Module::load(&fixture.bytes()).unwrap(), false);
    runtime.activate_with_solar(&solar_activation()).unwrap();
    let facts = [SolarFact::available(0, 1000, "solar", "zone")];
    solar_tick(&mut runtime, 10, 999, &facts).unwrap();
    assert_eq!(
        solar_tick(&mut runtime, 11, 1000, &facts)
            .unwrap_err()
            .message(),
        "division by zero"
    );
    assert_eq!(runtime.journal().len(), 1);
    assert_eq!(runtime.state("s0"), Some(Value::Bool(false)));
    let retried = solar_tick(&mut runtime, 12, 1000, &facts).unwrap();
    assert_eq!(retried.tick, 2);
    assert_eq!(retried.schedule_trace[0].decision, SolarDecision::Due);
    assert_eq!(retried.state_after["s0"], Value::Bool(true));
}
#[test]
fn solar_gap_boundary_and_multiple_crossings_use_native_admission() {
    use ghostflow_core::solar_admission::{SolarDecision, SolarFact};
    for (gap, crossing_count, expected) in [
        (60_000, 1, SolarDecision::Due),
        (60_001, 1, SolarDecision::ObservationGap),
        (60_000, 2, SolarDecision::MultipleCrossingsMissed),
    ] {
        let mut runtime = Runtime::new(4);
        runtime.install(Module::load(&Fixture::default().bytes()).unwrap(), false);
        runtime.activate_with_solar(&solar_activation()).unwrap();
        let facts = vec![
            SolarFact::available(0, 1000, "solar", "zone"),
            SolarFact::available(1, 1100, "solar", "zone"),
        ];
        let facts = &facts[..crossing_count];
        solar_tick(&mut runtime, 0, 999, facts).unwrap();
        let tick = solar_tick(&mut runtime, gap, 1200, facts).unwrap();
        assert_eq!(tick.schedule_trace[0].decision, expected);
        assert_eq!(
            tick.safe_intents["due"],
            Value::Bool(expected == SolarDecision::Due)
        );
        if crossing_count == 2 {
            assert_eq!(tick.schedule_trace[0].observations.len(), 2);
            assert!(tick.schedule_trace[0]
                .observations
                .iter()
                .all(|row| row.decision == SolarDecision::Missed));
        }
    }
}
#[test]
fn solar_activation_keeps_mixed_preludes_fail_closed() {
    let mut fixture = Fixture::default();
    fixture.roots = true;
    fixture.entries.push(window(8, "average", &[1, 1]));
    let mut runtime = Runtime::new(4);
    runtime.install(Module::load(&fixture.bytes()).unwrap(), false);
    assert_eq!(
        runtime
            .activate_with_solar(&solar_activation())
            .unwrap_err()
            .message(),
        "mixed solar preludes are not executable"
    );
    assert!(runtime.active_strategy().is_none());
}

#[test]
fn solar_unknown_clock_recovery_establishes_baseline_and_never_catches_up() {
    use ghostflow_core::{
        schedule_clock::{ClockSnapshot, ClockTrust},
        solar_admission::{SolarDecision, SolarFact, SolarFacts},
        solar_runtime::SolarInput,
    };
    let mut runtime = Runtime::new(4);
    runtime.install(Module::load(&Fixture::default().bytes()).unwrap(), false);
    runtime.activate_with_solar(&solar_activation()).unwrap();
    let rows = [SolarFact::available(0, 1000, "solar", "zone")];
    solar_tick(&mut runtime, 0, 999, &rows).unwrap();
    runtime
        .set_input("__gf_now_ms", Value::Number(1.0))
        .unwrap();
    runtime
        .set_input("__gf_time_epoch", Value::Number(3.0))
        .unwrap();
    let tick = runtime
        .tick_with_solar(
            ClockSnapshot {
                monotonic_ms: 1,
                boot_epoch: 3,
                wall_ms: None,
                trust: ClockTrust::Unknown("disconnected"),
                uncertainty_ms: None,
                source_revision: None,
            },
            &[SolarInput {
                site: 7,
                facts: SolarFacts {
                    coverage_from_wall_ms: 0,
                    coverage_to_wall_ms: 2000,
                    rows: &rows,
                },
            }],
        )
        .unwrap();
    assert_eq!(tick.schedule_trace[0].decision, SolarDecision::Unknown);
    let recovered = solar_tick(&mut runtime, 2, 1001, &rows).unwrap();
    assert_eq!(
        recovered.schedule_trace[0].decision,
        SolarDecision::RecoveryBaseline
    );
    assert_eq!(
        recovered.schedule_trace[0].observations[0].decision,
        SolarDecision::Missed
    );
    assert_eq!(recovered.safe_intents["due"], Value::Bool(false));
    solar_tick(&mut runtime, 3, 999, &rows).unwrap();
    assert_eq!(
        solar_tick(&mut runtime, 4, 1000, &rows)
            .unwrap()
            .safe_intents["due"],
        Value::Bool(false)
    );
}
#[test]
fn solar_site_epoch_fact_and_capacity_rejections_preserve_admission_state() {
    use ghostflow_core::{
        schedule_clock::{ClockSnapshot, ClockTrust},
        solar_admission::{SolarFact, SolarFacts},
        solar_runtime::SolarInput,
    };
    let mut runtime = Runtime::new(4);
    runtime.install(Module::load(&Fixture::default().bytes()).unwrap(), false);
    runtime.activate_with_solar(&solar_activation()).unwrap();
    let rows = [SolarFact::available(0, 1000, "solar", "zone")];
    solar_tick(&mut runtime, 0, 999, &rows).unwrap();
    for (site, epoch, expected) in [
        (8, 3, "solar occurrence binding mismatch"),
        (7, 4, "solar clock binding mismatch"),
    ] {
        runtime
            .set_input("__gf_now_ms", Value::Number(1.0))
            .unwrap();
        runtime
            .set_input("__gf_time_epoch", Value::Number(3.0))
            .unwrap();
        let err = runtime
            .tick_with_solar(
                ClockSnapshot {
                    monotonic_ms: 1,
                    boot_epoch: epoch,
                    wall_ms: Some(1000),
                    trust: ClockTrust::Trusted,
                    uncertainty_ms: Some(0),
                    source_revision: Some("clock"),
                },
                &[SolarInput {
                    site,
                    facts: SolarFacts {
                        coverage_from_wall_ms: 0,
                        coverage_to_wall_ms: 2000,
                        rows: &rows,
                    },
                }],
            )
            .unwrap_err();
        assert_eq!(err.message(), expected);
    }
    let too_long = [SolarFact::available(0, 1000, &"x".repeat(129), "zone")];
    assert_eq!(
        solar_tick(&mut runtime, 1, 1000, &too_long)
            .unwrap_err()
            .message(),
        "solar provider revision exceeds limit"
    );
    assert_eq!(runtime.journal().len(), 1);
    let mut forged_identity = SolarFact::available(0, 1000, "solar", "zone");
    forged_identity.slot_key = 1;
    assert_eq!(
        solar_tick(&mut runtime, 1, 1000, &[forged_identity])
            .unwrap_err()
            .message(),
        "Solar facts cannot contain a civil fold"
    );
    assert_eq!(runtime.journal().len(), 1);
    assert_eq!(
        solar_tick(&mut runtime, 1, 1000, &rows)
            .unwrap()
            .safe_intents["due"],
        Value::Bool(true)
    );

    let mut bounded = Runtime::new(4);
    bounded.install(Module::load(&Fixture::default().bytes()).unwrap(), false);
    bounded
        .activate_with_solar(&ghostflow_core::solar_runtime::SolarActivation {
            boot_epoch: 3,
            terminal_capacity: 1,
        })
        .unwrap();
    solar_tick(&mut bounded, 0, 999, &rows).unwrap();
    solar_tick(&mut bounded, 1, 1000, &rows).unwrap();
    let next = [SolarFact::available(1, 1001, "solar", "zone")];
    assert_eq!(
        solar_tick(&mut bounded, 2, 1001, &next)
            .unwrap_err()
            .message(),
        "solar terminal ledger capacity exceeded"
    );
    assert_eq!(bounded.journal().len(), 2);
}
#[test]
fn solar_predicates_can_read_preceding_schedule_projections() {
    use ghostflow_core::{
        schedule_clock::{ClockSnapshot, ClockTrust},
        solar_admission::{SolarFact, SolarFacts},
        solar_runtime::SolarInput,
    };
    let mut fixture = Fixture::default();
    let second = Solar {
        site: 8,
        name: "second".into(),
        when: vec![58, 0, 0, 0],
        ..Solar::default()
    };
    fixture.entries.push(second.bytes());
    fixture.output = vec![58, 1, 0, 0];
    let mut runtime = Runtime::new(4);
    runtime.install(Module::load(&fixture.bytes()).unwrap(), false);
    runtime.activate_with_solar(&solar_activation()).unwrap();
    let rows = [SolarFact::available(0, 1000, "solar", "zone")];
    for (now, wall, due) in [(0, 999, false), (1, 1000, true), (2, 1001, false)] {
        runtime
            .set_input("__gf_now_ms", Value::Number(now as f64))
            .unwrap();
        runtime
            .set_input("__gf_time_epoch", Value::Number(3.0))
            .unwrap();
        let facts = SolarFacts {
            coverage_from_wall_ms: 0,
            coverage_to_wall_ms: 2000,
            rows: &rows,
        };
        let tick = runtime
            .tick_with_solar(
                ClockSnapshot {
                    monotonic_ms: now,
                    boot_epoch: 3,
                    wall_ms: Some(wall),
                    trust: ClockTrust::Trusted,
                    uncertainty_ms: Some(0),
                    source_revision: Some("clock"),
                },
                &[SolarInput { site: 7, facts }, SolarInput { site: 8, facts }],
            )
            .unwrap();
        assert_eq!(tick.safe_intents["due"], Value::Bool(due));
        assert_eq!(tick.schedule_trace.len(), 2);
    }
}
