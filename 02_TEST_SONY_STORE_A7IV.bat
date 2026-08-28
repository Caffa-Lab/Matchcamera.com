@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo Sony Store product-cut test - Alpha 7 IV
echo ==========================================
echo.

py -m pip install -r scripts\requirements-images.txt
py scripts\bootstrap_sony_store_map.py

echo.
echo Chrome or Edge will open.
echo Target store page:
echo https://store.sony.co.kr/product-view/102270076
echo.

py scripts\update_sony_store_images.py --exact-model-code "ILCE-7M4" --visible --replace

echo.
pause
