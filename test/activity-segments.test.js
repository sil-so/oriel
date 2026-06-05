import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  activeEndAtIdleThreshold,
  clipSegmentToInterval,
  getLocalDateRangeBounds,
  getLocalDateString,
  getLocalDayBounds,
  isIdleSegment,
  normalizeActivitySegments,
  splitSegmentByLocalDay
} from '../activity-segments.js';

test('idle detection closes active capture at the grace-period cutoff after delayed polling', () => {
  const now = new Date(2026, 4, 26, 7, 33, 31).getTime();
  const activeStart = new Date(2026, 4, 26, 0, 5, 25).getTime();

  assert.equal(
    activeEndAtIdleThreshold(activeStart, now, 7.5 * 60 * 60, 120),
    new Date(2026, 4, 26, 0, 5, 31).getTime()
  );
});

test('idle detection does not backdate active time when the server starts while already idle', () => {
  const now = new Date(2026, 4, 26, 7, 33, 31).getTime();

  assert.equal(activeEndAtIdleThreshold(now, now, 7.5 * 60 * 60, 120), now);
});

test('normalization drops idle and splits active segments across local midnight', () => {
  const start = new Date(2026, 4, 25, 23, 59).getTime();
  const end = new Date(2026, 4, 26, 0, 2).getTime();
  const activity = { start, end, app: 'Codex', title: 'Codex', url: '' };

  assert.equal(isIdleSegment({ app: 'Idle' }), true);
  assert.equal(splitSegmentByLocalDay(activity).length, 2);
  assert.deepEqual(normalizeActivitySegments([
    activity,
    { start, end, app: 'Idle', title: 'User is away', url: '' }
  ]), splitSegmentByLocalDay(activity));
});

test('date interval clipping returns only active overlap within the requested day', () => {
  const { start, end } = getLocalDayBounds('2026-05-26');
  const segment = {
    start: start - (2 * 60 * 1000),
    end: start + (3 * 60 * 1000),
    app: 'Brave Browser',
    title: 'Oriel',
    url: 'http://localhost:3000/'
  };

  assert.deepEqual(clipSegmentToInterval(segment, start, end), {
    ...segment,
    start
  });
  assert.equal(
    clipSegmentToInterval({ ...segment, app: 'Idle' }, start, end),
    null
  );
});

test('date range bounds cap oversized requests at 366 local calendar days', () => {
  const { start, end } = getLocalDateRangeBounds('2026-01-01', '2027-12-31');
  let cursor = start;
  let days = 0;

  while (cursor < end) {
    cursor = getLocalDayBounds(getLocalDateString(cursor)).end;
    days += 1;
  }

  assert.equal(days, 366);
});
