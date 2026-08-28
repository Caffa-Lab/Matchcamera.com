@echo off
setlocal
cd /d "%~dp0"
py -m pip install -r scripts\requirements-images.txt
py scripts\update_product_images.py --retry-failed
pause
