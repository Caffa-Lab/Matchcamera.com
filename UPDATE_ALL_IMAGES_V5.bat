@echo off
setlocal
cd /d "%~dp0"
py -m pip install -r scripts\requirements-images.txt

echo.
echo Existing successful images will be skipped.
echo Legacy products may use reusable Wikimedia Commons images.
echo Sony/Canon current products use browser fallback first.
echo.
py scripts\update_product_images.py --retry-failed --browser-visible

echo.
echo Report: public\data\product-images-report.json
pause
