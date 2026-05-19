@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ============================================
echo  AirDNA Export 自動化
echo ============================================
echo.
node playwright_airdna.js
echo.
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] エラーが発生しました。上のログを確認してください。
) else (
    echo [DONE] 処理が完了しました。
)
echo.
pause
