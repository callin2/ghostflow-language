<!-- translation-source: docs/DOCUMENTATION-LANGUAGES.md -->
# 문서 언어

[개발 작업 흐름](DEVELOPMENT-WORKFLOW.ko.md)은 탐색과 검증을 통합합니다. `npm run docs:find -- --limit 8 QUERY`는 쓰기 없이 최신 상태를 검사하고 저장소 Markdown/HTML 경로와 제목을 검색합니다. 편집 묶음이 끝날 때마다 `npm run docs:index`는 `docs/INDEX.md`, 이어서 루트 `INDEX.md`를 재생성합니다. `npm run docs:check`는 번역 검증, 고정된 색인 도구 출처와 두 색인의 최신 상태 검사를 결합하여 무거운 빌드 전에 실행합니다.

이 정책은 보고서를 제외한 모든 문서에 영어와 한국어 버전이 있어야 한다는
2026-09-28 사용자 요청을 기록한다. 추적: [#344](https://github.com/callin2/ghostflow-language/issues/344).

[영어 원문](DOCUMENTATION-LANGUAGES.md)

작성된 문서는 영어와 한국어로 제공해야 합니다. 보고서와 과거 실행·측정
증거는 원래 언어로 유지할 수 있습니다. Git 추적 파일과 무시되지 않은 미추적
Markdown 파일을 모두 `docs/translations.json`에 분류합니다. 제외 항목에는
정확한 경로와 구체적인 이유가 필요합니다. 디렉터리 전체를 제외하지 않습니다.
생성 메타데이터, 테스트 픽스처, 정본 소스 문서도 명시적으로 분류합니다.
Markdown이 아닌 소스, 생성 메타데이터, 테스트는 이 Markdown 검사 대상 밖입니다.

원래 경로를 유지합니다. 영어 `NAME.md`에는 `NAME.ko.md`를, 한국어
`NAME.md`에는 `NAME.en.md`를 사용합니다. 리터러트 `NAME.ghost.md`에는
`NAME.ghost.ko.md` 또는 `NAME.ghost.en.md`를 사용합니다. 번역본은 문서
투영이며 두 번째 컴파일 가능한 정본 소스가 아닙니다. 원래 정본 소스, 줄 참조,
과거 해시를 보존합니다. 실행 코드 블록은 동일하게 유지합니다. `text`, `mermaid`,
`plantuml` 블록의 설명 문구, 레이블, 주석은 번역합니다. 코드 문장, 식별자, 수식,
축어 인용된 라이선스 문구는 정확히 보존합니다.
제목 수준의 순서와 명시적인 HTML 앵커 ID를 보존합니다. 제목 문구는 번역할 수
있습니다. 자동 생성되는 제목 슬러그는 비교하지 않습니다.

각 번역에는 `<!-- translation-source: SOURCE_PATH -->`와 원문으로 향하는
일반 Markdown 링크를 넣습니다. 링크는 상대 경로나 저장소 루트 경로를 사용합니다.
번역 예제에서 정본 소스를 언급할 때는 링크된 원본을 명시적으로 가리킵니다.
매니페스트 형식은 `GhostFlow/document-translations-v1`입니다. 문서 항목에는
`source`, `sourceLanguage` (`en` 또는 `ko`), `translation`, `sourceSha256`,
`translationSha256`를 기록합니다. 제외 항목에는 `path`와 `reason`을 기록합니다.

두 언어와 매니페스트 해시를 같은 변경에서 갱신합니다.
`npm run docs:check`와 `node --test tests/doc-translations.test.mjs`를 실행합니다.
소스 비교는 대상 작업 트리에서 `git rev-parse`와 `git show`로 확인합니다.
이름 붙인 임시 체크아웃은 해당 브랜치의 내용을 증명하지 않습니다.
검증기는 호스트 빌드 전에 이 검사를 실행합니다. 해시를 자동으로 다시 찍는
옵션은 없습니다. 검사는 문서 분류, 경로, 링크, 최신 상태, 제목 수준,
명시적인 앵커, 코드 보존을 확인합니다.
해시는 번역의 의미를 증명하지 않습니다. 검토자는 두 언어가 같은 의도와 제약을
전달하는지 확인해야 합니다.
