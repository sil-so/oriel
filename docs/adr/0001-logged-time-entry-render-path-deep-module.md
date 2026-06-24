# ADR-0001: Logged Time Entry render path as one deep module with a cross-zoom contract

- Status: Accepted (design pass; implementation tracked in sil-so/oriel#67)
- Date: 2026-06-24
- Tags: timeline, time-entries, architecture, testability

This is the first ADR in this repo. It also establishes `docs/adr/` as the home
for architecture decisions and their rationale, as anticipated by
`docs/agents/domain.md`. ADRs record the decision and the alternatives we
rejected; the durable *behavioral* contract lives in
`docs/timeline-decisions.md`, and the implementation work is tracked as a
GitHub issue.

## Context

Recent timeline work (#60, #63–#66) and a fresh round of reproduced bugs all
cluster on the logged **Time Entry render path**. The bug surface is wide enough
that it cannot be enumerated by hand — the signature of missing **locality**.

Four reproduced bugs map onto that one path:

- A logged block renders as one continuous fill across rows with no matching
  recorded activity, instead of splitting at the gap.
- Two same-project blocks stack side by side instead of merging, and their
  totals drift between zoom levels.
- A merged block's duration pill and its Edit panel disagree (pill shows the
  merged total, Edit shows one member).
- The same block reads different durations at different zoom levels.

(A fifth — a saved assignment total disagreeing with the eyeballed sum of
Activity Stream row minutes — is a canonical rounding issue and is **out of
scope**; see Consequences.)

Root cause: the Time Entry path's **geometry**, **merge**, **per-zoom
duration**, and **block-detail read-back** are four uncoordinated derivations
with no shared contract. The pill, the Edit panel, and each zoom each recompute
and drift. In `/codebase-design` terms, the module's **interface** is missing
its **invariants** — and invariants are part of the interface, not the
implementation.

Specifics in the current code:

- Duration is derived from per-zoom projection/geometry (`item.durationMs` →
  pill at `timeline.js`), so it changes with zoom.
- Geometry draws one continuous rectangle `rangeStart → rangeEnd`, bridging
  gaps.
- Merge runs through `getActivityStreamAssignmentGroupKey` (string equality on
  `project|task|displayGroupKey|app`, **no rows**); lane runs through
  `assignLoggedTimeEntryLanes` (raw ms overlap). Split runs through
  `buildLoggedTimeEntryRenderItems` (rows). Three different notions of
  "adjacent."
- Edit detail is stashed in an in-memory map keyed by a positional counter
  (`time-entry-detail-${size + 1}`), cleared each render, read back through the
  single-slot model cache **with no fallback**.

## Decision

Deepen the logged Time Entry render path into one module behind a single seam:

```
buildLoggedTimeEntryBlocks({ entries, activities, zoom, dateStartOfDay, rowLayout })
  → [ { projectId, taskId, entryIds,
        displayRowStart, displayRowEnd, laneIndex, laneCount,
        loggedDurationMs } ]   // + precise display ranges for the templater
```

`getDayTimelineRenderModel` calls it to fill `timeEntryRenderItems`; the cached
render model is otherwise unchanged. The descriptor list is the **interface and
the test surface**. The module enforces a cross-zoom contract:

1. **Duration contract.** A saved entry's logged duration = sum of its canonical
   assignment activities' `assignedDurationMs`, fixed at save, zoom-independent.
   The sum of every block pill derived from one entry equals that saved duration
   at every zoom. Never derived from geometry, elapsed span, or projection.
2. **One row-grid predicate** owns split + merge + lane: a block is a maximal
   run of consecutive occupied display rows for one project/task; breaks at any
   empty/nonmatching row; same project/task adjacent runs merge and sum
   (ignoring saved `displayGroupKey`); different project/task overlaps lane.
3. **Occupancy by entry type.** Source-backed → only rows with matching visible
   Activity Stream activity; freehand manual → rows its saved range covers.
4. **Geometry regimes preserved.** Exact sub-row pixels at `1 min`, row-aligned
   at `5 min+`. The only new visual is real gaps where a block used to bridge.
5. **Delete the detail side-map.** The block carries content-derived `entryIds`;
   `openTimeEntryBlockEditor` rebuilds the breakdown from `state.timeEntries`, so
   pill and Edit share one source. `renderLoggedTimeEntries` becomes a pure
   templater.
6. **Honest test surface.** The contract suite (the five invariants × six zooms)
   runs on a harness that dual-loads `utils.js` with `timeline.js`, because
   occupancy and identity matching are utils-backed.

## Alternatives considered

- **Make the render model fully pure** (compute detail eagerly, no render
  side-effect). Rejected for this slice: larger blast radius, and it fights the
  2026-06-10 performance decision that deliberately moved detail population to
  render time. It remains available *behind* this seam later.
- **Keep the block-detail side-map but harden it** (content keys + fallback).
  Rejected by the deletion test: the data already lives in `state.timeEntries`
  (which the model signature is keyed on, so it cannot be stale relative to the
  render). The map is a fragile indirection, not a responsibility.
- **Pixel-level descriptor.** Rejected: it would force the contract to be tested
  through a DOM/geometry engine. Rows + duration are the contract; pixels are
  presentation derived from `rowLayout`.
- **Keep the `displayGroupKey` string-key merge.** Rejected: it compares saved
  strings, not rows, so two same-project entries saved at different
  zooms/moments never merge (the reproduced stacked-blocks bug).
- **Test on the bare timeline-only harness.** Rejected: occupancy and identity
  are utils-backed and silently no-op there, so the suite would pass over the
  split/merge bugs without noticing — the same trap that previously hid #63.
- **Pull the canonical 17-vs-18 rounding into this slice.** Rejected: it is an
  identity/duration-policy decision (deferred to the identity correction), and
  deferring is provably non-lossy because the per-canonical-unit
  `assignedDurationMs` is persisted as one snapshot row per selected unit.

## Consequences

Positive:

- **Locality** — split, merge, duration, and detail decisions live in one
  module; the wide bug surface concentrates.
- **Leverage** — one seam serves every downstream consumer and every test.
- **Testability** — the contract is assertable on the descriptor array without a
  DOM; the five invariants pin the reproduced bugs across all six zooms.
- Kills the four in-scope bugs (continuous-fill, stacked/duration-drift,
  pill-vs-Edit, per-zoom durations).

Costs / risks / follow-ups:

- The canonical **17-vs-18** discrepancy stays visible until the identity
  correction (this contract only pins the Time Entry side to the saved number
  and keeps it zoom-invariant).
- This slice deliberately touches the **test harness** (a separate cleanup
  candidate) by requiring the with-utils context for its suite; migrating the
  remaining bare-context time-entry tests is left to that cleanup.
- The Activity Stream popup has a **parallel** positional-counter side-map (with
  a DOM fallback); no reported bug there, left for later.

The behavioral contract is recorded in `docs/timeline-decisions.md`
(2026-06-24). Implementation slices are tracked in sil-so/oriel#67.
