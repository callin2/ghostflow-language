<!-- translation-source: docs/INSTANCE-TRACE-PROJECTION.md -->
[영어 원문](INSTANCE-TRACE-PROJECTION.md)

# Instance trace projection 참조 어댑터

`tools/instance-trace-projection.mjs` 어댑터는 REF-06-003 instance 표시와 trace projection을 위한 작은 production 참조 owner다. GhostFlow source 문법을 바꾸지 않고 expression을 평가하지 않는다. 이미 컴파일된 artifact를 검증한 뒤, 컴파일된 runtime이 `observeSourceTrace()`로 방출한 관측만 projection한다.

Activation은 display metadata를 받기 전에 source에 결합된 전체 identity를 검증한다.

- canonical root `sourceDocument` text와 SHA-256;
- import된 모든 source-closure 문서의 text, immutable revision과 SHA-256;
- control manifest 및 trace metadata에 대한 bytecode SHA-256;
- 정확한 root source와 imported closure 재컴파일, 그리고 supplied artifact의 bytecode, manifest, source closure, source map, trace metadata 일치;
- 컴파일된 instance ID와 정확히 일치하는 explicit label.

Display label과 presentation revision은 어댑터 metadata다. 이 값들은 source revision이 아니며 instance를 rename하지 않고 semantic trace key에 영향을 주지 않는다. Caller가 파일을 옮기거나 선언 순서를 바꾸거나 presentation label을 바꾸더라도 authored instance ID가 같으면 projection은 방출된 instance identity와 source/source-map metadata에서 얻은 authored symbol로 key를 유지한다. Authored instance ID가 바뀌면 이전 trace identity로 alias하지 않는다.

`projectTrace(trace)`는 trace의 module fingerprint가 활성화한 artifact와 다르면 거부한 뒤 실제 source trace observation을 연결한다. 반환 entry는 컴파일된 instance ID, display label, source node, authored symbol 및 관찰 trace field를 포함한다. compiler의 원래 parsed declaration을 source-map의 `definitionNodeId`로 연결하므로 한 줄의 여러 선언과 여러 줄에 걸친 선언이 각각의 symbol을 유지한다. private VM slot 이름이나 숫자 node 순서는 공개 semantic key가 아니다. key와 observation kind가 state/next-state 보기를 식별하며 node ID와 위치는 정확한 artifact 출처를 보존한다.

활성화는 비동기 검증 전에 compilation과 presentation 입력을 소유한다. projection은 깊이 동결한 복사본을 반환하며 호출자의 runtime trace를 동결하거나 변경하지 않는다. projection의 유일한 진입점은 활성화한 module fingerprint의 실제 source trace를 받는다. 검증하지 않은 observation 입력, 사용자 검증 callback 또는 테스트 전용 소유권 option은 공개하지 않는다. `presentationRevision`은 필수이며 source revision으로 대체할 수 없다. label은 제어 문자가 없는, 비어 있지 않은 올바른 Unicode text로 길이가 제한된다. 이 한계는 참조 adapter의 경계이지 source-language 정책이 아니다.
각 투영 record는 activation의 `sourceDocumentSha256`과 `bytecodeSha256`을 보존한다. 저장하거나 독립적으로 join한 관측도 정확한 compilation revision을 유지한다.
