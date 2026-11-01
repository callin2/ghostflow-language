<!-- translation-source: docs/GFB5-SCHEDULE-PRELUDE.md -->
[英文原文](GFB5-SCHEDULE-PRELUDE.md)

# GFB5 调度计划前导段

GFB5 是一个**内部**字节码 profile，它在每个策略的*前导段*（prelude）中加入调度计划条目（目前为 Solar）。前导段是由窗口条目和调度计划条目组成的列表，策略的转移和意图可以引用其中的条目。其当前状态：

| 部分 | 状态 |
| --- | --- |
| 编码器 | 已实现 |
| 可移植的 Rust 结构校验器 | 已实现 |
| 规范源代码降级（lowering） | 未接入 |
| 调度计划执行 | 未接入 |
| 加载 | 结构有效的模块可以成功加载 |
| 激活、时间规划、热替换 | 以 `schedule activation requires runtime bindings` 拒绝 |

## 布局

magic 仍为 `GFB1`；小端格式版本为 `5`。

- 模块、输入、状态以及时间时钟/根各段保持现有布局。
- 仅含调度计划的模块可以没有物理根。窗口仍需要有效的根引用。
- 格式 5 的模块必须至少包含一个调度计划。对于仅含窗口的模块，编码器继续输出格式 4。

每个策略有一个 `u16` 前导段计数，其后紧跟相应数量的带标签条目：

- 标签 `0` 包含现有的 GFB4 窗口体。
- 标签 `1` 包含以下 Solar 体：

| 字段 | 编码与取值域 |
| --- | --- |
| site | `u32`，正数 |
| name | 现有的 GFB 字符串 |
| timezone | 非空且格式良好的 UTF-8 字符串，最多 128 字节 |
| latitude, longitude | `f64`，有限值；−90..90 和 −180..180 |
| event | `u8`：0 日出（rise），1 日落（set） |
| offsetMs | `i64`：−86400000..86400000 |
| basis | `u8`：0 pulse |
| clockPolicy | `u8`：0 trusted_only |
| recovery | `u8`：0 baseline |
| fallback | `u8`：0 skip |
| gapMs | `u64`：1..9007199254740991 |
| when | 现有的表达式 blob，结果为 Bool，最多 4096 字节 |

所有整数均为小端。策略标签是显式的；每个策略字段目前恰好只有一个已定义的值。其他语言策略需要进一步实现；本 profile 并不重新定义语言支持哪些策略。时区是否可用取决于 provider 绑定，不由结构解码确立。

**槽位与引用。**

- 窗口槽位和调度计划槽位按出现顺序分别编号。
- 操作码 57 仍读取窗口。操作码 58 为 `[58, u16 scheduleSlot, u8 field]`，其中 field 0 为 Bool 类型（`due`）。
- 每个前导段表达式只能引用之前的条目。转移和意图可以引用所有条目。
- 在每个策略内，site 和 name 必须在两类条目之间都唯一。
- 每个策略的标量状态加前导段条目总数不得超过 128。

## 身份标识与边界

字节码包含语义层面的局部声明身份标识。文档哈希以及外部的文档/修订版身份标识保留在经过验证的产物元数据中。仅涉及注释的源代码变更不得改变可执行字节。

内部编码器形式为：

```text
(solar-pulse SITE NAME TIMEZONE LAT LON EVENT OFFSET_MS
  pulse trusted_only GAP_MS baseline skip WHEN)
(schedule-read SLOT due)
```

这些形式不是额外的产品源代码格式。产品源代码仍是一个完整的 `.ghost.md` 文档。

针对性的证据位于 `tests/gfb5-schedule.test.mjs`、`tests/gfb5-browser.test.mjs`、`tests/gfb5-native.test.mjs` 和 `crates/ghostflow-core/tests/schedule_module.rs`。

- **它们验证：** 线格式字段、依赖顺序、格式错误的输入、边界以及激活拒绝。
- **它们不确立：** 预约准入、provider 的正确性、调度计划执行、持久的身份标识、资源核算或重放。
