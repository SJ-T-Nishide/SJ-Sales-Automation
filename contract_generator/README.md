# 契約書自動作成ツール

Success Japan株式会社 GASプロジェクト v2.6.2

## 構成ファイル

| ファイル | 役割 |
|---|---|
| code.gs | メイン処理・入力値取得・バリデーション |
| SpreadsheetSetup.gs | スプレッドシート初期セットアップ |
| documentgen.gs | Googleドキュメント生成・PDF変換 |
| Gmaildraft.gs | Gmail下書き作成 |
| slack_notify.gs | Slack通知（複数Webhook対応） |
| WebApp.gs | Webアプリ版フォーム（買取・民泊） |
| Installer.gs | 民泊契約書機能インストーラー v2.6.2 |
| CandidateSetup.gs | 候補リスト初期設定 |

## 重要事項

- **本体はGoogleスプレッドシートのApps Script**（クラウド上）
- このフォルダはバックアップ・バージョン管理用
- 変更後はGASエディタに手動で貼り付けが必要
- スプレッドシートID: 設定シートB2参照

## デプロイ方法

1. スプレッドシートを開く
2. 拡張機能 → Apps Script
3. 各.gsファイルの内容をコピー＆ペースト
4. デプロイを管理 → 既存デプロイを編集 → 新しいバージョン → 保存
