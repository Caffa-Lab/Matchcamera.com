@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo Sony Store product-cut image updater
echo ==========================================
echo.

py -m pip install -r scripts\requirements-images.txt
py scripts\bootstrap_sony_store_map.py

echo.
echo Sony Store pages are preferred.
echo Existing non-Sony-Store Sony images will be replaced when a Store product cut is found.
echo Chrome or Edge may open while collecting.
echo.

py scripts\update_sony_store_images.py --visible --replace

echo.
echo Finished.
echo Store URL map: public\data\sony-store-pages.json
echo Report: public\data\sony-store-images-report.json
pause
