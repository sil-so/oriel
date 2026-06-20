# Oriel

Oriel models local foreground activity so users can review captured work and
assign it to projects without losing source evidence.

## Language

**Captured Fragment**:
A source observation of app, window, browser tab, URL, title, and exact timing.
It is evidence inside an assignable activity, not a top-level assignment target
by itself. Captured fragments may appear behind read-only source-detail
disclosure, but not as rows in an assignment checklist.
_Avoid_: Raw activity row, hidden activity

**Canonical Activity Row Unit**:
The assignable activity unit derived from the `1 min` Activity Stream view. It
represents one visible activity row/run, which may span more than one minute,
that remains identifiable when coarser zoom levels summarize it.
_Avoid_: Source fragment, popup child, rendered block

**Coarse Activity Row**:
An Activity Stream row at a zoom coarser than `1 min` that summarizes one or
more Canonical Activity Row Units for readability.
_Avoid_: Assignable source, hour block

**Activity Breakdown**:
A detail surface for an Activity Stream row that reveals the Canonical Activity
Row Units and Captured Fragments summarized by that row. A canonical unit
remains assignable from the breakdown even when it is not the coarse row's
primary label.
_Avoid_: Hidden selection state, raw source list

**Breakdown Group**:
A review group inside an activity detail or Multiple Activities surface that
combines Canonical Activity Row Units with the same exact activity identity.
It may merge non-contiguous visits into one default review row when the UI
keeps the separate visits inspectable. Selecting a Breakdown Group selects its
underlying Canonical Activity Row Units, and expanded child checkboxes may
include only those canonical units, not Captured Fragments.
_Avoid_: Saved entry, source fragment group

**Selected Activities**:
The Assign and Edit modal review surface for currently selected Canonical
Activity Row Units. It may show grouped review rows, visit counts, and
source-detail disclosures, but its checklist controls operate only on canonical
units.
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
