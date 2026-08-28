@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo  Matchcamera Product Image Auto Updater
echo ==========================================
echo.

where py >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python 3 was not found.
  echo Install Python 3 and run this file again.
  pause
  exit /b 1
)

echo [1/2] Installing/updating required Python packages...
py -m pip install -r scripts\requirements-images.txt
if errorlevel 1 (
  echo [ERROR] Package installation failed.
  pause
  exit /b 1
)

echo.
echo [2/2] Searching official product pages and downloading missing images...
py scripts\update_product_images.py
if errorlevel 1 (
  echo.
  echo [ERROR] Image updater stopped with an error.
  pause
  exit /b 1
)

echo.
echo Finished.
echo Failed/blocked products are listed in:
echo public\data\product-images-report.json
echo.
pause
