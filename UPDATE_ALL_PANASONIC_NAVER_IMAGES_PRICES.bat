@echo off
setlocal
cd /d "%~dp0"

py -m pip install -r scripts\requirements-panasonic-naver.txt
if errorlevel 1 (
  echo [ERROR] dependency install failed
  pause
  exit /b 1
)

echo ======================================================
echo Panasonic Naver Brand Store
echo ALL category products: prices + images
echo ======================================================
echo.

py scripts\update_panasonic_naver_images_prices.py --max-pages 20 --replace-images

echo.
echo Report:
echo public\data\panasonic-naver-extracted.json
pause
