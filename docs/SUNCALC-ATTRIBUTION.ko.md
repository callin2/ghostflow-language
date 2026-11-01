<!-- translation-source: docs/SUNCALC-ATTRIBUTION.md -->
[영문 원문](SUNCALC-ATTRIBUTION.md)

# 이식 가능한 태양 공급자의 SunCalc 저작자 표시

`crates/ghostflow-core/src/solar.rs`는
[SunCalc 2.0.2](https://github.com/mourner/suncalc/tree/v2.0.2)의 해수면 기준
일출/일몰 계산을 Rust로 이식한 것입니다. 외부 의존성은 없습니다.

이식 범위는 다음과 같습니다.

- **이식함:** SunCalc의 `getTimes` 경로와 겉보기 태양 좌표 보조 함수.
- **이식하지 않음:** 달 계산과 변경 가능한 사용자 지정 시간 설정.
- **identity(식별자):** 이식본은 기존 JavaScript 참조 어댑터가 사용하는 것과
  같은 `suncalc-2.0.2/sea-level` 계산 식별자를 유지합니다.

Copyright (c) 2026, Volodymyr Agafonkin. 업스트림 BSD 2-Clause 라이선스의
조건을 따르는 한, 수정 여부와 관계없이 소스 및 바이너리 형식의 재배포와 사용이
허용됩니다. 보존된 전체 라이선스 고지는 아래와 같습니다.

```text
Copyright (c) 2026, Volodymyr Agafonkin
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of
   conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list
   of conditions and the following disclaimer in the documentation and/or other materials
   provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

**이식본 검증.** `cargo test`는 체크인된 테스트 벡터를 검증합니다.
선택적으로 픽스처의 출처도 검증할 수 있습니다. 변수가 SunCalc 2.0.2 패키지의
명시적인 로컬 사본을 가리키도록 하여
`GHOSTFLOW_SUNCALC_REFERENCE_DIR=/absolute/path/to/suncalc node tools/compare-solar-reference.mjs`
를 실행하십시오. 이 스크립트는 다음을 수행합니다.

- JavaScript 공급자가 정확히 그 패키지로 해석되는지 확인합니다.
- 패키지 버전을 확인합니다.
- 유한하지 않은 결과를 거부합니다.
- 미리보기 픽스처와 폴링 픽스처를 모두 다룹니다.
