# GhostFlow literate source

상태: CommonMark 0.31.2 기반 추출과 control 컴파일·원본 위치 매핑을 구현했다.
[실행 튜토리얼](TUTORIAL.md)과 [검증 기록](VERIFICATION.md)을 참조한다.
선택한 [control 문법](LANGUAGE-SURFACE.md)을 Markdown 문서 안에 작성하는 방식이다.
Literate는 소스 포장 형식이며 제어 언어의 실행 모델을 바꾸지 않는다.

## 파일과 추출 규칙

- `.ghost.md`: Markdown 안의 실행 코드 블록을 추출하는 유일한 GhostFlow 제품 소스.
- `.ghost`: 보존할 경우 비실행 역사 증거일 뿐이며 컴파일러 입력이나 fallback이 아니다.
- 일반 `.md`는 확장자만으로 GhostFlow 실행 대상으로 취급하지 않는다.

문서의 최상위 fenced code block 중 정보 문자열이 정확히 `ghost`인 블록만
문서 순서대로 추출한다. fence 표기는 Markdown의 backtick 또는 tilde를 따르고,
fence 안의 원래 코드 들여쓰기는 유지한다. 각 본문의 마지막 줄을 개행으로 끝내고,
블록 사이에 추가 개행 하나를 두어 빈 줄로 구분한다.
제목이나 본문을 주석 문자열로 코드 안에 삽입하지 않는다.

설명, 표, 링크, 이미지, front matter, 일반 indented code block, 다른 언어의
코드 블록은 실행 소스에 포함하지 않는다. 목록·인용문 안의 중첩 블록도 제외한다.
더 긴 fence 안에 예시로 적은 `ghost` fence는 바깥 블록의 텍스트이므로 제외한다.
블록 인식은 Markdown 구조를 따라야 하며 단순 정규식으로 중첩 fence를 찾지 않는다.

잘못 닫힌 실행 fence, 알 수 없는 `ghost-...` 태그, `ghost` 뒤의 추가 속성,
실행 코드가 없는 literate 문서는 진단한다. 인용/목록 안의 `ghost` 블록은 실행하지
않는다는 진단도 제공한다. 코드로 인식한 것과 제외한 것은 미리보기에서 구분한다.

## 블록은 한 프로그램의 조각

하나의 `control` 범위가 여러 코드 블록에 걸쳐 있을 수 있다.
중괄호를 자동으로 추가하거나 닫지 않으며, 모든 조각을 합친 소스가 일반 문법으로
유효해야 한다. 블록 경계는 선언·문장의 끝이나 중괄호 경계에 둔다.
토큰, 문자열, 주석, 표현식 하나를 설명 문단 사이에 쪼개지 않는다.

````markdown
# 관수 제어

프로그램의 이름과 출력이다.

```ghost
control Irrigation {
  input start, stop: Bool;
  output pump, valve: Bool;
  state watering: Bool = false;
```

정지가 시작보다 우선하며, 시작 후에는 이전 상태로 자기유지한다.

```ghost
  watering' = !stop && (start || watering);
```

두 출력에 같은 관수 의도를 연결한다.

```ghost
  valve <- watering';
  pump  <- watering';
  require pump => valve;
}
```
````

문서의 배치는 소스 조각을 합치는 순서만 정한다. 블록마다 독립 실행·재실행하거나
상태를 따로 확정하지 않는다. 모든 상태의 다음 값과 출력은 원래 tick 계약을 따른다.
문서에 붙인 관찰 결과는 프로그램 입력으로 자동 되먹임되지 않는다.

### 문서형 예제의 추출 결과

앞의 `Irrigation` 문서형 예제에서 컴파일러가 추출하는 코드의 예는 다음과 같다.
이는 `ghost` 블록들을 문서 순서대로 이은 내부 추출 결과이며 독립 파일이나 별도
입력 형식이 아니다. 파일의 설명·표·링크는 포함하지 않으며, 아래 `text` fence는
표시용이다.

```text
control Irrigation {
  input start, stop: Bool;
  output pump, valve: Bool;
  state watering: Bool = false;

  watering' = !stop && (start || watering);

  valve <- watering';
  pump  <- watering';
  require pump => valve;
}
```

### 실행 fence와 제외 fence의 작은 구분 예

다음은 `.ghost.md` 파일의 내용을 보여 주는 **표시용 outer fence**다. outer fence
자체는 이 문서의 실행 코드가 아니며, 안쪽의 최상위 `ghost`만 실행 대상 후보다.
`text`와 인용 안의 `ghost`는 제외한다. 알 수 없는 `ghost-python`도 실행하지 않는다.

````markdown
```ghost
control Demo {
  output pump: Bool;
  pump <- false;
}
```

```text
control NotExecutable { }
```

> ```ghost
> control Quoted { }
> ```
````

위 예에서 첫 번째 `ghost` 블록만 추출 대상이다. 이 LITERATE 문서 안에서는 안쪽
fence가 모두 outer fence의 텍스트이며, 예시를 붙여 넣었다고 추출기가 구현된 것은 아니다.

문서 설명만 바꾼 두 문서는 같은 코드를 얻는다. `ghost` 안의 주석만 바꿔도 주석을
제외한 프로그램은 같으므로 실행 그래프와 실행 바이트코드는 같아야 한다.
예를 들어 같은 `control Demo` fence의 주석을 `// 설명 A`에서 `// 설명 B`로
바꾸거나 fence 밖의 설명 문단만 바꿔도, 실행 문장은 같고 원본 내용·소스맵만 달라진다.
이는 literate를 별도 실행기로 돌리지 않고 추출한 코드의 동등성으로 검증하는 기준이다.

이 규칙은 0.2 비교안의 "각 fence는 완결된 최상위 선언" 제한을 대체한다.
control 내부의 설명을 자연스럽게 배치하면서 일반 언어의 구조를 유지하기 위한
선택이다.

## 컴파일과 런타임의 관계

```text
.ghost.md → 코드 추출 → 같은 파서 → 같은 타입·시간·자원 검사 → .gfb
```

추출된 코드가 같으면 타입 그래프와 실행 의미가 같아야 한다. 디버그 정보를 제외한
실행 바이트코드도 같은 컴파일러·옵션에서 같아야 한다. 문서 위치를 담는 소스맵과
문서 패키지의 내용·해시는 달라질 수 있다.

MCU는 기존과 같이 실행 바이트코드만 받는다. 설명문, Markdown 파서, 코드 추출기는
MCU에 필요하지 않다. Literate 자체로 tick 비용이나 상태 메모리가 늘어나지 않는다.
추가 작업은 호스트의 Markdown 추출, 원본 위치 매핑, 편집기 통합에 있다.

문서만 수정하면 실행 그래프와 논리 hash는 유지하고 문서/소스맵만 갱신할 수 있어야
한다. 문서 패키지의 서명이나 배포 정책은 별도다. 문서 저장이나 코드 블록 편집이
실장치 배포를 자동 승인하지 않으며 기존 검증·활성화 절차를 따른다.

## 오류 위치와 관찰

추출기는 생성 소스의 파일·행·열을 원래 `.ghost.md`의 파일·행·열로 매핑한다.
문법 오류와 타입 오류는 원래 Markdown 위치를 가리켜야 한다. 블록 경계를 넘는
control의 닫는 중괄호가 누락되면 시작 위치와 문서 끝을 함께 진단한다.

예를 들어 아래는 별도 `.ghost.md` 파일 전체를 보여 주는 표시용 outer fence다.
번호는 fence 안에 넣지 않고, 아래 설명에서 원본 파일 기준으로 센다.

````markdown
```ghost
control Demo {
  output pump: Bool;
  require pump => ;
}
```
````

이 샘플에서 실행 fence는 1행부터 시작하고 `require pump => ;`는 원본 4행이다.
세미콜론은 4행 19열이므로, 잘못된 식 진단은 그 원본 행·열을 가리켜야 한다.
합쳐진 임시 소스의 행 번호를 보고하지 않는다.

닫는 중괄호 누락은 다음처럼 두 블록을 이어 붙인 경우다. 첫 블록의 4행 fence는
정상 종료지만, 합친 소스에는 `control`의 `}`가 없다.

````markdown
```ghost
control Demo {
  output pump: Bool;
```

설명을 이어 쓴다.

```ghost
  pump <- false;
```
````

이 경우 `control Demo`의 시작 원본 위치인 2행 1열과 문서 끝(10행 뒤)을 함께
진단한다. 두 예시는 설계상 소스맵 기준이며 현재 파서·추출기가 제공하는 진단은 아니다.

실행 노드 ID는 설명 문단의 행 번호로 만들지 않는다. 설명을 추가해 코드가 아래로
이동해도 동일한 계산·상태를 타임라인에서 계속 식별할 수 있어야 한다.
원본 문서와 소스맵은 코드 revision에 맞춰 보존한다.

편집기는 코드 옆에 현재 값·오류·타임라인을 표시할 수 있다. 이것은 관찰 기능이며
노트북 셀의 실행 스케줄러를 추가하는 것은 아니다. 실행 시점과 결정론은 control의
tick 모델이 정한다.

## 예제와 검증 기준

[설명이 있는 시간표 관수 문서](../examples/scheduled-watering.ghost.md)를 제공한다.
이 문서만 `ghostc` 입력으로 사용할 수 있다. Markdown은 호스트에서만 해석하며 MCU에 넣지 않는다.

문법과 추출기를 구현할 때 확인할 기준은 다음과 같다.

1. 설명만 다른 두 canonical 문서가 같은 추출 소스와 같은 상태·출력 trace를 만든다.
2. 설명만 바꿔도 실행 그래프와 실행 바이트코드는 유지된다.
3. plain `.ghost` 입력, 중첩 fence, 목록·인용 속 예시는 실행되지 않는다.
4. 잘못된 fence와 분리된 토큰/표현식은 원래 문서 위치로 진단한다.
5. 여러 블록에 걸친 control도 한 tick 모델과 같은 상태 범위를 사용한다.

추출·위치 진단 테스트는 `tests/literate.test.mjs`, `tests/toolchain.test.mjs`에,
canonical literate 컴파일 및 실제 VM trace 동등성은 `tools/tutorial.mjs`에 있다.
