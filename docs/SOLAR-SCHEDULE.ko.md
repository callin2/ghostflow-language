<!-- translation-source: docs/SOLAR-SCHEDULE.md -->
[영어 원문](SOLAR-SCHEDULE.md)

# Solar schedule: compiler와 simulation host

이 안내는 이전 standalone Solar profile을 설명한다. live typed config Result를
공유하고 Rust가 context admission을 소유하는 Solar는
[Solar/config 실행](SOLAR-CONFIG-EXECUTION.ko.md)을 참조한다. 현재 Reference의
명시 공통 정책과 제한된 hold/fixed-time fallback 규칙은 아래 원래 v3 범위를
대체한다. [Reference §3.5](reference/03-time-and-schedules.md#35-schedule의-공통-의미)를 참조한다.
standalone profile은 구체적인 기존 consumer를 위해 유지하며 공유 context
profile의 fallback이 아니다.

`Solar`는 host가 공급하는 occurrence descriptor다. compiler는 typed `.due` Boolean input만
내보낸다. 천문 event를 계산하거나 output을 운전하지 않는다.

완전한 canonical source는 [solar-watering.ghost.md](../examples/solar-watering.ghost.md)다.
intent, 명시 test 위치, rise+30min/set−30min, 5분 valve group 두 개를 하나의 문서에 담는다.
예를 들어 `at` field는 `` at = sun`rise + 30min`; ``이다.

모든 Solar schedule에는 정확히 하나의 `timezone`, `latitude`, `longitude`, `at`,
`fallback` field가 필요하다. `timezone`은 지원 IANA timezone 문자열이다. 좌표는
latitude `-90..90`, longitude `-180..180` 안의 finite signed numeric literal이다.
식/config 참조는 허용하지 않는다.

`at`은 Solar 선언에만 있으며 형식은 다음뿐이다.

- `` sun`rise` `` 또는 `` sun`set` ``.
- 두 event 중 하나와 `+`/`-`. 예: `` sun`rise + 30min` `` 또는 `` sun`set - 30min` ``.

`Nunit`은 정수 `ms`, `s`, `min`, `h` literal이다. signed offset은 정확하며 0일 수 있고
크기는 최대 24시간이다. tagged literal, interpolation, 임의 식은 일반 GhostFlow 식 문법의
일부가 아니다.

`fallback = skip`은 필수이며 현재 유일한 fallback 정책이다. host가 요청 solar event를
신뢰하지 않거나 가지고 있지 않으면 새 `.due` occurrence를 공급하지 않는다. 기존 relative
timer는 독립적으로 계속된다.

Solar를 포함한 control의 manifest format은 `GhostFlow/control-v3`다. descriptor는
`{ kind: "solar", name, timezone, latitude, longitude, event, offsetMs, fallback: "skip",
dueInput }`이다. mixed v3 manifest에서도 기존 `DailySlots` descriptor는 불변이다.
원래 compiler 범위는 Solar/operating-setting metadata를 함께 거부했다. 새 GFB16
공유 context profile은 설정을 상수로 접지 않고 이 합성을 지원한다.
Solar가 없는 control은 v1/v2 manifest 동작을 유지한다.

## Simulation host

`runtimes/wasm/schedule.mjs`의 `SolarSchedule`은 DailySlots와 같은
`poll({nowMs, wallMs, trusted}) → {due, reason?, occurrence?}` host 경계를 구현한다.
`preview(wallMs)`는 event local date, `eventWallMs`, `scheduledWallMs`, 계산 identity를
보고한다. preview는 event를 소비하지 않는다.

`ghostflow_core::solar`는 device worker에 대응하는 bounded portable native provider인
`ClockSnapshot`, `SolarDescriptor`, `SolarSchedule`을 제공한다. 현재 `Asia/Seoul`, `UTC`,
`Etc/UTC`만 받는다. 다른 IANA zone은 DST 규칙을 만들어 주지 않고 명시 거부한다.
`wall_ms` 부재는 항상 untrusted이며 합성 현재 시각 sample을 만들 수 없다. polling reason은
아래 baseline/recovery/rollback/gap 동작을 유지한다. admit된 occurrence는
`SolarPoll.occurrence`에 반환한다. 계산 port와 보존된 upstream license는
[SUNCALC-ATTRIBUTION.md](SUNCALC-ATTRIBUTION.md)에 문서화돼 있다.

고정된 [SunCalc 2.0.2](https://github.com/mourner/suncalc/tree/v2.0.2) provider는 해수면
sunrise/sunset(upper limb, 표준 굴절)을 계산한다. 지원 event 날짜는 2000–2100이다.
정확한 offset 적용 전에 인접 UTC solar day를 명시 IANA local date로 해소한다.
특이 civil date에 일치 event가 여럿이면 첫 번째를 고른다. 이 version에는 지형,
관측자 고도, 관측 날씨 입력이 없다.

occurrence는 `(previousWall, currentWall]`을 crossing하고 crossing 후 첫 logical scan에
emit된다. queue되지 않는다. high-water mark는 wall-clock rollback 후 중복을 억제한다.
boot/recovery의 첫 trusted sample은 catch-up 없이 baseline을 세운다. 60초를 넘는 wall/
monotonic gap은 놓친 시작을 skip한다. 가속은 logical scan을 보존해야 하며 건너뛰지 않는다.
event 직전 playback 시작도 같은 경로를 검사한다. host 재생성은 새 baseline을 세우며
영속 pending event queue를 만들지 않는다.

`fallback = skip`은 untrusted time, 미지원 날짜, 요청 event가 없는 극낮/극밤에서 새
admission이 없다는 뜻이다. 이미 admit된 run은 멈추지 않는다. 예의 5분 elapsed timer는
monotonic clock을 사용한다. host는 network/machine clock을 읽지 않는다. 실제 clock
trust/time 동기화는 device driver 책임이다.

consumer는 `ControlRuntime.instantiateFramed(wasm, artifact, {acceptSolar: true})`로
v3를 opt-in한다. 기존 strict default는 v3를 거부한다. Rust VM, GFB ABI, DI/RO
input/output, elapsed timer, final constraint는 불변이다. Solar due input은 literate 선언에
source-observation binding을 가진다. canonical document revision은 좌표/offset도 식별한다.
이는 manifest data이며 GFB bytecode 변경 없이 바뀔 수 있다.

## 검증

`npm test`는 compiler/source-location 사례, host fallback/DST/date-line 테스트,
실제 framed WASM 5분 output trace를 포함한다. 서울 test 좌표의 2026-09-14 독립
[USNO 참조](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-09-14&coords=37.5665%2C126.978&tz=9)는
rise 06:13, set 18:42(UTC+9, 분 해상도)를 보고한다. 테스트는 provider/rounding 차이로
90초를 허용한다. 이는 browser/host driver를 구현한다. ESP32 solar-time driver는 별도
작업이며 이 테스트는 device 작업을 수행하지 않는다.

더 넓은 [시간/Schedule 계약 제안](TIME-AND-SCHEDULE-CONTRACT.md)은 다음 version의
DateTime/work-calendar/tidal/fallback 경계를 기록한다. 제안된 일반 timezone/DST profile을
이 bounded native provider가 구현하지 않는다. 위 60초 gap은 missed-occurrence 억제이며
동기화 상실 후 stale civil time으로 운전할 수 있다는 허가가 아니다.
