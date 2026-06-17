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
    fetch: async url => {
      fetchCalls.push(url);
      return fetchImpl(url);
    },
    console: { error() {} }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/projects.js', 'utf8'), context);
  return { context, grid, fetchCalls };
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
  assert.match(grid.innerHTML, /Billable/);
  assert.doesNotMatch(grid.innerHTML, /Logged Today|Earnings Today/);
  assert.doesNotMatch(grid.innerHTML, /text-\[(?:9|10|11|12|13)px\]|text-gray-|text-white|text-emerald-|text-blue-/);
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

test('project historical entries render positive sub-minute durations and auto-rule description fallbacks', () => {
  const { context } = loadProjectsContext(async () => ({ ok: true, json: async () => [] }));

  assert.equal(context.formatProjectEntryDuration(18 * 1000), '<1 min');
  assert.equal(context.formatProjectEntryDuration(90 * 1000), '2 min');
  assert.equal(context.formatProjectEntryDuration(0), '0 min');

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

test('project task editing uses inline controls instead of a browser prompt', () => {
  const source = fs.readFileSync('js/projects.js', 'utf8');

  assert.doesNotMatch(source, /prompt\(/);
  assert.match(source, /function startProjectTaskRename/);
  assert.match(source, /function saveProjectTaskRename/);
  assert.match(source, /function cancelProjectTaskRename/);
  assert.match(source, /data-project-task-edit/);
});
