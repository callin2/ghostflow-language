<!-- translation-source: docs/ACCOUNTING-LEDGER-ABI.md -->
[English original](ACCOUNTING-LEDGER-ABI.md)

# Accounting ledger 기본 ABI

이 ABI는 WebAssembly를 통해 Rust accounting ledger를 호스트에 노출한다.
GhostFlow 제어에서 accounting 선언을 실행 가능하게 만드는 것은 아니다.
컴파일러 lowering이 계정 표현식과 제약 admission을 이 ledger에 연결할 때까지
`compileControl`은 계속 fail-closed 상태다.

`AccountingRuntime.instantiateSource(wasmBytes, document, options)`는 정확한 표준
`.ghost.md` 문서를 컴파일하고 이름으로 선언된 계정 하나를 선택한다. 호출자가
제공한 `resourceId`를 사용해 `applied` 단계의 영구 `on_time`을 받거나, 호출자가
제공한 `eventType`으로 `local_day` 기준 영구 `count_events`를 받는다. 해당 인스턴스는
다른 ID 또는 연산의 기록/질의 호출을 거부한다. `source` 레코드는 전체 원본 문서,
소스 SHA-256, 선택된 계정과 대상 이름, 단계 및 산출물 SHA-256을 보존한다.
제공된 숫자 ID는 여전히 물리 리소스나 Event에 대한 신뢰된 호스트 바인딩이 필요하다.
복원된 ledger 스냅샷에는 소스 식별 정보가 내장되지 않으므로 호스트는 영구 저장소가
해당 바인딩에 속하는지도 검증해야 한다. 이 API는 제어 admission을 수행하거나
예약을 정산하지 않는다.

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

ledger 스냅샷은 CRC-32 손상 검사가 있는 버전 지정 바이너리 형식이다. 호스트가
저장소를 소유하며 바이트를 정확히 보존해야 한다. 이 기본 요소는 저장 매체나
호스트 쓰기의 원자성을 자체 인증하지 않는다.

## 현재 제한

호출자는 저장된 구간과 비교할 수 있는 단조 타임스탬프를 제공해야 한다. 재부팅
사이에 해당 시간선을 연결하는 것은 이 ABI 범위가 아니다. 호출자는 신뢰된 현지 날짜
키도 제공하고 자정을 기준으로 세그먼트를 분할해야 한다. 이벤트 ID 보존 기한이나
정리 정책은 정의되지 않았다. 구성된 이벤트 용량을 초과하면 fail-closed 처리한다.
이 때문에 이 기본 요소만으로 완전한 `durable` 컴파일러 런타임 바인딩을 제공하지는 않는다.
