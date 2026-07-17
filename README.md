<a href="https://livekit.io/">
  <img src="./.github/assets/livekit-mark.png" alt="LiveKit logo" width="100" height="100">
</a>

# LiveKit Meet

**Documentation:** English | [Русский](./README.ru.md)

<p>
  <a href="https://meet.livekit.io"><strong>Try the demo</strong></a>
  •
  <a href="https://github.com/livekit/components-js">LiveKit Components</a>
  •
  <a href="https://docs.livekit.io/">LiveKit Docs</a>
  •
  <a href="https://livekit.io/cloud">LiveKit Cloud</a>
  •
  <a href="https://blog.livekit.io/">Blog</a>
</p>

<br>

An open source video conferencing app built on [LiveKit Components](https://github.com/livekit/components-js),
[LiveKit Cloud](https://cloud.livekit.io/), and Next.js. This repository is a
customized fork of [LiveKit Meet](https://github.com/livekit/meet).

![LiveKit Meet screenshot](./.github/assets/livekit-meet.jpg)

## Features

- 🎥 **Multi-party video & audio** rooms powered by the LiveKit SFU, with adaptive
  stream and dynacast for bandwidth efficiency.
- 🔗 **Two ways to join** — a managed _Demo_ flow that mints tokens for you, and a
  _Custom_ flow where you bring your own LiveKit server URL and token.
- 🔒 **End-to-end encryption (E2EE)** with the passphrase carried in the URL hash
  (never sent to the server).
- 🖼️ **Background effects** — blur or virtual background images
  (`@livekit/track-processors`).
- 🎙️ **Krisp enhanced noise cancellation**, auto-enabled on capable devices.
- 🔴 **Room recording** to S3 via LiveKit Egress (speaker-layout composite).
- 🌍 **Region selection** for LiveKit Cloud projects.
- ⚙️ **Codec & quality controls** (VP9/VP8/H.264/AV1, HQ up to 2160p) via URL params.
- ⚡ **Automatic low-CPU optimization** that degrades video quality under pressure.
- ⌨️ **Keyboard shortcuts** and a **debug overlay** (`Shift+D`).
- 📊 Optional **Datadog** log forwarding.
- 🍿 **Synchronized room cinema** for direct MP4/WebM/Ogg URLs, HLS streams,
  YouTube and VK Video links, local files, and host-side torrents shared over LiveKit.
- 🖥️ **Windows Companion desktop client** built with WinForms and WebView2, with
  automatic room-link handoff, global push-to-talk, regular BitTorrent peers, and the
  complete web app in one window.

## Tech stack

- [Next.js](https://nextjs.org/) 15 (App Router, React 18)
- [`@livekit/components-react`](https://github.com/livekit/components-js/) for the prefab conferencing UI
- [`livekit-client`](https://github.com/livekit/client-sdk-js) for the realtime WebRTC connection
- [`livekit-server-sdk`](https://github.com/livekit/server-sdk-js) for token minting and Egress (recording)
- TypeScript (strict), ESLint, Prettier, Vitest, pnpm

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for a detailed breakdown of routes, the
connection lifecycle, E2EE, and recording. Repo conventions and gotchas live in
[`CLAUDE.md`](./CLAUDE.md).

## Demo

Give it a try at https://meet.livekit.io.

## Quick start

Requirements: **Node.js >= 18** (CI uses Node 24). The repository pins
`pnpm@10.18.2`; Corepack can run that exact version without a global pnpm install.

1. Install dependencies:

   ```bash
   corepack pnpm install
   ```

2. Create the local environment file:

   ```bash
   # macOS, Linux, or WSL
   cp .env.example .env.local

   # Windows PowerShell
   Copy-Item .env.example .env.local
   ```

3. Create a project in the [LiveKit Cloud dashboard](https://cloud.livekit.io/) (or
   use your own LiveKit server), then put its credentials in `.env.local`:

   ```dotenv
   LIVEKIT_API_KEY=your-api-key
   LIVEKIT_API_SECRET=your-api-secret
   LIVEKIT_URL=wss://your-project.livekit.cloud
   ```

   These three values are required for the **Demo** tab to create working rooms. Use
   the WebSocket URL (`wss://`), not the dashboard or an `https://` URL. Keep the API
   secret server-side and never prefix it with `NEXT_PUBLIC_`.

4. Start the development server:

   ```bash
   corepack pnpm dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), select **Demo**, click
   **Start Meeting**, enter a participant name, and join. To test a second participant,
   open the resulting room URL in another browser profile or an incognito window.

If the `pnpm` command already exists, `pnpm install` and `pnpm dev` are equivalent.
If `pnpm` is missing, keep using the `corepack pnpm ...` form shown above.

For a production-mode local check:

```bash
corepack pnpm build
corepack pnpm start
```

Public `NEXT_PUBLIC_*` variables are embedded during `build`; set them before running
that command. See the [Russian README](./README.ru.md) for a more detailed walkthrough
and troubleshooting guide.

## Scripts

| Command                                   | Description                      |
| ----------------------------------------- | -------------------------------- |
| `pnpm dev`                                | Start the dev server.            |
| `pnpm build`                              | Production build.                |
| `pnpm start`                              | Serve the production build.      |
| `pnpm lint` / `pnpm lint:fix`             | ESLint (`next/core-web-vitals`). |
| `pnpm test`                               | Run the Vitest suite.            |
| `pnpm format:check` / `pnpm format:write` | Prettier check / write.          |

CI runs `lint`, `format:check`, and `test` on every push and pull request.

## Environment variables

**Required (server-only):**

| Variable             | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `LIVEKIT_API_KEY`    | LiveKit API key.                                           |
| `LIVEKIT_API_SECRET` | LiveKit API secret.                                        |
| `LIVEKIT_URL`        | LiveKit server URL, e.g. `wss://my-project.livekit.cloud`. |

**Optional — recording (server-only):** `S3_KEY_ID`, `S3_KEY_SECRET`, `S3_ENDPOINT`,
`S3_BUCKET`, `S3_REGION`.

**Optional — public (`NEXT_PUBLIC_*`):**

| Variable                                                       | Description                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SHOW_SETTINGS_MENU`                               | Set to `true` to show the in-room settings menu (devices, backgrounds, Krisp, recording). |
| `NEXT_PUBLIC_LK_RECORD_ENDPOINT`                               | Base path for recording controls, e.g. `/api/record`. Recording UI is hidden if unset.    |
| `NEXT_PUBLIC_CONN_DETAILS_ENDPOINT`                            | Override the token endpoint (default `/api/connection-details`).                          |
| `NEXT_PUBLIC_DATADOG_CLIENT_TOKEN`, `NEXT_PUBLIC_DATADOG_SITE` | If both set, forward client logs to Datadog.                                              |
| `NEXT_PUBLIC_COMPANION_WS_URL`                                 | Local companion URL for room handoff, PTT, and standard BitTorrent peers.                 |
| `NEXT_PUBLIC_PTT_WS_URL`                                       | Push-to-talk companion URL (default `ws://127.0.0.1:7331`; empty disables it).            |

The companion download endpoint accepts the server-only `COMPANION_EXE_URL` override
for a custom HTTPS mirror of `LiveKitCompanionSetup.exe`. The Windows release workflow
reads the repository variable `COMPANION_WEB_APP_URL` and embeds that HTTPS origin as
the desktop client's managed home page; it falls back to `https://api.iroslyakov.com/`.
A runtime environment variable with the same name overrides the packaged value. It is
not read from the Next.js `.env.local` file.

## Configuring a room via URL

A managed room URL is `/rooms/<roomName>` and accepts:

- `?hq=true` — high quality (2160p capture, 1080p/720p simulcast).
- `?codec=vp9|vp8|h264|av1` — preferred video codec (default `vp9`).
- `?singlePC=false` — disable single peer-connection mode (default on for managed rooms).
- `?region=<id>` — pin to a LiveKit Cloud region.
- `#<passphrase>` — enable E2EE with the given passphrase (set via the home page).

The custom flow is `/custom?liveKitUrl=<wss-url>&token=<jwt>` (with optional `codec`,
`singlePC`, and `#<passphrase>`).

## Recording

Recording uses [LiveKit Egress](https://docs.livekit.io/home/egress/overview/) and
writes a composite mp4 to S3. Enable it by setting the S3 variables plus
`NEXT_PUBLIC_SHOW_SETTINGS_MENU=true` and `NEXT_PUBLIC_LK_RECORD_ENDPOINT=/api/record`,
then use **Settings → Recording** inside a room. Note: encrypted (E2EE) rooms cannot be
recorded.

> ⚠️ **Security:** the bundled `/api/record/*` and `/api/connection-details` endpoints
> are **unauthenticated** — anyone who knows a room name can request a token or
> start/stop a recording. They exist for demo purposes. **Add authentication and
> authorization before deploying to production.**

## Room cinema

Use the **Кинотеатр** pill in the upper-left corner of a connected room. The current
host can choose one of three source modes:

- **Link, YouTube, or VK Video** synchronizes play, pause, seeking, and playback
  position over a reliable LiveKit data channel. Direct MP4/WebM/Ogg URLs use the
  browser player; HLS (`.m3u8`) uses `hls.js`; YouTube uses the IFrame API. VK accepts
  regular video and clip pages from `vk.ru`, `vk.com`, and `vkvideo.ru`, feed-layer
  links using `?z=`, and exported `video_ext.php` links with an access key.
- **Local file** stays on the host's device. The browser captures the local player and
  publishes its video and audio as LiveKit screen-share tracks, so there is no upload
  or file-size limit in the Next.js app.
- **Torrent** accepts a magnet link or `.torrent` file. It first asks the local
  [companion](./companion/README.md) to use regular BitTorrent peers. If the companion
  is absent or too old, it automatically falls back to browser WebTorrent peers. In
  both cases only the host downloads the torrent; viewers receive one LiveKit media
  stream and never join the swarm.

Only the participant who started a linked source receives playback commands,
fullscreen, picture-in-picture, and stop actions. Direct viewer video controls are
hidden, YouTube is requested with `controls=0`, and all viewer media and iframes reject
pointer and keyboard interaction. VK's cross-origin player chrome cannot be hidden
reliably and may remain visible, but an interaction shield makes it inert; synchronized
control packets are still accepted only from the recorded host. A viewer may still need
to click the dedicated playback overlay once because browsers block unmuted autoplay.
If the host leaves, viewers release the stale player after the heartbeat timeout.

Pasted VK URLs are never embedded verbatim. The client sends only a validated
`ownerId_videoId[_accessKey]` identity and rebuilds the official
`https://vk.ru/video_ext.php` URL; player events must match the exact iframe window,
origin, and expected message schema.

Direct sources must be playable by the browser, and HLS origins must allow cross-origin
fetches. YouTube and VK Video are most reliable in Chromium: this app's global COEP
header requires a `credentialless` iframe, which Firefox does not currently support.
A private VK video still requires a valid exported access key and permission to embed.
Browser WebTorrent can only reach WebRTC-capable peers and web seeds. Install and run
the companion when ordinary public magnet links must work. Torrent playback still
depends on the browser being able to decode the selected (largest) video file.

## Windows companion client

The home page and the room's always-visible top toolbar provide a **Download companion** button. It
redirects to a Windows EXE installer from the rolling `companion-latest` GitHub
release. The installer contains Node.js and all dependencies, installs without admin
rights, installs the official Microsoft Edge WebView2 Runtime when needed, creates
shortcuts, and can enable startup with Windows. A separate global Node.js installation
is not required.

The packaged PTT helper is built from this repository and checks only the configured
virtual key. It replaces the previous third-party global keyboard hook; it does not
capture typed text or observe unrelated keys.

The **LiveKit Companion** shortcut starts the bundled background service and opens the
complete voice-chat web app in a WinForms/WebView2 window. Its native toolbar provides
**Back**, **Home / Chat**, **Settings**, and **Reload**. Only the configured web-app
origin and the loopback Settings origin can navigate inside the window; other links
open in the system browser. Camera, microphone, and screen-capture permissions are
available only to the configured app origin. The injected
`window.__LIVEKIT_COMPANION__` marker lets the web UI hide its installer link.

When a regular browser reaches a managed `/rooms/<roomName>` or custom `/custom` route,
that route gates the LiveKit client before it can mount. Browser code probes only a
loopback Companion WebSocket and requires protocol v3 plus the `open-room` capability;
the landing page itself only navigates to the route. A running packaged Companion
validates the exact same-origin room URL and opens or reuses the native window with its
path, query parameters, and E2EE hash preserved.

Before the command is sent, an absent, stopped, old, or incompatible Companion leaves
the normal browser flow unchanged. After `open-room` is sent, the current tab fails
closed: an accepted request, explicit rejection, lost acknowledgement, or timeout all
leave it passive with the LiveKit room unmounted. This prevents a second participant and
duplicate audio even when native completion is uncertain. The old tab has no resume
button and never starts the room automatically. To use the browser instead, choose
**Exit** from the Companion tray icon (or otherwise stop its background service), then
reload the room link or open it in a new tab. Closing only the native window with X is not
enough because the still-running service will reopen it on the next handoff.

This presence check necessarily runs in the served page: a remote Next.js process cannot
inspect `127.0.0.1` on a user's PC. The installer enables background startup by default,
so the silent loopback check can also open a currently closed native window without a
custom-URL browser prompt.

Release builds open the managed origin embedded from `COMPANION_WEB_APP_URL`. In an
unmanaged development installation, use **Settings → Voice-chat server → Connect in
app**; the normalized HTTPS origin is saved locally and approved for both PTT and
torrent commands. HTTP is accepted only for loopback development. This value is the
Next.js web-app URL, not the LiveKit WebSocket URL or an API credential. If the client
URL is absent or fails to load, the native window falls back to localhost Settings.

On the first connection from the embedded client or a regular Chrome/Edge browser,
Windows may ask for local-network access before the companion shows its own origin
approval dialog. The selected app origin is trusted automatically; other decisions are
stored per user. `127.0.0.1:7331` always means the user's own PC, not the deployed
server. An exact `COMPANION_ORIGINS` allowlist remains authoritative for managed
installations and disables interactive origin changes.

Room handoff is additionally restricted to exact same-origin `/rooms/<one-segment>` and
`/custom` URLs. The full URL, including a possible custom JWT and E2EE hash, is never
placed in a process argument, file, or log: the Node service passes bounded JSON to the
single WebView2 window through a current-user-only Windows named pipe, and the native
client repeats the URL, route, and origin checks before navigating.

The LiveKit tray icon reopens the client or exits the service. Autostart launches the
service and tray without forcing the client window to the foreground. Remove the app
with **Uninstall LiveKit Companion** or **Windows Settings → Apps → Installed apps**.
The Windows release job installs the final EXE and smoke-tests WebView2, camera and
microphone access, WebRTC, `captureStream()`, the native marker, companion capabilities,
an exact same-window room handoff (including query and hash), startup, and uninstallation
before publishing an installer.

## Deployment

The repo includes a manual GitHub Action
(`.github/workflows/sync-to-production.yaml`, `workflow_dispatch`) that syncs `main`
to a `sandbox-production` branch using the LiveKit sandbox deploy action. The app is a
standard Next.js project and can also be deployed to any Next.js-compatible host
(e.g. Vercel) with the environment variables above configured.

## License

[Apache-2.0](./LICENSE)
