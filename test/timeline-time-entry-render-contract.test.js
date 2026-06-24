// Cross-zoom behavioral contract for the logged Time Entry render path.
//
// Issue:    sil-so/oriel#67 (deepen the render path into one module)
// Decision: docs/adr/0001-logged-time-entry-render-path-deep-module.md
// Contract: docs/timeline-decisions.md (2026-06-24 entry)
//
// The seam under test is `buildLoggedTimeEntryBlocks({ entries, activities,
// zoom, dateStartOfDay, rowLayout })`, which returns a descriptor list:
//
//   { projectId, taskId, entryIds,
//     displayRowStart, displayRowEnd, laneIndex, laneCount, loggedDurationMs }
//
// The descriptor list IS the interface and the test surface (no DOM, no
// pixels). This suite pins the five contract invariants across the six zooms.
// It runs on the HONEST harness (utils.js + timeline.js) because occupancy and
// identity matching are utils-backed and silently no-op on the bare timeline
// context (see memory: timeline-test-context-omits-utils).
//
// The fixtures mirror real saved data (memory:
// real-canonical-assignments-have-no-sources): canonical assignments are
// sourceless `activity-stream-summary` activities carrying assignedDurationMs,
// usually with no displayGroupKey and no display bounds. Clean fixtures hid
// these bugs once before, so each fixture is checked to actually reproduce its
// bug in the pre-seam pipeline.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const ZOOMS = [1, 5, 10, 15, 30, 60];
const MINUTE = 60 * 1000;
const DATE_START = new Date(2026, 4, 21).setHours(0, 0, 0, 0);

// Mirror of loadTimelineWithUtilsContext: dual-load utils.js then timeline.js so
// the activity-identity / occupancy code paths actually run.
function loadHonestTimelineContext() {
  const context = {
    window: {},
    state: {
      currentDate: new Date(2026, 4, 21),
      zoom: 5,
      activities: [],
      timelineActivities: [],
      timeEntries: [],
      projects: [],
      selectedActivities: new Set(),
      settings: { minActivityThreshold: 60 }
    },
    DOM: {},
    resizeState: {},
    document: {},
    URL,
    cleanTitle: title => title,
    getActivityIconHTML: () => '',
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/js/utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('web/js/timeline.js', 'utf8'), context);
  return context;
}

function at(minute) {
  return DATE_START + minute * MINUTE;
}

function rowOf(minute, zoom) {
  return Math.floor(minute / zoom);
}

// A visible Activity Stream activity (Codex), used to give a source-backed
// entry rows it can occupy.
function codexActivity(startMinute, endMinute) {
  return {
    app: 'Codex',
    title: 'Codex',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex',
    url: '',
    start: at(startMinute),
    end: at(endMinute),
    duration: (endMinute - startMinute) * MINUTE
  };
}

// A real saved canonical assignment: a sourceless activity-stream-summary
// carrying assignedDurationMs, no displayGroupKey and no display bounds unless
// asked. Whole-minute durations only, so the deferred round-then-sum vs
// sum-then-round discrepancy never bites here.
function summaryEntry({
  id,
  startMinute,
  endMinute,
  assignedMinutes,
  projectId = 'project-1',
  taskId = 'task-1',
  displayGroupKey,
  createdBy = 'manual'
}) {
  const start = at(startMinute);
  const end = at(endMinute);
  return {
    id,
    start,
    end,
    projectId,
    taskId,
    createdBy,
    description: '',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      url: '',
      start,
      end,
      duration: assignedMinutes * MINUTE,
      assignedDurationMs: assignedMinutes * MINUTE,
      assignmentStart: start,
      assignmentEnd: end,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 5,
      ...(displayGroupKey ? { assignmentDisplayGroupKey: displayGroupKey } : {})
    }]
  };
}

// A freehand manual entry: a dragged range with no Activity Stream assignment.
// Its logged duration and occupancy follow the saved range, not any activity.
function freehandEntry({ id, startMinute, endMinute, projectId = 'project-2', taskId = '' }) {
  return {
    id,
    start: at(startMinute),
    end: at(endMinute),
    projectId,
    taskId,
    createdBy: 'manual',
    description: '',
    activities: []
  };
}

const PROJECTS = [
  { id: 'project-1', name: 'Build', color: '#2563eb', tasks: [{ id: 'task-1', name: 'Feature' }] },
  { id: 'project-2', name: 'Admin', color: '#ef4444', tasks: [] }
];

// Build the descriptor list through the seam at one zoom, on a full (uncompressed)
// row grid so display rows equal absolute minute-rows and gap rows are real.
function buildBlocksAtZoom(context, zoom) {
  assert.equal(
    typeof context.buildLoggedTimeEntryBlocks,
    'function',
    'buildLoggedTimeEntryBlocks seam must exist (issue #67 Slice 2)'
  );
  const rowLayout = context.buildDayTimelineRowLayout({
    dateStartOfDay: DATE_START,
    zoom,
    hideEmptyRows: false
  });
  const blocks = context.buildLoggedTimeEntryBlocks({
    entries: context.state.timeEntries,
    activities: context.state.activities,
    zoom,
    dateStartOfDay: DATE_START,
    rowLayout
  });
  assert.ok(Array.isArray(blocks), `seam returns a descriptor array at ${zoom} min`);
  return blocks;
}

function blocksForEntry(blocks, entryId) {
  return blocks.filter(block => Array.isArray(block.entryIds) && block.entryIds.includes(entryId));
}

function sumLoggedDurationMs(blocks) {
  return blocks.reduce((total, block) => total + Number(block.loggedDurationMs || 0), 0);
}

function savedLoggedDurationMs(context, entryId) {
  const entry = (context.state.timeEntries || []).find(candidate => candidate.id === entryId);
  return entry ? context.getRenderedTimeEntryDurationMs(entry) : 0;
}

// Invariant 1 — Duration is the saved sum of assignedDurationMs, fixed at save
// time and zoom-independent; never derived from elapsed span or projection.
test('contract: logged duration is the saved sum and is identical at every zoom', () => {
  const context = loadHonestTimelineContext();
  context.state.activities = [codexActivity(0, 17)];
  context.state.timelineActivities = context.state.activities;
  context.state.timeEntries = [summaryEntry({ id: 'entry-dur', startMinute: 0, endMinute: 17, assignedMinutes: 17 })];
  context.state.projects = PROJECTS;

  const totals = ZOOMS.map(zoom => {
    const blocks = buildBlocksAtZoom(context, zoom);
    const total = sumLoggedDurationMs(blocksForEntry(blocks, 'entry-dur'));
    assert.equal(total, 17 * MINUTE, `logged duration is the saved 17 min at ${zoom} min`);
    return total;
  });
  assert.equal(new Set(totals).size, 1, 'logged duration does not drift across zooms');
});

// Invariant 2 — A source-backed block breaks at empty/nonmatching rows instead
// of rendering one continuous fill across them. Reproduces the continuous-fill
// bug: a manual summary whose saved range (0-160 min) far exceeds its logged
// 20 min renders one block bridging the band where its activity is absent.
test('contract: a source-backed block splits at a gap row instead of bridging it', () => {
  const context = loadHonestTimelineContext();
  // Matching Codex activity at 0-10 min and again at 150-160 min, nothing
  // between — so a wide empty band sits in the middle at every zoom.
  context.state.activities = [codexActivity(0, 10), codexActivity(150, 160)];
  context.state.timelineActivities = context.state.activities;
  context.state.timeEntries = [summaryEntry({ id: 'entry-split', startMinute: 0, endMinute: 160, assignedMinutes: 20 })];
  context.state.projects = PROJECTS;

  for (const zoom of ZOOMS) {
    const blocks = buildBlocksAtZoom(context, zoom);
    const entryBlocks = blocksForEntry(blocks, 'entry-split');
    const gapRow = rowOf(75, zoom); // a row inside the empty middle band

    assert.ok(entryBlocks.length >= 2, `entry splits into separate blocks at ${zoom} min`);
    for (const block of entryBlocks) {
      assert.ok(
        !(block.displayRowStart <= gapRow && gapRow < block.displayRowEnd),
        `no block bridges the empty gap row ${gapRow} at ${zoom} min`
      );
    }
    const covered = row => entryBlocks.some(b => b.displayRowStart <= row && row < b.displayRowEnd);
    assert.ok(covered(rowOf(0, zoom)), `first matching run is rendered at ${zoom} min`);
    assert.ok(covered(rowOf(150, zoom)), `second matching run is rendered at ${zoom} min`);
    // Duration contract still holds across the split.
    assert.equal(sumLoggedDurationMs(entryBlocks), 20 * MINUTE, `split block durations sum to the saved 20 min at ${zoom} min`);
  }
});

// Invariant 3 — Same project/task runs merge into one block whose pill sums the
// member saved durations, regardless of saved displayGroupKey, and do not stack
// into separate lanes. Reproduces the stacked-blocks bug: two same project/task
// summaries with different display group keys occupying the same rows render
// side by side in two lanes.
test('contract: same project/task overlapping runs merge and sum, ignoring displayGroupKey', () => {
  const context = loadHonestTimelineContext();
  context.state.activities = [];
  context.state.timelineActivities = [];
  context.state.timeEntries = [
    summaryEntry({ id: 'entry-a', startMinute: 0, endMinute: 30, assignedMinutes: 15, displayGroupKey: 'group-a' }),
    summaryEntry({ id: 'entry-b', startMinute: 0, endMinute: 30, assignedMinutes: 15, displayGroupKey: 'group-b' })
  ];
  context.state.projects = PROJECTS;

  for (const zoom of ZOOMS) {
    const blocks = buildBlocksAtZoom(context, zoom);
    const merged = blocks.filter(b => b.projectId === 'project-1' && b.taskId === 'task-1');

    assert.equal(merged.length, 1, `the two same-project runs merge into one block at ${zoom} min`);
    const [block] = merged;
    assert.deepEqual(
      [...block.entryIds].sort(),
      ['entry-a', 'entry-b'],
      `merged block carries both source entry ids at ${zoom} min`
    );
    assert.equal(block.loggedDurationMs, 30 * MINUTE, `merged pill sums both saved durations at ${zoom} min`);
    assert.equal(block.laneCount, 1, `merged block is not stacked into lanes at ${zoom} min`);
  }
});

// Invariant 4 — Pill and Edit share one source: the block's loggedDurationMs
// equals the sum, resolved from its entryIds against state.timeEntries, of each
// saved entry's logged duration. So the duration pill and the Edit panel (which
// rebuilds from entryIds) cannot disagree — no positional detail side-map.
test('contract: every block pill equals the total resolved from its entryIds', () => {
  const context = loadHonestTimelineContext();
  context.state.activities = [];
  context.state.timelineActivities = [];
  context.state.timeEntries = [
    summaryEntry({ id: 'entry-a', startMinute: 0, endMinute: 30, assignedMinutes: 15, displayGroupKey: 'group-a' }),
    summaryEntry({ id: 'entry-b', startMinute: 0, endMinute: 30, assignedMinutes: 15, displayGroupKey: 'group-b' })
  ];
  context.state.projects = PROJECTS;

  for (const zoom of ZOOMS) {
    const blocks = buildBlocksAtZoom(context, zoom);
    // The merged block must carry both members and a pill equal to their sum.
    const merged = blocks.filter(b => b.projectId === 'project-1' && b.taskId === 'task-1');
    assert.equal(merged.length, 1, `one merged block to edit at ${zoom} min`);

    for (const block of blocks) {
      const editTotal = block.entryIds.reduce((total, id) => total + savedLoggedDurationMs(context, id), 0);
      assert.equal(
        block.loggedDurationMs,
        editTotal,
        `pill equals the Edit total resolved from entryIds at ${zoom} min`
      );
    }
  }
});

// Invariant 5 — Occupancy by entry type: a source-backed block occupies only
// rows with matching visible activity (so it splits at the gap, invariant 2),
// while a freehand manual block occupies the full saved range, blanks included.
test('contract: a freehand manual block fills its saved range across blank rows', () => {
  const context = loadHonestTimelineContext();
  // No activities at all — a pure dragged range spanning several empty rows.
  context.state.activities = [];
  context.state.timelineActivities = [];
  context.state.timeEntries = [freehandEntry({ id: 'entry-free', startMinute: 0, endMinute: 130 })];
  context.state.projects = PROJECTS;

  for (const zoom of ZOOMS) {
    const blocks = buildBlocksAtZoom(context, zoom);
    const entryBlocks = blocksForEntry(blocks, 'entry-free');

    assert.equal(entryBlocks.length, 1, `freehand manual entry renders one continuous block at ${zoom} min`);
    const [block] = entryBlocks;
    assert.equal(block.displayRowStart, rowOf(0, zoom), `freehand block starts at its saved range start at ${zoom} min`);
    assert.equal(block.displayRowEnd, Math.ceil(130 / zoom), `freehand block ends at its saved range end at ${zoom} min`);
    // It covers the same band a source-backed block would have split at.
    const blankRow = rowOf(75, zoom);
    assert.ok(
      block.displayRowStart <= blankRow && blankRow < block.displayRowEnd,
      `freehand block spans the blank middle row ${blankRow} at ${zoom} min`
    );
  }
});
