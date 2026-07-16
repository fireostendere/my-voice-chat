# Architecture

This document describes how the app is put together: the routes, the realtime
connection lifecycle, and the supporting features (E2EE, recording, performance
optimization, regions). It is a fork of [LiveKit Meet](https://github.com/livekit/meet);
the structure below reflects this repository's code.

## High-level overview

The app is a **Next.js 15 (App Router)** front end. It does not own any media
infrastructure — all audio/video routing is done by a **LiveKit server** (LiveKit
Cloud or self-hosted). The Next.js server side is intentionally tiny: four Route
Handlers that mint a participant access token, start/stop recording, and redirect to
the companion installer. Everything else is the same web client running in a regular
browser or the Windows Companion's WebView2 and talking WebRTC directly to LiveKit.

```
                          ┌──────────────────────────────────────────┐
                          │       Browser or Companion WebView2       │
                          │                                           │
  app/page.tsx  ────────► │  PageClientImpl / VideoConferenceClient   │
  (tabbed launcher)       │     • livekit-client Room                 │
                          │     • <VideoConference/> prefab UI        │
                          │     • E2EE worker, perf optimizer         │
                          └───────┬─────────────────────────┬─────────┘
                                  │ 1. fetch token          │ 3. WebRTC (media + data)
                                  ▼                         ▼
        ┌─────────────────────────────────┐     ┌──────────────────────────┐
        │  Next.js Route Handlers (server) │     │     LiveKit server        │
        │  • /api/connection-details       │     │  (Cloud or self-hosted)   │
        │  • /api/record/start|stop        │ ──► │  • SFU / rooms            │
        │  • /api/companion/download       │     │  • Egress → S3            │
        │  (recording uses server SDK)     │  2. │                          │
        └─────────────────────────────────┘ Egress└──────────────────────────┘
```

1. The client asks the Next.js server for connection details (server URL + JWT).
2. For recording, the client calls the record endpoints, which use the
   `livekit-server-sdk` `EgressClient` to start/stop a Room Composite Egress.
3. The client connects to the LiveKit server over WebRTC and exchanges media.

## Routes

| Path                                       | Type   | Responsibility                                                                                                                                             |
| ------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/page.tsx`                             | client | Landing page. Tabbed launcher: **Demo** (generates a random room id, optional E2EE) and **Custom** (paste a server URL + token). Routes to the room pages. |
| `app/rooms/[roomName]/page.tsx`            | server | Parses `region`/`hq`/`codec`/`singlePC` search params, then renders `PageClientImpl`.                                                                      |
| `app/rooms/[roomName]/PageClientImpl.tsx`  | client | The **managed** flow: shows `<PreJoin/>`, fetches a token from `connection-details`, builds the `Room`, and renders the conference.                        |
| `app/custom/page.tsx`                      | server | Validates `liveKitUrl`/`token`/`codec` from the URL, then renders `VideoConferenceClientImpl`.                                                             |
| `app/custom/VideoConferenceClientImpl.tsx` | client | The **bring-your-own-token** flow: builds the `Room` directly from URL-provided credentials. No PreJoin, no token fetch.                                   |
| `app/api/connection-details/route.ts`      | server | `GET` → mints a short-lived participant JWT for `{roomName, participantName}`, optionally region-routed.                                                   |
| `app/api/record/start/route.ts`            | server | `GET` → starts a Room Composite Egress to S3 (speaker layout, mp4).                                                                                        |
| `app/api/record/stop/route.ts`             | server | `GET` → stops all active egresses for the room.                                                                                                            |
| `app/api/companion/download/route.ts`      | server | `GET` → redirects to the Windows companion EXE release or a configured HTTPS mirror.                                                                       |

## `lib/` modules

| File                        | Role                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                  | `ConnectionDetails` shape + `isVideoCodec` guard.                                                                                                                          |
| `client-utils.ts`           | `randomString`, `generateRoomId`, passphrase encode/decode, `isLowPowerDevice` (uses `navigator.hardwareConcurrency < 6`).                                                 |
| `getLiveKitURL.ts`          | Rewrites a `*.livekit.cloud` host to a region-pinned host by inserting `<region>` plus the `production`/`staging` environment segment. Covered by `getLiveKitURL.test.ts`. |
| `useSetupE2EE.ts`           | Reads the passphrase from `location.hash` and spins up the `livekit-client/e2ee-worker` Web Worker.                                                                        |
| `usePerfomanceOptimiser.ts` | `useLowCPUOptimizer` — listens for `LocalTrackCpuConstrained` and degrades publisher/subscriber video quality.                                                             |
| `SettingsMenu.tsx`          | In-room settings drawer (Media / Recording tabs). Gated by `NEXT_PUBLIC_SHOW_SETTINGS_MENU`.                                                                               |
| `CustomVideoConference.tsx` | Conference layout with participant volume controls, custom chat, and the watch-together cinema stage.                                                                      |
| `watchTogether/**`          | Cinema source picker, synchronized URL/HLS/YouTube/VK players, and host-side local-file/torrent publication through LiveKit screen-share tracks.                           |
| `CameraSettings.tsx`        | Camera device + background effects (blur / virtual background via `@livekit/track-processors`).                                                                            |
| `MicrophoneSettings.tsx`    | Mic device + Krisp enhanced noise cancellation (auto-on for non-low-power devices).                                                                                        |
| `RecordingIndicator.tsx`    | Red inset border + toast while the room is being recorded.                                                                                                                 |
| `KeyboardShortcuts.tsx`     | Cmd/Ctrl-Shift-A (mic), Cmd/Ctrl-Shift-V (camera).                                                                                                                         |
| `Debug.tsx`                 | `Shift+D` debug overlay (tracks, bitrates, permissions, scenario simulation) + optional Datadog log forwarding. Exposes `window.__lk_room`.                                |

## Connection lifecycle (managed flow)

`PageClientImpl` is the reference implementation. The custom flow is a simplified
version of the same steps.

```
PreJoin (username, mic/cam choices)
   │  onSubmit
   ▼
GET /api/connection-details?roomName=&participantName=[&region=]
   │  → { serverUrl, participantToken, ... }
   ▼
build RoomOptions (codec, simulcast layers, e2ee, singlePeerConnection)
   │
   ▼
new Room(roomOptions)            ← memoized once
   │
   ├─ if E2EE: keyProvider.setKey(passphrase) → room.setE2EEEnabled(true)
   │
   ▼
room.connect(serverUrl, token)   ← after E2EE setup completes
   │
   ├─ setCameraEnabled / setMicrophoneEnabled per PreJoin choices
   ├─ useLowCPUOptimizer(room)   ← degrade quality under CPU pressure
   └─ RoomEvent.Disconnected → router.push('/')
   ▼
<RoomContext.Provider value={room}>
   <VideoConference/>  +  KeyboardShortcuts, DebugMode, RecordingIndicator, (SettingsMenu)
```

Key `RoomOptions` decisions (`PageClientImpl.tsx`):

- **Codec**: defaults to `vp9`; under E2EE, `vp9`/`av1` are dropped (SVC codecs are
  incompatible with the encryption path) so LiveKit falls back to a supported codec.
- **Capture / simulcast**: `hq` → 2160p capture with 1080p+720p layers; otherwise
  720p capture with 540p+216p layers.
- **`red`** (audio redundancy) is enabled only when E2EE is off.
- **`adaptiveStream`** and **`dynacast`** are always on.
- **`singlePeerConnection`** comes from the `singlePC` URL param (managed: default on,
  custom: default off).

## End-to-end encryption (E2EE)

- The passphrase travels in the **URL hash** (`#<passphrase>`), so it is never sent to
  the Next.js server (hashes are client-only).
- `useSetupE2EE` derives the passphrase and instantiates the
  `livekit-client/e2ee-worker` Web Worker. An `ExternalE2EEKeyProvider` feeds the key
  into the worker; `room.setE2EEEnabled(true)` activates insertable-streams encryption.
- This requires cross-origin isolation, which is why `next.config.js` sets
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`.
- Unsupported browsers raise `DeviceUnsupportedError`, surfaced to the user via an alert.
- **Encrypted rooms cannot be recorded** (Egress cannot decrypt the media).

## Recording (Egress)

- Driven entirely from the in-room **Settings → Recording** tab (requires
  `NEXT_PUBLIC_SHOW_SETTINGS_MENU` + `NEXT_PUBLIC_LK_RECORD_ENDPOINT`).
- `start` creates a `RoomCompositeEgress` with `speaker` layout, writing an mp4
  (`<iso-timestamp>-<roomName>.mp4`) to the configured S3 bucket. It first checks
  `listEgress` to avoid double-recording (returns `409` if already active).
- `stop` lists active egresses (`status < 2`) and stops them all.
- `useIsRecording()` drives the `RecordingIndicator` and the settings toggle state.
- **Security**: both endpoints are unauthenticated — see the `CAUTION` comment in each
  handler. Add auth before any non-demo use.

## Token issuance & regions

- `connection-details` builds an `AccessToken` (livekit-server-sdk) with grants
  `roomJoin / canPublish / canPublishData / canSubscribe`, `ttl = 5m`.
- Participant identity is `"<name>__<4-char-postfix>"`. The postfix is stored in a
  `random-participant-postfix` cookie so a returning user keeps a stable identity.
- If a `region` is supplied, `getLiveKitURL` rewrites the LiveKit Cloud host to route
  to that region (only for `*.livekit.cloud` hosts; other hosts pass through unchanged).

## Performance optimization

`useLowCPUOptimizer` (`usePerfomanceOptimiser.ts`) reacts to the
`ParticipantEvent.LocalTrackCpuConstrained` event:

- Calls `track.prioritizePerformance()` on the local publisher.
- Drops every **remote** subscription to `VideoQuality.LOW`, and keeps newly
  subscribed tracks low while in low-power mode.
- Optionally stops local video processors (off by default).

`isLowPowerDevice()` (`< 6` logical cores) also drives defaults elsewhere — e.g. Krisp
noise-filter quality and whether it auto-enables.

## Watch-together cinema

`CustomVideoConference` always mounts `WatchTogetherProvider` and a visible
`CinemaPanel`. A participant can start a direct media URL, a YouTube URL, a VK Video
URL, a local video file, or a torrent. Starting linked media moves the conference into
focus layout with the player as the main stage and participant tracks in the carousel.

### Linked media synchronization

- `parseVideoUrl` normalizes URLs and extracts video IDs from YouTube watch, short,
  embed, live, `youtu.be`, and privacy-enhanced embed links. VK parsing accepts exact
  `vk.com`, `vk.ru`, and `vkvideo.ru` hosts, normal video/clip paths, layer links using
  `?z=`, and exported `video_ext.php` links. Only the normalized owner/video/access-key
  tuple is sent over LiveKit; the original URL is never embedded.
- Progressive sources use the native `<video>` element. HLS playlists use native HLS
  where available and `hls.js` elsewhere, with recovery for fatal network and media
  errors.
- YouTube uses the IFrame API. The iframe is created manually with `credentialless`
  because the app is cross-origin isolated for E2EE.
- VK uses the documented [VK Video widget API](https://dev.vk.com/ru/widgets/video)
  (`video_ext.php?js_api=1`) through a local, schema-validating adapter. It rebuilds an
  HTTPS `vk.ru` embed URL and requires both the expected iframe window and exact VK
  origin for every incoming player event.
- The host sends `start-embed`, `play`, `pause`, `seek`, and a 2.5-second heartbeat on
  the reliable `watch-together` LiveKit data topic. Viewers re-seek only after drift
  exceeds 600 ms.
- Incoming packets are schema-validated. Control and stop packets are accepted only
  from the identity recorded as the current host. Only that host can replace an active
  linked source.
- Heartbeats let late joiners discover the active source. Three missed heartbeats plus
  slack clear the player after an ungraceful host disconnect.
- Browsers commonly reject unmuted autoplay. All linked players expose a synchronized
  click-to-play fallback for affected viewers.

### Local files

Local files are never uploaded to Next.js. `StreamHostController` creates an object URL,
plays the file in a host-only `<video>`, captures it with `captureStream()`, wraps the
result in LiveKit local video/audio tracks, and publishes them as screen-share sources.
The regular screen-share focus and subscription path then delivers the media to viewers.
Stopping the source unpublishes both tracks, stops them, and revokes the object URL.

### Torrents

Torrent playback uses the same host-only `<video>` and `captureStream()` publication
path as local files. `torrentSource.ts` first opens the configured localhost companion
WebSocket and waits for its `torrent` capability. The companion's Node WebTorrent
client can use regular TCP/UDP BitTorrent peers, stores pieces in an OS temporary
directory, and exposes the selected largest video through a tokenized localhost HTTP
range stream. Closing the source or its WebSocket destroys the client and deletes the
temporary directory.

`CompanionRoomBridge` waits for LiveKit's `Connected` event, then keeps a separate
localhost WebSocket open while a room is active and registers the room name and local
participant identity. The companion control UI
lists those registrations and sends a validated `torrent-open` command to the selected
room. The bridge converts the serialized `.torrent` bytes back to `TorrentInput` and
starts the existing host pipeline; it does not create a second torrent engine. While
that pipeline is active, the bridge reports title, phase, position, duration, and seek
support back to the companion. Validated `playback-control` commands let the control
panel play, pause, seek, or stop the host browser's actual `<video>` element.

If no capable companion answers within the detection timeout, the browser dynamically
loads the WebTorrent browser bundle and its service worker. This fallback never talks
to Next.js but can only discover WebRTC-compatible WebTorrent peers and web seeds. In
both modes viewers do not join the swarm: LiveKit receives and forwards only the
captured encoded media tracks.

The home page and the room's always-visible top toolbar link to
`/api/companion/download`. The route
redirects to `LiveKitCompanionSetup.exe` in a rolling GitHub Release, so the Next.js
server does not build or store binaries. A Windows GitHub Actions job packages Node.js,
the companion, its dependencies, shortcuts, and autostart support with Inno Setup. The
same job builds the user-facing `LiveKitCompanion.exe` launcher and the internal
`LiveKitCompanionNative.exe` key/tray helper from repository C# source. The launcher is
a self-contained WinForms application with WebView2; the small internal helper uses
.NET Native AOT. A generated multi-resolution LiveKit ICO is embedded in both binaries
and the installer.

The companion also serves a token-protected settings UI on `127.0.0.1:7333`. It accepts
magnet links and `.torrent` files for active rooms, exposes remote playback controls,
captures and immediately persists the PTT key, and manages approved voice-chat origins.
The read-only `GET /api/client-config` endpoint is intentionally public only on this
loopback server so the native launcher can discover its destination; every mutation
still requires the in-memory UI token and exact localhost `Origin`.
Desktop, Start-menu, post-install, and autostart entries all target
`LiveKitCompanion.exe`; the launcher starts the bundled Node process directly and hosts
the configured voice-chat web app in its own WebView2 window. A small native toolbar
switches between Chat and the localhost Settings page while keeping all other origins
in the system browser. The taskbar owner and icon are therefore the Companion rather
than the default browser. No CMD or VBS launcher is installed. The installer bootstraps
the official WebView2 Runtime only when it is absent. The internal helper owns the
LiveKit tray icon and can request an orderly Node shutdown.

Remote client addresses must use HTTPS; HTTP is accepted only for loopback development.
If no client URL is configured, or the configured page cannot load, the launcher falls
back to localhost Settings. WebView2 top-level navigation is restricted to the exact
configured app origin and the Settings origin. Media permissions and screen capture are
denied outside the app origin. A frozen versioned marker,
`window.__LIVEKIT_COMPANION__ = { host: 'webview2', platform: 'windows', version: 1 }`,
lets the web UI hide its installer link without granting the remote page access to the
localhost Settings token.

The release workflow embeds `vars.COMPANION_WEB_APP_URL` as the managed client address,
falling back to `https://api.iroslyakov.com/`. A runtime `COMPANION_WEB_APP_URL` takes
precedence for managed installations and CI. The Windows smoke test installs the final
EXE, starts a cross-origin-isolated loopback fixture, and opens that fixture in the real
WebView2 control with fake camera and microphone devices. Success requires secure
context and cross-origin isolation, `getUserMedia`, WebRTC, media `captureStream()`, the
native host marker, and a `ptt` + `torrent` capability handshake with the bundled Node
service.

The PTT helper polls only the configured Windows virtual key. It replaces the previous
third-party global keyboard hook and does not enumerate other keys or collect typed
characters. The Node process converts only `DOWN`/`UP` transitions into PTT WebSocket
messages. The same helper displays the Windows origin-approval dialog without invoking
PowerShell or evaluating a generated script. Startup failures produce a visible native
dialog with the diagnostic-log path. The release workflow smoke-tests the native EXE
entry point, background startup, settings UI, full WebView2 client, PID creation, and
uninstallation on Windows before publishing the installer.

The selected or managed web-app origin is trusted automatically. Other remote browser
origins require one-time approval in a native Windows dialog; approved origins are
persisted per user and receive both PTT and torrent capabilities. The same persisted
allowlist can be managed explicitly from localhost Settings. An explicit
`COMPANION_ORIGINS` environment allowlist remains authoritative for managed
installations and disables origin mutation.

This requires a browser with `HTMLMediaElement.captureStream()` and a file codec that
the browser can decode. Direct/HLS sources must also satisfy the remote origin's CORS
and media-access policy. YouTube and VK modes are effectively Chromium-only while
Firefox lacks credentialless iframe support under COEP.

## Build & tooling

- **Next.js** `15.5.16`, **React** `18.3.1`, App Router, `reactStrictMode: false`,
  `productionBrowserSourceMaps: true`, `source-map-loader` for `.mjs`.
- **TypeScript** strict, `moduleResolution: Bundler`, path alias `@/* → ./*`.
- **ESLint** `next/core-web-vitals`; **Prettier** (LF, single quotes, width 100).
- **Vitest** for unit tests.
- **Renovate** keeps dependencies current; LiveKit packages are grouped and automerged.
- **CI** (`.github/workflows/test.yaml`): lint + format check + tests on push/PR.
- **Companion release** (`.github/workflows/companion-release.yaml`): builds the Windows
  EXE on companion changes and updates the `companion-latest` GitHub Release from `main`.
- **Deploy** (`.github/workflows/sync-to-production.yaml`): manual `workflow_dispatch`
  syncs `main` to a `sandbox-production` branch via the LiveKit sandbox deploy action.
