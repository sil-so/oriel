import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set();
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
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.innerHTML = '';
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.clientHeight = 600;
    this.scrollTop = 0;
  }

  addEventListener(type, listener) {
    this.listeners[type] ||= [];
    this.listeners[type].push(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] || []) {
      listener({
        target: this,
        button: 0,
        preventDefault() {},
        stopPropagation() {},
        ...event
      });
    }
  }

  querySelectorAll(selector) {
    if (!selector?.startsWith?.('.')) return [];
    const className = selector.slice(1);
    return this.children.filter(child => !child.removed && child.className.split(/\s+/).includes(className));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  appendChild(child) {
    this.child = child;
    this.children.push(child);
  }

  scrollTo(options) {
    this.lastScrollTo = options;
    this.scrollTop = options?.top ?? 0;
  }

  remove() {
    this.removed = true;
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, width: 120 };
  }
}

function loadWeekViewContext() {
  const elements = new Map();
  const windowListeners = {};
  const element = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  const openedModals = [];
  const context = {
    window: {
      addEventListener(type, listener) {
        windowListeners[type] ||= [];
        windowListeners[type].push(listener);
      }
    },
    document: {
      getElementById: element,
      createElement() {
        return new FakeElement('created');
      }
    },
    DOM: {
      get elWeekTimelineGrid() { return element('week-timeline-grid'); },
      get elWeekTimelineContainer() { return element('week-timeline-container'); }
    },
    state: {
      currentDate: new Date(2026, 4, 21),
      zoom: 60,
      projects: [{ id: 'project-1', name: 'Website', color: '#3b82f6' }],
      weekActivities: [],
      weekTimelineActivities: [],
      weekTimeEntries: []
    },
    getFormattedDate(date) {
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
      return local.toISOString().slice(0, 10);
    },
    buildLoggedTimeEntryRenderItems(entries) {
      return entries.map((entry, index) => ({
        entries: [entry],
        firstEntry: entry,
        start: entry.start,
        end: entry.end,
        displayStart: entry.start,
        displayEnd: entry.end,
        durationMs: entry.end - entry.start,
        sourceIndex: index,
        isAssignedGroup: false
      }));
    },
    getTimelineDisplayRowRange(entryStart, entryEnd) {
      return { start: entryStart, end: entryEnd };
    },
    getLoggedTimeEntryLaneStyle() {
      return '';
    },
    openTimeEntryBlockEditor(block) {
      context.lastEditedBlock = block;
    },
    summarizeActivityOverlaps(overlaps) {
      return overlaps;
    },
    openTimeEntryModal(...args) {
      openedModals.push(args);
    },
    cleanTitle: title => title,
    console
  };
  context.window = { ...context.window, ...context };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/week-view.js', 'utf8'), context);

  return {
    context,
    element,
    openedModals,
    dispatchWindow(type, event = {}) {
      for (const listener of windowListeners[type] || []) {
        listener(event);
      }
    }
  };
}

test('week helpers select a Monday-start seven day range', () => {
  const { context } = loadWeekViewContext();

  const range = context.getSelectedWeekRange(new Date(2026, 4, 21));

  assert.equal(context.getFormattedDate(range.start), '2026-05-18');
  assert.equal(context.getFormattedDate(range.end), '2026-05-24');
  assert.equal(context.getWeekDays(new Date(2026, 4, 21)).length, 7);
  assert.equal(context.formatSelectedWeekLabel(new Date(2026, 4, 21)), '18 May 2026 - 24 May 2026');
});

test('week timeline renders seven day columns and logged entry blocks', () => {
  const { context, element } = loadWeekViewContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  context.state.weekTimeEntries = [{
    id: 'entry-1',
    projectId: 'project-1',
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + 10 * 60 * 60 * 1000,
    description: 'Build timeline'
  }];

  context.renderWeekTimeline();

  const html = element('week-timeline-grid').innerHTML;
  assert.equal((html.match(/class="week-day-column/g) || []).length, 7);
  assert.equal((html.match(/class="week-row-lines"/g) || []).length, 7);
  assert.equal((html.match(/class="week-row-line"/g) || []).length, 168);
  assert.match(html, /data-week-date="2026-05-21"/);
  assert.match(html, /class="time-entry-block week-time-entry-block"/);
  assert.match(html, /Build timeline/);
  assert.match(html, /<div class="resize-handle-top"><\/div>/);
  assert.match(html, /class="time-entry-main flex justify-between items-start text-white text-\[12px\] font-semibold leading-tight pointer-events-none"/);
  assert.match(html, /<div class="resize-handle-bottom"><\/div>/);
  assert.doesNotMatch(html, /week-entry-title/);
  assert.doesNotMatch(html, /right:\s*auto/);
});

test('week timeline does not pass Week-specific lane overrides to shared lane helper', () => {
  const { context, element } = loadWeekViewContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const laneCallRestArgs = [];
  context.buildLoggedTimeEntryRenderItems = entries => entries.map((entry, index) => ({
    entries: [entry],
    firstEntry: entry,
    start: entry.start,
    end: entry.end,
    displayStart: entry.start,
    displayEnd: entry.end,
    durationMs: entry.end - entry.start,
    sourceIndex: index,
    isAssignedGroup: false,
    laneCount: 2,
    laneIndex: index
  }));
  context.getLoggedTimeEntryLaneStyle = (item, ...restArgs) => {
    laneCallRestArgs.push(restArgs);
    return ` left: ${item.laneIndex === 0 ? '4px' : 'calc(50% - 4px)'}; width: calc(50% - 10px); right: auto;`;
  };
  context.window.getLoggedTimeEntryLaneStyle = context.getLoggedTimeEntryLaneStyle;
  context.state.weekTimeEntries = [
    {
      id: 'entry-1',
      projectId: 'project-1',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + 10 * 60 * 60 * 1000
    },
    {
      id: 'entry-2',
      projectId: 'project-1',
      start: dateStart + (9 * 60 + 30) * 60 * 1000,
      end: dateStart + (10 * 60 + 30) * 60 * 1000
    }
  ];

  context.renderWeekTimeline();

  assert.deepEqual(laneCallRestArgs, [[], []]);
  assert.match(element('week-timeline-grid').innerHTML, /width: calc\(50% - 10px\)/);
});

test('week timeline rerenders row count and entry geometry for zoom changes', () => {
  const { context, element } = loadWeekViewContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  context.state.weekTimeEntries = [{
    id: 'entry-1',
    projectId: 'project-1',
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + 10 * 60 * 60 * 1000,
    description: 'Build timeline'
  }];

  context.state.zoom = 60;
  context.renderWeekTimeline();
  assert.equal(element('week-timeline-grid').style['--week-row-count'], '24');
  assert.match(element('week-timeline-grid').innerHTML, /top: 362px; height: 37px/);

  context.state.zoom = 30;
  context.renderWeekTimeline();
  assert.equal(element('week-timeline-grid').style['--week-row-count'], '48');
  assert.match(element('week-timeline-grid').innerHTML, /top: 722px; height: 77px/);
});

test('week timeline renders a current-time jump button in the corner header cell', () => {
  const { context, element } = loadWeekViewContext();

  context.renderWeekTimeline();

  const html = element('week-timeline-grid').innerHTML;
  assert.match(html, /<div class="week-time-corner">[\s\S]*id="btn-week-jump-current"/);
  assert.match(html, /class="icon-button week-current-time-button"/);
  assert.match(html, /title="Jump to Current Time"/);
  assert.match(html, /aria-label="Jump to Current Time"/);
  assert.match(html, /class="ph ph-arrow-line-down text-lg"/);
});

test('week current-time button scrolls the week timeline container', () => {
  const { context, element } = loadWeekViewContext();

  context.renderWeekTimeline();
  element('btn-week-jump-current').dispatch('click');

  assert.ok(element('week-timeline-container').lastScrollTo);
  assert.equal(element('week-timeline-container').lastScrollTo.behavior, 'auto');
});

test('week timeline shows a one-row hover preview before drag-to-create', () => {
  const { context, element } = loadWeekViewContext();
  context.renderWeekTimeline();

  const column = element('week-day-2026-05-21');
  column.dispatch('mousemove', { clientY: 360 });

  assert.equal(column.child.className, 'time-entry-hover-preview week-hover-preview');
  assert.equal(column.child.style.top, '362px');
  assert.equal(column.child.style.height, '37px');
  assert.match(column.child.innerHTML, /time-entry-hover-label">Click &amp; drag to log/);

  column.dispatch('mouseleave');
  assert.equal(column.child.removed, true);
});

test('week timeline drag-to-create opens a day-specific time entry modal', () => {
  const { context, element, dispatchWindow, openedModals } = loadWeekViewContext();
  context.renderWeekTimeline();

  const column = element('week-day-2026-05-21');
  column.dispatch('mousedown', { clientY: 360 });
  dispatchWindow('mousemove', { clientY: 400 });
  dispatchWindow('mouseup', {});

  assert.equal(openedModals.length, 1);
  const [startMs, endMs] = openedModals[0];
  assert.equal(new Date(startMs).getFullYear(), 2026);
  assert.equal(new Date(startMs).getMonth(), 4);
  assert.equal(new Date(startMs).getDate(), 21);
  assert.equal(new Date(startMs).getHours(), 9);
  assert.equal(new Date(endMs).getHours(), 11);
});
