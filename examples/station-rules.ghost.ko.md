<!-- translation-source: examples/station-rules.ghost.md -->
[English original](station-rules.ghost.md)
> 읽기용 번역본입니다. 컴파일할 때는 링크된 원본 `.ghost.md`를 사용하세요.

# 공용 관측소 정책

이 정본 제약 문서는 공용 펌프 하나에 대한 호스트 소유 관측소 한도와 모드 인터록을
선언한다.

```ghost
constraints StationRules {
  exclusive(automatic, manual, configuring);

  allow enter(Auto, Manual, Configure)
    only when mode == Stopped && stopped(station);
  allow apply(settings)
    only when mode == Configure && stopped(station);

  require count_on(pump1.valves) <= 2;
  require pump1.on => any_on(pump1.valves);
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
  once starts per occurrence;
  check pump_capacity(pump1);
}
```
