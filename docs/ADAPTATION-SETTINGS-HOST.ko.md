<!-- translation-source: docs/ADAPTATION-SETTINGS-HOST.md -->
[English original](ADAPTATION-SETTINGS-HOST.md)

# 제한된 적응 설정 호스트

`runtimes/wasm/adaptation-settings-host.mjs`는 실제 Rust context 설정 소유자
주위에서 Reference §4.14의 제안 검증을 수행한다. GhostFlow 표현식을 평가하거나
출력 권한을 제공하지 않는다. 컴파일러는 정규 소스의 typed `allowed`, `maxStep`,
`maxChange`, `windowMs` 값을 전달한다. Temperature 변화량은 TemperatureDelta를
쓰며 다른 물리량은 정규 단위를 유지한다. 알 수 없는 필드, 중복 대상, 잘못된
경계는 컴파일 단계에서 거부한다.
활성화는 신뢰된 정규 컴파일 산출물을 사용한다. bytecode digest만으로 정책 metadata를
인증하지 않으며 구조 검증은 임의로 제공한 manifest나 소스 provenance를 인증하지 않는다.

`AdaptationSettingsHost.instantiate(wasm, artifact, { context,
authorities: { model: 'optimizer' }, historyCapacity: 256 })`로 생성한다. 신뢰된
호스트가 새 활성화 시 actor와 authority의 대응을 제공한다. 정책 대상은 operator가
편집할 수 있는 numeric context config여야 한다. `step(packet, proposal)`은 보통의
ControlRuntime packet과 `eventId`, `actor`, `authority`, `source`, `evidence`,
`sourceSha256`, `policySha256`, `programFingerprint`, `baseRevision`, `atMs`, `{ configId, type, value }` 형식의
`changes`를 가진 제안을 받는다. 현재 식별자는 `snapshot().core.state`에서 얻는다.
정규 소스 식별자는 `snapshot().sourceSha256`를 사용한다. 정책만 바뀐 소스는 같은
bytecode와 core fingerprint를 유지할 수 있으므로 이전 정책 소스를 대상으로 한
제안도 거부해야 한다.
`snapshot().policySha256`는 검증한 정책 descriptor의 canonical JSON digest다.
활성화와 step 인자는 검증 전에 비공개 복사한다.
발생 시각은 packet의 단조 시계와 같아야 한다. 모든 property가 타입, 설정 격자와
범위, 허용 범위, 단일 변화량, 권한, rolling 절대 변화량 검사를 통과한 뒤에만
하나의 atomic core 설정 event를 제출한다.

예를 들어 시간당 10% 한도에서 승인된 20%→30% 변화 뒤 한 시간 안에 30%→25%를
제안하면 절대 변화량 한도를 초과한다. 같은 event의 다른 property도 바뀌지 않는다.
거부는 `outcome: null`과 이전·제안·유효 값, provenance, 사유, 실제 프로그램과 설정
식별자, 다음 1부터 시작하는 core 위치를 포함한 trace를 반환한다. tick, 시계, 이력,
revision을 commit하지 않는다. 성공은 실제 core 출력과 새 revision을 반환하며 core
승인 후에만 이력을 기록한다. window의 정확한 왼쪽 경계는 제외한다. Int와 Duration
격자는 정확한 나머지 연산으로 검사한다.

이 제한된 reference profile은 비공개 새 core를 소유하며 복사 전용 snapshot만
제공하고 restore나 외부 설정 변경 API는 노출하지 않는다. `historyCapacity`
(1–4096)는 활성 변화 기록 수와 누적 승인 event 식별자 수를 모두 제한한다.
용량 소진 시 거부하며 이력 만료로 중복 방지 식별자를 지우지 않는다. checkpoint
복구를 통합하려면 두 상태를 함께 보존해야 하며 이 profile의 범위 밖이다. 거부된
제안은 승인된 시계 관측이 아니다. optimizer provenance는 host trace에 기록한다.
기존 wire의 `operatorEdit` origin은 여기서 권한을 검증한 운영 편집을 뜻하며 사람이
편집했다는 증거가 아니다. API publishing run 식별자, Device 적용, 하드웨어 검증을
입증하지 않는다. `tests/adaptation-settings-host.test.mjs`의 REF-04-064가 실제
활성화, atomic 거부, 승인 값, revision 경계를 검증한다.
