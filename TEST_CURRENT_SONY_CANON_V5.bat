@echo off
setlocal
cd /d "%~dp0"
py -m pip install -r scripts\requirements-images.txt

echo.
echo === Sony current model: ILCE-7M4 ===
py scripts\update_product_images.py --manufacturer Sony --match "ILCE-7M4" --retry-failed --browser-visible

echo.
echo === Canon current model: EOS R5 ===
py scripts\update_product_images.py --manufacturer Canon --match "Canon EOS R5" --retry-failed --browser-visible

echo.
pause
