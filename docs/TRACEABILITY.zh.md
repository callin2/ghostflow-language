<!-- translation-source: docs/TRACEABILITY.md -->
[英文原文](TRACEABILITY.md)

# 语言实现与检查

本页将每一项语言契约映射到实现它的代码以及检查它的测试。

本页只告诉你保留的测试**位于何处**，并不说明它们是否通过。要了解运行过哪些检查以及哪些已通过，请阅读当前
checkout 的[验证报告](VERIFICATION.zh.md)。此表也不沿用源工作区中的任何完成度声明或硬件声明。

| 契约 | 实现 | 验证 |
|---|---|---|
| 现代控制语法、类型、降级（lowering） | `tools/control.mjs`、`tools/gfb1.mjs` | `tests/control.test.mjs`、`tests/compiler.test.mjs` |
| 文学式源文件提取与原始位置 | `tools/literate.mjs`、`tools/toolchain.mjs` | `tests/literate.test.mjs`、`tests/toolchain.test.mjs` |
| 经过验证的 VM/状态/意图语义 | `crates/ghostflow-core/src/lib.rs` | Rust 单元测试、原生/WASM 教程一致性 |
| 带类型的宿主输入与清单/哈希检查 | `runtimes/wasm/control-runtime.mjs` | `tests/control-host.test.mjs` |
| 传感器调理与信号 | core `signals.rs`、WASM signals ABI/适配器 | Rust 测试、`tests/signals-wasm.test.mjs`、土壤湿度教程 |
| 独立约束与绑定 | `tools/constraints.mjs`、`runtimes/wasm/policy.mjs` | `tests/constraints.test.mjs`、`tests/policy.test.mjs` |
| 调度触发实例与固定 ID | WASM schedule/admission 适配器 | `tests/schedule.test.mjs`、`tests/scheduled-admission.test.mjs` |
| 站点所有权、配额与持久化 | core `station.rs`、WASM station ABI、Node 账本 | Rust 测试、`tests/station-wasm.test.mjs`、`tests/ledger.test.mjs`、站点演示 |
| 原生/WASM 上相同的生成输入追踪 | `tools/tutorial.mjs`、core 原生运行器 | 教程断言与生成的追踪 |
| 发布身份标识与执行证据 | `tools/integration-contract.mjs`、`contracts/integration-v1` | `tests/integration-contract.test.mjs`（虚构 fixture） |

有两类检查位于本仓库之外：

- 跨项目的发布来源（provenance）以及设备/API/前端检查，属于集成项目和使用方项目。
- 原始任务和对话历史保留在私有迁移工作区中。
