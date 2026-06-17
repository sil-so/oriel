# AGENTS.md

## Project Guidance

Oriel is a local-first macOS time tracker. Keep changes simple,
maintainable, and easy to review.

## Linear

- Always create or use a Linear issue for new and existing implementation
  work, and keep that issue updated as the work moves through active
  development, review, completion, or blockage.

## Build And Test

- Run `npm test` for frontend, bridge, and Node compatibility tests.
- Run `swift test` for native services and persistence tests.
- Run `npm run build:assets` after changing Tailwind input, vendored
  frontend assets, or package dependencies.
- Run `./script/build_and_run.sh --verify` after native app packaging or
  launch-path changes.
- Run `./script/build_and_run.sh` when a running app check is needed.

## Local Verification Notes

- If `.agents/oriel-verification.md` exists, read it before choosing Browser,
  Computer Use, Chrome, Playwright, terminal logs, or other verification tools
  for Oriel work.
- Do not treat "use the in-app Codex browser when UI verification is relevant"
  as a sole or default rule for every UI check. Use the routing guidance in the
  local verification notes: Browser/Playwright for browser-runnable frontend UI,
  Computer Use for the real Oriel app surface, and terminal tests/logs/data
  inspection for under-the-hood behavior.
- Keep `.agents/oriel-verification.md` local and ignored. It may contain
  machine-specific Codex workflow notes, failed interaction attempts, screenshots
  or app-state observations, and private debugging context.
- Update `.agents/oriel-verification.md` whenever a verification or debugging
  approach succeeds after earlier attempts were slow, flaky, or misleading.

## Design System

- Before making UI changes, read `DESIGN.md`, `PRODUCT.md`,
  `docs/design-system.md`, and `docs/ui-consistency-audit.md`.
- Treat `DESIGN.md` as the agent-readable design contract for visual tokens,
  component rules, theme behavior, accessibility, and UI anti-patterns.
- Do not invent new colors, spacing, typography, radii, shadows, z-index values,
  motion rules, or component variants unless the task explicitly updates the
  design system.
- Keep `graphite`, `light`, and `reference` usable while the theme selector is a
  live app feature. `graphite` is the primary design direction; `light` and
  `reference` are compatibility themes unless a task explicitly changes theme
  strategy.
- When implementation and `DESIGN.md` conflict, report the conflict first and
  clarify whether to update the implementation or the design contract.
- Update `DESIGN.md` when intentionally changing visual tokens, component
  contracts, theme behavior, accessibility rules, or design-system anti-patterns.

## Pull Requests

- Use Conventional Commit-style PR titles, such as
  `feat: add AI screenshot summaries`. Do not prefix PR titles with `[codex]`;
  keep Codex attribution in branch names and workflow context instead.
- All commits, PRs, docs, and comments in this repo must be written as clean
  open-source contributions. Do not reference external tools, private project
  management, internal workflows, or conversation history. Write as if you are a
  maintainer contributing to a public project.
- Do not include Linear issue IDs or private tracker IDs in branch names. Use
  descriptive public branch names such as `codex/publish-docs-foundation`.
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
- Update `docs/timeline-decisions.md` whenever changing timeline rendering
  behavior, geometry, row visibility, zoom behavior, or Activity Stream and
  Time Entries alignment.
- For UI design-system work, treat `PRODUCT.md`,
  `docs/design-system.md`, and `docs/ui-consistency-audit.md` as the source of
  truth. Preserve the neutral dark `graphite` direction, avoid new UI
  frameworks, and keep screenshots/private activity artifacts out of commits.
- Keep generated build products and scratch artifacts out of commits.
