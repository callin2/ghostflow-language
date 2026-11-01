<!-- translation-source: examples/vfd-speed.ghost.md -->
[英語の原文](vfd-speed.ghost.md)
> 閲覧用の翻訳です。コンパイルには、リンク先の原本 `.ghost.md` ファイルを使用してください。

start と stop は、押されている間 true です。ポテンショメータ入力の有効範囲は 0〜10 V です。速度指令は運転信号から独立しています。

```ghost
control VfdSpeed {
  input start, stop: Bool;
  input potentiometer_v: Number;

  output run: Bool;
  output speed_v, speed_hz: Number;

  state running: Bool = false;

  // Start latches ON. Stop takes priority.
  running' = !stop && (start || running);
  run <- running';

  // Speed reference remains independent of Run.
  speed_v <- potentiometer_v;
  speed_hz <- potentiometer_v * 5;
}
```
