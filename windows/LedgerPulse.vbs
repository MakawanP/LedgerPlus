' ============================================================================
' LedgerPulse — Silent Native Windows 10/11 Desktop Launcher (Zero Console)
' Starts the local LedgerPulse vault server silently in the background (if not
' already running) and opens LedgerPulse in a standalone desktop app window.
' ============================================================================
Option Explicit

Dim fso, shell, appDir, dataInboxDir, nodeExe, serverCjs, isRunning
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
If fso.FileExists(appDir & "\..\server.cjs") And Not fso.FileExists(appDir & "\server.cjs") Then
  appDir = fso.GetAbsolutePathName(appDir & "\..")
ElseIf fso.FileExists(appDir & "\..\server.ts") And Not fso.FileExists(appDir & "\server.cjs") Then
  appDir = fso.GetAbsolutePathName(appDir & "\..")
End If

shell.CurrentDirectory = appDir

If Not fso.FolderExists(appDir & "\data") Then
  fso.CreateFolder(appDir & "\data")
End If
If Not fso.FolderExists(appDir & "\data\inbox") Then
  fso.CreateFolder(appDir & "\data\inbox")
End If

Function IsServerReady()
  On Error Resume Next
  Dim http
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 600, 600, 600, 600
  http.Open "GET", "http://127.0.0.1:3000/api/local-vault", False
  http.Send
  If Err.Number = 0 And http.Status = 200 Then
    IsServerReady = True
  Else
    IsServerReady = False
  End If
  Err.Clear
  On Error GoTo 0
End Function

isRunning = IsServerReady()

If Not isRunning Then
  serverCjs = appDir & "\server.cjs"
  If fso.FileExists(appDir & "\runtime\node.exe") Then
    nodeExe = """" & appDir & "\runtime\node.exe"""
  Else
    nodeExe = "node"
  End If

  If fso.FileExists(serverCjs) Then
    shell.Run "cmd /c set NODE_ENV=production&& " & nodeExe & " """ & serverCjs & """", 0, False
  Else
    shell.Run "cmd /c npm run dev", 0, False
  End If

  Dim attempts
  attempts = 0
  Do While attempts < 24 And Not IsServerReady()
    WScript.Sleep 400
    attempts = attempts + 1
  Loop
End If

' Launch chromeless native Windows app window via Microsoft Edge or Chrome
On Error Resume Next
Err.Clear
shell.Run "msedge --app=http://localhost:3000", 1, False
If Err.Number <> 0 Then
  Err.Clear
  shell.Run "chrome --app=http://localhost:3000", 1, False
  If Err.Number <> 0 Then
    Err.Clear
    shell.Run "http://localhost:3000", 1, False
  End If
End If
On Error GoTo 0
