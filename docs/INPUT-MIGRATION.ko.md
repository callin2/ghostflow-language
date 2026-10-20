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

## 기존 Bool 입력의 명시적 검증

`previewLegacyScalarMigration(source,{filename})`는 결정적인 새 문서·receipt·bound
계약을 반환한다. 원문 전체를 정확한 prefix로 보존하고 실행 use site는 바꾸지
않는다. 독립적인 필수·무조건 Bool 입력만 지원한다. import, 함수/macro, lifecycle,
optional·conditioning 입력과 다른 타입은 거부한다. 현재 typed 또는 이미 변환한
문서는 기본적으로 이전하지 않는다. compile 성공만으로 보존을 증명할 수는 없다.
사용하지 않는 기존 Bool port도 매 frame 필수였기 때문이다. 명시적인 기존 origin
요청은 `sourceInputContract:'required-current-bool-snapshot'`으로 이를 보존할 수 있다.
raw lowering 증명은 typed Result 사용을 계속 거부한다. host는 이전 revision을 보존하고 새 문서를 명시적으로
preview/accept한다. 저장소나 모델은 호출하지 않는다.

최상위 `<!-- ghostflow:legacy-scalar-admission-v1 ` directive는 정확히
`format,contractVersion,policy,originalSourceSha256,inputs`인 canonical JSON을 담는다.
format은 `GhostFlow/legacy-scalar-admission-v1`, version은 1, policy는
`required-current-bool-snapshot`, inputs는 선언 순서의 `{name,type:'Bool'}`이다.
알 수 없거나 잘못된·중복·선언 불일치 directive는 거부한다. 이후 편집에도 이를
유지한다. 표시 없는 input은 Result다. 현재 raw lowering을 선택하며 폐기한
compiler나 fault 기본값을 사용하지 않는다.

`manifest.legacyAdmission`은 `sourceSha256`과 `sha256`을 추가한다. 후자는
나머지 모든 필드의 canonical JSON hash다. 사용하지 않는 false Bool state
`__gf_legacy_admission_v1_<sha256>`을 마지막에 추가하여 기존 state index를 보존한다.
prefix는 compiler 전용이며 새 GFB format이나 WASM ABI는 없다. receipt는 정확히
`format,contractVersion,originalSourceSha256,convertedSourceSha256,contractSha256,previewSha256`이다.
format은 `GhostFlow/legacy-scalar-migration-receipt-v1`, `previewSha256`은 나머지
다섯 필드의 canonical JSON hash다. digest는 filename과 무관하며 반환한 문서가
그대로 candidate source다.

`inspectLegacyAdmissionSource(source,{bound:true})`는 전체 계약을 반환한다. 기본
검사는 embedded 조건 또는 null을 반환한다. source-aware
`validateLegacyAdmission({bytes,manifest,sourceDocument})`와 서명 package replay는
source·marker·metadata·bytecode digest를 결합한다. 지원하지 않는 physical target은
Markdown metadata를 무시할 수 있는 frozen compiler 선택 전에
`assertLegacyAdmissionTarget(source,{supported:false})`를 호출한다.

순수 `preflightLegacyAdmission(contract,frame)`은 frame을 복사한다. 각 port는
`inputs`의 Bool 하나 또는 `samples`의 정확한 `{epoch,id,timestampMs,quality,value}`
packet 하나를 요구한다. packet은 Good(또는 ordinal 1), Bool payload, 음수가 아닌
safe integer metadata와 `nowMs` 이하 timestamp를 요구한다. Good은 원래 raw
input으로 변환하며 다른 sample은 보존한다. 두 `ControlRuntime` 경로 모두 누락·
모호함·잘못된·non-Good snapshot을 conditioner·시계·VM 변경 전에 거부한다. 동일
identity의 유효 Good도 수용하며 acquisition freshness·중복·recovery 정책을 만들지
않는다. 다른 host도 계약을 강제하거나 거부해야 한다.

reference control host의 `selectControlRuntimeEntry(manifest)`는 기존 non-context
Solar 또는 native objective에서 `legacy`, 그 밖에는 `framed`를 선택한다. 생성 전에
선택하며 오류 후 재시도하지 않는다. 기존 Solar는 현재 unframed adapter와 기존
solar facts를 사용하며 native framed-scan 증거를 주장하지 않는다.

예상 error code는 `legacy_admission_invalid`, `legacy_admission_unsupported`,
`legacy_admission_frame_rejected`, `legacy_migration_not_required`이며 status 422와
진단 `GF_SEMANTIC`을 사용한다. frame별 telemetry는 없다. marker만 있거나 metadata만
있는 artifact는 거부한다. historical raw GFB는 지원한다. 둘 다 제거하고 digest를
다시 계산하면 trusted source/signature 없이 historical raw GFB와 구별할 수 없다.
source-aware 검사는 directive만 남은 artifact를 거부한다. product는 source
replay/signature closure가 필요하며 직접 low-level VM loading의 보편 보장은 없다.

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
