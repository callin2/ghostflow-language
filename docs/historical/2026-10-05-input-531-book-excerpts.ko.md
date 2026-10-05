<!-- translation-source: docs/historical/2026-10-05-input-531-book-excerpts.md -->
[English](2026-10-05-input-531-book-excerpts.md)

# 명시적 입력 품질 개정 전 E01·E03 원래 코드

책 revision `0e5b790babee4157c42d82ddb01f8eecb0c3f6e6`의 실행하지 않는 역사적 증거입니다.
아래 코드는 승인된 #531 migration 전 한국어 책의 E01·E03 fence에서 그대로 옮겼습니다.
기존 정상 제어의 oracle을 보존하며 취득 fault 정책을 정의하지 않습니다.
현재 책은 명시적 새 revision이며 이 기록을 compiler fallback으로 사용하지 않습니다.

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
