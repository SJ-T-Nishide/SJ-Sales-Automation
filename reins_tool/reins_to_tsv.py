#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
reins_to_tsv.py  v2.1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
レインズ検索結果テキスト → 受信タブ用 TSV 変換スクリプト

使い方:
    python reins_to_tsv.py               ← config.ini の input_folder 内の最新 .txt を自動選択
    python reins_to_tsv.py C:\path\file.txt  ← ファイルを直接指定（AHK 自動呼び出し時）

設定ファイル:
    スクリプトと同じフォルダの config.ini を自動的に読み込みます。
    config.ini が見つからない場合は内部デフォルト値で動作します。

出力列（受信タブ A〜V の 22 列）:
    A  タブ名        B  取得日時      C  連番          D  物件番号
    E  取得元        F  物件種目      G  所在地         H  建物名
    I  賃料(万円)    J  管理費(円)    K  面積           L  ㎡単価
    M  坪単価        N  間取          O  所在階         P  築年月
    Q  交通          R  電話          S  用途地域       T  敷金
    U  保証金        V  礼金
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import re
import os
import sys
import glob
import configparser
from datetime import datetime

try:
    import pyperclip
    CLIPBOARD_OK = True
except ImportError:
    CLIPBOARD_OK = False


# ══════════════════════════════════════════════════════════════════════
#  デフォルト値（config.ini が存在しない場合のフォールバック）
# ══════════════════════════════════════════════════════════════════════

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

_DEFAULT_INPUT_FOLDER  = os.path.join(_SCRIPT_DIR, 'input')
_DEFAULT_OUTPUT_FOLDER = os.path.join(_SCRIPT_DIR, 'output')
_DEFAULT_COPY_CLIPBOARD = True

_DEFAULT_CONDITION_TABS = {
    1:  "01 大阪_一戸建",
    2:  "02 大阪市_マンション",
    3:  "03 大阪市_外全",
    4:  "04 大阪市_外一",
    5:  "05 東京_外全",
    6:  "06 東京_外一",
    7:  "07 東京_一戸建",
    8:  "08 東京_マンション",
    9:  "09 福岡_マンション",
    10: "10 福岡_一戸建",
    11: "11 福岡_外全",
    12: "12 福岡_外一",
    13: "13 名古屋_外一",
    14: "14 名古屋_外全",
    15: "15 名古屋_マンション",
    16: "16 名古屋_一戸建",
    17: "17 札幌_一戸建",
    18: "18 札幌_マンション",
    19: "19 札幌_外全",
    20: "20 札幌_外一",
}


# ══════════════════════════════════════════════════════════════════════
#  config.ini 読み込み
# ══════════════════════════════════════════════════════════════════════

def load_config():
    """
    スクリプトと同じフォルダの config.ini を読み込む。
    ファイルが存在しない・読めない場合はデフォルト値を返す。
    """
    config_path = os.path.join(_SCRIPT_DIR, 'config.ini')

    cfg = configparser.ConfigParser()

    if not os.path.exists(config_path):
        print(f"[INFO] config.ini が見つかりません。デフォルト値で動作します。")
        print(f"       探した場所: {config_path}")
        return _DEFAULT_INPUT_FOLDER, _DEFAULT_OUTPUT_FOLDER, _DEFAULT_COPY_CLIPBOARD, dict(_DEFAULT_CONDITION_TABS)

    try:
        # UTF-8 BOM なし / あり の両方に対応
        cfg.read(config_path, encoding='utf-8-sig')
    except Exception as e:
        print(f"[WARN] config.ini の読み込みに失敗しました: {e}")
        print(f"       デフォルト値で動作します。")
        return _DEFAULT_INPUT_FOLDER, _DEFAULT_OUTPUT_FOLDER, _DEFAULT_COPY_CLIPBOARD, dict(_DEFAULT_CONDITION_TABS)

    # [paths]
    input_folder  = cfg.get('paths', 'input_folder',  fallback=_DEFAULT_INPUT_FOLDER).strip()
    output_folder = cfg.get('paths', 'output_folder', fallback=_DEFAULT_OUTPUT_FOLDER).strip()

    # [options]
    copy_cb_str    = cfg.get('options', 'copy_to_clipboard', fallback='true').strip().lower()
    copy_clipboard = copy_cb_str in ('true', '1', 'yes', 'on')

    # [tabs]
    condition_tabs = {}
    if cfg.has_section('tabs'):
        for key, val in cfg.items('tabs'):
            # キー形式: tab_01, tab_02, ...
            m = re.match(r'^tab_(\d{1,2})$', key)
            if m:
                num = int(m.group(1))
                condition_tabs[num] = val.strip()

    if not condition_tabs:
        print(f"[WARN] config.ini の [tabs] セクションが空です。デフォルト値を使用します。")
        condition_tabs = dict(_DEFAULT_CONDITION_TABS)

    print(f"[INFO] config.ini 読み込み完了: {config_path}")
    return input_folder, output_folder, copy_clipboard, condition_tabs


# ══════════════════════════════════════════════════════════════════════
#  正規表現・定数
# ══════════════════════════════════════════════════════════════════════

JP_TO_INT = {
    '１': 1, '２': 2, '３': 3, '４': 4, '５': 5,
    '６': 6, '７': 7, '８': 8, '９': 9,
    '１０': 10, '１１': 11, '１２': 12, '１３': 13, '１４': 14, '１５': 15,
    '１６': 16, '１７': 17, '１８': 18, '１９': 19, '２０': 20,
}

SECTION_RE       = re.compile(r'^＃＃＃条件([１２３４５６７８９０]+)$')
SECTION_ASCII_RE = re.compile(r'^###\s+(\d+)\s+(.*)')
PROP_NUM_RE      = re.compile(r'^\d{12}$')
PHONE_RE         = re.compile(r'^[\d\-（）\(\)]+$')
YEAR_RE          = re.compile(r'\d{4}年')
FLOOR_RE         = re.compile(r'(地下)?[\d０-９]+階')

PAGE_BREAK_KEYWORDS = (
    'ログアウト', 'メインメニューに戻る', '賃貸検索結果一覧',
    '売買物件検索', '賃貸物件検索', '会員番号：',
)


# ══════════════════════════════════════════════════════════════════════
#  ユーティリティ
# ══════════════════════════════════════════════════════════════════════

def looks_like_phone(s: str) -> bool:
    return bool(PHONE_RE.match(s)) and len(s) >= 9

def looks_like_floor(s: str) -> bool:
    return bool(FLOOR_RE.search(s))

def parse_condition_num(jp_str: str) -> int:
    return JP_TO_INT.get(jp_str.strip(), 0)

def parse_rent(s: str):
    s = s.strip()
    if not s or s in ('-', 'なし'):
        return ''
    m = re.search(r'([\d,]+(?:\.\d+)?)\s*万円', s)
    if m:
        return float(m.group(1).replace(',', ''))
    m = re.search(r'([\d,]+)\s*円', s)
    if m:
        return round(int(m.group(1).replace(',', '')) / 10000, 2)
    return ''

def parse_fee(s: str):
    s = s.strip()
    if not s or s == '-':
        return ''
    if s == 'なし':
        return 0
    m = re.search(r'([\d,]+(?:\.\d+)?)\s*万円', s)
    if m:
        return int(float(m.group(1).replace(',', '')) * 10000)
    m = re.search(r'([\d,]+)\s*円', s)
    if m:
        return int(m.group(1).replace(',', ''))
    return ''

def parse_area(s: str):
    s = s.strip()
    if not s or s in ('-', ''):
        return ''
    m = re.search(r'([\d,]+\.?\d*)\s*㎡', s)
    if m:
        return float(m.group(1).replace(',', ''))
    m = re.search(r'([\d,]+(?:\.\d+)?)\s*万円', s)
    if m:
        return float(m.group(1).replace(',', ''))
    return ''

def parse_deposit_split(s: str):
    s = s.strip()
    if not s or s in ('-', '-/-'):
        return '', ''
    parts = [p.strip() for p in s.split('/', 1)]
    left  = '' if parts[0] in ('-', '') else parts[0]
    right = '' if len(parts) < 2 or parts[1] in ('-', '') else parts[1]
    return left, right

def parse_deposit_left(s: str) -> str:
    return parse_deposit_split(s)[0]


# ══════════════════════════════════════════════════════════════════════
#  セクションパーサー
# ══════════════════════════════════════════════════════════════════════

def extract_field_names(section_lines: list) -> list:
    in_header = False
    fields = []
    found_first = False
    for line in section_lines:
        s = line.strip()
        if s == '▲':
            if not found_first:
                in_header = True
                found_first = True
            else:
                break
            continue
        if in_header:
            if re.match(r'^\d{1,4}$', s):
                break
            if s and s != 'No.':
                fields.append(s)
    return fields


def collect_record_lines(all_lines: list, start_pos: int) -> list:
    result = []
    i = start_pos + 1
    while i < len(all_lines) and len(result) < 30:
        s = all_lines[i].strip()
        if PROP_NUM_RE.match(s):
            break
        if any(kw in s for kw in PAGE_BREAK_KEYWORDS):
            break
        if re.match(r'^\d{1,4}$', s) and s:
            j = i + 1
            while j < len(all_lines) and not all_lines[j].strip():
                j += 1
            if j < len(all_lines) and PROP_NUM_RE.match(all_lines[j].strip()):
                break
        if s:
            result.append(s)
        i += 1
    return result


def assign_fields(prop_num: str, data_lines: list, field_names: list) -> dict:
    fields = {f: '' for f in field_names}
    fields['物件番号'] = prop_num
    lines = list(data_lines)
    i = 0

    for fname in field_names:
        if fname == '物件番号':
            continue

        val = lines[i].strip() if i < len(lines) else ''

        if fname == '所在階':
            if val and looks_like_floor(val):
                fields[fname] = val
                i += 1

        elif fname == '築年月':
            if val and not looks_like_phone(val):
                fields[fname] = val
                i += 1

        else:
            if i < len(lines):
                fields[fname] = val
                i += 1

    return fields


def get_area_field(field_names: list) -> str:
    for candidate in ('建物面積', '使用部分面積'):
        if candidate in field_names:
            return candidate
    return '建物面積'


def build_output_row(fields: dict, field_names: list,
                     tab_name: str, now_str: str, local_seq: int) -> list:
    area_key  = get_area_field(field_names)
    rent      = parse_rent(fields.get('賃料', ''))
    fee       = parse_fee(fields.get('管理費', ''))
    area      = parse_area(fields.get(area_key, ''))

    if '㎡単価' in fields and fields['㎡単価'] not in ('', '-'):
        sqm_tan = parse_area(fields['㎡単価'])
        if not sqm_tan and rent != '' and area != '':
            sqm_tan = round(float(rent) / float(area), 2)
    elif rent != '' and area != '':
        sqm_tan = round(float(rent) / float(area), 2)
    else:
        sqm_tan = ''
    tsubo_tan = round(float(sqm_tan) * 3.3058, 2) if sqm_tan != '' else ''

    dep_raw  = fields.get('敷金／保証金') or fields.get('敷金/保証金', '')
    shikikin, hoshoukin = parse_deposit_split(dep_raw)

    rei_raw = fields.get('礼金／権利金') or fields.get('礼金/権利金', '')
    reikin  = parse_deposit_left(rei_raw)

    return [
        tab_name,                         # A タブ名
        now_str,                          # B 取得日時
        local_seq,                        # C 連番
        fields.get('物件番号', ''),        # D 物件番号 ← 重複判定キー
        'レインズ',                        # E 取得元
        fields.get('物件種目', ''),        # F 物件種目
        fields.get('所在地', ''),         # G 所在地
        fields.get('建物名', ''),         # H 建物名
        rent,                             # I 賃料(万円)
        fee,                              # J 管理費(円)
        area,                             # K 面積
        sqm_tan,                          # L ㎡単価
        tsubo_tan,                        # M 坪単価
        fields.get('間取', ''),           # N 間取
        fields.get('所在階', ''),         # O 所在階
        fields.get('築年月', ''),         # P 築年月
        fields.get('交通', ''),           # Q 交通
        fields.get('電話番号', ''),       # R 電話
        fields.get('用途地域', ''),       # S 用途地域
        shikikin,                         # T 敷金
        hoshoukin,                        # U 保証金
        reikin,                           # V 礼金
    ]


def parse_section(section_text: str, condition_num: int, now_str: str,
                  condition_tabs: dict) -> tuple:
    lines = section_text.split('\n')

    field_names = extract_field_names(lines)
    if not field_names:
        return [], [f"条件{condition_num}: フィールドヘッダーが見つかりません"]

    prop_positions = [
        i for i, line in enumerate(lines)
        if PROP_NUM_RE.match(line.strip())
    ]
    if not prop_positions:
        return [], [f"条件{condition_num}: 物件データが見つかりません"]

    tab_name  = condition_tabs.get(condition_num, f"条件{condition_num:02d}")
    rows      = []
    errors    = []
    local_seq = 0

    for pos in prop_positions:
        prop_num   = lines[pos].strip()
        data_lines = collect_record_lines(lines, pos)

        try:
            fields = assign_fields(prop_num, data_lines, field_names)
        except Exception as exc:
            errors.append(f"[PARSE_ERROR] 物件番号={prop_num} 条件={condition_num} : {exc}")
            continue

        if not fields.get('物件番号'):
            errors.append(f"[NO_PROP_NUM] 条件={condition_num} line={pos+1}")
            continue

        local_seq += 1
        rows.append(build_output_row(fields, field_names, tab_name, now_str, local_seq))

    return rows, errors


# ══════════════════════════════════════════════════════════════════════
#  ファイル選択・分割
# ══════════════════════════════════════════════════════════════════════

def find_latest_txt(folder: str) -> str:
    files = glob.glob(os.path.join(folder, 'reins_*.txt'))
    if not files:
        raise FileNotFoundError(f"フォルダ内に reins_*.txt が見つかりません: {folder}")
    return max(files, key=os.path.getmtime)


def split_sections(text: str) -> list:
    sections = []
    current_num = None
    current_lines = []

    for line in text.split('\n'):
        m = SECTION_RE.match(line.strip())
        if m:
            if current_num is not None:
                sections.append((current_num, '\n'.join(current_lines)))
            current_num = parse_condition_num(m.group(1))
            current_lines = []
            continue

        m2 = SECTION_ASCII_RE.match(line.strip())
        if m2:
            if current_num is not None:
                sections.append((current_num, '\n'.join(current_lines)))
            current_num = int(m2.group(1))
            current_lines = []
            continue

        if current_num is not None:
            current_lines.append(line)

    if current_num is not None and current_lines:
        sections.append((current_num, '\n'.join(current_lines)))

    return sections


# ══════════════════════════════════════════════════════════════════════
#  プレビュー表示
# ══════════════════════════════════════════════════════════════════════

def show_preview(rows: list):
    print()
    print("─" * 90)
    print("【先頭 10 行プレビュー】")
    print(f"{'A-タブ名':<20} {'C-連番':>4}  {'D-物件番号':<14} {'F-種目':<12} {'I-賃料':>7}  {'K-面積':>8}  G-所在地")
    print("─" * 90)
    for row in rows[:10]:
        tab   = str(row[0])[:18]
        seq   = str(row[2])
        pnum  = str(row[3])
        shub  = str(row[5])[:10]
        rent  = str(row[8]) if row[8] != '' else '-'
        area  = str(row[10]) if row[10] != '' else '-'
        addr  = str(row[6])[:28]
        print(f"{tab:<20} {seq:>4}  {pnum:<14} {shub:<12} {rent:>7}万  {area:>8}㎡  {addr}")
    print("─" * 90)
    print()


# ══════════════════════════════════════════════════════════════════════
#  メイン処理
# ══════════════════════════════════════════════════════════════════════

def main():
    # ── config.ini 読み込み ──
    input_folder, output_folder, copy_clipboard, condition_tabs = load_config()

    # ── 入力ファイル決定 ──
    # 引数ありの場合は自動モード（AHKから呼ばれた等）→ 終了時の pause をスキップ
    auto_mode = len(sys.argv) >= 2
    if auto_mode:
        input_path = sys.argv[1]
        if not os.path.exists(input_path):
            print(f"エラー: ファイルが見つかりません: {input_path}")
            sys.exit(1)
        # 自動モード（AHK 経由）は入力ファイルと同じフォルダへ出力
        # → AHK の output/ フォルダに reins_*.txt と converted_*.tsv が並ぶ
        output_folder = os.path.dirname(os.path.abspath(input_path))
    else:
        try:
            input_path = find_latest_txt(input_folder)
        except FileNotFoundError as e:
            print(f"エラー: {e}")
            sys.exit(1)

    print(f"入力ファイル: {input_path}")
    print(f"出力フォルダ: {output_folder}")

    # ── 読み込み ──
    text = None
    for enc in ('utf-8-sig', 'utf-8', 'cp932'):
        try:
            with open(input_path, encoding=enc) as f:
                text = f.read()
            break
        except (UnicodeDecodeError, LookupError):
            continue
    if text is None:
        print("エラー: ファイルのエンコーディングを判定できませんでした。")
        sys.exit(1)

    now     = datetime.now()
    now_str = now.strftime('%Y/%m/%d %H:%M')
    ts      = now.strftime('%Y%m%d_%H%M')

    # ── セクション分割 → パース ──
    sections = split_sections(text)
    if not sections:
        print("エラー: セクションが見つかりません。")
        sys.exit(1)

    print(f"セクション数: {len(sections)}")

    all_rows   = []
    all_errors = []

    for cond_num, section_text in sorted(sections, key=lambda x: x[0]):
        rows, errors = parse_section(section_text, cond_num, now_str, condition_tabs)
        tab_name = condition_tabs.get(cond_num, f"条件{cond_num:02d}")
        status = f"  条件{cond_num:2d} ({tab_name}): {len(rows):4d}件変換"
        if errors:
            status += f"  ⚠ {len(errors)}件エラー"
        print(status)
        all_rows.extend(rows)
        all_errors.extend(errors)

    if not all_rows:
        print("変換できた物件がありません。")
        sys.exit(1)

    # ── TSV 生成 ──
    tsv_lines = ['\t'.join('' if v == '' else str(v) for v in row)
                 for row in all_rows]
    tsv_body = '\n'.join(tsv_lines)

    # ── TSV ファイル保存 ──
    os.makedirs(output_folder, exist_ok=True)
    out_path = os.path.join(output_folder, f"converted_{ts}.tsv")
    with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
        f.write(tsv_body)

    # ── エラーファイル保存 ──
    err_path = None
    if all_errors:
        err_path = os.path.join(output_folder, f"errors_{ts}.txt")
        with open(err_path, 'w', encoding='utf-8-sig') as f:
            f.write(f"変換エラー一覧  {now_str}\n")
            f.write(f"入力: {input_path}\n")
            f.write("=" * 60 + "\n")
            for e in all_errors:
                f.write(e + "\n")

    # ── 結果サマリー ──
    print()
    print(f"✅ 変換完了: {len(all_rows)} 件  （エラー: {len(all_errors)} 件）")
    print(f"💾 TSV保存:  {out_path}")
    if err_path:
        print(f"⚠  エラー詳細: {err_path}")

    # ── プレビュー（先頭 10 行）──
    show_preview(all_rows)

    # ── クリップボードコピー ──
    if copy_clipboard and CLIPBOARD_OK:
        try:
            pyperclip.copy(tsv_body)
            print("📋 クリップボードにコピーしました。")
        except Exception as e:
            print(f"⚠ クリップボードコピー失敗: {e}")
    elif copy_clipboard and not CLIPBOARD_OK:
        print("⚠ pyperclip がインストールされていません。クリップボードコピーをスキップ。")
        print("   インストール: pip install pyperclip")

    print()
    # AHKから自動呼び出しの場合は pause しない
    if not auto_mode:
        input("Enterキーで終了...")


if __name__ == '__main__':
    main()
