<!-- translation-source: docs/plans/2026-10-14-lifecycle-range-integration.md -->
[영어 원문](2026-10-14-lifecycle-range-integration.md)

# Lifecycle과 immutable IANA Range 통합

이 owner source 통합은 restart lifecycle과 immutable IANA Range를 함께 유지한다.
runtime 발행, consumer 배포 또는 물리 출력 증거를 뜻하지 않는다.
근거 항목은 [PR536](https://github.com/callin2/ghostflow-language/pull/536)과
[issue541](https://github.com/callin2/ghostflow-language/issues/541)이다.

## 근거와 번호 할당

기준은 `dev`의 `06c09444fda9acee04ecc96d5e549deac85f91df`이다.
Lifecycle PR536의 `2e59196e25bc46deab3ce93b375f54dd35b35b9c`는
GFB21 envelope를 임시·미발행으로 설명한다. Range의
`d8ffb18eef3a970c96356375597b52783ea4c6d2`는 GFB21을 immutable
civil Range에 할당한다. 공개된 prerelease `ghostflow-runtime-99ca1a3`는
lifecycle envelope에 GFB19를 사용했다. 이 release와 consumer pin을 보존한다.

Range21을 유지하고 별도 lifecycle22 envelope를 할당한다. envelope는 변경 없는
내부 GFB byte와 검증된 restart descriptor를 담는다. 기존 runtime tag 여섯 개
`0c545af`, `81814e4`, `9155047`, `96cab9b`, `99ca1a3`, `b50bec3`와
위 owner ref의 loader·tools·tests·문서에서 GFB22 할당은 발견되지 않았다.
이는 확인한 역사적 범위이며 모든 미래 branch에 대한 주장이 아니다.
`81f2532` GitHub release 기록은 발행 시각 없는 draft다.

Range 번호 변경은 현재 source 할당을 불필요하게 버린다.21을 재사용하면서 탐지하거나
새 tag를 넣으면 하나의 header에 양립하지 않는 두 의미가 남아 저장된 byte를
오해석할 수 있다. 별도22는 이 모호함을 없앤다. 역사적 lifecycle19와 임시
lifecycle21은 변환이나 fallback 없이 명시적으로 거부한다. 이전에는 검토한 source를
이 owner 후보로 재컴파일하고 정확한 consumer pin을 조정해야 한다.

## 책임과 허용 범위

Language는 compile, descriptor 검증, 내부 bytecode 실행과 framed runtime의
restart 초기화를 소유한다. 호스트는 실제 restart 원인과 boot event의 pending 여부를
공급하며 원인 근거가 없으면 `Unknown`을 공급한다. 원인은 run 동안 고정되고 처음
성공적으로 commit된 scan이 pending event를 소비한다. 거부된 scan은 pending을
유지한다. 소비 후 프로그램 교체는 새 boot event를 만들지 않는다. Authoring과
consumer binding 준비는 runtime 소유 port를 물리 취득 입력에서 제외한다.
관찰값을 꾸며내거나 state를 재개하지 않는다. 작성한 state 전이가 복구 동작을
소유한다. Device 설치 정책과 출력 renderer가 물리 출력 적용과 증거를 소유한다.

Portable package는 기존 base-profile 허용 범위를 유지한다. format1–4,10,11은
22로 감쌀 수 있지만 wrapper가 모든 Range profile의 portable 지원을 뜻하지 않는다.
호스트 Range 실행은 유효한 시간 coverage와 occurrence fact를 공급하며 shared core는
작성한 schedule을 검증하고 실행한다.

## 검증과 통합 순서

Native/WASM 회귀 검사는 immutable IANA Range와 restart 결합 동작을 확인한다.
첫 pending event와 commit 후에만 이루어지는 소비도 포함한다. 거부 검사는 역사적19,
임시 lifecycle21, 잘못된 descriptor, 중첩 wrapper, 잘림과 후행 byte를 포함한다.
기존 지원 profile은 유지한다. 이 검사는 software fact이며 하드웨어로 확인한 원인
증거가 아니다.

Language를 먼저 통합·검증하고 정확한 Authoring/Simulator consumer를 연결한 뒤
API/Web binding과 표시를 연결한다. 후보 source, package identity, 발행 artifact와
실제 구동 service 증거를 구분한다. draft PR이나 로컬 검사 성공만으로 발행 또는
배포가 확인되지는 않는다.
