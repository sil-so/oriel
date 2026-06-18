# Privacy

Oriel is a local-first macOS time tracker. Its default behavior is to keep
activity history, projects, time entries, settings, and archives on the user's
Mac.

This document describes the repository's intended privacy model for the public
source release.

## Data Oriel Records

Oriel can record local activity data needed for time tracking:

- Foreground app name.
- Window or document title.
- Document or browser URL when available.
- App bundle identifier and app path.
- Activity start and end times.
- Hands-on or hands-off interaction state based on recent keyboard, mouse,
  click, or scroll input.
- Projects, categories, billable state, manual time entries, assignment rules,
  capture exclusions, settings, and backup/restore archives.

Oriel does not intentionally record keystroke contents, passwords, clipboard
contents, file contents, microphone input, camera input, or screen recordings.

## Local Storage

Native app data is stored locally by default:

- Activity database: `~/Library/Application Support/Oriel/Oriel.sqlite`
- Native app caches: `~/Library/Caches/Oriel/`
- API keys: macOS Keychain

The repository ignores runtime data, local SQLite files, logs, screenshots,
archives, signing files, packaged builds, and credentials because those files
can contain private activity or machine-specific information.

## Network Access

Oriel has no intended analytics or telemetry service in the public source
release.

Network access is limited to explicit user-enabled features:

- **Logo.dev icons:** disabled by default. When enabled and configured with a
  Logo.dev publishable key, Oriel may send website domains to Logo.dev to fetch
  brand icons. Raw local activity history is not sent for this feature.
- **Ask AI:** disabled until the user configures a provider API key. When used,
  Oriel sends the prompt and selected-day context, including project names,
  categories, and optional project context, to the chosen provider. API keys are
  stored in Keychain.
- **AI screenshot summaries:** disabled by default. When enabled, Oriel may
  capture a foreground activity screenshot, downscale and JPEG-compress it in
  memory, and send it with activity metadata to the selected provider. Oriel
  does not store the screenshot or raw provider response. It stores only the
  validated summary JSON, provider/model name, status, sanitized error text,
  dimensions, compressed byte count, and request metadata needed for later
  local summaries.
- **AI daily insights:** generated manually by the user. Oriel sends clustered
  validated screenshot-summary text, sanitized selected-day activity context,
  recent daily-summary opening sentences, and local aggregate timing statistics
  to the configured Ask AI provider. Oriel does not send raw screenshots, raw
  images, full URL lists, app paths, or bundle paths for daily recap generation.
- **AI model refresh:** when requested by the user, Oriel contacts the selected
  provider to list available models.

Provider requests are made only for the selected feature and provider. Review
the provider's own privacy and data-use terms before enabling these features.

## Browser Companion

The optional Chrome/Brave Browser Companion uses Native Messaging to send tab
activity to Oriel so browser work can be included in local time tracking.

The Browser Companion is optional and currently intended for developer setup
with an unpacked extension. Browser data received through Native Messaging is
stored in the local Oriel database with the rest of the activity history.

## Exclusions And Deletion

Users can configure capture exclusions for apps, titles, and URLs. Exclusions
are intended to prevent matching future activity from being persisted and can
be used to prune matching historical activity where the app exposes that flow.

Local data can also be removed by deleting the Oriel database and caches from
the paths listed above. Backup archives should be treated as private because
they can contain activity history, projects, settings, time entries, and
validated AI screenshot summaries and generated AI daily insights. Archives do
not include API keys or raw screenshots.

## Development And Contributions

Do not include real activity history, full browser URLs, private local paths,
credentials, screenshots with private data, or personal project/client names in
issues, PRs, tests, fixtures, or documentation.

For changes touching capture, storage, exports, Keychain, Native Messaging,
AI, Logo.dev, screenshots, logs, or deletion paths, describe the privacy and
security impact in the pull request.
