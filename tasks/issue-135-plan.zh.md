<!-- translation-source: tasks/issue-135-plan.md -->
[英文原文](issue-135-plan.md)

# Issue 135：第一个可执行的调度计划切片

跟踪：https://github.com/callin2/ghostflow-language/issues/135

这次注明日期的实现工作只针对 `REF-03-024`（`Daily`）。

- 未修改的规范文学式测试夹具必须编译为可执行的控制产物，并通过现有的 Rust VM 路径运行。
- 宿主适配器可以提供一组有界且完整的触发实例（occurrence）事实。
- 谓词求值、时钟/准入状态、投影、事务提交和意图仍由 Rust 负责。

## 测试先行

1. 记录该确切测试夹具当前在描述符产物门禁处的失败。
2. 添加一个聚焦的可执行 Reference 判定（oracle），包含一个启动基线和一次 Daily 跨越。测试夹具源和预期的语言契约保持不变。
3. 添加现有调度计划运行时测试框架所支持的最小 native/WASM 一致性检查。

## 实现边界

- 复用 `schedule_clock` 以及有界的调度计划准入/运行时机制。
- 架构评审批准了独立的 GFB8/tag-3 Daily 描述符和 control-v7 manifest。
  - GFB7 仍仅用于 PID。
  - GFSF v2 传输显式的触发类型和民用时间折叠（civil fold）。
  - 当前的 Solar 使用方保持 GFSF v1。
- 将 IANA 触发实例生成和上下文修订版保留在提供方/适配器边界上。不要添加 JavaScript 的表达式、状态、准入或意图 VM。
- 保留 Unknown 原因、启动/恢复基线、间隙终态化、回滚、触发实例身份标识、DST 策略字段以及确切的源身份标识。
- 本切片不改变 DailySlots、Periodic、Cron、TimeSlots、WorkCalendar 或 Tide 的行为。

## 文件归属

- issue-135 工作者负责本计划、聚焦的调度计划/编译器/运行时文件，以及 `REF-03-024` 的聚焦测试。
- 它不编辑 `tasks/plan.md` 或时间相关工作者的用例。
- 共享的 `tests/reference/cases/02-time-control.json` 测试夹具是只读的，除非确实需要一个合法的可执行输入上下文。其源和预期保持不变。

## 验收

- 修改前的聚焦测试因已知的“仅描述符”原因而为 red。
- 未修改的 `REF-03-024` 源生成可执行产物。
- `ghostsim` 通过 Rust 执行一个基线和一次被接受的 Daily 跨越。
- 目标测试通过，并且更改在本地提交，不进行 push、merge、USB 或硬件工作。

## Native/编译器检查点（2026-09-24）

- **提交：** `9916c41` 实现了常量 Daily pulse 切片以及独立的 native/WASM 激活/tick 入口点。它保留了未修改的 REF-03-024 源。
- **记录的 red：**
  - REF-03-024 仅描述符的执行失败
  - 缺少 fold 身份标识
  - 不可用的上下文被错误地报告为 BootBaseline
  - Unknown 观测中丢失了提供方/上下文修订版
- **Green：** native 调度计划测试 24 个、准入测试 9 个、fold 测试 2 个；编译器、源身份标识、Solar 回归以及底层 Daily WASM 测试 18 个。
- **尚未声明：** 宿主 ControlRuntime 和 ghostsim 集成另行分配。此检查点不声称该集成已完成。
- **详情：** ABI 细节和提供方职责见 `docs/reports/2026-09-24-issue-135-daily-abi.md`。
