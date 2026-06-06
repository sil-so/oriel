# Oriel

Oriel is a privacy-first macOS time tracker. It records foreground app and
browser activity locally, then helps turn that activity into project time
entries without sending raw activity history to a hosted service.

The public source release is focused on the native macOS app path: a SwiftPM
`Oriel.app` shell with a bundled web interface, local SQLite storage, native
activity capture, optional Browser Companion support, and local backup/restore.

## Features

- Native macOS foreground app, window title, and document URL capture.
- Hands-on / hands-off activity states based on recent keyboard, mouse, click,
  or scroll input.
- Activity Stream Timeline and week views for reviewing recorded activity,
  Activity Mix, and logged entries.
- Project, task, billing, reporting, capture-exclusion, and auto-assignment
  workflows.
- Optional Chrome/Brave Browser Companion using Native Messaging.
- Optional BYOK AI and Logo.dev icon lookups, with keys stored in macOS
  Keychain.
- Portable local archive export and restore.

## Privacy Model

Oriel is local-first. Activity history, projects, time entries, settings, and
backup archives stay on the user's Mac by default.

- Native app data: `~/Library/Application Support/Oriel/Oriel.sqlite`
- Native app caches: `~/Library/Caches/Oriel/`
- API keys: macOS Keychain
- Runtime data, build output, screenshots, logs, archives, local SQLite files,
  and credentials are ignored by git.

Logo.dev and AI provider calls are opt-in. Enabling branded website icons sends
website domains to Logo.dev. Using Ask AI sends selected-day context to the
configured provider.

See [PRIVACY.md](./PRIVACY.md) for the detailed data-handling model.

## Requirements

- macOS 14 or newer
- Xcode command line tools / Swift toolchain
- Node.js 18 or newer for frontend asset generation and Node-based tests

Oriel uses Accessibility permissions for detailed app/window capture. Grant
permission to the exact `Oriel.app` build you run.

## Quick Start

```bash
npm install
npm run build:assets
swift test
npm test
./script/build_and_run.sh
```

`./script/build_and_run.sh` builds `OrielApp` and `OrielBrowserBridge`, stages a
signed local `build/Oriel.app`, stops stale local Oriel app/helper processes,
and opens the rebuilt app. Use `./script/build_and_run.sh --verify` to build
and stage without launching.

## Browser Companion

The Browser Companion is currently a developer setup for unpacked Chrome/Brave
extension testing.

1. Open `chrome://extensions` in Chrome or Brave.
2. Enable Developer mode.
3. Load the `extension/` directory as an unpacked extension.
4. Copy the extension identifier.
5. In Oriel Preferences, open Developer Browser Companion and enable the
   identifier.

A future public release should use a Chrome Web Store extension with a finalized
extension identifier.

## Project Layout

```text
Sources/OrielApp/          Native app host, bridge, capture, services, SQLite
Sources/OrielBrowserBridge Native Messaging helper
Tests/OrielAppTests/       Swift tests for native services and persistence
assets/brand/              App-used brand assets
assets/vendor/             Vendored UI font/icon assets
css/                       Frontend styles
extension/                 Optional Browser Companion source
js/                        Bundled frontend application code
script/                    Build and asset helper scripts
test/                      Node test suite
```

The native app is the supported path. The Node HTTP runtime remains in the tree
as a local development fallback for the bundled web UI and compatibility tests;
it is loopback-only and is not a production service boundary.

## Tests

```bash
npm test
swift test
./script/build_and_run.sh
```

Run `npm run build:assets` after changing Tailwind input, vendored frontend
asset generation, or package dependencies.

## Roadmap

- Replace remaining transitional Node fallback paths with native-only flows.
- Publish the Browser Companion through the Chrome Web Store.
- Add mature signed/notarized macOS distribution.
- Add public CI and code scanning.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, verification, and
public contribution expectations.

## Security

Please report vulnerabilities privately. See [SECURITY.md](./SECURITY.md).

## License

Oriel is available under the [MIT License](./LICENSE).
