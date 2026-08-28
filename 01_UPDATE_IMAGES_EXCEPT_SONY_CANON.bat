@echo off
setlocal
cd /d "%~dp0"

echo =================================================
echo Matchcamera Image Update - EXCEPT Sony / Canon
echo =================================================
echo.

py -m pip install -r scripts\requirements-images.txt
if errorlevel 1 (
  echo [ERROR] Python package installation failed.
  pause
  exit /b 1
)

echo.
echo Sony and Canon are excluded.
echo Existing successful images will be skipped.
echo.
py scripts\update_product_images.py --exclude-manufacturer Sony --exclude-manufacturer Canon --retry-failed --no-browser-fallback

echo.
echo Finished.
echo Report: public\data\product-images-report.json
pause
