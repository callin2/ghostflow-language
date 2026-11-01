<!-- translation-source: examples/solar-watering.ghost.en.md -->
[英語の原文](solar-watering.ghost.en.md)
> 閲覧用の翻訳です。コンパイルには、リンク先の原本 `.ghost.md` ファイルを使用してください。

# 日の出と日の入りに合わせた灌水

この例では、ソウルの**テスト用座標**を使い、毎日の日の出と日の入りに合わせて灌水します。実際の設置では、検証済みの農場の座標とタイムゾーンを記述してください。

この例は 8DI/8RO 構成（8 つのデジタル入力、8 つのリレー出力）を使用し、リレーに次のように名前を付けます。

| リレー | 役割 | 要求されるタイミング |
|---|---|---|
| RO1 | ポンプ | いずれかのペアが動作しているとき |
| RO2, RO3 | バルブのペア | 日の出の 30 分後から 5 分間、同時に |
| RO4, RO5 | バルブのペア | 日の入りの 30 分前から 5 分間、同時に |
| RO6–RO8 | 未使用 | 常にオフ |

この例では、各ペアの 2 つのバルブを同時に動作させます。ユーザーが同時動作と順次動作のどちらを望んでいるか不明な場合は、作成前にそれを明確にしてください。

```ghost
control SolarWateringFixture {
  let duration = 5min;

  schedule dawn: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.9780;
    at = sun`rise + 30min`;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }

  schedule dusk: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.9780;
    at = sun`set - 30min`;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }

  input DI1, DI2, DI3, DI4, DI5, DI6, DI7, DI8: Bool;
  output RO1, RO2, RO3, RO4, RO5, RO6, RO7, RO8: Bool;

  state dawn_active: Bool = false;
  state dusk_active: Bool = false;
  timer dawn_elapsed = elapsed(dawn_active);
  timer dusk_elapsed = elapsed(dusk_active);

  dawn_active' = if dawn_active then dawn_elapsed < duration else dawn.due;
  dusk_active' = if dusk_active then dusk_elapsed < duration else dusk.due;

  RO1 <- dawn_active' || dusk_active';
  RO2 <- dawn_active';
  RO3 <- dawn_active';
  RO4 <- dusk_active';
  RO5 <- dusk_active';
  RO6 <- false;
  RO7 <- false;
  RO8 <- false;

  require RO1 => (RO2 || RO3 || RO4 || RO5);
}
```

`dawn_active` と `dusk_active` は、それぞれ独自の Bool 状態と経過時間タイマーを持ちます。信頼できない太陽イベントを `skip` で処理した結果、新たな開始信号が生成されない場合でも、すでに始まっている各運転の 5 分間の経過時間チェックは継続します。
