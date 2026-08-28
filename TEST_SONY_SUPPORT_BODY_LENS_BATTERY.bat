@echo off
setlocal
cd /d "%~dp0"

echo ======================================================
echo Sony official support image test
echo Body / Lens / Battery
echo ======================================================
echo.

py -m pip install -r scripts\requirements-sony-support-images.txt
if errorlevel 1 (
  echo [ERROR] dependency install failed
  pause
  exit /b 1
)

echo.
echo === BODY: Sony alpha7 IV / ILCE-7M4 ===
py scripts\update_sony_support_images.py --kind body --match "ILCE-7M4" --limit 1 --replace --visible

echo.
echo === LENS: FE 24-70mm F2.8 GM II / SEL2470GM2 ===
py scripts\update_sony_support_images.py --kind lens --match "SEL2470GM2" --limit 1 --replace --visible

echo.
echo === BATTERY: NP-FZ100 ===
py scripts\update_sony_support_images.py --kind battery --match "NP-FZ100" --limit 1 --replace --visible

echo.
echo Test complete.
pause
