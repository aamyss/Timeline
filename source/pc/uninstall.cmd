@echo off
powershell -NoProfile -Command "Unregister-ScheduledTask -TaskName 'Work timeline - PC reporter' -Confirm:$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'Work timeline - Inquiry Copilot copy' -Confirm:$false -ErrorAction SilentlyContinue"
echo Removed. Your settings are kept in %LOCALAPPDATA%\WorkTimeline (delete that folder to remove them too).
pause
