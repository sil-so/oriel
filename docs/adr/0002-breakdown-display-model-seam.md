# ADR-0002: One breakdownModel seam for the canonical Activity Breakdown hierarchy

- Status: Accepted (implemented; tracked in sil-so/oriel#75)
- Date: 2026-06-26
- Tags: timeline, activity-breakdown, assign, edit, architecture, testability

ADRs record the decision and the alternatives we rejected; the durable
*behavioral* contract lives in `docs/timeline-decisions.md`, and the
implementation work is tracked as a GitHub issue. This ADR follows ADR-0001 and
addresses the parallel display-model seam it flagged as "left for later".

## Context

Three user-facing surfaces must present the *same* canonical hierarchy — the
recorded canonical rows, in timeline order, with Captured Fragments never
surfaced:

- **Activity Breakdown** (the Activity Stream block popup),
- **Assign** (Selected Activities, the assignment modal), and
- **Edit** (the saved Time Entry editor).

That rule was an emergent property spread across many functions rather than a
single owner. Each surface re-derived the hierarchy through its own summarizer:

- Breakdown → `buildActivityPopupDisplayModel` over `summarizePopupActivityOverlaps`,
  with the visible floor inlined as `POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS` in
  `buildTopLevelPopupDisplayRows`.
- Assign → `summarizeModalActivities` / `buildBulkModalDisplayActivities`, over
  `summarizeSimilarActivityOverlaps`.
- Edit → `getGroupedTimeEntryActivities` → `summarizeSimilarActivityOverlaps`,
  then `buildCollapsedSavedEntryDisplayActivities`.

The "is this a Captured Fragment?" rule existed as **two** independent 60s
constants (`POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS` in `timeline.js`,
`MODAL_ACTIVITY_MIN_VISIBLE_DURATION_MS` in `modals.js`) plus several scattered
`duration >= 60s` / `duration > 0` checks. Timeline order was a sort callback
copy-pasted verbatim in three places. With no single owner, the surfaces can
drift: a fragment hidden in one place can leak in another, and the order can
diverge — the missing-**locality** smell ADR-0001 named for the Time Entry path.

(Verified against the code before building: the three summarizers and the two
constants are real and distinct. The grouping *keys* differ on purpose — exact
identity for the breakdown, similarity for assignment scope — and that
difference is correct, hard-won behavior, c.f. issues #1, #63.)

## Decision

Introduce one named seam for the canonical breakdown hierarchy:

```
breakdownModel(row, context)
  row     = { overlaps, rangeStart, rangeEnd, primaryActivity, activeDurationMs }
  context = { zoom }
  → { rows, groups, primaryRow, secondaryRows, visibleRows, exactRows, isMultiple }
```

- `rows` are the canonical breakdown rows in timeline order; `groups` is the
  parallel view pairing each row with its canonical visit/session **children**
  (built by `buildPopupSessionSummaryRow` — never Captured Fragments).
- The legacy `buildActivityPopupDisplayModel` return shape is preserved as part
  of the result, so existing callers and tests are unaffected; it is now an
  adapter, and `buildActivityBlockPopupDisplayModel` (Activity Breakdown) renders
  `breakdownModel` directly.

Two collaborators make the shared rule explicit, each with **one** home:

1. **One Captured-Fragment rule.** `isCapturedFragmentBreakdownRow(row)` (with
   `isVisibleCanonicalBreakdownRow` and the single constant
   `BREAKDOWN_MIN_VISIBLE_DURATION_MS`) is the only place a canonical row is
   judged below the visible floor. Every breakdown row-classification site in
   `timeline.js` routes through it, and `modals.js`
   `isVisibleModalActivityCandidate` defers to it. A single test pins it.
2. **One timeline-order rule.** `compareBreakdownRowsByTimelineOrder` replaces
   the three copy-pasted sort callbacks — the popup row sort, the popup
   secondary-row sort, and `sortActivitySummaries` (which feeds Assign and Edit)
   — so their order cannot drift.

Scope nuance — **the fragment gate is a discovery-time rule, not a saved-data
rule.** Breakdown and Assign discover candidate activity and must hide capture
noise. Edit shows what the user already saved, including a deliberately logged
sub-minute canonical assignment, so it must *not* re-apply the 60s floor.
Therefore "render that one model" means the three surfaces share the row
*classification* and *ordering* vocabulary; the per-surface grouping for
assignment (similarity keys) and the saved-entry collapse (issues #1/#6,
non-expandable per-identity rows) remain intentional, surface-specific concerns.
This is the behavior-preserving reading required by the "existing behavior and
tests stay green" acceptance criterion.

## Alternatives considered

- **Deep unification: merge the three summarizers into one grouping pipeline
  that all surfaces call end-to-end.** Rejected. It would force one grouping key
  where two are correct (exact identity for breakdown vs. similarity for
  assignment scope) and would re-route the modal's saved-duration math, risking
  the very 6-zoom rounding / "N visits" regressions the decision log fought to
  fix (#1, #63). It is *more* code and *more* risk, and — because it must
  special-case the differences anyway — it would not actually make the path
  easier to debug. The genuine drift surface is the fragment rule and the order,
  not the grouping key; this ADR unifies exactly those.
- **Apply the Captured-Fragment gate to Edit too** (so all three are literally
  identical). Rejected: Edit must render saved sub-minute canonical assignments;
  hiding them would silently drop a user's logged time from the editor.
- **Put the predicate in `modals.js`.** Rejected: the breakdown hierarchy lives
  in `timeline.js` alongside `breakdownModel`. `modals.js` keeps a numerically
  identical fallback guarded by `typeof`, because its unit harness loads
  `modals.js` standalone (without `timeline.js`); in production and the
  with-utils timeline harness the one predicate is used. This is the established
  defensive pattern in `modals.js`, and — unlike the no-op trap #76 removed — the
  fallback is the *same* value, not a silent divergence.
- **Make `breakdownModel` a fresh from-scratch builder.** Rejected: the popup
  model is already the most complete derivation (timeline order, range clipping
  per issue #1, session children per #63). Naming it as the seam and centralizing
  the fragment/order rules is the smaller, safer move.

## Consequences

Positive:

- **Locality** — "what is a Captured Fragment" and "what is timeline order" each
  have one owner; the rule can no longer drift between Breakdown, Assign, and
  Edit.
- **Navigability** — `breakdownModel` is the named entry point a future reader
  greps for to find the canonical hierarchy, instead of rediscovering three
  summarizers.
- **Testability** — one test (`breakdownModel is the one builder …`) pins the
  seam and the single fragment rule; the rest of the suite (545 tests) stays
  green with no behavior change.

Costs / risks / follow-ups:

- `modals.js` retains a numeric fallback for its standalone unit harness
  (documented above). Migrating that harness to dual-load `timeline.js` — the
  ADR-0001 / #76 direction — would remove even the fallback; left for that
  cleanup.
- The per-surface assignment grouping and saved-entry collapse remain separate
  by design; this ADR unifies the hierarchy *classification and order*, not the
  assignment grouping policy.

The behavioral contract is recorded in `docs/timeline-decisions.md`
(2026-06-26). Implementation is tracked in sil-so/oriel#75 (parent #70).
