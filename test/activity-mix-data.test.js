import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function loadApiContext() {
  const context = {
    window: {},
    document: { getElementById: () => null },
    API_BASE: 'http://localhost:3000/api',
    state: {
      currentDate: new Date(2026, 4, 21),
      settings: { minActivityThreshold: 60 },
      currentView: 'timeline'
    },
    DOM: {},
    getFormattedDate: () => '2026-05-21',
    fetch: async () => ({ ok: true, json: async () => [] }),
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/api.js', 'utf8'), context);
  return context;
}

test('preMergeActivities preserves hands-on and hands-off Activity Mix across matching segments', () => {
  const context = loadApiContext();
  const raw = [
    {
      start: 0,
      end: 2 * 60 * 1000,
      app: 'Oriel',
      title: 'Oriel',
      interactionState: 'handsOn'
    },
    {
      start: 2 * 60 * 1000,
      end: 10 * 60 * 1000,
      app: 'Oriel',
      title: 'Oriel',
      interactionState: 'handsOff'
    }
  ];

  const merged = context.preMergeActivities(raw);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].activityMix.handsOnMs, 2 * 60 * 1000);
  assert.equal(merged[0].activityMix.handsOffMs, 8 * 60 * 1000);
  assert.equal(merged[0].sourceSegments.length, 2);
  assert.equal(merged[0].sourceSegments[0].interactionState, 'handsOn');
  assert.equal(merged[0].sourceSegments[1].interactionState, 'handsOff');
});
