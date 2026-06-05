# Contributing

Thanks for helping improve Oriel.

## Local Setup

Oriel is a local-first macOS app. The native path requires macOS 14+, Swift, and Node.js 18+ for frontend asset generation.

```bash
npm install
npm run build:assets
swift test
npm test
./script/build_and_run.sh
```

Use `./script/build_and_run.sh --verify` when you need to build and stage the app without launching it.

## Development Rules

- Keep runtime data out of commits. `data/`, local SQLite files, logs, screenshots, build outputs, packaged archives, signing files, and scratch images are ignored because they can contain local activity or machine-specific state.
- Do not commit API keys, Apple signing credentials, app-specific passwords, extension secrets, or private local paths.
- Update documentation when setup, public behavior, APIs, architecture, or workflow changes.
- Run the relevant tests before submitting changes. For most code changes, run both `npm test` and `swift test`.
- Rebuild and relaunch `Oriel.app` with `./script/build_and_run.sh` after app changes so the running app matches the source.

## Browser Companion

The Chrome/Brave browser companion currently supports developer testing with an unpacked extension and a manually entered extension identifier. A future public release should use a finalized Chrome Web Store extension identifier and remove the manual setup step for ordinary users.
