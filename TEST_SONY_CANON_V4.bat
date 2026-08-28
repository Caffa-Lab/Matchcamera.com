@echo off
setlocal
cd /d "%~dp0"

echo =============================================
echo  Matchcamera Sony/Canon Browser Test v4
echo =============================================
echo.

py -m pip install -r scripts\requirements-images.txt
if errorlevel 1 (
  echo [ERROR] Python packages failed.
  pause
  exit /b 1
)

echo.
echo Chrome or Edge will be used as a normal browser.
echo A browser window may open during the test.
echo.

echo === Sony 3 test ===
py scripts\update_product_images.py --manufacturer Sony --limit 3 --retry-failed --browser-visible

echo.
echo === Canon 3 test ===
py scripts\update_product_images.py --manufacturer Canon --limit 3 --retry-failed --browser-visible

echo.
pause
