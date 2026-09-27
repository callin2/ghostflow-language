use ghostflow_core::{Module, Runtime, Type};

#[derive(Clone)]
struct Window {
    site: u32,
    name: String,
    operation: u8,
    ty: u8,
    over: u64,
    age: u64,
    roots: Vec<u16>,
    source: [Vec<u8>; 6],
}
impl Default for Window {
    fn default() -> Self {
        Self {
            site: 1,
            name: "mean".into(),
            operation: 0,
            ty: 2,
            over: 1000,
            age: 500,
            roots: vec![0],
            source: [vec![1, 1], vec![34], vec![35], vec![33], vec![33], vec![33]],
        }
    }
}
#[derive(Clone)]
struct Fixture {
    version: u16,
    inputs: Vec<(String, u8)>,
    states: u16,
    clock: u16,
    epoch: u16,
    roots: Vec<(u32, String, [u16; 4])>,
    windows: Vec<Window>,
    query: Vec<u8>,
    output_type: u8,
    output: Vec<u8>,
    second_empty_strategy: bool,
}
impl Default for Fixture {
    fn default() -> Self {
        Self {
            version: 4,
            inputs: vec![
                ("__gf_now_ms".into(), 2),
                ("__gf_time_epoch".into(), 2),
                ("present".into(), 1),
                ("epoch".into(), 2),
                ("id".into(), 2),
                ("timestamp".into(), 2),
            ],
            states: 0,
            clock: 0,
            epoch: 1,
            roots: vec![(1, "sensor".into(), [2, 3, 4, 5])],
            windows: vec![Window::default()],
            query: vec![5, 1],
            output_type: 2,
            output: vec![57, 0, 0, 1],
            second_empty_strategy: false,
        }
    }
}
fn string(out: &mut Vec<u8>, value: &str) {
    out.extend((value.len() as u16).to_le_bytes());
    out.extend(value.as_bytes());
}
fn blob(out: &mut Vec<u8>, value: &[u8]) {
    out.extend((value.len() as u32).to_le_bytes());
    out.extend(value);
}
impl Fixture {
    fn bytes(&self) -> Vec<u8> {
        let mut b = b"GFB1".to_vec();
        b.extend(self.version.to_le_bytes());
        string(&mut b, "temporal");
        b.extend(1u32.to_le_bytes());
        b.extend((self.inputs.len() as u16).to_le_bytes());
        for (name, ty) in &self.inputs {
            string(&mut b, name);
            b.push(*ty);
        }
        b.extend(self.states.to_le_bytes());
        for i in 0..self.states {
            string(&mut b, &format!("state{i}"));
            b.extend([1, 0]);
        }
        if self.version == 4 {
            b.extend(self.clock.to_le_bytes());
            b.extend(self.epoch.to_le_bytes());
            b.extend((self.roots.len() as u16).to_le_bytes());
            for (tag, name, inputs) in &self.roots {
                b.extend(tag.to_le_bytes());
                string(&mut b, name);
                for input in inputs {
                    b.extend(input.to_le_bytes());
                }
            }
        }
        let strategy_count = if self.second_empty_strategy {
            2u16
        } else {
            1u16
        };
        b.extend(strategy_count.to_le_bytes());
        for strategy in 0..strategy_count {
            string(&mut b, if strategy == 0 { "main" } else { "second" });
            b.extend(0i32.to_le_bytes());
            blob(&mut b, &self.query);
            if self.version == 4 {
                let windows = if strategy == 0 {
                    self.windows.as_slice()
                } else {
                    &[]
                };
                b.extend((windows.len() as u16).to_le_bytes());
                for w in windows {
                    b.extend(w.site.to_le_bytes());
                    string(&mut b, &w.name);
                    b.extend([w.operation, w.ty]);
                    b.extend(w.over.to_le_bytes());
                    b.extend(w.age.to_le_bytes());
                    b.extend((w.roots.len() as u16).to_le_bytes());
                    for root in &w.roots {
                        b.extend(root.to_le_bytes());
                    }
                    for expression in &w.source {
                        blob(&mut b, expression);
                    }
                }
            }
            b.extend(0u16.to_le_bytes());
            b.extend(1u16.to_le_bytes());
            string(&mut b, "value");
            b.push(self.output_type);
            blob(&mut b, &self.output);
        }
        b.extend(0u16.to_le_bytes());
        b
    }
}
fn rejected(f: &Fixture, message: &str) {
    match Module::load(&f.bytes()) {
        Err(error) => assert_eq!(error.message(), message),
        Ok(_) => panic!("accepted invalid module: {message}"),
    }
}

#[test]
fn gfb4_exposes_verified_temporal_requirements_and_refuses_activation() {
    let module = Module::load(&Fixture::default().bytes()).unwrap();
    let requirements = module.temporal_requirements().unwrap();
    assert_eq!(requirements.now_input, 0);
    assert_eq!(requirements.time_epoch_input, 1);
    assert_eq!(requirements.roots[0].source_tag, 1);
    assert_eq!(
        requirements.strategies[0].windows[0].payload_type,
        Type::Number
    );
    assert_eq!(requirements.strategies[0].windows[0].over_ms, 1000);
    let mut runtime = Runtime::new(2);
    runtime.install(module, false);
    assert_eq!(
        runtime.activate().unwrap_err().message(),
        "temporal activation requires runtime bindings"
    );
    assert!(runtime.active_strategy().is_none());
}

#[test]
fn gfb4_all_projection_types_and_prior_dependencies_are_verified() {
    for field in 0..8 {
        let f = Fixture {
            output_type: if field == 0 { 1 } else { 2 },
            output: vec![57, 0, 0, field],
            ..Fixture::default()
        };
        assert!(Module::load(&f.bytes()).is_ok(), "projection {field}");
    }
    let mut f = Fixture::default();
    f.windows[0].operation = 1;
    f.windows[0].ty = 3;
    f.windows[0].source[1] = vec![23, 42, 0, 0, 0];
    f.output_type = 3;
    assert!(Module::load(&f.bytes()).is_ok());
    let mut second = Window {
        site: 2,
        name: "second".into(),
        ..Window::default()
    };
    second.source[1] = vec![57, 0, 0, 1, 48];
    f.windows.push(second);
    f.output_type = 2;
    f.output = vec![57, 1, 0, 1];
    assert!(Module::load(&f.bytes()).is_ok());
}

#[test]
fn gfb4_root_bindings_reject_aliases_wrong_types_and_missing_inputs() {
    let mut f = Fixture::default();
    f.clock = 99;
    rejected(&f, "invalid temporal clock input");
    f = Fixture::default();
    f.epoch = 0;
    rejected(&f, "invalid temporal clock input");
    f = Fixture::default();
    f.inputs[1].1 = 3;
    rejected(&f, "invalid temporal clock input");
    for role in 0..4 {
        f = Fixture::default();
        f.roots[0].2[role] = 99;
        rejected(&f, "invalid temporal root input");
    }
    f = Fixture::default();
    f.roots[0].2[3] = 4;
    rejected(&f, "duplicate temporal input binding");
    f = Fixture::default();
    f.roots[0].0 = 0;
    rejected(&f, "invalid temporal root tag");
    f = Fixture::default();
    f.inputs.extend([
        ("present2".into(), 1),
        ("epoch2".into(), 2),
        ("id2".into(), 2),
        ("timestamp2".into(), 2),
    ]);
    f.roots.push(f.roots[0].clone());
    rejected(&f, "invalid temporal root tag");
}

#[test]
fn gfb4_requires_exact_clock_names_nonempty_roots_and_a_window() {
    let mut f = Fixture::default();
    f.inputs[0].0 = "clock".into();
    rejected(&f, "invalid temporal clock input");
    f = Fixture::default();
    f.inputs[1].0 = "epochClock".into();
    rejected(&f, "invalid temporal clock input");
    f = Fixture::default();
    f.roots.clear();
    rejected(&f, "invalid temporal root count");
    f = Fixture::default();
    f.windows.clear();
    f.output = vec![32];
    rejected(&f, "GFB format 4 requires a window");
    let plain = Fixture {
        version: 3,
        output: vec![32],
        ..Fixture::default()
    };
    let mut runtime = Runtime::new(2);
    runtime.install(Module::load(&plain.bytes()).unwrap(), false);
    runtime.activate().unwrap();
    assert_eq!(
        runtime
            .hot_swap(Module::load(&Fixture::default().bytes()).unwrap())
            .unwrap_err()
            .message(),
        "temporal activation requires runtime bindings"
    );
    assert_eq!(runtime.active_strategy(), Some("main"));
}

#[test]
fn gfb4_multiple_roots_require_canonical_tags_names_bindings_and_references() {
    let mut valid = Fixture::default();
    valid.inputs.extend([
        ("present2".into(), 1),
        ("epoch2".into(), 2),
        ("id2".into(), 2),
        ("timestamp2".into(), 2),
    ]);
    valid.roots.push((2, "other".into(), [6, 7, 8, 9]));
    valid.windows[0].roots = vec![0, 1];
    assert!(Module::load(&valid.bytes()).is_ok());
    let mut f = valid.clone();
    f.roots.swap(0, 1);
    rejected(&f, "invalid temporal root tag");
    f = valid.clone();
    f.roots[1].1 = "sensor".into();
    rejected(&f, "duplicate temporal root name");
    f = valid.clone();
    f.roots[1].2[2] = 4;
    rejected(&f, "duplicate temporal input binding");
    for refs in [vec![1, 0], vec![1, 1], vec![0, 2]] {
        f = valid.clone();
        f.windows[0].roots = refs;
        rejected(&f, "invalid temporal window roots");
    }
    f = valid;
    f.roots[1].2[1] = 0;
    rejected(&f, "duplicate temporal input binding");
}

#[test]
fn gfb4_inherits_format3_operations_and_verifies_unselected_branches() {
    let mut f = Fixture::default();
    // if true then number(7i) else 0, with both branch stack shapes Number.
    f.windows[0].source[1] = vec![1, 1, 30, 9, 0, 23, 7, 0, 0, 0, 48, 31, 1, 0, 32];
    assert!(Module::load(&f.bytes()).is_ok());
    f.windows[0].source[1] = vec![1, 1, 30, 4, 0, 32, 31, 2, 0, 1, 0];
    rejected(&f, "branch stack mismatch");
    for guard in [54, 55] {
        f = Fixture::default();
        f.windows[0].source[1] = vec![32, guard];
        assert!(Module::load(&f.bytes()).is_ok());
    }
    f = Fixture::default();
    f.windows[0].source[1] = vec![32, 32, 32, 56, 1, 0, 0, 0];
    assert!(Module::load(&f.bytes()).is_ok());
    for op in [11, 12, 18] {
        f = Fixture::default();
        f.windows[0].source[1] = vec![op];
        rejected(&f, "unknown expression opcode");
    }
}

#[test]
fn gfb4_window_descriptors_reject_invalid_domains_and_root_references() {
    let mut f = Fixture::default();
    f.windows[0].site = 0;
    rejected(&f, "invalid temporal window site");
    f = Fixture::default();
    f.windows.push(f.windows[0].clone());
    rejected(&f, "invalid temporal window site");
    f = Fixture::default();
    f.windows[0].operation = 4;
    rejected(&f, "invalid temporal operation");
    for (operation, ty) in [(0, 3), (3, 3), (1, 1)] {
        f = Fixture::default();
        f.windows[0].operation = operation;
        f.windows[0].ty = ty;
        rejected(&f, "invalid temporal payload type");
    }
    for value in [0, 9_007_199_254_740_992, u64::MAX] {
        f = Fixture::default();
        f.windows[0].over = value;
        rejected(&f, "invalid temporal duration");
        f.windows[0].over = 1000;
        f.windows[0].age = value;
        rejected(&f, "invalid temporal duration");
    }
    for refs in [vec![], vec![1], vec![0, 0]] {
        f = Fixture::default();
        f.windows[0].roots = refs;
        rejected(&f, "invalid temporal window roots");
    }
}

#[test]
fn gfb4_verifies_every_source_blob_even_when_source_is_faulted() {
    for role in 0..6 {
        let mut f = Fixture::default();
        f.windows[0].source[0] = vec![1, 0];
        f.windows[0].source[role] = if role == 0 { vec![32] } else { vec![1, 0] };
        rejected(&f, "temporal source expression type mismatch");
    }
    let mut f = Fixture::default();
    f.states = 1;
    f.windows[0].source[0] = vec![5, 0, 0];
    rejected(&f, "next outside intent");
}

#[test]
fn gfb4_projection_rejects_forward_missing_field_and_wrong_context() {
    let mut f = Fixture::default();
    f.windows[0].source[1] = vec![57, 0, 0, 1];
    rejected(&f, "temporal projection index");
    f = Fixture::default();
    f.output = vec![57, 1, 0, 1];
    rejected(&f, "temporal projection index");
    f = Fixture::default();
    f.output = vec![57, 0, 0, 8];
    rejected(&f, "temporal projection field");
    for code in [vec![57], vec![57, 0], vec![57, 0, 0]] {
        f = Fixture::default();
        f.output = code;
        rejected(&f, "truncated bytecode");
    }
    for version in 1..=3 {
        f = Fixture::default();
        f.version = version;
        rejected(&f, "temporal projection requires GFB format 4");
    }
    f = Fixture::default();
    f.query = vec![57, 0, 0, 0];
    rejected(&f, "query opcode");
    f = Fixture::default();
    f.second_empty_strategy = true;
    rejected(&f, "temporal projection index");
}

#[test]
fn gfb4_int_queries_and_empty_other_preludes_preserve_profile_contract() {
    let mut f = Fixture::default();
    f.query = vec![1];
    string(&mut f.query, "actuator");
    string(&mut f.query, "count");
    f.query.push(3);
    f.second_empty_strategy = true;
    f.output = vec![32];
    let module = Module::load(&f.bytes()).unwrap();
    let requirements = module.temporal_requirements().unwrap();
    assert_eq!(requirements.strategies.len(), 2);
    assert!(requirements.strategies[1].windows.is_empty());
    f = Fixture::default();
    f.windows.push(Window {
        site: 2,
        ..Window::default()
    });
    rejected(&f, "duplicate temporal window name");
    f = Fixture::default();
    f.roots[0].2[0] = 3;
    rejected(&f, "invalid temporal root input");
    f = Fixture::default();
    f.roots[0].2[1] = 2;
    rejected(&f, "invalid temporal root input");
}

#[test]
fn gfb4_preserves_existing_expression_stack_and_total_state_limits() {
    let mut f = Fixture::default();
    f.states = 127;
    assert!(Module::load(&f.bytes()).is_ok());
    f.states = 128;
    rejected(&f, "temporal state limit exceeded");
    f = Fixture::default();
    f.windows[0].source[1] = vec![32; 4097];
    rejected(&f, "expression byte limit");
    f = Fixture::default();
    f.windows[0].source[1] = vec![32; 129];
    rejected(&f, "stack limit");
    f = Fixture::default();
    f.output = vec![57, 0, 0, 0];
    rejected(&f, "intent type mismatch");
    f = Fixture::default();
    f.version = 255;
    rejected(&f, "unsupported GFB format");
}

#[test]
fn gfb4_rejects_truncation_at_every_byte_and_trailing_data() {
    let bytes = Fixture::default().bytes();
    for end in 0..bytes.len() {
        assert!(Module::load(&bytes[..end]).is_err(), "truncated at {end}");
    }
    let mut bytes = bytes;
    bytes.push(0);
    match Module::load(&bytes) {
        Err(error) => assert_eq!(error.message(), "trailing module bytes"),
        Ok(_) => panic!("trailing data accepted"),
    }
}
