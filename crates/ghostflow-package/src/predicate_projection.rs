//! Re-encode the owner's signed predicate projection, without evaluating it.
//! Matches tools/core-ir.mjs and tools/gfb1.mjs emission. The loaded core module
//! already validates executable types; byte equality binds this presentation IR.
use ghostflow_core::Module;
use serde_json::Value;

pub(crate) fn encode(value: &Value, module: &Module) -> Option<Vec<u8>> {
    fn branch(value: &Value) -> bool {
        value.as_array().is_some_and(|values| {
            matches!(
                values.first().and_then(Value::as_str),
                Some("and" | "or" | "if")
            ) || values.iter().any(branch)
        })
    }
    fn emit(
        value: &Value,
        module: &Module,
        compact: bool,
        depth: usize,
        nodes: &mut usize,
    ) -> Option<Vec<u8>> {
        *nodes += 1;
        if depth > 128 || *nodes > 4096 {
            return None;
        }
        if let Some(atom) = value.as_str() {
            if atom == "true" || atom == "false" {
                return Some(vec![1, u8::from(atom == "true")]);
            }
            if let Some((namespace, name)) = atom.split_once('.') {
                let index = match namespace {
                    "input" => module.input_fields().position(|(actual, _)| actual == name),
                    "state" => module
                        .state_fields()
                        .position(|(actual, _, _)| actual == name),
                    _ => None,
                };
                if let Some(index) = index {
                    let mut bytes = vec![if namespace == "input" { 3 } else { 4 }];
                    bytes.extend(u16::try_from(index).ok()?.to_le_bytes());
                    return Some(bytes);
                }
            }
            let number: f64 = atom.parse().ok()?;
            if !number.is_finite() {
                return None;
            }
            if compact
                && number.fract() == 0.0
                && (0.0..=15.0).contains(&number)
                && !number.is_sign_negative()
            {
                return Some(vec![32 + number as u8]);
            }
            let mut bytes = vec![2];
            bytes.extend(number.to_le_bytes());
            return Some(bytes);
        }
        let values = value.as_array()?;
        let (head, args) = values.split_first()?;
        let head = head.as_str()?;
        let mut child = |value| emit(value, module, compact, depth + 1, nodes);
        if head == "int" && args.len() == 1 {
            let number: i32 = args[0].as_str()?.parse().ok()?;
            let mut bytes = vec![23];
            bytes.extend(number.to_le_bytes());
            return Some(bytes);
        }
        if matches!(head, "and" | "or" | "if") && args.len() == if head == "if" { 3 } else { 2 } {
            let mut bytes = child(&args[0])?;
            let yes = if head == "or" {
                vec![1, 1]
            } else {
                child(&args[1])?
            };
            let no = if head == "and" {
                vec![1, 0]
            } else {
                child(&args[if head == "if" { 2 } else { 1 }])?
            };
            bytes.push(30);
            bytes.extend(u16::try_from(yes.len() + 3).ok()?.to_le_bytes());
            bytes.extend(yes);
            bytes.push(31);
            bytes.extend(u16::try_from(no.len()).ok()?.to_le_bytes());
            bytes.extend(no);
            return Some(bytes);
        }
        if matches!(head, "window-read" | "schedule-read" | "true-for-read") && args.len() == 2 {
            let slot: u16 = args[0].as_str()?.parse().ok()?;
            let fields: &[&str] = match head {
                "window-read" => &[
                    "ok",
                    "value",
                    "fault",
                    "origin",
                    "revision",
                    "timestamp",
                    "count",
                    "quality",
                ],
                "schedule-read" => &["due", "missed", "active"],
                _ => &["ok", "value", "fault", "origin", "start", "end", "covered"],
            };
            let field = fields
                .iter()
                .position(|field| Some(*field) == args[1].as_str())?;
            let mut bytes = vec![match head {
                "window-read" => 57,
                "schedule-read" => 58,
                _ => 59,
            }];
            bytes.extend(slot.to_le_bytes());
            bytes.push(field as u8);
            return Some(bytes);
        }
        if head == "trace-result" && args.len() == 4 {
            let site: u32 = args[0].as_str()?.parse().ok()?;
            if site == 0 {
                return None;
            }
            let mut bytes = child(&args[1])?;
            bytes.extend(child(&args[2])?);
            bytes.extend(child(&args[3])?);
            bytes.push(56);
            bytes.extend(site.to_le_bytes());
            return Some(bytes);
        }
        let (opcode, arity) = match head {
            "not" => (10, 1),
            "eq" => (13, 2),
            "lt" => (14, 2),
            "lte" => (15, 2),
            "gt" => (16, 2),
            "gte" => (17, 2),
            "add" => (19, 2),
            "sub" => (20, 2),
            "mul" => (21, 2),
            "div" => (22, 2),
            "int-neg" => (24, 1),
            "int-add" => (25, 2),
            "int-sub" => (26, 2),
            "int-mul" => (27, 2),
            "int-div" => (28, 2),
            "int-rem" => (29, 2),
            "int-to-number" => (48, 1),
            "int-exact" => (49, 1),
            "int-floor" => (50, 1),
            "int-ceil" => (51, 1),
            "int-trunc" => (52, 1),
            "int-nearest-even" => (53, 1),
            "check-duration" => (54, 1),
            "check-datetime" => (55, 1),
            "check-percent" => (60, 1),
            _ => return None,
        };
        if args.len() != arity {
            return None;
        }
        let mut bytes = Vec::new();
        for arg in args {
            bytes.extend(child(arg)?);
        }
        bytes.push(opcode);
        Some(bytes)
    }
    emit(value, module, branch(value), 0, &mut 0)
}
