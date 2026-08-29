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
echo Panasonic Naver Brand Store test
echo First 5 products only
echo ======================================================
echo.

py scripts\update_panasonic_naver_images_prices.py --max-pages 2 --limit 5 --visible --replace-images

echo.
echo Check:
echo public\data\panasonic-naver-extracted.json
pause
