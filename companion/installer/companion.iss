#ifndef AppVersion
  #define AppVersion "0.6.0"
#endif

#define AppName "LiveKit Companion"
#define AppPublisher "fireostendere"
#define AppUrl "https://github.com/fireostendere/my-voice-chat"

[Setup]
AppId={{12EFC43A-119C-4F45-95C2-FEE1BA5FC7AA}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
DefaultDirName={localappdata}\Programs\LiveKitCompanion
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=LiveKitCompanionSetup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
InfoAfterFile=after-install.txt
CreateUninstallRegKey=yes
Uninstallable=yes
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\LiveKitCompanion.exe
SetupIconFile=..\assets\livekit-companion.ico
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription=Windows WebView2 client for LiveKit voice chat
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
Name: "startup"; Description: "Start companion when signing in to Windows"; GroupDescription: "Startup:"; Flags: checkedonce

[Files]
Source: "build\app-launcher\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "build\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "build\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "build\LICENSE-node.txt"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "build\ptt-helper\LiveKitCompanionNative.exe"; DestDir: "{app}\app\bin"; Flags: ignoreversion
Source: "..\index.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\client-config.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\origin-approval.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\origin-core.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\ptt-key-listener.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\companion-ui.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\room-registry.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\torrent-core.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\torrent-service.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\ui\index.html"; DestDir: "{app}\app\ui"; Flags: ignoreversion
Source: "..\ui\styles.css"; DestDir: "{app}\app\ui"; Flags: ignoreversion
Source: "..\ui\app.js"; DestDir: "{app}\app\ui"; Flags: ignoreversion
Source: "..\assets\livekit-companion.ico"; DestDir: "{app}\app\ui"; DestName: "livekit.ico"; Flags: ignoreversion
Source: "..\..\public\images\livekit-apple-touch.png"; DestDir: "{app}\app\ui"; DestName: "livekit.png"; Flags: ignoreversion
Source: "..\package.json"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\node_modules\*"; DestDir: "{app}\app\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\LiveKitCompanion.exe"; WorkingDir: "{app}"; AppUserModelID: "LiveKit.Companion"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{userprograms}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\LiveKitCompanion.exe"; WorkingDir: "{app}"; Tasks: desktopicon; AppUserModelID: "LiveKit.Companion"
Name: "{userstartup}\{#AppName}"; Filename: "{app}\LiveKitCompanion.exe"; Parameters: "--startup"; WorkingDir: "{app}"; Tasks: startup; AppUserModelID: "LiveKit.Companion"

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing Microsoft Edge WebView2 Runtime..."; Flags: runhidden waituntilterminated; Check: WebView2RuntimeMissing
Filename: "{app}\LiveKitCompanion.exe"; Description: "Open {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\LiveKitCompanion.exe"; Parameters: "--stop"; RunOnceId: "StopCompanion"; Flags: runhidden waituntilterminated skipifdoesntexist

[InstallDelete]
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"
Type: files; Name: "{app}\LiveKitCompanion.ico"
Type: files; Name: "{app}\start-companion.cmd"
Type: files; Name: "{app}\start-companion.vbs"
Type: files; Name: "{app}\launch-companion.vbs"
Type: files; Name: "{app}\stop-companion.cmd"
Type: files; Name: "{app}\status-companion.cmd"
Type: files; Name: "{app}\configure-key.cmd"
Type: files; Name: "{app}\configure-key.js"
Type: files; Name: "{app}\Uninstall LiveKit Companion.cmd"
Type: files; Name: "{app}\learn-key.cmd"
Type: files; Name: "{group}\Configure PTT key.lnk"
Type: files; Name: "{group}\Status and diagnostics.lnk"
Type: files; Name: "{group}\Stop companion.lnk"

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\LiveKitCompanion"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  Launcher: String;
  LegacyStopScript: String;
begin
  Result := '';
  Launcher := ExpandConstant('{app}\LiveKitCompanion.exe');
  LegacyStopScript := ExpandConstant('{app}\stop-companion.cmd');
  if FileExists(Launcher) then
    Exec(Launcher, '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode)
  else if FileExists(LegacyStopScript) then
    Exec(ExpandConstant('{cmd}'), '/C ""' + LegacyStopScript + '""', '', SW_HIDE,
      ewWaitUntilTerminated, ResultCode);
end;

function HasWebView2Version(RootKey: Integer; SubKey: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, SubKey, 'pv', Version) and
    (Version <> '') and (Version <> '0.0.0.0');
end;

function WebView2RuntimeMissing: Boolean;
var
  ClientKey: String;
begin
  ClientKey := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := not HasWebView2Version(HKCU, ClientKey) and
    not HasWebView2Version(HKLM32, ClientKey);
end;
