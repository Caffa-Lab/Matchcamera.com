@echo off
setlocal
cd /d "%~dp0"

py scripts\check_homepage.py
if errorlevel 1 (
  echo.
  echo [STOP] Home page check failed. Do not push yet.
  pause
  exit /b 1
)

echo.
echo Home page is safe to push.
pause
