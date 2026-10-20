# #553 — 기본 의도 연결 경고 구현 기록

- 요청 및 검증 기록: [Language #553](https://github.com/callin2/ghostflow-language/issues/553), [진행 기록](https://github.com/callin2/ghostflow-language/issues/553#issuecomment-6215981629)
- 구현 커밋: [dffbaa6](https://github.com/callin2/ghostflow-language/commit/dffbaa6daf626a44a5a17755ef153927430f74af)
- 작업 브랜치: `codex/intent-link-warning-553-dev`, 병합 대상: `dev`
- 계약: [의도 앵커](../INTENT-ANCHOR-MAP.ko.md), [컴파일 진단](../COMPILER-DIAGNOSTICS.ko.md)

## 목적과 기준 소스

사용자는 실행 코드가 어떤 의도를 구현하는지 연결하지 않았을 때 기본 경고와
복사 가능한 작성 예시를 요구했다. 성공 종료, 기존 오류 검사, 실행 의미와
GFB 바이트는 유지해야 한다. 이 기록은 컴파일 도구 변경이며 장치 펌웨어
배포나 ESS3H32 실물 시험 완료 기록이 아니다.

구현 전에 원격 최신 `dev`와 작업 HEAD가
`06c09444fda9acee04ecc96d5e549deac85f91df`로 일치함을 재확인했다.
요청했던 `refactor/io-role-names-20261012`는 이 기준에 PR #547로 반영돼 있다.
원래 이슈의 과거 문법 `lamp <- request;`는 현재 Result 입력 규약에서
`GF_TYPE` 오류가 난다. `lamp <- request |> recover(false);`라는 명시적
고장 정책을 사용해 최신 소스에서도 경고 누락이 재현됨을 확인했다.
이는 예시의 정책이며 사용자가 확인한 정책으로 간주하지 않는다.

수정 전 정상 컴파일의 warnings/diagnostics는 빈 배열이었다. 그 GFB의
SHA-256은 `50460ab7dd446dc43346afefdfdb8913dffc011cce8f0c6ab60c4aeabc0195a5`이며,
수정 후 경고 있는 예제와 유효한 연결을 추가한 예제 모두 이 값을 유지한다.

## 결정과 변경 이유

기존 파서와 검증된 intent metadata를 재사용해 문장 단위 경고를 계산한다.
선언 하나의 링크로 다른 출력 대입·상태 전이·제약 전체를 덮지 않는다.
지원 대상에는 `GF_INTENT_LINK_MISSING`을, 링크 대상 규약이 아직 지원하지
않는 실행 동작에는 `GF_INTENT_LINK_COVERAGE_UNSUPPORTED`를 반환한다.
후자는 고아 링크를 넣으라고 제안하지 않고 지원 한계를 설명한다.
검토 과정에서 전략, PID, 계측, 묶음 제약이 경고 없이 통과하는 재현을 발견해
이 구분을 추가했다. 정확한 범위는 위 계약 문서에 기록했다.

안내 예시는 최신 입력 문법과 `kind=assumption status=unconfirmed origin=ai`,
`relation=assumes`를 사용한다. 컴파일러는 의도를 추측하거나 사용자 확인을
만들지 않는다. 문장 위치와 상세 작성 규칙을 포함하고 최대 20개 진단을
수집하며 초과 여부를 명시한다. 기존 malformed/orphan/missing-anchor 오류와
Interaction Schema의 더 엄격한 provenance 오류는 유지한다.

Node/browser 컴파일 결과, CLI human/JSON/TOON에 경고가 전달된다.
패키지 생성은 검증된 fresh replay의 경고를 `onDiagnostic` 콜백 또는 기본
`console.warn`으로 전달한다. 경고는 signed payload에 넣지 않는다.
검증 전용 패키지 읽기는 조용하게 유지한다.

## 검증 결과

- 수정 전 최신 dev 재현: 정상 컴파일, 경고 0개. 수정 후: 누락 경고 1개.
- 핵심·기존 provenance·구조화 진단·import CLI 검사: 35개 통과.
- 최종 관련 검사 묶음: 316개 중 311개가 첫 실행에서 통과했다. 나머지
  5개는 임시 `.git/config` 쓰기에 대한 Windows sandbox 차단이었다.
  해당 CI routing 파일만 정상 권한으로 다시 실행해 9개 모두 통과했다.
  코드 오류를 무시하거나 검증 기준을 낮추지 않았다.
- 패키지 native/WASM loader가 필요한 3개 케이스는 이 로컬 묶음에서
  명시적으로 제외했다. 이들을 포함한 전체 검증은 Linux PR CI의 대상이다.
- 안내 문자열에서 실제 예제를 추출해 Node/browser로 컴파일하고 경고 0개 및
  기존 GFB와 바이트 단위 동일성을 검증했다.
- 링크 없음, 앵커만 존재, 일반 URL/주석, 부분 연결, 완전 연결, 잘못된 링크,
  20개 경계, 사용/미사용 import, nested/unsupported 동작을 회귀 검사했다.
- CLI 경고가 있어도 성공 종료와 산출물 생성을 유지하고, JSON/TOON의 진단과
  source identity, 패키지 콜백/기본 출력 및 signed envelope 불변을 확인했다.
- 영문/한글 문서, 번역 manifest, 문서 index 검사와 `git diff --check` 통과.

전체 verifier는 Windows에서 POSIX 호스트가 필요하다는 오류로 중단하도록
구현되어 있다. 로컬에서 전체 native/WASM 검증을 통과했다고 주장하지 않는다.
원격 실행 ID·정확한 검증 SHA·최종 결과는 이 문서와 연결된 #553의 완료 기록과
PR checks에 보관한다. 전체 CI 성공 전 병합하지 않는다.

## 남는 경계

의도 연결은 구조적 출처 추적이다. 의미의 정확성이나 실제 사용자 확인,
물리 출력 동작을 증명하지 않는다. 중첩 동작·일부 상위 동작·import instance의
새 링크 대상을 허용하려면 별도 계약 확장이 필요하며 이번 변경은 그 한계를
경고로 노출한다. 비실행 standalone resource-policy descriptor는 이 검사에서
제외한다. 외부 작성 앱과 Device는 이 커밋을 채택해야 새 진단을 소비할 수 있다.
