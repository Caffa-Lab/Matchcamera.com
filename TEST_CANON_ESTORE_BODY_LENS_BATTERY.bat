@echo off
setlocal
cd /d "%~dp0"

py -m pip install -r scripts\requirements-canon-estore-images.txt
if errorlevel 1 pause & exit /b 1

echo === BODY: EOS R5 Mark II ===
py scripts\update_canon_estore_images.py --kind body --match "EOS R5 Mark II" --limit 1 --replace --visible

echo.
echo === LENS: RF24-70mm F2.8L IS USM ===
py scripts\update_canon_estore_images.py --kind lens --match "RF24-70" --limit 1 --replace --visible

echo.
echo === BATTERY: LP-E6P ===
py scripts\update_canon_estore_images.py --kind battery --match "LP-E6P" --limit 1 --replace --visible

pause
