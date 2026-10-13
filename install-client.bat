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
echo === osu! Skill Lab Installer ===
echo 설치 위치: %%LOCALAPPDATA%%\osu-skill-lab
echo 사용자 DB/설정은 %%USERPROFILE%%\.osu-skill-lab 에 유지됩니다.
echo.

choice /C YN /N /M "Windows 로그인 시 자동 시작할까요? [Y/N]: "
if errorlevel 2 (set "AUTO=") else (set "AUTO=--autostart")

choice /C YN /N /M "바탕화면 바로가기를 만들까요? [Y/N]: "
if errorlevel 2 (set "DESKTOP=") else (set "DESKTOP=--desktop")

choice /C YN /N /M "설치 후 바로 실행할까요? [Y/N]: "
if errorlevel 2 (set "LAUNCH=") else (set "LAUNCH=--launch")

%PY% client-launcher.py install %AUTO% %DESKTOP% %LAUNCH%
if errorlevel 1 (
  echo.
  echo 설치에 실패했습니다.
  pause
  exit /b 1
)

echo.
echo 설치가 완료되었습니다.
pause
