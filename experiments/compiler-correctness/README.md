# GhostFlow 컴파일러 전체 정확성 검증 — 2026-10-27

관련 이슈: [전체 검증 #590](https://github.com/callin2/ghostflow-language/issues/590),
[Percent 반례 #591](https://github.com/callin2/ghostflow-language/issues/591).

## 결과

현재 `dev`의 전체 정확성을 인정할 수 없다. 명세가 `0..100`으로 정의한
`Percent` 타입에서 정상 실행 결과 `110`, `-10`이 나오고, 상태에는
`110 → 130`이 저장되는 반례를 재현했다. 이는 같은 계산을 상수로 적으면
거부하는 정적 검사와도 일치하지 않는다. 실행 중 이 상황을 어떤 오류로
처리할지는 현 참조 문서가 정하지 않았으므로, 특정 복구 정책을 이미 정해진
규칙이라고 보고하지 않았다. 이번 검증에서는 생산 컴파일러와 런타임을 바꾸지 않았다.

검증 목적은 사람이 작성한 제어 의도가 컴파일을 지나 실제 실행물에도 보존되는지
확인하는 것이다. 기존 테스트 통과, 한 예제의 증명, 전체 컴파일러의 증명은 각각
다른 주장이다. 이번 반례는 현재 전체 정확성 주장을 반박한다. 다른 경로까지
오류가 없다는 뜻은 아니며, #590과 #591은 열린 상태로 유지한다.

## 고정한 대상

- 저장소: `callin2/ghostflow-language`
- GitHub에서 확인하고 받은 `dev`: `4861a78a72f0f1078cafe99bf26b93d541e1b82c`
- 최종 공식 host 빌드: `0.1.0-build.124`
- 공식 입력: canonical `.ghost.md`
- 전체 host 검증: 저장소의 `npm test`; 명령·종료·개별 gate 결과는 `evidence/`에 보존한다.
- Lean: `4.19.0`, 기존 실험에서 설치한 공식 x86_64 Darwin 배포본.
- 실행 범위: 실제 Rust native 및 WASM 런타임의 가상 출력. 펌웨어 변경·업로드·실물 동작 검증은 없다.

생산 파일 SHA-256은 [검증 의무 목록](obligations.json), 실제 GFB·native·WASM
식별값은 [연결 검사 결과](evidence/bridge/summary.json)에 있다. Git SHA나 해시는
동일한 대상임을 식별하며, 그 자체로 의미 보존을 증명하지 않는다.

## 전체 범위 조사

[소스 조사](semantics-inventory.md)는 문서 추출 → 파싱 → 타입·의미 검사 →
합성·변환 → 바이트 생성 → 로더·실행 및 동반 metadata를 추적한다.
일반 제어, import 합성, 자원 정책, 공유 제약 descriptor, 회계,
예약 descriptor, 시간 처리의 7개 최상위 분기를 구분했다.
GFB 1~22 profile과 실행할 수 없는 JSON descriptor도 구분했다.
이 목록은 검증 의무와 기존 테스트 위치를 나타내며, 각 항목이 형식적으로
증명됐다는 표시가 아니다. 파서, 타입 검사, 표현식 변환, 모든 시간·설정·합성
기능을 포괄하는 원본→바이트코드 보존 정리는 아직 없다.

## 확인된 반례

```ghost
control PercentDomain {
  state a: Percent = 90%;
  output x: Percent;
  x <- a + 20%;
}
```

canonical 문서로 감싸 실제 컴파일하고 실행하면 `requested.x = 110`,
`safe.x = 110`, `faults = []`가 나온다. `x <- 90% + 20%;`는 컴파일 오류다.
출력, 상태, 함수 결과에서 같은 범위 보존 결함을 확인했다.
세 현상은 서로 다른 오류 3개가 아니라 같은 결함의 다른 사용 경로다.

[반례 보고서](adversarial/report.md), 원본 문서·GFB·manifest·trace와
전체 실행 결과를 `adversarial/`에 보존했다. 별도 독립 검토가 타입 전체에
적용되는 `0..100` 계약과 충돌한다는 판단을 확인했다.

## 실제로 증명한 부분

[Lean 소스](lean/ConstraintPreservation.lean)의 `CompilerSafety.check_run`은
인접한 동일 Bool 제약의 중복 제거에 대해, 임의의 초기 값·기존 오류 집합과
임의의 반복 횟수에서 안전 값과 오류 집합이 같음을 증명한다.
`requires`, `requiresAny`, `mutex`를 모델링하며, 각 제약을 순차 적용하는
모델 대신 실제 Rust와 같은 한 라운드의 snapshot/합집합 방식을 사용했다.

Lean 커널이 정상 증명과 인증서를 검사했다. 잘못된 의존 대상, 비인접 삭제,
다른 규칙 삭제, 합집합을 XOR로 바꾼 변이를 거부하는 검사도 실행했다.
사용자 정의 공리, `sorry`, `native_decide`는 사용하지 않았다.
표준 Lean 공리 `propext`, `Quot.sound`가 사용된다.

[연결 검사](bridge.mjs)는 실제 컴파일 결과의 제약 목록을 별도 바이트 리더로
읽고, 원본 AST 및 인증서와 비교한다. 인증서 5개를 실제 값으로 Lean 정리에
대입해 검사했다. 6개 fixture·343개 입력 행에서 원래 제약 목록을 유지한 GFB와
최적화 GFB를 native/WASM으로 실행해 요청·안전 출력·오류·전후 상태를 비교했다.
변조·잘림 등 30개 검사는 거부됐다. 9개 이름은 기존 최적화 예산 밖이므로
원본 제약을 유지했고, 129개 제약은 artifact 생성 전에 거부됐다.

한계는 명확하다. 이 Lean 정리는 **모델 안의 해당 최적화**를 증명한다.
실제 JavaScript 파서·바이트 리더와 Lean 사이, Rust 구현과 Lean 모델 사이의
형식적 대응은 증명하지 않았다. 표현식 명령은 바이트 리더에서 길이로 건너뛰며
의미 검사를 하지 않는다. `SafetyTrace`의 중복 항목 개수·인덱스 동일성도 주장하지
않는다. 343개 실행 비교는 그 연결을 확인한 유한 시험이다.

## 최종 실행 결과

| 검사 | 결과 | 의미 |
|---|---|---|
| 저장소 `npm test` | 종료 0, 13개 gate 통과 | 실제 native/WASM 빌드와 기존 host 검증 |
| Rust 테스트 | 436개 통과 | 해당 테스트가 다룬 동작 |
| Node 테스트 | 3,706개 통과, 37개 TODO | TODO는 실행 통과 수에 포함하지 않음 |
| 독립 추가 검사 | 12묶음 중 9통과·3실패, 종료 1 | 세 실패는 Percent 결함의 출력·상태·함수 경로 |
| Lean·변이 검사 | 예상 결과 6개 충족 | 정상 증명 2개와 잘못된 증명/모델 4개 거부 |
| 실제 인증서·실행 연결 | 인증서 5개, 입력 행 343개 일치 | 부분 정리와 생산 바이트의 검사 연결 |

첫 전체 검사에서는 제가 추가한 실험 문서를 색인에 등록하지 않아 문서 검사
1개가 실패했다. 그 실패 기록을 보존하고 문서 등록을 수정한 뒤 전체 검증을
다시 실행해 통과했다. 기존 테스트의 37개 TODO는 reference catalog의
`specified` 사례이며, CLI만으로 확인되지 않는 명세 항목이다.
테스트 통과와 별개로 Percent 반례는 계속 재현되며 전체 정확성은 불합격이다.

[최종 요약](evidence/summary.json), [전체 host 결과](evidence/final-verification.json),
[빌드 식별](evidence/final-build-identity.json), [독립 검토](review.md)에 근거를 보존했다.
독립 검토에서 발견한 과거 성공 기록 잔존 문제는 두 실험 검증기에
`running/failed/passed` 상태와 시각·해시를 기록하도록 고치고 실패 재실행까지 확인했다.

## 재실행

이 저장소 작업 폴더에서 Node 22+, Rust/WASM toolchain과 의존성을 준비한다.
`npm test`는 저장소 규칙에 따라 빌드 식별 번호를 온라인 할당한다.

```sh
npm test
python3 experiments/compiler-correctness/lean/verify.py --lean /absolute/path/to/lean
LEAN_BIN=/absolute/path/to/lean node experiments/compiler-correctness/bridge.mjs
node experiments/compiler-correctness/adversarial/check.mjs
```

마지막 검사는 현재 Percent 반례 때문에 종료 코드 1이 정상적으로 재현된다.
그 실패를 통과로 바꾸거나 결과에서 제외하지 않는다. 원본 `baseline/`과 새 실행의
`evidence/`를 구분하고, 재실행 시 기존 결과가 바뀌는 파일을 먼저 보존한다.

## 남은 증명 의무

1. #591의 동적 범위 처리 의미를 확정하고 구현을 일치시킨다. 명령 추가가 필요하면
   기존 runtime의 수용 조건과 GFB 호환성을 함께 다룬다.
2. 실제 파싱 결과와 실제 생성 바이트 사이에서 scalar 표현식·분기·상태 갱신의
   의미를 독립 검증하는 관계를 만든다. 생산 파서를 신뢰하면 그 범위는 파싱 이후다.
3. 문서 추출·문법·타입의 관계, import 합성, 시간·예약·설정·오류 처리, 나머지 profile,
   manifest·trace와 Rust 실행기의 대응을 각각 증명해 연결한다.

현재 결과는 전체 정확성의 증명이 아니라 **반례가 있는 검증 결과와 한 최적화의
범용 증명**이다. 전체 완료 기준을 낮추거나 미증명 항목을 닫지 않았다.
