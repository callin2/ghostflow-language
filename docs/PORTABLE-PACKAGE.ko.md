<!-- translation-source: docs/PORTABLE-PACKAGE.md -->
[영문 원문](PORTABLE-PACKAGE.md)

# 이식 가능한 GFB 패키지 v1

`GhostFlow/portable-package-v1`은 하나의 정본 리터레이트 소스 리비전을 Browser 및 Device 호스트가 로드하는 정확한 GFB1 바이트에 연결합니다. 생성된 매니페스트, 소스 맵, 실행 호환성 식별 정보, Ed25519 서명도 담습니다. 패키지는 GFB1 바이트나 VM 의미를 바꾸지 않습니다.

## 엔벌로프

```text
package
├─ format: GhostFlow/portable-package-v1
├─ payload
│  ├─ format: GhostFlow/portable-payload-v1
│  ├─ source: exact UTF-8 .ghost.md bytes + SHA-256
│  ├─ bytecode: exact GFB profile 1/2/3/4 bytes + SHA-256
│  ├─ manifest: exact canonical JSON bytes + SHA-256
│  ├─ sourceMap: exact canonical JSON bytes + SHA-256
│  └─ identity
│     ├─ compilerRevision
│     ├─ runtimeSemantics
│     ├─ runtimeAbi
│     ├─ requiredCapabilities[]
│     └─ bindingRevision
├─ payloadSha256
└─ signatures[]: algorithm + keyId + signatureBase64
```

바이너리 필드는 정규 패딩 base64를 사용합니다. 매니페스트와 소스 맵 바이트는 JSON 키를 재귀적으로 정렬하고 배열 순서는 보존하며 ECMAScript 유한 숫자 직렬화를 사용합니다. 희소 배열과 JavaScript의 정확한 안전 범위를 벗어난 정수는 거부하며 `-0`은 `0`으로 직렬화됩니다. 원본 Markdown은 정규화하지 않습니다. 유니코드, 주석, 산문, CRLF, 마지막 개행까지 소스 다이제스트에 포함됩니다.

`buildPortablePackage`는 소스가 `.ghost.md` 리터레이트 문서이고 제어 매니페스트가 GFB 다이제스트와 일치하는 `compileSource` 결과만 받습니다. 서명하려면 새 `verifyCompilation` 재생도 필요합니다. 그 결과의 정확한 GFB, 매니페스트, 소스 맵 바이트가 제공된 결과와 일치해야 공식 빌더가 읽을 수 있는 소스와 다른 프로그램을 짝짓지 못합니다. 필요한 기능은 `kind`, `name`, `type` 순으로 정렬합니다. 모든 매니페스트 입력(`input`), 선택 사항이 아닌 센서(`sensor`), 출력(`actuator`)은 서명된 필수 기능 집합과 양방향으로 일치해야 합니다. 선택 센서는 필수 집합 바깥에 두며 명시적인 호스트 binding이 존재 여부를 정합니다.

## 서명 바이트와 신뢰

서명 입력은 `payload`를 정확하게 정규 UTF-8로 인코딩한 바이트입니다. `payloadSha256`은 같은 바이트를 해싱합니다. 외부 패키지 형식은 검증 전에 확인하며 `signatures` 및 `payloadSha256`은 서명 입력에서 제외합니다. 내장된 모든 바이트, 설명자, 실행 식별 정보는 서명된 페이로드 안에 있습니다.

버전 1은 Ed25519만 허용합니다. 각 서명에는 길이가 제한된 `keyId`가 있어야 합니다. 중복 키 또는 알고리즘 협상은 거부됩니다. 검증기는 명시적인 신뢰 입력 두 개를 받습니다.

- `trustedKeys`: 현재 수락되는 키 ID 및 Ed25519 공개 키
- `revokedKeyIds`: 더는 패키지를 승인할 수 없는 키

두 입력은 모두 필수 신뢰 스냅샷입니다. 폐기 상태를 생략하면 빈 폐기 목록으로 취급하지 않고 오류로 처리합니다.

키 교체는 공동 서명 패키지로 합니다. 호스트는 먼저 다음 공개 키를 신뢰하고, 현재 키와 새 키로 서명한 패키지를 수락한 뒤 이전 키를 폐기합니다. 다른 활성 신뢰 서명이 검증되면 폐기 서명은 무시합니다. 활성 신뢰 서명이 더는 없으면 패키지를 거부합니다. 신뢰 기록은 벽시계에 의존하지 않습니다.

`tests/portable-package.test.mjs`의 RFC 8032 키 자료는 공개 테스트 데이터이며 제품 신뢰 루트로 설정하면 안 됩니다.

## 검증 순서

### Native 개발 인증 정책

Rust `ghostflow-package`의 `verify_portable_package` API는 항상 발행자 인증을
강제한다. `SignaturePolicy::default()`는 `Enforce`다. 명시적인 개발 host는
`verify_portable_package_with_signature_policy`에 `DevelopmentBypass`를 전달할
수 있다. 동일한 canonical verifier와 target loader를 사용한다. 이 owner
interface는 Device build profile을 선택하거나 Browser/JavaScript 검증의 우회를
활성화하지 않는다.

개발 우회는 빈 `signatures` 배열 또는 신뢰하지 않거나 폐기된 발행자의 서명을
받으며 암호학적 인증을 검사하지 않는다. 배열은 필수이고 `max_signatures` 한도를
유지한다. 존재하는 항목은 정확한 schema, Ed25519 algorithm, 서로 다른 bounded
key ID, 64바이트의 canonical base64 encoding을 가져야 한다. 이 모드에서는
trust roots와 revocation 입력을 사용하지 않으며 가짜 trusted key로 대체하지
않는다. Canonical transport, payload/artifact hash, size bound, compatibility
identity, capability, binding, source/bytecode cross-link, target loading은 계속
필수다. Hash는 byte 일관성을 나타내며 발행자 인증이나 의도를 보증하지 않는다.

결과의 `signature_authentication`은 `Authenticated` 또는 `DevelopmentBypass`다.
우회 결과의 `accepted_key_ids`는 제공한 서명이 검증될 수 있어도 항상 빈 배열이다.
Host는 이 비인증 상태를 공개하고 upload, 저장 program의 boot, rollback에 동일한
정책을 적용해야 한다. Production과 trusted acceptance host는 강제 검증을 유지해야
한다. 개발 우회는 output authority나 실행 권한을 부여하지 않는다.

`verifyPortablePackage`는 안정적인 `code`가 있는 `PortablePackageError`를 반환하고 다음 검사가 통과할 때까지 바이트코드를 공개하지 않습니다.

1. 정확한 패키지/페이로드 스키마와 지원 버전
2. 정규 페이로드 다이제스트 및 활성 신뢰 서명 하나 이상
3. 컴파일러 리비전, 런타임 의미, 런타임 ABI, 바인딩 리비전
4. 호스트 입력에 대한 매니페스트 형식 및 필수 기능
5. 소스, GFB, 매니페스트, 소스 맵 내용 다이제스트와 상호 연결
6. 컴파일러 소유 소스 추적 메타데이터와 소스/GFB 식별 정보
7. 호스트가 제공하는 `verifyBytecode` 콜백

콜백은 필수입니다. 정확한 GFB 바이트와 깊게 동결된 검증 매니페스트, 소스 맵, 식별 값을 전달받습니다. Browser는 WASM GFB1 로더를 전달하고 Device는 네이티브 `Module::load` 경계를 전달합니다. false 결과 또는 예외는 `bytecode-rejected`가 됩니다. 명시적인 true만 대상 로더 결과를 수락합니다. 검증된 결과는 접근할 때마다 분리된 `bytecode.copy()`를 제공해 호출자가 보관된 검증 바이트를 바꾸지 못하게 합니다. 검증기는 다른 ABI로 재시도하거나 알 수 없는 요구 사항을 제거하거나 다른 바인딩을 대입하거나 이전 프로그램으로 대체하지 않습니다.

반환되는 소스, 매니페스트, 맵, GFB 바이트는 모두 검증된 페이로드에서 가져옵니다. 패키지 다이제스트는 식별 정보를 입증하고 서명은 수락된 발행자를 입증하지만, 농가 의도, 하드웨어 호환성, 릴레이 동작, 물리 부하 이동을 입증하지는 않습니다.

`bindingRevision`은 API와 Device가 선택한 설치 바인딩을 식별합니다. 이 패키지는 정확한 리비전 일치와 논리 기능 형태를 검증합니다. 소유 API/Device 계층은 패키지 검증기를 호출하기 전에 해당 리비전의 실제 DI/RO 채널 맵을 검증해야 합니다.

## 호환성 및 마이그레이션

### 스칼라 설정을 사용하는 서명된 GFB11 Periodic

GFB11, `GhostFlow/control-v10`, `GhostFlow/context-scan-abi-v5` 조합은 이제
스칼라 config와 실행 가능한 Periodic schedule을 함께 패키지로 만들 수 있습니다.
현재 서명 프로필은 instant anchor, `preserve_anchor`, config 기반 `Duration`
간격, 상수 `true` 조건, `pulse`/`trusted_only`/`baseline`/`skip` 정책만
지원합니다. manifest의 schedule site, 이름, 간격 config ID와 값, anchor,
gap, 정책은 GFB11 설명자와 일치해야 합니다. 생성된 config 투영 입력과
clock/epoch 입력도 바이트코드와 일치해야 합니다. 다른 schedule 종류,
objective/window/signal 서두, 서명되지 않았거나 불일치하는 패키지는
계속 거부합니다. 스칼라 config의 초기값과 범위 검사는 유지합니다.
이 변경은 패키지 승인 범위만 넓히며 언어나 Device 배포 정책은 변경하지 않습니다.

- 패키지 v1에는 지원되는 GFB 프로파일 하나가 들어갑니다. 서명된 바이트코드 설명자 버전은 실제 리틀엔디안 헤더 버전의 십진 문자열입니다. JavaScript 및 Rust 검증기는 대상 로더를 호출하기 전에 정확히 일치하는지 확인합니다. 지원되지만 서로 다른 버전은 `bytecode-version-mismatch`, 알 수 없는 버전은 `unsupported-bytecode-version`으로 보고합니다. Int 포트는 프로파일 3에서도 별도 `int` 기능 형식으로 매핑합니다. 17개 물리량 형식은 기계 기능 `number`에 매핑하며, 해당 입력/출력/센서/설정 설명자는 카탈로그의 정확한 `canonicalUnit`을 요구합니다. 입력/출력 물리량 레코드에는 `name`, `type`, `canonicalUnit`만 포함됩니다. 물리량이 아닌 레코드에는 그 필드가 허용되지 않습니다. JavaScript와 Rust는 대상 로더를 호출하기 전에 누락되었거나 잘못되었거나 예상 밖인 단위 메타데이터를 거부합니다. 컴파일 재생, 서명, 아티팩트 다이제스트, 대상 검증도 계속 필요합니다. 현재 프로파일 의미는 [BYTECODE.md](BYTECODE.md)를 참조하세요.
- 서명된 배포가 필요한 호스트는 유효하지 않은 패키지를 원시 `.gfb` 경로로 강등해서는 안 됩니다.
- 알 수 없는 패키지, 페이로드, 바이트코드, 매니페스트, 런타임 의미, ABI 버전은 거부됩니다. 새 버전을 지원하려면 새 적합성 코퍼스와 명시적인 소비자 호환성 업데이트가 필요합니다.
- API 저장소, Device 원자적 준비/활성화/복구, 프로덕션 키 보관은 각 모듈의 책임이며 이 패키지 계약을 소비합니다.

`tests/portable-package.test.mjs`는 결정적 생성 및 컴파일러 재생, 소스/아티팩트 보존, 변조 거부, 키 교체/폐기, 기능/바인딩 거부, Buffer 없는 브라우저 검증, 릴리스 네이티브 Rust 및 WASM GFB1 로더를 통한 바이트 동일 추출을 다룹니다.

## 네이티브 검증기 API

`crates/ghostflow-package`는 정확한 정규 `GhostFlow/portable-package-v1` 전송 바이트(마지막 개행 하나 포함)만 받습니다. 서명된 페이로드 다이제스트, 신뢰된 미폐기 Ed25519 서명, 컴파일러/런타임/바인딩 식별 정보, 기능 및 매니페스트 상호 연결, 아티팩트 다이제스트, GFB 프로파일/헤더 일치, 정규 내장 매니페스트/소스 맵 JSON, 소스 맵의 정본 소스 문서 연결을 검증합니다.

호출자는 필수 `TargetLoader`를 제공합니다. 해당 로더가 `Ok(true)`를 반환하기 전까지 검증기는 GFB1 바이트 사본을 반환하지 않습니다. `VerifiedPackage`는 수락된 서명 키 ID와 함께 분리된 소스, 매니페스트, 소스 맵, 바이트코드 사본을 반환합니다.

네이티브 v1 범위는 의도적으로 `sourceMap.traceMetadata`의 컴파일러 소유 심층 의미 검증을 중복 구현하지 않습니다. 해당 검증은 기존 JS 공통 검증기에 남아 있으며 서명 전 신뢰된 패키지 빌더의 새 결정적 컴파일러 재생에서 확인됩니다. 네이티브 검증은 원시 GFB나 레거시 대체 경로를 허용하지 않으며 호출자 제공 증명을 신뢰 권한으로 취급하지 않습니다.

GFB 프로파일 4에서는 네이티브 검증기가 매니페스트 및 바이트코드 상호 연결의 일부로 서명된 윈도우 설명자와 기계 바인딩을 검사합니다. 중첩 설명자는 각 `upstreamWindows` 이름, 사이트, 이전 슬롯을 품질 투영에서 디코딩한 종속성 목록에 바인딩합니다. 누락되었거나 비어 있거나 다른 항목으로 재바인딩된 종속성 목록은 대상 로더 전에 거부됩니다. 시간 활성화는 별도 런타임 단계입니다. 호출자는 서명 검증 뒤 명시적인 시간 에폭, 루트 밀도 한도, 보존 예산을 제공합니다. 서명 검증만으로는 시간 프로파일이 활성화되거나 윈도우 추적 의미가 입증되지 않습니다. 네이티브 패키지 범위는 정본 JavaScript 소스를 재컴파일하거나 심층 의미 추적 재생을 수행하지 않습니다. 설명자 검증만으로는 런타임의 중첩 윈도우 연산 또는 증거 보존을 입증하지 못합니다.

현재 네이티브 크레이트 대상은 Rust `std`이며 Farm Device에서 사용하는 ESP-IDF Rust 런타임을 포함합니다. 별도 `no_std` 패키지 스택은 Waveshare 대상 범위에 없습니다. `VerifierLimits`는 전송, 서명 페이로드, 아티팩트, 서명, 기능, JSON 깊이에 한도를 둡니다. Device 소비자는 장치에 맞는 프로파일을 선택하고 활성 프로그램 슬롯 바깥에서 전송 바이트를 준비한 다음 원자적 활성화 전에 이 검증기를 호출해야 합니다. 호스트 검증만으로 MCU 활성화, 릴레이 동작, 물리 부하 이동을 입증하지 못합니다.


## 적응 전략 descriptor

컴파일러가 생성한 `adaptPolicy`와 `strategies`는 함께 서명되는 매니페스트
메타데이터입니다. JS 검증은 정본 소스 재컴파일 및 정확한 bytecode와 비교합니다.
Native 검증은 디코딩된 core module의 순서 있는 전략 이름, 우선순위, 출력 이름 및
capability query 바이트와 일치하는지 검사합니다. 타입이 있는 match는 선언된
sensor/actuator capability를 참조해야 합니다. 선택 방식은
`highest-priority-unique`입니다. 지원되지 않거나 짝이 없는 메타데이터는 로드 전에
거부됩니다. 정책 이름은 서명된 한정된 소스 메타데이터이며 새 runtime selector가 아닙니다.

선택 Bool 관측은 새 정책을 자동으로 선택하거나 활성화하지 않습니다.
명시적 호스트 capability snapshot이 작성된 전략의 적격 여부를 정합니다.
Native/WASM 테스트는 부재 시 baseline과 존재 시 feedback 출력을 유지하며,
재서명된 전략/query/bytecode 변조를 거부합니다. GFB 및 wire 형식, ABI와 서명
정책은 바뀌지 않습니다. 물리 배선과 Device admission은 소비자의 책임입니다.
