# Value::value_type extraction: unsupported F64 (#590)

The production source is `crates/ghostflow-core/src/lib.rs` at commit
`645b6899f325b0d1d24a1398f2f70af8d9f44787` (whole-file SHA-256
`9115f4a05d7e55be9674473796f6be214bada56fa1bb8177845ea495f1314bf4`).
The selected function is `Value::value_type` at lines 103–109, with `Type` at
53–57 and `Value` at 96–100. Charon/Aeneas extracted the actual production
function using `start_from: ["crate::Value::value_type"]` for
`x86_64-apple-darwin` (64-bit pointer). The LLBC reports `has_errors: false`.

| Original extraction artifact | SHA-256 |
| --- | --- |
| `ValueType.llbc` | `a821987c70535e054100044f37f85b62e18c5fffbd84c2daf0f5676dc13e0332` |
| `lean-value-type/ValueType.lean` | `0f4ffc54734ce6e19edf930ed9681aff9386f3242c0640faee625bdecfcc8321` |
| `lean-value-type/translation.json` | `a2e273827b38ddb77359dbb7c93f1e503b33cee17779d8e029c7177b8bc25b93` |

With Lean 4.35.0 and pinned Aeneas `399081f237935f9aa805f2d4a51fd3784aea11a9`
(Charon `2ec7e964e1032c59220e726840a9ac7d7684be2f`), the generated
module does not compile. The `Value.Number` constructor contains `F64`, while
this pinned Aeneas Lean library has no `F64` declaration. Lean reports:

```text
ValueType.lean:38:0: error: Constructor field `F64` of `GhostFlowValueType.Value.Number` contains universe level metavariables
ValueType.lean:46:4: error: Invalid pattern: Expected a constructor or constant marked with `[match_pattern]`
ValueType.lean:44:55: error: elabDoMatch: `sorryAx` is not a matcher
```

The last two errors follow the failed constructor elaboration. No ValueType
kernel theorem is claimed. The existing Reader foundation proof remains the
verified unit; its helper and generated source are unchanged. The direct Lean
compilation result and original extraction artifacts are retained under ignored
`build/evidence/value-type-unsupported-f64/` in the investigation worktree.
`direct-lean-compilation.json` records the exact command, search paths, exit
code 1, and complete output; its SHA-256 is
`66e56ee8220738c427edcce9ceb97bf27d9d82929b158a6f4de10277910db213`.
The Rust compiler, Charon/Aeneas translation, standard-library model, and host
rather than ESP32 target remain separate trust and scope boundaries.
