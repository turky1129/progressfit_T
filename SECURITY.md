# ProgressFit 移行版（2026-10-29）

## 現在の状態
本番Apps Scriptをバージョン4に更新し、アクセスを「自分のみ」に限定しました。OWNER_EMAILも設定済みです。
未ログインのブラウザがGoogleログイン画面に移ることを確認済み。所有者の初回Google権限承認待ちです。
変更前のスクリプトと非公開スプレッドシートのバックアップを作成しました。記録データへの書き込みは行っていません。

## 変更
- index.htmlはGoogleログイン版への入口。公開パスワードと接続トークンを含めません。
- apps-script/Index.htmlがアプリ本体。google.script.runで読み書きし、サーバーの成功・失敗応答を確認します。
- apps-script/Code.gsは設定済みの所有者とログインユーザー・実行ユーザーを照合。未設定・未ログイン・別ユーザーは拒否します。
- デプロイは「自分として実行」「自分のみアクセス」。旧トークン式GET/POST APIを廃止します。
- 日付・数値・列数を検証。日付変更は元の行へ一度に書き込み、変更先との衝突は拒否します。
- CSV全件置換は全行検証後、同じスプレッドシート内にバックアップシートを作ります。バックアップは自動削除しません。
- 上下左右のsafe-areaを余白に反映し、入力画面もスクロール可能にしました。
- Chart.js 4.6.1 / jsPDF 4.2.1へ更新し、CDNファイルにSRIを追加しました。

## 本番切り替え手順
1. 既存のコードとスプレッドシートをバックアップ。
2. Apps Scriptのコード.gsをapps-script/Code.gsに置き換え、HTMLファイルIndexを追加してapps-script/Index.htmlを保存。
3. 所有者のアカウントで、エディタから一度だけconfigureOwner_を実行。OWNER_EMAILスクリプトプロパティが設定されます。
4. 既存のアクティブなデプロイを新バージョンに更新し、「自分として実行」「自分のみ」に変更。既存デプロイを更新すればURLは維持できます。
5. 所有者で表示確認、未ログインのブラウザから拒否されることを確認。他の旧デプロイが公開されていないことも確認。
6. GitHubの入口ページを更新。旧パスワード・トークンが履歴に残っても、旧APIが無効であることが必要です。
7. iPhoneのSafariからGoogleログイン版を開き、表示・記録・CSV/PDF出力を確認。必要に応じてホーム画面の登録先を変更。

## 利用上の変更・未確認事項
- GitHub Pages画面は入口になり、データ画面はGoogle側で開きます。
- GoogleのHTML Serviceはiframe内で動くため、従来と同じPWA表示・アイコン・ステータスバー制御は保証できません。iPhone実機確認が必要です。
- 端末保存の目標値は配信元が変わるため再設定が必要です。スプレッドシート内の記録は移動しません。
- 初回Google権限承認後の記録表示・グラフ・PDF出力は未検証です。HTMLは転送後の全文一致を確認しています。
- 自動テストはGoogleサービスを模した環境での10件。所有者確認、異常値の拒否、CSVバックアップ、日付変更、旧API無効化、構文を確認しています。

実行: node --test tests/*.cjs

## 参照
- https://developers.google.com/apps-script/guides/html/reference/run
- https://developers.google.com/apps-script/manifest/web-app-api-executable
- https://developers.google.com/apps-script/guides/html/restrictions
- https://webkit.org/blog/7929/designing-websites-for-iphone-x/
- https://github.com/parallax/jsPDF/security
