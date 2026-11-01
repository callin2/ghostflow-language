<!-- translation-source: examples/korean-calendar.ghost.en.md -->
[英文原文](korean-calendar.ghost.en.md)
> 本文为阅读用译本。编译时请使用原始文件 `korean-calendar.ghost.md`（韩文原文）。

# 韩国法定节假日与农场工作日

[韩文原文](korean-calendar.ghost.md)

法定节假日和农场工作日回答的是不同的问题。2026 年 10 月 9 日是韩文节，属于法定节假日。农场仍可能为了收获而决定在这一天工作。这个决定不会改变法定节假日这一事实：这一天仍然是节假日。

下面的程序显式绑定每个日历。三个调度计划针对同一个 06:00 民用时间触发实例（occurrence）进行求值，每个调度计划对应一个问题：

| 调度计划 | 日历 | 日期过滤 | 输出 |
|---|---|---|---|
| `public_morning` | `public_days` | `holiday` | `public_holiday` |
| `farm_morning` | `farm_days` | `workday` | `farm_work` |
| `rest_morning` | `farm_days` | `offday` | `farm_rest` |

这些输出是模拟器中的虚拟 Bool 值，不操作任何设备。

```ghost
control KoreanCalendar {
  calendar public_days: HolidayCalendar;
  calendar farm_days: WorkCalendar;
  schedule public_morning: Daily {
    timezone = "Asia/Seoul";
    at = time`06:00`;
    on = day`holiday`;
    calendar = public_days;
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  schedule farm_morning: Daily {
    timezone = "Asia/Seoul";
    at = time`06:00`;
    on = day`workday`;
    calendar = farm_days;
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  schedule rest_morning: Daily {
    timezone = "Asia/Seoul";
    at = time`06:00`;
    on = day`offday`;
    calendar = farm_days;
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output public_holiday: Bool;
  output farm_work: Bool;
  output farm_rest: Bool;
  public_holiday <- public_morning.due;
  farm_work <- farm_morning.due;
  farm_rest <- rest_morning.due;
}
```

全新的检出（checkout）需要 Rust/Cargo 和 Node.js。在仓库根目录下安装 WASM 目标并构建运行时，然后运行示例。只有在依赖已经缓存时，才为 Cargo 添加 `--offline`。

```sh
rustup target add wasm32-unknown-unknown
cargo build --locked -p ghostflow-wasm --target wasm32-unknown-unknown --release
node tools/examples/korean-calendar.mjs
```

该示例首先根据固定的 2026–2027 年数据构建韩国法定日历。然后显式派生出一个农场日历：周一至周五工作，法定节假日休息。接着，它以新的 ID 和修订版组合两个例外：10 月 9 日改为工作日，10 月 12 日改为休息日。两个原始日历都保持不变。

06:00 的结果，按 `public_holiday, farm_work, farm_rest` 的顺序：

| 日期 | 结果 |
|---|---|
| 10 月 9 日（法定节假日，农场工作） | `true, true, false` |
| 10 月 12 日（农场休息日） | `false, false, true` |
| 再次提供同一触发实例 | 全部为 `false` |

宿主（host）只在固定的韩国时区内提供显式的民用日期/时间事实。Rust 核心负责划分节假日、求值 `due` 并防止重复。如果日历缺失或已过期，调度计划会按照 `fallback = skip` 跳过。未来的临时节假日绝不会被自动推断：应审查新的官方依据，并组合出一个新的日历。本示例没有新增任何星期字面量语法。
