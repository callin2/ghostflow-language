<!-- translation-source: examples/solar-live-config.ghost.en.md -->
[英語の原文](solar-live-config.ghost.en.md)
> 閲覧用の翻訳です。コンパイルには、リンク先の原本 `.ghost.md` ファイルを使用してください。

# 共有された設定の観測による日の出スケジュールの許可

日の出は、宣言された位置とタイムゾーンに対して計算されるイベントです。その実行を許可する設定（`enabled`）は別物で、型付きの独立した `Result` 観測です。この仮想的な例では、同じ観測を 2 か所で読み取ります。通常の出力と、日の出スケジュールの `when` 条件です。

- 設定が故障している場合、新しい日の出イベントは受け入れられません。
- 設定が復旧すると、その時点がベースラインになります。すでに過ぎたイベントは開始されません。

出力は要求意図です。物理的な動作や設置を立証するものではありません。

```ghost
control SolarLiveConfig {
  config enabled: Bool = true { access = operator; }
  schedule dawn: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.978;
    at = sun`rise`;
    basis = pulse;
    when = case enabled { ok(v) => v; fault(_) => false; };
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output settings_ok, current_enabled, due: Bool;
  settings_ok <- case enabled { ok(_) => true; fault(_) => false; };
  current_enabled <- case enabled { ok(v) => v; fault(_) => false; };
  due <- dawn.due;
}
```

位置、タイムゾーン、イベントの定義はプログラム内で固定されています。ホストは、時計と太陽の事実に加えて、認証済みの設定の観測を供給します。Rust は、設定の `Result` とイベントの受け入れをまとめて確定します。各オカレンスは一度だけ消費され、拒否された評価では両方がロールバックされます。
