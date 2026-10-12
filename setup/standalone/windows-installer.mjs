export function windowsInstallerScript({ version, bundle, archive, hash, bootstrap, updates }) {
  const esc = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
  const root = `strique-${version}-win32-x64`;
  return `Unicode true
Name "Strique"
OutFile "${esc(`${bundle}.exe`)}"
RequestExecutionLevel user
ManifestLongPathAware true
SetCompress off
SilentInstall normal
ShowInstDetails show
Section
SetShellVarContext current
InitPluginsDir
SetOutPath "$PLUGINSDIR"
File /oname=node.exe "${esc(`${bundle}\\bin\\node.exe`)}"
File /oname=payload.tar.gz "${esc(archive)}"
File /oname=bootstrap.mjs "${esc(bootstrap)}"
File /oname=updates.mjs "${esc(updates)}"
DetailPrint "Extracting and verifying Strique runtime..."
ExecWait '"$PLUGINSDIR\\node.exe" "$PLUGINSDIR\\bootstrap.mjs" "$PLUGINSDIR\\payload.tar.gz" "${root}" "${hash}"' $0
IntCmp $0 0 installed
MessageBox MB_ICONSTOP "Strique installation failed. See $TEMP\\Strique-install-error.log." /SD IDOK
SetErrorLevel 1
Abort
installed:
ReadEnvStr $1 STRIQUE_DATA_DIR
StrCmp $1 "" 0 finished
SetOutPath "$LOCALAPPDATA\\Strique\\releases\\${version}"
CreateShortCut "$DESKTOP\\Strique.lnk" "$OUTDIR\\bin\\node.exe" '"$OUTDIR\\control.mjs" start'
CreateShortCut "$SMPROGRAMS\\Strique.lnk" "$OUTDIR\\bin\\node.exe" '"$OUTDIR\\control.mjs" start'
finished:
SetErrorLevel 0
SectionEnd
`;
}
