import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function loadApiContext(statusResponse = { nativeStatus: 'active', nativeMessage: 'Native app tracker active' }) {
  const indicator = {
    className: '',
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
  const tooltip = { textContent: '' };
  const calls = [];
  const context = {
    window: {},
    document: {
      getElementById(id) {
        return id === 'tracking-status-tooltip' ? tooltip : null;
      }
    },
    API_BASE: 'http://localhost:3000/api',
    state: {
      currentDate: new Date(2026, 4, 25),
      settings: { minActivityThreshold: 60 },
      currentView: 'timeline'
    },
    DOM: { elTrackingStatusIndicator: indicator },
    getFormattedDate: () => '2026-05-25',
    fetch: async url => {
      calls.push(url);
      if (url.endsWith('/status')) {
        return { ok: true, json: async () => statusResponse };
      }
      return { ok: true, json: async () => [] };
    },
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/api.js', 'utf8'), context);
  return { context, indicator, tooltip, calls };
}

test('header contains one tracker status dot and removes obsolete status/count affordances', () => {
  const index = fs.readFileSync('index.html', 'utf8');

  assert.match(index, /id="tracking-status-indicator"/);
  assert.doesNotMatch(index, />Local<\/span>/);
  assert.doesNotMatch(index, /id="btn-status-indicator"/);
  assert.doesNotMatch(index, /id="lbl-activity-count"/);
});

test('header tracker status dot remains legible in light theme', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');

  const statusDotRule = css.match(/\.tracking-status-dot\s*\{([\s\S]*?)\n\}/);
  assert.ok(statusDotRule);
  assert.doesNotMatch(statusDotRule[1], /box-shadow/);
  assert.match(css, /:root\[data-theme="light"\] \.tracking-status-dot--active\s*\{[\s\S]*background:\s*oklch\(0\.50 0\.17 150\)/s);
  assert.match(css, /:root\[data-theme="light"\] \.tracking-status-dot--degraded\s*\{[\s\S]*background:\s*oklch\(0\.55 0\.15 80\)/s);
  assert.match(css, /:root\[data-theme="light"\] \.tracking-status-dot--error\s*\{[\s\S]*background:\s*oklch\(0\.50 0\.18 27\)/s);
});

test('server exposes its existing tracker health as a read-only status endpoint', () => {
  const server = fs.readFileSync('server.js', 'utf8');

  assert.match(server, /pathname === '\/api\/status' && req\.method === 'GET'/);
  assert.match(server, /nativeStatus:\s*state\.tracker\.nativeStatus/);
  assert.match(server, /nativeMessage:\s*state\.tracker\.nativeMessage/);
});

test('refresh renders active tracker status in the header indicator tooltip', async () => {
  const { context, indicator, tooltip, calls } = loadApiContext();

  await context.refreshData();

  assert.ok(calls.includes('http://localhost:3000/api/status'));
  assert.match(indicator.className, /tracking-status-dot--active/);
  assert.equal(tooltip.textContent, 'Tracking active: Native app tracker active');
  assert.equal(indicator.attributes['aria-label'], tooltip.textContent);
});

test('week mode refresh fetches the selected Monday-Sunday range', async () => {
  const { context, calls } = loadApiContext();
  context.state.timelineMode = 'week';
  context.renderWeekTimelineGrids = () => {};
  context.renderWeekTimeline = () => {};
  context.recalculateStatistics = () => {};
  context.getFormattedDate = date => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
    return local.toISOString().slice(0, 10);
  };

  await context.refreshData();

  assert.ok(calls.includes('http://localhost:3000/api/activities?startDate=2026-05-25&endDate=2026-05-31'));
  assert.ok(calls.includes('http://localhost:3000/api/time-entries?startDate=2026-05-25&endDate=2026-05-31'));
  assert.equal(Array.isArray(context.state.weekActivities), true);
  assert.equal(context.state.weekActivities.length, 0);
  assert.equal(Array.isArray(context.state.weekTimeEntries), true);
  assert.equal(context.state.weekTimeEntries.length, 0);
});

test('refresh ignores legacy passive review status payloads', async () => {
  const passiveInboxCalls = [];
  const { context } = loadApiContext({
    nativeStatus: 'active',
    nativeMessage: 'Native app tracker active',
    pendingPassiveReviews: [{ id: 'review-a', app: 'Codex', title: 'Codex', start: 1, end: 301000 }]
  });
  context.window.updatePassiveReviewInbox = reviews => passiveInboxCalls.push(reviews);

  await context.refreshData();

  assert.deepEqual(passiveInboxCalls, []);
});

test('unavailable tracker status presents a degraded indicator rather than active tracking', () => {
  const { context, indicator, tooltip } = loadApiContext();

  context.updateTrackingStatusIndicator({
    nativeStatus: 'unavailable',
    nativeMessage: 'Accessibility permission is required'
  });

  assert.match(indicator.className, /tracking-status-dot--degraded/);
  assert.equal(tooltip.textContent, 'Tracking limited: Accessibility permission is required');
});
