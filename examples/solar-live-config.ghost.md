# 공유 설정 관측으로 일출 스케줄 허용하기

일출은 선언한 위치와 시간대에서 계산한 사건이다. 실행 허용 설정은 별도의
typed Result 관측이다. 아래 가상 예제는 같은 관측을 일반 출력과 일출의
조건에서 읽는다. 설정 오류가 발생하면 새 일출 사건을 시작하지 않는다.
설정이 복구되는 순간은 기준선이며 이미 지난 사건을 다시 시작하지 않는다.
출력은 요청 의도이고 실제 장치 동작이나 현장 설치의 증거가 아니다.

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

위치, 시간대와 사건 정의는 프로그램에 고정된다. host는 시계와 일출 사실,
인증한 설정 관측을 공급하고 Rust는 설정 결과와 사건 입장을 함께 확정한다.
동일 occurrence는 한 번만 소비하며 실패한 평가에서는 둘 다 되돌린다.
