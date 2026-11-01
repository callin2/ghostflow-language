<!-- translation-source: examples/korean-calendar.ghost.en.md -->
[英語の原文](korean-calendar.ghost.en.md)
> 閲覧用の翻訳です。コンパイルには、リンク先の原本 `.ghost.md` ファイルを使用してください。

# 韓国の祝日と農場の稼働日

[韓国語](korean-calendar.ghost.md)

祝日と農場の稼働日は、それぞれ別の問いに答えるものです。2026 年 10 月 9 日はハングルの日で、祝日です。それでも農場は、収穫のためにその日に作業すると決めることができます。その決定によって祝日という事実は変わりません。その日は祝日のままです。

次のプログラムは、それぞれのカレンダーを明示的にバインドします。3 つのスケジュールが同じ 06:00 の暦上のオカレンスを、問いごとに 1 つずつ評価します。

| スケジュール | カレンダー | 日フィルタ | 出力 |
|---|---|---|---|
| `public_morning` | `public_days` | `holiday` | `public_holiday` |
| `farm_morning` | `farm_days` | `workday` | `farm_work` |
| `rest_morning` | `farm_days` | `offday` | `farm_rest` |

出力はシミュレータ内の仮想的な Bool 値です。どのデバイスも操作しません。

```ghost
control KoreanCalendar {
  calendar public_days: HolidayCalendar;
  calendar farm_days: WorkCalendar;
  schedule public_morning: Daily {
    timezone = "Asia/Seoul";
    at = time`06:00`;
    on = day`holiday`;
    calendar = public_days;
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  schedule farm_morning: Daily {
    timezone = "Asia/Seoul";
    at = time`06:00`;
    on = day`workday`;
    calendar = farm_days;
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  schedule rest_morning: Daily {
    timezone = "Asia/Seoul";
    at = time`06:00`;
    on = day`offday`;
    calendar = farm_days;
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output public_holiday: Bool;
  output farm_work: Bool;
  output farm_rest: Bool;
  public_holiday <- public_morning.due;
  farm_work <- farm_morning.due;
  farm_rest <- rest_morning.due;
}
```

新しくチェックアウトした環境には Rust/Cargo と Node.js が必要です。リポジトリのルートで WASM ターゲットをインストールしてランタイムをビルドし、その後に例を実行します。Cargo に `--offline` を付けるのは、依存関係がすでにキャッシュされている場合だけにしてください。

```sh
rustup target add wasm32-unknown-unknown
cargo build --locked -p ghostflow-wasm --target wasm32-unknown-unknown --release
node tools/examples/korean-calendar.mjs
```

この例では、まず固定された 2026～2027 年のデータから韓国の祝日カレンダーを構築します。次に、月曜日から金曜日は作業し、祝日は休むという農場カレンダーを明示的に導出します。さらに、新しい ID とリビジョンのもとで 2 つの例外を合成します。10 月 9 日は稼働日になり、10 月 12 日は休日になります。元の 2 つのカレンダーはどちらも変更されません。

06:00 の結果を `public_holiday, farm_work, farm_rest` の順に示します。

| 日 | 結果 |
|---|---|
| 10 月 9 日（祝日、農場は作業） | `true, true, false` |
| 10 月 12 日（農場の休日） | `false, false, true` |
| 同じオカレンスを再度供給 | すべて `false` |

ホストが供給するのは、固定された韓国のタイムゾーンにおける明示的な暦上の日付と時刻の事実だけです。Rust コアが祝日を分類し、`due` を評価し、重複を防ぎます。カレンダーが欠けているか期限切れの場合、スケジュールは `fallback = skip` に従ってスキップします。将来の臨時祝日が自動的に推測されることは決してありません。新しい公式の証拠を確認し、新しいカレンダーを合成してください。この例では、曜日のリテラル構文は追加しません。
