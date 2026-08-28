@echo off
setlocal
cd /d "%~dp0"

py -m pip install -r scripts\requirements-canon-estore-images.txt
if errorlevel 1 pause & exit /b 1

py scripts\update_canon_estore_images.py --kind all --replace

echo.
echo Report: public\data\canon-estore-images-report.json
pause
