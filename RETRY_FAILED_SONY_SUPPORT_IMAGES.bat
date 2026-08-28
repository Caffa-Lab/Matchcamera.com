@echo off
setlocal
cd /d "%~dp0"

echo ======================================================
echo Retry Sony support images
echo Existing successful support images are skipped.
echo ======================================================
echo.

py -m pip install -r scripts\requirements-sony-support-images.txt
py scripts\update_sony_support_images.py --kind all

echo.
pause
