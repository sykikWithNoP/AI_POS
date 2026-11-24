; Windows installer for NINDITO POS. Per-user install: no administrator rights needed.
; App:  %LOCALAPPDATA%\Programs\NINDITO POS     Data: %LOCALAPPDATA%\NINDITOPOS\data (kept on uninstall unless chosen)
Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define APP "NINDITO POS"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\NINDITOPOS"

Name "${APP} ${VERSION}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Personal use only - see LICENSE"

!define MUI_ICON "..\icons\icon.ico"
!define MUI_UNICON "..\icons\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install ${APP}"
!define MUI_WELCOMEPAGE_TEXT "This puts ${APP} on this computer.$\r$\n$\r$\nEverything stays on this computer: your sales, products and customers are never uploaded.$\r$\n$\r$\nNo administrator rights are needed, and nothing else needs to be installed."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APP} now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGE}\app\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; Stop a running copy (only processes started from this install folder) before replacing files.
!macro StopRunning
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Pop $0
  Sleep 800
!macroend

Section "${APP} (required)" SecApp
  SectionIn RO
  !insertmacro StopRunning
  SetOutPath "$INSTDIR"
  ; Replace the program files; never touch the data folder.
  RMDir /r "$INSTDIR\app\public"
  File /r "${STAGE}\node"
  File /r "${STAGE}\app"
  File "${STAGE}\${APP}.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${APP}.exe" "" "$INSTDIR\${APP}.exe" 0
  CreateShortcut "$SMPROGRAMS\${APP}\Uninstall ${APP}.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP}.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${APP}.exe" "" "$INSTDIR\${APP}.exe" 0
SectionEnd

Section /o "Start when Windows starts" SecStartup
  ; Same file the in-app switch (Settings > Updates > This computer) writes, so both stay in sync.
  FileOpen $0 "$SMSTARTUP\${APP}.vbs" w
  FileWrite $0 `' Starts NINDITO POS in the background when you sign in to Windows.$\r$\n`
  FileWrite $0 `CreateObject("WScript.Shell").Run """$INSTDIR\node\node.exe"" ""$INSTDIR\app\desktop.mjs"" --background", 0, False$\r$\n`
  FileClose $0
SectionEnd

LangString DESC_App ${LANG_ENGLISH} "The point-of-sale program."
LangString DESC_Desktop ${LANG_ENGLISH} "An icon on your desktop."
LangString DESC_Startup ${LANG_ENGLISH} "Start quietly in the background when you sign in. You can change this later in Settings."
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} $(DESC_App)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_Desktop)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} $(DESC_Startup)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  !insertmacro StopRunning
  Delete "$DESKTOP\${APP}.lnk"
  Delete "$SMSTARTUP\${APP}.vbs"
  RMDir /r "$SMPROGRAMS\${APP}"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"
  Delete "$INSTDIR\${APP}.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Also delete ALL your sales, products, customers and backups?$\r$\n$\r$\nChoose No to keep them (recommended) - they come back if you install again." IDNO keep
    RMDir /r "$LOCALAPPDATA\NINDITOPOS"
  keep:
SectionEnd
