<!-- translation-source: tests/reference/DECISIONS.en.md -->
[英文原文](DECISIONS.en.md)

# 原有 49 项待定决策的落定情况追踪

在最初编写各个 Reference 验收用例时，其中 49 个用例的状态为 `decision`：它们的预期含义取决于当时尚未确定的语法或策略。这 49 项现已全部落定。下表将每一项映射到当前定义它的 Reference 章节，以及它现在的验证形式。

现场特定的值**不是**待定的语法决策。运行时间、可接受的质量、设备选择和增益都属于此类：它们是由程序或设施（installation）契约显式声明的参数。这一区分遵循 [Reference §8.6](../../docs/reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책)。

表格阅读方法：

- **ID**：验收用例标识符。`REF-NN-…` 属于 Reference 第 `NN` 章（`00` 为[语言参考](../../docs/LANGUAGE-REFERENCE.md)概述）。
- **已落定的决策摘要**：解决原待定决策的规则。
- **Reference**：现在负责该规则的章节。链接指向规范的韩语章节。
- **验证形式**：[验收测试 README](README.zh.md) 中定义的用例状态：
  - `executable`（41 个用例）：针对已落定语法的编译器接受/拒绝用例，通过实际的 CLI 运行。
  - `specified`（8 个用例）：运行时、环境、Driver、UI 或工具的契约，写明了输入、行为和预期结果。只有带有有效的外部判定基准（oracle）链接时，才计为 `externally-covered`；否则仍为 TODO。两种结果都不计为 CLI 执行通过。

| ID | 已落定的决策摘要 | Reference | 验证形式 |
|---|---|---|---|
| `REF-00-010` | 两个复用的实例各自保持隔离的内存和来源（provenance）。 | [docs/LANGUAGE-REFERENCE.md §10](<../../docs/LANGUAGE-REFERENCE.md#10-잘-만든-예제-두-개를-가져왔으면-함께-쓸-수-있어야죠>) | `specified` |
| `REF-01-044` | 已移除的 purefn 别名不会被静默解释为 fn；它会被拒绝，并给出迁移诊断。 | [01-source-and-syntax.md](<../../docs/reference/01-source-and-syntax.md#16-대표-표기-참고-별칭과-역사적-대안>) | `executable` |
| `REF-01-045` | control 中的值声明共享同一个命名空间，即使声明种类不同也是如此；同一名称不能声明两次。 | [01-source-and-syntax.md](<../../docs/reference/01-source-and-syntax.md#17-소스-규칙의-장별-경계>)<br>[01-source-and-syntax.md](<../../docs/reference/01-source-and-syntax.md#이름-범위와-해석>) | `executable` |
| `REF-01-056` | 没有预期数值类型时，整数形式的字面量为 Int；带小数点或指数的字面量为 Number。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>) | `executable` |
| `REF-01-057` | 在已确立的 Number 上下文中，整数形式的字面量从一开始就是 Number，而不是运行时的 Int 到 Number 转换。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>) | `executable` |
| `REF-01-058` | 后续的使用绝不会追溯地改变无类型 let 的初始化表达式类型。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>) | `executable` |
| `REF-01-059` | 相互冲突的预期数值类型会产生诊断；编译器不会猜测重载。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>) | `executable` |
| `REF-01-060` | Int 字面量依据其原始十进制数字进行有符号 32 位范围检查；在负边界上，-2147483648 是唯一允许的值。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>)<br>[02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#23-정확한-정수-설계>) | `executable` |
| `REF-01-061` | 数字分隔符不属于 Int 字面量契约的一部分。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#22-리터럴과-기대-타입>) | `executable` |
| `REF-01-065` | Int/Number 转换须指明其舍入策略，并区分小数部分原因与超出范围原因。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#명시적-변환>) | `executable` |
| `REF-01-086` | if、&& 和 \|\| 从左到右确定性地短路求值，因此未被选中、可能引发运行时故障的表达式绝不会被执行。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#조건식>) | `specified` |
| `REF-01-092` | 普通函数名不能作为值存储；语言不引入通用高阶函数或运行时函数选择。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#27-순수-함수와-계산-조합>) | `executable` |
| `REF-01-106` | Temperature、Pressure 和 FlowRate 使用带有已批准单位后缀的字面量。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#29-물리량과-단위>) | `executable` |
| `REF-01-107` | 比较两个不同的名义量会被拒绝。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#29-물리량과-단위>) | `executable` |
| `REF-01-108` | Percent 位置与 RelativeHumidity 是不同的名义类型，即使它们在屏幕上看起来相似。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#29-물리량과-단위>) | `executable` |
| `REF-01-109` | 通用的 Date、TimeOfDay 和 DateTime 值分别使用 date、time 和 datetime 标记字面量；DateTime 必须带有偏移量。 | [02-types-expressions-state.md](<../../docs/reference/02-types-expressions-state.md#210-확정된-타입-경계>)<br>[03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#date-timeofday-datetime>) | `executable` |
| `REF-03-008` | date/time/datetime 标记字面量产生精确的公历、毫秒精度的值；DateTime 必须带有 Z 或 -14:00 到 +14:00 之间的数字偏移量。 | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#date-timeofday-datetime>) | `executable` |
| `REF-03-015` | continuous_true(Bool) 是一个公开的定时器声明，用于测量不间断为真的时间段。它不同于经过时间，也不同于累计 ON 时间。 | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#33-bool이-연속으로-참인-시간>) | `executable` |
| `REF-03-024` | trigger 和 basis 是两个独立的类型化字段。Daily 调度计划须显式声明 timezone、DST、basis、when、clock、gap、recovery 和 fallback。 | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#35-schedule의-공통-의미>) | `executable` |
| `REF-03-036` | Periodic 要求 every 为正的 Duration，显式的 anchor 和 interval_change，以及通用的调度计划策略。 | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#periodic>) | `executable` |
| `REF-03-038` | Cron 要求一个按分、时、日、月、星期顺序书写的 cron5 字面量，外加显式的 timezone、DST 策略以及通用策略。 | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#cron5>) | `executable` |
| `REF-03-050` | resource/event/account/used/rolling/local_day/limit 语法显式声明阶段、持久化和预留，并将时间预算、事件计数和触发实例（occurrence）once 彼此分开。 | [03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#310-시간-기반-사용량-제약>)<br>[03-time-and-schedules.md](<../../docs/reference/03-time-and-schedules.md#311-확정된-시간-문법과-경계>) | `executable` |
| `REF-04-004` | below、map、and_then 和 recover 是纯变换，遵守兼容的物理量，并保留 Result 错误。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#41-sensor와-result-품질>) | `executable` |
| `REF-04-020` | 只有当候选值在整个为正的稳定 Duration 内保持不变时，debounce 才会改变稳定值。它保存稳定值、候选值以及候选值的单调起始时间。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#bounded-signal-연산의-설계-계약>) | `executable` |
| `REF-04-021` | moving_average(n) 只对最近 n 个有效的新数值样本求平均。窗口未满时为 NotReady，状态上限为 n 项。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#bounded-signal-연산의-설계-계약>) | `executable` |
| `REF-04-022` | ema 的 alpha 为有限值，且 0<alpha<=1。ema 以第一个有效样本作为初值，在恢复之前不产生健康结果。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#bounded-signal-연산의-설계-계약>) | `executable` |
| `REF-04-025` | condition for d 要求在整个为正的 Duration 内持续、不间断地保持可接受的 true；出现 false 或不可接受的质量都会使其重置。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-026` | within d 仅在参考事件之后的半开区间内才认定条件已满足。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-027` | average(x,d) 只使用考虑质量、带时间戳的观测。它不会把稀疏样本插值为连续的测量真值。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-028` | min/max 只计算窗口内可接受观测的极值。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-029` | window_rate 将受支持的有序数值载荷的两次观测之差除以经过时间。结果是仅限表达式使用的 Rate<Q>：它不能被存储，也不能用于不受限制的算术运算。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-031` | hold 仅在显式的 Duration 和质量策略范围内保留先前的值，并产生 Held 来源。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence>) | `executable` |
| `REF-04-035` | 可选能力（capability）只能在 adapt 策略的 match 内读取。选择时挑选 i32 优先级最高的一个 match，缺失绝不会被转换为零或健康值。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#45-선택-sensor와-capability>) | `executable` |
| `REF-04-037` | where 只读取已匹配的能力元数据和常量 Bool 组合。它绝不读取样本、状态、下一状态或当前值。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#46-device-query와-strategy-선택>) | `executable` |
| `REF-04-044` | exclusive、allow enter、require、limit、once、check 和 warn 各有其自身的应用阶段和结果。所有强制约束一起进行 AND 运算，优先级绝不会放宽它们。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#48-공통-constraints-표기와-연산>) | `executable` |
| `REF-04-045` | count_on 统计最终候选中不同物理项的数量；any_on 检查一个显式的有限集合。对于空集，它们分别得到 0 和 false。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#48-공통-constraints-표기와-연산>) | `executable` |
| `REF-04-050` | 同一 tick 中的请求基于同一快照一起预留租约和预算，使用有界队列/过期机制和显式的平局策略。并发和抢占需要显式启用（opt-in）。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#49-공유-자원과-arbitration>) | `executable` |
| `REF-04-058` | 连续控制目标将质量度量、兼容的目标值、语义执行器目标、控制器策略以及与能力取交集后的输出范围连接起来。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#412-continuous-control-objective>) | `executable` |
| `REF-04-059` | PI/PID 必须显式声明为正的采样周期、兼容的有限值、方向、带量纲的增益、输出钳位、抗积分饱和、启用、无扰切换、故障以及重启策略。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#pipid-의미에-필요한-항목>) | `executable` |
| `REF-04-061` | 降级的 fallback 须声明其能力、可接受的质量、输出边界和权限。它绝不会绕过全局约束、资源或模式。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#413-explicit-fallback과-degraded-control>) | `executable` |
| `REF-04-063` | 自适应是针对类型化设置/设定值的有界提议，而不是对程序或输出的直接权限。它携带值、来源/模型、证据以及程序/设置的身份标识。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#414-bounded-adaptation>) | `executable` |
| `REF-04-067` | Reference 04 中确定的控制面与其他章节负责的边界保持一致：滚动用量核算、通用物理量/质量以及绑定/设置记录。 | [04-sensors-constraints-control.md](<../../docs/reference/04-sensors-constraints-control.md#416-확정된-control-문법과-장별-경계>) | `specified` |
| `REF-05-018` | 临时设置绑定到某一个 Program，不会自动沿用到另一个 Program。 | [05-settings-and-observation.md](<../../docs/reference/05-settings-and-observation.md#생명주기와-임시-설정>) | `specified` |
| `REF-06-010` | 由精确文档摘要固定的导入，其实例和类型化端口可以被连接。 | [06-composition-and-replay.md](<../../docs/reference/06-composition-and-replay.md#64-import와-연결의-문법>) | `executable` |
| `REF-06-023` | 类型化表达式宏在 quote/splice 展开后，照常经过状态和类型检查。 | [06-composition-and-replay.md](<../../docs/reference/06-composition-and-replay.md#610-syntax-quote-splice의-문법>) | `executable` |
| `REF-08-013` | 日历/DST 提供者给出的触发实例结果与 §3 中的显式策略相同。 | [08-language-runtime-and-device-boundaries.md](<../../docs/reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책>) | `specified` |
| `REF-08-014` | 对类型化槽位设置的实时更改与对运行时长的更改，各自保持其自身的类型。 | [08-language-runtime-and-device-boundaries.md](<../../docs/reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책>) | `specified` |
| `REF-08-015` | 状态初始化与普通 config 持久化是两个独立的关注点；停电时间不会计入 elapsed。 | [08-language-runtime-and-device-boundaries.md](<../../docs/reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책>) | `specified` |
| `REF-08-016` | 设施绑定和 Driver 部署格式是源语法之外的环境契约。 | [08-language-runtime-and-device-boundaries.md](<../../docs/reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책>) | `specified` |
