<!-- translation-source: docs/TEMPORAL-RESOURCES.md -->
[英文原文](TEMPORAL-RESOURCES.md)

# 时间资源规划

时间资源规划会在你投入内存之前告诉你：在给定目标上，时间类功能（窗口、保留的样本、检查点、重放）需要多少字节。静态规划在原生运行时和两个
WASM 适配器中均可使用。

`GhostFlowRuntime` 和 `FramedGhostFlowRuntime` 提供两个同步调用：

- `planTemporal` 规划实时执行。它在激活之前即可使用。
- `planTemporalReplay` 规划一次重放（参见
  [TEMPORAL-REPLAY.md](TEMPORAL-REPLAY.zh.md)）。它要求存在一个带有合格保留记录的活动运行。

```js
const plan = runtime.planTemporal({ profile, maxJsonBytes });
// After activation and successful ticks/scans:
const replayPlan = runtime.planTemporalReplay({ count, profile, maxJsonBytes });
const lastPlan = runtime.resourcePlan; // last successful report
```

调用方需要提供 `profile`、`count` 和 `maxJsonBytes`。本页不隐含任何默认节奏、密度或预算。规划返回静态、有界的元数据。它不会分配时间样本、证明或检查点 arena，也不会执行 tick。重放规划要求存在一个带有合格保留记录的活动 framed 或 legacy 运行。在第一次成功的规划调用之前，`resourcePlan` 为 null。

**实时规划报告。** 格式为 `GhostFlow/temporal-resources-v1`。报告包括：

- 已安装模块的指纹和策略；
- 目标指针宽度；
- 日志容量、窗口数量和保留的样本；
- 计量的时间字节数；
- `fitsBudget`。

预算和错误输入的处理方式：

- 为正但不足的预算会返回 `fitsBudget: false`，同时仍会报告所需容量。
- 无效的事实和不兼容的重放绑定会被拒绝。
- 超出目标已检查整数范围的几何参数同样会被拒绝。它绝不会回绕成一个更小的需求。

**`accountedTemporalBytes` 统计什么。** 它是一个针对特定目标的计量上界。

| 包括 | 不包括 |
| --- | --- |
| 密度环、保留的观测、证明/高水位容量、候选库和已提交库、检查点、投影、追踪/标记上界、构造时的临时空间、重叠的规划元数据 | 分配器元数据、标量/模块存储、JSON/报告输出、调用方自有的 JavaScript 副本 |

`targetPointerBytes` 给出计算所用的目标布局宽度。

**重放规划报告。** 格式为 `GhostFlow/temporal-replay-resources-v1`。
报告包括合格数量、请求数量、实时字节数和 ghost 字节数、返回头和帧头、所需的峰值时间字节数，以及 `ghostFitsBudget`。
字节总和涵盖所有同时存在的内容：实时和 ghost 几何结构、返回的 core 记录以及 framed 结果。ghost 几何结构使用与请求数量相等的日志容量。重放 JSON 预算的上界独立于时间 arena 预算。

**替换与拒绝。** 只有成功的规划才会替换 `resourcePlan`。拒绝会保留先前的规划、先前的重放、实时执行、帧序列和结果。

**WASM 导出。** 对应的 WASM 函数为 `gf_plan_temporal`、
`gf_plan_temporal_replay`、`gf_frame_plan_temporal` 和
`gf_frame_plan_temporal_replay`，每个都带有相应的资源规划指针/长度 getter。`maxJsonBytes` 限定先前规划缓冲区加上其替换候选的总大小。资源规划缓冲区与重放结果缓冲区相互独立。

**适用范围。** 本契约涵盖测量得到的物理窗口和派生窗口。估计类证据、其他时间运算符、外来检查点，以及完整的
Reference §6.8 分支/源闭包身份标识，均不在本契约范围内。
