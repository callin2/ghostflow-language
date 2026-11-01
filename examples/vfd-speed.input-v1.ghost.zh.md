<!-- translation-source: examples/vfd-speed.input-v1.ghost.md -->
[英文原文](vfd-speed.input-v1.ghost.md)
> 本文为阅读用译本。编译时请使用上方链接的原始 `.ghost.md` 文件。

# VFD 速度——显式输入修订版

<!-- source-revision: issue531-input-quality-vfd-v1 -->

start 和 stop 在按下期间为 true。生产者以伏特为单位提供电位器观测；预期工作范围仍为
0 到 10 V。速度仍与 Run 相互独立。这个虚拟示例保留其现有的正常电平触发锁存：
不可用的 START 无法开始一次运行；不可用的 STOP 会禁止 Run。这些是针对生产者质量的
显式源分支，而不是物理按钮诊断。
速度显示从 0 V 开始，当质量不可用时记住最后一次被接受的观测。这一显示初始化并不是
合成的 Good 样本。
前一版本的源和场景作为历史证据原样保留。

```ghost
control VfdSpeed {
  input start, stop: Bool;
  input potentiometer_v: Number;
  output run: Bool;
  output speed_v, speed_hz: Number;
  state running: Bool = false;
  state observed_speed_v: Number = 0.0;
  // Preserve the existing healthy STOP priority and level-sensitive latch.
  running' = case stop {
    ok(stopped) => !stopped && (case start { ok(requested) => requested || running; fault(_) => running; });
    fault(_) => false;
  };
  run <- running';
  // Authored display memory is separate from producer acquisition evidence.
  observed_speed_v' = case potentiometer_v { ok(value) => value; fault(_) => observed_speed_v; };
  speed_v <- observed_speed_v';
  speed_hz <- observed_speed_v' * 5;
}
```
