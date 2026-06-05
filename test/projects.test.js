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
  assert.doesNotMatch(grid.innerHTML, /Logged Today|Earnings Today/);
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
  const context = {
    window: {},
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
      elStatProjectTotal: { innerText: '' },
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
  vm.runInContext(fs.readFileSync('js/projects.js', 'utf8'), context);

  context.recalculateStatistics();

  assert.equal(capturedActive.innerText, '0h 3m');
});

test('work times uses assigned activity duration instead of visual assignment span', () => {
  const projectTotal = { innerText: '' };
  const context = {
    window: {},
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
      elStatProjectTotal: projectTotal,
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
  vm.runInContext(fs.readFileSync('js/projects.js', 'utf8'), context);

  context.recalculateStatistics();

  assert.equal(projectTotal.innerText, '0h 5m');
});

test('work times includes short auto-rule entries', () => {
  const projectTotal = { innerText: '' };
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
      elStatProjectTotal: projectTotal,
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

  assert.equal(projectTotal.innerText, '0h 0m');
  assert.equal(context.DOM.elBarProject.style.width, '38%');
  assert.match(projectsList.innerHTML, /Project One/);
  assert.doesNotMatch(projectsList.innerHTML, /No time entries logged/);
});

test('work times keeps legacy activity-stream totals on saved assigned duration', () => {
  const projectTotal = { innerText: '' };
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
      elStatProjectTotal: projectTotal,
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
  vm.runInContext(fs.readFileSync('js/timeline.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/projects.js', 'utf8'), context);

  context.recalculateStatistics();

  assert.equal(projectTotal.innerText, '0h 2m');
});

test('timeline UI exposes recorded active time without idle preference or idle total', () => {
  const index = fs.readFileSync('index.html', 'utf8');
  const stateSource = fs.readFileSync('js/state.js', 'utf8');
  const timelineSource = fs.readFileSync('js/timeline.js', 'utf8');

  assert.match(index, /Recorded Active Time/);
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
