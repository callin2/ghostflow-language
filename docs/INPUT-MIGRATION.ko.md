<!-- translation-source: docs/INPUT-MIGRATION.md -->
[English original](INPUT-MIGRATION.md)

# 외부 입력의 canonical 선언과 명시적 revision migration

pre-1.0 외부 선언은 `input name: T;`다. 읽으면 기존 sensor 품질 계약을
계승하는 `Result<T, SensorFault>`다. 지원 payload는 Bool, Int, Number, Percent, Duration, Date, TimeOfDay, DateTime와
물리 quantity다. `let`은 계산 binding, `state`는 tick 사이 기억,
`output`은 요청된 출력 의도 선언이다.

```ghost
control ExplicitQuality {
  input request: Bool;
  output enabled: Bool;
  enabled <- request |> recover(true);
}
```

이 예제는 fault에서 true를 의도적으로 선택한다. 설명용 작성 정책이며 설치에
권장하는 정책이 아니다. healthy false는 false로 남는다. fault에서 false/0이나
all-off 정책을 자동 대입하지 않는다. 작성자가 명시적으로 값을 복구해도
case와 Result transform은 NotReady, Disconnected, Stale, Invalid provenance를
보존한다.

이름을 묶은 선언, `input observation?: Bool;`, 단위, cadence, valid 범위,
median/moving-average/EMA filter, stale 한계와 recovery 횟수는 기존 sensor
계약을 따른다. optional 미설치는 작성한 adaptation strategy를 선택한다.
설치된 입력의 fault는 미설치가 아니다. capability match의 `sensor<Bool>`은
품질 capability 분류이며 선언 alias가 아니다.

## 소스와 이력

기존 `sensor` 선언은 migration 진단으로 거부한다. product나 raw compiler
fallback이 이를 받지 않는다. 기존 sensor 프로그램은 명시적 fault 정책을
유지하고 선언 spelling을 바꿔 검토할 새 revision으로 만들 수 있다. source
bytes, digest, revision과 승인 identity는 새 문서를 가리켜야 한다. 이전
문서는 그대로 보존한다.

기존 plain input 프로그램에는 이름 변경뿐 아니라 use site 검토가 필요하다.
`request && !stop`은 Result 입력을 소비할 수 없다. exhaustive case나 명시적
recovery transform을 추가하기 전에 fault 정책을 확정한다. healthy replay
frame, label이나 대상 모드에서 정책을 추정하지 않는다. compiler 오류는
저장된 소스를 수정하거나 replacement revision을 만들지 않는다.

브라우저, USB, 물리 취득의 전환은 같은 승인 문서의 adapter와 installation
binding을 선택한다. 소스를 재작성하거나 canned 프로그램으로 대체하지
않는다. source revision과 artifact identity를 함께 유지한다. 저장 revision과
new-candidate 승인은 API의 책임이다.

모든 지원 scalar payload는 타입이 지정된 quality sample을 사용한다.
Int는 signed i32, Duration은 음수가 아닌 안전한 정수 밀리초이며,
Date, TimeOfDay, DateTime은 기존 정수 범위를 유지한다. 소수나 범위 밖의
숫자 관측값은 conditioning 전에 Invalid가 된다. 잘못된 host record 타입은
계속 거부한다. Number 변환, 반올림이나 clock 신뢰를 추론하지 않는다.
정확한 타입은 기존 기본 identity filter를 사용한다. 명시적 숫자 filter와
hysteresis는 Number, Percent와 physical quantity에 한정한다.
기존 plain scalar use site에는 여전히 명시적인 작성자 Result 정책이 필요하다.

## 취득과 wire 호환성

소스 keyword가 wire의 품질 분류를 바꾸지는 않는다. `manifest.sensors`,
`__gf_sensor_*` slot, 기존 Result origin/trace 분류, capability record, 선택된
GFB version과 WASM ABI를 유지한다. `manifest.inputs`에는 작성한 plain 외부
선언이 들어가지 않는다. 내부 VM slot은 기존 lowering으로 scalar 값,
quality와 fault code를 운반한다.

reference Host의 producer observation은
`samples[name] = {epoch, id, timestampMs, quality, value}`다. quality는
명시적이며 Bool은 boolean, numeric/quantity payload는 canonical 단위다.
timestamp는 scan 시간보다 미래일 수 없다. software producer는 자기 session
epoch, observation sequence와 monotonic observation timestamp를 쓸 수 있다.
이 packet은 물리 board ID를 요구하지 않는다. producer는 실제 observation을
공급하며 clock-only scan마다 새 sequence 번호를 만들어내지 않는다.

반복된 sample identity는 filter/recovery에 한 번만 기여한다. source epoch
변경은 continuity를 끊고 conditioning 이력을 초기화한다. 새 producer는 기존
startup 준비 규칙을 따른다. identity conditioning은 첫 Good sample을 받아들일
수 있다. recovery count는 같은 producer epoch에서 관측된 fault 이후에 적용한다.
이 취득 규칙이 제어의 재시작 정책을 선택하지는 않는다. 새 sample이 없으면
실제 마지막 valid timestamp에서 freshness를 센다. 순수 표현식의
`ok(false)`는 이러한 취득 증거를 만들지 않는다. Driver, USB와 software
adapter는 session, binding, disconnect와 delivery 보장을 별도로 확립한다.
packet 모양만으로 provenance나 물리 취득을 입증할 수 없다.

push button의 Bool 관측값만으로 단선, 접점 고착이나 버튼 연결 해제를 진단할
수 없다. `NotReady`는 아직 받아들인 관측값이 없는 경우 같은 취득/conditioning의
준비 상태다. 정상적으로 읽은 false는 healthy false다. 다른 quality fault도
producer의 증거나 설정된 freshness/validity 계약이 있어야 한다. 소스 keyword는
물리 진단을 추가하거나 공통 재시작 정책·START 버튼을 강제하지 않는다.

## 소유권과 채택 gate

| Owner | 채택할 계약 |
| --- | --- |
| Language | canonical 문법, typed Result, lowering, 현재 wire 형식과 reference Host conformance |
| Simulator/browser | 같은 source/artifact, quality packet, producer continuity와 기존 generic sensor UI |
| Authoring | 새 candidate에서 input과 명시적 fault 처리, 요청 의도와 원래 이력 보존 |
| API | immutable compiler/authoring pin, 저장 revision과 명시적 candidate 승인, 대상 전환 시 재작성 금지 |
| Device/SDK | immutable compiler/core pin, package/admission 검사, 기존 typed sample과 session fence |
| Driver | source 취득과 metadata, generic Driver9 구현은 별도 owner 범위 |

Integration-v1은 현재 `manifest.inputs/outputs` binding을 검증한다. 그
validator는 `manifest.sensors`의 취득 continuity를 확립하지 않는다. plain
software endpoint binding 통과를 quality 취득의 증거로 재사용하지 않는다.

owner conformance, installed-consumer 테스트, browser 실행, USB 전달과
실제 출력/접점 증거는 별도 gate다. consumer pin은 immutable하게 검토된
owner candidate를 지정해야 한다. keyword 변경은 Device release, 승인된
배포, live source migration이나 물리 hardware acceptance를 의미하지 않는다.

[Reference 4](reference/04-sensors-constraints-control.md)와
[#531](https://github.com/callin2/ghostflow-language/issues/531)를 참고한다.
