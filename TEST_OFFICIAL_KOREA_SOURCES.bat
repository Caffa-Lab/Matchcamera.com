@echo off
setlocal
cd /d "%~dp0"

py -m pip install -r scripts\requirements-official-korea-sources.txt
if errorlevel 1 pause & exit /b 1

echo === SAEKI / SIGMA ===
py scripts\update_official_korea_sources.py --source saeki --match "17mm F4 DG DN" --limit 1 --replace-images --visible

echo.
echo === LK SAMYANG : AF 24-60mm F2.8 FE ===
echo This must resolve to the LENS product, not the dedicated hood.
py scripts\update_official_korea_sources.py --source samyang --match "24-60mm F2.8 FE" --limit 1 --replace-images --visible

echo.
echo === SUNPHOTO / TAMRON ===
py scripts\update_official_korea_sources.py --source sunphoto --match "17-50mm F4" --limit 1 --replace-images --visible

echo.
echo Test complete.
pause
