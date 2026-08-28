@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo Canon current-product image test
echo ==========================================
echo.

py -m pip install -r scripts\requirements-images.txt

echo.
echo === Canon EOS R5 ===
py scripts\update_product_images.py --manufacturer Canon --exact-name "Canon EOS R5" --retry-failed --browser-visible --refresh

echo.
echo === Canon EOS R5 C ===
py scripts\update_product_images.py --manufacturer Canon --exact-name "Canon EOS R5 C" --retry-failed --browser-visible --refresh

echo.
echo === Canon EOS R6 Mark II ===
py scripts\update_product_images.py --manufacturer Canon --exact-name "Canon EOS R6 Mark II" --retry-failed --browser-visible --refresh

echo.
pause
