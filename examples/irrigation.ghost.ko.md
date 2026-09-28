<!-- translation-source: examples/irrigation.ghost.md -->
[English original](irrigation.ghost.md)
> 읽기용 번역본입니다. 컴파일할 때는 링크된 원본 `.ghost.md`를 사용하세요.

# 관개 런타임 픽스처

이 정본 리터레이트 픽스처는 이식 가능한 코어의 호스트 테스트에 사용된다. 이는 가상
제어 픽스처이며 하드웨어나 배포 증거가 아니다.

```ghost
control irrigation {
  input start, stop, low_water: Bool;
  input moisture: Number;
  state watering: Bool = false;
  state low_fault: Bool = false;
  output pump, valve: Bool;

  low_fault' = low_water;
  watering' = if stop || low_water then false else start || watering;
  pump <- watering';
  valve <- watering';
}
```
