import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  matchesTrackingExclusion,
  normalizeTrackingExclusion,
  pruneActivitiesByExclusion
} from '../tracking-exclusions.js';

test('tracking exclusions match application, title, and URL values case-insensitively', () => {
  const activity = {
    app: 'Brave Browser',
    title: 'Private Client Dashboard',
    url: 'https://internal.example.com/timesheet'
  };

  assert.equal(matchesTrackingExclusion(activity, [{ field: 'app', matchType: 'equals', pattern: 'brave browser' }]), true);
  assert.equal(matchesTrackingExclusion(activity, [{ field: 'title', matchType: 'contains', pattern: 'client' }]), true);
  assert.equal(matchesTrackingExclusion(activity, [{ field: 'url', matchType: 'regex', pattern: 'internal\\.example\\.com' }]), true);
  assert.equal(matchesTrackingExclusion(activity, [{ field: 'url', matchType: 'contains', pattern: 'calendar' }]), false);
});

test('tracking exclusion payloads accept supported rules and reject unsafe shapes', () => {
  assert.deepEqual(normalizeTrackingExclusion({
    field: 'url',
    matchType: 'contains',
    pattern: '  example.com/private  '
  }), {
    field: 'url',
    matchType: 'contains',
    pattern: 'example.com/private',
    applyToHistory: false
  });

  assert.equal(normalizeTrackingExclusion({ field: 'bundle', matchType: 'contains', pattern: 'x' }), null);
  assert.equal(normalizeTrackingExclusion({ field: 'app', matchType: 'regex', pattern: '[' }), null);
  assert.equal(normalizeTrackingExclusion({ field: 'title', matchType: 'equals', pattern: '   ' }), null);
});

test('tracking exclusions can prune matching historical activities', () => {
  const activities = [
    { app: 'Brave Browser', title: 'Keep', url: 'https://example.com' },
    { app: 'loginwindow', title: 'Login Window', url: '' },
    { app: 'Passwords', title: 'Vault', url: '' }
  ];

  const result = pruneActivitiesByExclusion(activities, {
    field: 'app',
    matchType: 'equals',
    pattern: 'loginwindow'
  });

  assert.deepEqual(result.removed, [activities[1]]);
  assert.deepEqual(result.kept, [activities[0], activities[2]]);
});
