# AGENTS.md

## Project Guidance

Oriel is a local-first macOS time tracker. Keep changes simple,
maintainable, and easy to review.

## Build And Test

- Run `npm test` for frontend, bridge, and Node compatibility tests.
- Run `swift test` for native services and persistence tests.
- Run `npm run build:assets` after changing Tailwind input, vendored
  frontend assets, or package dependencies.
- Run `./script/build_and_run.sh --verify` after native app packaging or
  launch-path changes.
- Run `./script/build_and_run.sh` when a running app check is needed.

## Pull Requests

- Use Conventional Commit-style PR titles, such as
  `feat: add AI screenshot summaries`. Do not prefix PR titles with `[codex]`;
  keep Codex attribution in branch names and workflow context instead.
- Use `.github/PULL_REQUEST_TEMPLATE.md` as the source of truth for every PR
  description.
- Keep the template's Markdown section headings exactly: `## Summary`,
  `## Why`, `## User-facing behavior`, `## Verification`, and
  `## Risk / privacy / security`.
- Do not replace those headings with colon-prefixed inline labels such as
  `Summary:` or compress the description into one paragraph.
- In `## Verification`, list exact commands, tests, builds, or manual checks
  run. If something was not run, say `Not run` and explain why.

## Privacy And Security

- Do not commit runtime activity data, local SQLite files, logs, screenshots,
  API keys, signing material, extension secrets, private local paths, or
  user-identifying fixtures.
- Treat app/window titles, browser URLs, project names, screenshots, and
  portable archives as potentially private.
- For changes touching capture, exclusions, storage, exports, Keychain,
  Native Messaging, AI calls, Logo.dev calls, or logging, explicitly describe
  the privacy/security impact in the PR.
- Keep Logo.dev and AI provider behavior opt-in. Do not add background network
  calls for captured activity.

## Implementation

- Prefer existing helpers and patterns over new abstractions.
- Keep public interfaces small and behavior explicit.
- Update docs when setup, public behavior, privacy behavior, or contribution
  workflow changes.
- For UI design-system work, treat `PRODUCT.md`,
  `docs/design-system.md`, and `docs/ui-consistency-audit.md` as the source of
  truth. Preserve the neutral dark `graphite` direction, avoid new UI
  frameworks, and keep screenshots/private activity artifacts out of commits.
- Keep generated build products and scratch artifacts out of commits.
