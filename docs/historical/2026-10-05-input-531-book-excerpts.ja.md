<!-- translation-source: docs/historical/2026-10-05-input-531-book-excerpts.md -->
[英語の原文](2026-10-05-input-531-book-excerpts.md)

# 明示的な入力品質リビジョン以前の E01 と E03 の元のコード

このページは、書籍リビジョン `0e5b790babee4157c42d82ddb01f8eecb0c3f6e6` に基づく、実行対象ではない歴史的な証拠です。以下のコードは、承認された #531 の移行以前の、英語版書籍の E01 と E03 のフェンスからそのままコピーしたものです。

これは元の正常系制御のオラクル（入力が正常なときに期待される振る舞い）を記録しています。取得時の故障（fault）に対するポリシーを定義するものではありません。現在の書籍には、これらの例の新しい明示的なリビジョンが含まれており、この記録がコンパイラのフォールバックとして使われることは決してありません。

## E01

```text
// E01
control FollowSwitch {
  input switch_on: Bool;
  output lamp: Bool;

  lamp <- switch_on;
}
```

## E03

```text
// E03
control LatchingPump {
  input start, stop: Bool;
  state running: Bool = false;
  output valve, pump: Bool;

  running' = !stop && (start || running);
  valve <- running';
  pump <- running';

  require pump => valve;
}
```
