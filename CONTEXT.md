# Oriel

Oriel models local foreground activity so users can review captured work and
assign it to projects without losing source evidence.

## Language

**Captured Fragment**:
A source observation of app, window, browser tab, URL, title, and exact timing.
It is evidence inside an assignable activity, not a top-level assignment target
by itself. Captured fragments are internal evidence for accounting,
persistence, tests, and developer debugging; their raw second-level titles and
durations do not appear in normal user-facing Activity Breakdown, Assign, Edit,
or timeline UI.
_Avoid_: Raw activity row, hidden activity

**Canonical Activity Row Unit**:
The assignable activity unit derived from the `1 min` Activity Stream view. It
represents one visible activity row/run, which may span more than one minute,
that remains identifiable when coarser zoom levels summarize it. Its displayed
duration is the user-facing duration contract for assignment and review.
The term is domain language for maintainers, not user-facing product copy.
_Avoid_: Source fragment, popup child, rendered block

**Coarse Activity Row**:
An Activity Stream row at a zoom coarser than `1 min` that summarizes one or
more Canonical Activity Row Units for readability. Its main timeline row may
stay summarized, but opening or selecting from it reveals canonical units as
the first user-facing detail level.
_Avoid_: Assignable source, hour block

**Activity Breakdown**:
A detail surface for an Activity Stream row that reveals the Canonical Activity
Row Units summarized by that row. Its first user-facing rows are canonical
units or Breakdown Groups in timeline order, not host-only source parents,
sub-canonical captured webpage fragments, or Captured Fragments.
_Avoid_: Hidden selection state, raw source list

**Breakdown Group**:
A review group inside an activity detail or Multiple Activities surface that
combines Canonical Activity Row Units with the same exact activity identity.
It may merge adjacent or continuous visits into one default review row when
the UI keeps the separate visits inspectable, but it does not move
non-contiguous canonical activities away from their timeline order. Selecting
a Breakdown Group selects its underlying Canonical Activity Row Units, and
expansion reveals those canonical visits without exposing Captured Fragments.
_Avoid_: Saved entry, source fragment group

**Selected Activities**:
The Assign and Edit modal review surface for currently selected Canonical
Activity Row Units. It uses the same canonical review hierarchy as Activity
Breakdown: grouped canonical rows may expand to canonical visits, and checklist
controls never operate on Captured Fragments. Selected activities are ordered
by their original timeline order.
_Avoid_: Recorded Activity Snapshot

**Exact Activity Identity**:
The app/site/title identity that allows Canonical Activity Row Units to be
grouped without changing what they are. For browser activity, it includes the
normalized URL when available, and falls back to app/site/title within the same
site when the URL is unavailable. It is narrower than broad Similar modes such
as Base URL.
_Avoid_: Similarity key, base URL match

**Similar Selection**:
A command that finds Canonical Activity Row Units related to a selected seed
activity by a chosen match mode, such as Base URL, exact URL, app name, or app
plus title. It changes which canonical units are selected, not what the
assignable unit is.
_Avoid_: Source-fragment selection, automatic popup selection

**Activity Mix**:
Hands-on versus hands-off captured-time metadata for an activity. It is useful
internal metadata, but hidden from normal user-facing timeline, popup,
breakdown, Assign, and Edit UI unless a future product decision re-enables it.
_Avoid_: Primary activity identity, assignment signal

**Logged Time Entry Block**:
The assembled visual unit in the Time Entries timeline for a saved entry at the
active zoom: a maximal run of consecutive occupied display rows for one
project/task, broken at empty or nonmatching rows and merged across same
project/task adjacency. Its duration pill shows Logged Duration, not its elapsed
visual span. Source-backed blocks occupy only rows with matching visible
Activity Stream activity; freehand manual blocks occupy the rows their saved
range covers.
_Avoid_: Elapsed envelope, displayGroupKey block, projected range

**Logged Duration**:
The saved, zoom-invariant duration of a canonical assignment: the sum of its
canonical assignment activities' `assignedDurationMs`, fixed at save time. It is
the duration contract for Time Entry pills, Edit, Work Times, and project totals
at every zoom, and is never derived from elapsed span or per-zoom projection.
_Avoid_: Elapsed duration, projected duration, visual span
