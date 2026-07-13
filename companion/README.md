# LiveKit local companion

One localhost helper provides two optional browser capabilities:

- global push-to-talk, even while a game or another window has focus;
- standard BitTorrent peer support for the room cinema.

The web app discovers capabilities over `ws://127.0.0.1:7331`. Torrent playback uses
the companion when available and automatically falls back to browser WebTorrent when
it is not running. The fallback can only reach WebRTC-compatible peers; the companion
can reach regular BitTorrent peers.

## Data flow

```text
regular torrent peers -> companion -> localhost HTTP range stream
                      -> host browser <video> -> captureStream()
                      -> LiveKit screen-share -> room viewers
```

Torrent data and files never go to the Next.js server. Pieces are stored in an OS
temporary directory on the host and deleted when playback stops or the owning browser
socket disconnects. LiveKit receives only the encoded real-time media stream.

## Requirements

- Windows 10 or newer for the EXE installer and global PTT key.
- Node.js 18 or newer only for a manual/development installation.
- Chrome or Edge is recommended for localhost media capture.

The torrent service itself is Node-based, but the current global PTT helper uses a
Windows API, so other operating systems are not supported by the packaged app yet.

## One-click Windows install

Use **Download companion** on the voice-chat home page or in **Кинотеатр → Торрент**,
then run `LiveKitCompanionSetup.exe`. The installer already contains Node.js and all
dependencies, installs per-user to `%LOCALAPPDATA%\Programs\LiveKitCompanion`, creates
Start menu and desktop shortcuts, can enable startup with Windows, and starts the
companion in the background. It does not require a system-wide Node.js installation or
administrator rights.

The first time a deployed voice-chat site connects, Windows displays an approval
dialog. Verify its origin and choose **Yes**. The companion remembers approved origins
under `%LOCALAPPDATA%\LiveKitCompanion`.

The Start menu folder includes **Configure PTT key**. It validates and saves a supported
key, restarts the companion, and keeps `F8` as the default.

## Setup

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

## Ports and configuration

| Variable            | Default         | Purpose                                                                          |
| ------------------- | --------------- | -------------------------------------------------------------------------------- |
| `PTT_KEY`           | `F8`            | Global key name used as the talk button.                                         |
| `PTT_PORT`          | `7331`          | Local capability WebSocket port.                                                 |
| `TORRENT_PORT`      | `PTT_PORT + 1`  | Local HTTP range-stream port used by the host browser.                           |
| `COMPANION_ORIGINS` | approval dialog | Comma-separated trusted browser origins, for example `https://chat.example.com`. |
| `PTT_ORIGINS`       | approval dialog | Legacy alias used when `COMPANION_ORIGINS` is unset.                             |

If the WebSocket port changes, configure the web app before building:

```dotenv
NEXT_PUBLIC_COMPANION_WS_URL=ws://127.0.0.1:7441
```

To disable global push-to-talk while keeping torrent support:

```dotenv
NEXT_PUBLIC_COMPANION_WS_URL=ws://127.0.0.1:7331
NEXT_PUBLIC_PTT_WS_URL=
```

For a managed installation, an exact allowlist disables interactive approval:

```powershell
$env:COMPANION_ORIGINS="https://chat.example.com"; npm start
```

Without an explicit allowlist, each remote origin requires one-time approval through a
Windows dialog. Approved sites are stored locally and receive both PTT and torrent
capabilities. Local `localhost`, `127.0.0.1`, and `[::1]` development origins are
trusted automatically.

## Torrent behavior

- Accepts magnet links and `.torrent` files up to 2 MB.
- Automatically selects the largest MP4/M4V/WebM/OGG/MOV/MKV file.
- Supports HTTP byte ranges, so seeking prioritizes the required torrent pieces.
- Shows peers, download speed, progress, and the selected engine in the host panel.
- Runs one torrent session at a time and replaces the previous session on a new start.
- Deletes the temporary piece store on stop, disconnect, or companion shutdown.

The browser still has to decode the selected container and codecs. MP4 with H.264/AAC
and WebM are the most portable choices; MKV and HEVC support varies by browser and OS.

## Security

- Both servers bind to `127.0.0.1` and are not reachable from the LAN.
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

The EXE installer can create a per-user Startup shortcut. For a manual installation,
create a shortcut that runs `npm start` in this directory and place it in the Windows
Startup folder (`Win+R`, then `shell:startup`).
