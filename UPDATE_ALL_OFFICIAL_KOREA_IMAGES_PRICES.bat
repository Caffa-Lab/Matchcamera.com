@echo off
setlocal
cd /d "%~dp0"

py -m pip install -r scripts\requirements-official-korea-sources.txt
if errorlevel 1 pause & exit /b 1

echo =====================================================
echo Official Korea images + normal/consumer prices
echo SAEKI(SIGMA) + LK SAMYANG + SUNPHOTO(TAMRON)
echo =====================================================
echo.

py scripts\update_official_korea_sources.py --source all --replace-images

echo.
echo Report:
echo public\data\official-korea-source-report.json
pause
