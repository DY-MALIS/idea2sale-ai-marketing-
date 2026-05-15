@echo off
cd /d "%~dp0"
"C:\Program Files\nodejs\npm.cmd" run dev > "%~dp0dev-server.process.log" 2>&1
