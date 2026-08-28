@echo off
setlocal
cd /d "%~dp0"
py -m pip install -r scripts\requirements-images.txt

echo.
echo Existing successful images are skipped.
echo Wikimedia 429 responses are retried politely.
echo.
py scripts\update_product_images.py --retry-failed --browser-visible

echo.
echo Report: public\data\product-images-report.json
pause
