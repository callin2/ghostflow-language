<!-- translation-source: examples/korean-calendar.ghost.md -->
# Korean public holidays and farm workdays

[Korean](korean-calendar.ghost.md)

Public holidays and farm workdays answer different questions. October 9, 2026
is Hangeul Day, and the farm may explicitly work that day for the harvest.
The public holiday remains a holiday. Each calendar is explicitly bound;
three schedules evaluate the same 06:00 civil occurrence. Outputs are virtual
Bool values and operate no devices.

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

A fresh checkout requires Rust/Cargo and Node.js. From the repository root,
install the WASM target and build the runtime before running. Add `--offline`
to Cargo only when dependencies are cached.

```sh
rustup target add wasm32-unknown-unknown
cargo build --locked -p ghostflow-wasm --target wasm32-unknown-unknown --release
node tools/examples/korean-calendar.mjs
```

The example builds the Korean public calendar from the pinned 2026–2027 facts,
then explicitly derives a Monday–Friday farm calendar that rests on public
holidays. It composes October 9 as a work exception and October 12 as a rest
exception under a new ID and revision, preserving both original calendars.
The holiday produces `true, true, false`; the farm rest day produces
`false, false, true`. Repeated occurrence evidence produces all false.

The host supplies explicit civil facts in the fixed Korean timezone. Rust
classifies holidays, evaluates due and prevents duplicates. Missing or expired
calendars skip under `fallback = skip`. Future temporary holidays are not
inferred automatically: review new official evidence and compose a new
calendar. This example adds no weekday literal syntax.
