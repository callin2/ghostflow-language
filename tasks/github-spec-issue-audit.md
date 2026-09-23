# GitHub 언어 명세 이슈 대조 — 2026-09-23

## 범위와 근거

- 저장소는 **callin2/ghostflow-language**다. 같은 번호의 farm_studio_system 이슈와 구분한다.
- GitHub의 열린/닫힌 이슈 75개 목록을 확인했다. 언어·실행 의미·설정·합성·산출물과 관련된 이슈의 본문과 댓글을 읽었다. PLC 예제/배포 작업 전체의 완료 감사는 하지 않았다.
- 읽은 원격 자료: `build/github-language-issues-audit.json` (인증된 GitHub CLI로 조회). 일반 웹 접근은 404였으며, 인증된 조회는 성공했다.
- 비교 기준은 현재 로컬 `docs/LANGUAGE-REFERENCE.md`, `docs/reference/*.md`, 관련 소스와 `tasks/reference-evidence.md`다. 미커밋 로컬 구현을 원격 배포 완료로 취급하지 않는다.
- Sol은 합성, Astra는 시간 증거·제어·설명, Luna는 설정·관측·원문 보존을 검토했다. Main은 일정·정수·산출물과 주요 충돌을 교차 확인했다.
- **이슈 CLOSED는 해당 범위의 완료다.** 설계 완료, 예전 Solar slice 완료, 현재 전체 Reference 구현 완료는 서로 다르다. 이번 감사에서는 원격 이슈를 수정하거나 닫지 않았다.

## 우선 수정/정리할 사항

| 우선 | 이슈 | 판정 | 필요한 조치 |
|---|---|---|---|
| 1 | [#89](https://github.com/callin2/ghostflow-language/issues/89), [#90](https://github.com/callin2/ghostflow-language/issues/90), [#110](https://github.com/callin2/ghostflow-language/issues/110), [#105](https://github.com/callin2/ghostflow-language/issues/105) | **실제 문서 충돌.** #89 §8과 AC, #90 §8과 AC가 stopped/new-run을 요구한다. #110 및 Reference §5.2/§3.7은 동일 Program/run의 atomic live event다. | #89/#90의 본문·예제·AC를 최신 LIVE 의미로 수정한다. 상태·타이머 보존, 전체 batch 거부, settings revision/effective position을 기준으로 삼는다. 설비 모드 전환까지 LIVE로 바꾸지 않는다. |
| 1 | [#95](https://github.com/callin2/ghostflow-language/issues/95), [#46](https://github.com/callin2/ghostflow-language/issues/46), [#47](https://github.com/callin2/ghostflow-language/issues/47) | **의미 구분과 결정 동기화 필요.** `continuous_true(Bool)`의 tick 기반 경과와 `true_for(..., quality: measured)`의 Driver 인증 관측 구간은 다르다. | #95에 확정된 연속 관측 정책을 기록한다. Reference §3.3의 온도 예제가 물리 연속 관측의 증명처럼 읽히지 않도록 §4.4와 구분한다. #47의 두 state 슬롯 구현으로 `true_for`를 완료 처리하지 않는다. |
| 1 | [#95](https://github.com/callin2/ghostflow-language/issues/95) | **제품 선택은 완료, 명세 인터페이스는 미완성.** `after_event`는 시작 사건별 독립 결과다. 현재 REF-04-026의 단일 `opened |> recover(false)` 예제만으로 중첩 사건의 결과 선택을 설명할 수 없다. | event identity별 결과 접근, pending/negative 의미, 보존·용량과 경계 테스트를 정의한다. 기존 정상 기대값을 없애서 해결하지 않는다. |
| 1 | [#88](https://github.com/callin2/ghostflow-language/issues/88) | **수용 문구의 내부 모호성.** §4는 미평가 branch를 평가했다고 표현하지 못하게 하지만 Scan C는 두 OR support를 요구한다. Reference §2.6은 단락 평가다. | 실제 평가한 support만 근거로 인정하도록 Scan C/AC를 명확히 한다. 오른쪽 branch를 설명 목적으로 추가 실행하지 않는다. §8의 host-supplied schedule 설명도 새 Rust admission observation/provider facts 경계와 동기화한다. |
| 1 | [#3](https://github.com/callin2/ghostflow-language/issues/3) | **구현과 승인 근거 사이의 빈틈.** 이슈는 미승인 freshness/조용한 기본값을 금지한다. `control-runtime.mjs:sensorConfig`는 생략 시 `staleMs ?? 3000`, `recoverSamples ?? 1`을 넣는다. | 기본값 승인 근거 또는 명시적 source/Driver binding 계약을 확인한다. Reference §4.2의 3s 예제만으로 생략값 정책을 승인했다고 보지 않는다. 인증된 연속 관측을 이 기본값으로 대체하면 안 된다. 과거 승인 부재 자체는 이번 감사로 확정하지 않았다. |
| 1 | [#28](https://github.com/callin2/ghostflow-language/issues/28), [#29](https://github.com/callin2/ghostflow-language/issues/29), [#23](https://github.com/callin2/ghostflow-language/issues/23) | **현재 스케줄 구현과 직접 연결.** fallback, 복구, 중복 억제와 자연 사건 의미다. 최신 공통 schedule policy와 다중 crossing 결정이 원격 기록에 연결되어 있지 않다. | Reference §3.5/§3.9와 연결하고, 같은 schedule에서 여러 occurrence가 지나면 모두 missed/no execution인 벡터를 추가한다. Rust 판단·원자적 commit·provider facts·replay를 실제 완료 기준으로 삼는다. |
| 2 | [#48](https://github.com/callin2/ghostflow-language/issues/48), [#49](https://github.com/callin2/ghostflow-language/issues/49), [#51](https://github.com/callin2/ghostflow-language/issues/51) | **과거 좁은 완료 범위.** 기존 due 입력 경로와 portable reference provider의 완료다. #51은 VM/언어 의미 변경을 명시적으로 제외한다. | CLOSED를 유지하되 현재 후속 작업과 완료 범위를 연결한다. UTC/Seoul reference provider만으로 전체 IANA 지원이나 Rust의 schedule admission을 완료 처리하지 않는다. |
| 2 | [#22](https://github.com/callin2/ghostflow-language/issues/22), [#24](https://github.com/callin2/ghostflow-language/issues/24), [#25](https://github.com/callin2/ghostflow-language/issues/25), [#26](https://github.com/callin2/ghostflow-language/issues/26), [#27](https://github.com/callin2/ghostflow-language/issues/27) | **현재 작업보다 진행 기록이 뒤처짐.** 정수 slice의 과거 완료 댓글과 OPEN 상태, 미정/미지원 설명이 섞여 있다. | Reference §2.3/§3.1과 현재 compiler/native/WASM 증거를 AC별로 연결한다. #26의 conversion 미포함 경계도 현재 구현으로 다시 판정한다. 이번 목록 검토만으로 자동 종료하지 않는다. |
| 2 | [#93](https://github.com/callin2/ghostflow-language/issues/93) | **후보 문구가 채택 명세보다 오래됨.** canonical unit과 타입을 RFC에서 정한다고 하지만 Reference §2.9에 정의되어 있다. 예제의 Temperature `step = 0.5°C`도 현재 §5.1의 TemperatureDelta 규칙과 다르다. | 채택된 타입·단위 표와 `step = 0.5Δ°C`를 반영한다. quantity 구현 증거와 settings/Observation/Driver 연동의 남은 범위를 구분한다. |
| 2 | [#94](https://github.com/callin2/ghostflow-language/issues/94), [#96](https://github.com/callin2/ghostflow-language/issues/96) | **설계 충돌보다 구현 잔여 작업.** PID/objective와 누적 ON-time account 의미는 Reference §§4.11–4.14/§3.10에 이미 구체화되어 있다. | RFC 미정 문구를 현재 명세 링크로 갱신한다. hysteresis나 sample window를 PID/ON-time ledger 완료 근거로 쓰지 않는다. |

## 합성 관련 후속 설계

[상위 #99](https://github.com/callin2/ghostflow-language/issues/99)는 OPEN이고
[#100–#108 연구 작업](https://github.com/callin2/ghostflow-language/issues/108)은 CLOSED다.
이 상태는 import/instance/runtime 구현 완료를 뜻하지 않는다.

| 이슈 | 현재 Reference와의 관계 | 아직 결정/구현할 내용 |
|---|---|---|
| [#101](https://github.com/callin2/ghostflow-language/issues/101) | §6.2/§6.4의 source authority·독립 instance와 일치 | durable instance identity와 upgrade 연속성, installation constraint의 권한/검증 경계 |
| [#102](https://github.com/callin2/ghostflow-language/issues/102) | §6.5는 동시 snapshot·격리 등 의미를 정한다 | 하나의 VM으로 lowering할지 coordinated VM인지 선택하고 fault/order/cycle 의미를 검증. 이슈의 선호 가설을 확정으로 오해하면 안 됨 |
| [#103](https://github.com/callin2/ghostflow-language/issues/103) | 논리 port와 물리 binding 분리는 일치 | binding 제안, Unknown 물리 증거, resource accounting 구현/검증 |
| [#104](https://github.com/callin2/ghostflow-language/issues/104) | §6.6은 설명 가능한 오류 구조를 요구 | 안정적인 진단 코드·envelope·source/instance join과 부정 테스트 |
| [#106](https://github.com/callin2/ghostflow-language/issues/106) | §6.4의 immutable revision/digest closure와 일치 | package/lock 표현, resolver, 다중 source map, recursive 서명/native verifier 경계 |
| [#107](https://github.com/callin2/ghostflow-language/issues/107) | §6.7/§6.8 설명·재생 identity와 일치 | instance-qualified incident envelope, Driver feedback/gap 증거 |
| [#100](https://github.com/callin2/ghostflow-language/issues/100), [#108](https://github.com/callin2/ghostflow-language/issues/108) | 사용자 여정 및 인수 계획 | 승인된 구현 slice별 실행 테스트; 계획/연구 완료를 runtime·장치·사용성 완료로 승격하지 않음 |

## 관련 있지만 현재 명세 방향과 충돌하지 않는 작업

- [#1](https://github.com/callin2/ghostflow-language/issues/1), [#73](https://github.com/callin2/ghostflow-language/issues/73): canonical 기본값 수정 후보와 같은 Program의 운영 override를 구분해야 한다. 과거 stopped 댓글은 최신 LIVE 정책과 구분해서 주석 처리할 대상이다. #73 종료는 실제 host activation/swap 완료가 아니다.
- [#68](https://github.com/callin2/ghostflow-language/issues/68), [#69](https://github.com/callin2/ghostflow-language/issues/69), [#70](https://github.com/callin2/ghostflow-language/issues/70), [#74](https://github.com/callin2/ghostflow-language/issues/74): renderer-neutral 설정/명령/이벤트/알람, Rust-owned lifecycle 및 bounded 기록과 관련된다. 스키마·producer 구현과 외부 장기 저장은 별도다. #70의 오래된 stopped 설명도 정리해야 한다.
- [#31](https://github.com/callin2/ghostflow-language/issues/31), [#43](https://github.com/callin2/ghostflow-language/issues/43), [#44](https://github.com/callin2/ghostflow-language/issues/44), [#60](https://github.com/callin2/ghostflow-language/issues/60), [#78](https://github.com/callin2/ghostflow-language/issues/78): canonical `.ghost.md`, 원문/주석/해시, intent/source provenance, browser-safe 단일 compiler 경계와 일치한다.
- [#42](https://github.com/callin2/ghostflow-language/issues/42): SMT/BDD 컴파일 pass의 등가성·오류·provenance 설계다. 이슈는 library 설치나 compiler 구현 완료를 요구하지 않는 설계 범위다. 현재 안전 evaluator를 SMT라고 부르면 안 된다.
- [#4](https://github.com/callin2/ghostflow-language/issues/4), [#54](https://github.com/callin2/ghostflow-language/issues/54), [#56](https://github.com/callin2/ghostflow-language/issues/56), [#91](https://github.com/callin2/ghostflow-language/issues/91): 기존 signed package/고정 vector의 완료는 유지한다. 새 GFB5는 canonical source부터 package·native/WASM까지 별도 증거가 필요하다. 이번 structural encoder/loader 증거만으로 전체 signed 배포 계약을 확장할 수 없다.
- [#30](https://github.com/callin2/ghostflow-language/issues/30): Reference와 별개로 책의 실행 예제를 현재 지원 범위에 맞추는 후속 작업이다. 이 저장소 #30은 OPEN이다. #70 댓글의 다른 작업 번호는 저장소를 명시해야 혼동을 피할 수 있다.

## 로컬 문서 정리 대상

- `docs/LANGUAGE.md`의 운영 설정 stopped/Configure 요구와 `docs/CONSTRAINTS.md`의 설정 적용 전제는 Reference §5.2보다 오래되었다. 설정 변경에 관한 부분을 정리하되 설비 모드 전환 interlock은 유지한다.
- `docs/EXACT-INTEGER-CONTRACT.md`의 Bool/Number-only·proposal 설명과 `docs/CONTINUOUS-BOOL-TIMER-CONTRACT.md`의 미정 source spelling은 역사적 설계 범위임을 명시하고 최신 Reference/구현으로 연결한다.
- `docs/reference/03-time-and-schedules.md` §3.3과 §4.4의 logical Bool duration / measured interval evidence 구분을 명확히 한다.
- `after_event`의 사건별 결과 인터페이스와 bounded capacity는 정책 결정 뒤의 남은 기술 명세다.

## 권장 순서

1. #89/#90 및 오래된 설정 문구의 LIVE 정합성부터 수정한다.
2. #95에 세션 결정을 연결하고 `true_for`/`after_event` 명세의 인터페이스 빈틈을 정리한다.
3. #28/#29의 Rust schedule 구현과 #88의 실제 평가 증거를 같은 계약으로 연결한다.
4. 합성 구현 전에 #101/#102/#104/#106의 기술 선택을 명시한다.
5. 구현별 AC와 실행 증거를 연결하여 이슈 진행 상태를 갱신한다. 실제 전체 완료 근거 없이 닫지 않는다.
