@echo off
setlocal
cd /d "%~dp0"
py -m pip install -r scripts\requirements-images.txt
echo.
echo Existing successful images are skipped.
echo Missing/failed products are retried with v3 fallback.
echo.
py scripts\update_product_images.py --retry-failed
echo.
echo Report: public\data\product-images-report.json
pause
