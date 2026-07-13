#ifndef AppVersion
  #define AppVersion "0.1.0"
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
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\runtime\node.exe
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription=Local companion for LiveKit voice chat
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
Name: "startup"; Description: "Запускать companion при входе в Windows"; GroupDescription: "Автозапуск:"; Flags: checkedonce

[Files]
Source: "build\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "build\LICENSE-node.txt"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "..\index.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\origin-approval.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\origin-core.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\ptt-core.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\torrent-core.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\torrent-service.js"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\package.json"; DestDir: "{app}\app"; Flags: ignoreversion
Source: "..\node_modules\*"; DestDir: "{app}\app\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "start-companion.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "start-companion.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "stop-companion.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "learn-key.cmd"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\start-companion.vbs"""; WorkingDir: "{app}"
Name: "{group}\Настроить клавишу рации"; Filename: "{app}\learn-key.cmd"; WorkingDir: "{app}"
Name: "{group}\Остановить companion"; Filename: "{app}\stop-companion.cmd"; WorkingDir: "{app}"
Name: "{group}\Удалить {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\start-companion.vbs"""; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\{#AppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\start-companion.vbs"""; WorkingDir: "{app}"; Tasks: startup

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\start-companion.vbs"""; Description: "Запустить {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\stop-companion.cmd"; RunOnceId: "StopCompanion"; Flags: runhidden waituntilterminated skipifdoesntexist

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\LiveKitCompanion"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  StopScript: String;
begin
  Result := '';
  StopScript := ExpandConstant('{app}\stop-companion.cmd');
  if FileExists(StopScript) then
    Exec(ExpandConstant('{cmd}'), '/C ""' + StopScript + '""', '', SW_HIDE,
      ewWaitUntilTerminated, ResultCode);
end;
