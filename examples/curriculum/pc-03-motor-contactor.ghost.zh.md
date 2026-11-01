<!-- translation-source: examples/curriculum/pc-03-motor-contactor.ghost.en.md -->
[英文原文](pc-03-motor-contactor.ghost.en.md)
> 本文为阅读用译本。编译时请使用原始文件 `pc-03-motor-contactor.ghost.md`（韩文原文）。

# PC-03 — 电机接触器命令与过载许可

<!-- ghostflow:anchor id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 kind=intent status=confirmed origin=imported -->
> 学习场景：在 PC-02 的自锁行为上增加电机的过载保护许可。本文档定义的是课程学习场景，并非直接引用用户的陈述。

链接的韩文原文是 PC-03 唯一的规范、文学式、可执行源。它复用了 PC-02 的新的启动事件和重启抑制，并保持课程 [E03](../../docs/ProgrammingInGhostflow.zh.md#ch03) 中的基本自锁示例不变。

`stop_ok` 和 `overload_ok` 是含义已归一化的许可输入：`true` 表示停止路径或过载保护允许运行。真实停止按钮和过载继电器的常闭接线与触点极性属于电气设施和设备适配器。这个学习示例只接收 Bool 值。

这个显式的质量输入修订版保持健康输入的重放结果不变。对于采集故障：

- 不可用的 START 请求不能启动 `control`，也不能使其重新就绪。只要 STOP 和保护保持健康并允许运行，已有的运行就可以继续。
- 不可用的 STOP 或保护输入会撤销许可。
- 恢复之后，需要先有一次健康的 START 松开，再有一次新的 START 请求。

之前的源作为不可执行的历史记录保存在
`tests/fixtures/history/issue531/pc-03-motor-contactor.ghost.en.md.pre-input.txt`。

```ghost
// Source revision: issue531-approved-fault-restart-v1
control MotorContactor {
  input start, stop_ok, overload_ok: Bool;
  output motor_contactor: Bool;

  // ghostflow:link id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 relation=implements
  state armed: Bool = false;
  // ghostflow:link id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 relation=implements
  state running: Bool = false;

  let start_good = case start { ok(_) => true; fault(_) => false; };
  let start_value = start |> recover(false);
  let stop_ok_good = case stop_ok { ok(_) => true; fault(_) => false; };
  let stop_ok_value = stop_ok |> recover(false);
  let overload_ok_good = case overload_ok { ok(_) => true; fault(_) => false; };
  let overload_ok_value = overload_ok |> recover(false);

  let permit = stop_ok_value && overload_ok_value;
  let start_event = start_good && armed && start_value;

  running' = permit && (start_event || running);
  armed' = start_good && permit && !start_value;

  motor_contactor <- running';
}
```

`motor_contactor` 是发送给 MC（电磁接触器）线圈的逻辑命令。它并不能证明主触点已闭合、电机已通电或正在转动。

如果过载继电器在运行期间跳闸（`overload_ok=false`），下一状态和命令会在同一个 tick 中关闭。保护恢复后，按住 START 并不会使 `control` 重新就绪，因此电机不会自行重启。必须先松开 START 再按下，才允许新的启动。

在设施中，两个回路是：

- **主回路：** 从断路器经 MC 主触点和过载继电器到电机的电源路径。
- **控制回路：** 从控制电源出发，经过 STOP 和过载保护触点，以及由 START 与 MC 辅助触点构成的自锁支路，使 MC 线圈通电的路径。

软件的线圈命令不能取代独立的电气过流保护、急停或保护功能。

本示例没有报警输出、故障锁存/复位、定时器、传感器反馈、硬件操作或新的 GhostFlow 语法。后续课程阶段会分别讲解这些主题。

`tools/check-pc-03.mjs` 使用当前编译器和现有 WASM 运行时生成虚拟/编译器/WASM 学习证据。其结果不包含关于继电器、MC 主触点、电机电源或电机转动的任何物理证据。
