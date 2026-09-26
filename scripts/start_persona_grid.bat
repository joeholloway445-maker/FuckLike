@echo off
title FuckLike — Persona Matrix (Studio 7861 Launcher)
echo ================================================================
echo   FuckLike — 64x64 Persona Matrix & Studio (Port 7861)
echo   4,096 AI Companions with Photorealistic Portraits & Bios
echo ================================================================
echo.

set PERILIMINAL_DIR=C:\Users\JOEHO\Periliminal.Space
set PYTHON=C:\sglang\.venv\Scripts\python.exe

if not exist "%PYTHON%" (
    set PYTHON=python
)

echo Checking if port 7861 is already listening...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 7861 -ErrorAction SilentlyContinue" | findstr "7861" >nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Studio 7861 is already running!
    echo URL: http://127.0.0.1:7861/
    goto OPEN_BROWSER
)

echo Starting Catalog Server on port 7861...
cd /d "%PERILIMINAL_DIR%"
start /b "" "%PYTHON%" scripts\catalog_server.py 7861

timeout /t 2 >nul
echo [OK] Studio 7861 started successfully.

:OPEN_BROWSER
echo Opening FuckLike web app with Persona Matrix connected...
start http://127.0.0.1:7861/
