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
echo 기본 제거는 프로그램만 지우고
echo %%USERPROFILE%%\.osu-skill-lab 의 DB/설정은 보존합니다.
echo.

choice /C YN /N /M "사용자 DB/설정까지 모두 삭제할까요? [Y/N]: "
if errorlevel 2 (
  %PY% client-launcher.py uninstall
) else (
  %PY% client-launcher.py uninstall --purge-data
)

if errorlevel 1 (
  echo.
  echo 제거에 실패했습니다.
  pause
  exit /b 1
)

echo.
echo 제거가 완료되었습니다.
pause
