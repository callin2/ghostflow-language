<!-- translation-source: examples/station-rules.ghost.md -->
[英文原文](station-rules.ghost.md)
> 本文为阅读用译本。编译时请使用上方链接的原始 `.ghost.md` 文件。

# 共享泵站策略

这份规范的文学式源文件（literate）文档为一台共享泵声明了由宿主（host）拥有的泵站限值和模式互锁。它是有界的 **Station 适配器 profile**：一套固定、有限的规则集，由 `ghostrules` 和 `bindStationPolicy` 使用。它不是由 control 拥有的通用约束语法。

该 profile 有两个具体的使用方：泵站演示，以及编程书中的 Station WASM 测试。保留这个 profile 是为了让这些使用方继续工作。它并不支持任意的共享资源输出策略。

宿主必须显式绑定：

- station、pump1、settings 和 starts 的身份标识；
- 模式与活动别名；
- 有限的阀门数量配置。

完整的绑定和可执行的 Station 生命周期在 `tests/programming-book-simulation.test.mjs` 和 `tests/policy.test.mjs` 中检查。固定的 Station 契约拥有其停止行为；本源文件不定义通用的物理安全顺序。`check pump_capacity` 仅为建议性检查。关于由单个 control 拥有的完整本地包络，请参阅 [constraint-envelope.ghost.md](constraint-envelope.ghost.zh.md)。

`Station::session_actual_on_ms(session_id)`（Rust）以及 WASM 包装器的 `sessionActualOnMs(sessionId)` 读取匹配的活动会话中，泵已应用的累计 ON 时间（单位为毫秒）：

- WASM 的结果是精确的 `BigInt`。
- 该读取器不会推进时间。现有的带时间戳的 Station 操作（包括 `advance`）会累积宿主的 `reportApplied` 状态。
- OFF 间隙会保留会话总量。例如，先 ON 十秒、OFF 十秒，再 ON 二十秒，则在时间 40,000ms 时得到 `30_000n`。
- 在会话持久化结束之前，`dailyUsedMs` 保持未结算状态。
- 缺失、不匹配、已结束或已恢复的会话不会返回零。Rust 返回 `SessionMismatch`，包装器则抛出异常。
- 恢复会保留现有的保守预留与恢复契约，但不会恢复活动会话的计数器。

这一观测仅属于有界的 Station 适配器。它不定义通用的作业计数器、阶段时长、连续 ON 定时器，也不定义对请求、安全或已确认输出的用量核算。宿主测试中的已应用状态是测试夹具，而不是物理反馈。[参考手册 §3.4](../docs/reference/03-time-and-schedules.zh.md) 中所做的区分，仍是 [#208](https://github.com/callin2/ghostflow-language/issues/208) 下的独立契约。

```ghost
constraints StationRules {
  exclusive(automatic, manual, configuring);

  allow enter(Auto, Manual, Configure)
    only when mode == Stopped && stopped(station);
  allow apply(settings)
    only when mode == Configure && stopped(station);

  require count_on(pump1.valves) <= 2;
  require pump1.on => any_on(pump1.valves);
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
  once starts per occurrence;
  check pump_capacity(pump1);
}
```
