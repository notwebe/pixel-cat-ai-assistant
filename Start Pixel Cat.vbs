Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = fso.BuildPath(projectDir, "node_modules\electron\dist\electron.exe")
mainEntry = fso.BuildPath(projectDir, "dist-electron\main.cjs")

If Not fso.FileExists(electronExe) Then
  MsgBox "Electron is not installed yet. Open a terminal in this folder and run ""npm install"" first.", vbExclamation, "Pixel Cat Assistant"
  WScript.Quit 1
End If

If Not fso.FileExists(mainEntry) Then
  MsgBox "App is not built yet. Open a terminal in this folder and run ""npm run build"" first.", vbExclamation, "Pixel Cat Assistant"
  WScript.Quit 1
End If

shell.CurrentDirectory = projectDir
shell.Run """" & electronExe & """ .", 0, False
