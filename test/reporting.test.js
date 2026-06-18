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
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.style = {};
    this.value = '';
    this.innerText = '';
    this.innerHTML = '';
    this.textContent = '';
    this.className = '';
    this.classList = new FakeClassList(this);
  }

  addEventListener(type, listener) {
    this.listeners[type] ||= [];
    this.listeners[type].push(listener);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
  }

  closest(selector) {
    if (selector === 'button' && this.tagName === 'BUTTON') return this;
    return this.parentElement?.closest(selector) || null;
  }

  querySelectorAll(selector) {
    if (selector === 'button') {
      return this.children.filter(child => child.tagName === 'BUTTON');
    }
    return [];
  }

  getContext() {
    return {
      clearRect() {},
      beginPath() {},
      arc() {},
      stroke() {},
      set strokeStyle(value) {},
      set lineWidth(value) {}
    };
  }

  focus() {
    this.focusCalls = (this.focusCalls || 0) + 1;
  }

  async click() {
    const listeners = [
      ...(this.listeners.click || []),
      ...(this.parentElement?.listeners.click || [])
    ];
    for (const listener of listeners) {
      listener({ target: this });
    }
    await new Promise(resolve => setImmediate(resolve));
  }
}

function createButton(range) {
  const button = new FakeElement(`range-${range}`, 'button');
  button.dataset.range = range;
  button.className = range === 'today'
    ? 'range-pill range-pill--active'
    : 'range-pill';
  return button;
}

function loadReportingContext() {
  const elements = new Map();
  const fetchCalls = [];
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [2026, 4, 23, 12, 0, 0, 0]));
    }

    static now() {
      return new RealDate(2026, 4, 23, 12, 0, 0, 0).getTime();
    }
  }

  const presetsContainer = new FakeElement('stats-presets-container');
  for (const range of ['today', 'yesterday', 'week', 'last7', 'last30', 'all', 'custom']) {
    presetsContainer.appendChild(createButton(range));
  }
  elements.set(presetsContainer.id, presetsContainer);

  for (const id of [
    'stats-custom-range-inputs',
    'stats-start-date',
    'stats-end-date',
    'stat-card-captured',
    'stat-card-logged',
    'stat-card-earnings',
    'stat-card-billable-hours',
    'stat-card-conversion-percent',
    'stat-card-conversion-bar',
    'canvas-programs',
    'lbl-programs-count',
    'list-programs-legend',
    'canvas-websites',
    'lbl-websites-count',
    'list-websites-legend'
  ]) {
    elements.set(id, new FakeElement(id, id.startsWith('canvas-') ? 'canvas' : 'div'));
  }
  elements.get('stats-custom-range-inputs').classList.add('hidden');

  const context = {
    window: {},
    API_BASE: 'http://localhost:3000/api',
    Date: FixedDate,
    state: {
      currentView: 'stats',
      projects: []
    },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      }
    },
    getFormattedDate(date) {
      const offset = date.getTimezoneOffset();
      const localDate = new RealDate(date.getTime() - (offset * 60 * 1000));
      return localDate.toISOString().split('T')[0];
    },
    getActivityIconHTML: () => '',
    URLSearchParams,
    fetch: async url => {
      fetchCalls.push(url);
      return {
        ok: true,
        json: async () => []
      };
    },
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/reporting.js', 'utf8'), context);

  return { context, elements, fetchCalls };
}

test('reporting initialization wires preset ranges to expected API dates', async () => {
  const { context, elements, fetchCalls } = loadReportingContext();

  context.initReporting();
  assert.equal(elements.get('stats-start-date').value, '2026-05-23');
  assert.equal(elements.get('stats-end-date').value, '2026-05-23');

  await context.refreshStatsView();
  assert.deepEqual(fetchCalls.splice(0), [
    'http://localhost:3000/api/activities?startDate=2026-05-23&endDate=2026-05-23',
    'http://localhost:3000/api/time-entries?startDate=2026-05-23&endDate=2026-05-23',
    'http://localhost:3000/api/time-entries?date=all'
  ]);

  const yesterdayButton = elements.get('stats-presets-container').children
    .find(button => button.dataset.range === 'yesterday');
  await yesterdayButton.click();

  assert.match(yesterdayButton.className, /range-pill--active/);
  assert.deepEqual(fetchCalls.splice(0), [
    'http://localhost:3000/api/activities?startDate=2026-05-22&endDate=2026-05-22',
    'http://localhost:3000/api/time-entries?startDate=2026-05-22&endDate=2026-05-22',
    'http://localhost:3000/api/time-entries?date=all'
  ]);
});

test('reporting all-time preset fetches unbounded historical data', async () => {
  const { context, elements, fetchCalls } = loadReportingContext();

  context.initReporting();
  fetchCalls.splice(0);

  const allTimeButton = elements.get('stats-presets-container').children
    .find(button => button.dataset.range === 'all');
  await allTimeButton.click();

  assert.match(allTimeButton.className, /range-pill--active/);
  assert.equal(elements.get('stats-custom-range-inputs').classList.contains('hidden'), true);
  assert.deepEqual(fetchCalls.splice(0), [
    'http://localhost:3000/api/activities?date=all',
    'http://localhost:3000/api/time-entries?date=all'
  ]);
});

test('reporting chart legends use semantic row classes without changing values', () => {
  const { context, elements } = loadReportingContext();
  const css = fs.readFileSync('css/index.css', 'utf8');

  context.drawDonutChart(
    'canvas-programs',
    'lbl-programs-count',
    'list-programs-legend',
    [
      { name: 'Xcode', duration: 90 * 60 * 1000 },
      { name: 'Oriel', duration: 30 * 60 * 1000 }
    ],
    120 * 60 * 1000,
    'app'
  );

  const legendMarkup = elements.get('list-programs-legend').innerHTML;
  assert.match(elements.get('lbl-programs-count').innerText, /2 items/);
  assert.match(legendMarkup, /\breport-row\b/);
  assert.match(legendMarkup, /\breport-row-title\b[^>]*>Xcode/);
  assert.match(legendMarkup, /\bduration-pill\b[^>]*>1h 30m/);
  assert.match(legendMarkup, /\breport-row-percent\b[^>]*>75%/);
  assert.doesNotMatch(legendMarkup, /text-\[(?:10|11)px\]|text-gray-|text-white|w-5 h-5/);
  assert.doesNotMatch(css.match(/\.chart-card-header\s*\{[^}]*\}/)?.[0] || '', /border-bottom/);
  assert.doesNotMatch(css.match(/\.report-row\s*\{[^}]*\}/)?.[0] || '', /border-bottom/);
  assert.doesNotMatch(css, /\.report-row:last-child\s*\{/);
});

test('reporting metrics use the shared selected-period calculation', () => {
  const { context } = loadReportingContext();
  context.state.projects = [{
    id: 'project-1',
    name: 'Client Work',
    billable: true,
    rateType: 'hourly',
    hourlyRate: 80,
    currency: '$'
  }];

  const metrics = context.calculateSelectedPeriodMetrics({
    activities: [
      { start: 0, end: 2 * 60 * 60 * 1000 }
    ],
    timeEntries: [
      { start: 0, end: 30 * 60 * 1000, projectId: 'project-1', billable: true }
    ],
    projects: context.state.projects,
    allTimeEntries: [
      { start: 0, end: 30 * 60 * 1000, projectId: 'project-1', billable: true }
    ]
  });

  assert.equal(metrics.totalCapturedMs, 2 * 60 * 60 * 1000);
  assert.equal(metrics.totalLoggedMs, 30 * 60 * 1000);
  assert.equal(metrics.billableEarnings, 40);
  assert.equal(metrics.billableMs, 30 * 60 * 1000);
  assert.equal(metrics.conversionPercent, 25);
});

test('app initialization initializes reporting controls', async () => {
  const context = {
    window: {},
    document: {
      readyState: 'loading',
      addEventListener() {}
    },
    setupDateDisplay() {},
    setupScrollSync() {},
    fetchProjects: async () => {},
    fetchRules: async () => {},
    renderPresetColorGrid() {},
    refreshData: async () => {},
    getFormattedDate: () => '2026-05-23',
    setTimeout() {},
    setInterval() {},
    console
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/main.js', 'utf8'), context);

  let reportingInitCalls = 0;
  context.setupMainEventListeners = () => {};
  context.window.initReporting = () => {
    reportingInitCalls++;
  };

  await context.init();

  assert.equal(reportingInitCalls, 1);
});

test('timeline date picker opens the custom Oriel popover instead of the native picker', () => {
  let nativePickerCalls = 0;
  const input = new FakeElement('date-picker-input', 'input');
  input.showPicker = () => {
    nativePickerCalls++;
  };

  const popover = new FakeElement('date-picker-popover');
  popover.classList.add('hidden');

  const elements = new Map([
    ['date-picker-input', input],
    ['date-picker-popover', popover],
    ['date-picker-month-label', new FakeElement('date-picker-month-label')],
    ['date-picker-days', new FakeElement('date-picker-days')],
    ['date-picker-weekdays', new FakeElement('date-picker-weekdays')]
  ]);

  const context = {
    window: {},
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById(id) {
        return elements.get(id) || null;
      }
    },
    DOM: {
      get elDatePickerInput() {
        return input;
      }
    },
    state: {
      currentDate: new Date(2026, 4, 23)
    },
    getFormattedDate: date => date.toISOString().split('T')[0],
    console
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/main.js', 'utf8'), context);

  context.openDatePicker();

  assert.equal(nativePickerCalls, 0);
  assert.equal(popover.classList.contains('hidden'), false);
  assert.equal(elements.get('date-picker-month-label').innerText, 'May 2026');
});
