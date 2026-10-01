//! Software-only finite resource binding tape; no device adapter is involved.
use ghostflow_core::{
    resource_constraints::ResourceBindingRegistry, Capability, Module, Runtime, Value,
};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() < 4 {
        return Err(
            "usage: resource_tape module.gfb activation.gfrb scan.gfrs name=true,... [...]".into(),
        );
    }
    let module = Module::load(&std::fs::read(&args[0])?)?;
    let capabilities: Vec<_> = module
        .input_fields()
        .map(|(n, t)| Capability::new("sensor", n, t))
        .chain(
            module
                .output_fields()
                .map(|(n, t)| Capability::new("actuator", n, t)),
        )
        .collect();
    let mut runtime = Runtime::new(4096);
    runtime.install(module, false);
    // Explicit capabilities supplied by the tape's finite port names.
    for capability in capabilities {
        runtime.add_capability(capability)?;
    }
    let registry = ResourceBindingRegistry::new();
    runtime.activate_with_resource_binding(&std::fs::read(&args[1])?, &registry)?;
    let scan = std::fs::read(&args[2])?;
    for frame in &args[3..] {
        for pair in frame.split(',') {
            let (name, value) = pair.split_once('=').ok_or("invalid input pair")?;
            let value = match value {
                "true" => true,
                "false" => false,
                _ => return Err("invalid Bool input".into()),
            };
            runtime.set_input(name, Value::Bool(value))?;
        }
        println!("{}", runtime.tick_with_resource_binding(&scan)?.to_json());
    }
    Ok(())
}
