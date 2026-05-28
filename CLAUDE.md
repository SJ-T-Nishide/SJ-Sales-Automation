# SJ Sales Automation — CLAUDE.md

Success Japan株式会社の業務自動化ツール集。民泊経営パッケージ事業の業務効率化が目的。

## 重要な制約（必ず読む）

### GASはローカル実行できない
- `.gs`ファイルはGoogle Apps Script Editor上でのみ実行可能
- **デプロイはclasp使用（手動コピペ不要）**: `.gs`変更後は `clasp push --force` → `clasp update-deployment <deploymentId> --description "vX.X"` を自分で実行する
- GASの「テスト」＝コードレビューのみ。実行確認はユーザーが手動で行う
- GASはJavaScript V8ランタイム（ES2020相当）。`require()`は使えない

### claspデプロイ手順
```bash
cd <プロジェクトdir>/gas && clasp push --force
clasp update-deployment <deploymentId> --description "vX.X 説明"
```
- 認証エラー時: ユーザーに `! clasp login` を実行してもらう（admin@successjapan.jp）
- `.clasp.json` がない場合: scriptIdを確認して作成してからpush

### 設定済みclaspプロジェクト
| ディレクトリ | scriptId |
|---|---|
| `higashare-ext/gas/` | `1NFCdcKx7PNiV7XuKmRp1R2hUETNHwxKN43OzSj_rmX8qHF-MEN-GW6uT` |
| `plaud_ai_app/` | `18X_Y8SMmRO5EeX6LKsN564XukP1VXeYcumgX5FBA-2gjh3IAB3FT2NHz` |
| `calendar_sync/` | `11tGiSSbKpbP2J2Ht3eLg1R54IJ8qhtA7BTQYoEaUpkvHylP4HCH_g_3T` |

### 機密ファイルは絶対に編集しない
- `reins_tool/config.ini` — REINS認証情報
- `**/.env` `**/.env.*` — APIキー類
- `.claude/settings.local.json` — Claude Code権限設定

### 本番稼働中のコードは慎重に
- `contract_generator/` — v2.6.2が本番稼働中。変更前に必ず何を変えるか確認する
- `chrome_extensions/` — 実際の業務で使用中の拡張機能

## 環境

- **OS**: Windows 11 + WSL2
- **パス**: Bashコマンドは `/mnt/c/...`、`.bat`ファイルはWindows側（WSL外）で実行
- **Python**: WSL2上で `python3` / `pip3`
- **Node.js**: Playwright用（`airdna_playwright/`のみ）
- **GAS**: ブラウザのGAS Editor経由（https://script.google.com）

## ディレクトリ構造と各ツールの状態

```
contract_generator/   # 本番稼働中。GAS。買取+民泊契約書自動生成
chrome_extensions/    # 本番稼働中。Manifest V3。不動産サイトデータ収集
  athome_chrome_ext/  # atHome
  reins_chrome_ext/   # REINS
  freins_chrome_ext/  # furens
airdna_gas/           # 本番稼働中。GAS。AirDNA市場データ取込
airdna_playwright/    # 本番稼働中。Node.js+Playwright。AirDNAスクレイパー
reins_tool/           # 本番稼働中。Python+AutoHotKey。REINS物件データ収集
plaud_ai_app/         # 本番稼働中。GAS。Plaud文字起こし→Claude API処理
ai_signal_system/     # 開発中 Phase 2。経営シグナル朝レポートシステム
scripts/              # Python。朝レポート手動生成スクリプト
docs/                 # 朝レポートシステム設計書群
```

## 技術スタック別ルール

### Google Apps Script (.gs)
- ファイル間で関数を自由に呼び出せる（同一GASプロジェクト内はグローバルスコープ）
- `SpreadsheetApp`, `DriveApp`, `GmailApp` 等のサービスは非同期不要（同期実行）
- 実行時間上限は6分。長い処理はトリガー分割で対応
- ログは `Logger.log()` または `console.log()`（GAS Editorで確認）
- `PropertiesService.getScriptProperties()` でAPIキー管理（コードに直書き禁止）

### Python
- 仮想環境（venv）は未設定。`pip3 install` はグローバル
- `reins_tool/reins_playwright.py` — Playwrightでブラウザ操作
- `scripts/morning_report_generator.py` — Claude API呼び出し（`anthropic`ライブラリ）
- 実行コマンド例: `python3 reins_tool/reins_to_tsv.py`

### Chrome拡張 (.js / manifest.json)
- Manifest V3準拠
- `content.js` — ページ操作
- `popup.js` — ポップアップUI
- 動作確認はChromeの「拡張機能を再読み込み」→対象ページでテスト（ユーザーが手動）

## よくあるミスと対処

| 状況 | 対処 |
|------|------|
| GASで `require()` を使った | 使えない。スクリプトに直接コピーするか`UrlFetchApp`で代替 |
| GASでasync/awaitを使った | 不要。GASは同期実行 |
| `.env`の値を直接コードに書いた | `PropertiesService`に変更 |
| WSLのパスでWindowsコマンドを実行しようとした | `.bat`はユーザーにWindows側で実行してもらう |
| `contract_generator`に破壊的変更を加えた | 変更前に確認を取ること |

## 現在進行中のプロジェクト

**AI経営シグナル朝レポートシステム（Phase 2）**
- 状態: 手動テスト準備中
- 目標: Plaud/tl;dv/Slackログ→Claude API→Slack朝レポート
- Phase 3移行条件: 手動テスト1週間継続 + 平均評価3.5以上
- 関連ファイル: `docs/`, `ai_signal_system/`, `scripts/`, `prompts/`

## 変更後の自己検証ルール（必ず守る）

Pythonファイルを変更したら、完了と報告する前に以下を実行すること：

```bash
python3 -m py_compile <変更したファイル>
```

エラーが出たら修正してから完了にする。GAS（.gs）はローカル実行不可なので、変更内容をコードレビューで確認してから完了とする。

## 同じミスを2回したらここに追記する
