Set Shell = CreateObject("WScript.Shell")
Set FileSystem = CreateObject("Scripting.FileSystemObject")

Function IsCompanionRunning(PidPath)
  On Error Resume Next
  IsCompanionRunning = False
  If Not FileSystem.FileExists(PidPath) Then Exit Function

  Set PidStream = FileSystem.OpenTextFile(PidPath, 1)
  ProcessId = Trim(PidStream.ReadAll)
  PidStream.Close
  If Not IsNumeric(ProcessId) Then Exit Function

  Query = "SELECT ProcessId FROM Win32_Process WHERE ProcessId = " & CLng(ProcessId) & _
    " AND Name = 'node.exe'"
  Set Processes = GetObject("winmgmts:\\.\root\cimv2").ExecQuery(Query)
  IsCompanionRunning = Processes.Count > 0
  On Error GoTo 0
End Function

InstallDir = FileSystem.GetParentFolderName(WScript.ScriptFullName)
DataDir = Shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\LiveKitCompanion"
PidFile = DataDir & "\companion.pid"
LogFile = DataDir & "\companion.log"
UiUrl = "http://127.0.0.1:7333/"

Set ProcessEnvironment = Shell.Environment("Process")
ProcessEnvironment("COMPANION_INTERACTIVE") = "1"
Shell.Run Chr(34) & InstallDir & "\start-companion.cmd" & Chr(34), 0, False
WScript.Sleep 2500

If IsCompanionRunning(PidFile) Then
  EdgePath = Shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & _
    "\Microsoft\Edge\Application\msedge.exe"
  If Not FileSystem.FileExists(EdgePath) Then
    EdgePath = Shell.ExpandEnvironmentStrings("%ProgramFiles%") & _
      "\Microsoft\Edge\Application\msedge.exe"
  End If
  If FileSystem.FileExists(EdgePath) Then
    Shell.Run Chr(34) & EdgePath & Chr(34) & " --app=" & UiUrl, 1, False
  Else
    Shell.Run UiUrl, 1, False
  End If
Else
  MsgBox "LiveKit Companion could not start." & vbCrLf & vbCrLf & _
    "Open 'Status and diagnostics' in the Start menu for details." & vbCrLf & _
    "Log: " & LogFile, 16, "LiveKit Companion"
End If
