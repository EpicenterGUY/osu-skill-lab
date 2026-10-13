@echo off
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>&1
if %errorlevel%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>&1
  if not %errorlevel%==0 (
    echo Python 3.10+가 필요합니다.
    pause
    exit /b 1
  )
  set "PY=python"
)

if exist "client-launcher.py" (
  %PY% client-launcher.py start
) else (
  %PY% server.py
)

if errorlevel 1 pause
