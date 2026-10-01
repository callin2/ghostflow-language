<!-- translation-source: docs/CALENDAR-PROVIDERS.md -->
# 한국 공휴일과 현장 근무 달력

한국어 | [English](CALENDAR-PROVIDERS.md) · [Reference §3.8](reference/03-time-and-schedules.md#38-dst-자정과-work-calendar)

이 안내서는 `runtimes/node/calendar.mjs`의 오프라인 reference adapter와
공유 Rust core의 달력 판정을 설명한다. 검증 범위는 compiler 검사, native Rust
unit test, WASM 실행과 ghostsim이다. 같은 달력 tape를 native runner로 실행한
검증은 아니다. 장치 배포나 실제 작업자의 재실, 물리 운전을 증명하지 않는다.

## 결정과 근거

공휴일은 공적인 날짜 사실이고 현장 휴무일은 작업 정책이다. 공휴일에도 농장은
일할 수 있고 평일에도 정비로 쉴 수 있다. 따라서 `HolidayCalendar`의 `holiday`는
공휴일 목록의 membership만 읽는다. `WorkCalendar`의 `workday`/`offday`는
날짜별 작업 예외, 공휴일 작업 정책, 주간 패턴 순으로 판정한다. 작업 예외가
공휴일에 `work`여도 공휴일 사실은 유지된다.

기본 자료를 직접 고치면 다른 일정과 과거 replay의 의미가 함께 바뀐다. 이 때문에
base와 override를 명시하여 새 calendar ID와 내용 기반 revision을 만든다.
base와 그 lineage의 ID를 재사용하지 않으며 원본 객체는 변경하지 않는다.
timezone은 base와 정확히 같아야 한다. 같은 overlay 층의 중복 날짜는 동일한
내용이어도 거부한다. 다음 층은 이전 층의 같은 날짜 결정을 명시적으로 덮는다.
공휴일 override와 작업 override는 서로 다른 층이므로 같은 날짜에 함께 있을 수 있다.

## 검토된 한국 기본 자료

`createKoreanHolidayCalendar`는 저장소의
[`kr-public-2026-2027.json`](../data/calendars/kr-public-2026-2027.json)을 읽는다.
`Asia/Seoul`, `[2026-01-01, 2028-01-01)`만 포함하며 2026-10-01에 검토한
유한 자료다. 기본 expiry는 2028-01-01 00:00 KST다. 호출자가 expiry를 줄일 수
있지만 늘릴 수는 없다. 이는 그날까지 법이 변하지 않는다는 보장이 아니다.
새 임시공휴일, 선거 또는 법 개정이 발표되면 운영자가 공식 자료를 다시 검토하고
새 dataset/revision 또는 출처가 있는 override를 설치한다. 자동 동기화는 없다.

자료의 주요 출처는 다음과 같다. 개별 날짜는 JSON의 source ID로 추적한다.

- [인사혁신처 공휴일 규칙](https://www.mpm.go.kr/mpm/info/infoService/BizService02/): 일요일과 공휴일, 제한된 대체공휴일 규칙.
- [인사혁신처 2026-04-29 개정 설명](https://www.mpm.go.kr/mpm/comm/newsPress/newsPressRelease/?boardId=bbs_0000000000000029&category=&cntId=4250&mode=view&pageIdx=1): 2026년부터 노동절 5월 1일과 제헌절 7월 17일을 반영한다.
- [한국천문연구원 2026년 월력요항 설명](https://www.kasi.re.kr/kor/post/newsMaterial/32031): 음력 명절과 기존 대체일. 개정 전 발표이므로 위 개정 자료와 함께 사용한다.
- [우주항공청 2027년 월력요항 설명](https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431): 2027년 명절과 대체일.
- [행정안전부 2026-06-03 지방선거 자료](https://www.mois.go.kr/video/bbs/type019/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000255&nttId=126698&searchCode1=): 임기 만료 지방선거일.

일요일도 공휴일 사실로 coverage 안에서만 확장한다. 토요일 자체는 공휴일이
아니다. 예를 들어 2026-09-28과 2027-06-07을 임의의 대체공휴일로 만들지 않는다.
2027년 5월 3일·7월 19일 등 공식 대체일은 고정 사실로 포함한다.
미래 연도의 음력일·대체일·임시공휴일을 추정하지 않는다.

정부 문서, PDF, HWPX, 이미지나 설명문을 복제하지 않고 날짜 사실과 인용 링크만
보관한다. 우주항공청 설명 보도자료는 공공누리 제1유형 출처표시를 안내한다.
별도 이용 조건이 있는 고시 첨부 파일은 배포하지 않는다.

## base와 현장 override를 만드는 절차

저장소 루트에서 실행하는 Node 예다. `weeklyWorkMask`의 bit 0은 일요일,
bit 6은 토요일이므로 `0b0111110`은 월–금이다. 기본 근무 패턴이나 공휴일 작업
정책을 adapter가 대신 결정하지 않는다.

```js
import {
  createKoreanHolidayCalendar, createWorkCalendar, composeCalendar,
} from './runtimes/node/calendar.mjs';

const nowMs = Date.parse('2026-10-01T00:00:00Z');
const publicBase = createKoreanHolidayCalendar({ calendarId: 'kr-public', nowMs });
const farmBase = createWorkCalendar({
  calendarId: 'farm-weekdays', base: publicBase,
  weeklyWorkMask: 0b0111110, holidayPolicy: 'off', nowMs,
});
const farm = composeCalendar(farmBase, {
  calendarId: 'farm-harvest', timezone: 'Asia/Seoul', nowMs,
  holidayOverrides: [],
  workdayOverrides: [
    { date: '2026-10-09', class: 'work', reason: 'Approved harvest shift' },
    { date: '2026-10-12', class: 'off', reason: 'Scheduled maintenance' },
  ],
});
console.log(publicBase.snapshot.calendarId, farm.snapshot.calendarId);
console.log(farm.provenance.lineage, farm.snapshot.revision);
```

공휴일 추가·제거는 `holidayOverrides`에 `{ date, holiday, reason, source }`를
명시한다. `source`는 credentials가 없는 HTTPS 근거 URL이다. 예를 들어 정부의
새 임시공휴일 발표를 반영할 때 `holiday: true`를 쓴다. 설치자가 아직 발표되지
않은 날짜를 공적인 사실로 만들지 않는다. 작업 예외에는 별도의 이유가 필수다.
다른 나라나 기간은 `createHolidayCalendar`에 timezone, coverage, expiry,
날짜별 이름/source ID, source URL·발표일·검토일과 datasetVersion을 모두 명시한다.

반환값 `{ snapshot, provenance }`와 하위 객체는 freeze된다. revision은 snapshot
내용, 출처와 lineage의 SHA-256이며 입력 순서가 아닌 정규화된 내용을 사용한다.
coverage, expiry와 출처가 결과에 유지되고 compose로 coverage를 넓히거나 만료된
자료를 새 자료처럼 갱신할 수 없다. `CalendarUnavailableError`의 `missing-base`와
`stale-base`는 따로 처리한다. 잘못된 날짜, timezone, 충돌, 출처와 revision은 거부한다.

## 설치 binding과 실행

소스에는 typed logical calendar를 선언하고 Daily 일정의 `on`과 `calendar`로
선택한다. 모든 공통 policy와 DST 선택은 명시한다.
[정본 실행 예제](../examples/korean-calendar.ghost.md)와
[host tape 작성 도구](../tools/examples/korean-calendar.mjs)를 함께 사용한다.
아래 명령은 virtual host 예제를 실행하고 물리 I/O는 수행하지 않는다.

```sh
rustup target add wasm32-unknown-unknown
cargo build --locked -p ghostflow-wasm --target wasm32-unknown-unknown --release
node tools/examples/korean-calendar.mjs
```

새 checkout에는 Rust/Cargo, Node.js와 WASM target이 필요하다. build 중 Cargo가
잠긴 dependency를 내려받을 수 있으며 cache가 있을 때만 `--offline`을 추가한다.

```ghost
calendar public_days: HolidayCalendar;
calendar farm_days: WorkCalendar;

// Daily schedule fields; complete common policies are still required.
on = day`holiday`;
calendar = public_days;
```

1. 공개 base를 만들고 명시적 farm policy를 적용한 다음 필요한 override를 compose한다.
2. 설치 profile의 provider binding을 각 snapshot의 calendar ID와 timezone에 맞춘다.
3. host는 같은 tick의 immutable clock, coverage, resolved civil occurrence row와
   `envelope.snapshot`을 context facts로 공급한다. provenance는 설치/replay 자료로 보관한다.
4. Rust가 날짜 필터와 admission, gap/recovery, dedup을 실행한다. Node adapter는
   실행일 또는 due를 판정하는 두 번째 엔진이 아니다.

Holiday Daily pulse는 `holiday-daily-pulse`, GFB15와 `GhostFlow/control-v14`로
식별한다. 기존 work/off day의 tag/byte layout과 GFSF5 facts wire는 유지한다.
이전 loader는 새 GFB header를 거부한다. package version이나 Device firmware
version과 같은 번호가 아니다. weekday literal의 구현 범위는 이 adapter 추가로
확장되지 않는다. #155의 요일 문법은 별도 작업이다.

채택된 `calendar_is` Result와 불변 UTC Daily work/off-day Range 실행 범위는
GFB18/`GhostFlow/control-v18`을 사용한다. activation에는 명시적인 UTC calendar
binding이 필요하다. 위의 한국 `Asia/Seoul` 예시는 Daily pulse 예시로 유지한다.
각 query 또는 range site의 GFSF5 schedule fact로 식별된 snapshot을 공급한다.
Rust가 date를 계산하고 typed calendar fault를 반환한다. 호출자가 계산한 work/off-day
Bool을 공급하지 않는다. scan 안에서 binding을 공유하면 동일한 snapshot을 사용하며
같은 유한 revision history를 유지한다.

work Range의 끝은 자정 이하이어야 한다. `23:45`부터 `00:15`까지라면 `23:45`와
`00:00`에 각각 시작하는 별도의 `range(15min)` Daily 선언을 작성한다. 뒤의 선언은
다음 date를 독립적으로 판정하며 shift의 business date를 추측하지 않는다.
`calendar_is`의 성공 Bool을 부정하기 전에 fault를 명시적으로 처리한다. missing,
coverage 밖, expiry는 workday나 offday admission을 허용하지 않는다. 이는 논리적인
reference host 의미이며 실제 재실, 물리 output, 저장 매체 durability의 증거가 아니다.

## 일관성, 부재와 저장 한계

같은 provider binding을 쓰는 일정들은 한 tick에서 같은 calendar snapshot을
공유한다. 일부만 부재하거나 revision/내용이 다르면 tick 전체를 거부하고 상태를
부분 확정하지 않는다. 같은 calendar ID/revision을 다른 내용으로 재사용해도 거부한다.
새 revision은 가능하지만 이전 revision의 내용 기록은 새 revision 뒤에도 유지한다.
core는 SHA 문자열을 신뢰하는 대신 snapshot 전체를 비교한다.

그 기록은 GFCXv3 checkpoint에 포함된다. v2는 새 core에서 거부하므로 과거
checkpoint를 암묵 변환하지 않는다. accepted calendar 기록은 최대
`min(terminalCapacity, 128)`개, holiday와 exception 날짜 cell 합계는 최대 8192다.
한계를 넘는 새 기록이나 restore는 fail closed한다. 구조체·할당·transaction clone을
제외한 저장 payload 상한은 약 144 KiB다. host는 이 유한한 보관 범위에 맞게
activation과 durable checkpoint 수명을 관리한다.

snapshot 부재는 `CalendarMissing`, coverage 밖이나 expiry 경계부터는
`CalendarOutOfRange`다. `holiday`, `workday`, `offday` 모두 이 경우 Unknown을
보존하고 `fallback = skip`으로 새 admission을 만들지 않는다. Unknown을 비공휴일,
근무일 또는 휴무일 false로 단정하지 않는다. 재공급은 baseline recovery를 따르고
과거 occurrence를 자동 재실행하지 않는다.
