# Thin wrapper for install.mjs. The installer is Node, not PowerShell: the
# profile's cordis.patch.yml is UTF-8 and this wrapper is intentionally ASCII so
# Windows PowerShell 5.1 can read it without guessing an encoding.
#
#   powershell -File install.ps1
#   powershell -File install.ps1 --profile web
#   powershell -File install.ps1 --uninstall
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $root 'install.mjs') @args
exit $LASTEXITCODE
