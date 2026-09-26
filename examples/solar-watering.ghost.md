# 일출·일몰에 맞춘 관수

서울의 **시험용 좌표**로 날짜별 일출·일몰에 맞추어 관수한다.
설치할 때는 확인한 농장 좌표와 시간대로 작성한다.

8DI/8RO 표기에서 RO1은 펌프, RO2부터 RO5는 밸브로 이름을 붙인다. 해 뜰 때
30분 뒤에는 RO2와 RO3을 함께 5분, 해 질 때 30분 전에는 RO4와 RO5를 함께
5분 요청한다. 이 예제에서는 각 묶음의 두 밸브를 동시에 운전하기로 정했다.
사용자의 요청이 동시 운전인지 순차 운전인지 불분명하면 작성 전에 확인한다.

```ghost
control SolarWateringFixture {
  config duration: Duration = 5min;

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

`dawn_active`와 `dusk_active`는 서로 독립된 Bool 상태와 경과 타이머를 가진다.
따라서 신뢰할 수 없는 태양 이벤트에서 `skip`이 새 시작 신호를 만들지 않아도,
이미 시작된 각 5분 경과 판단은 계속된다.
