; "Free AI POS.exe" — the program the shortcuts open. It starts the bundled Node.js hidden
; (no black console window) running desktop.mjs, which starts the POS and opens its window.
Unicode true
!include "FileFunc.nsh"
Name "Free AI POS"
OutFile "${OUT}"
Icon "..\icons\icon.ico"
RequestExecutionLevel user
SilentInstall silent
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Free AI POS"
VIAddVersionKey "FileDescription" "Free AI POS"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Personal use only - see LICENSE"

Section
  ${GetParameters} $0
  ExecShell "" '"$EXEDIR\node\node.exe"' '"$EXEDIR\app\desktop.mjs" $0' SW_HIDE
SectionEnd
