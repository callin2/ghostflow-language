# 한국 공휴일과 농장 작업일

[English](korean-calendar.ghost.en.md)

한국의 공휴일과 농장의 작업일은 서로 다른 질문이다. 2026년 10월 9일은
한글날이지만, 농장은 수확 때문에 작업일로 정할 수 있다. 공휴일 사실은 그대로
보존한다. 다음 프로그램은 각각의 달력을 명시적으로 바인딩하고 오전 6시에
세 가지 결과를 계산한다. 출력은 시뮬레이터의 Bool 값이며 장치를 구동하지 않는다.

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

새 checkout에는 Rust/Cargo와 Node.js가 필요하다. 저장소 루트에서 WASM target을
설치하고 runtime을 build한 뒤 실행한다. cache가 있을 때만 Cargo에 `--offline`을 추가한다.

```sh
rustup target add wasm32-unknown-unknown
cargo build --locked -p ghostflow-wasm --target wasm32-unknown-unknown --release
node tools/examples/korean-calendar.mjs
```

예제는
핀으로 고정한 2026–2027년 자료에서 한국 공휴일 달력을 만들고, 월요일부터
금요일까지 작업하며 공휴일에는 쉬는 농장 달력을 명시적으로 파생한다.
이어 10월 9일 작업 예외와 10월 12일 휴무 예외를 새 ID와 revision으로 합성한다.
기존 달력은 수정하지 않는다. 휴일은 `true, true, false`, 농장 휴무일은
`false, false, true`가 된다. 같은 occurrence를 다시 입력하면 모두 false다.

호스트는 고정된 한국 시간대의 날짜·시각 증거만 공급한다. 휴일 분류, due 판단,
중복 방지는 Rust 코어가 수행한다. 자료가 없거나 만료되면 `fallback = skip`으로
실행을 건너뛴다. 미래 임시공휴일은 자동 추정하지 않으며 새 공식 근거를 검토한
후 별도 달력을 합성해야 한다. 이 예제는 요일 리터럴 문법을 추가하지 않는다.
