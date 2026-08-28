@echo off
setlocal
cd /d "%~dp0"
py -m pip install -r scripts\requirements-canon-estore-images.txt
py scripts\update_canon_estore_images.py --kind all
pause
