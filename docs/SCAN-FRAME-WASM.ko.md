<!-- translation-source: docs/SCAN-FRAME-WASM.md -->
[English original](SCAN-FRAME-WASM.md)

# Scan frame WASM ABI v1

주요 설계, 2026-09-11. D3 / 이슈15 / TASK76.3. 통합
SCAN-DRIVER-CONTRACT R1/R2를 확장한다. 핵심 의존성 90ab335. 추가 ABI이며 GFB 변경은 없다.

## 수명 주기

별도의 `FramedHandle`이 구성 중인 Runtime 또는 활성 ScanDriver를 소유한다.
`gf_frame_create`, `gf_frame_load`, `gf_frame_add_capability`,
`gf_frame_activate`, `gf_frame_destroy`는 기존 소유 규칙을 따른다.
로드/기능 구성은 활성화 전에만 가능하다. 활성화 시 Runtime이 소유권을 가진
ScanDriver로 한 번 이전된다. 활성화 실패 시 구성 상태가 보존된다. 활성화 뒤에는
로드/추가/활성화 요청이 거부된다. 새 프로그램/실행에는 새 핸들을 사용한다.
핫스왑/되감기는 v1 범위가 아니다. 호출 실패 때 프레임 ID를 초기화하지 않는다.
기존 gf_* 핸들/함수와 그 의미는 변경하지 않는다. 핸들은 서로 바꿔 쓸 수 없다.
호출자는 해당 할당/수명 주기 API를 사용해야 한다.

모듈 버퍼는 최대 1 MiB다. 기능 이름과 종류는 입력 이름과 같은 비어 있지 않고
올바른 UTF-8/1024바이트 예산을 사용한다. 빌린 슬라이스를 만들기 전에 원시
길이를 확인한다. JS 어댑터는 바이트 버퍼만 허용하고 WASM에서 복사/할당하기
전에 모듈 바이트 길이를 검사하며, 인코딩 전에 초과 텍스트를 거부한다.
검증된 입력 속성은 한 번 캡처하여 접근자 기반 객체가 검증과 인코딩 사이에
값을 바꾸지 못하게 한다. 버퍼 크기는 덮어쓸 수 있는 사용자 속성이 아니라
네이티브 내장 길이를 사용해 검사한다. 입력 배열은 고정 개수의 인덱스 데이터다.
길이를 한 번 캡처하고 사용자 정의 반복자를 호출하지 않으며, 구멍이나 캡처 중
길이 변경을 WASM 호출 전에 거부한다. 승인된 각 항목은 동일한 이름/형식/중복
검증을 통과해야 한다.

## 단일 스캔

`gf_frame_scan(handle, scan_id:u64, logical_time_ms:u64, bytes:*const u8, len:usize)`
는 성공 시 1, 실패 시 0을 반환한다. ID/시간은 핵심의 안전 정수 검증을 거친다.
페이로드는 리틀엔디안이다. u16 입력 개수, 각 항목마다 u16 UTF-8 이름 바이트
길이와 이름 바이트, u8 형식(1 Bool, 2 Number, 3 Int), 그 뒤에 u8 Bool(정확히
0/1), f64 Number 또는 4바이트 리틀엔디안 부호 있는 i32 Int가 온다.
뒤에 바이트가 남으면 안 된다. 이름은 비어 있지 않은 유효 UTF-8이어야 하며
최대 1024바이트다. 개수는 최대 128, 패킷 전체는 최대 65536바이트다. 이 ABI
봉투 제한은 소스 문법 제한과 별개다. 항목을 분할하거나 할당하기 전에 패킷
제한을 거부한다. 경계 검사 커서 읽기는 잘림, 알 수 없는 형식, 잘못된 불리언,
유한하지 않은 숫자, 중복 이름과 예약된 clock을 거부한다. 모듈 완전성/형식과
프레임 순서는 기존 ScanDriver가 검증한다. 대체 VM 평가기는 없다.

오류는 이전 커밋 결과와 VM 상태를 보존한다. 잘못된 입력이어도 새로운 오류
메시지를 반환한다. null 핸들/버퍼는 거부한다. 원시 포인터 소유권은 기존 WASM
임베딩 규칙(유효하게 할당된 영역)을 따른다. 임의 조작된 포인터도 안전한 ABI라고
주장하지 않는다. 호스트 래퍼가 버퍼를 소유하고 크기를 제한해야 하며 임시 할당은
finally 블록에서 해제한다.

## 결과

`gf_frame_outcome_ptr/len`은 마지막 커밋 JSON을 노출하며 최초에는 null이다.
`{format:"GhostFlow/scan-outcome-v1",scanId,logicalTimeMs,trace:<TickRecord JSON>}`
형식이다. 버퍼는 다음 성공 스캔 또는 파괴 전까지 유효하다. 오류는 이를 교체하지
않는다. `gf_frame_error_ptr/len`은 현재 진단을 제공하며 성공 연산은 이를 비운다.
핵심 TickRecord.tick은 기존 이름 공간을 유지한다. frame scanId로 대체하지 않는다.
호스트 세션이 실행 epoch 식별자를 제공한다.

## JavaScript 어댑터

`runtimes/wasm/framed-runtime.mjs`의 `FramedGhostFlowRuntime`은 해당 핸들을
소유하며 instantiate/load/addCapability/activate/scan/dispose와 outcome을 제공한다.
`scan({scanId,logicalTimeMs,inputs:[{name,value}]})`는 ID와 전체 입력을 명시한다.
오류 시 내부 자동 증가, 추론된 false 또는 이전 setter는 사용하지 않는다.
할당 전에 정확한 필드, 안전 ID, 유한 값, 유니코드와 예산을 검증한다.
데이터는 동기적으로 복사한다. 불리언/Number 형식은 JS 값 형식을 따른다.
Int는 선언된 `type: 'Int'`와 검사된 부호 있는 i32 값을 사용한다.
결과 JSON에는 일반 데이터만 포함된다. dispose 이후 메서드는 예외를 던지고
dispose는 여러 번 호출해도 안전하다. 필수 export를 확인하고 구형 WASM 산출물은
명확한 오류와 함께 실패한다. ControlRuntime/프런트엔드는 아직 변경하지 않는다.
D6가 해당 통합과 핀을 담당한다.

## 재시작 수명 주기 확장

Lifecycle metadata는 정확한 reserved 원인 input, 순서가 있는 enum 멤버와
이벤트 input을 식별하며 loader는 이를 기본 module과 대조한다. Manifest도
호스트 binding 검사에 사용할 같은 값을 담는다. 이 runtime 소유 port는 외부
취득 Result나 optional/conditioning 설정 없이 scalar 값으로 읽는다.

로컬 통합 후보는 임시 GFB21 lifecycle framing을 사용한다:
`GFB1`, `u16=21`, `u32 innerLength`, 변경 없는 내부 GFB byte, 원인 input
string, `u8=5`, 순서가 고정된 원인 string 다섯 개, event input string 순서다.
String은 일반 GFB의 `u16` UTF-8 길이를 사용한다. 중첩 resource/lifecycle
wrapper, 잘못된 이름/타입/멤버, 잘림과 후행 byte는 거부한다.
Manifest는 내부 control profile을 유지하고 descriptor를 반영한다.

GFB19는 현행 live Range start codec이며 GFB20은 TimeSlots Range다.
별도로 공개된 `ghostflow-runtime-99ca1a3` prerelease는 같은 번호 19를
lifecycle wrapper에 사용했다. 이 후보는 역사적 wrapper를 탐지하여 변환하거나
Range/lifecycle module로 허용하지 않는다. 해당 release byte와 pin은 보존한다.
이전에는 검토한 source를 별도 framing으로 재컴파일하고 새 owner 후보를
조정해야 한다. 번호 21은 owner 할당 합의 전까지 임시다. 이전 runtime은 이를
거부한다. 로컬 변경은 공개 ABI, release 또는 consumer pin을 변경하지 않는다.
Portable package는 기존의 좁은 base-profile 정책을 유지한다.
Range를 감싸더라도 package 허용 범위는 넓어지지 않는다.

숫자 GFB format은 [System #199](https://github.com/callin2/farm_studio_system/issues/199)와
[language PR533](https://github.com/callin2/ghostflow-language/pull/533)의 release/build
identity 규칙 `<release-version>-build.<number>`와 별개다. 할당은 해당 workflow가
소유한다. 로컬 개발 검사는 공식 build ID를 발급하지 않는다.

검증 전용 호스트는 module을 불러오고 capability를 등록한 뒤
`gf_frame_validate(handle)` 또는 `FramedGhostFlowRuntime.validate()`를 호출할 수 있다.
이 호출은 capability 호환성을 검사하고 handle을 구성 상태에 둔다. Lifecycle input을
초기화하지 않으며 scan도 허용하지 않는다.

활성화 전에 `gf_frame_initialize_restart(handle, reason_ordinal:u8,
event_pending:u8)` 또는 `FramedGhostFlowRuntime.initializeRestart(reasonOrdinal,
eventPending)`를 호출한다. 원인 ordinal은 선언 순서를 따른다. 원인을 확인할 수 없으면
호출자는 ordinal 4인 `Unknown`을 공급한다. lifecycle module은 정확히 한 번 초기화해야
한다. 호스트는 프로그램 교체 사이에도 부팅 pending bit를 보존하고, 이벤트를 이미
성공적으로 소비한 뒤에는 false를 전달한다.
Plain, temporal, schedule, context 활성화는 모두 scan을 허용하기 전에
같은 초기화를 ScanDriver로 전달한다.

Lifecycle input은 완전한 scan frame에서 제외하며 호출자가 넣으면 거부한다. Runtime이
고정 원인과 이벤트 값을 주입한다. 성공한 scan은 pending을 지우고 거부된 scan은 유지한다.
Native와 WASM 호스트는 `ScanDriver::restart_event_pending()` 또는 WASM의
`gf_frame_restart_event_pending` / JavaScript `restartEventPending`으로 결과를 읽어 저장할
수 있다. 이 확장은 VM이나 timer 기억을 복원하지 않는다.

## 승인 기준

실제 빌드된 WASM 테스트는 구성/활성화, 동일 스캔의 요청/안전 출력, 타이머 시간
주입, 유효하지 않은 완전 입력, 중복/예약 이름, 안전하지 않은 ID/시간, 순서 오류/
롤백, 잘못된 바이너리/잘림/후행 바이트/형식/불리언, 패킷 예산, 오류 시 결과 보존,
거부 후 유효 스캔 지속, dispose와 export 누락 동작을 다룬다. 기존 레거시 테스트
모음도 계속 통과해야 한다. 새 Node 테스트를 `tools/verify-language.mjs`에 명시적으로
등록한다. 이 경계 테스트만으로 네이티브/framed/WASM 동등성(D9)이나 펌웨어 채택(D7)을
주장하지 않는다.
