@echo off
rem Drag a photo onto this file to check what the PC reporter can read from it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\WorkTimeline\reporter.ps1" -TestPhoto "%~1"
echo.
pause
