# LiveKit Companion desktop client

LiveKit Companion combines three pieces in one Windows application:

- the complete voice-chat web client in a WinForms/WebView2 window with room-link handoff;
- global push-to-talk, even while a game or another window has focus;
- a localhost bridge to standard BitTorrent peers for the room cinema.

The web app discovers capabilities over `ws://127.0.0.1:7331`. Torrent playback uses
the companion when available and automatically falls back to browser WebTorrent when
it is not running. The fallback can only reach WebRTC-compatible peers; the companion
can reach regular BitTorrent peers.

`127.0.0.1` means the same Windows PC where the browser and companion are running. It
must not be replaced with the public Next.js or LiveKit server address: the deployed
HTTPS page initiates this local connection from inside the user's browser.

## Torrent data flow

```text
regular torrent peers -> companion -> localhost HTTP range stream
                      -> host browser <video> -> captureStream()
                      -> LiveKit screen-share -> room viewers
```

Torrent data and files never go to the Next.js server. Pieces are stored in an OS
temporary directory on the host and deleted when playback stops or the owning browser
socket disconnects. LiveKit receives only the encoded real-time media stream.

## Requirements

- Windows 10 or newer and Microsoft Edge WebView2 Runtime for the packaged client.
- Node.js 18 or newer only for a manual/development installation.
- .NET 8 SDK only when compiling the native launcher or PTT helper.
- Chrome or Edge is recommended only when opening the web app outside Companion.

The torrent service itself is Node-based, but the current global PTT helper uses a
Windows API, so other operating systems are not supported by the packaged app yet.

## One-click Windows install

Use **Download companion** on the voice-chat home page or in the room's top toolbar,
then run `LiveKitCompanionSetup.exe`. The installer already contains Node.js and all
dependencies, installs per-user to `%LOCALAPPDATA%\Programs\LiveKitCompanion`, creates
Start menu and desktop shortcuts, can enable startup with Windows, and starts the
companion in the background. It does not require a system-wide Node.js installation or
administrator rights. The installer adds the official Microsoft Edge WebView2 Runtime
only when it is missing.

Opening `LiveKitCompanion.exe` from the desktop or Start menu starts the bundled
background service, waits for it to become ready, and opens the complete voice-chat web
client in its own WinForms/WebView2 window. The native toolbar switches between
**Home / Chat** and the localhost **Settings** page and also provides Back and Reload.
Links to other origins open in the default browser. The window and its taskbar entry
belong to `LiveKitCompanion.exe` and use the embedded LiveKit icon. The user-facing
shortcuts point directly to this EXE; there are no batch or VBS launchers and no config
files to edit. The LiveKit tray icon can reopen the client or exit the service. Use **Uninstall
LiveKit Companion** or **Windows Settings → Apps → Installed apps** to remove it.

The first time a deployed voice-chat site connects, the embedded WebView2 client or a
regular Chrome/Edge browser may ask to access devices on the local network; allow it so
the page can reach the app on this PC. The companion then displays its own Windows
approval dialog. Verify the site origin and choose **Yes**. The companion remembers
approved origins under `%LOCALAPPDATA%\LiveKitCompanion`.

After that, reaching a managed `/rooms/<roomName>` link or custom `/custom?...` link in
a regular browser gates the LiveKit client before it mounts. The destination page, not
the landing page or remote server, checks a strictly loopback WebSocket and requires
protocol v3 with the `open-room` capability. The packaged service opens or reuses the
Companion window at the exact URL, preserving query parameters and the E2EE fragment.

An unavailable or incompatible service leaves the browser flow unchanged only while no
command has been sent. After `open-room` is sent, acceptance, explicit rejection, a lost
reply, or timeout all leave the current tab passive. It never mounts the room, acquires
media, produces duplicate audio, or resumes automatically, and there is no in-page
browser-resume button. To use the browser, choose **Exit** from the Companion tray icon
or otherwise stop the background service, then reload the link or open it in a new tab.
Closing only the native window with X is not enough: the running background service can
relaunch it on the next handoff.

The check is performed by the page, not by the remote Next.js process: only code on the
user's PC can probe `127.0.0.1`. Background startup is selected by default in the
installer, so a running service can open a closed native window silently. A manual
`npm start` service has no packaged launcher and therefore does not advertise room
handoff.

Release builds open the managed web-app origin embedded by the Windows workflow. It
uses the `COMPANION_WEB_APP_URL` repository variable and falls back to
`https://api.iroslyakov.com/`; a runtime environment variable with the same name takes
precedence. For an unmanaged manual/development installation, choose **Settings →
Voice-chat server → Connect in app**. The selected origin is saved and becomes both
the main client and a trusted companion origin. This is the web-app origin, not the
LiveKit WebSocket URL, API key, or API secret.

Remote addresses must use HTTPS. Plain HTTP is accepted only for loopback development
(`localhost`, `127.0.0.1`, or `[::1]`). If no client is configured, or the configured
page cannot load, the native window falls back to localhost Settings. Changing the
repository variable requires a new release build or manual workflow run.

The Settings page lists active voice-chat rooms. Choose a `.torrent` file or paste a
magnet link to start it in the selected room, then use the same panel to play, pause,
seek, or stop the browser-hosted stream. Click the large key display and press a key or
mouse side button to configure global PTT. The new bind is applied immediately; `Esc`
cancels capture, and `F8` is the default. Settings persist automatically between EXE
launches.

## Manual service setup

For development or a manual installation:

```bash
cd companion
npm install
npm run build:ptt-helper
```

List supported global talk-key names:

```bash
npm run keys
```

Then start both PTT and torrent capabilities:

```powershell
# PowerShell
$env:PTT_KEY="F8"; npm start
```

```bat
:: cmd.exe
set PTT_KEY=F8 && npm start
```

Keep this process running while the browser room is open. The cinema's **Torrent** tab
will choose it automatically; there is no engine toggle.

## Native client build and tests

From the repository root, the normal test suite covers the companion configuration,
localhost UI, installer contracts, WebView marker, and VK/cinema integration:

```bash
corepack pnpm test
```

Compile the native Windows components with the .NET 8 SDK:

```bash
dotnet build companion/app-launcher/LiveKitCompanion.csproj -c Release -r win-x64
dotnet build companion/ptt-helper/PttKeyState.csproj -c Release -r win-x64
```

The release workflow performs the final self-contained publish, Native AOT build,
Inno Setup packaging, installed WebView2 room-handoff smoke test, and uninstallation test
on Windows.
The installed layout includes the bundled Node runtime and service files expected by
the launcher; a standalone launcher build is primarily a compile check.

## Ports and configuration

| Variable                | Default          | Purpose                                                                          |
| ----------------------- | ---------------- | -------------------------------------------------------------------------------- |
| `PTT_KEY`               | `F8`             | Global key name used as the talk button.                                         |
| `PTT_PORT`              | `7331`           | Local capability WebSocket port.                                                 |
| `TORRENT_PORT`          | `PTT_PORT + 1`   | Local HTTP range-stream port used by the host browser.                           |
| `COMPANION_UI_PORT`     | `PTT_PORT + 2`   | Localhost Settings HTTP port.                                                    |
| `COMPANION_ORIGINS`     | approval dialog  | Comma-separated trusted browser origins, for example `https://chat.example.com`. |
| `PTT_ORIGINS`           | approval dialog  | Legacy alias used when `COMPANION_ORIGINS` is unset.                             |
| `COMPANION_WEB_APP_URL` | packaged default | Managed HTTPS voice-chat address opened in the WebView2 client.                  |

If the WebSocket port changes, configure the web app before building:

```dotenv
NEXT_PUBLIC_COMPANION_WS_URL=ws://127.0.0.1:7441
```

To disable global push-to-talk while keeping torrent support:

```dotenv
NEXT_PUBLIC_COMPANION_WS_URL=ws://127.0.0.1:7331
NEXT_PUBLIC_PTT_WS_URL=
```

For a managed installation, set both the client URL and an exact allowlist. The
allowlist disables interactive origin changes:

```powershell
$env:COMPANION_WEB_APP_URL="https://chat.example.com"
$env:COMPANION_ORIGINS="https://chat.example.com"
npm start
```

Without an explicit allowlist, each remote origin requires one-time approval through a
Windows dialog; the selected Companion web-app origin is trusted automatically.
Approved sites are stored locally and receive both PTT and torrent capabilities. Local
`localhost`, `127.0.0.1`, and `[::1]` development origins are trusted automatically.

## Torrent behavior

- Accepts magnet links and `.torrent` files up to 2 MB.
- Uses standard TCP/UDP BitTorrent discovery and peers; WebRTC seed support is not
  required when the companion is selected.
- Automatically selects the largest MP4/M4V/WebM/OGG/MOV/MKV file.
- Supports HTTP byte ranges, so seeking prioritizes the required torrent pieces.
- Shows peers, download speed, progress, and the selected engine in the host panel.
- Reports live playback state to Companion Settings and accepts validated
  play, pause, seek, and stop commands for the selected room.
- Runs one torrent session at a time and replaces the previous session on a new start.
- Deletes the temporary piece store on stop, disconnect, or companion shutdown.

The browser still has to decode the selected container and codecs. MP4 with H.264/AAC
and WebM are the most portable choices; MKV and HEVC support varies by browser and OS.

## Security

- All companion servers bind to `127.0.0.1` and are not reachable from the LAN.
- The Settings API uses an in-memory random token plus exact localhost same-origin
  checks. The read-only `/api/client-config` endpoint is public only on `127.0.0.1` so
  the launcher can discover its destination; the remote app never receives the token.
- The native WebView2 window embeds only the selected web-app origin and localhost
  Settings. Navigation outside those exact origins is cancelled, external HTTP(S)
  links open in the default browser, and WebView permissions or screen capture are
  denied outside the selected app origin.
- `open-room` is exposed only when the packaged launcher exists, and only the selected
  app origin may request exact same-origin `/rooms/<one-segment>` or `/custom` URLs. The
  full URL can contain a JWT and E2EE fragment, so it is never put in process arguments,
  persistent files, or logs. Node sends bounded JSON through
  `LiveKitCompanion.Navigation.<UI_PORT>`, a Windows named pipe restricted to the current
  user; WebView2 independently validates the scheme, credentials, route, and exact origin
  again before navigating.
- Every top-level document receives a frozen marker:
  `window.__LIVEKIT_COMPANION__ = { host: 'webview2', platform: 'windows', version: 1 }`.
  The web app uses it to hide the installer link inside the installed client.
- Torrent stream paths contain a random token.
- `LiveKitCompanionNative.exe` polls only the configured virtual key. It does not
  install a global keyboard hook, enumerate other keys, collect typed characters, or
  inspect windows. It also displays the origin-approval dialog without PowerShell.
- A remote origin gets no WebSocket access until the user approves it. Approval covers
  both the PTT relay and torrent commands and is persisted per Windows user.
- An explicit `COMPANION_ORIGINS` allowlist is authoritative and disables prompts.
- Use torrents only for content you are authorized to download and share.

The installer and helper are currently unsigned, so Windows SmartScreen or third-party
antivirus software may still show a reputation warning. The project does not attempt to
bypass or suppress security products.

## Autostart

The EXE installer can create a per-user Startup shortcut. It runs
`LiveKitCompanion.exe --startup`, which launches the service and tray icon without
forcing the web client to the foreground. For a manual development installation, create
a shortcut that runs `npm start` in this directory and place it in the Windows Startup
folder (`Win+R`, then `shell:startup`).

The launcher also accepts `--open` (open/reuse the client), `--stop` (orderly shutdown),
and the CI-only `--window-smoke-test` command.
