@echo off
setlocal
cd /d "%~dp0"
py -m pip install -r scripts\requirements-images.txt

echo.
echo === Sony alpha7 IV exact model code ===
py scripts\update_product_images.py --manufacturer Sony --exact-model-code "ILCE-7M4" --retry-failed --browser-visible

echo.
echo === Canon EOS R5 exact name ===
py scripts\update_product_images.py --manufacturer Canon --exact-name "Canon EOS R5" --retry-failed --browser-visible

echo.
pause
