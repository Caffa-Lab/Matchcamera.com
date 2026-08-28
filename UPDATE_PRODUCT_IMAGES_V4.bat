@echo off
setlocal
cd /d "%~dp0"

echo =============================================
echo  Matchcamera Product Image Updater v4
echo =============================================
echo.

py -m pip install -r scripts\requirements-images.txt
if errorlevel 1 (
  echo [ERROR] Python packages failed.
  pause
  exit /b 1
)

echo Existing successful images will be skipped.
echo Sony/Canon will use the browser fallback.
echo.
py scripts\update_product_images.py --retry-failed --browser-visible

echo.
echo Report: public\data\product-images-report.json
pause
