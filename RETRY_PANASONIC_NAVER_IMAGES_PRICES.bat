@echo off
setlocal
cd /d "%~dp0"

py -m pip install -r scripts\requirements-panasonic-naver.txt
py scripts\update_panasonic_naver_images_prices.py --max-pages 20

echo.
pause
