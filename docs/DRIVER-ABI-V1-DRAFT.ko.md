<!-- translation-source: docs/DRIVER-ABI-V1-DRAFT.md -->
[English original](DRIVER-ABI-V1-DRAFT.md)

# Host–Driver C ABI v1 초안

## 상태와 권한

이슈 #117: 검토를 위한 문서 전용 제안이며 실제 소비자의 채택은 아직 이루어지지 않았다.
이 문서는 C ABI, 네이티브 Driver 로더, 하드웨어 통합 또는 적합성 테스트를 구현하지 않는다.
첫 보드 구동의 선행 조건이 아니며 Device 제품 계약을 의무화하지 않는다.
언어의 규범은 [Reference §6.3](reference/06-composition-and-replay.md#63-parameters-settings-dependencies-and-bindings)
및 [§4.7](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)이다.
[물리 경계](LLM-TOOLCHAIN-ARCHITECTURE.ko.md#physical-driver-and-device-boundary)는 물리 I/O와 실패 정책을 Device에 배정한다.
아래의 의무 표현은 이 초안을 선택하는 소비자에 대한 제안된 수용 조건이다.

네이티브 경계는 실행 호스트와 장치별 Driver를 연결한다. 호스트는 코어 평가,
설치 바인딩, 스케줄링과 정책을 소유하고 Driver는 엔드포인트 통신과 해석을 소유한다.
기존 Rust `ScanDriver`는 코어 스캔 어댑터이며 이 물리 ABI가 아니다. 기존 `Capability`는
kind/name/value type만 포함한다. 어느 쪽도 여기서 제안하는 전체 메타데이터나 물리 적용 영수증을 제공하지 않는다.
`gf_*`/`gf_frame_*` WASM ABI는 별도의 호스트–코어 인터페이스이며 그 핸들과 숫자 오류는 재사용하지 않는다.
ABI 버전은 소스 리비전/프로필, GFB 형식, 패키지, 바인딩 및 펌웨어 버전과 구분된다.

## 협상과 함수 경계

다음 C 형태는 방향과 소유권을 설명하는 예시이며 공개 헤더나 구현된 심볼이 아니다.
`gfdrv_bytes`는 호출자가 소유하는 제한된 바이트 뷰이고 `gfdrv_buffer`는 용량과 반환 길이를 가진
호출자 소유의 쓰기 가능 저장소이다. 아래의 이름 붙은 레코드는 헤더 확정 전에 검토된 스키마가 필요하다.

```c
#include <stdint.h>
typedef int32_t gfdrv_status; /* 0 success; stable positive errors below */
typedef struct { const uint8_t *data; uint32_t len; } gfdrv_bytes;
typedef struct { uint8_t *data; uint32_t capacity, len; } gfdrv_buffer;
typedef struct gfdrv_session gfdrv_session; /* opaque Driver-owned instance */
typedef struct gfdrv_host_v1 {
  uint32_t size, major, minor;
  void *context; /* opaque host token; Driver must not dereference it */
  gfdrv_status (*clock)(void *, uint64_t *epoch, uint64_t *monotonic_ms);
  gfdrv_status (*report)(void *, gfdrv_bytes record);
} gfdrv_host_v1;
typedef struct gfdrv_api_v1 {
  uint32_t size, major, minor;
  gfdrv_status (*describe)(gfdrv_buffer *metadata);
  gfdrv_status (*open)(const gfdrv_host_v1 *, gfdrv_bytes binding_and_budget,
                      gfdrv_session **out);
  gfdrv_status (*poll)(gfdrv_session *, gfdrv_buffer *input_records);
  gfdrv_status (*apply)(gfdrv_session *, gfdrv_bytes safe_commands,
                       gfdrv_buffer *receipts);
  gfdrv_status (*cancel)(gfdrv_session *, uint64_t command_id,
                        gfdrv_buffer *receipt);
  gfdrv_status (*close)(gfdrv_session *);
} gfdrv_api_v1;
gfdrv_status gfdrv_negotiate(uint32_t major, uint32_t max_minor,
                            uint32_t out_capacity, gfdrv_api_v1 *out);
```

제안된 초기 버전은 major 1, minor 0이다. 협상은 major 1 안에서 양쪽이 지원하는 가장 높은 minor를
선택하고 두 테이블의 크기와 모든 필수 함수 포인터를 검사하며 지원하지 않는 major를 거부한다.
minor 확장은 선택 필드를 뒤에 추가한다. 생략된 필드는 없는 것으로 취급하며 `size` 밖을 읽지 않는다.
레이아웃이나 의미를 깨는 변경에는 새 major가 필요하다. 알 수 없는 필수 기능은 `open`이나 I/O 전에 거부한다.
소비자는 Driver 산출물 다이제스트, ABI/스키마 버전과 플랫폼 호출 규약을 고정한다.
정적 링크 또는 명시적 등록 경로면 충분하며 동적 로딩은 이 제안의 범위 밖이다.

세션별 호출은 직렬화한다. 콜백은 동기적이고 제한되며 Driver 작업에 재진입할 수 없다.
뷰는 호출 동안만 빌리며 어느 쪽도 포인터를 보관하지 않는다. 테이블/context는 `close`까지 유효하다.
할당 소유권은 경계를 넘지 않는다. null/0이 아닌 길이, 오버플로, 정렬과 용량 검사는 접근보다 먼저
수행한다. 호출자는 여전히 유효하고 접근 가능한 메모리를 제공해야 한다. 버퍼 부족은 I/O 없이 필요한 길이를 반환한다.
`apply`와 `cancel`은 물리 효과 전에 영수증 용량을 검사한다. `apply`는 최악의 엔드포인트별 영수증 용량을 확보하며 쓰기 후 실패는 모든 결과를 보존한다.
Rust 구조체/enum 레이아웃, trait object, panic 또는 예외는 C 경계를 넘지 않는다.
GhostFlow 소스에는 논리 포트/규칙을 두며 Driver 핸들, 버스 주소나 Rust 내부를 넣지 않는다.

## 메타데이터와 바인딩 승인

`describe`는 불변 Driver 리비전/다이제스트, 지원 스키마/기능, 엔드포인트 ID와 한계를 공개한다.
각 엔드포인트는 방향, 페이로드 타입, 의미, 단위/범위, 샘플/시간 계약,
품질/오류 동작, 출력/읽기 확인 범위와 지원 작업을 선언한다. 모르는 사실은 unknown으로 남긴다.
바인딩 승인은 이를 Program의 필수 논리 계약과 설치 리비전에 비교하며,
극성, fail-safe 가정과 승인된 증거 출처도 포함한다. 이름이나 기본 타입만으로는 충분하지 않다.
메타데이터 변경은 이전 승인을 무효화하며 활성 세션에서 조용히 바인딩을 바꿀 수 없다.
Reference §6.3에 따라 호환 교체는 소스/산출물을 유지하고 Driver/바인딩 리비전을 바꾼다.
중단 없는 실행, 센서 연속성이나 자동 재시작을 약속하지 않는다.

입력 레코드는 엔드포인트/출처 ID, 출처 epoch, 샘플 ID, 시계 epoch, 취득 타임스탬프,
페이로드, 명시적 존재 여부와 품질/이유를 보존한다. ABI 품질은 코어 signals의
`NotReady=0`, `Good=1`, `Disconnected=2`, `Stale=3`, `Invalid=4`에 명시적으로 매핑하며 알 수 없는 코드는 거부한다.
측정/추정/유지 값의 출처와 인증된 구간 증거는 별도 필드/계약이며 이 품질 코드의 별칭이 아니다.
없는 샘플을 좋은 값이나 연속성 인증서로 만들어서는 안 된다.
소스의 `sample`, `valid`, 필터, `stale_after`, `recover_after`는 Reference 의미를 유지한다.

## 수명주기, 순서와 실패

성공한 `open`은 하나의 바인딩된 세션/epoch를 만든다. 실패는 세션을 반환하지 않고 출력을 적용하지 않는다.
호스트는 코어 평가 전에 순서가 정해진 입력 레코드를 승인한다. 레코드는 epoch 내에서 단조롭게
정렬된 순번 ID를 가진다. 동일한 중복은 멱등적이고 내용이 바뀐 중복/이전 ID는 거부하며 누락 구간을 보고한다.
호스트는 같은 시각의 입력, 명령과 영수증에 명시적 전체 순서를 기록한다. 타임스탬프만으로 순서를 정하지 않는다.
`poll`은 소스를 평가하지 않는다. `apply`는 코어 결정 뒤의 safe/effective intent만 받으며 명령 ID,
run/scan ID, 바인딩 리비전과 마감 시간을 포함한다. 일괄 intent는 물리적 동시 전환을 약속하지 않는다.
영수증은 엔드포인트별 accepted, applied, failed, unknown을 구분하고 부분 결과를 보존한다.
적용 승인은 작업 범위를 식별하고 읽기 확인은 레지스터/래치 범위를 식별한다.
확인된 물리 효과에는 출처/품질을 가진 독립 피드백이 필요하다. 어느 단계도 다른 단계를 대신하지 않는다.
코어 커밋은 I/O와 별개이며 이 ABI는 출력 실패 뒤의 롤백을 도입하지 않는다.

`cancel`은 명령을 식별하고 취소 결과를 보고한다. 취소 영수증은 물리 OFF를 증명하지 않으며
적용된 동작을 되돌리거나 커밋 상태를 지우지 않는다. 늦은 영수증은 원래 ID를 유지하고 새 epoch에 영향을 주지 않는다.
`close`는 합의된 마감 시간 안에 접근을 정확히 한 번 끝낸다. 종료는 물리 출력의 안전을 인증하지 않는다.
`close` 호출 뒤에는 오류가 나도 호스트가 포인터를 재사용하거나 다시 close할 수 없다. 최종 정리는 Driver가 소유한다.
`close` 반환 뒤에는 콜백을 허용하지 않는다. 최종 정리는 빌린 호스트 포인터를 보관하지 않는다.
재시작은 새 세션 epoch를 만들고 메타데이터/바인딩을 재검증하며 명시적 소비자 체크포인트/복구
정책을 사용한다. 암묵적 재개, 오래된 영수증 재사용이나 이전 출력 명령의 자동 재생은 허용하지 않는다.
채택하는 소비자가 watchdog, 정지, 재시도, OFF 요청과 재배포 정책을 정한다. 이 초안은
물리 경계 가이드에서 별도로 고정한 리비전의 Device 정책을 대체하거나 인증하지 않는다.

네이티브 오류는 안정된 분류를 사용한다. `1 ABI_MISMATCH`, `2 INVALID_ARGUMENT`, `3 UNSUPPORTED`,
`4 BINDING_MISMATCH`, `5 BUFFER_TOO_SMALL`, `6 BUDGET_EXCEEDED`, `7 DEADLINE_EXCEEDED`,
`8 UNAVAILABLE`, `9 IO_FAILURE`, `10 CANCELLED`, `11 INVALID_STATE`, `12 INTERNAL`이다.
제한된 진단 레코드는 작업/엔드포인트/명령 ID, 네이티브 원인, 재시도 가능 여부와 관측된 결과를 추가한다.
메시지 텍스트는 오류 ID가 아니다. 작업 오류는 앞선 applied/unknown 증거를 지우지 않는다.

`open`은 엔드포인트, 레코드 바이트/개수, 진행 중 명령, 보존 진단,
메모리, 호출별 작업량과 완료 마감 시간의 명시적 최댓값을 협상한다. Driver는 충족할 수 없는 예산을 활성화 전에 거부한다.
길이/개수 한계는 할당이나 I/O 전에 검사하며 소진은 결정적인 오류와 제한된 추적을 만든다.
보편적인 보드 한계를 만들어내지 않는다. 동기 호출의 마감 시간은 협조적 작업만 제한한다.
멈춘 네이티브 호출의 강제 제한에는 소비자 소유의 격리/watchdog 정책과 증거가 필요하다. 오류는 물리 안전을 의미하지 않는다.

## 대표 가상 적합성 검증 계획

향후 하네스는 호스트/Driver/스키마 리비전을 고정하고 가상 DI 입력과 릴레이 출력을 재생한다.

| 사례 | 수용 증거 |
| --- | --- |
| 협상과 테이블 | major 불일치, 짧은 테이블, 필수 콜백/기능 부재는 I/O 없이 거부한다. 선택 minor 확장은 안전하다. |
| 바인딩과 품질 | 호환 교체는 Program 산출물을 유지한다. 잘못된 단위/시간/품질은 거부하고 부재, 결함, 중복과 epoch 변경은 관측 가능하다. |
| 순서가 있는 스캔 | 같은 시각의 이벤트 순서는 안정적이다. 이전/변경된 중복 ID는 거부하고 코어 결정과 물리 영수증을 분리한다. |
| 출력과 취소 | 지연/부분 실패, 래치 불일치, 늦은 영수증과 적용 후 취소는 requested/safe/applied/confirmed 구분을 보존한다. |
| 예산과 재시작 | 경계/오버플로, 가득 찬 버퍼, 작업/마감 시간 소진과 close/reopen은 오래된 명령이나 숨은 재개 없이 제한된 오류를 만든다. |

가상 성공은 인터페이스 동작만 입증한다. 물리 증명, 마감 시간 인증, 펌웨어 채택
또는 동적 로더 지원을 입증하지 않는다. 이 문서는 테스트 결과를 주장하지 않는다.
[스캔 프레임 테스트](../tests/scan-frame-wasm.test.mjs), [스캔 테이프 패리티](../tests/scan-tape-parity.test.mjs)와
[코어 신호 계약](../crates/ghostflow-core/src/signals.rs)은 호스트/코어 회귀 기준선으로 재사용하며 C ABI 증명으로 취급하지 않는다.
[Driver 구간 테스트](../tests/true-for-driver-contract.test.mjs) 역시 향후 C 어댑터의 전송 및 승인된 연속 관측
증거와 구분된다. 점 DI 샘플은 구간을 인증하지 않는다.
채택 전에 호스트와 Driver 소유자는 구체적인 레코드 인코딩/타입/단위 레지스트리, 플랫폼 ABI,
신뢰 바인딩, 강제되는 예산/마감 시간, 실패/재시작/체크포인트 정책과 대상 증거에 합의해야 한다.
이는 미해결 채택 결정이며 이 초안은 제품의 정책을 대신 선택하지 않는다.
