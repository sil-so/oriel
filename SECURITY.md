# Security Policy

Oriel records local activity data, so privacy and local data handling bugs matter.

## Reporting

Please report suspected vulnerabilities privately to the maintainer before opening a public issue. Include:

- A concise description of the issue.
- Steps to reproduce.
- The affected platform and Oriel version or commit.
- Whether local activity data, API keys, Keychain items, browser data, or signed build artifacts may be exposed.

Do not include real activity logs, credentials, API keys, or private local paths in reports unless they are necessary and explicitly redacted.

## Scope

Security-sensitive areas include:

- Local SQLite storage and portable archive restore.
- Keychain-backed AI and Logo.dev API key handling.
- Browser Native Messaging host registration and event ingestion.
- Capture exclusions, purge, and local data deletion paths.
- Future packaging, signing, notarization, and update/distribution workflows.
