@echo off
chcp 932 >nul
setlocal

set TXT_FILE=%1
set SCRIPT=%~dp0reins_to_tsv.py
set PYTHON_EXE=

echo [run_convert] Input : %TXT_FILE%
echo [run_convert] Script: %SCRIPT%
echo.

if not exist "%SCRIPT%" (
    echo [ERROR] reins_to_tsv.py not found: %SCRIPT%
    pause
    exit /b 1
)

REM --- py.exe (Python Launcher) ---
for /f "delims=" %%i in ('where py.exe 2^>nul') do (
    if not defined PYTHON_EXE (
        echo %%i | findstr /i "WindowsApps" >nul
        if errorlevel 1 set PYTHON_EXE=%%i
    )
)

REM --- python.exe (skip Microsoft Store stub in WindowsApps) ---
if not defined PYTHON_EXE (
    for /f "delims=" %%i in ('where python.exe 2^>nul') do (
        if not defined PYTHON_EXE (
            echo %%i | findstr /i "WindowsApps" >nul
            if errorlevel 1 set PYTHON_EXE=%%i
        )
    )
)

REM --- python3.exe ---
if not defined PYTHON_EXE (
    for /f "delims=" %%i in ('where python3.exe 2^>nul') do (
        if not defined PYTHON_EXE (
            echo %%i | findstr /i "WindowsApps" >nul
            if errorlevel 1 set PYTHON_EXE=%%i
        )
    )
)

REM --- common install paths ---
if not defined PYTHON_EXE (
    for %%p in (
        "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python39\python.exe"
        "C:\Python313\python.exe"
        "C:\Python312\python.exe"
        "C:\Python311\python.exe"
        "C:\Python310\python.exe"
    ) do (
        if not defined PYTHON_EXE if exist %%p set PYTHON_EXE=%%~p
    )
)

if not defined PYTHON_EXE (
    echo [ERROR] Python not found. Install from https://www.python.org
    pause
    exit /b 1
)

echo [run_convert] Python : %PYTHON_EXE%
echo.

"%PYTHON_EXE%" "%SCRIPT%" "%TXT_FILE%"

echo.
echo [run_convert] Finished. (errorlevel: %ERRORLEVEL%)
pause
endlocal
