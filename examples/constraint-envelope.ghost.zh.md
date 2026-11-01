<!-- translation-source: examples/constraint-envelope.ghost.md -->
[英文原文](constraint-envelope.ghost.md)
> 本文为阅读用译本。编译时请使用上方链接的原始 `.ghost.md` 文件。

# 完整的本地输出包络

这个纯软件示例恰好包含一个 `control` 块，没有导入，也没有隐藏的绑定。测试宿主（host）以 Bool 观测的形式提供全部四个输入。四个输出都是虚拟的 Bool 意图端点。对于这几个特定的虚拟端点，`false` 是显式选定的非活动值。这一选择并不意味着 `false` 对任意物理资源都是安全行为。

请求表达的是目标。随后由本地强制规则限制允许哪些输出：泵需要阀门就绪，两个方向输出不得同时处于活动状态。这些规则不选择自动/手动仲裁策略，也不证明任何输出已到达硬件。

这是显式的 input-quality-v1 修订版。当生产方数据未知（故障）时，示例保留该输入的上一次观测。初始的 `false` 仅用于初始化这一源局部的观测记忆。原始文档另行保存。

```ghost
control OutputEnvelope {
  input observed_start, observed_valve_ready, observed_forward_request, observed_reverse_request: Bool;
  state remembered_start: Bool = false;
  let start = case observed_start { ok(value) => value; fault(_) => remembered_start; };
  remembered_start' = start;
  state remembered_valve_ready: Bool = false;
  let valve_ready = case observed_valve_ready { ok(value) => value; fault(_) => remembered_valve_ready; };
  remembered_valve_ready' = valve_ready;
  state remembered_forward_request: Bool = false;
  let forward_request = case observed_forward_request { ok(value) => value; fault(_) => remembered_forward_request; };
  remembered_forward_request' = forward_request;
  state remembered_reverse_request: Bool = false;
  let reverse_request = case observed_reverse_request { ok(value) => value; fault(_) => remembered_reverse_request; };
  remembered_reverse_request' = reverse_request;
  output pump, valve, forward, reverse: Bool;
  pump <- start;
  valve <- valve_ready;
  forward <- forward_request;
  reverse <- reverse_request;

  constraints LocalEnvelope {
    require at safe_output pump => valve;
    mutex(forward, reverse);
  }
}
```

`constraints LocalEnvelope` 块包含两条本地规则。每次扫描时，`control` 先根据输入计算*请求*输出（requested）。随后这些规则把它们投影为宿主实际收到的*安全*输出（safe）：

| 情形 | 输入 | 请求输出 | 安全输出 | 适用的规则 |
| --- | --- | --- | --- | --- |
| 阀门未就绪 | `start=true`, `valve_ready=false` | `pump=true`, `valve=false` | `pump=false`, `valve=false` | `require at safe_output pump => valve` |
| 阀门就绪 | `start=true`, `valve_ready=true` | `pump=true`, `valve=true` | `pump=true`, `valve=true` | 规则已满足；同一请求现在被允许 |
| 同时请求两个方向 | `forward_request=true`, `reverse_request=true` | `forward=true`, `reverse=true` | `forward=false`, `reverse=false` | `mutex(forward, reverse)` |

这只是本地输出投影。它不是准入控制，也不是通用的共享资源强制执行。[约束契约](../docs/CONSTRAINTS.zh.md)描述了这些独立的阶段以及显式的绑定边界。
