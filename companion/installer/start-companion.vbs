Set Shell = CreateObject("WScript.Shell")
Set FileSystem = CreateObject("Scripting.FileSystemObject")
InstallDir = FileSystem.GetParentFolderName(WScript.ScriptFullName)
Shell.Run Chr(34) & InstallDir & "\start-companion.cmd" & Chr(34), 0, False
