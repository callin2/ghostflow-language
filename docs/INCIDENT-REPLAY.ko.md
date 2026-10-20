<!-- translation-source: docs/INCIDENT-REPLAY.md -->
# incident 캡처와 재현

[영어 원문](INCIDENT-REPLAY.md)의 한국어 번역.

참조 host CLI `tools/ghostsim-incident.mjs`는
[#133](https://github.com/callin2/ghostflow-language/issues/133)을 위해 기존
`ghostsim.runScenario`, artifact/source-map 검증, native/WASM core를 재사용한다.
새 VM, 물리 장치 모델, 원시 event-to-tick reducer는 추가하지 않는다.
ingress 순서는 [host event ordering 계약](HOST-EVENT-ORDERING-CONTRACT.md)이
소유한다. 이 adapter는 명시적 scenario action과 완료 scan만 소비하며 누락된
이벤트나 도착 순서를 추측하지 않는다.

## 명령과 범위

```sh
node tools/ghostsim-incident.mjs capture program.gfb scenario.toon new-bundle
node tools/ghostsim-incident.mjs replay new-bundle
node tools/ghostsim-incident.mjs replay new-bundle --candidate changed.gfb
```

`capture`는 program initializer부터 새 가상 실행을 시작한다. 정확한 GFB bytes,
manifest, source map, 명시적 scenario와 완료 결과를 독점 생성한 새 디렉터리에
봉인한다. 생성한 가상 run/boot ID는 이 캡처를 식별하며 과거 장치 실행을 복원한
ID가 아니다. 설정과 binding은 artifact 기본값과 명시적 scenario activation만
사용한다. 임의의 실행 중 상태 복원, 알 수 없는 설정 revision, boot 경계를 넘는
재현은 지원하지 않는다. 원본 파일은 덮어쓰지 않는다.

`replay`는 manifest seal과 inventory의 모든 hash/크기를 검증한 뒤 검증한 byte
buffer를 비공개 임시 디렉터리에 복사한다. simulator는 그 사본만 읽으므로 검증
후 원래 bundle을 교체해도 실행 입력은 바뀌지 않는다. 실행 사본은 사용 후
제거한다. artifact 파일과 전달한 디렉터리는 symlink일 수 없다. 파일은 4 MiB,
inventory는 32개, 완료 기록은 256 scan으로 제한하며 기존 ghostsim scenario
제한도 적용한다. 게시 실패 시 새 목적지에 불완전한 결과가 남을 수 있으나 기존
목적지를 덮어쓰거나 사용자 입력을 제거하지 않는다.

runtime revision은 선택된 실제 native/WASM binary digest, tools 최상위와 WASM
adapter의 모든 `.mjs` source digest, dependency lock digest, Node 버전을 포함한다.
정확한 일치를 요구하므로 관련 없는 tool 변경도 보수적으로 과거 캡처를 무효화할
수 있다. 선택된 revision은 실행 전후 검사한다. 과거 capsule을 재현하려면 정확한
host/runtime을 복원해야 하며 새 binary에 과거 identity를 붙이지 않는다. 이 값은
공식 build 번호가 아닌 content revision이다. dependency 설치 무결성과 신뢰할 수
있는 host 실행은 선행 조건이다. hash는 일관성 검사이며 출처 인증이나 같은 사용자
권한을 가진 다른 프로세스에 대한 방어가 아니다.

## 결과와 증거 의미

각 명령은 `GhostFlow/incident-replay-result-v1` JSON 객체 하나를 출력한다.
captured/completed/compared의 exit status는 0, partial은 2, rejected는 1이다.
입력이 같으면 반복 replay 결과 객체도 같다. 초기 상태나 artifact 누락은 partial,
손상·runtime revision 불일치·scan 순서 누락·논리 시각 역행·boot 불일치·기록된
결정 변경은 명시적으로 거부한다. 보간으로 이러한 조건을 복구하지 않는다.

후보 비교는 같은 봉인 scenario로 새 instance를 시작한다. source identity와 safe
virtual output 차이를 scan ID, 논리 시각, channel 및 channel 존재 여부로 보고한다.
`matched`는 원래 기록 재현, `candidate.equivalent`는 비교한 safe output만 뜻한다.
내부 상태, 하드웨어 timing, 모든 미래 동작의 동등성을 뜻하지 않는다. 후보 실행
실패 시 비교를 거부한다.

System229의 과거 `FarmStudio/incident-bundle-v1` envelope는 제한된 inventory
무결성 검사와 명시적 gap 보고만 허용한다. `replay.available`이 true여도 완료 scan
capsule을 제공하지 않으므로 partial이다. producer 의미 검증은 System 소유이며
seal 재계산은 과거 주장을 인증하지 않는다. 비공개 장치 기록은 이 저장소 fixture가
아니다. 누락된 run·설정·상태·clock·scan 위치를 fallback으로 복원하지 않는다.

모든 결과는 기록된 **가상 결정**이며 실제 applied/confirmed 출력, 접점, closed-loop
공정 동작, HIL 수용이 아니다. 합성 native/WASM 회귀는 기존 engine끼리 비교하며
독립 물리 oracle이 아니다. 서비스·네트워크·모델·하드웨어를 호출하지 않는다.

## 검증과 남은 통합

`node --test tests/ghostsim-incident.test.mjs`는 반복성, 후보 차이, 손상/누락,
runtime/helper revision 변화, 검증 snapshot 실행, 초기 상태/scan/clock/boot 경계,
과거 partial envelope, CLI exit code, 합성 native/WASM 일치를 검사한다. 전체
verifier에 suite를 명시적으로 등록한다. 과거 증거와 언어·GFB·ABI·scenario-result
의미는 보존한다.

이번 구현은 cold-start 가상 캡처/replay consumer다. 완전한 과거 incident 재현은
producer가 정확한 실행 artifact, 유효 설정/binding revision, 충분한 초기 실행
상태와 순서가 있는 완료 scan을 제공해야 한다. host event ingress 캡처와 임의 상태
복원은 별도 기능이며 이 도구가 구현 완료로 표시하지 않는다.
