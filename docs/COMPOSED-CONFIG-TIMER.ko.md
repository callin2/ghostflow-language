<!-- translation-source: docs/COMPOSED-CONFIG-TIMER.md -->
[English original](COMPOSED-CONFIG-TIMER.md)

# 조합된 control의 config·timer 격리

컴파일러는 하나의 판본이 고정된 definition에 scalar `config` stream과 `elapsed` 또는 `continuous_true` timer가 있어도 이를 여러 번 인스턴스화할 수 있습니다. config 이름과 ID, 작성된 state, timer 이름과 생성된 timer state를 인스턴스 경로별로 구분합니다. 원본 definition 텍스트·digest·source node·인스턴스 경로는 컴파일 산출물에 남습니다. 합쳐진 Program은 기존 Rust 코어가 평가하며, JavaScript에 별도 timer나 설정 평가기를 두지 않습니다.

참조 host는 한정된 config ID 하나에 live settings event를 적용할 수 있습니다. 모든 config는 Program의 단일 원자적 설정 transaction과 전역 `settingsRevision`을 공유하지만, 각 config는 자신의 최신 Result, `emissionRevision`, 적용 위치를 유지합니다. east 설정 변경은 west 값이나 emission revision을 바꾸지 않습니다. 두 timer는 같은 제공된 논리 시계를 읽고, state와 시작점은 서로 분리됩니다. 설정 권한과 대상을 지정할 때는 검증된 컴파일 manifest의 정확한 ID를 사용하고, 활성화 전에 source closure를 고정해야 합니다.

`tests/composition-config-timer-isolation.test.mjs`는 동일한 완전 입력과 설정 event로 두 인스턴스 Program을 `TemporarySettingsHost`와 native `context_tape`에서 실행합니다. state·timer·settings·output·가져온 source provenance를 검사합니다. 잘못된 import 판본이나 digest, 다른 인스턴스를 겨냥한 권한, 유효하지 않은 임시값은 마지막으로 수락된 host snapshot을 바꾸지 않고 거절됩니다.

## 현재 경계

- 이 기반은 배포용 불투명 instance ID나 인스턴스별 설치 binding revision을 발급하지 않습니다. Integration v1은 설치 mapping 하나를 고정합니다. source map의 인스턴스 경로는 컴파일 provenance이며 Device에 실제 적용된 binding의 증거는 아닙니다.
- interaction-v0 descriptor 생성기는 root source만 읽습니다. config나 timer가 있는 조합 산출물을 거절하므로 해당 선언이 유효한 descriptor schema에서 조용히 빠지지 않습니다. config와 timer가 없는 기존 조합은 descriptor와 closure identity 경로를 유지합니다. 조합된 설정·timer의 descriptor와 binding 연결은 별도 작업입니다.
- 가져온 config literal offset은 root 조합 source가 아니라 가져온 definition을 가리킵니다. 이 기반은 검증된 host에서 live settings event를 제공하며, 가져온 source의 literal 편집은 제공하지 않습니다.
- context manifest는 source type·sample 주기·optionality가 같은 인스턴스 sensor rail을 허용합니다. 기존 `ControlRuntime`은 각 인스턴스에 별도 conditioner를 둡니다. 현재 context profile은 input filter와 그 밖의 미지원 conditioning metadata를 활성화 전에 계속 거절합니다. native tape 검사는 인스턴스 rail을 명시적으로 제공하고, WASM host는 root sample에서 이를 만듭니다.
- GFB11/12 bytecode를 `ControlRuntime`에서 직접 활성화하려면 정규 source document와, import가 있을 때 전체 closure가 필요합니다. manifest 필드를 지워도 bytecode header로 이 요건을 판단합니다. 런타임 생성 전에 source를 다시 컴파일해 정확한 bytecode·closure·manifest를 대조하므로, `sensorInstances`를 편집하거나 지워도 같은 타입의 다른 root sensor로 바꿀 수 없습니다. 저장 또는 서명된 GFB11/12 산출물을 불러오는 host는 이미 검증한 source document와 closure를 `ControlRuntime`에 전달해야 합니다.
- native/WASM 일치는 이 참조 실행 계약의 근거입니다. settings actor·설치 기록·시계·Device 배포·물리 출력의 진위를 확인하지는 않습니다.
