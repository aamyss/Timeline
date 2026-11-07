' Work timeline: runs the PC reporter with no window (so nothing flashes while you work or play).
Dim sh, dir
Set sh = CreateObject("WScript.Shell")
dir = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\WorkTimeline"
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\reporter.ps1""", 0, True
