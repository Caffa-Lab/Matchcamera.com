@echo off
setlocal
cd /d "%~dp0"
py -m pip install -r scripts\requirements-images.txt
echo.
echo === Sony 3 test ===
py scripts\update_product_images.py --manufacturer Sony --limit 3 --retry-failed
echo.
echo === Canon 3 test ===
py scripts\update_product_images.py --manufacturer Canon --limit 3 --retry-failed
echo.
pause
