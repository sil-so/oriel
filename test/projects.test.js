import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function loadProjectsContext(fetchImpl) {
  const grid = { innerHTML: '' };
  const fetchCalls = [];
  const context = {
    window: {},
    API_BASE: 'http://localhost:3000/api',
    setTimeout,
    clearTimeout,
    state: {
      projects: [{
        id: 'project-1',
        name: 'Client Work',
        color: '#3b82f6',
        billable: true,
        rateType: 'hourly',
        hourlyRate: 100,
        currency: '$'
      }],
      timeEntries: [{
        id: 'today-only',
        projectId: 'project-1',
        start: 0,
        end: 5 * 60 * 1000
      }]
    },
    DOM: {
      elProjectsPageGrid: grid
    },
    document: {
      getElementById() {
        return null;
      }
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push(url);
      return fetchImpl(url, options);
    },
    console: { error() {} }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/projects.js', 'utf8'), context);
  return { context, grid, fetchCalls };
}

function projectTestElement({ value = '', className = '' } = {}) {
  const classes = new Set(String(className).split(/\s+/).filter(Boolean));
  return {
    value,
    textContent: '',
    disabled: false,
    dataset: {},
    style: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      }
    },
    focus() {},
    select() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, handler) {
      this[`on${type}`] = handler;
    },
    setAttribute(name, value) {
      this[name] = String(value);
    },
    removeAttribute(name) {
      delete this[name];
    }
  };
}

test('project cards render all-time totals and earnings from historical entries', async () => {
  const { context, grid, fetchCalls } = loadProjectsContext(async () => ({
    ok: true,
    json: async () => [
      { projectId: 'project-1', start: 0, end: 30 * 60 * 1000 },
      { projectId: 'project-1', start: 0, end: 90 * 60 * 1000 }
    ]
  }));

  await context.renderProjectsPage();

  assert.deepEqual(fetchCalls, ['http://localhost:3000/api/time-entries?date=all']);
  assert.match(grid.innerHTML, /Total Logged/);
  assert.match(grid.innerHTML, /2h 0m/);
  assert.match(grid.innerHTML, /Total Earnings/);
  assert.match(grid.innerHTML, /\$200\.00/);
  assert.match(grid.innerHTML, /\bcard-title\b/);
  assert.match(grid.innerHTML, /\bmetric-label\b/);
  assert.match(grid.innerHTML, /\bmetric-helper\b/);
  assert.match(grid.innerHTML, /\bmetric-value\b/);
  assert.match(grid.innerHTML, /\bcard-actions\b/);
  const cardOpen = grid.innerHTML.match(/<div class="project-card[^>]*>/)?.[0] || '';
  assert.doesNotMatch(cardOpen, /\bcursor-pointer\b/);
  assert.doesNotMatch(cardOpen, /onclick=/);
  assert.match(grid.innerHTML, /<button class="button-secondary"\s+onclick="openProjectDetails\('project-1'\)">[\s\S]*Details/);
  assert.match(grid.innerHTML, /<button class="button-danger"[\s\S]*Delete/);
  assert.doesNotMatch(grid.innerHTML, />\s*Edit\s*</);
  assert.doesNotMatch(grid.innerHTML, /Billable|Non-Billable/);
  assert.doesNotMatch(grid.innerHTML, /Logged Today|Earnings Today/);
  assert.doesNotMatch(grid.innerHTML, /text-\[(?:9|10|11|12|13)px\]|text-gray-|text-white|text-emerald-|text-blue-/);
});

test('project cards hide empty billing state instead of repeating no-rate copy', async () => {
  const { context, grid } = loadProjectsContext(async () => ({
    ok: true,
    json: async () => [
      { projectId: 'project-1', start: 0, end: 30 * 60 * 1000 }
    ]
  }));
  context.state.projects[0] = {
    ...context.state.projects[0],
    billable: false,
    rateType: 'none',
    hourlyRate: 0,
    fixedRate: 0
  };

  await context.renderProjectsPage();

  assert.match(grid.innerHTML, /Total Logged/);
  assert.match(grid.innerHTML, /0h 30m/);
  assert.doesNotMatch(grid.innerHTML, /Billable|Non-Billable/);
  assert.doesNotMatch(grid.innerHTML, /Financial Mode|No billing rate set|Total Earnings|Fixed Budget/);
});

test('project cards keep compact fixed-rate billing metrics when configured', async () => {
  const { context, grid } = loadProjectsContext(async () => ({
    ok: true,
    json: async () => [
      { projectId: 'project-1', start: 0, end: 30 * 60 * 1000 }
    ]
  }));
  context.state.projects[0] = {
    ...context.state.projects[0],
    rateType: 'fixed',
    fixedRate: 2500,
    currency: '€'
  };

  await context.renderProjectsPage();

  assert.match(grid.innerHTML, /Fixed Budget/);
  assert.match(grid.innerHTML, /€2500/);
  assert.doesNotMatch(grid.innerHTML, /Financial Mode|No billing rate set|Billable|Non-Billable/);
});

test('project cards show unavailable historical metrics when all-time loading fails', async () => {
  const { context, grid } = loadProjectsContext(async () => ({ ok: false }));

  await context.renderProjectsPage();

  assert.match(grid.innerHTML, /Total Logged/);
  assert.match(grid.innerHTML, /Total Earnings/);
  assert.match(grid.innerHTML, /Unavailable/);
  assert.doesNotMatch(grid.innerHTML, /0h 5m|\$8\.33/);
});

test('work times displays all recorded activity including short timeline-owned segments', () => {
  const capturedActive = { innerText: '' };
  const workCaptured = { innerText: '' };
  const context = {
    window: {},
    URL,
    state: {
      activities: [{ start: 60000, end: 180000, app: 'Codex' }],
      timelineActivities: [
        { start: 0, end: 60000, app: 'Finder' },
        { start: 60000, end: 180000, app: 'Codex' }
      ],
      timeEntries: [],
      projects: []
    },
    DOM: {
      elStatCapturedActive: capturedActive,
      elWorkStatCaptured: workCaptured,
      elWorkStatLogged: { innerText: '' },
      elWorkStatEarnings: { innerText: '' },
      elWorkStatBillableHours: { innerText: '' },
      elWorkStatConversionPercent: { innerText: '' },
      elWorkStatConversionBar: { style: {} },
      getElStatBillable: { innerText: '' },
      elStatNonbillable: { innerText: '' },
      elBarProject: { style: {} },
      elProjectsList: { innerHTML: '' }
    },
    document: { getElementById() { return null; } },
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/projects.js', 'utf8'), context);

  context.recalculateStatistics();

  assert.equal(capturedActive.innerText, '0h 3m');
  assert.equal(workCaptured.innerText, '3 min');
});

test('work times uses assigned activity duration instead of visual assignment span', () => {
  const logged = { innerText: '' };
  const context = {
    window: {},
    URL,
    state: {
      activities: [],
      timelineActivities: [],
      timeEntries: [{
        start: 0,
        end: 15 * 60 * 1000,
        projectId: 'project-1',
        billable: false,
        activities: [{ assignedDurationMs: 5 * 60 * 1000 }]
      }],
      projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }]
    },
    DOM: {
      elStatCapturedActive: { innerText: '' },
      elWorkStatCaptured: { innerText: '' },
      elWorkStatLogged: logged,
      elWorkStatEarnings: { innerText: '' },
      elWorkStatBillableHours: { innerText: '' },
      elWorkStatConversionPercent: { innerText: '' },
      elWorkStatConversionBar: { style: {} },
      getElStatBillable: { innerText: '' },
      elStatNonbillable: { innerText: '' },
      elBarProject: { style: {} },
      elProjectsList: { innerHTML: '' }
    },
    document: { getElementById() { return null; } },
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/projects.js', 'utf8'), context);

  context.recalculateStatistics();

  assert.equal(logged.innerText, '5 min');
});

test('work times includes short auto-rule entries', () => {
  const logged = { innerText: '' };
  const projectsList = { innerHTML: '' };
  const context = {
    window: {},
    state: {
      settings: { minActivityThreshold: 60 },
      activities: [],
      timelineActivities: [{
        start: 0,
        end: 2 * 60 * 1000
      }],
      timeEntries: [{
        start: 0,
        end: 45 * 1000,
        projectId: 'project-1',
        createdBy: 'auto-rule',
        autoRuleId: 'rule-1',
        billable: false,
        activities: [{ assignedDurationMs: 45 * 1000, autoAssigned: true }]
      }],
      projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }]
    },
    DOM: {
      elStatCapturedActive: { innerText: '' },
      elWorkStatCaptured: { innerText: '' },
      elWorkStatLogged: logged,
      elWorkStatEarnings: { innerText: '' },
      elWorkStatBillableHours: { innerText: '' },
      elWorkStatConversionPercent: { innerText: '' },
      elWorkStatConversionBar: { style: {} },
      getElStatBillable: { innerText: '' },
      elStatNonbillable: { innerText: '' },
      elBarProject: { style: {} },
      elProjectsList: projectsList
    },
    document: { getElementById() { return null; } },
    localStorage: { getItem() { return null; } },
    browserPatterns: [],
    URL,
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/projects.js', 'utf8'), context);

  context.recalculateStatistics();

  assert.equal(logged.innerText, '45s');
  assert.equal(context.DOM.elBarProject.style.width, '38%');
  assert.match(projectsList.innerHTML, /Project One/);
  assert.doesNotMatch(projectsList.innerHTML, /No time entries logged/);
});

test('project historical entry descriptions use auto-rule fallbacks', () => {
  const { context } = loadProjectsContext(async () => ({ ok: true, json: async () => [] }));

  const fallback = context.getProjectEntryDescriptionHTML({
    description: ' ',
    createdBy: 'auto-rule',
    activities: [{
      title: 'Payment Page',
      app: 'Brave Browser',
      url: 'https://checkout.example/pay'
    }]
  });
  assert.match(fallback, /Auto-assigned: Payment Page/);
  assert.doesNotMatch(fallback, /No description provided/);

  const manualFallback = context.getProjectEntryDescriptionHTML({
    description: '',
    createdBy: 'manual',
    activities: []
  });
  assert.match(manualFallback, /No description provided/);
});

test('project time history groups many small entries into daily totals', () => {
  const { context } = loadProjectsContext(async () => ({ ok: true, json: async () => [] }));
  const june18 = new Date(2026, 5, 18, 9, 0, 0).getTime();
  const june19 = new Date(2026, 5, 19, 11, 0, 0).getTime();
  const entries = [
    { start: june18, end: june18 + 18 * 1000 },
    { start: june18 + 60 * 1000, end: june18 + 102 * 1000 },
    { start: june19, end: june19 + 65 * 60 * 1000 }
  ];

  const dayMap = context.buildProjectTimeHistoryDayMap(entries);

  assert.equal(dayMap.get('2026-06-18').totalMs, 60 * 1000);
  assert.equal(dayMap.get('2026-06-19').totalMs, 65 * 60 * 1000);
  assert.equal(context.formatProjectTimeHistoryDuration(42 * 1000), '<1 min');
  assert.equal(context.formatProjectTimeHistoryDuration(5 * 60 * 1000), '5 min');
  assert.equal(context.formatProjectTimeHistoryDuration(60 * 60 * 1000), '1h');
  assert.equal(context.formatProjectTimeHistoryDuration(80 * 60 * 1000), '1h 20m');
});

test('project time history initial month prefers timeline month with time otherwise latest logged month', () => {
  const { context } = loadProjectsContext(async () => ({ ok: true, json: async () => [] }));
  const dayMap = context.buildProjectTimeHistoryDayMap([
    {
      start: new Date(2026, 4, 31, 9, 0, 0).getTime(),
      end: new Date(2026, 4, 31, 10, 0, 0).getTime()
    },
    {
      start: new Date(2026, 6, 4, 9, 0, 0).getTime(),
      end: new Date(2026, 6, 4, 10, 0, 0).getTime()
    }
  ]);

  assert.equal(
    context.getFormattedDate(context.resolveProjectTimeHistoryInitialMonth(dayMap, new Date(2026, 4, 12))),
    '2026-05-01'
  );
  assert.equal(
    context.getFormattedDate(context.resolveProjectTimeHistoryInitialMonth(dayMap, new Date(2026, 5, 18))),
    '2026-07-01'
  );
});

test('project time history day navigation closes details and opens timeline day', async () => {
  const closed = [];
  const opened = [];
  const { context } = loadProjectsContext(async () => ({ ok: true, json: async () => [] }));
  context.document = {
    getElementById(id) {
      if (id !== 'project-details-modal') return null;
      return {
        classList: {
          add(value) {
            closed.push(value);
          }
        }
      };
    }
  };
  context.openTimelineDate = async (date, options) => {
    opened.push({ date: context.getFormattedDate(date), options });
  };
  context.window.openTimelineDate = context.openTimelineDate;

  await context.openProjectTimeHistoryDay('2026-06-18');

  assert.deepEqual(closed, ['hidden']);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].date, '2026-06-18');
  assert.equal(opened[0].options.mode, 'day');
});

test('project details settings populate saved project context', () => {
  const { context } = loadProjectsContext(async () => ({ ok: true, json: async () => [] }));
  context.state.projects[0].description = 'Client portal and billing workflow implementation.';
  const elements = new Map([
    ['proj-details-name', projectTestElement()],
    ['proj-details-description', projectTestElement()],
    ['proj-details-color-input', projectTestElement()],
    ['proj-details-rate-type', projectTestElement()],
    ['proj-details-hourly-rate', projectTestElement()],
    ['proj-details-fixed-rate', projectTestElement()],
    ['proj-details-currency', projectTestElement()]
  ]);
  context.document = {
    getElementById(id) {
      return elements.get(id) || null;
    }
  };
  context.window.refreshCustomSelects = () => {};

  context.populateProjectDetailsSettings(context.state.projects[0]);

  assert.equal(elements.get('proj-details-name').value, 'Client Work');
  assert.equal(elements.get('proj-details-description').value, 'Client portal and billing workflow implementation.');
  assert.equal(elements.get('proj-details-color-input').value, '#3b82f6');
  assert.equal(elements.get('proj-details-rate-type').value, 'hourly');
  assert.equal(elements.get('proj-details-hourly-rate').value, 100);
});

test('project details settings save sends one explicit project update payload', async () => {
  const requests = [];
  const { context } = loadProjectsContext(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        ...context.state.projects[0],
        ...JSON.parse(options.body)
      })
    };
  });
  const elements = new Map([
    ['proj-details-name', projectTestElement({ value: 'Updated Client' })],
    ['proj-details-description', projectTestElement({ value: ' Updated context ' })],
    ['proj-details-color-input', projectTestElement({ value: '#10b981' })],
    ['proj-details-rate-type', projectTestElement({ value: 'fixed' })],
    ['proj-details-hourly-rate', projectTestElement({ value: '150' })],
    ['proj-details-fixed-rate', projectTestElement({ value: '2400' })],
    ['proj-details-currency', projectTestElement({ value: '€' })],
    ['project-details-modal', projectTestElement()],
    ['proj-details-title', { innerText: '' }],
    ['proj-details-color', { style: {} }]
  ]);
  context.document = {
    getElementById(id) {
      return elements.get(id) || null;
    }
  };
  context.window.refreshCustomSelects = () => {};
  context.renderProjectsPage = () => {};

  const updated = await context.saveProjectDetailsSettings('project-1');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://localhost:3000/api/projects/project-1');
  assert.equal(requests[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    name: 'Updated Client',
    description: 'Updated context',
    color: '#10b981',
    billable: true,
    rateType: 'fixed',
    hourlyRate: 150,
    fixedRate: 2400,
    currency: '€'
  });
  assert.equal(updated.name, 'Updated Client');
  assert.equal(context.state.projects[0].description, 'Updated context');
});

test('project details settings cancel restores saved values without updating project', () => {
  const { context } = loadProjectsContext(async () => ({ ok: true, json: async () => [] }));
  context.state.projects[0].description = 'Saved context';
  const elements = new Map([
    ['proj-details-name', projectTestElement({ value: 'Draft name' })],
    ['proj-details-description', projectTestElement({ value: 'Draft context' })],
    ['proj-details-color-input', projectTestElement({ value: '#10b981' })],
    ['proj-details-rate-type', projectTestElement({ value: 'fixed' })],
    ['proj-details-hourly-rate', projectTestElement({ value: '150' })],
    ['proj-details-fixed-rate', projectTestElement({ value: '2400' })],
    ['proj-details-currency', projectTestElement({ value: '€' })]
  ]);
  context.document = {
    getElementById(id) {
      return elements.get(id) || null;
    }
  };
  context.window.refreshCustomSelects = () => {};

  context.resetProjectDetailsSettings('project-1');

  assert.equal(elements.get('proj-details-name').value, 'Client Work');
  assert.equal(elements.get('proj-details-description').value, 'Saved context');
  assert.equal(elements.get('proj-details-color-input').value, '#3b82f6');
  assert.equal(elements.get('proj-details-rate-type').value, 'hourly');
  assert.equal(elements.get('proj-details-hourly-rate').value, 100);
});

test('project details settings derive billable state from pricing mode', () => {
  const { context } = loadProjectsContext(async () => ({ ok: true, json: async () => [] }));
  const elements = new Map([
    ['proj-details-name', projectTestElement({ value: 'Internal Work' })],
    ['proj-details-description', projectTestElement({ value: '' })],
    ['proj-details-color-input', projectTestElement({ value: '#3b82f6' })],
    ['proj-details-rate-type', projectTestElement({ value: 'none' })],
    ['proj-details-hourly-rate', projectTestElement({ value: '' })],
    ['proj-details-fixed-rate', projectTestElement({ value: '' })],
    ['proj-details-currency', projectTestElement({ value: '$' })]
  ]);
  context.document = {
    getElementById(id) {
      return elements.get(id) || null;
    }
  };

  assert.equal(context.readProjectDetailsSettingsPayload().billable, false);

  elements.get('proj-details-rate-type').value = 'hourly';
  assert.equal(context.readProjectDetailsSettingsPayload().billable, true);

  elements.get('proj-details-rate-type').value = 'fixed';
  assert.equal(context.readProjectDetailsSettingsPayload().billable, true);
});

test('project category create row toggles with add button visibility', () => {
  const { context } = loadProjectsContext(async () => ({ ok: true, json: async () => [] }));
  const row = projectTestElement({ className: 'project-task-create-row hidden' });
  const input = projectTestElement();
  const toggle = projectTestElement();
  let focused = false;
  input.focus = () => { focused = true; };
  context.document = {
    getElementById(id) {
      if (id === 'proj-details-task-create-row') return row;
      if (id === 'proj-details-task-name') return input;
      if (id === 'proj-details-task-add-toggle') return toggle;
      return null;
    }
  };

  context.setProjectTaskCreateVisible(true);
  assert.equal(row.classList.contains('hidden'), false);
  assert.equal(toggle.classList.contains('hidden'), true);
  assert.equal(focused, true);

  input.value = 'Draft bucket';
  context.setProjectTaskCreateVisible(false);
  assert.equal(row.classList.contains('hidden'), true);
  assert.equal(toggle.classList.contains('hidden'), false);
  assert.equal(input.value, '');
});

test('work times keeps legacy activity-stream totals on saved assigned duration', () => {
  const logged = { innerText: '' };
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const context = {
    window: {},
    URL,
    cleanTitle: title => title,
    getActivityIconHTML: () => '',
    state: {
      currentDate: new Date(2026, 4, 21),
      zoom: 1,
      selectedActivities: new Set(),
      settings: {},
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: dateStart + (13 * 60 + 3) * 60 * 1000,
        end: dateStart + (13 * 60 + 4) * 60 * 1000,
        duration: 60 * 1000
      }],
      timelineActivities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: dateStart + (13 * 60 + 3) * 60 * 1000,
        end: dateStart + (13 * 60 + 4) * 60 * 1000,
        duration: 60 * 1000
      }],
      timeEntries: [{
        start: dateStart + (13 * 60) * 60 * 1000,
        end: dateStart + (13 * 60 + 5) * 60 * 1000,
        projectId: 'project-1',
        billable: false,
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
      }],
      projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }]
    },
    DOM: {
      elStatCapturedActive: { innerText: '' },
      elWorkStatCaptured: { innerText: '' },
      elWorkStatLogged: logged,
      elWorkStatEarnings: { innerText: '' },
      elWorkStatBillableHours: { innerText: '' },
      elWorkStatConversionPercent: { innerText: '' },
      elWorkStatConversionBar: { style: {} },
      getElStatBillable: { innerText: '' },
      elStatNonbillable: { innerText: '' },
      elBarProject: { style: {} },
      elProjectsList: { innerHTML: '' }
    },
    document: { getElementById() { return null; } },
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/timeline.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/projects.js', 'utf8'), context);

  context.recalculateStatistics();

  assert.equal(logged.innerText, '2 min');
});

test('work times sidebar metrics use the shared selected-period calculation', () => {
  const captured = { innerText: '' };
  const logged = { innerText: '' };
  const earnings = { innerText: '' };
  const billableHours = { innerText: '' };
  const conversion = { innerText: '' };
  const conversionBar = { style: {} };
  const context = {
    window: {},
    URL,
    state: {
      timelineActivities: [
        { start: 0, end: 60 * 60 * 1000 },
        { start: 60 * 60 * 1000, end: 2 * 60 * 60 * 1000 }
      ],
      activities: [],
      timeEntries: [{
        start: 0,
        end: 60 * 60 * 1000,
        projectId: 'project-1',
        billable: true
      }],
      projects: [{
        id: 'project-1',
        name: 'Client Work',
        color: '#3b82f6',
        billable: true,
        rateType: 'hourly',
        hourlyRate: 120,
        currency: '$'
      }]
    },
    DOM: {
      elStatCapturedActive: { innerText: '' },
      elWorkStatCaptured: captured,
      elWorkStatLogged: logged,
      elWorkStatEarnings: earnings,
      elWorkStatBillableHours: billableHours,
      elWorkStatConversionPercent: conversion,
      elWorkStatConversionBar: conversionBar,
      getElStatBillable: { innerText: '' },
      elStatNonbillable: { innerText: '' },
      elBarProject: { style: {} },
      elProjectsList: { innerHTML: '' }
    },
    document: { getElementById() { return null; } },
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/projects.js', 'utf8'), context);

  context.recalculateStatistics();
  const metrics = context.calculateSelectedPeriodMetrics({
    activities: context.state.timelineActivities,
    timeEntries: context.state.timeEntries,
    projects: context.state.projects,
    allTimeEntries: context.state.timeEntries
  });

  assert.equal(metrics.totalCapturedMs, 2 * 60 * 60 * 1000);
  assert.equal(metrics.totalLoggedMs, 60 * 60 * 1000);
  assert.equal(captured.innerText, '2h 0m');
  assert.equal(logged.innerText, '1h 0m');
  assert.equal(earnings.innerText, '$120.00');
  assert.equal(billableHours.innerText, '1.0h of billable work');
  assert.equal(conversion.innerText, '50%');
  assert.equal(conversionBar.style.width, '50%');
});

test('work times fixed-rate earnings refresh from all-time entries like Statistics', async () => {
  const earnings = { innerText: '' };
  let fetchCount = 0;
  const context = {
    window: {},
    fetchAllTimeEntries: async () => {
      fetchCount++;
      return [{
        id: 'historical-entry',
        start: -2 * 60 * 60 * 1000,
        end: 0,
        projectId: 'project-1',
        billable: true
      }];
    },
    state: {
      timelineActivities: [{ start: 0, end: 60 * 60 * 1000 }],
      activities: [],
      timeEntries: [{
        id: 'current-entry',
        start: 0,
        end: 60 * 60 * 1000,
        projectId: 'project-1',
        billable: true
      }],
      projects: [{
        id: 'project-1',
        name: 'Fixed Project',
        color: '#3b82f6',
        billable: true,
        rateType: 'fixed',
        fixedRate: 300,
        currency: '$'
      }]
    },
    DOM: {
      elStatCapturedActive: { innerText: '' },
      elWorkStatCaptured: { innerText: '' },
      elWorkStatLogged: { innerText: '' },
      elWorkStatEarnings: earnings,
      elWorkStatBillableHours: { innerText: '' },
      elWorkStatConversionPercent: { innerText: '' },
      elWorkStatConversionBar: { style: {} },
      getElStatBillable: { innerText: '' },
      elStatNonbillable: { innerText: '' },
      elBarProject: { style: {} },
      elProjectsList: { innerHTML: '' }
    },
    document: { getElementById() { return null; } },
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/projects.js', 'utf8'), context);

  context.recalculateStatistics();
  assert.equal(earnings.innerText, '$300.00');

  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(fetchCount, 1);
  assert.equal(earnings.innerText, '$100.00');
});

test('timeline UI omits recorded-active stats and idle preference totals', () => {
  const index = fs.readFileSync('index.html', 'utf8');
  const stateSource = fs.readFileSync('js/state.js', 'utf8');
  const timelineSource = fs.readFileSync('js/timeline.js', 'utf8');

  assert.doesNotMatch(index, /Recorded Active Time|Project Logged Time|stat-captured-active/);
  assert.doesNotMatch(index, /Hide Idle Activities|stat-idle|stat-attendance/);
  assert.doesNotMatch(stateSource, /hideIdle/);
  assert.doesNotMatch(timelineSource, /hideIdle/);
});

test('project category names are directly editable and delete is confirmation gated', () => {
  const source = fs.readFileSync('js/projects.js', 'utf8');

  assert.doesNotMatch(source, /prompt\(/);
  assert.match(source, /data-project-task-name/);
  assert.match(source, /project-task-name-input/);
  assert.match(source, /function saveProjectTaskNameOnBlur/);
  assert.match(source, /function flushProjectTaskNameEdits/);
  assert.match(source, /flushProjectTaskNameEdits\(currentProjectDetailsId\)/);
  assert.match(source, /function deleteProjectTask/);
  assert.match(source, /showCustomConfirm/);
  assert.match(source, /onclick="deleteProjectTask\(event,/);
  assert.match(source, /title:\s*'Remove Category'/);
  assert.match(source, /actionText:\s*'Remove'/);
  assert.doesNotMatch(source, /Delete Category/);
  assert.doesNotMatch(source, /Delete category/);
  assert.match(source, /title:\s*'Delete Project'/);
  assert.match(source, /actionText:\s*'Delete'/);
  assert.doesNotMatch(source, /actionText:\s*'Delete Project'/);
  assert.doesNotMatch(source, /function startProjectTaskRename/);
  assert.doesNotMatch(source, /function toggleProjectTaskMenu/);
  assert.doesNotMatch(source, /project-task-overflow/);
  assert.doesNotMatch(source, />Rename</);
});
