<!-- translation-source: examples/authoring/pump-rev-2.ghost.md -->
[英文原文](pump-rev-2.ghost.md)
> 本文为阅读用译本。编译时请使用上方链接的原始 `.ghost.md` 文件。

# 带许可条件的泵请求

本文件是文档 `GF-EXAMPLE-PUMP` 的修订版 `rev-2-input-v1`。它在诊断所报告的确切文档区间处，修正了[修订版 1](pump-rev-1.ghost.zh.md)中不完整的表达式。用户确认了两条规则：STOP 优先，以及缺少许可时阻止泵的安全意图（safe intent）。

<!-- ghostflow:anchor id=GF-INT-PUMP-REQUEST kind=intent status=confirmed origin=user -->
> START 请求运行泵。STOP 取消该请求。

<!-- ghostflow:anchor id=GF-INT-PUMP-PERMIT kind=intent status=confirmed origin=user -->
> 缺少许可时，必须阻止泵运行。

<!-- ghostflow:anchor id=GF-ASM-PUMP-MAX-RUN kind=assumption status=unconfirmed origin=ai -->
> 可能需要最长运行时间。其数值和重启规则尚未提供。添加定时器之前，请先询问用户。

这是一个显式的 input-quality-v1 源修订版：每个输入都带有生产方质量（`ok` 或 `fault`）。未知（故障）的请求会保留已存储的请求状态，并且绝不会产生新的请求。已知的 STOP，或已知已松开的 START，会取消请求。原始源字节和带日期的基准测试证据另行保存。修正后的赋值为 `pump <- requested';`，因此泵请求跟随下一个请求状态；在缺少许可期间，`require pump => permit` 会阻止它。

```ghost
control PumpRequest {
  input start, stop, permit_ok: Bool;
  output pump, permit: Bool;
  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  state requested: Bool = false;
  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let start_value = case start { ok(value) => value; fault(_) => requested; };
  let stop_value = case stop { ok(value) => value; fault(_) => false; };
  requested' = if stop_good && stop_value then false
    else if start_good && !start_value then false
    else if start_good && stop_good then start_value && !stop_value
    else requested;

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=implements
  state permission: Bool = false;
  permission' = case permit_ok { ok(value) => value; fault(_) => permission; };

  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  pump <- requested';
  permit <- permission';

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=constrains
  require pump => permit;
}
```
