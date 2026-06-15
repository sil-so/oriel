# Oriel

[![CI](https://github.com/sil-so/oriel/actions/workflows/ci.yml/badge.svg)](https://github.com/sil-so/oriel/actions/workflows/ci.yml)
![macOS 14+](https://img.shields.io/badge/macOS-14%2B-2f3338)
![Local-first](https://img.shields.io/badge/local--first-by%20default-2f3338)
[![MIT License](https://img.shields.io/badge/license-MIT-2f3338)](./LICENSE)

Oriel is a local-first macOS time tracker for people who need accurate project
time without sending their activity history to a hosted service.

It records foreground app and browser activity on your Mac, shows the day as a
reviewable Activity Stream Timeline, and helps turn raw activity into project,
task, billable, and reporting entries.

> [!NOTE]
> Oriel is source-build today. Signed and notarized public macOS releases are
> planned, but not available yet.

![Oriel Activity Stream and time entries](./docs/readme/oriel-overview.png)

_README images use fake demo data and public example activity._

## Why Oriel

Most time trackers make you choose between manual timers you forget to start and
hosted activity systems that collect more context than you want to share. Oriel
keeps the working record on your Mac, then gives you a dense review surface for
turning that record into useful project time.

Oriel is built for freelancers, consultants, builders, and independent operators
who need to understand where time went, correct it quickly, and keep private
work context private by default.

## What Oriel Does

- Records foreground app, window title, document URL, browser tab, and activity
  time into a local SQLite database.
- Separates hands-on and hands-off activity with keyboard, mouse, click, and
  scroll input so passive reading does not look the same as active work.
- Shows the Activity Stream Timeline, Activity Mix, day view, week view, and
  project summaries for fast review.
- Converts activity into project time entries with tasks, billable defaults,
  hourly/fixed-rate project settings, and reporting.
- Supports auto-assignment rules for app, title, and URL patterns.
- Supports capture exclusions for sensitive apps, titles, or URLs, including
  one-time historical cleanup.
- Exports and restores portable local archives.
- Offers optional BYOK AI workflows for selected-day chat, entry suggestions,
  screenshot summaries, and daily insights.

## A Closer Look

### Review A Day

The day view keeps recorded activity, logged time entries, and project totals in
one place. You can compare what Oriel saw with what you want to bill or report.

![Oriel day review](./docs/readme/oriel-overview.png)

### Scan The Week

The week view shows project time across days, making it easier to spot gaps,
overlaps, and patterns before reporting or invoicing.

![Oriel week view](./docs/readme/oriel-week.png)

### Manage Projects And Billing

Projects carry identity colors, billing defaults, tasks, rates, and historical
entries. Oriel can mix manual time, reviewed activity, and imported history in
the same project record.

![Oriel project details](./docs/readme/oriel-projects.png)

### Keep Sensitive Activity Out

Capture exclusions let you stop recording matching app, title, or URL activity.
When needed, existing local history can be cleaned once after adding a rule.

![Oriel capture and privacy settings](./docs/readme/oriel-privacy-settings.png)

## Privacy Model

> [!IMPORTANT]
> Oriel is local-first by default. Activity history, projects, time entries,
> settings, and archives stay on the user's Mac unless the user enables an
> optional network feature.

| Feature | Default | What can leave the Mac |
| --- | --- | --- |
| Core activity tracking | On after running the app | Nothing by design |
| Logo.dev icons | Off | Website domains, only when enabled |
| Ask AI | Off until a provider key is configured | Selected-day context when the user asks |
| AI screenshot summaries | Off | Compressed screenshots and activity metadata when enabled |
| AI daily insights | Manual | Clustered text summaries and local time statistics when generated |
| AI model refresh | Manual | Provider model-list request when requested |

Oriel stores API keys in macOS Keychain. It does not store raw screenshots or
raw AI provider responses. The public source release does not include analytics
or telemetry.

See [PRIVACY.md](./PRIVACY.md) for the detailed data-handling model.

<details>
<summary>Optional network features</summary>

Oriel's networked features are opt-in and provider-specific:

- **Logo.dev icons:** sends website domains to Logo.dev when branded website
  icons are enabled and a publishable key is saved.
- **Ask AI:** sends the prompt and selected-day context to the configured AI
  provider when the user submits a question.
- **AI screenshot summaries:** captures, downscales, and JPEG-compresses a
  screenshot in memory, then sends it with activity metadata to the selected
  provider. Oriel stores only validated summary JSON and request metadata needed
  for local summaries.
- **AI daily insights:** sends clustered validated screenshot-summary text,
  sanitized activity context, recent summary opening sentences, and local
  aggregate timing statistics to the configured Ask AI provider when the user
  generates a daily recap. Raw screenshots, full URLs, app paths, and bundle
  paths are not sent for daily recap generation.
- **AI model refresh:** contacts the selected provider only when the user asks
  Oriel to refresh available models.

Review each provider's own privacy and data-use terms before enabling these
features.

</details>

## Status

| Area | Current state |
| --- | --- |
| Supported app path | SwiftPM-built `Oriel.app` |
| Platform | macOS 14+ |
| Storage | Local SQLite at `~/Library/Application Support/Oriel/Oriel.sqlite` |
| Browser support | Optional Chrome/Brave Browser Companion via Native Messaging |
| Hosted service | None |
| CI | GitHub Actions for Node and Swift tests |
| License | MIT |

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
local `build/Oriel.app`, signs it for local execution, stops stale local
app/helper processes, and opens the rebuilt app.

Use `./script/build_and_run.sh --verify` to build and stage without launching.

<details>
<summary>Browser Companion developer setup</summary>

The Browser Companion is currently a developer setup for unpacked Chrome/Brave
extension testing.

1. Open `chrome://extensions` in Chrome or Brave.
2. Enable Developer mode.
3. Load the `extension/` directory as an unpacked extension.
4. Copy the extension identifier.
5. In Oriel Preferences, open Developer Browser Companion and enable the
   identifier.

A Chrome Web Store extension with a finalized identifier is planned.

</details>

## Project Structure

Oriel is a native macOS app with a bundled local web interface.

```mermaid
flowchart TD
    App["Oriel.app"]
    WebView["WKWebView bundled UI"]
    Bridge["OrielBridge native request/reply boundary"]
    Store["SQLiteStore<br/>~/Library/Application Support/Oriel/Oriel.sqlite"]
    Browser["Optional Browser Companion<br/>Chrome / Brave Native Messaging"]
    Providers["Optional network providers<br/>BYOK AI / Logo.dev"]

    App --> WebView
    App --> Bridge
    Bridge --> Store
    Browser --> Bridge
    Bridge -. opt-in .-> Providers
```

| Path | Responsibility |
| --- | --- |
| `Sources/OrielApp` | App shell, WebKit host, bridge, capture, preferences, Keychain, AI, icons, SQLite persistence |
| `Sources/OrielBrowserBridge` | Native Messaging helper for the optional browser extension |
| `index.html`, `css/`, `js/` | Bundled frontend UI |
| `assets/vendor/` | Vendored UI font/icon assets, so normal app use does not rely on CDNs |
| `server.js` | Loopback-only development fallback, not a production service boundary |
| `Tests/OrielAppTests/` | Swift tests for native services and persistence |
| `test/` | Node test suite for frontend, bridge, safety, and compatibility behavior |

The root contains both the supported native app path and transitional
development fallback modules. Keep structural refactors separate from product
or documentation changes so behavior stays easy to review.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for more detail.

## Verification

For most changes, run:

```bash
git diff --check
npm test
swift test
```

Run `npm run build:assets` after changing Tailwind input, vendored frontend
assets, or package dependencies.

Run `./script/build_and_run.sh` after app changes when you need to verify the
running local app matches the source.

## Maintainer Surface

Oriel records local activity data, so privacy and security review are part of
normal maintenance.

| Area | Current coverage |
| --- | --- |
| Public CI | Node and Swift tests on GitHub Actions |
| Contribution flow | [CONTRIBUTING.md](./CONTRIBUTING.md), issue templates, PR template |
| Privacy model | [PRIVACY.md](./PRIVACY.md), `.gitignore` protections for runtime/private artifacts |
| Security reporting | [SECURITY.md](./SECURITY.md) |
| High-risk code paths | Capture, exclusions, SQLite storage, portable archives, Keychain, Native Messaging, AI, Logo.dev, screenshots, packaging |

Do not include real activity history, full browser URLs, screenshots with
private data, credentials, local SQLite files, logs, archives, signing material,
or private local paths in issues, PRs, tests, fixtures, or documentation.

## Roadmap

- Replace remaining transitional Node fallback paths with native-only flows.
- Publish the Browser Companion through the Chrome Web Store.
- Add signed/notarized macOS distribution.
- Expand public CI and code scanning.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, verification, and
public contribution expectations.

## Security

Please report vulnerabilities privately. See [SECURITY.md](./SECURITY.md).

## License

Oriel is available under the [MIT License](./LICENSE).
