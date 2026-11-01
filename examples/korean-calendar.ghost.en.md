<!-- translation-source: examples/korean-calendar.ghost.md -->
# Korean public holidays and farm workdays

[Korean](korean-calendar.ghost.md)

Public holidays and farm workdays answer different questions. October 9, 2026
is Hangeul Day, a public holiday. The farm may still decide to work that day
for the harvest. That decision does not change the public-holiday fact: the day
remains a holiday.

The program below binds each calendar explicitly. Three schedules evaluate the
same 06:00 civil occurrence, one per question:

| Schedule | Calendar | Day filter | Output |
|---|---|---|---|
| `public_morning` | `public_days` | `holiday` | `public_holiday` |
| `farm_morning` | `farm_days` | `workday` | `farm_work` |
| `rest_morning` | `farm_days` | `offday` | `farm_rest` |

The outputs are virtual Bool values in the simulator. They operate no devices.

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

A fresh checkout needs Rust/Cargo and Node.js. From the repository root,
install the WASM target and build the runtime, then run the example. Add
`--offline` to Cargo only when the dependencies are already cached.

```sh
rustup target add wasm32-unknown-unknown
cargo build --locked -p ghostflow-wasm --target wasm32-unknown-unknown --release
node tools/examples/korean-calendar.mjs
```

The example first builds the Korean public calendar from pinned 2026–2027
data. It then explicitly derives a farm calendar: work Monday to Friday, rest
on public holidays. Next it composes two exceptions under a new ID and
revision: October 9 becomes a workday, and October 12 becomes a rest day. Both
original calendars stay unchanged.

The 06:00 results, in the order `public_holiday, farm_work, farm_rest`:

| Day | Result |
|---|---|
| October 9 (public holiday, farm works) | `true, true, false` |
| October 12 (farm rest day) | `false, false, true` |
| Same occurrence supplied again | all `false` |

The host supplies only explicit civil date/time facts in the fixed Korean
timezone. The Rust core classifies holidays, evaluates `due`, and prevents
duplicates. If a calendar is missing or expired, the schedule skips under
`fallback = skip`. Future temporary holidays are never inferred automatically:
review the new official evidence and compose a new calendar. This example adds
no weekday literal syntax.
