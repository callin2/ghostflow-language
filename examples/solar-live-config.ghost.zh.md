<!-- translation-source: examples/solar-live-config.ghost.en.md -->
[英文原文](solar-live-config.ghost.en.md)
> 本文为阅读用译本。编译时请使用原始文件 `solar-live-config.ghost.md`（韩文原文）。

# 通过共享设置观测允许日出调度计划

日出是根据所声明的位置和时区计算出的事件。允许其运行的设置（`enabled`）则是另一回事：它是一个独立的、带类型的 `Result` 观测。这个虚拟示例在两处读取同一个观测：普通输出，以及日出调度计划的 `when` 条件。

- 如果该设置出现故障，则不会准入新的日出事件。
- 当设置恢复时，该时刻成为基线。已经过去的事件不会被启动。

这些输出是请求意图，不能证明物理动作或设施的存在。

```ghost
control SolarLiveConfig {
  config enabled: Bool = true { access = operator; }
  schedule dawn: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.978;
    at = sun`rise`;
    basis = pulse;
    when = case enabled { ok(v) => v; fault(_) => false; };
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output settings_ok, current_enabled, due: Bool;
  settings_ok <- case enabled { ok(_) => true; fault(_) => false; };
  current_enabled <- case enabled { ok(v) => v; fault(_) => false; };
  due <- dawn.due;
}
```

位置、时区和事件定义都固定在程序中。宿主（host）提供时钟和太阳事实，以及经过认证的设置观测。Rust 会同时提交设置的 `Result` 与事件准入。每个触发实例（occurrence）只会被消耗一次，被拒绝的求值会将两者一起回滚。
