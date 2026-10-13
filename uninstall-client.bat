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

echo.
echo === osu! Skill Lab Uninstaller ===
echo 프로그램과 바로가기만 제거합니다.
echo %%USERPROFILE%%\.osu-skill-lab 의 DB/설정은 보존합니다.
echo.

choice /C YN /N /M "OSL Client를 제거할까요? [Y/N]: "
if errorlevel 2 exit /b 0

%PY% client-launcher.py uninstall
if errorlevel 1 (
  echo.
  echo 제거에 실패했습니다.
  pause
  exit /b 1
)

echo.
echo 제거가 완료되었습니다. 사용자 DB/설정은 그대로 남아 있습니다.
pause
