<!-- translation-source: docs/historical/2026-10-05-input-531-book-excerpts.md -->
[英文原文](2026-10-05-input-531-book-excerpts.md)

# 显式输入质量修订之前的原始 E01 和 E03 代码

本页是来自书籍修订版 `0e5b790babee4157c42d82ddb01f8eecb0c3f6e6` 的历史性、不可执行的证据。下面的代码完全照原样复制自英文书中 E01 和 E03 的代码围栏，即获批的 #531 迁移之前的样子。

它记录了原始的健康控制基准（oracle，即输入健康时的预期行为）。它并不定义采集故障策略。当前的书中包含这些示例新的显式修订版，并且本记录绝不会被用作编译器的回退（fallback）。

## E01

```text
// E01
control FollowSwitch {
  input switch_on: Bool;
  output lamp: Bool;

  lamp <- switch_on;
}
```

## E03

```text
// E03
control LatchingPump {
  input start, stop: Bool;
  state running: Bool = false;
  output valve, pump: Bool;

  running' = !stop && (start || running);
  valve <- running';
  pump <- running';

  require pump => valve;
}
```
