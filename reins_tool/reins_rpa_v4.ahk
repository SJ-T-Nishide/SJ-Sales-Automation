#Requires AutoHotkey v2.0
#SingleInstance Force

; ══════════════════════════════════════════════════════════════════════
;  reins_rpa_v4.ahk  ― ポータブル版
;  出力・ログフォルダを config.ini から読み込む
;  スクリプト本体・config.ini・run_convert.bat は同じフォルダに置く
; ══════════════════════════════════════════════════════════════════════

; ── 出力フォルダ（スクリプトの隣に固定。日本語パス問題を回避）────────
; config.ini の output_folder / log_folder は Python 側のみ参照。
; AHK は常に A_ScriptDir 相対のサブフォルダを使用する。
outputFolder := A_ScriptDir . "\output"
logFolder    := A_ScriptDir . "\log"

; フォルダが存在しない場合は作成
if !DirExist(outputFolder)
    DirCreate(outputFolder)
if !DirExist(logFolder)
    DirCreate(logFolder)

; ── 出力ファイルパス ─────────────────────────────────────────────────
OUTPUT   := outputFolder . "\reins_" . FormatTime(, "yyyyMMdd_HHmm") . ".txt"
LOG_FILE := logFolder    . "\reins_log_" . FormatTime(, "yyyyMMdd_HHmm") . ".txt"

; ── スクリプト相対パス（変更不要）───────────────────────────────────
CONVERT_BAT := A_ScriptDir . "\run_convert.bat"

; ── タイミング定数 ───────────────────────────────────────────────────
T_SHORT := 600
T_NAV   := 3000
T_SRCH  := 5000

; ── 条件一覧（config.ini からタブ名を上書き読み込み） ────────────────
CONDITIONS := [
    {num:"01", tab:"01 大阪_一戸建",      down:2 },
    {num:"02", tab:"02 大阪市_マンション",    down:3 },
    {num:"03", tab:"03 大阪市_外全",     down:4 },
    {num:"04", tab:"04 大阪市_外一",    down:5 },
    {num:"05", tab:"05 東京_外全",        down:6 },
    {num:"06", tab:"06 東京_外一",       down:7 },
    {num:"07", tab:"07 東京_一戸建",      down:8 },
    {num:"08", tab:"08 東京_マンション",   down:9 },
    {num:"09", tab:"09 福岡_マンション",  down:10},
    {num:"10", tab:"10 福岡_一戸建",  down:11},
    {num:"11", tab:"11 福岡_外全",      down:12},
    {num:"12", tab:"12 福岡_外一",      down:13},
    {num:"13", tab:"13 名古屋_外一",     down:14},
    {num:"14", tab:"14 名古屋_外全",      down:15},
    {num:"15", tab:"15 名古屋_マンション",   down:16},
    {num:"16", tab:"16 名古屋_一戸建",   down:17},
    {num:"17", tab:"17 札幌_一戸建",   down:18},
    {num:"18", tab:"18 札幌_マンション",   down:19},
    {num:"19", tab:"19 札幌_外全",      down:20},
    {num:"20", tab:"20 札幌_外一",      down:21},
]

; NOTE: タブ名は AHK 内にハードコード済み。
; config.ini [tabs] の日本語は Python 側のみが読む（IniRead は UTF-8 を誤読するため）。

; ── 自動実行（--auto 引数） ──────────────────────────────────────────
if (A_Args.Length >= 1 && A_Args[1] = "--auto") {
    SetTimer(AutoStart, -3000)
}
; ── テスト実行（--test 引数：条件01のみ） ────────────────────────────
if (A_Args.Length >= 1 && A_Args[1] = "--test") {
    SetTimer(TestStart, -3000)
}

AutoStart() {
    RunAll(true)
}

TestStart() {
    global CONDITIONS, OUTPUT, CONVERT_BAT
    WriteLog("=== TEST MODE: condition 01 only ===")
    ok := Fetch(CONDITIONS[1], false)
    if ok {
        if FileExist(CONVERT_BAT) {
            Run '"' . CONVERT_BAT . '" "' . OUTPUT . '"'
            WriteLog("Converter launched: " . CONVERT_BAT)
        }
        Sleep 5000
        MsgBox "Test OK!`n`nFile:`n" . OUTPUT, "Test Done", 0x40
    } else {
        MsgBox "Test FAILED. Check screen.", "Error", 0x10
    }
    Sleep 2000
    ExitApp
}

; ══════════════════════════════════════════════════════════════════════
;  メイン処理
; ══════════════════════════════════════════════════════════════════════

RunAll(autoMode := false) {
    global CONDITIONS, OUTPUT, CONVERT_BAT

    if (!autoMode) {
        ans := MsgBox("Run all 20 conditions (~20-30min)?", "Confirm", 0x24)
        if ans != "Yes"
            return
    } else {
        WriteLog("=== AUTO MODE: all 20 conditions ===")
    }

    ok_list := []
    ng_list := []
    for c in CONDITIONS {
        ok := Fetch(c, A_Index > 1)   ; 条件01はnavigate=false、2〜20はtrue
        if ok
            ok_list.Push(c.num . " " . c.tab)
        else
            ng_list.Push(c.num . " " . c.tab)
        if A_Index < CONDITIONS.Length {
            WriteLog("Waiting 20s...")
            Sleep 20000
        }
    }

    summary := "All 20 done`n`nOK: " . ok_list.Length . "`nNG: " . ng_list.Length
    if ng_list.Length > 0 {
        summary .= "`n`nFailed:`n"
        for v in ng_list
            summary .= "  " . v . "`n"
    }
    summary .= "`n`nFile:`n" . OUTPUT

    ; Python で TSV 変換
    if FileExist(CONVERT_BAT) {
        Run '"' . CONVERT_BAT . '" "' . OUTPUT . '"'
        WriteLog("Converter launched: " . CONVERT_BAT)
    } else {
        WriteLog("WARNING: run_convert.bat not found: " . CONVERT_BAT)
        MsgBox "run_convert.bat not found:`n" . CONVERT_BAT, "Warning", 0x30
    }

    if (!autoMode) {
        MsgBox summary, "Done", 0x40
    } else {
        WriteLog("Auto run complete. Exiting.")
        Sleep 2000
        ExitApp
    }
}

; ══════════════════════════════════════════════════════════════════════
;  ユーティリティ
; ══════════════════════════════════════════════════════════════════════

WriteLog(msg) {
    global LOG_FILE
    FileAppend FormatTime(,"HH:mm:ss") . " " . msg . "`n", LOG_FILE
    ToolTip "[Reins RPA] " . msg, , , 2
    Sleep 1000
    ToolTip , , , 2
}

GetURL() {
    Send "^l"
    Sleep 350
    Send "^a"
    Sleep 150
    Send "^c"
    Sleep 350
    url := A_Clipboard
    Send "{Escape}"
    Sleep 300
    Send "{Escape}"
    Sleep 400
    return url
}

FocusPage() {
    Send "^l"
    Sleep 500
    Send "{Escape}"
    Sleep 300
    Send "{Escape}"
    Sleep 600
}

; ══════════════════════════════════════════════════════════════════════
;  1条件分のフェッチ処理
; ══════════════════════════════════════════════════════════════════════

Fetch(c, navigate := false) {
    global T_SHORT, T_NAV, T_SRCH, OUTPUT

    WriteLog("Start: " . c.num . " " . c.tab)

    ; 条件2〜20のみ GBK001310 へ戻る（条件01は手動でそこにいる前提）
    if navigate {
        WriteLog("Moving to GBK001310")
        A_Clipboard := "https://system.reins.jp/main/BK/GBK001310"
        Sleep 200
        Send "^l"
        Sleep 500
        Send "^a"
        Sleep 150
        Send "^v"
        Sleep 300
        Send "{Enter}"
        Sleep T_NAV
    }
    WriteLog("OK: GBK001310")

    ; Tab→Enter でパネルを開く
    WriteLog("Tab+Enter (open panel)")
    Send "{Tab}"
    Sleep T_SHORT
    Send "{Enter}"
    Sleep T_NAV

    ; Tab→Enter でプルダウンを開く
    WriteLog("Tab+Enter (open dropdown)")
    Send "{Tab}"
    Sleep T_SHORT
    Send "{Enter}"
    Sleep T_NAV

    ; マウスを画面左上に退避（プルダウンに被らないように）
    MouseMove 0, 0, 0

    ; ↓キーで条件を選択してEnterで確定
    WriteLog("Down x" . c.down . " for condition " . c.num)
    Loop c.down {
        Send "{Down}"
        Sleep 180
    }
    Sleep 400
    Send "{Enter}"
    Sleep T_SHORT

    ; Tab→Enter で「読み込み」
    WriteLog("Tab+Enter (load condition)")
    Send "{Tab}"
    Sleep T_SHORT
    Send "{Enter}"
    Sleep T_NAV

    ; Tab→Enter で「OK」
    WriteLog("Tab+Enter (OK)")
    Send "{Tab}"
    Sleep T_SHORT
    Send "{Enter}"
    Sleep T_NAV

    ; Tab×128→Enter で「検索」ボタン
    WriteLog("Tab x128 + Enter (search)")
    Loop 128 {
        Send "{Tab}"
        Sleep 30
    }
    Sleep 300
    Send "{Enter}"
    Sleep T_SRCH

    url := GetURL()
    if !InStr(url, "GBK002200") {
        WriteLog("ERROR: Not on GBK002200, URL=" . SubStr(url,1,60))
        MsgBox "Error: Could not reach results page.`n`nURL: " . url . "`n`nCheck login status.", "Error", 0x10
        return false
    }
    WriteLog("OK: GBK002200")

    Sleep 800
    A_Clipboard := ""
    Send "^a"
    Sleep 700
    Send "^c"
    Sleep 1200

    content := A_Clipboard

    if !RegExMatch(content, "\d{12}") {
        WriteLog("ERROR: No property number found")
        MsgBox "Error: No property number in clipboard.", "Error", 0x10
        return false
    }

    if RegExMatch(content, "1~\d+件 / (\d+)件", &m)
        WriteLog("Count: " . m[1])

    FileAppend "### " . c.num . " " . c.tab . "`n" . content . "`n`n", OUTPUT, "UTF-8"
    WriteLog("Saved: " . c.num . " " . c.tab)
    return true
}

; ══════════════════════════════════════════════════════════════════════
;  ホットキー
;  Ctrl+1 : 条件01のみテスト実行
;  Ctrl+2 : 条件01〜05 実行
;  Ctrl+3 : 全20条件 実行
;  Ctrl+0 : 停止・終了
; ══════════════════════════════════════════════════════════════════════

^1:: {
    global CONDITIONS, OUTPUT
    WriteLog("=== Test: condition 01 ===")
    ok := Fetch(CONDITIONS[1], false)   ; 手動実行：navigate不要
    if ok
        MsgBox "Done! File:`n" . OUTPUT, "OK", 0x40
    else
        MsgBox "Error. Check screen.", "Error", 0x10
}

^2:: {
    global CONDITIONS, OUTPUT
    ans := MsgBox("Run conditions 01-05?", "Confirm", 0x24)
    if ans != "Yes"
        return
    loop 5 {
        ok := Fetch(CONDITIONS[A_Index], A_Index > 1)   ; 01はnavigate=false
        if !ok {
            MsgBox "Error at condition " . CONDITIONS[A_Index].num . ". Stopped.", "Stop", 0x10
            return
        }
        if A_Index < 5 {
            WriteLog("Waiting 20s...")
            Sleep 20000
        }
    }
    MsgBox "Done 01-05!`nFile:`n" . OUTPUT, "Done", 0x40
}

^3:: {
    RunAll(false)
}

^0:: {
    MsgBox "Stopped.", "Stop", 0x30
    ExitApp
}
