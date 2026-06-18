# Architecture

Oriel is a native macOS app with a bundled web interface and local-first
persistence.

```text
Oriel.app
  -> WKWebView bundled UI
  -> OrielBridge native request/reply boundary
  -> SQLiteStore at ~/Library/Application Support/Oriel/Oriel.sqlite
```

## Native App

`Sources/OrielApp` owns the desktop shell, menu-bar status item, onboarding,
Preferences window, WebKit host, native bridge, activity capture, AI provider
proxying, icon handling, and SQLite persistence.

Foreground activity capture is implemented in-process with AppKit,
Accessibility APIs, workspace notifications, and input-idle checks. Captured
activity is split into hands-on and hands-off states and persisted locally.

`Sources/OrielBrowserBridge` contains the Native Messaging helper used by the
optional browser extension. The helper validates browser events and passes them
to the running native app without exposing a network service.

## Frontend

The user interface is a bundled local web app loaded by the native shell. The
frontend is split across `web/index.html`, `web/css/`, and `web/js/` modules. Runtime UI
dependencies are vendored under `web/assets/vendor/` so normal app use does not rely
on CDN assets.

The data boundary is `web/js/data-client.js`: under `Oriel.app` it uses the native
WebKit bridge; in the local development fallback it can use the loopback HTTP
API exposed by `tools/dev-server/server.js`.

## Persistence And Privacy

The supported app path stores user data in SQLite under Application Support.
API keys are stored in macOS Keychain. Local caches live under the user's cache
directory. Runtime data, generated artifacts, logs, archives, local SQLite
files, screenshots, and credentials are ignored by git.

Logo.dev icon lookup and AI provider calls are opt-in features. The app keeps
raw local paths and URLs out of AI context where possible and does not implement
analytics or a hosted database.

## Development Fallback

`tools/dev-server/server.js` remains as a local development fallback for the web UI and Node test
coverage. It binds to loopback by default, supports isolated runtime directories
for tests, and should not be deployed as a public network service.

## Build

`tools/scripts/build_frontend_assets.mjs` regenerates vendored frontend CSS/font/icon
assets.

`tools/scripts/build_and_run.sh` builds the SwiftPM products, stages a local
`build/Oriel.app`, signs it for local execution, stops stale Oriel processes,
and launches the rebuilt app unless `--verify` is used.

`tools/scripts/extract_icon.swift` is compiled by the local development fallback when
native app icon extraction is needed.
