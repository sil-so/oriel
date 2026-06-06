import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set((element.className || '').split(/\s+/).filter(Boolean));
  }

  add(...classes) {
    classes.forEach(className => this.classes.add(className));
    this.element.className = Array.from(this.classes).join(' ');
  }

  remove(...classes) {
    classes.forEach(className => this.classes.delete(className));
    this.element.className = Array.from(this.classes).join(' ');
  }

  contains(className) {
    return this.classes.has(className);
  }

  toggle(className, force) {
    const shouldAdd = typeof force === 'boolean' ? force : !this.classes.has(className);
    if (shouldAdd) {
      this.add(className);
    } else {
      this.remove(className);
    }
    return shouldAdd;
  }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.innerHTML = '';
    this.innerText = '';
    this.value = '';
    this.checked = false;
    this.style = {};
    this.listeners = {};
  }

  addEventListener(type, listener) {
    this.listeners[type] ||= [];
    this.listeners[type].push(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners[event.type] || []) {
      listener(event);
    }
  }

  querySelectorAll() {
    return [];
  }

  focus() {
    this.focusCalls = (this.focusCalls || 0) + 1;
  }

  appendChild(child) {
    this.child = child;
  }

  remove() {
    this.removed = true;
  }
}

function loadTimelineContext() {
  const context = {
    window: {},
    state: {
      currentDate: new Date(2026, 4, 21),
      zoom: 5,
      activities: [],
      timeEntries: [],
      projects: [],
      selectedActivities: new Set(),
      settings: {
        minActivityThreshold: 60
      }
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
  vm.runInContext(fs.readFileSync('js/timeline.js', 'utf8'), context);
  return context;
}

function loadTitleCleaningContext() {
  const context = {
    window: {},
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    document: {
      documentElement: { dataset: {} },
      getElementById() {
        return null;
      }
    },
    URL,
    URLSearchParams
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/state.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/utils.js', 'utf8'), context);
  return context.window;
}

function loadScrollContext() {
  const RealDate = Date;
  const animationFrames = [];
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [2026, 4, 23, 10, 30, 0, 0]));
    }

    static now() {
      return new RealDate(2026, 4, 23, 10, 30, 0, 0).getTime();
    }
  }

  function createScrollElement() {
    const listeners = {};
    let scrollTopValue = 0;
    const element = {
      clientHeight: 400,
      scrollWrites: 0,
      scrollTo(arg) {
        this.scrollToArg = arg;
        this.scrollTop = arg.top;
      },
      addEventListener(type, listener) {
        listeners[type] ||= [];
        listeners[type].push(listener);
      },
      dispatch(type) {
        for (const listener of listeners[type] || []) {
          listener();
        }
      }
    };
    Object.defineProperty(element, 'scrollTop', {
      get() {
        return scrollTopValue;
      },
      set(value) {
        if (scrollTopValue !== value) {
          element.scrollWrites += 1;
        }
        scrollTopValue = value;
      }
    });
    return element;
  }

  const memScroll = createScrollElement();
  const timeScroll = createScrollElement();

  const context = {
    window: {},
    Date: FixedDate,
    state: { zoom: 30 },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    DOM: {
      get elMemAidScroll() {
        return memScroll;
      },
      get elTimeEntriesScroll() {
        return timeScroll;
      }
    },
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/scroll.js', 'utf8'), context);
  return {
    context,
    memScroll,
    timeScroll,
    flushAnimationFrame() {
      const callback = animationFrames.shift();
      if (callback) callback();
    },
    pendingAnimationFrameCount() {
      return animationFrames.length;
    }
  };
}

function loadModalsContext() {
  const elements = new Map();
  for (const id of [
    'time-entry-modal',
    'modal-title',
    'modal-start-time',
    'modal-end-time',
    'modal-duration-lbl',
    'modal-description-input',
    'modal-project-select',
    'modal-project-grid',
    'modal-task-container',
    'modal-task-select',
    'modal-billable-toggle',
    'modal-btn-delete',
    'time-entry-modal-content',
    'modal-left-panel',
    'modal-memory-aid-list'
  ]) {
    elements.set(id, new FakeElement(id));
  }
  elements.get('time-entry-modal-content').className = 'w-[420px]';
  elements.get('modal-left-panel').className = 'hidden';

  const context = {
    window: {},
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      }
    },
    state: {
      projects: [
        {
          id: 'project-1',
          name: 'Project One',
          color: '#3b82f6',
          billable: true,
          tasks: [
            { id: 'task-1', name: 'Planning', archived: false },
            { id: 'task-2', name: 'Archived Task', archived: true }
          ]
        }
      ],
      activities: [],
      rules: [],
      currentModalActivities: []
    },
    DOM: {
      get elModal() { return elements.get('time-entry-modal'); },
      get elModalTitle() { return elements.get('modal-title'); },
      get elModalStart() { return elements.get('modal-start-time'); },
      get elModalEnd() { return elements.get('modal-end-time'); },
      get elModalDuration() { return elements.get('modal-duration-lbl'); },
      get elModalDescription() { return elements.get('modal-description-input'); },
      get elModalProjectSelect() { return elements.get('modal-project-select'); },
      get elModalProjectGrid() { return elements.get('modal-project-grid'); },
      get elModalTaskContainer() { return elements.get('modal-task-container'); },
      get elModalTaskSelect() { return elements.get('modal-task-select'); },
      get elModalBillable() { return elements.get('modal-billable-toggle'); },
      get elModalBtnDelete() { return elements.get('modal-btn-delete'); },
      get elModalContent() { return elements.get('time-entry-modal-content'); },
      get elModalLeftPanel() { return elements.get('modal-left-panel'); },
      get elModalMemoryAidList() { return elements.get('modal-memory-aid-list'); }
    },
    cleanTitle: title => title,
    getActivityIconHTML: () => '',
    summarizeActivityOverlaps: overlaps => overlaps,
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/modals.js', 'utf8'), context);
  return { context, elements };
}

function renderMemoryAidHtml({ activities, timelineActivities, zoom, hideEmptyActivityRows = false, timeEntries = [], projects = [] }) {
  const context = loadTimelineContext();
  let renderedHtml = '';

  context.state.zoom = zoom;
  context.state.activities = activities;
  context.state.timeEntries = timeEntries;
  context.state.projects = projects;
  context.state.settings.hideEmptyActivityRows = hideEmptyActivityRows;
  if (timelineActivities) {
    context.state.timelineActivities = timelineActivities;
  }
  context.DOM.elItemsMemoryAid = {
    set innerHTML(value) {
      renderedHtml = value;
    },
    get innerHTML() {
      return renderedHtml;
    },
    querySelectorAll() {
      return [];
    }
  };

  context.renderMemoryAidActivities();
  return renderedHtml;
}

function extractActivityStyles(html) {
  return [...html.matchAll(/class="([^"]*activity-block[^"]*)"[\s\S]*?style="([^"]+)"[\s\S]*?data-start-cell="([^"]+)"[\s\S]*?data-span="([^"]+)"/g)]
    .map(match => {
      const topPxMatch = match[2].match(/top:\s*([0-9.]+)px/);
      const heightPxMatch = match[2].match(/height:\s*([0-9.]+)px/);
      const topCalcMatch = match[2].match(/top:\s*calc\(var\(--row-height\) \* ([0-9.]+) \+ 2px\)/);
      const heightCalcMatch = match[2].match(/height:\s*calc\(var\(--row-height\) \* ([0-9.]+) - 3px\)/);
      return {
        className: match[1],
        style: match[2],
        top: topPxMatch ? Number(topPxMatch[1]) : (topCalcMatch ? Number(topCalcMatch[1]) * 40 + 2 : null),
        height: heightPxMatch ? Number(heightPxMatch[1]) : (heightCalcMatch ? Number(heightCalcMatch[1]) * 40 - 3 : null),
        startCell: Number(match[3]),
        span: Number(match[4])
      };
    });
}

async function refreshActivities({ rawActivities, thresholdSeconds }) {
  const context = {
    window: {},
    API_BASE: 'http://localhost:3000/api',
    state: {
      currentDate: new Date(2026, 4, 21),
      settings: {
        minActivityThreshold: thresholdSeconds
      },
      currentView: 'timeline'
    },
    DOM: {
      elActivityCount: { innerText: '' }
    },
    getFormattedDate: () => '2026-05-21',
    populateProjectDropdowns() {},
    fetch: async url => ({
      json: async () => url.includes('/activities') ? rawActivities : []
    }),
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/api.js', 'utf8'), context);

  await context.refreshData();
  return context.state;
}

function renderLoggedTimeEntriesHtml({ timeEntries, projects, zoom, activities = [], timelineActivities, hideEmptyActivityRows = false }) {
  const context = loadTimelineContext();
  let renderedHtml = '';

  context.state.zoom = zoom;
  context.state.projects = projects;
  context.state.timeEntries = timeEntries;
  context.state.activities = activities;
  context.state.settings.hideEmptyActivityRows = hideEmptyActivityRows;
  if (timelineActivities) {
    context.state.timelineActivities = timelineActivities;
  }
  context.DOM.elItemsTimeEntries = {
    set innerHTML(value) {
      renderedHtml = value;
    },
    get innerHTML() {
      return renderedHtml;
    },
    querySelectorAll() {
      return [];
    }
  };

  context.renderLoggedTimeEntries();
  return renderedHtml;
}

function codexActivity(start, end) {
  return {
    app: 'Codex',
    title: 'Codex',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex',
    start,
    end,
    duration: end - start
  };
}

function makeAutoRuleEntry({ id, start, end, projectId = 'project-1', ruleId = 'rule-1' }) {
  return {
    id,
    start,
    end,
    projectId,
    createdBy: 'auto-rule',
    autoRuleId: ruleId,
    description: '',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start,
      end,
      duration: end - start,
      assignedDurationMs: end - start,
      assignmentStart: start,
      assignmentEnd: end,
      assignmentSource: 'activity-stream',
      assignmentModel: 'auto-assigned-capture',
      assignmentDisplayZoom: 1,
      autoAssigned: true,
      autoAssignmentRuleId: ruleId
    }]
  };
}

function extractEntryStyles(html) {
  return [...html.matchAll(/class="([^"]*time-entry-block[^"]*)"[\s\S]*?style="([^"]+)"/g)]
    .map(match => {
      const topMatch = match[2].match(/top:\s*([0-9.]+)px/);
      const heightMatch = match[2].match(/height:\s*([0-9.]+)px/);
      const leftMatch = match[2].match(/left:\s*([^;]+);/);
      const widthMatch = match[2].match(/width:\s*([^;]+);/);
      const rightMatch = match[2].match(/right:\s*([^;]+);/);
      assert.ok(topMatch, `Expected pixel top in style: ${match[2]}`);
      assert.ok(heightMatch, `Expected pixel height in style: ${match[2]}`);
      return {
        className: match[1],
        style: match[2],
        top: Number(topMatch[1]),
        height: Number(heightMatch[1]),
        left: leftMatch ? leftMatch[1].trim() : null,
        width: widthMatch ? widthMatch[1].trim() : null,
        right: rightMatch ? rightMatch[1].trim() : null
      };
    });
}

function extractTimeEntryDurationLabels(html) {
  return [...html.matchAll(/<span class="duration-pill time-entry-duration shrink-0">([^<]+)<\/span>/g)]
    .map(match => match[1]);
}

function sumDurationLabelMinutes(labels) {
  return labels.reduce((total, label) => total + Number(label.match(/\d+/)?.[0] || 0), 0);
}

function expectedRowGeometry({ dateStart, start, end, zoom }) {
  const rowDurationMs = zoom * 60 * 1000;
  const startRow = Math.max(0, Math.floor((start - dateStart) / rowDurationMs));
  const endRow = Math.max(startRow + 1, Math.ceil((end - dateStart) / rowDurationMs));

  return {
    top: startRow * 40 + 2,
    height: (endRow - startRow) * 40 - 3
  };
}

function assertStyleMatchesRowGeometry(style, expected, message = '') {
  assert.equal(style.top, expected.top, message ? `${message} top` : undefined);
  assert.equal(style.height, expected.height, message ? `${message} height` : undefined);
  assert.equal((style.top - 2) % 40, 0, message ? `${message} top is row aligned` : undefined);
  assert.equal((style.height + 3) % 40, 0, message ? `${message} height is row aligned` : undefined);
}

function assertNoOverlappingBlockGeometry(styles, message = '') {
  const sortedStyles = [...styles].sort((left, right) => left.top - right.top || left.height - right.height);

  for (let index = 1; index < sortedStyles.length; index++) {
    const previous = sortedStyles[index - 1];
    const current = sortedStyles[index];
    assert.ok(
      previous.top + previous.height <= current.top,
      `${message ? `${message}: ` : ''}block at ${current.top}px overlaps previous block ending at ${previous.top + previous.height}px`
    );
  }
}

function extractGroupedEntryBounds(html) {
  const match = html.match(/data-group-start="([^"]+)"[\s\S]*?data-group-end="([^"]+)"/);
  assert.ok(match, 'Expected grouped entry bounds in rendered HTML');
  return {
    start: Number(match[1]),
    end: Number(match[2])
  };
}

function extractFirstTimeEntryBlockHtml(html) {
  const blockStart = html.indexOf('<div class="time-entry-block');
  assert.notEqual(blockStart, -1, 'Expected time entry block');
  const nextBlockStart = html.indexOf('<div class="time-entry-block', blockStart + 1);
  return html.slice(blockStart, nextBlockStart === -1 ? html.length : nextBlockStart);
}

function makeActivityStreamTimeEntry({
  id,
  dateStart,
  startMinute,
  endMinute,
  projectId = 'project-1',
  taskId = 'task-1',
  app = 'Codex',
  assignedMinutes,
  assignmentModel = 'activity-stream-summary',
  assignmentDisplayZoom = 1
}) {
  return {
    id,
    start: dateStart + startMinute * 60 * 1000,
    end: dateStart + endMinute * 60 * 1000,
    projectId,
    taskId,
    description: '',
    activities: [{
      app,
      title: app,
      start: dateStart + startMinute * 60 * 1000,
      end: dateStart + endMinute * 60 * 1000,
      duration: assignedMinutes * 60 * 1000,
      assignedDurationMs: assignedMinutes * 60 * 1000,
      assignmentStart: dateStart + startMinute * 60 * 1000,
      assignmentEnd: dateStart + endMinute * 60 * 1000,
      assignmentSource: 'activity-stream',
      assignmentModel,
      assignmentDisplayZoom
    }]
  };
}

test('compressed day row layout keeps visible activity and logged time rows at every zoom level', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const context = loadTimelineContext();
    const atRow = row => dateStart + row * zoom * 60 * 1000;
    const activityRows = [
      codexActivity(atRow(2), atRow(3)),
      {
        app: 'Brave Browser',
        title: 'Reference',
        url: 'https://example.com/reference',
        start: atRow(8),
        end: atRow(9),
        duration: atRow(9) - atRow(8)
      }
    ];
    const manualEntry = {
      id: `manual-${zoom}`,
      start: atRow(12),
      end: atRow(13),
      projectId: 'project-1',
      taskId: '',
      description: 'Manual row',
      billable: false,
      activities: []
    };

    context.state.zoom = zoom;
    context.state.settings.hideEmptyActivityRows = true;
    context.state.activities = activityRows;
    context.state.timelineActivities = activityRows;
    context.state.timeEntries = [manualEntry];

    const activityCells = context.buildVisibleActivityCells({
      dateStartOfDay: dateStart,
      zoom,
      ownershipActivities: activityRows,
      visibleActivities: activityRows
    });
    const timeEntryRenderItems = context.buildLoggedTimeEntryRenderItems([manualEntry], zoom, dateStart);
    const layout = context.buildDayTimelineRowLayout({
      dateStartOfDay: dateStart,
      zoom,
      activityCells,
      timeEntryRenderItems
    });

    assert.deepEqual(Array.from(layout.sourceRows), [2, 8, 12], `source rows at zoom ${zoom}`);
    assert.equal(context.getDisplayRowForSourceRow(layout, 8), 1, `source-to-display at zoom ${zoom}`);
    assert.equal(context.getSourceRowForDisplayRow(layout, 2), 12, `display-to-source at zoom ${zoom}`);
    assert.equal(context.getTimelineDisplayTopForTime(atRow(8), layout), 40, `display top at zoom ${zoom}`);
  }
});

test('compressed Activity Stream skips empty gaps without merging repeated activity blocks', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atRow = row => dateStart + row * 5 * 60 * 1000;
  const first = codexActivity(atRow(2), atRow(3));
  const second = codexActivity(atRow(8), atRow(9));
  const html = renderMemoryAidHtml({
    zoom: 5,
    activities: [first, second],
    timelineActivities: [first, second],
    hideEmptyActivityRows: true
  });
  const styles = extractActivityStyles(html);

  assert.equal(styles.length, 2);
  assert.deepEqual(styles.map(style => style.startCell), [2, 8]);
  assert.deepEqual(styles.map(style => style.span), [1, 1]);
  assert.deepEqual(styles.map(style => style.top), [2, 42]);
  assert.deepEqual(styles.map(style => style.height), [37, 37]);
});

test('compressed timeline grid keeps unassigned activity rows and manual time entry rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atRow = row => dateStart + row * 5 * 60 * 1000;
  const context = loadTimelineContext();
  let timeGridHtml = '';
  let timeItemsHeight = '';

  context.state.zoom = 5;
  context.state.settings.hideEmptyActivityRows = true;
  context.state.currentDate = new Date(2026, 4, 21);
  context.state.projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  context.state.activities = [
    codexActivity(atRow(2), atRow(3)),
    {
      app: 'Brave Browser',
      title: 'Unassigned Reference',
      url: 'https://example.com/reference',
      start: atRow(8),
      end: atRow(9),
      duration: atRow(9) - atRow(8)
    }
  ];
  context.state.timelineActivities = context.state.activities;
  context.state.timeEntries = [{
    id: 'manual-row',
    start: atRow(12),
    end: atRow(13),
    projectId: 'project-1',
    taskId: '',
    description: 'Manual row',
    billable: false,
    activities: []
  }];
  context.DOM.elGridMemoryAid = { set innerHTML(_value) {} };
  context.DOM.elGridTimeEntries = {
    set innerHTML(value) {
      timeGridHtml = value;
    }
  };
  context.DOM.elItemsMemoryAid = { style: {} };
  context.DOM.elItemsTimeEntries = {
    style: {
      set height(value) {
        timeItemsHeight = value;
      }
    }
  };

  context.renderTimelineGrids();
  const loggedHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: context.state.projects,
    activities: context.state.activities,
    timelineActivities: context.state.timelineActivities,
    timeEntries: context.state.timeEntries,
    hideEmptyActivityRows: true
  });
  const [manualStyle] = extractEntryStyles(loggedHtml);

  assert.match(timeGridHtml, />00:10</);
  assert.match(timeGridHtml, />00:40</);
  assert.match(timeGridHtml, />01:00</);
  assert.doesNotMatch(timeGridHtml, />00:15</);
  assert.equal(timeItemsHeight, '120px');
  assert.equal(manualStyle.top, 82);
  assert.equal(manualStyle.height, 37);
});

test('compressed Time Entries keep entry clicks but omit resize handles', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    hideEmptyActivityRows: true,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [],
    timeEntries: [{
      id: 'manual-row',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + 9 * 60 * 60 * 1000 + 30 * 60 * 1000,
      projectId: 'project-1',
      taskId: '',
      description: 'Manual row',
      billable: false,
      activities: []
    }]
  });

  assert.match(html, /class="time-entry-block/);
  assert.match(html, /data-id="manual-row"/);
  assert.doesNotMatch(html, /resize-handle-top/);
  assert.doesNotMatch(html, /resize-handle-bottom/);
});

test('jump to current time scrolls both timeline panes to the same current-time position', () => {
  const { context, memScroll, timeScroll } = loadScrollContext();

  context.jumpToCurrentTime();

  const expectedTop = ((10 * 60 + 30) / 30) * 40 - 200;
  assert.equal(memScroll.scrollTop, expectedTop);
  assert.equal(timeScroll.scrollTop, expectedTop);
  assert.equal(memScroll.scrollTop, timeScroll.scrollTop);
});

test('jump to current time applies the target immediately without waiting for smooth scrolling', () => {
  const { context, memScroll, timeScroll } = loadScrollContext();

  memScroll.scrollTo = function scrollTo(arg) {
    this.scrollToArg = arg;
  };
  timeScroll.scrollTo = function scrollTo(arg) {
    this.scrollToArg = arg;
  };

  context.jumpToCurrentTime();

  const expectedTop = ((10 * 60 + 30) / 30) * 40 - 200;
  assert.equal(memScroll.scrollTop, expectedTop);
  assert.equal(timeScroll.scrollTop, expectedTop);
});

test('timeline scroll sync does not ignore the next user scroll when programmatic events are skipped', () => {
  const { context, memScroll, timeScroll, flushAnimationFrame } = loadScrollContext();
  context.setupScrollSync();

  memScroll.scrollTop = 120;
  memScroll.dispatch('scroll');
  flushAnimationFrame();
  assert.equal(timeScroll.scrollTop, 120);

  timeScroll.scrollTop = 240;
  timeScroll.dispatch('scroll');
  flushAnimationFrame();
  assert.equal(memScroll.scrollTop, 240);
});

test('timeline scroll sync coalesces repeated scroll events into one frame write', () => {
  const { context, memScroll, timeScroll, flushAnimationFrame, pendingAnimationFrameCount } = loadScrollContext();
  context.setupScrollSync();

  memScroll.scrollTop = 120;
  memScroll.dispatch('scroll');
  memScroll.scrollTop = 180;
  memScroll.dispatch('scroll');
  memScroll.scrollTop = 220;
  memScroll.dispatch('scroll');

  assert.equal(pendingAnimationFrameCount(), 1);
  assert.equal(timeScroll.scrollTop, 0);
  assert.equal(timeScroll.scrollWrites, 0);

  flushAnimationFrame();

  assert.equal(timeScroll.scrollTop, 220);
  assert.equal(timeScroll.scrollWrites, 1);
});

function extractActivityDuration(html, title) {
  const blockHtml = extractActivityBlockHtml(html, title);
  const durationMatches = [...blockHtml.matchAll(/class="[^"]*\bduration-pill\b[^"]*"[^>]*>\s*([^<]+?)\s*<\/div>/g)];
  assert.ok(durationMatches.length > 0, `Expected duration badge for ${title}`);
  return durationMatches.at(-1)[1];
}

function extractActivityBlockHtml(html, title) {
  const titleIndex = html.indexOf(`data-title="${title}"`);
  assert.notEqual(titleIndex, -1, `Expected rendered activity block for ${title}`);

  const blockStart = html.lastIndexOf('<div class="activity-block', titleIndex);
  const blockEnd = html.indexOf('<button class="activity-quick-add', titleIndex);
  assert.notEqual(blockStart, -1, `Expected activity block start for ${title}`);
  assert.notEqual(blockEnd, -1, `Expected activity block end for ${title}`);
  return html.slice(blockStart, blockEnd);
}

function extractActivitySpan(html, title) {
  const titleIndex = html.indexOf(`data-title="${title}"`);
  assert.notEqual(titleIndex, -1, `Expected rendered activity block for ${title}`);

  const blockStart = html.lastIndexOf('<div class="activity-block', titleIndex);
  const spanMatch = html.slice(blockStart, titleIndex).match(/data-span="(\d+)"/);
  assert.ok(spanMatch, `Expected span for ${title}`);
  return Number(spanMatch[1]);
}

function extractActivityOverlaps(html, title) {
  const titleIndex = html.indexOf(`data-title="${title}"`);
  assert.notEqual(titleIndex, -1, `Expected rendered activity block for ${title}`);

  const blockStart = html.lastIndexOf('<div class="activity-block', titleIndex);
  const blockEnd = html.indexOf('<button class="activity-quick-add', titleIndex);
  const overlapsMatch = html.slice(blockStart, blockEnd).match(/data-overlaps="([^"]+)"/);
  assert.ok(overlapsMatch, `Expected overlaps for ${title}`);
  return JSON.parse(decodeURIComponent(overlapsMatch[1]));
}

function countActivityIcon(html, app) {
  return [...html.matchAll(new RegExp(`data-icon="${app}"`, 'g'))].length;
}

function renderActivityBlockChromeHtml({ app = 'Codex', title = 'Codex', url = '', overlaps, startCell = 153, span = 3, cleanTitle = title => title }) {
  const context = loadTimelineContext();
  context.state.zoom = 5;
  context.cleanTitle = cleanTitle;
  context.getActivityIconHTML = (iconApp) => `<span class="fake-icon" data-icon="${iconApp}"></span>`;
  return context.createActivityBlockHTML({
    startCell,
    span,
    app,
    title,
    url,
    appPath: '',
    bundleId: '',
    duration: span * 5 * 60 * 1000,
    overlaps
  });
}

function renderMultipleActivitiesPopup({ overlaps, app = 'Brave Browser', title = 'Brave Browser', url = '', startCell = 118, span = 3, cleanTitle = title => title }) {
  const context = loadTimelineContext();
  let renderedMultiList = '';
  let modalArgs = null;
  const createClassList = () => ({
    add() {},
    remove() {},
    contains() {
      return false;
    }
  });

  context.DOM.elPopupDuration = { innerText: '', title: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupTitle = { innerText: '' };
  context.cleanTitle = cleanTitle;
  context.DOM.elPopupSingleDetails = { classList: createClassList(), querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: createClassList() };
  context.DOM.elPopupUrlContainer = { classList: createClassList() };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
    },
    get innerHTML() {
      return renderedMultiList;
    },
    querySelectorAll() {
      return [];
    }
  };
  context.DOM.elPopupActivityMixContainer = { classList: createClassList(), setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupActivityMixLabel = { innerText: '' };
  context.DOM.elPopupActivityMixInfo = { setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = { style: {}, classList: createClassList() };
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;

  context.showActivityDetailsPopup({
    dataset: {
      startCell: String(startCell),
      span: String(span),
      app,
      title,
      url,
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify(overlaps))
    }
  });

  return {
    context,
    get renderedMultiList() {
      return renderedMultiList;
    },
    get modalArgs() {
      return modalArgs;
    }
  };
}

test('cleanTitle strips Brave Base profile suffixes', () => {
  const context = loadTitleCleaningContext();

  assert.equal(context.cleanTitle('Facebook - Brave - Base'), 'Facebook');
  assert.equal(context.cleanTitle('facebook - brave - base'), 'facebook');
});

test('cleanTitle applies default editable cleanup rules with app and URL scopes', () => {
  const context = loadTitleCleaningContext();

  assert.equal(
    context.cleanTitle('PewDiePie did it again - YouTube - Audio playing - Brave - Base', {
      app: 'Brave Browser',
      url: 'https://www.youtube.com/watch?v=ygscsZ09zPE'
    }),
    'PewDiePie did it again'
  );
  assert.equal(
    context.cleanTitle('Smoke City - Underwater Love - YouTube - Audio playing - High memory usage - 969 MB - Brave - Base', {
      app: 'Brave Browser',
      url: 'https://www.youtube.com/watch?v=abc'
    }),
    'Smoke City - Underwater Love'
  );
  assert.equal(
    context.cleanTitle('(1) IQOS Iluma Review - YouTube', {
      app: 'Brave Browser',
      url: 'https://www.youtube.com/watch?v=L5tCTMAZiGs'
    }),
    'IQOS Iluma Review'
  );
  assert.equal(
    context.cleanTitle('hiken - sil-so - Obsidian 1.12.7', {
      app: 'Obsidian',
      url: ''
    }),
    'hiken - sil-so'
  );
  assert.equal(
    context.cleanTitle('Research - YouTube', {
      app: 'Obsidian',
      url: ''
    }),
    'Research - YouTube'
  );
});

test('cleanTitle respects edited cleanup rule state and ignores invalid regex', () => {
  const context = loadTitleCleaningContext();
  context.state.settings.titleCleanupRules = [
    {
      id: 'strip-ticket',
      name: 'Strip Ticket',
      enabled: true,
      pattern: '\\s+\\[TICKET-\\d+\\]$',
      appContains: '',
      urlContains: ''
    },
    {
      id: 'disabled-audio',
      name: 'Disabled Audio',
      enabled: false,
      pattern: '\\s+-\\s*Audio playing',
      appContains: '',
      urlContains: ''
    },
    {
      id: 'invalid',
      name: 'Invalid',
      enabled: true,
      pattern: '[',
      appContains: '',
      urlContains: ''
    }
  ];

  assert.equal(context.cleanTitle('Client Portal [TICKET-123]'), 'Client Portal');
  assert.equal(context.cleanTitle('Video - Audio playing'), 'Video - Audio playing');
});

test('logged time entries are rendered without relative positioning', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  let renderedHtml = '';

  context.state.projects = [
    { id: 'project-1', name: 'Project One', color: '#3b82f6' },
    { id: 'project-2', name: 'Project Two', color: '#10b981' }
  ];
  context.state.timeEntries = [
    {
      id: 'entry-1',
      start: dateStart + (9 * 60 + 10) * 60 * 1000,
      end: dateStart + (9 * 60 + 25) * 60 * 1000,
      projectId: 'project-1',
      description: 'First entry'
    },
    {
      id: 'entry-2',
      start: dateStart + (9 * 60 + 25) * 60 * 1000,
      end: dateStart + (9 * 60 + 45) * 60 * 1000,
      projectId: 'project-2',
      description: 'Second entry'
    }
  ];
  context.DOM.elItemsTimeEntries = {
    set innerHTML(value) {
      renderedHtml = value;
    },
    get innerHTML() {
      return renderedHtml;
    },
    querySelectorAll() {
      return [];
    }
  };

  context.renderLoggedTimeEntries();

  const blockClassMatches = [...renderedHtml.matchAll(/class="([^"]*time-entry-block[^"]*)"/g)];
  assert.equal(blockClassMatches.length, 2);
  for (const match of blockClassMatches) {
    assert.equal(match[1].split(/\s+/).includes('relative'), false);
  }
});

test('logged time entries use row-aligned display geometry at every zoom level', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [
    { id: 'project-1', name: 'Project One', color: '#3b82f6' },
    { id: 'project-2', name: 'Project Two', color: '#10b981' }
  ];
  const timeEntries = [
    {
      id: 'entry-1',
      start: dateStart + (9 * 60 + 4) * 60 * 1000 + 15 * 1000,
      end: dateStart + (9 * 60 + 6) * 60 * 1000 + 10 * 1000,
      projectId: 'project-1',
      description: 'First entry'
    },
    {
      id: 'entry-2',
      start: dateStart + (9 * 60 + 20) * 60 * 1000,
      end: dateStart + (9 * 60 + 35) * 60 * 1000,
      projectId: 'project-2',
      description: 'Second entry'
    }
  ];

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({ timeEntries, projects, zoom });
    const styles = extractEntryStyles(html);
    assert.equal(styles.length, 2);

    assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
      dateStart,
      start: timeEntries[0].start,
      end: timeEntries[0].end,
      zoom
    }), `first entry at zoom ${zoom}`);
    assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
      dateStart,
      start: timeEntries[1].start,
      end: timeEntries[1].end,
      zoom
    }), `second entry at zoom ${zoom}`);
    assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min', '15 min']);
  }
});

test('logged time entries render at least one full row high for short entries', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 30,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (9 * 60) * 60 * 1000,
        end: dateStart + (9 * 60 + 20) * 60 * 1000,
        projectId: 'project-1',
        description: 'Short entry'
      },
      {
        id: 'entry-2',
        start: dateStart + (10 * 60) * 60 * 1000,
        end: dateStart + (10 * 60 + 5) * 60 * 1000,
        projectId: 'project-1',
        description: 'Tiny entry'
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles[0].height, 37);
  assert.equal(styles[1].height, 37);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (9 * 60) * 60 * 1000,
    end: dateStart + (9 * 60 + 20) * 60 * 1000,
    zoom: 30
  }));
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: dateStart + (10 * 60) * 60 * 1000,
    end: dateStart + (10 * 60 + 5) * 60 * 1000,
    zoom: 30
  }));
});

test('assigned activity entries use saved run bounds for row placement and assigned duration for label', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (13 * 60 + 32) * 60 * 1000,
        end: dateStart + (13 * 60 + 37) * 60 * 1000,
        projectId: 'project-1',
        description: '',
        activities: [{ app: 'Codex', assignedDurationMs: 235 * 1000 }]
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles[0].top, (13 * 60 + 32) * 40 + 2);
  assert.equal(styles[0].height, 5 * 40 - 3);
  assert.match(html, /<span class="duration-pill time-entry-duration shrink-0">4 min<\/span>/);
});

test('legacy activity-stream assignment envelopes render from recorded activity runs', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const codexRunStart = dateStart + (13 * 60 + 3) * 60 * 1000;
  const codexRunEnd = dateStart + (13 * 60 + 4) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [
      {
        app: 'Brave Browser',
        title: 'Oriel Local Time Tracker',
        url: 'http://localhost',
        start: dateStart + (13 * 60) * 60 * 1000,
        end: dateStart + (13 * 60 + 2) * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: codexRunStart,
        end: codexRunEnd,
        duration: 60 * 1000
      }
    ],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (13 * 60) * 60 * 1000,
        end: dateStart + (13 * 60 + 5) * 60 * 1000,
        projectId: 'project-1',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: dateStart + (13 * 60) * 60 * 1000,
          end: dateStart + (13 * 60 + 5) * 60 * 1000,
          assignedDurationMs: 2 * 60 * 1000,
          assignmentSource: 'activity-stream'
        }]
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assert.equal(styles[0].top, (13 * 60 + 3) * 40 + 2);
  assert.equal(styles[0].height, 40 - 3);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min']);
});

test('legacy activity-stream assignment envelopes split across recorded activity gaps', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (13 * 60 + 16) * 60 * 1000;
  const firstEnd = dateStart + (13 * 60 + 21) * 60 * 1000;
  const secondStart = dateStart + (13 * 60 + 24) * 60 * 1000;
  const secondEnd = dateStart + (13 * 60 + 25) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: firstStart,
        end: firstEnd,
        duration: 5 * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: secondStart,
        end: secondEnd,
        duration: 60 * 1000
      }
    ],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (13 * 60 + 15) * 60 * 1000,
        end: dateStart + (13 * 60 + 25) * 60 * 1000,
        projectId: 'project-1',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: dateStart + (13 * 60 + 15) * 60 * 1000,
          end: dateStart + (13 * 60 + 25) * 60 * 1000,
          assignedDurationMs: 7 * 60 * 1000,
          assignmentSource: 'activity-stream'
        }]
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assert.equal(styles[0].top, (13 * 60 + 16) * 40 + 2);
  assert.equal(styles[0].height, 5 * 40 - 3);
  assert.equal(styles[1].top, (13 * 60 + 24) * 40 + 2);
  assert.equal(styles[1].height, 40 - 3);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['5 min', '1 min']);
});

test('touching activity-stream assignment entries with same project group into one visual block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (9 * 60) * 60 * 1000;
  const secondEnd = dateStart + (9 * 60 + 10) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, assignedMinutes: 4 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 5, endMinute: 9 * 60 + 10, assignedMinutes: 5 })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: secondEnd,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['9 min']);
});

test('activity-stream assignment entries use row-aligned geometry while keeping exact duration badges', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + (9 * 60 + 4) * 60 * 1000;
  const end = dateStart + (9 * 60 + 6) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 9 * 60 + 4,
        endMinute: 9 * 60 + 6,
        assignedMinutes: 1
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start,
    end,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min']);
});

test('resolved activity-stream assignment entries stay row-aligned at all zoom levels', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 9 * 60 + 4,
      endMinute: 9 * 60 + 6,
      assignedMinutes: 1
    })
  ];

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({
      zoom,
      projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
      timeEntries
    });
    const styles = extractEntryStyles(html);

    assert.equal(styles.length, 1, `Expected one assigned block at zoom ${zoom}`);
    assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
      dateStart,
      start: timeEntries[0].start,
      end: timeEntries[0].end,
      zoom
    }), `assigned entry at zoom ${zoom}`);
    assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min']);
  }
});

test('cross-zoom activity-stream assignments merge adjacent row projections while showing visible durations', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (7 * 60 + 35) * 60 * 1000,
      end: dateStart + (7 * 60 + 55) * 60 * 1000,
      duration: 20 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (8 * 60 + 10) * 60 * 1000,
      end: dateStart + (8 * 60 + 50) * 60 * 1000,
      duration: 40 * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 7 * 60 + 35,
      endMinute: 7 * 60 + 55,
      assignedMinutes: 18,
      assignmentDisplayZoom: 5
    }),
    makeActivityStreamTimeEntry({
      id: 'entry-2',
      dateStart,
      startMinute: 8 * 60 + 10,
      endMinute: 8 * 60 + 50,
      assignedMinutes: 28,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 15, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (7 * 60 + 35) * 60 * 1000,
    end: dateStart + (8 * 60 + 50) * 60 * 1000,
    zoom: 15
  }));
  assert.doesNotMatch(styles[0].className, /\btime-entry-block--partial-assignment\b/);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['60 min']);
});

test('cross-zoom projected rows expand to visible Activity Stream blocks and show visible durations', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (16 * 60 + 45) * 60 * 1000,
      end: dateStart + 17 * 60 * 60 * 1000,
      duration: 8.3 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (17 * 60 + 5) * 60 * 1000,
      end: dateStart + (17 * 60 + 20) * 60 * 1000,
      duration: 7.1 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (17 * 60 + 20) * 60 * 1000,
      end: dateStart + (17 * 60 + 30) * 60 * 1000,
      duration: 3 * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 16 * 60 + 45,
      endMinute: 17 * 60,
      assignedMinutes: 8.3,
      assignmentDisplayZoom: 5
    }),
    makeActivityStreamTimeEntry({
      id: 'entry-2',
      dateStart,
      startMinute: 17 * 60 + 5,
      endMinute: 17 * 60 + 20,
      assignedMinutes: 7.1,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 15, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (16 * 60 + 45) * 60 * 1000,
    end: dateStart + (17 * 60 + 30) * 60 * 1000,
    zoom: 15
  }));
  assert.doesNotMatch(styles[0].className, /\btime-entry-block--partial-assignment\b/);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['40 min']);
});

test('coarse Activity Stream rows expand overlapping finer-zoom saved assignments for display', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + (9 * 60 + 30) * 60 * 1000,
      duration: 21 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (9 * 60 + 30) * 60 * 1000,
      end: dateStart + 10 * 60 * 60 * 1000,
      duration: 2 * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 9 * 60,
      endMinute: 9 * 60 + 30,
      assignedMinutes: 21,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 30, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + 10 * 60 * 60 * 1000,
    zoom: 30
  }));
  assert.doesNotMatch(styles[0].className, /\btime-entry-block--partial-assignment\b/);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['60 min']);
});

test('activity-stream assignments project onto current zoom rows with matching secondary activity', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const codexIdentity = {
    app: 'Codex',
    title: 'Codex',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex'
  };
  const activities = [
    {
      ...codexIdentity,
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + (9 * 60 + 21) * 60 * 1000
    },
    {
      app: 'Obsidian',
      title: 'Obsidian',
      appPath: '/Applications/Obsidian.app',
      bundleId: 'md.obsidian',
      start: dateStart + (9 * 60 + 30) * 60 * 1000,
      end: dateStart + (9 * 60 + 47) * 60 * 1000
    },
    {
      ...codexIdentity,
      start: dateStart + (9 * 60 + 30) * 60 * 1000,
      end: dateStart + (9 * 60 + 32) * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 9 * 60,
      endMinute: 10 * 60,
      assignedMinutes: 23,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 30, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + 10 * 60 * 60 * 1000,
    zoom: 30
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['23 min']);
});

test('auto-assigned captures project to matching secondary row without expanding to owner block envelope', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const orielStart = dateStart + (22 * 60 + 30) * 60 * 1000;
  const orielEnd = dateStart + (22 * 60 + 55) * 60 * 1000;
  const codexStart = orielStart + 28 * 1000;
  const codexEnd = codexStart + 61 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      {
        app: 'Oriel',
        title: 'Oriel',
        appPath: '/Applications/Oriel.app',
        bundleId: 'so.sil.oriel',
        start: orielStart,
        end: orielEnd,
        duration: orielEnd - orielStart
      },
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: codexStart,
        end: codexEnd,
        duration: codexEnd - codexStart
      }
    ],
    timeEntries: [makeAutoRuleEntry({ id: 'entry-1', start: codexStart, end: codexEnd })]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: orielStart,
    end: orielStart + 5 * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min']);
});

test('short auto-assigned captures are hidden from the logged timeline', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const codexStart = dateStart + (23 * 60 + 28) * 60 * 1000 + 28 * 1000;
  const codexEnd = codexStart + 45 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }],
    timeEntries: [{
      id: 'entry-short-auto',
      start: codexStart,
      end: codexEnd,
      projectId: 'project-1',
      createdBy: 'auto-rule',
      autoRuleId: 'rule-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        start: codexStart,
        end: codexEnd,
        duration: codexEnd - codexStart,
        assignedDurationMs: codexEnd - codexStart,
        assignmentStart: codexStart,
        assignmentEnd: codexEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'auto-assigned-capture',
        assignmentDisplayZoom: 1,
        autoAssigned: true,
        autoAssignmentRuleId: 'rule-1'
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 0);
  assert.doesNotMatch(html, />0 min</);
});

test('same project auto-rule entries merge across adjacent display rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const firstStart = dateStart + (22 * 60 + 51) * 60 * 1000;
  const firstEnd = firstStart + 60 * 1000;
  const secondStart = firstEnd;
  const secondEnd = secondStart + 60 * 1000;

  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects,
    activities: [
      codexActivity(firstStart, firstEnd),
      codexActivity(secondStart, secondEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-1', start: firstStart, end: firstEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-2', start: secondStart, end: secondEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: secondEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('near-contiguous auto-rule capture fragments render as one assigned block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const baseStart = dateStart + (10 * 60 + 45) * 60 * 1000 + 43 * 1000;
  const ranges = [
    [baseStart, baseStart + 121400],
    [baseStart + 144400, baseStart + 368600],
    [baseStart + 385600, baseStart + 486700],
    [baseStart + 508600, baseStart + 704900]
  ];
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: ranges.map(([start, end]) => codexActivity(start, end)),
    timeEntries: ranges.map(([start, end], index) => makeAutoRuleEntry({ id: `entry-auto-${index + 1}`, start, end }))
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (10 * 60 + 45) * 60 * 1000,
    end: dateStart + (11 * 60) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['11 min']);
});

test('auto-rule row aggregation merges adjacent visible rows split by hidden boundary fragments', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const firstStart = dateStart + (13 * 60 + 20) * 60 * 1000;
  const firstEnd = dateStart + (13 * 60 + 33) * 60 * 1000;
  const hiddenBoundaryStart = dateStart + (13 * 60 + 35) * 60 * 1000 + 40 * 1000;
  const hiddenBoundaryEnd = hiddenBoundaryStart + 10 * 1000;
  const hiddenBoundarySecondStart = dateStart + (13 * 60 + 36) * 60 * 1000 + 10 * 1000;
  const hiddenBoundarySecondEnd = hiddenBoundarySecondStart + 30 * 1000;
  const laterSameRowStart = dateStart + (13 * 60 + 39) * 60 * 1000 + 20 * 1000;
  const laterSameRowEnd = dateStart + (13 * 60 + 41) * 60 * 1000 + 20 * 1000;
  const orielStart = dateStart + (13 * 60 + 35) * 60 * 1000;
  const orielEnd = dateStart + (13 * 60 + 39) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      codexActivity(firstStart, firstEnd),
      {
        app: 'Oriel',
        title: 'Oriel',
        appPath: '/Applications/Oriel.app',
        bundleId: 'so.sil.oriel',
        start: orielStart,
        end: orielEnd,
        duration: orielEnd - orielStart
      },
      codexActivity(hiddenBoundaryStart, hiddenBoundaryEnd),
      codexActivity(hiddenBoundarySecondStart, hiddenBoundarySecondEnd),
      codexActivity(laterSameRowStart, laterSameRowEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-before-boundary', start: firstStart, end: firstEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-hidden-boundary-1', start: hiddenBoundaryStart, end: hiddenBoundaryEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-hidden-boundary-2', start: hiddenBoundarySecondStart, end: hiddenBoundarySecondEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-later-same-row', start: laterSameRowStart, end: laterSameRowEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (13 * 60 + 20) * 60 * 1000,
    end: dateStart + (13 * 60 + 45) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['16 min']);
});

test('auto-rule projection skips one-minute rows without matching breakdown activity', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const firstStart = dateStart + (14 * 60 + 31) * 60 * 1000;
  const firstEnd = dateStart + (14 * 60 + 32) * 60 * 1000;
  const secondStart = dateStart + (14 * 60 + 33) * 60 * 1000;
  const secondEnd = dateStart + (14 * 60 + 35) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects,
    activities: [
      codexActivity(firstStart, firstEnd),
      {
        app: 'Brave Browser',
        title: 'Brave Browser',
        appPath: '/Applications/Brave Browser.app',
        bundleId: 'com.brave.Browser',
        start: firstEnd,
        end: secondStart,
        duration: secondStart - firstEnd
      },
      codexActivity(secondStart, secondEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-1', start: firstStart, end: firstEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-2', start: secondStart, end: secondEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 2);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: firstStart + 60 * 1000,
    zoom: 1
  }));
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: secondStart,
    end: secondEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min', '2 min']);
});

test('auto-rule projection skips hidden secondary rows before a visible owner group', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const firstHiddenStart = dateStart + (22 * 60 + 36) * 60 * 1000 + 45 * 1000;
  const firstOwnerEnd = dateStart + (22 * 60 + 37) * 60 * 1000 + 55 * 1000;
  const bridgeHiddenStart = dateStart + (22 * 60 + 38) * 60 * 1000 + 40 * 1000;
  const visibleOwnerStart = dateStart + (22 * 60 + 39) * 60 * 1000;
  const visibleOwnerEnd = dateStart + (22 * 60 + 44) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects,
    activities: [
      {
        app: 'Oriel',
        title: 'Oriel',
        appPath: '/Applications/Oriel.app',
        bundleId: 'so.sil.oriel',
        start: dateStart + (22 * 60 + 36) * 60 * 1000,
        end: dateStart + (22 * 60 + 36) * 60 * 1000 + 25 * 1000,
        duration: 25 * 1000
      },
      codexActivity(firstHiddenStart, firstOwnerEnd),
      {
        app: 'Shottr',
        title: 'Shottr',
        appPath: '/Applications/Shottr.app',
        bundleId: 'cc.ffitch.shottr',
        start: dateStart + (22 * 60 + 38) * 60 * 1000,
        end: dateStart + (22 * 60 + 38) * 60 * 1000 + 35 * 1000,
        duration: 35 * 1000
      },
      codexActivity(bridgeHiddenStart, visibleOwnerEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-hidden-before', start: firstHiddenStart, end: firstOwnerEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-visible-after', start: bridgeHiddenStart, end: visibleOwnerEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: visibleOwnerStart,
    end: visibleOwnerEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['5 min']);
});

test('auto-rule projection does not merge a tiny later secondary row into a visible group', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const codexStart = dateStart + (14 * 60 + 31) * 60 * 1000;
  const codexEnd = dateStart + (14 * 60 + 35) * 60 * 1000 + 10 * 1000;
  const tinyCodexStart = dateStart + (14 * 60 + 42) * 60 * 1000 + 5 * 1000;
  const tinyCodexEnd = tinyCodexStart + 4 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      codexActivity(codexStart, codexEnd),
      {
        app: 'Oriel',
        title: 'Oriel',
        appPath: '/Applications/Oriel.app',
        bundleId: 'so.sil.oriel',
        start: dateStart + (14 * 60 + 35) * 60 * 1000 + 10 * 1000,
        end: dateStart + (14 * 60 + 45) * 60 * 1000,
        duration: 590 * 1000
      },
      codexActivity(tinyCodexStart, tinyCodexEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-main', start: codexStart, end: codexEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-tiny', start: tinyCodexStart, end: tinyCodexEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (14 * 60 + 30) * 60 * 1000,
    end: dateStart + (14 * 60 + 35) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['4 min']);
});

test('auto-rule secondary projection starts at the matching cell instead of the merged owner block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const orielStart = dateStart + (21 * 60 + 55) * 60 * 1000;
  const orielEnd = dateStart + (22 * 60 + 5) * 60 * 1000;
  const codexStart = dateStart + (22 * 60 + 2) * 60 * 1000;
  const codexEnd = dateStart + (22 * 60 + 4) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      {
        app: 'Oriel',
        title: 'Oriel',
        appPath: '/Applications/Oriel.app',
        bundleId: 'so.sil.oriel',
        start: orielStart,
        end: orielEnd,
        duration: orielEnd - orielStart
      },
      codexActivity(codexStart, codexEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-secondary', start: codexStart, end: codexEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + 22 * 60 * 60 * 1000,
    end: dateStart + (22 * 60 + 5) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('auto-rule projected fragments stay hidden until their visible group reaches one minute', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const shortStart = dateStart + (16 * 60 + 10) * 60 * 1000;
  const shortEnd = shortStart + 59 * 1000;
  const visibleStart = dateStart + (16 * 60 + 20) * 60 * 1000;
  const visibleFirstEnd = visibleStart + 30 * 1000;
  const visibleSecondStart = visibleStart + 2 * 60 * 1000;
  const visibleSecondEnd = visibleSecondStart + 31 * 1000;
  const shortHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [codexActivity(shortStart, shortEnd)],
    timeEntries: [makeAutoRuleEntry({ id: 'entry-auto-short', start: shortStart, end: shortEnd })]
  });
  const visibleHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      codexActivity(visibleStart, visibleFirstEnd),
      codexActivity(visibleSecondStart, visibleSecondEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-visible-1', start: visibleStart, end: visibleFirstEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-visible-2', start: visibleSecondStart, end: visibleSecondEnd })
    ]
  });

  assert.equal(extractEntryStyles(shortHtml).length, 0);
  assert.equal(extractEntryStyles(visibleHtml).length, 1);
  assert.deepEqual(extractTimeEntryDurationLabels(visibleHtml), ['1 min']);
});

test('auto-rule secondary snippets stay hidden until their row group reaches one minute', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const hiddenRowStart = dateStart + (17 * 60 + 10) * 60 * 1000;
  const visibleRowStart = dateStart + (17 * 60 + 20) * 60 * 1000;
  const orielBlock = (start) => ({
    app: 'Oriel',
    title: 'Oriel',
    appPath: '/Applications/Oriel.app',
    bundleId: 'so.sil.oriel',
    start,
    end: start + 5 * 60 * 1000,
    duration: 5 * 60 * 1000
  });
  const hiddenStart = hiddenRowStart + 60 * 1000;
  const hiddenEnd = hiddenStart + 59 * 1000;
  const visibleFirstStart = visibleRowStart + 60 * 1000;
  const visibleFirstEnd = visibleFirstStart + 30 * 1000;
  const visibleSecondStart = visibleRowStart + 3 * 60 * 1000;
  const visibleSecondEnd = visibleSecondStart + 31 * 1000;
  const hiddenHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      orielBlock(hiddenRowStart),
      codexActivity(hiddenStart, hiddenEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-hidden-secondary', start: hiddenStart, end: hiddenEnd })
    ]
  });
  const visibleHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      orielBlock(visibleRowStart),
      codexActivity(visibleFirstStart, visibleFirstEnd),
      codexActivity(visibleSecondStart, visibleSecondEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-visible-secondary-1', start: visibleFirstStart, end: visibleFirstEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-visible-secondary-2', start: visibleSecondStart, end: visibleSecondEnd })
    ]
  });

  assert.equal(extractEntryStyles(hiddenHtml).length, 0);
  assert.equal(extractEntryStyles(visibleHtml).length, 1);
  assertStyleMatchesRowGeometry(extractEntryStyles(visibleHtml)[0], expectedRowGeometry({
    dateStart,
    start: visibleRowStart,
    end: visibleRowStart + 5 * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(visibleHtml), ['1 min']);
});

test('activity-stream assignments include earlier current zoom rows when the assigned app is secondary', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const codexIdentity = {
    app: 'Codex',
    title: 'Codex',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex'
  };
  const activities = [
    {
      app: 'Brave Browser',
      title: 'Brave Browser',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: dateStart + (18 * 60 + 30) * 60 * 1000,
      end: dateStart + (18 * 60 + 46) * 60 * 1000
    },
    {
      ...codexIdentity,
      start: dateStart + (18 * 60 + 30) * 60 * 1000,
      end: dateStart + (18 * 60 + 32) * 60 * 1000
    },
    {
      ...codexIdentity,
      start: dateStart + 19 * 60 * 60 * 1000,
      end: dateStart + (19 * 60 + 13) * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 18 * 60 + 30,
      endMinute: 19 * 60 + 30,
      assignedMinutes: 15,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 30, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (18 * 60 + 30) * 60 * 1000,
    end: dateStart + (19 * 60 + 30) * 60 * 1000,
    zoom: 30
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['15 min']);
});

test('activity-stream assignments still skip current zoom rows without matching breakdown activity', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + (9 * 60 + 20) * 60 * 1000
    },
    {
      app: 'Obsidian',
      title: 'Obsidian',
      appPath: '/Applications/Obsidian.app',
      bundleId: 'md.obsidian',
      start: dateStart + (9 * 60 + 30) * 60 * 1000,
      end: dateStart + (9 * 60 + 50) * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 9 * 60,
      endMinute: 10 * 60,
      assignedMinutes: 20,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 30, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + (9 * 60 + 30) * 60 * 1000,
    zoom: 30
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['20 min']);
});

test('coarse saved assignments project only onto matching current zoom Activity Stream rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (7 * 60 + 30) * 60 * 1000,
      end: dateStart + (7 * 60 + 45) * 60 * 1000,
      duration: 20 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (8 * 60 + 15) * 60 * 1000,
      end: dateStart + (8 * 60 + 45) * 60 * 1000,
      duration: 27 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + (9 * 60 + 15) * 60 * 1000,
      duration: 8 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (9 * 60 + 15) * 60 * 1000,
      end: dateStart + (9 * 60 + 30) * 60 * 1000,
      duration: 12 * 60 * 1000
    },
    {
      app: 'Obsidian',
      title: 'Obsidian',
      appPath: '/Applications/Obsidian.app',
      bundleId: 'md.obsidian',
      start: dateStart + (9 * 60 + 30) * 60 * 1000,
      end: dateStart + (9 * 60 + 45) * 60 * 1000,
      duration: 20 * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 7 * 60 + 30,
      endMinute: 9 * 60 + 45,
      assignedMinutes: 67,
      assignmentDisplayZoom: 30
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 15, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 3);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (7 * 60 + 30) * 60 * 1000,
    end: dateStart + (7 * 60 + 45) * 60 * 1000,
    zoom: 15
  }));
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: dateStart + (8 * 60 + 15) * 60 * 1000,
    end: dateStart + (8 * 60 + 45) * 60 * 1000,
    zoom: 15
  }));
  assertStyleMatchesRowGeometry(styles[2], expectedRowGeometry({
    dateStart,
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + (9 * 60 + 30) * 60 * 1000,
    zoom: 15
  }));
  assertNoOverlappingBlockGeometry(styles);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['15 min', '30 min', '30 min']);
  assert.equal(sumDurationLabelMinutes(extractTimeEntryDurationLabels(html)), 75);
});

test('summary assignments fall back to saved row-aligned range when Activity Stream data is unavailable', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 15,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 7 * 60 + 30,
        endMinute: 9 * 60 + 45,
        assignedMinutes: 67,
        assignmentDisplayZoom: 30
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (7 * 60 + 30) * 60 * 1000,
    end: dateStart + (9 * 60 + 45) * 60 * 1000,
    zoom: 15
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['67 min']);
});

test('summary assignment display expands to the overlapping visible Activity Stream block boundary', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const visibleStart = dateStart + (8 * 60 + 9) * 60 * 1000;
  const visibleEnd = dateStart + (8 * 60 + 12) * 60 * 1000;
  const savedStart = dateStart + (8 * 60 + 10) * 60 * 1000;
  const savedEnd = dateStart + (8 * 60 + 50) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: visibleStart,
      end: visibleEnd,
      duration: visibleEnd - visibleStart
    }],
    timeEntries: [{
      id: 'entry-1',
      start: savedStart,
      end: savedEnd,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: savedStart,
        end: savedEnd,
        duration: 27 * 60 * 1000,
        assignedDurationMs: 27 * 60 * 1000,
        assignmentStart: savedStart,
        assignmentEnd: savedEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 5
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: visibleStart,
    end: visibleEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['3 min']);
});

test('summary assignment timeline badge uses visible projected duration instead of saved accounting duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + (19 * 60 + 20) * 60 * 1000;
  const blockEnd = dateStart + (19 * 60 + 22) * 60 * 1000;
  const savedEnd = dateStart + (19 * 60 + 25) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: blockStart,
      end: blockEnd,
      duration: blockEnd - blockStart
    }],
    timeEntries: [{
      id: 'entry-1',
      start: blockStart,
      end: savedEnd,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: blockStart,
        end: savedEnd,
        duration: 140.9 * 1000,
        assignedDurationMs: 140.9 * 1000,
        assignmentStart: blockStart,
        assignmentEnd: savedEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 5
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: blockStart,
    end: blockEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('summary assignment split fragments use visible Activity Stream durations without saved normalization', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (17 * 60 + 8) * 60 * 1000;
  const firstEnd = dateStart + (17 * 60 + 10) * 60 * 1000;
  const secondStart = dateStart + (17 * 60 + 15) * 60 * 1000;
  const secondEnd = dateStart + (17 * 60 + 17) * 60 * 1000;
  const savedStart = dateStart + (17 * 60 + 5) * 60 * 1000;
  const savedEnd = dateStart + (17 * 60 + 20) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: firstStart,
        end: firstEnd,
        duration: firstEnd - firstStart
      },
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: secondStart,
        end: secondEnd,
        duration: secondEnd - secondStart
      }
    ],
    timeEntries: [{
      id: 'entry-1',
      start: savedStart,
      end: savedEnd,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: savedStart,
        end: savedEnd,
        duration: 422.9 * 1000,
        assignedDurationMs: 422.9 * 1000,
        assignmentStart: savedStart,
        assignmentEnd: savedEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 5
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: firstEnd,
    zoom: 1
  }));
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: secondStart,
    end: secondEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min', '2 min']);
});

test('merged summary assignment blocks de-dupe shared visible Activity Stream duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const visibleStart = dateStart + (16 * 60 + 44) * 60 * 1000;
  const visibleEnd = dateStart + (16 * 60 + 51) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: visibleStart,
      end: visibleEnd,
      duration: visibleEnd - visibleStart
    }],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (16 * 60 + 30) * 60 * 1000,
        end: dateStart + (16 * 60 + 45) * 60 * 1000,
        projectId: 'project-1',
        description: '',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: dateStart + (16 * 60 + 30) * 60 * 1000,
          end: dateStart + (16 * 60 + 45) * 60 * 1000,
          duration: 51.7 * 1000,
          assignedDurationMs: 51.7 * 1000,
          assignmentStart: dateStart + (16 * 60 + 30) * 60 * 1000,
          assignmentEnd: dateStart + (16 * 60 + 45) * 60 * 1000,
          assignmentSource: 'activity-stream',
          assignmentModel: 'activity-stream-summary',
          assignmentDisplayZoom: 5
        }]
      },
      {
        id: 'entry-2',
        start: dateStart + (16 * 60 + 45) * 60 * 1000,
        end: dateStart + 17 * 60 * 60 * 1000,
        projectId: 'project-1',
        description: '',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: dateStart + (16 * 60 + 45) * 60 * 1000,
          end: dateStart + 17 * 60 * 60 * 1000,
          duration: 500.5 * 1000,
          assignedDurationMs: 500.5 * 1000,
          assignmentStart: dateStart + (16 * 60 + 45) * 60 * 1000,
          assignmentEnd: dateStart + 17 * 60 * 60 * 1000,
          assignmentSource: 'activity-stream',
          assignmentModel: 'activity-stream-summary',
          assignmentDisplayZoom: 5
        }]
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: visibleStart,
    end: visibleEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['7 min']);
});

test('summary assignment projection hides standalone short matching activity rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + 9 * 60 * 60 * 1000;
  const end = start + 45 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start,
      end,
      duration: 45 * 1000
    }],
    timeEntries: [{
      id: 'entry-1',
      start,
      end,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start,
        end,
        duration: 45 * 1000,
        assignedDurationMs: 45 * 1000,
        assignmentStart: start,
        assignmentEnd: end,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 1
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 0);
  assert.doesNotMatch(html, />0 min</);
});

test('strong native summary assignments prefer exact document titles over weak same-app buckets', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const rangeStart = dateStart + (21 * 60 + 40) * 60 * 1000;
  const rangeEnd = dateStart + (22 * 60 + 10) * 60 * 1000;
  const assignment = {
    app: 'Figma',
    title: 'macOS Big Sur icon template (Community)',
    appPath: '/Applications/Figma.app',
    bundleId: 'com.figma.Desktop',
    start: rangeStart,
    end: rangeEnd,
    duration: 15 * 60 * 1000,
    assignedDurationMs: 15 * 60 * 1000,
    assignmentStart: rangeStart,
    assignmentEnd: rangeEnd,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayZoom: 10
  };
  const overlaps = [
    {
      app: 'Figma',
      title: 'Figma',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: rangeStart + 5 * 60 * 1000,
      end: rangeStart + 5 * 60 * 1000 + 16 * 1000,
      duration: 16 * 1000
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: rangeStart + 7 * 60 * 1000,
      end: rangeStart + 21 * 60 * 1000,
      duration: 14 * 60 * 1000
    }
  ];

  const summary = context.getActivitySummaryForAssignmentWithinRange(
    overlaps,
    assignment,
    context.getActivitySummaryKey(assignment),
    rangeStart,
    rangeEnd
  );

  assert.equal(summary.title, 'macOS Big Sur icon template (Community)');
  assert.equal(summary.duration, 14 * 60 * 1000);
});

test('weak native summary assignments project to dominant same-app document rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const rangeStart = dateStart + (21 * 60 + 40) * 60 * 1000;
  const rangeEnd = dateStart + (22 * 60 + 10) * 60 * 1000;
  const weakFigmaStart = rangeStart + 5 * 60 * 1000;
  const weakFigmaEnd = weakFigmaStart + 16 * 1000;
  const documentStart = rangeStart + 7 * 60 * 1000;
  const documentEnd = documentStart + 14 * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 10,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [
      {
        app: 'Figma',
        title: 'Figma',
        appPath: '/Applications/Figma.app',
        bundleId: 'com.figma.Desktop',
        start: weakFigmaStart,
        end: weakFigmaEnd,
        duration: weakFigmaEnd - weakFigmaStart
      },
      {
        app: 'Figma',
        title: 'macOS Big Sur icon template (Community)',
        appPath: '/Applications/Figma.app',
        bundleId: 'com.figma.Desktop',
        start: documentStart,
        end: documentEnd,
        duration: documentEnd - documentStart
      }
    ],
    timeEntries: [{
      id: 'entry-figma',
      start: rangeStart,
      end: rangeEnd,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Figma',
        title: 'Figma',
        appPath: '/Applications/Figma.app',
        bundleId: 'com.figma.Desktop',
        start: rangeStart,
        end: rangeEnd,
        duration: documentEnd - documentStart,
        assignedDurationMs: documentEnd - documentStart,
        assignmentStart: rangeStart,
        assignmentEnd: rangeEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 10
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: rangeStart,
    end: rangeEnd,
    zoom: 10
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['14 min']);
});

test('native popup summary assignments render same-app selected duration from real Figma-shaped rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atMs = (hours, minutes, seconds = 0, ms = 0) => (
    dateStart + (((hours * 60 + minutes) * 60 + seconds) * 1000) + ms
  );
  const rangeStart = atMs(21, 40);
  const rangeEnd = atMs(22, 10);
  const activities = [
    {
      app: 'Figma',
      title: 'Figma',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 45, 53, 688),
      end: atMs(21, 45, 55, 972),
      duration: 2284
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 46, 27, 186),
      end: atMs(21, 46, 28, 431),
      duration: 1245
    },
    {
      app: 'Figma',
      title: '',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 46, 28, 427),
      end: atMs(21, 46, 30, 428),
      duration: 2001
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 46, 30, 427),
      end: atMs(21, 46, 38, 49),
      duration: 7622
    },
    {
      app: 'Finder',
      title: 'Downloads',
      appPath: '/System/Library/CoreServices/Finder.app',
      bundleId: 'com.apple.finder',
      start: atMs(21, 46, 40, 427),
      end: atMs(21, 46, 47, 730),
      duration: 7303
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 46, 47, 727),
      end: atMs(21, 47, 43, 616),
      duration: 55889
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 47, 44, 207),
      end: atMs(21, 50, 37, 671),
      duration: 173464
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 52, 33, 671),
      end: atMs(21, 52, 35, 322),
      duration: 1651
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 52, 35, 766),
      end: atMs(21, 58, 48, 425),
      duration: 372659
    },
    {
      app: 'Figma',
      title: 'Home',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 58, 48, 424),
      end: atMs(21, 58, 50, 516),
      duration: 2092
    },
    {
      app: 'Figma',
      title: 'Stars, Icon, Shapes, Symbols, v2 (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 58, 50, 516),
      end: atMs(21, 59, 28, 424),
      duration: 37908
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 59, 28, 423),
      end: atMs(22, 2, 59, 37),
      duration: 210614
    },
    {
      app: 'Figma',
      title: 'Figma',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(22, 2, 58, 422),
      end: atMs(22, 3, 8, 422),
      duration: 10000
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(22, 3, 8, 421),
      end: atMs(22, 3, 9, 787),
      duration: 1366
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(22, 3, 23, 198),
      end: atMs(22, 3, 36, 425),
      duration: 13227
    },
    {
      app: 'Figma',
      title: 'Figma',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(22, 3, 36, 422),
      end: atMs(22, 3, 40, 612),
      duration: 4190
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(22, 3, 40, 422),
      end: atMs(22, 3, 41, 884),
      duration: 1462
    }
  ];
  const html = renderLoggedTimeEntriesHtml({
    zoom: 10,
    projects: [{ id: 'project-1', name: 'Oriel Demo Project', color: '#3b82f6' }],
    activities,
    timeEntries: [{
      id: 'entry-figma',
      start: rangeStart,
      end: rangeEnd,
      projectId: 'project-1',
      description: '',
      createdBy: 'manual',
      activities: [{
        app: 'Figma',
        title: 'macOS Big Sur icon template (Community)',
        appPath: '/Applications/Figma.app',
        bundleId: 'com.figma.Desktop',
        url: '',
        start: rangeStart,
        end: rangeEnd,
        duration: 897674,
        assignedDurationMs: 897674,
        assignmentStart: rangeStart,
        assignmentEnd: rangeEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 10
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: rangeStart,
    end: rangeEnd,
    zoom: 10
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['15 min']);
});

test('cross-zoom assignment blocks use standard styling and never overlap at any zoom level', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 13 * 60 * 60 * 1000,
      end: dateStart + (13 * 60 + 53) * 60 * 1000,
      duration: 53 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 14 * 60 * 60 * 1000,
      end: dateStart + (14 * 60 + 30) * 60 * 1000,
      duration: 30 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 16 * 60 * 60 * 1000,
      end: dateStart + (16 * 60 + 16) * 60 * 1000,
      duration: 16 * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 13 * 60,
      endMinute: 13 * 60 + 53,
      assignedMinutes: 53,
      assignmentDisplayZoom: 5
    }),
    makeActivityStreamTimeEntry({
      id: 'entry-2',
      dateStart,
      startMinute: 14 * 60,
      endMinute: 14 * 60 + 30,
      assignedMinutes: 30,
      assignmentDisplayZoom: 5
    }),
    makeActivityStreamTimeEntry({
      id: 'entry-3',
      dateStart,
      startMinute: 16 * 60,
      endMinute: 16 * 60 + 16,
      assignedMinutes: 16,
      assignmentDisplayZoom: 5
    })
  ];

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({ zoom, projects, activities, timeEntries });
    const styles = extractEntryStyles(html);
    const expectedBlockCount = zoom >= 10 ? 2 : 3;
    const expectedLabels = zoom === 15
      ? ['83 min', '15 min']
      : zoom >= 10
        ? ['83 min', '16 min']
        : ['53 min', '30 min', '16 min'];

    assert.equal(styles.length, expectedBlockCount, `Expected adjacent rendered blocks to merge at zoom ${zoom}`);
    styles.forEach(style => {
      assert.doesNotMatch(style.className, /\btime-entry-block--partial-assignment\b/);
      assertStyleMatchesRowGeometry(style, {
        top: style.top,
        height: style.height
      }, `assignment block at zoom ${zoom}`);
    });
    assertNoOverlappingBlockGeometry(styles, `assignment blocks at zoom ${zoom}`);
    assert.deepEqual(extractTimeEntryDurationLabels(html), expectedLabels);
  }
});

test('saved activity-stream assignment runs show the current visible Activity Stream duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + (9 * 60 + 12) * 60 * 1000;
  const end = dateStart + (9 * 60 + 14) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (9 * 60 + 10) * 60 * 1000,
      end: dateStart + (9 * 60 + 20) * 60 * 1000,
      duration: 10 * 60 * 1000
    }],
    timeEntries: [{
      id: 'entry-1',
      start,
      end,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start,
        end,
        duration: 75 * 1000,
        assignedDurationMs: 75 * 1000,
        assignmentStart: start,
        assignmentEnd: end,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 1
      }]
    }]
  });

  assert.deepEqual(extractTimeEntryDurationLabels(html), ['10 min']);
});

test('legacy activity-stream assignment repairs visible badge and range from current Activity Stream block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const visibleStart = dateStart + (9 * 60 + 19) * 60 * 1000;
  const savedStart = dateStart + (9 * 60 + 20) * 60 * 1000;
  const savedEnd = dateStart + (9 * 60 + 33) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: visibleStart,
      end: savedEnd,
      duration: 13.72 * 60 * 1000
    }],
    timeEntries: [{
      id: 'entry-1',
      start: savedStart,
      end: savedEnd,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: savedStart,
        end: savedEnd,
        duration: 12.73 * 60 * 1000,
        assignedDurationMs: 12.73 * 60 * 1000,
        assignmentStart: savedStart,
        assignmentEnd: savedEnd,
        assignmentSource: 'activity-stream'
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: visibleStart,
    end: savedEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['14 min']);
});

test('legacy activity-stream repair deduplicates multiple saved fragments inside one visible block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const visibleStart = dateStart + (9 * 60 + 5) * 60 * 1000;
  const visibleEnd = dateStart + (9 * 60 + 20) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [
      {
        app: 'Codex',
        title: 'Codex',
        start: dateStart + (9 * 60 + 6) * 60 * 1000,
        end: dateStart + (9 * 60 + 14) * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        start: dateStart + (9 * 60 + 16) * 60 * 1000,
        end: dateStart + (9 * 60 + 19) * 60 * 1000
      }
    ],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 9 * 60 + 8,
        endMinute: 9 * 60 + 13,
        assignedMinutes: 5,
        assignmentModel: null
      }),
      makeActivityStreamTimeEntry({
        id: 'entry-2',
        dateStart,
        startMinute: 9 * 60 + 16,
        endMinute: 9 * 60 + 19,
        assignedMinutes: 3,
        assignmentModel: null
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: visibleStart,
    end: visibleEnd,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['11 min']);
});

test('legacy activity-stream assignment without matching activity data falls back to saved duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + (9 * 60 + 20) * 60 * 1000;
  const end = dateStart + (9 * 60 + 33) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 9 * 60 + 20,
        endMinute: 9 * 60 + 33,
        assignedMinutes: 13,
        assignmentModel: null
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start,
    end,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['13 min']);
});

test('grouped saved activity-stream summary assignments de-dupe visible projected duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (9 * 60 + 4) * 60 * 1000;
  const firstEnd = dateStart + (9 * 60 + 6) * 60 * 1000;
  const secondStart = dateStart + (9 * 60 + 6) * 60 * 1000;
  const secondEnd = dateStart + (9 * 60 + 8) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (9 * 60) * 60 * 1000,
      end: dateStart + (9 * 60 + 30) * 60 * 1000,
      duration: 30 * 60 * 1000
    }],
    timeEntries: [
      {
        id: 'entry-1',
        start: firstStart,
        end: firstEnd,
        projectId: 'project-1',
        description: '',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: firstStart,
          end: firstEnd,
          duration: 75 * 1000,
          assignedDurationMs: 75 * 1000,
          assignmentStart: firstStart,
          assignmentEnd: firstEnd,
          assignmentSource: 'activity-stream',
          assignmentModel: 'activity-stream-summary',
          assignmentDisplayZoom: 5
        }]
      },
      {
        id: 'entry-2',
        start: secondStart,
        end: secondEnd,
        projectId: 'project-1',
        description: '',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: secondStart,
          end: secondEnd,
          duration: 45 * 1000,
          assignedDurationMs: 45 * 1000,
          assignmentStart: secondStart,
          assignmentEnd: secondEnd,
          assignmentSource: 'activity-stream',
          assignmentModel: 'activity-stream-summary',
          assignmentDisplayZoom: 5
        }]
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (9 * 60) * 60 * 1000,
    end: dateStart + (9 * 60 + 30) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['30 min']);
});

test('activity-stream assignment entries group across exact gaps hidden by adjacent display rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, assignedMinutes: 4 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 5, endMinute: 9 * 60 + 10, assignedMinutes: 5 }),
      makeActivityStreamTimeEntry({ id: 'entry-3', dateStart, startMinute: 9 * 60 + 12, endMinute: 9 * 60 + 18, assignedMinutes: 6 }),
      makeActivityStreamTimeEntry({ id: 'entry-4', dateStart, startMinute: 9 * 60 + 19, endMinute: 9 * 60 + 25, assignedMinutes: 5 })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (9 * 60) * 60 * 1000,
    end: dateStart + (9 * 60 + 25) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['20 min']);
});

test('screenshot-shaped adjacent assignment rows merge at 30 minute zoom', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 30,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 18 * 60 + 30,
        endMinute: 19 * 60,
        assignedMinutes: 14,
        assignmentDisplayZoom: 30
      }),
      makeActivityStreamTimeEntry({
        id: 'entry-2',
        dateStart,
        startMinute: 19 * 60,
        endMinute: 19 * 60 + 30,
        assignedMinutes: 2,
        assignmentDisplayZoom: 30
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (18 * 60 + 30) * 60 * 1000,
    end: dateStart + (19 * 60 + 30) * 60 * 1000,
    zoom: 30
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['16 min']);
});

test('screenshot-shaped adjacent assignment rows merge at 60 minute zoom', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 60,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 13 * 60,
        endMinute: 14 * 60,
        assignedMinutes: 51,
        assignmentDisplayZoom: 30
      }),
      makeActivityStreamTimeEntry({
        id: 'entry-2',
        dateStart,
        startMinute: 14 * 60,
        endMinute: 16 * 60,
        assignedMinutes: 29,
        assignmentDisplayZoom: 30
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + 13 * 60 * 60 * 1000,
    end: dateStart + 16 * 60 * 60 * 1000,
    zoom: 60
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['80 min']);
});

test('activity-stream assignment entries with gaps larger than zoom do not merge', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, assignedMinutes: 5 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 11, endMinute: 9 * 60 + 16, assignedMinutes: 5 })
    ]
  });

  assert.equal(extractEntryStyles(html).length, 2);
});

test('manual entries merge with activity-stream assignment entries for the same project and task', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, assignedMinutes: 5 }),
      {
        id: 'entry-2',
        start: dateStart + (9 * 60 + 5) * 60 * 1000,
        end: dateStart + (9 * 60 + 10) * 60 * 1000,
        projectId: 'project-1',
        taskId: 'task-1',
        description: 'Manual follow-up',
        activities: [{ app: 'Codex', assignedDurationMs: 5 * 60 * 1000 }]
      }
    ]
  });

  assert.equal(extractEntryStyles(html).length, 1);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['10 min']);
});

test('activity-stream assignment entries from different projects do not group', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [
      { id: 'project-1', name: 'Project One', color: '#3b82f6' },
      { id: 'project-2', name: 'Project Two', color: '#10b981' }
    ],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, projectId: 'project-1', taskId: '', assignedMinutes: 5 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 5, endMinute: 9 * 60 + 10, projectId: 'project-2', taskId: '', assignedMinutes: 5 })
    ]
  });

  assert.equal(extractEntryStyles(html).length, 2);
});

test('grouped activity-stream assignment block uses summed assigned duration for badge', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 25, assignedMinutes: 15 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 25, endMinute: 9 * 60 + 50, assignedMinutes: 20 })
    ]
  });

  assert.equal(extractEntryStyles(html).length, 1);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['35 min']);
});

test('grouped activity-stream assignment block has assignment CSS class', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, assignedMinutes: 5 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 5, endMinute: 9 * 60 + 10, assignedMinutes: 5 })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assert.match(styles[0].className, /time-entry-block--assigned/);
});

test('minimum height applies to grouped activity-stream assignment block instead of individual entries', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 30,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 1, assignedMinutes: 1 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 1, endMinute: 9 * 60 + 2, assignedMinutes: 1 }),
      makeActivityStreamTimeEntry({ id: 'entry-3', dateStart, startMinute: 9 * 60 + 2, endMinute: 9 * 60 + 3, assignedMinutes: 1 })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assert.equal(styles[0].height, 37);
});

test('cross-project time entries sharing a visual row render in separate horizontal lanes', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [
      { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' },
      { id: 'project-2', name: 'Test Project', color: '#f59e0b' }
    ],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (9 * 60 + 35) * 60 * 1000,
        end: dateStart + (9 * 60 + 52) * 60 * 1000,
        projectId: 'project-1',
        description: ''
      },
      {
        id: 'entry-2',
        start: dateStart + (9 * 60 + 50) * 60 * 1000,
        end: dateStart + (9 * 60 + 52) * 60 * 1000,
        projectId: 'project-2',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assert.equal(styles[0].left, '64px');
  assert.equal(styles[0].width, 'calc(50% - 40px)');
  assert.equal(styles[0].right, 'auto');
  assert.equal(styles[1].left, 'calc(50% + 28px)');
  assert.equal(styles[1].width, 'calc(50% - 40px)');
  assert.equal(styles[1].right, 'auto');
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (9 * 60 + 35) * 60 * 1000,
    end: dateStart + (9 * 60 + 52) * 60 * 1000,
    zoom: 5
  }));
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: dateStart + (9 * 60 + 50) * 60 * 1000,
    end: dateStart + (9 * 60 + 52) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['17 min', '2 min']);
});

test('same project and task overlapping entries merge into one full-width visual block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Oriel Time Tracker',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Implementation', archived: false }]
    }],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (11 * 60 + 5) * 60 * 1000,
        end: dateStart + (11 * 60 + 7) * 60 * 1000,
        projectId: 'project-1',
        taskId: 'task-1',
        description: ''
      },
      {
        id: 'entry-2',
        start: dateStart + (11 * 60 + 6) * 60 * 1000,
        end: dateStart + (11 * 60 + 10) * 60 * 1000,
        projectId: 'project-1',
        taskId: 'task-1',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assert.equal(styles[0].left, null);
  assert.equal(styles[0].width, null);
  assert.equal(styles[0].right, null);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (11 * 60 + 5) * 60 * 1000,
    end: dateStart + (11 * 60 + 10) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['6 min']);
});

test('same project with different tasks can share horizontal lanes', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Oriel Time Tracker',
      color: '#3b82f6',
      tasks: [
        { id: 'task-1', name: 'Implementation', archived: false },
        { id: 'task-2', name: 'Review', archived: false }
      ]
    }],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (11 * 60 + 5) * 60 * 1000,
        end: dateStart + (11 * 60 + 10) * 60 * 1000,
        projectId: 'project-1',
        taskId: 'task-1',
        description: ''
      },
      {
        id: 'entry-2',
        start: dateStart + (11 * 60 + 6) * 60 * 1000,
        end: dateStart + (11 * 60 + 10) * 60 * 1000,
        projectId: 'project-1',
        taskId: 'task-2',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assert.equal(styles[0].left, '64px');
  assert.equal(styles[1].left, 'calc(50% + 28px)');
  assert.deepEqual(styles.map(style => style.width), ['calc(50% - 40px)', 'calc(50% - 40px)']);
});

test('three simultaneous time entries split into three horizontal lanes', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 15,
    projects: [
      { id: 'project-1', name: 'Project One', color: '#3b82f6' },
      { id: 'project-2', name: 'Project Two', color: '#f59e0b' },
      { id: 'project-3', name: 'Project Three', color: '#10b981' }
    ],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + 9 * 60 * 60 * 1000,
        end: dateStart + (9 * 60 + 45) * 60 * 1000,
        projectId: 'project-1',
        description: ''
      },
      {
        id: 'entry-2',
        start: dateStart + (9 * 60 + 10) * 60 * 1000,
        end: dateStart + (9 * 60 + 35) * 60 * 1000,
        projectId: 'project-2',
        description: ''
      },
      {
        id: 'entry-3',
        start: dateStart + (9 * 60 + 15) * 60 * 1000,
        end: dateStart + (9 * 60 + 30) * 60 * 1000,
        projectId: 'project-3',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 3);
  assert.deepEqual(styles.map(style => style.left), ['64px', 'calc(33.333333% + 40px)', 'calc(66.666667% + 16px)']);
  assert.deepEqual(styles.map(style => style.width), [
    'calc(33.333333% - 28px)',
    'calc(33.333333% - 28px)',
    'calc(33.333333% - 28px)'
  ]);
  assert.deepEqual(styles.map(style => style.right), ['auto', 'auto', 'auto']);
});

test('standalone sub-minute logged entries are hidden from the Time Entries timeline', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }],
    timeEntries: [{
      id: 'entry-short',
      start: dateStart + (11 * 60 + 17) * 60 * 1000,
      end: dateStart + (11 * 60 + 17) * 60 * 1000 + 45 * 1000,
      projectId: 'project-1',
      description: ''
    }]
  });

  assert.equal(extractEntryStyles(html).length, 0);
  assert.doesNotMatch(html, />0 min</);
});

test('merged sub-minute entries render when grouped duration reaches one minute', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (11 * 60 + 56) * 60 * 1000;
  const secondStart = dateStart + (11 * 60 + 57) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }],
    timeEntries: [
      {
        id: 'entry-short-1',
        start: firstStart,
        end: firstStart + 45 * 1000,
        projectId: 'project-1',
        description: ''
      },
      {
        id: 'entry-short-2',
        start: secondStart,
        end: secondStart + 45 * 1000,
        projectId: 'project-1',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: secondStart + 45 * 1000,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('row-adjacent time entries keep full width when visual rows do not overlap', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [
      { id: 'project-1', name: 'Project One', color: '#3b82f6' },
      { id: 'project-2', name: 'Project Two', color: '#f59e0b' }
    ],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (9 * 60 + 35) * 60 * 1000,
        end: dateStart + (9 * 60 + 50) * 60 * 1000,
        projectId: 'project-1',
        description: ''
      },
      {
        id: 'entry-2',
        start: dateStart + (9 * 60 + 50) * 60 * 1000,
        end: dateStart + (9 * 60 + 55) * 60 * 1000,
        projectId: 'project-2',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assert.deepEqual(styles.map(style => style.left), [null, null]);
  assert.deepEqual(styles.map(style => style.width), [null, null]);
  assert.deepEqual(styles.map(style => style.right), [null, null]);
});

test('manual entries lane next to assignment groups without changing labels or group edit metadata', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [
      {
        id: 'project-1',
        name: 'Project One',
        color: '#3b82f6',
        tasks: [{ id: 'task-1', name: 'Development', archived: false }]
      },
      { id: 'project-2', name: 'Project Two', color: '#f59e0b' }
    ],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 9 * 60 + 35,
        endMinute: 9 * 60 + 45,
        assignedMinutes: 10
      }),
      makeActivityStreamTimeEntry({
        id: 'entry-2',
        dateStart,
        startMinute: 9 * 60 + 45,
        endMinute: 9 * 60 + 55,
        assignedMinutes: 10
      }),
      {
        id: 'entry-3',
        start: dateStart + (9 * 60 + 50) * 60 * 1000,
        end: dateStart + (9 * 60 + 52) * 60 * 1000,
        projectId: 'project-2',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assert.match(styles[0].className, /time-entry-block--assigned/);
  assert.equal(styles[0].left, '64px');
  assert.equal(styles[0].width, 'calc(50% - 40px)');
  assert.equal(styles[1].left, 'calc(50% + 28px)');
  assert.equal(styles[1].width, 'calc(50% - 40px)');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['20 min', '2 min']);
  assert.deepEqual(extractGroupedEntryBounds(html), {
    start: dateStart + (9 * 60 + 35) * 60 * 1000,
    end: dateStart + (9 * 60 + 55) * 60 * 1000
  });
});

test('grouped activity-stream assignment block uses display rows but keeps exact edit bounds', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (9 * 60 + 2) * 60 * 1000;
  const secondEnd = dateStart + (9 * 60 + 4) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 10,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60 + 2, endMinute: 9 * 60 + 3, assignedMinutes: 1 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 3, endMinute: 9 * 60 + 4, assignedMinutes: 1 })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: secondEnd,
    zoom: 10
  }));
  assert.deepEqual(extractGroupedEntryBounds(html), {
    start: firstStart,
    end: secondEnd
  });
});

test('legacy activity-stream assignment envelopes render on display rows at every zoom level', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (13 * 60 + 16) * 60 * 1000;
  const firstEnd = dateStart + (13 * 60 + 21) * 60 * 1000;
  const secondStart = dateStart + (13 * 60 + 24) * 60 * 1000;
  const secondEnd = dateStart + (13 * 60 + 25) * 60 * 1000;
  const projects = [{
    id: 'project-1',
    name: 'Project One',
    color: '#3b82f6',
    tasks: [{ id: 'task-1', name: 'Development', archived: false }]
  }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: firstStart,
      end: firstEnd,
      duration: firstEnd - firstStart
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: secondStart,
      end: secondEnd,
      duration: secondEnd - secondStart
    }
  ];
  const timeEntries = [{
    id: 'entry-1',
    start: dateStart + (13 * 60 + 15) * 60 * 1000,
    end: dateStart + (13 * 60 + 30) * 60 * 1000,
    projectId: 'project-1',
    taskId: 'task-1',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (13 * 60 + 15) * 60 * 1000,
      end: dateStart + (13 * 60 + 30) * 60 * 1000,
      assignedDurationMs: 15 * 60 * 1000,
      assignmentSource: 'activity-stream'
    }]
  }];

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({ zoom, projects, activities, timeEntries });
    const styles = extractEntryStyles(html);
    assert.equal(sumDurationLabelMinutes(extractTimeEntryDurationLabels(html)), 6, `Expected run duration sum at zoom ${zoom}`);

    for (const style of styles) {
      assert.equal((style.top - 2) % 40, 0, `Expected row-aligned top at zoom ${zoom}`);
      assert.equal((style.height + 3) % 40, 0, `Expected row-aligned height at zoom ${zoom}`);
    }

    if (zoom === 1) {
      assert.equal(styles.length, 2, `Expected separate assigned blocks at zoom ${zoom}`);
      assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
        dateStart,
        start: firstStart,
        end: firstEnd,
        zoom
      }), `first run at zoom ${zoom}`);
      assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
        dateStart,
        start: secondStart,
        end: secondEnd,
        zoom
      }), `second run at zoom ${zoom}`);
    } else {
      assert.equal(styles.length, 1, `Expected display-row grouping at zoom ${zoom}`);
      assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
        dateStart,
        start: firstStart,
        end: secondEnd,
        zoom
      }), `grouped runs at zoom ${zoom}`);
    }
  }
});

test('manual summary assignments with stale auto-rule flags render selected assigned duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hours, minutes) => dateStart + (hours * 60 + minutes) * 60 * 1000;
  const rangeStart = at(21, 40);
  const rangeEnd = at(22, 10);
  const projects = [{ id: 'project-1', name: 'Oriel Demo Project', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template',
      bundleId: 'com.figma.Desktop',
      appPath: '/Applications/Figma.app',
      start: at(21, 50),
      end: at(22, 4),
      duration: 14 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      bundleId: 'com.openai.codex',
      appPath: '/Applications/Codex.app',
      start: at(22, 4),
      end: at(22, 5),
      duration: 60 * 1000
    }
  ];
  const timeEntries = [{
    id: 'entry-1',
    start: rangeStart,
    end: rangeEnd,
    projectId: 'project-1',
    taskId: '',
    description: '',
    createdBy: 'manual',
    activities: [
      {
        app: 'Figma',
        title: 'macOS Big Sur icon template',
        bundleId: 'com.figma.Desktop',
        appPath: '/Applications/Figma.app',
        start: rangeStart,
        end: rangeEnd,
        duration: 14 * 60 * 1000,
        assignedDurationMs: 14 * 60 * 1000,
        assignmentStart: rangeStart,
        assignmentEnd: rangeEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        autoAssigned: true,
        autoAssignmentRuleId: 'rule-1'
      },
      {
        app: 'Codex',
        title: 'Codex',
        bundleId: 'com.openai.codex',
        appPath: '/Applications/Codex.app',
        start: rangeStart,
        end: rangeEnd,
        duration: 60 * 1000,
        assignedDurationMs: 60 * 1000,
        assignmentStart: rangeStart,
        assignmentEnd: rangeEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        autoAssigned: true,
        autoAssignmentRuleId: 'rule-1'
      }
    ]
  }];

  const html = renderLoggedTimeEntriesHtml({ timeEntries, projects, zoom: 10, activities });

  assert.deepEqual(extractTimeEntryDurationLabels(html), ['15 min']);
});

test('activity-stream assignment block without description renders project on the primary row', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 10,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 10, assignedMinutes: 10 })
    ]
  });
  const blockHtml = extractFirstTimeEntryBlockHtml(html);

  assert.match(blockHtml, /<div class="time-entry-main[^"]*">[\s\S]*project-marker[\s\S]*Project One[\s\S]*time-entry-duration/);
  assert.doesNotMatch(blockHtml, /class="time-entry-project\s/);
});

test('logged time entries without descriptions do not render redundant fallback labels', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [{
      id: 'entry-1',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + 10 * 60 * 60 * 1000,
      projectId: 'project-1',
      description: ''
    }]
  });

  assert.doesNotMatch(html, /Logged Entry/);
  assert.match(html, /Project One/);
  assert.match(html, /<span class="duration-pill time-entry-duration shrink-0">60 min<\/span>/);
});

test('logged time entries display their assigned task when present', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [{
      id: 'entry-1',
      projectId: 'project-1',
      taskId: 'task-1',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + 10 * 60 * 60 * 1000,
      description: 'Implementation'
    }]
  });

  assert.match(html, /Development/);
  assert.match(html, /time-entry-task/);
});

test('time entry hover preview snaps to one zoom row without initial duration', () => {
  const context = loadTimelineContext();
  const items = new FakeElement('time-entry-items');
  items.querySelector = selector => selector === '.time-entry-hover-preview' ? items.child || null : null;
  context.DOM.elItemsTimeEntries = items;
  context.document.createElement = () => new FakeElement('hover-preview');
  context.state.zoom = 15;

  context.showTimeEntryHoverPreview(12);

  assert.equal(items.child.className, 'time-entry-hover-preview');
  assert.equal(items.child.style.top, '482px');
  assert.equal(items.child.style.height, '37px');
  assert.match(items.child.innerHTML, /Click &amp; drag to log/);
  assert.doesNotMatch(items.child.innerHTML, /time-entry-hover-duration/);
  assert.doesNotMatch(items.child.innerHTML, /15 min/);

  context.hideTimeEntryHoverPreview();
  assert.equal(items.child.removed, true);
});

test('similar selection expands to same app and host on the visible day', () => {
  const context = loadTimelineContext();

  function fakeBlock({ startCell, app, url = '', bundleId = '', selected = false }) {
    const classes = new Set(selected ? ['activity-block', 'selected'] : ['activity-block']);
    const checkboxClasses = new Set(selected ? ['activity-checkbox', 'is-selected'] : ['activity-checkbox']);
    const icon = { className: selected ? 'ph-fill ph-check-square text-base' : 'ph ph-square text-base' };
    const checkbox = {
      classList: {
        add: className => checkboxClasses.add(className),
        remove: className => checkboxClasses.delete(className),
        contains: className => checkboxClasses.has(className)
      }
    };

    return {
      dataset: { startCell: String(startCell), app, title: app, url, appPath: '', bundleId },
      classList: {
        add: className => classes.add(className),
        remove: className => classes.delete(className),
        contains: className => classes.has(className)
      },
      querySelector(selector) {
        if (selector === '.activity-checkbox') return checkbox;
        if (selector === '.activity-checkbox i') return icon;
        return null;
      }
    };
  }

  const blocks = [
    fakeBlock({ startCell: 1, app: 'Google Chrome', url: 'https://github.com/example', selected: true }),
    fakeBlock({ startCell: 8, app: 'Google Chrome', url: 'https://github.com/other' }),
    fakeBlock({ startCell: 12, app: 'Google Chrome', url: 'https://x.com/home' }),
    fakeBlock({ startCell: 20, app: 'Oriel', bundleId: 'so.sil.oriel' })
  ];

  context.state.selectedActivities.add(1);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities(), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [1, 8]);
  assert.equal(blocks[1].classList.contains('selected'), true);
  assert.equal(blocks[2].classList.contains('selected'), false);
  assert.equal(blocks[3].classList.contains('selected'), false);
});

test('similar selection treats native activities with the same app name as similar even when metadata differs', () => {
  const context = loadTimelineContext();

  function fakeBlock({ startCell, app, appPath = '', bundleId = '', selected = false }) {
    const classes = new Set(selected ? ['activity-block', 'selected'] : ['activity-block']);
    const checkbox = { classList: { add() {}, remove() {} } };
    const icon = { className: '' };

    return {
      dataset: { startCell: String(startCell), app, title: app, url: '', appPath, bundleId },
      classList: {
        add: className => classes.add(className),
        remove: className => classes.delete(className),
        contains: className => classes.has(className)
      },
      querySelector(selector) {
        if (selector === '.activity-checkbox') return checkbox;
        if (selector === '.activity-checkbox i') return icon;
        return null;
      }
    };
  }

  const blocks = [
    fakeBlock({ startCell: 5, app: 'Codex', bundleId: 'com.openai.codex', selected: true }),
    fakeBlock({ startCell: 12, app: 'Codex' }),
    fakeBlock({ startCell: 20, app: 'Shottr', bundleId: 'cc.ffitch.shottr' })
  ];

  context.state.selectedActivities.add(5);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities(), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [5, 12]);
  assert.equal(blocks[1].classList.contains('selected'), true);
  assert.equal(blocks[2].classList.contains('selected'), false);
});

test('similar selection includes mixed rows where the selected activity is secondary', () => {
  const context = loadTimelineContext();

  function fakeBlock({
    startCell,
    app,
    title = app,
    appPath = '',
    bundleId = '',
    selected = false,
    overlaps = []
  }) {
    const classes = new Set(selected ? ['activity-block', 'selected'] : ['activity-block']);
    const checkbox = { classList: { add() {}, remove() {} } };
    const icon = { className: '' };

    return {
      dataset: {
        startCell: String(startCell),
        span: '1',
        app,
        title,
        url: '',
        appPath,
        bundleId,
        overlaps: encodeURIComponent(JSON.stringify(overlaps))
      },
      classList: {
        add: className => classes.add(className),
        remove: className => classes.delete(className),
        contains: className => classes.has(className)
      },
      querySelector(selector) {
        if (selector === '.activity-checkbox') return checkbox;
        if (selector === '.activity-checkbox i') return icon;
        return null;
      }
    };
  }

  const codexOverlap = {
    app: 'Codex',
    title: 'Codex',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex',
    start: 0,
    end: 2 * 60 * 1000
  };
  const braveOverlap = {
    app: 'Brave Browser',
    title: 'Brave Browser',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start: 0,
    end: 12 * 60 * 1000
  };
  const blocks = [
    fakeBlock({
      startCell: 18,
      app: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      selected: true,
      overlaps: [codexOverlap]
    }),
    fakeBlock({
      startCell: 37,
      app: 'Brave Browser',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      overlaps: [braveOverlap, codexOverlap]
    }),
    fakeBlock({
      startCell: 48,
      app: 'Obsidian',
      appPath: '/Applications/Obsidian.app',
      bundleId: 'md.obsidian',
      overlaps: [{
        app: 'Obsidian',
        title: 'Obsidian',
        appPath: '/Applications/Obsidian.app',
        bundleId: 'md.obsidian',
        start: 0,
        end: 10 * 60 * 1000
      }]
    })
  ];

  context.state.selectedActivities.add(18);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities(), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [18, 37]);
  assert.equal(blocks[1].classList.contains('selected'), true);
  assert.deepEqual(Array.from(context.getActivityBlockSelectionKeys(blocks[1])), ['codex']);
  assert.equal(blocks[2].classList.contains('selected'), false);
});

test('recorded activity duration is clipped to the visible block range at each zoom level', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const title = '(1) IQOS Iluma Review - YouTube';
  const activities = [
    {
      start: dateStart + (14 * 60 + 25) * 60 * 1000,
      end: dateStart + (14 * 60 + 28) * 60 * 1000 + 43000,
      app: 'Preview',
      title: 'Reference Image',
      url: ''
    },
    {
      start: dateStart + (14 * 60 + 29) * 60 * 1000 + 4428,
      end: dateStart + (14 * 60 + 32) * 60 * 1000 + 21025,
      app: 'Brave Browser',
      title,
      url: 'https://www.youtube.com/watch?v=L5tCTMAZiGs'
    }
  ];

  const oneMinuteHtml = renderMemoryAidHtml({ activities, zoom: 1 });
  const fiveMinuteHtml = renderMemoryAidHtml({ activities, zoom: 5 });

  assert.equal(extractActivityDuration(oneMinuteHtml, title), '2 min');
  assert.equal(extractActivityDuration(fiveMinuteHtml, title), '2 min');
});

test('sub-minute dominant interruptions stay hidden in Activity Stream while one-minute rows render', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const longActivity = {
    start: dateStart + (14 * 60 + 8) * 60 * 1000,
    end: dateStart + (14 * 60 + 10) * 60 * 1000,
    app: 'Reference App',
    title: 'Reference App',
    url: ''
  };
  const shortActivity = {
    start: dateStart + (14 * 60 + 10) * 60 * 1000,
    end: dateStart + (14 * 60 + 10) * 60 * 1000 + 59 * 1000,
    app: 'Brave Browser',
    title: 'Short Oriel Local Time Tracker',
    url: 'http://localhost:3000/'
  };
  const exactMinuteActivity = {
    start: dateStart + (14 * 60 + 12) * 60 * 1000,
    end: dateStart + (14 * 60 + 13) * 60 * 1000,
    app: 'Brave Browser',
    title: 'One Minute Oriel Local Time Tracker',
    url: 'http://localhost:3000/'
  };

  const html = renderMemoryAidHtml({
    zoom: 1,
    activities: [longActivity, shortActivity, exactMinuteActivity],
    timelineActivities: [longActivity, shortActivity, exactMinuteActivity]
  });

  assert.equal(extractActivitySpan(html, 'Reference App'), 2);
  assert.doesNotMatch(html, /data-title="Short Oriel Local Time Tracker"/);
  assert.equal(extractActivitySpan(html, 'One Minute Oriel Local Time Tracker'), 1);
});

test('recorded activity popup clips overlap durations to the visible selected block range', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const precedingOriel = {
    start: dateStart + (14 * 60 + 4) * 60 * 1000 + 52 * 1000,
    end: dateStart + (14 * 60 + 5) * 60 * 1000 + 8 * 1000,
    app: 'Brave Browser',
    title: 'Oriel Local Time Tracker',
    url: 'http://localhost:3000/'
  };
  const referenceApp = {
    start: precedingOriel.end,
    end: dateStart + (14 * 60 + 10) * 60 * 1000 + 29000,
    app: 'Reference App',
    title: 'Reference App',
    url: ''
  };
  const subsequentOriel = {
    start: referenceApp.end,
    end: dateStart + (14 * 60 + 11) * 60 * 1000 + 5000,
    app: 'Brave Browser',
    title: 'Oriel Local Time Tracker',
    url: 'http://localhost:3000/'
  };

  const html = renderMemoryAidHtml({
    zoom: 5,
    activities: [precedingOriel, referenceApp],
    timelineActivities: [precedingOriel, referenceApp, subsequentOriel]
  });
  const overlaps = extractActivityOverlaps(html, 'Reference App');
  const orielOverlap = overlaps.find(activity => activity.title === 'Oriel Local Time Tracker');

  assert.equal(extractActivitySpan(html, 'Reference App'), 1);
  assert.equal(extractActivityDuration(html, 'Reference App'), '5 min');
  assert.equal(orielOverlap.duration, 8 * 1000);
});

test('refresh keeps short activities in state while Activity Stream rendering hides them', async () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const longActivity = {
    start: dateStart,
    end: dateStart + 2 * 60 * 1000,
    app: 'Reference App',
    title: 'Reference App',
    url: ''
  };
  const shortActivity = {
    start: dateStart + 2 * 60 * 1000,
    end: dateStart + 2 * 60 * 1000 + 35000,
    app: 'Brave Browser',
    title: 'Oriel Local Time Tracker',
    url: 'http://localhost:3000/'
  };

  const refreshedState = await refreshActivities({
    rawActivities: [longActivity, shortActivity],
    thresholdSeconds: 60
  });

  assert.deepEqual(Array.from(refreshedState.activities, activity => activity.title), ['Reference App', 'Oriel Local Time Tracker']);
  assert.deepEqual(
    Array.from(refreshedState.timelineActivities || [], activity => activity.title),
    ['Reference App', 'Oriel Local Time Tracker']
  );

  const html = renderMemoryAidHtml({
    zoom: 1,
    activities: refreshedState.activities,
    timelineActivities: refreshedState.timelineActivities
  });

  assert.equal(extractActivitySpan(html, 'Reference App'), 2);
  assert.doesNotMatch(html, /data-title="Oriel Local Time Tracker"/);
});

test('refresh merges same activity rows while preserving activity mix and source segments', async () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const refreshedState = await refreshActivities({
    rawActivities: [
      {
        start: dateStart,
        end: dateStart + 2 * 60 * 1000,
        app: 'SoundCloud',
        title: 'SoundCloud',
        url: '',
        interactionState: 'handsOn'
      },
      {
        start: dateStart + 2 * 60 * 1000,
        end: dateStart + 10 * 60 * 1000,
        app: 'SoundCloud',
        title: 'SoundCloud',
        url: '',
        interactionState: 'handsOff'
      }
    ],
    thresholdSeconds: 60
  });
  const activity = refreshedState.timelineActivities[0];

  assert.equal(refreshedState.timelineActivities.length, 1);
  assert.equal(activity.end - activity.start, 10 * 60 * 1000);
  assert.equal(activity.activityMix.handsOnMs, 2 * 60 * 1000);
  assert.equal(activity.activityMix.handsOffMs, 8 * 60 * 1000);
  assert.equal(activity.sourceSegments.length, 2);
  assert.deepEqual(Array.from(activity.sourceSegments, segment => segment.interactionState), ['handsOn', 'handsOff']);
});

test('refresh excludes loginwindow from visible and ownership activity streams', async () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const refreshedState = await refreshActivities({
    rawActivities: [
      {
        start: dateStart,
        end: dateStart + 2 * 60 * 1000,
        app: 'loginwindow',
        title: 'Login Window',
        url: ''
      },
      {
        start: dateStart + 2 * 60 * 1000,
        end: dateStart + 4 * 60 * 1000,
        app: 'Codex',
        title: 'Codex',
        url: ''
      }
    ],
    thresholdSeconds: 60
  });

  assert.deepEqual(Array.from(refreshedState.activities, activity => activity.app), ['Codex']);
  assert.deepEqual(Array.from(refreshedState.timelineActivities || [], activity => activity.app), ['Codex']);
});

test('activity stream renders Activity Mix for hands-on and hands-off blocks', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const soundCloud = {
    start: dateStart,
    end: dateStart + 10 * 60 * 1000,
    app: 'SoundCloud',
    title: 'SoundCloud',
    url: '',
    interactionState: 'handsOn',
    activityMix: {
      handsOnMs: 2 * 60 * 1000,
      handsOffMs: 8 * 60 * 1000
    },
    sourceSegments: [
      { start: dateStart, end: dateStart + 2 * 60 * 1000, interactionState: 'handsOn' },
      { start: dateStart + 2 * 60 * 1000, end: dateStart + 10 * 60 * 1000, interactionState: 'handsOff' }
    ]
  };

  const html = renderMemoryAidHtml({
    zoom: 5,
    activities: [soundCloud],
    timelineActivities: [soundCloud]
  });
  const blockHtml = extractActivityBlockHtml(html, 'SoundCloud');

  assert.doesNotMatch(blockHtml, /activity-mix-bar/);
  assert.match(blockHtml, /duration-pill activity-mix-pill shrink-0/);
  assert.match(blockHtml, /--activity-mix-hands-on: 20%/);
  assert.match(blockHtml, /Activity Mix/);
  assert.doesNotMatch(blockHtml, /activity-mix-label/);
  assert.doesNotMatch(blockHtml, />Hands-on 2 min · Hands-off 8 min</);
  assert.doesNotMatch(blockHtml, /title="Activity Mix\. Hands-on 2 min · Hands-off 8 min\./);
  assert.match(blockHtml, /data-activity-mix-tooltip="Activity Mix\. Hands-on 2 min · Hands-off 8 min\./);
  assert.match(blockHtml, /aria-label="Activity Mix\. Hands-on 2 min · Hands-off 8 min\./);
  assert.match(blockHtml, /Hands-on: recent keyboard, mouse, click, or scroll input within 30 seconds\./);
  assert.match(blockHtml, /Hands-off: foreground time without input within 30 seconds, such as reading, watching, or listening\./);
  assert.equal(extractActivityDuration(html, 'SoundCloud'), '10 min');
});

test('activity stream renders Activity Mix for one-state recorded blocks', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const codex = {
    start: dateStart,
    end: dateStart + 4 * 60 * 1000,
    app: 'Codex',
    title: 'Codex',
    url: '',
    interactionState: 'handsOn',
    activityMix: {
      handsOnMs: 4 * 60 * 1000,
      handsOffMs: 0
    }
  };

  const html = renderMemoryAidHtml({
    zoom: 5,
    activities: [codex],
    timelineActivities: [codex]
  });
  const blockHtml = extractActivityBlockHtml(html, 'Codex');

  assert.match(blockHtml, /duration-pill activity-mix-pill shrink-0/);
  assert.match(blockHtml, /--activity-mix-hands-on: 100%/);
  assert.match(blockHtml, /data-activity-mix-tooltip="Activity Mix\. Hands-on 4 min · Hands-off 0s\./);
  assert.match(blockHtml, /aria-label="Activity Mix\. Hands-on 4 min · Hands-off 0s\./);
});

test('Activity Mix range calculation preserves non-zero hands-off source segments', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const mix = context.getActivityMixInRange({
    start: dateStart,
    end: dateStart + 10 * 60 * 1000,
    app: 'Oriel',
    title: 'Oriel',
    interactionState: 'handsOn',
    sourceSegments: [
      {
        start: dateStart,
        end: dateStart + 2 * 60 * 1000,
        interactionState: 'handsOn'
      },
      {
        start: dateStart + 2 * 60 * 1000,
        end: dateStart + 10 * 60 * 1000,
        interactionState: 'handsOff'
      }
    ]
  }, dateStart, dateStart + 10 * 60 * 1000);

  assert.equal(mix.handsOnMs, 2 * 60 * 1000);
  assert.equal(mix.handsOffMs, 8 * 60 * 1000);
});

test('Activity Mix pill styling uses Oriel tooltip and muted hands-off color', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.match(html, /id="activity-mix-tooltip"/);
  assert.match(html, /class="activity-mix-summary__heading"/);
  assert.match(html, /id="popup-activity-mix-info"/);
  assert.doesNotMatch(html, /popup-activity-mix-bar/);
  assert.match(css, /\.activity-mix-tooltip/);
  assert.match(css, /\.activity-mix-tooltip__row/);
  assert.match(css, /\.activity-mix-info/);
  assert.match(css, /--activity-mix-hands-on-color:\s*var\(--accent\)/);
  assert.match(css, /:root\[data-theme="light"\] \.duration-pill\.activity-mix-pill\s*\{[\s\S]*--activity-mix-hands-on-color:\s*oklch\(0\.43 0\.16 255\)/);
  assert.match(css, /--activity-mix-hands-off:\s*color-mix\(in oklch, var\(--text-tertiary\)/);
  assert.doesNotMatch(css, /var\(--warning\) var\(--activity-mix-hands-on\) 100%/);
});

test('Activity Mix tooltip renders scannable rows instead of one paragraph', () => {
  const context = loadTimelineContext();
  const tooltip = new FakeElement('activity-mix-tooltip');
  tooltip.getBoundingClientRect = () => ({ width: 260, height: 120 });
  context.DOM.elActivityMixTooltip = tooltip;
  context.window.innerWidth = 1000;

  context.showActivityMixTooltip({
    dataset: {
      activityMixTooltip: 'Activity Mix. Hands-on 2 min · Hands-off 8 min. Hands-on: recent keyboard, mouse, click, or scroll input within 30 seconds. Hands-off: foreground time without input within 30 seconds, such as reading, watching, or listening.',
      activityMixHandsOnDuration: '2 min',
      activityMixHandsOffDuration: '8 min'
    },
    getBoundingClientRect: () => ({ left: 100, width: 40, bottom: 200 })
  });

  assert.equal(tooltip.classList.contains('hidden'), false);
  assert.match(tooltip.innerHTML, /activity-mix-tooltip__title">Activity Mix/);
  assert.match(tooltip.innerHTML, /activity-mix-tooltip__row[\s\S]*Hands-on[\s\S]*2 min/);
  assert.match(tooltip.innerHTML, /activity-mix-tooltip__row[\s\S]*Hands-off[\s\S]*8 min/);
  assert.match(tooltip.innerHTML, /Recent keyboard, mouse, click, or scroll input within 30 seconds\./);
  assert.match(tooltip.innerHTML, /Foreground time without recent input, such as reading, watching, or listening\./);
});

test('Activity Mix info icon explains the concept without a repeated heading or durations', () => {
  const context = loadTimelineContext();
  const tooltip = new FakeElement('activity-mix-tooltip');
  tooltip.getBoundingClientRect = () => ({ width: 260, height: 90 });
  context.DOM.elActivityMixTooltip = tooltip;
  context.window.innerWidth = 1000;

  context.showActivityMixTooltip({
    dataset: {
      activityMixTooltip: 'Shows how much of this recorded foreground time included recent keyboard, mouse, click, or scroll input within 30 seconds. Hands-off still counts when the app stayed in front while you read, watched, or listened.',
      activityMixTooltipVariant: 'summary'
    },
    getBoundingClientRect: () => ({ left: 100, width: 20, bottom: 200 })
  });

  assert.equal(tooltip.classList.contains('hidden'), false);
  assert.doesNotMatch(tooltip.innerHTML, /activity-mix-tooltip__title/);
  assert.match(tooltip.innerHTML, /Shows how much of this recorded foreground time included recent keyboard, mouse, click, or scroll input within 30 seconds/);
  assert.match(tooltip.innerHTML, /Hands-off still counts when the app stayed in front while you read, watched, or listened/);
  assert.doesNotMatch(tooltip.innerHTML, /activity-mix-tooltip__row/);
  assert.doesNotMatch(tooltip.innerHTML, /2 min|8 min/);
});

test('Multiple Activities popup prefers a page-specific browser source title over a weak host title', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'chatgpt.com',
        url: 'https://chatgpt.com/',
        start: blockStart,
        end: blockStart + 60 * 1000,
        duration: 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Context Switching Simplification',
        url: 'https://chatgpt.com/c/123',
        start: blockStart + 60 * 1000,
        end: blockStart + 4 * 60 * 1000,
        duration: 3 * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart + 4 * 60 * 1000,
        end: blockStart + 5 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.match(popup.renderedMultiList, /font-bold[^>]*>Context Switching Simplification<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /font-bold[^>]*>chatgpt\.com<\/span>/);
  assert.match(popup.renderedMultiList, /title="Brave Browser">Brave Browser<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /title="chatgpt\.com">chatgpt\.com<\/span>/);
  assert.match(popup.renderedMultiList, /<span class="font-bold[^"]*" title="Context Switching Simplification">Context Switching Simplification<\/span>\s*<a href="https:\/\/chatgpt\.com\/c\/123"[^>]*class="popup-activity-external-link[^"]*"[^>]*>/);
  assert.match(popup.renderedMultiList, /<i class="ph ph-arrow-square-out/);
  assert.doesNotMatch(popup.renderedMultiList, /href="https:\/\/chatgpt\.com\/"/);
});

test('Multiple Activities popup labels same-host browser rows by dominant source title', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const startCell = 183;
  const blockStart = dateStart + startCell * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    startCell,
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'Meal Ingredients List',
        url: 'https://chatgpt.com/c/meal',
        start: blockStart,
        end: blockStart + 2500,
        duration: 2500
      },
      {
        app: 'Brave Browser',
        title: 'User Activity Analysis',
        url: 'https://chatgpt.com/c/activity',
        start: blockStart + 20 * 1000,
        end: blockStart + 11 * 60 * 1000,
        duration: 10 * 60 * 1000 + 40 * 1000
      },
      {
        app: 'LM Studio',
        title: 'LM Studio',
        start: blockStart + 11 * 60 * 1000,
        end: blockStart + 14 * 60 * 1000,
        duration: 3 * 60 * 1000
      }
    ]
  });

  assert.match(popup.renderedMultiList, /font-bold[^>]*>User Activity Analysis<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /font-bold[^>]*>Meal Ingredients List<\/span>/);
  assert.match(popup.renderedMultiList, /<span class="font-bold[^"]*" title="User Activity Analysis">User Activity Analysis<\/span>\s*<a href="https:\/\/chatgpt\.com\/c\/activity"[^>]*class="popup-activity-external-link[^"]*"[^>]*>/);
  assert.doesNotMatch(popup.renderedMultiList, /href="https:\/\/chatgpt\.com\/c\/meal"/);
});

test('Multiple Activities popup falls back to host when browser titles are URL-like', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'https://app.ynab.com/5f53b33e-a5f5-46fd-a8d8-bf8885fa5c8f/budget',
        url: 'https://app.ynab.com/5f53b33e-a5f5-46fd-a8d8-bf8885fa5c8f/budget',
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'app.ynab.com/5f53b33e-a5f5-46fd-a8d8-bf8885fa5c8f/budget',
        url: 'https://app.ynab.com/5f53b33e-a5f5-46fd-a8d8-bf8885fa5c8f/budget',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 4 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Oriel',
        title: 'Oriel',
        start: blockStart + 4 * 60 * 1000,
        end: blockStart + 5 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.match(popup.renderedMultiList, /font-bold[^>]*>app\.ynab\.com<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /title="app\.ynab\.com\/5f53b33e|>app\.ynab\.com\/5f53b33e/);
  assert.match(popup.renderedMultiList, /href="https:\/\/app\.ynab\.com\/5f53b33e-a5f5-46fd-a8d8-bf8885fa5c8f\/budget"/);
  assert.match(popup.renderedMultiList, /title="Brave Browser">Brave Browser<\/span>/);
});

test('Activity Stream browser subtitles show only the app while preserving URL data', () => {
  const titleCleaner = loadTitleCleaningContext().cleanTitle;
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const html = renderActivityBlockChromeHtml({
    startCell: 118,
    app: 'Brave Browser',
    title: 'Facebook - Brave - Base',
    url: 'https://www.facebook.com/home',
    cleanTitle: titleCleaner,
    overlaps: [{
      app: 'Brave Browser',
      title: 'Facebook - Brave - Base',
      url: 'https://www.facebook.com/home',
      start: blockStart,
      end: blockStart + 2 * 60 * 1000,
      duration: 2 * 60 * 1000
    }]
  });

  assert.match(html, />Facebook<\/span>/);
  assert.match(html, />Brave Browser<\/span>/);
  assert.doesNotMatch(html, /Brave Browser \(facebook\.com\)/);
  assert.doesNotMatch(html, /Brave Browser \(www\.facebook\.com\)/);
  assert.match(html, /data-url="https:\/\/www\.facebook\.com\/home"/);
});

test('same-host browser activity opens the single details popup with URL visible', () => {
  const titleCleaner = loadTitleCleaningContext().cleanTitle;
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    cleanTitle: titleCleaner,
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'Client Portal - Brave - Base',
        url: 'https://client.example.com/dashboard',
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Client Portal Settings - Brave - Base',
        url: 'https://client.example.com/settings',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 4 * 60 * 1000,
        duration: 2 * 60 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Client Portal');
  assert.equal(popup.context.DOM.elPopupTitle.innerText, 'Brave Browser');
  assert.equal(popup.context.DOM.elPopupUrl.innerText, 'https://client.example.com/dashboard');
  assert.equal(popup.renderedMultiList, '');
});

test('Multiple Activities popup host fallback strips leading www from browser labels', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'www.facebook.com/home',
        url: 'https://www.facebook.com/home',
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 3 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Multiple Activities');
  assert.match(popup.renderedMultiList, /font-bold[^>]*>facebook\.com<\/span>/);
  assert.match(popup.renderedMultiList, /title="Brave Browser">Brave Browser<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /title="www\.facebook\.com|>www\.facebook\.com/);
});

test('Multiple Activities popup suppresses duplicate native app secondary labels', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    app: 'Codex',
    title: 'Codex',
    overlaps: [
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Oriel',
        title: 'Oriel',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 3 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.match(popup.renderedMultiList, /font-bold[^>]*>Codex<\/span>/);
  assert.equal((popup.renderedMultiList.match(/title="Codex"/g) || []).length, 1);
});

test('Multiple Activities popup display labels do not rewrite assignment payloads', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'chatgpt.com',
        url: 'https://chatgpt.com/',
        start: blockStart,
        end: blockStart + 60 * 1000,
        duration: 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Context Switching Simplification',
        url: 'https://chatgpt.com/c/123',
        start: blockStart + 60 * 1000,
        end: blockStart + 4 * 60 * 1000,
        duration: 3 * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart + 4 * 60 * 1000,
        end: blockStart + 5 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  popup.context.DOM.elPopupAssignBtn.onclick();

  const browserAssignment = popup.modalArgs[6].find(activity => activity.app === 'Brave Browser');
  assert.equal(browserAssignment.title, 'chatgpt.com');
  assert.equal(browserAssignment.url, 'https://chatgpt.com/');
  assert.equal(browserAssignment.assignmentModel, 'activity-stream-summary');
});

test('single visible activity with hidden short rows opens single details and assigns only visible row', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  let renderedMultiList = '';
  let modalArgs = null;

  const createClassList = () => ({
    add() {},
    remove() {},
    contains() {
      return false;
    }
  });

  context.DOM.elPopupDuration = { innerText: '', title: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupTitle = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: createClassList(), querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: createClassList() };
  context.DOM.elPopupUrlContainer = { classList: createClassList() };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
    },
    get innerHTML() {
      return renderedMultiList;
    },
    querySelectorAll() {
      return [];
    }
  };
  context.DOM.elPopupActivityMixContainer = { classList: createClassList(), setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupActivityMixLabel = { innerText: '' };
  context.DOM.elPopupActivityMixInfo = { setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = { style: {}, classList: createClassList() };
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: String(10 * 12 + 45 / 5),
      span: '3',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          app: 'Codex',
          title: 'Codex',
          start: dateStart + (10 * 60 + 45) * 60 * 1000,
          end: dateStart + (10 * 60 + 56) * 60 * 1000,
          duration: 11 * 60 * 1000
        },
        {
          app: 'Oriel',
          title: 'Oriel',
          start: dateStart + (10 * 60 + 56) * 60 * 1000,
          end: dateStart + (10 * 60 + 56) * 60 * 1000 + 23 * 1000,
          duration: 23 * 1000
        },
        {
          app: 'SoundCloud',
          title: 'SoundCloud',
          start: dateStart + (10 * 60 + 57) * 60 * 1000,
          end: dateStart + (10 * 60 + 57) * 60 * 1000 + 17 * 1000,
          duration: 17 * 1000
        }
      ]))
    }
  });

  assert.equal(context.DOM.elPopupDuration.innerText, '11 min');
  assert.equal(context.DOM.elPopupAppName.innerText, 'Codex');
  assert.equal(context.DOM.elPopupTitle.innerText, 'Codex');
  assert.equal(renderedMultiList, '');
  assert.doesNotMatch(renderedMultiList, /Oriel/);
  assert.doesNotMatch(renderedMultiList, /SoundCloud/);

  context.DOM.elPopupAssignBtn.onclick();

  assert.equal(modalArgs[6].length, 1);
  assert.equal(modalArgs[6][0].app, 'Codex');
});

test('single sub-minute Activity Stream details popup still shows seconds', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);

  const createClassList = () => ({
    add() {},
    remove() {},
    contains() {
      return false;
    }
  });

  context.DOM.elPopupDuration = { innerText: '', title: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupTitle = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: createClassList(), querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: createClassList() };
  context.DOM.elPopupUrlContainer = { classList: createClassList() };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = { innerHTML: '', querySelectorAll() { return []; } };
  context.DOM.elPopupActivityMixContainer = { classList: createClassList(), setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupActivityMixLabel = { innerText: '' };
  context.DOM.elPopupActivityMixInfo = { setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = { style: {}, classList: createClassList() };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: '0',
      span: '1',
      app: 'Oriel',
      title: 'Oriel',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([{
        app: 'Oriel',
        title: 'Oriel',
        start: dateStart,
        end: dateStart + 23 * 1000,
        duration: 23 * 1000
      }]))
    }
  });

  assert.equal(context.DOM.elPopupDuration.innerText, '23s');
});

test('Multiple Activities block duration matches popup-visible breakdown duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const startCell = 155;
  const blockStart = dateStart + startCell * 5 * 60 * 1000;
  const overlaps = [
    {
      app: 'Codex',
      title: 'Codex',
      start: blockStart,
      end: blockStart + 64 * 1000,
      duration: 64 * 1000
    },
    {
      app: 'Oriel',
      title: 'Oriel',
      start: blockStart + 2 * 60 * 1000,
      end: blockStart + 2 * 60 * 1000 + 45 * 1000,
      duration: 45 * 1000
    }
  ];
  const blockHtml = renderActivityBlockChromeHtml({
    startCell,
    span: 1,
    app: 'Codex',
    title: 'Codex',
    overlaps
  });
  const popup = renderMultipleActivitiesPopup({
    startCell,
    span: 1,
    app: 'Codex',
    title: 'Codex',
    overlaps
  });

  assert.equal(extractActivityDuration(blockHtml, 'Codex'), '1 min');
  assert.equal(popup.context.DOM.elPopupDuration.innerText, '1 min');
  assert.equal(extractActivityDuration(blockHtml, 'Codex'), popup.context.DOM.elPopupDuration.innerText);
});

test('Activity Stream inline badges use popup-visible secondary rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + (12 * 60 + 45) * 60 * 1000;
  const noisySwitches = Array.from({ length: 12 }, (_, index) => ({
    app: `Noise ${index}`,
    title: `Noise ${index}`,
    start: blockStart + (8 * 60 + index * 5) * 1000,
    end: blockStart + (8 * 60 + index * 5 + 3) * 1000,
    duration: 3 * 1000
  }));
  const html = renderActivityBlockChromeHtml({
    overlaps: [
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart,
        end: blockStart + 7 * 60 * 1000,
        duration: 7 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Security Problem - YouTube',
        url: 'https://www.youtube.com/watch?v=1',
        start: blockStart + 60 * 1000,
        end: blockStart + 2 * 60 * 1000,
        duration: 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Another YouTube Title',
        url: 'https://www.youtube.com/watch?v=2',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 3 * 60 * 1000,
        duration: 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'nu.nl',
        url: 'https://www.nu.nl/',
        start: blockStart + 3 * 60 * 1000,
        end: blockStart + 5 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'x.com',
        url: 'https://x.com/home',
        start: blockStart + 5 * 60 * 1000,
        end: blockStart + 7 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      ...noisySwitches
    ]
  });

  assert.equal(countActivityIcon(html, 'Codex'), 1);
  assert.equal(countActivityIcon(html, 'Brave Browser'), 2);
  assert.match(html, />\s*\+1\s*</);
  assert.doesNotMatch(html, /\+\d{2,}/);
  for (const activity of noisySwitches) {
    assert.equal(countActivityIcon(html, activity.app), 0);
  }
});

test('Activity Stream inline badges hide when secondary rows are only sub-minute', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + (13 * 60 + 20) * 60 * 1000;
  const html = renderActivityBlockChromeHtml({
    overlaps: [
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart,
        end: blockStart + 5 * 60 * 1000,
        duration: 5 * 60 * 1000
      },
      {
        app: 'Oriel',
        title: 'Oriel',
        start: blockStart + 60 * 1000,
        end: blockStart + 80 * 1000,
        duration: 20 * 1000
      },
      {
        app: 'SoundCloud',
        title: 'SoundCloud',
        start: blockStart + 90 * 1000,
        end: blockStart + 125 * 1000,
        duration: 35 * 1000
      }
    ]
  });

  assert.equal(countActivityIcon(html, 'Codex'), 1);
  assert.equal(countActivityIcon(html, 'Oriel'), 0);
  assert.equal(countActivityIcon(html, 'SoundCloud'), 0);
  assert.doesNotMatch(html, />\s*\+\d+\s*</);
});

test('activity summaries clip hands-on and hands-off source segments to the selected range', () => {
  const context = loadTimelineContext();
  const summaries = context.summarizeActivityOverlaps([
    {
      start: 0,
      end: 10 * 60 * 1000,
      duration: 10 * 60 * 1000,
      app: 'Brave Browser',
      title: 'Long article',
      url: 'https://example.com/article',
      interactionState: 'handsOn',
      activityMix: {
        handsOnMs: 2 * 60 * 1000,
        handsOffMs: 8 * 60 * 1000
      },
      sourceSegments: [
        { start: 0, end: 2 * 60 * 1000, interactionState: 'handsOn' },
        { start: 2 * 60 * 1000, end: 10 * 60 * 1000, interactionState: 'handsOff' }
      ]
    }
  ], 60 * 1000, 5 * 60 * 1000);
  const summary = summaries[0];

  assert.equal(summary.duration, 4 * 60 * 1000);
  assert.equal(summary.activityMix.handsOnMs, 60 * 1000);
  assert.equal(summary.activityMix.handsOffMs, 3 * 60 * 1000);
  assert.equal(summary.sources[0].activityMix.handsOnMs, 60 * 1000);
  assert.equal(summary.sources[0].activityMix.handsOffMs, 3 * 60 * 1000);
});

test('activity summaries sum similar browser activities by hostname and cleaned title', () => {
  const context = loadTimelineContext();
  context.cleanTitle = title => title.replace(/\s+-\s+Brave Browser$/, '');

  const summaries = context.summarizeActivityOverlaps([
    {
      app: 'Brave Browser',
      title: 'Plan | Personal | YNAB - Brave Browser',
      url: 'https://app.ynab.com/accounts/1',
      duration: 2 * 60 * 1000,
      start: 1000,
      end: 121000
    },
    {
      app: 'Brave Browser',
      title: 'Plan | Personal | YNAB - Brave Browser',
      url: 'https://app.ynab.com/accounts/2',
      duration: 3 * 60 * 1000,
      start: 121000,
      end: 301000
    },
    {
      app: 'Brave Browser',
      title: 'Plan | Personal | YNAB - Brave Browser',
      url: 'https://support.ynab.com/',
      duration: 60 * 1000,
      start: 301000,
      end: 361000
    }
  ]);

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].title, 'Plan | Personal | YNAB');
  assert.equal(summaries[0].url, 'https://app.ynab.com/accounts/1');
  assert.equal(summaries[0].duration, 5 * 60 * 1000);
  assert.equal(summaries[1].duration, 60 * 1000);
});

test('activity summaries preserve non-contiguous source segments for assignment', () => {
  const context = loadTimelineContext();

  const firstStart = 1000;
  const firstEnd = firstStart + 2 * 60 * 1000;
  const secondStart = firstStart + 10 * 60 * 1000;
  const secondEnd = secondStart + 3 * 60 * 1000;
  const summaries = context.summarizeActivityOverlaps([
    {
      app: 'Codex',
      title: 'Codex',
      duration: firstEnd - firstStart,
      start: firstStart,
      end: firstEnd
    },
    {
      app: 'Codex',
      title: 'Codex',
      duration: secondEnd - secondStart,
      start: secondStart,
      end: secondEnd
    }
  ]);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].start, firstStart);
  assert.equal(summaries[0].end, secondEnd);
  assert.equal(summaries[0].duration, 5 * 60 * 1000);
  assert.deepEqual(Array.from(summaries[0].sources, source => [source.start, source.end]), [
    [firstStart, firstEnd],
    [secondStart, secondEnd]
  ]);
});

test('activity summaries are ordered from old to new', () => {
  const context = loadTimelineContext();

  const summaries = context.summarizeActivityOverlaps([
    {
      app: 'Codex',
      title: 'Later',
      duration: 10 * 60 * 1000,
      start: 2000,
      end: 12000
    },
    {
      app: 'Brave Browser',
      title: 'Earlier',
      duration: 60 * 1000,
      start: 1000,
      end: 2000
    }
  ]);

  assert.equal(Array.from(summaries, summary => summary.title).join(','), 'Earlier,Later');
});

test('time entry modal excludes unchecked recorded activities from the saved snapshot helper', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();
  const rangeActivities = [
    {
      app: 'Codex',
      title: 'Codex',
      url: '',
      duration: 9 * 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Reference Browser Tab',
      url: 'http://localhost:3000/',
      duration: 4 * 60 * 1000
    }
  ];

  context.openTimeEntryModal(startMs, startMs + 60 * 60 * 1000, '', null, null, false, rangeActivities);

  assert.match(elements.get('modal-memory-aid-list').innerHTML, /data-modal-activity-index="0"/);
  assert.match(elements.get('modal-memory-aid-list').innerHTML, /data-modal-activity-index="1"/);
  assert.equal(context.getSelectedModalActivities().length, 2);

  context.setModalActivityIncluded(1, false);

  assert.deepEqual(context.getSelectedModalActivities().map(activity => activity.app), ['Codex']);
  assert.deepEqual(context.state.currentModalActivities.map(activity => activity.app), ['Codex']);
});

test('drag-created time entry modal hides sub-minute activities and sums visible candidates', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 11, 30).getTime();
  const rangeActivities = [
    {
      app: 'Brave Browser',
      title: 'Quick tab',
      url: 'https://example.com/quick',
      duration: 45 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'One minute tab',
      url: 'https://example.com/one',
      duration: 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Two minute tab',
      url: 'https://example.com/two',
      duration: 2 * 60 * 1000
    }
  ];

  context.openTimeEntryModal(startMs, startMs + 2.5 * 60 * 60 * 1000, '', null, null, false, rangeActivities);

  const listHtml = elements.get('modal-memory-aid-list').innerHTML;
  assert.doesNotMatch(listHtml, /Quick tab/);
  assert.doesNotMatch(listHtml, />0 min</);
  assert.match(listHtml, /One minute tab/);
  assert.match(listHtml, /Two minute tab/);
  assert.equal(context.getSelectedModalActivities().length, 2);
  assert.equal(elements.get('modal-duration-lbl').innerText, '3 min');
});

test('drag-created time entry modal duration follows deselected visible activities', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 11, 30).getTime();
  const rangeActivities = [
    {
      app: 'Brave Browser',
      title: 'One minute tab',
      url: 'https://example.com/one',
      duration: 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Two minute tab',
      url: 'https://example.com/two',
      duration: 2 * 60 * 1000
    }
  ];

  context.openTimeEntryModal(startMs, startMs + 2.5 * 60 * 60 * 1000, '', null, null, false, rangeActivities);

  assert.equal(elements.get('modal-duration-lbl').innerText, '3 min');

  context.setModalActivityIncluded(1, false);
  assert.equal(elements.get('modal-duration-lbl').innerText, '1 min');

  context.setModalActivityIncluded(0, false);
  assert.equal(elements.get('modal-duration-lbl').innerText, '0 min');
});

test('edited time entry modal with explicit activity candidates sums selected activity durations', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 21, 40).getTime();
  const endMs = new Date(2026, 4, 21, 22, 10).getTime();
  const rangeActivities = [
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template',
      bundleId: 'com.figma.Desktop',
      duration: 14 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      bundleId: 'com.openai.codex',
      duration: 60 * 1000
    }
  ];

  context.editingTimeEntryId = 'entry-1';
  context.openTimeEntryModal(startMs, endMs, '', 'project-1', true, false, rangeActivities);

  assert.equal(elements.get('modal-duration-lbl').innerText, '15 min');

  context.setModalActivityIncluded(1, false);
  assert.equal(elements.get('modal-duration-lbl').innerText, '14 min');
});

test('drag-created time entry modal falls back to manual range when no visible activities remain', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 11, 30).getTime();
  const rangeActivities = [
    {
      app: 'Brave Browser',
      title: 'Quick tab',
      url: 'https://example.com/quick',
      duration: 45 * 1000
    }
  ];

  context.openTimeEntryModal(startMs, startMs + 15 * 60 * 1000, '', null, null, false, rangeActivities);

  assert.equal(elements.get('modal-memory-aid-list').innerHTML, '');
  assert.equal(elements.get('modal-left-panel').classList.contains('hidden'), true);
  assert.equal(context.getSelectedModalActivities().length, 0);
  assert.equal(elements.get('modal-duration-lbl').innerText, '15 min');
});

test('bulk time entry modal keeps separated selected activities as separate rows', () => {
  const { context } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();
  const first = {
    app: 'Brave Browser',
    title: 'Issue Tracker',
    url: 'https://github.com/example',
    start: startMs,
    end: startMs + 15 * 60 * 1000,
    duration: 15 * 60 * 1000
  };
  const second = {
    app: 'Brave Browser',
    title: 'Issue Tracker',
    url: 'https://github.com/example',
    start: startMs + 4 * 60 * 60 * 1000,
    end: startMs + (4 * 60 + 20) * 60 * 1000,
    duration: 20 * 60 * 1000
  };
  context.summarizeActivityOverlaps = activities => [{
    ...activities[0],
    start: activities[0].start,
    end: activities[1].end,
    duration: activities.reduce((total, activity) => total + activity.duration, 0)
  }];

  context.openTimeEntryModal(first.start, second.end, '', null, null, true, [first, second]);

  assert.equal(context.getSelectedModalActivities().length, 2);
  assert.deepEqual(context.getSelectedModalActivities().map(activity => [activity.start, activity.end]), [
    [first.start, first.end],
    [second.start, second.end]
  ]);
});

test('bulk time entry modal duration sums selected activity durations instead of envelope', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();
  const first = {
    app: 'Brave Browser',
    title: 'Issue Tracker',
    url: 'https://github.com/example',
    start: startMs,
    end: startMs + 15 * 60 * 1000,
    duration: 15 * 60 * 1000
  };
  const second = {
    app: 'Brave Browser',
    title: 'Issue Tracker',
    url: 'https://github.com/example',
    start: startMs + 4 * 60 * 60 * 1000,
    end: startMs + (4 * 60 + 20) * 60 * 1000,
    duration: 20 * 60 * 1000
  };

  context.openTimeEntryModal(first.start, second.end, '', null, null, true, [first, second]);

  assert.equal(elements.get('modal-duration-lbl').innerText, '35 min');
});

test('time entry modal uses assigned activity duration for activity-stream edits', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();
  const endMs = startMs + 30 * 60 * 1000;

  context.editingTimeEntryId = 'entry-1';
  context.state.timeEntries = [{
    id: 'entry-1',
    start: startMs,
    end: endMs,
    projectId: 'project-1',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      start: startMs,
      end: endMs,
      duration: 18 * 60 * 1000,
      assignedDurationMs: 18 * 60 * 1000,
      assignmentSource: 'activity-stream'
    }]
  }];

  context.openTimeEntryModal(startMs, endMs, '', 'project-1', true, false, null);

  assert.equal(elements.get('modal-duration-lbl').innerText, '18 min');
  assert.match(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">18 min<\/span>/);
  assert.doesNotMatch(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">30 min<\/span>/);
});

test('time entry modal keeps assigned duration when using the integrated activity summarizer', () => {
  const { context, elements } = loadModalsContext();
  context.URL = URL;
  vm.runInContext(fs.readFileSync('js/timeline.js', 'utf8'), context);

  const startMs = new Date(2026, 4, 21, 9, 0).getTime();
  const endMs = startMs + 20 * 60 * 1000;

  context.editingTimeEntryId = 'entry-1';
  context.state.timeEntries = [{
    id: 'entry-1',
    start: startMs,
    end: endMs,
    projectId: 'project-1',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      start: startMs,
      end: endMs,
      duration: 11 * 60 * 1000,
      assignedDurationMs: 11 * 60 * 1000,
      assignmentStart: startMs,
      assignmentEnd: endMs,
      assignmentSource: 'activity-stream'
    }]
  }];

  context.openTimeEntryModal(startMs, endMs, '', 'project-1', true, false, null);

  assert.equal(elements.get('modal-duration-lbl').innerText, '11 min');
  assert.match(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">11 min<\/span>/);
});

test('time entry modal derives legacy activity-stream envelope duration from recorded runs', () => {
  const { context, elements } = loadModalsContext();
  context.URL = URL;
  vm.runInContext(fs.readFileSync('js/timeline.js', 'utf8'), context);

  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const envelopeStart = dateStart + (13 * 60) * 60 * 1000;
  const envelopeEnd = dateStart + (13 * 60 + 5) * 60 * 1000;
  const runStart = dateStart + (13 * 60 + 3) * 60 * 1000;
  const runEnd = dateStart + (13 * 60 + 4) * 60 * 1000;

  context.editingTimeEntryId = 'entry-1';
  context.state.activities = [{
    app: 'Codex',
    title: 'Codex',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex',
    start: runStart,
    end: runEnd,
    duration: 60 * 1000
  }];
  context.state.timeEntries = [{
    id: 'entry-1',
    start: envelopeStart,
    end: envelopeEnd,
    projectId: 'project-1',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: envelopeStart,
      end: envelopeEnd,
      duration: 2 * 60 * 1000,
      assignedDurationMs: 2 * 60 * 1000,
      assignmentSource: 'activity-stream'
    }]
  }];

  context.openTimeEntryModal(envelopeStart, envelopeEnd, '', 'project-1', true, false, null);

  assert.equal(elements.get('modal-duration-lbl').innerText, '1 min');
  assert.match(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">1 min<\/span>/);
  assert.doesNotMatch(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">2 min<\/span>/);
});

test('grouped activity-stream edit activities derive legacy envelope durations from recorded runs', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstEnvelopeStart = dateStart + (13 * 60) * 60 * 1000;
  const firstEnvelopeEnd = dateStart + (13 * 60 + 5) * 60 * 1000;
  const secondEnvelopeStart = dateStart + (13 * 60 + 15) * 60 * 1000;
  const secondEnvelopeEnd = dateStart + (13 * 60 + 25) * 60 * 1000;

  context.state.activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (13 * 60 + 3) * 60 * 1000,
      end: dateStart + (13 * 60 + 4) * 60 * 1000,
      duration: 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (13 * 60 + 16) * 60 * 1000,
      end: dateStart + (13 * 60 + 21) * 60 * 1000,
      duration: 5 * 60 * 1000
    }
  ];

  const grouped = context.getGroupedTimeEntryActivities([
    {
      id: 'entry-1',
      start: firstEnvelopeStart,
      end: firstEnvelopeEnd,
      projectId: 'project-1',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: firstEnvelopeStart,
        end: firstEnvelopeEnd,
        assignedDurationMs: 2 * 60 * 1000,
        assignmentSource: 'activity-stream'
      }]
    },
    {
      id: 'entry-2',
      start: secondEnvelopeStart,
      end: secondEnvelopeEnd,
      projectId: 'project-1',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: secondEnvelopeStart,
        end: secondEnvelopeEnd,
        assignedDurationMs: 7 * 60 * 1000,
        assignmentSource: 'activity-stream'
      }]
    }
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].assignedDurationMs, 6 * 60 * 1000);
  assert.equal(grouped[0].duration, 6 * 60 * 1000);
});

test('time entry modal leaves descriptions empty for recorded activity ranges', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();

  context.openTimeEntryModal(startMs, startMs + 15 * 60 * 1000, 'Work on: Brave Browser', null, null, false, [
    {
      app: 'Brave Browser',
      title: 'Project dashboard',
      url: 'http://localhost:3000/',
      duration: 15 * 60 * 1000
    }
  ]);

  assert.equal(elements.get('modal-description-input').value, '');
});

test('time entry modal offers active tasks for the selected project', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();

  context.openTimeEntryModal(startMs, startMs + 15 * 60 * 1000, '', 'project-1', true, false, null, 'task-1');

  assert.equal(elements.get('modal-task-container').classList.contains('hidden'), false);
  assert.match(elements.get('modal-task-select').innerHTML, /No task/);
  assert.match(elements.get('modal-task-select').innerHTML, /Planning/);
  assert.doesNotMatch(elements.get('modal-task-select').innerHTML, /Archived Task/);
  assert.equal(elements.get('modal-task-select').value, 'task-1');
});

test('selected activity assignment modal uses clear assignment copy', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();

  context.openTimeEntryModal(startMs, startMs + 15 * 60 * 1000, '', null, null, true, [
    {
      app: 'Codex',
      title: 'Codex',
      url: '',
      duration: 15 * 60 * 1000
    }
  ]);

  assert.equal(elements.get('modal-title').innerText, 'Assign Selected Activity');
});

test('multiple activity popover aligns app names separately without dash separators', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  let renderedMultiList = '';

  context.DOM.elPopupDuration = { innerText: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
    },
    get innerHTML() {
      return renderedMultiList;
    }
  };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { remove() {} }
  };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: '118',
      span: '2',
      app: 'Brave Browser',
      title: 'Reference Browser Tab',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          app: 'Brave Browser',
          title: 'Reference Browser Tab',
          url: 'http://localhost:3000',
          duration: 4 * 60 * 1000,
          start: blockStart,
          end: blockStart + 4 * 60 * 1000
        },
        {
          app: 'Code Editor',
          title: 'Code Editor',
          url: '',
          duration: 60 * 1000,
          start: blockStart + 4 * 60 * 1000,
          end: blockStart + 5 * 60 * 1000
        }
      ]))
    }
  });

  assert.equal(renderedMultiList.includes('—'), false);
  assert.match(renderedMultiList, /<div class="flex items-center gap-1 min-w-0 flex-1">\s*<span class="font-bold text-gray-200 truncate min-w-0"/);
  assert.match(renderedMultiList, /<span class="text-gray-400 text-right truncate shrink-0 max-w-\[42%\]"/);
  assert.equal((renderedMultiList.match(/popup-activity-external-link/g) || []).length, 1);
});

test('multiple activity popover moves Activity Mix text to the footer', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  let renderedMultiList = '';

  function createClassList(initialClasses = []) {
    const classes = new Set(initialClasses);
    return {
      add: className => classes.add(className),
      remove: className => classes.delete(className),
      contains: className => classes.has(className)
    };
  }

  const mixContainerClassList = createClassList(['hidden']);
  const mixContainerAttributes = {};
  const mixInfoAttributes = {};
  context.DOM.elPopupDuration = { innerText: '', title: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} }, querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrlContainer = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
    },
    get innerHTML() {
      return renderedMultiList;
    }
  };
  context.DOM.elPopupActivityMixContainer = {
    classList: mixContainerClassList,
    title: '',
    querySelectorAll() {
      return [];
    },
    setAttribute(name, value) {
      mixContainerAttributes[name] = value;
    },
    removeAttribute(name) {
      delete mixContainerAttributes[name];
    }
  };
  context.DOM.elPopupActivityMixLabel = { innerText: '' };
  context.DOM.elPopupActivityMixInfo = {
    setAttribute(name, value) {
      mixInfoAttributes[name] = value;
    },
    removeAttribute(name) {
      delete mixInfoAttributes[name];
    }
  };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { remove() {} }
  };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: '138',
      span: '6',
      app: 'Oriel',
      title: 'Oriel',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          start: dateStart + 11 * 60 * 60 * 1000 + 30 * 60 * 1000,
          end: dateStart + 11 * 60 * 60 * 1000 + 52 * 60 * 1000,
          app: 'Oriel',
          title: 'Oriel',
          url: '',
          interactionState: 'handsOn',
          activityMix: {
            handsOnMs: 7 * 60 * 1000,
            handsOffMs: 15 * 60 * 1000
          },
          sourceSegments: [
            {
              start: dateStart + 11 * 60 * 60 * 1000 + 30 * 60 * 1000,
              end: dateStart + 11 * 60 * 60 * 1000 + 37 * 60 * 1000,
              interactionState: 'handsOn'
            },
            {
              start: dateStart + 11 * 60 * 60 * 1000 + 37 * 60 * 1000,
              end: dateStart + 11 * 60 * 60 * 1000 + 52 * 60 * 1000,
              interactionState: 'handsOff'
            }
          ]
        },
        {
          start: dateStart + 11 * 60 * 60 * 1000 + 52 * 60 * 1000,
          end: dateStart + 11 * 60 * 60 * 1000 + 54 * 60 * 1000,
          app: 'SoundCloud',
          title: 'SoundCloud',
          url: '',
          interactionState: 'handsOn'
        }
      ]))
    }
  });

  assert.equal(context.DOM.elPopupRange.innerText, '11:30 – 12:00');
  assert.equal(context.DOM.elPopupDuration.title, '');
  assert.doesNotMatch(renderedMultiList, /activity-mix-label--popup/);
  assert.doesNotMatch(renderedMultiList, />Hands-on 7 min · Hands-off 15 min</);
  assert.doesNotMatch(renderedMultiList, /title="Activity Mix\. Hands-on 7 min · Hands-off 15 min\./);
  assert.match(renderedMultiList, /data-activity-mix-tooltip="Activity Mix\. Hands-on 7 min · Hands-off 15 min\./);
  assert.match(renderedMultiList, /duration-pill activity-mix-pill shrink-0/);
  assert.match(renderedMultiList, /--activity-mix-hands-on: 31\.818182%/);
  assert.doesNotMatch(renderedMultiList, /activity-mix-bar/);
  assert.equal(mixContainerClassList.contains('hidden'), false);
  assert.equal(context.DOM.elPopupActivityMixLabel.innerText, 'Hands-on 9 min · Hands-off 15 min');
  assert.match(mixContainerAttributes['aria-label'], /Activity Mix\. Hands-on 9 min · Hands-off 15 min\./);
  assert.match(mixInfoAttributes['data-activity-mix-tooltip'], /Shows how much of this recorded foreground time included recent keyboard/);
  assert.equal(mixInfoAttributes['data-activity-mix-tooltip-variant'], 'summary');
  assert.equal(mixInfoAttributes['data-activity-mix-hands-on-duration'], undefined);
  assert.equal(mixInfoAttributes['data-activity-mix-hands-off-duration'], undefined);
});

test('activity details popup shows Activity Mix footer for one-state activity', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);

  function createClassList(initialClasses = []) {
    const classes = new Set(initialClasses);
    return {
      add: className => classes.add(className),
      remove: className => classes.delete(className),
      contains: className => classes.has(className)
    };
  }

  const mixContainerClassList = createClassList([]);
  const mixContainerAttributes = {};
  context.DOM.elPopupDuration = { innerText: '', title: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupTitle = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} }, querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrlContainer = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = { innerHTML: '' };
  context.DOM.elPopupActivityMixContainer = {
    classList: mixContainerClassList,
    title: 'stale',
    setAttribute(name, value) {
      mixContainerAttributes[name] = value;
    },
    removeAttribute(name) {
      delete mixContainerAttributes[name];
    }
  };
  context.DOM.elPopupActivityMixLabel = { innerText: 'stale' };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { add() {}, remove() {} }
  };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: '120',
      span: '2',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          start: dateStart + 10 * 60 * 60 * 1000,
          end: dateStart + 10 * 60 * 60 * 1000 + 10 * 60 * 1000,
          app: 'Codex',
          title: 'Codex',
          url: '',
          interactionState: 'handsOn'
        }
      ]))
    }
  });

  assert.equal(mixContainerClassList.contains('hidden'), false);
  assert.equal(context.DOM.elPopupActivityMixContainer.title, '');
  assert.equal(context.DOM.elPopupActivityMixLabel.innerText, 'Hands-on 10 min · Hands-off 0s');
  assert.match(mixContainerAttributes['aria-label'], /Activity Mix\. Hands-on 10 min · Hands-off 0s\./);
});

test('multiple activity popover selection stays local and assigns selected rows', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  let renderedMultiList = '';
  let modalArgs = null;
  const popupRows = [];

  function createClassList(initialClasses = []) {
    const classes = new Set(initialClasses);
    return {
      add: className => classes.add(className),
      remove: className => classes.delete(className),
      contains: className => classes.has(className)
    };
  }

  function createButton(initialClasses = []) {
    const listeners = {};
    const icon = { className: '' };
    return {
      classList: createClassList(initialClasses),
      addEventListener(type, listener) {
        listeners[type] = listener;
      },
      querySelector(selector) {
        return selector === 'i' ? icon : null;
      },
      click() {
        listeners.click?.({ stopPropagation() {} });
      }
    };
  }

  const blockCheckbox = createButton(['activity-checkbox']);
  const blockClasses = createClassList(['activity-block']);
  const block = {
    dataset: {
      startCell: '118',
      span: '2',
      app: 'Brave Browser',
      title: 'YNAB',
      url: 'https://app.ynab.com',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          app: 'Brave Browser',
          title: 'YNAB',
          url: 'https://app.ynab.com',
          duration: 4 * 60 * 1000,
          start: blockStart,
          end: blockStart + 4 * 60 * 1000
        },
        {
          app: 'Codex',
          title: 'Codex',
          bundleId: 'com.openai.codex',
          duration: 60 * 1000,
          start: blockStart + 4 * 60 * 1000,
          end: blockStart + 5 * 60 * 1000
        }
      ]))
    },
    classList: blockClasses,
    querySelector(selector) {
      if (selector === '.activity-checkbox') return blockCheckbox;
      if (selector === '.activity-checkbox i') return blockCheckbox.querySelector('i');
      return null;
    }
  };

  context.DOM.elPopupDuration = { innerText: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} }, querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrlContainer = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
      popupRows.length = 0;
      for (const match of value.matchAll(/data-popup-overlap-index="(\d+)"/g)) {
        const selectButton = createButton(['popup-activity-select', 'activity-checkbox']);
        const quickAddButton = createButton(['popup-activity-quick-add', 'activity-quick-add']);
        popupRows.push({
          dataset: { popupOverlapIndex: match[1] },
          classList: createClassList(['popup-activity-row']),
          querySelector(selector) {
            if (selector === '.popup-activity-select') return selectButton;
            if (selector === '.popup-activity-quick-add') return quickAddButton;
            return null;
          }
        });
      }
    },
    get innerHTML() {
      return renderedMultiList;
    },
    querySelectorAll(selector) {
      return selector === '[data-popup-overlap-index]' ? popupRows : [];
    }
  };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { add() {}, remove() {} }
  };
  context.DOM.elMultiSelectBar = {
    classList: createClassList(['hidden'])
  };
  context.DOM.elSelectedCount = { innerText: '' };
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;

  context.showActivityDetailsPopup(block);

  assert.match(renderedMultiList, /popup-activity-select/);
  assert.match(renderedMultiList, /popup-activity-quick-add/);
  assert.equal(popupRows.length, 2);

  popupRows[1].querySelector('.popup-activity-select').click();

  assert.equal(context.state.selectedActivities.size, 0);
  assert.equal(block.classList.contains('selected'), false);
  assert.equal(context.DOM.elMultiSelectBar.classList.contains('hidden'), true);
  assert.equal(context.DOM.elSelectedCount.innerText, '');

  context.DOM.elPopupAssignBtn.onclick();

  assert.equal(modalArgs[5], false);
  assert.equal(modalArgs[6].length, 1);
  assert.equal(modalArgs[6][0].app, 'Codex');
});

test('activity details assignment uses selected block bounds and summary durations', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  let modalArgs = null;

  context.state.zoom = 10;
  context.DOM.elPopupDuration = { innerText: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupMultiListContainer = { innerHTML: '' };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { add() {}, remove() {} }
  };
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;

  context.showActivityDetailsPopup({
    dataset: {
      startCell: String(7 * 6 + 3),
      span: '3',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          app: 'Brave Browser',
          title: 'Oriel Local Time Tracker',
          url: 'http://localhost:3000',
          duration: 2 * 60 * 1000,
          start: dateStart + (7 * 60 + 30) * 60 * 1000,
          end: dateStart + (7 * 60 + 32) * 60 * 1000
        },
        {
          app: 'Codex',
          title: 'Codex',
          url: '',
          duration: 18 * 60 * 1000,
          start: dateStart + (7 * 60 + 36) * 60 * 1000,
          end: dateStart + (7 * 60 + 54) * 60 * 1000
        }
      ]))
    }
  });
  context.DOM.elPopupAssignBtn.onclick();

  assert.equal(modalArgs[0], dateStart + (7 * 60 + 30) * 60 * 1000);
  assert.equal(modalArgs[1], dateStart + 8 * 60 * 60 * 1000);
  assert.equal(modalArgs[5], false);
  assert.equal(modalArgs[6].length, 2);
  assert.equal(modalArgs[6].find(activity => activity.app === 'Codex').assignedDurationMs, 18 * 60 * 1000);
  assert.equal(modalArgs[6][0].assignmentModel, 'activity-stream-summary');
  assert.equal(modalArgs[6][1].assignmentModel, 'activity-stream-summary');
});

test('recorded activity breakdown merges visually similar activities into one row', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  let renderedMultiList = '';

  context.DOM.elPopupDuration = { innerText: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} }, querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrlContainer = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
    },
    get innerHTML() {
      return renderedMultiList;
    }
  };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { remove() {} }
  };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: '0',
      span: '1',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          app: 'Codex',
          title: 'Codex',
          bundleId: 'com.openai.codex',
          duration: 2 * 60 * 1000,
          start: dateStart,
          end: dateStart + 2 * 60 * 1000
        },
        {
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          duration: 60 * 1000,
          start: dateStart + 2 * 60 * 1000,
          end: dateStart + 3 * 60 * 1000
        },
        {
          app: 'Oriel',
          title: 'Oriel',
          bundleId: 'so.sil.oriel',
          duration: 60 * 1000,
          start: dateStart + 3 * 60 * 1000,
          end: dateStart + 4 * 60 * 1000
        }
      ]))
    }
  });

  assert.equal((renderedMultiList.match(/class="flex items-center justify-between/g) || []).length, 2);
  assert.match(renderedMultiList, /3 min/);
  assert.match(renderedMultiList, /Oriel/);
});
