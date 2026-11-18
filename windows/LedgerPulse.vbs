' ============================================================================
' LedgerPulse — Silent Native Windows 10/11 Desktop Launcher (Zero Console)
' Starts the local LedgerPulse vault server silently in the background and
' opens LedgerPulse in a standalone desktop app window:
'   - Online Default : Pre-authorized Cloud + Gmail Sync URL (so Google Sign-In,
'                      Gmail receipt scanning & Phone/PC sync work immediately).
'   - Offline / --local : Local offline vault server (http://localhost:3000).
' ============================================================================
Option Explicit

Dim fso, shell, appDir, nodeExe, serverCjs, isRunning, forceLocal, targetUrl, cloudAppUrl
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

cloudAppUrl = "https://ais-pre-htcfj44ymcyxj7dcndkfx2-860080216343.us-east1.run.app"
forceLocal = False

If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "--local" Or LCase(WScript.Arguments(0)) = "/local" Then
    forceLocal = True
  End If
End If

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

Function IsLocalServerReady()
  On Error Resume Next
  Dim http
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 600, 600, 600, 600
  http.Open "GET", "http://127.0.0.1:3000/api/local-vault", False
  http.Send
  If Err.Number = 0 And http.Status = 200 Then
    IsLocalServerReady = True
  Else
    IsLocalServerReady = False
  End If
  Err.Clear
  On Error GoTo 0
End Function

Function IsCloudAppReachable()
  On Error Resume Next
  Dim http
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1500, 1500, 2000, 2000
  http.Open "HEAD", cloudAppUrl, False
  http.Send
  If Err.Number = 0 And http.Status >= 200 And http.Status < 500 Then
    IsCloudAppReachable = True
  Else
    IsCloudAppReachable = False
  End If
  Err.Clear
  On Error GoTo 0
End Function

isRunning = IsLocalServerReady()

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
  Do While attempts < 24 And Not IsLocalServerReady()
    WScript.Sleep 400
    attempts = attempts + 1
  Loop
End If

If (Not forceLocal) And IsCloudAppReachable() Then
  targetUrl = cloudAppUrl
Else
  targetUrl = "http://localhost:3000"
End If

' Launch chromeless native Windows app window via Microsoft Edge or Chrome
On Error Resume Next
Err.Clear
shell.Run "msedge --app=" & targetUrl, 1, False
If Err.Number <> 0 Then
  Err.Clear
  shell.Run "chrome --app=" & targetUrl, 1, False
  If Err.Number <> 0 Then
    Err.Clear
    shell.Run targetUrl, 1, False
  End If
End If
On Error GoTo 0
