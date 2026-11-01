<!-- translation-source: examples/solar-watering.ghost.en.md -->
[英文原文](solar-watering.ghost.en.md)
> 本文为阅读用译本。编译时请使用原始文件 `solar-watering.ghost.md`（韩文原文）。

# 按日出和日落定时浇水

本示例使用首尔的**测试坐标**，根据每天的日出和日落进行浇水。对于真实设施，请写入经过验证的农场坐标和时区。

本示例采用 8DI/8RO 布局（八个数字输入、八个继电器输出），并按如下方式命名继电器：

| 继电器 | 角色 | 请求时机 |
|---|---|---|
| RO1 | 泵 | 任一对阀门运行时 |
| RO2, RO3 | 阀门对 | 同时，持续 5 分钟，从日出后 30 分钟开始 |
| RO4, RO5 | 阀门对 | 同时，持续 5 分钟，从日落前 30 分钟开始 |
| RO6–RO8 | 未使用 | 始终关闭 |

本示例让每一对中的两个阀门同时运行。如果不清楚用户想要同时运行还是依次运行，应在编写之前先澄清。

```ghost
control SolarWateringFixture {
  let duration = 5min;

  schedule dawn: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.9780;
    at = sun`rise + 30min`;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }

  schedule dusk: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.9780;
    at = sun`set - 30min`;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }

  input DI1, DI2, DI3, DI4, DI5, DI6, DI7, DI8: Bool;
  output RO1, RO2, RO3, RO4, RO5, RO6, RO7, RO8: Bool;

  state dawn_active: Bool = false;
  state dusk_active: Bool = false;
  timer dawn_elapsed = elapsed(dawn_active);
  timer dusk_elapsed = elapsed(dusk_active);

  dawn_active' = if dawn_active then dawn_elapsed < duration else dawn.due;
  dusk_active' = if dusk_active then dusk_elapsed < duration else dusk.due;

  RO1 <- dawn_active' || dusk_active';
  RO2 <- dawn_active';
  RO3 <- dawn_active';
  RO4 <- dusk_active';
  RO5 <- dusk_active';
  RO6 <- false;
  RO7 <- false;
  RO8 <- false;

  require RO1 => (RO2 || RO3 || RO4 || RO5);
}
```

`dawn_active` 和 `dusk_active` 各自拥有独立的 Bool 状态和经过时间定时器。当对不可信太阳事件的 `skip` 处理没有产生新的启动信号时，每个已经开始的运行仍会继续进行其五分钟的经过时间检查。
