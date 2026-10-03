<!-- translation-source: docs/ACCOUNTING-LEDGER-ABI.md -->
[English original](ACCOUNTING-LEDGER-ABI.md)

# Accounting ledger 기본 ABI

이 ABI는 WebAssembly를 통해 Rust accounting ledger를 호스트에 노출한다.
GFB10 count Result는 연결된 ledger로 portable control VM 안에서 실행된다.
Source-bound rolling reservation admission은 명시적인 참조 host 연산이며,
ABI가 control output을 resource에 자동 binding하지는 않는다.

`AccountingRuntime.instantiateSource(wasmBytes, document, options)`는 정확한 표준
`.ghost.md` 문서를 컴파일하고 이름으로 선언된 계정 하나를 선택한다. 호출자가
제공한 `resourceId`를 사용해 `applied` 단계의 영구 `on_time`을 받거나, 호출자가
제공한 `eventType`으로 `local_day` 기준 영구 `count_events`를 받는다. 해당 인스턴스는
다른 ID 또는 연산의 기록/질의 호출을 거부한다. `source` 레코드는 전체 원본 문서,
소스 SHA-256, 선택된 계정과 대상 이름, 단계 및 산출물 SHA-256을 보존한다.
제공된 숫자 ID는 여전히 물리 리소스나 Event에 대한 신뢰된 호스트 바인딩이 필요하다.
복원된 ledger 스냅샷에는 소스 식별 정보가 내장되지 않으므로 호스트는 영구 저장소가
해당 바인딩에 속하는지도 검증해야 한다. source-bound 참조 host는 이 primitive로
rolling reservation을 명시적으로 준비, 정산하거나 취소할 수 있다. VM output 판단을
resource admission에 자동 연결하거나 물리 적용 증거를 인증하지는 않는다.

Accounting 전용 source는 context를 생성하는 표현식이 없어도 accounting
control-v10 profile을 선택한다. REF-03-020은 같은 검증된 source binding을
native Rust와 WASM ledger에서 실행한다. 동일한 ON/OFF 경계를 1초 및 반복되는
7/13/9초 관측으로 나누고, 공통 logical time의 정확한 60초 rolling overlap이
snapshot 복원 및 새 replay 이후에도 일치하는지 확인한다. Native 테스트 실행기는
컴파일된 module과 host가 검증한 manifest를 읽으며 source를 독립적으로 컴파일하지
않는다. 이는 호출자가 검증한 applied interval의 역사적 계산이며, 제어 admission,
실시간 최대 ON cutoff 또는 물리 receipt 인증을 검증하지 않는다.

## 호출자가 제공하는 증거

- 적용된 ON 기록은 이미 호출자가 안정적인 물리 리소스별로 검증하고 병합한 것이다. 각 구간에는 0이 아닌 receipt ID와 양수 단조 구간이 있다. receipt ID는 리소스 내에서 유일하다.
- 호출자는 신뢰된 현지 날짜 경계에서 구간을 분할하고 각 세그먼트에 변경 불가 정수 날짜 키를 제공한다. ledger는 시간대나 민간 날짜를 해석하지 않는다.
- Event 기록에는 불투명한 16바이트 ID와 형식화된 이벤트 ID가 있다. 하나의 Event 형식 안에서 중복 ID는 멱등이다. 서로 다른 증거와 함께 재사용하면 오류다.
- 구성된 구간 및 이벤트 용량은 강제 상한이다. 거부된 변경은 호출자가 Unknown으로 처리해야 한다. WASM ABI는 기록 오류 뒤 현재 ledger를 poison 상태로 만든다.

## 영속화 순서

생성 직후 상태는 Unknown이다. 최초 설치 때 호스트가 빈 ledger를 명시적으로
초기화한다. 그런 다음 스냅샷을 가져와 영속 저장하고 그 정확한 개정판을 확인한다.
레코드를 삽입할 때마다 호스트가 새 개정판을 스냅샷으로 만들고 저장한 뒤 확인할
때까지 읽기는 Unknown을 반환한다. 오래된 개정판에 대한 쓰기 확인은 거부된다.
복원된 유효 스냅샷은 이미 확인된 상태다. 스냅샷이 없거나 유효하지 않으면 Unknown으로 남는다.

Rolling reservation admission도 같은 영속 확인된 관점을 사용한다. 메모리 ledger가
알려져 있어도 revision의 영속 확인이 없으면 reservation 생성, revision 증가 또는
host persistence 호출 전에 admission을 거부한다. 초기 빈 ledger의 저장 실패와
pending reservation의 정확한 재시도도 포함한다. 누락·손상된 ledger도 fail-closed다.
성공한 영속 저장 뒤 `persistPending`으로 명시적으로 복구한 다음에만 정확한 재시도가
`Duplicate`를 반환할 수 있다. reservation 저장 실패는 하나의 pending reservation과
Unknown 읽기를 유지하며 grant를 만들어 내거나 rollback하지 않는다. 이는 보호
`on_unknown = block`을 복원한다. count fault를 `case ... fault(_) => false`로 평가해도
event를 기록하거나 새 시작 권한을 만들지 않는다.

Native `accounting_admission_tape` 예제는 한정된 conformance transport를 위해 Rust
module/rlib로 같은 production C ABI에 연결한다. 신뢰된 테스트 host가 검증된 source
manifest와 명시적 저장 확인을 제공하며 count·fault·admission 판단은 Rust ABI 안에서
생성된다. caller가 판단 결과를 주입하는 새 ABI나 자동 VM/resource binding이 아니다.

ledger 스냅샷은 CRC-32 손상 검사가 있는 버전 지정 바이너리 형식이다. 호스트가
저장소를 소유하며 바이트를 정확히 보존해야 한다. 이 기본 요소는 저장 매체나
호스트 쓰기의 원자성을 자체 인증하지 않는다.

## 현재 제한

호출자는 저장된 구간과 비교할 수 있는 단조 타임스탬프를 제공해야 한다. 재부팅
사이에 해당 시간선을 연결하는 것은 이 ABI 범위가 아니다. 호출자는 신뢰된 현지 날짜
키도 제공하고 자정을 기준으로 세그먼트를 분할해야 한다. 이벤트 ID 보존 기한이나
정리 정책은 정의되지 않았다. 구성된 이벤트 용량을 초과하면 fail-closed 처리한다.
이 때문에 이 기본 요소만으로 완전한 `durable` 컴파일러 런타임 바인딩을 제공하지는 않는다.

## Native rolling overlap conformance

테스트 전용 core `accounting_tape` transport는 과거 frame의 선택적 `admission`을
받는다. 필드는 0이 아닌 정수 `reservationId`, `limitMs`, `reserveMs`, Bool
`retry`다. 선택한 account의 검증된 source manifest와 window, bound, reserve,
`on_unknown = block`을 비교한 뒤 실제 `AccountingLedger::reserve_rolling`을
호출한다. 결과는 native 판단, snapshot 불변 여부, 선택적 동일 요청의 중복 재시도,
applied 사용량과 미정산 예약량을 보존한다. 관찰만 하는 기존 tape의 출력 모양은
유지된다.

REF-03-019는 applied interval `(0,20]`, `(30,40]`, window 60초, limit 30초,
reserve 5초를 사용한다. 40초에는 사용량이 30초이므로 변경 없이 admission을
거부한다. 65초의 window는 `(5,65]`이며 첫 interval의 15초와 둘째 interval의
10초가 남아 합계 **25초**, admission을 위한 잔여 예산은 정확히 5초다. 원본
사례가 같은 시점에 합계 15초라고 한 것은 산술 오류였다. 현재 case의 수치를
정정하되 ID, backlink와 고정된 역사적 원본은 유지한다.

동일하게 컴파일한 source와 유한 record로 native/WASM 계산 및 known admission의
일치를 검증한다. Native core transport는 ledger를 명시적으로 직렬화하고 복원한다.
WASM reference adapter는 추가로 승인되지 않은 예약이 Unknown을 유지하고 명시적
쓰기 승인 전까지 재시도를 차단함을 검증한다. Native core 직렬화는 그 adapter의
쓰기 승인이나 물리 저장장치 인증이 아니다. 어느 테스트 transport도 VM 출력을
물리 resource에 자동 연결하거나 applied receipt의 진위를 인증하지 않는다.
