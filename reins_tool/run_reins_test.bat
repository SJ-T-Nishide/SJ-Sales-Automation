@echo off
chcp 932 >nul
setlocal

echo ======================================================
echo  run_reins_test.bat  (condition 01 only)
echo ======================================================
echo.

set AHK_SCRIPT=%~dp0reins_rpa_v4.ahk
set AHK_EXE=

echo [1] AHK script: %AHK_SCRIPT%
if not exist "%AHK_SCRIPT%" (
    echo [ERROR] reins_rpa_v4.ahk not found.
    pause
    exit /b 1
)
echo     OK
echo.

echo [2] Searching for AutoHotkey...

for /f "delims=" %%i in ('where AutoHotkey.exe 2^>nul') do (
    if not defined AHK_EXE set AHK_EXE=%%i
)
if defined AHK_EXE goto :found

if exist "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe" (
    set AHK_EXE=C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe
    goto :found
)
if exist "C:\Program Files\AutoHotkey\v2\AutoHotkey32.exe" (
    set AHK_EXE=C:\Program Files\AutoHotkey\v2\AutoHotkey32.exe
    goto :found
)
if exist "C:\Program Files\AutoHotkey\AutoHotkey.exe" (
    set AHK_EXE=C:\Program Files\AutoHotkey\AutoHotkey.exe
    goto :found
)
if exist "C:\Program Files (x86)\AutoHotkey\AutoHotkey.exe" (
    set AHK_EXE=C:\Program Files (x86)\AutoHotkey\AutoHotkey.exe
    goto :found
)

for /f "tokens=2 delims==" %%a in ('assoc .ahk 2^>nul') do set AHK_ASSOC=%%a
if defined AHK_ASSOC (
    for /f "tokens=2 delims=^"" %%a in ('ftype %AHK_ASSOC% 2^>nul') do (
        if not defined AHK_EXE set AHK_EXE=%%a
    )
)
if defined AHK_EXE goto :found

echo [ERROR] AutoHotkey not found.
pause
exit /b 1

:found
echo     Found: %AHK_EXE%
echo.
echo [3] Launching TEST mode (condition 01 only)...
echo     3 seconds to start. Do not touch mouse/keyboard.
echo.
start "" "%AHK_EXE%" "%AHK_SCRIPT%" --test

echo [OK] AHK launched. This window can be closed.
echo ======================================================
timeout /t 5 >nul

endlocal
