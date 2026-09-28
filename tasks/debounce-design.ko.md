<!-- translation-source: tasks/debounce-design.md -->

[영문 원본](debounce-design.md)

# Debounce 수직 통합 계약

- `signal x = debounce(source, stable_for: duration, initial: value);`는 Bool 또는 이름 있는 유한 enum을 받는다. `stable_for`는 양의 상수 `Duration`이며, `initial`은 payload 타입이다.
- Debounce manifest descriptor는 `{kind:"debounce",name,payloadType,errorType,sourceMode,stableForMs,initial,clockInput,sources,states}`다. `errorType`은 원시값에서는 `null`, `Result`에서는 컴파일러가 소유한 fault enum이다. 선택 가능한 물리 sensor root가 하나라도 있으면 `sourceMode`는 `sample`, 아니면 `scan`이다. `sources`는 중복 없는 물리 root 목록이며 숫자 `tag` 오름차순으로 정렬한다(동률이면 소스 이름으로 결정적으로 순서를 정한다). Enum descriptor에는 순서가 있는 `members` 배열도 있다. Bool descriptor에는 없다.
- `states`에는 정확히 `stable`, `candidate`, `candidateActive`, `candidateSince`, `lastSourceTag`가 있다. 생성 이름은 `__gf_debounce_<role>_<signal>`이며 camel case 역할 이름은 snake case로 변환한다. Stable과 candidate는 payload 기계 타입, candidateActive는 Bool, 나머지 상태는 Number다.
- 각 물리 소스 항목은 `{name,tag,states:{lastEpoch,lastId}}`다. 상태 이름은 `__gf_debounce_source_epoch_<signal>_<tag>`와 `__gf_debounce_source_id_<signal>_<tag>`이며 각각 `0`과 `-1`로 초기화한다. 원시 debounce에는 private state가 5개 있다. 물리 debounce에는 5개와 정적으로 도달 가능한 root마다 2개가 더 있다.
- 물리 sensor descriptor는 debounce 식이 해당 root를 관측할 수 있을 때만 생성 입력 묶음 `samplePresentInput`, `sampleEpochInput`, `sampleIdInput`, `sampleTimestampInput`을 전부 또는 전혀 할당하지 않는다. Present는 호출자가 sample을 공급했고 conditioner가 식별자를 수용했다는 뜻이다. Epoch, ID, 타임스탬프, payload는 그 권위 있는 수용된 conditioner sample에서 가져온다. Conditioner가 무시한 중복 또는 이전 tuple에서 가져오지 않는다. 컴파일러는 양의 sensor source node ID를 `sourceTag`로 공급한다.
- Lowering된 임시 `Result`는 fault provenance와 별도로 sample 계보 `{sourceTag,present,epoch,id,timestamp}`를 담는다. `map`과 `and_then`은 상류 계보를 보존한다. `if`와 `case`는 모든 계보 필드를 선택한다. 물리 계보가 없는 생성자는 scan 관측이다(`sourceTag=0`, present, timestamp=`__gf_now_ms`).
- Source tag 0은 commit된 scan마다 하나의 논리 관측을 뜻한다. 양의 tag에서 sample은 present이고 epoch가 해당 root의 상한 epoch와 다르거나, 같은 epoch에서 ID가 더 크면 새 sample이다. 정적으로 도달 가능한 모든 root는 선택되지 않았거나 fault 상태여도 commit된 scan마다 자체 상한 상태를 갱신한다. 중복, 더 낮은 ID, 누락된 물리 sample은 연속성을 전진시키지 않는다.
- 선택된 root가 바뀌면 sample 존재 여부와 관계없이 stable과 candidate 연속성을 초기화한다. 선택된 새 sample의 epoch가 바뀌어도 연속성을 초기화한다. Root별 상한 이력은 root 전환과 fault 이후에도 유지되므로 이전 root로 돌아가도 옛 식별자를 replay할 수 없다.
- Fault는 정확한 Result 사유와 출처를 유지하면서 stable과 candidate 상태를 작성된 initial 값으로 초기화한다. 새 fault 식별자도 해당 root의 상한 상태에 소비된다. 성공한 debounce는 상류 sample 계보를 전달하므로 하류 debounce node는 stable payload가 바뀌지 않은 경우까지 모든 상류 물리 sample을 본다.
- Candidate 시간은 Result 계보에서는 물리 sample 타임스탬프, 원시값에서는 scan 논리 시간을 쓴다. `stable_for` 이상이 된 첫 새 관측에서 승격한다. 전이와 같은 tick의 payload는 같은 순수 다음 상태 식을 공유한다.
- Source trace는 `signalMode:"debounce"`인 파싱된 source node에 공통 private state 5개와 모든 물리 root의 쌍인 `sourceEpoch`, `sourceId` binding을 기록한다.
- Tick은 conditioning 전에 모든 sensor와 signal conditioner에서 Rust 소유 트랜잭션 하나를 시작한다. 알려진 precommit 또는 VM 거부는 그 트랜잭션과 VM 소유 debounce/상한 상태를 함께 rollback한다. 따라서 재시도는 마지막으로 완전히 commit된 sample 식별자와 payload에서 시작한다.
- Native commit 상태와 postcommit 오류 처리는 [sensor scan 트랜잭션](sensor-atomicity-design.md)을 참조한다. 이 메모리 내 트랜잭션은 영속적인 재부팅 checkpoint를 제공하지 않는다.
