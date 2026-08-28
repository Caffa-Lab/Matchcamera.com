@echo off
setlocal
cd /d "%~dp0"

echo ======================================================
echo Matchcamera Sony official support image updater
echo ALL Sony Body + Lens + Battery
echo ======================================================
echo.

py -m pip install -r scripts\requirements-sony-support-images.txt
if errorlevel 1 (
  echo [ERROR] dependency install failed
  pause
  exit /b 1
)

echo.
echo Existing Sony images will be replaced with images
echo collected from support.d-imaging.sony.co.jp when available.
echo.

py scripts\update_sony_support_images.py --kind all --replace

echo.
echo Report:
echo public\data\sony-support-images-report.json
pause
