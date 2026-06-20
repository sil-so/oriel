# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all
operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a
  heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by
  `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`
  with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` /
  `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`
- **Close from a PR**: when a PR fully completes an issue, include a GitHub
  closing keyword in the PR body, such as `Closes #123`, `Fixes #123`, or
  `Resolves #123`. Use `Refs #123`, `Part of #123`, or plain issue links only
  for partial work that should leave the issue open.

Infer the repo from `git remote -v` -- `gh` does this automatically when run
inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: yes.**

External contributor PRs run through the same labels and states as issues, using
the `gh pr` equivalents. Maintainer-authored or collaborator in-flight PRs are
normal implementation work, not incoming request triage.

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for
  the diff.
- **List external PRs for triage**:
  `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`
  then keep only `authorAssociation` of `CONTRIBUTOR`,
  `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`,
  `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be
either -- resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## Closing implementation issues

If a merged PR did not use a closing keyword, GitHub will leave the referenced
issue open. Confirm the PR fully completed the issue, then close the issue
manually with a short public comment:

`gh issue close <number> --reason completed --comment "Completed by #<pr>."`

Leave PRD parent issues open until their intended child implementation issues
are complete, unless the parent issue is explicitly scoped as the implemented
work itself.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Issue types

### Contributor reports

Use the templates in `.github/ISSUE_TEMPLATE/` for public bug reports, feature
requests, and privacy/security concerns. Keep reporter-facing templates short,
specific, and safe for public activity-tracking context.

### PRD parent issues

Use a PRD parent issue when a product or architecture decision needs to be
split into multiple implementation slices. The body should use these headings:

- `## Problem Statement`
- `## Solution`
- `## User Stories`
- `## Implementation Decisions`
- `## Testing Decisions`
- `## Out of Scope`
- `## Further Notes`

Do not put private tracker IDs, local-only artifacts, raw activity data,
screenshots with private data, full browser URLs, credentials, or internal
workflow notes in PRD issues.

When a PRD parent will be split by `/to-issues`, keep the parent issue as the
source of truth for the product decision and apply `ready-for-agent` to the
implementation slice issues, not to the parent unless the parent is intended to
be implemented directly.

### Ready-for-agent implementation slices

Use a ready-for-agent issue for a thin, independently grabbable vertical slice.
The body should use these headings:

- `## Parent`
- `## What to build`
- `## Acceptance criteria`
- `## Blocked by`

Apply the `ready-for-agent` label only when the issue is specific enough for an
agent to implement without more product discovery. Each slice should be
demoable or verifiable on its own, and should avoid stale file-path-heavy
instructions unless a precise path is necessary.
