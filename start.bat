@echo off
cd /d "%~dp0"

echo Dang khoi dong Google Maps Review Checker...
echo (Cua so nay se tu dong an sau 3 giay)

:: Chay server trong background (an cmd)
start /min cmd /c "node server.js"

:: Cho server khoi dong (doi 1 giay)
timeout /t 1 /nobreak >nul

:: Mo trinh duyet
start http://localhost:1211


echo Tool batdau
