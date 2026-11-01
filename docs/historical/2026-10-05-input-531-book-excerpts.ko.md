<!-- translation-source: docs/historical/2026-10-05-input-531-book-excerpts.md -->
[영문 원문](2026-10-05-input-531-book-excerpts.md)

# 명시적 입력 품질 개정 전 E01·E03 원래 코드

이 페이지는 책 revision `0e5b790babee4157c42d82ddb01f8eecb0c3f6e6`의 실행할 수 없는
역사적 증거입니다. 아래 코드는 승인된 #531 마이그레이션 이전 상태의 영어 책 E01·E03
fence에서 그대로 옮겼습니다.

이 기록은 원래의 정상 제어 oracle(입력이 정상일 때의 기대 동작)을 보존합니다. 취득
fault 정책을 정의하지는 않습니다. 현재 책에는 이 예제들의 새로운 명시적 revision이
들어 있으며, 이 기록은 절대 컴파일러 fallback으로 사용되지 않습니다.

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
