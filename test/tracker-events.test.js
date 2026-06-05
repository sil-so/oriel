import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTrackerEvent } from '../tracker-events.js';

test('parses app-change events from the native tracker', () => {
  const event = parseTrackerEvent('EVENT:APP_CHANGE:1710000000000:Figma:1234');

  assert.deepEqual(event, {
    type: 'app-change',
    timestamp: 1710000000000,
    appName: 'Figma',
    pid: 1234
  });
});

test('preserves colons in app names when parsing app-change events', () => {
  const event = parseTrackerEvent('EVENT:APP_CHANGE:1710000000000:Acme: Design:1234');

  assert.equal(event.appName, 'Acme: Design');
  assert.equal(event.pid, 1234);
});

test('parses tracker status diagnostics', () => {
  const event = parseTrackerEvent('EVENT:TRACKER_STATUS:unavailable:no frontmost app visible');

  assert.deepEqual(event, {
    type: 'tracker-status',
    status: 'unavailable',
    message: 'no frontmost app visible'
  });
});

test('parses JSON app-change events with native app identity metadata', () => {
  const event = parseTrackerEvent('EVENT:APP_CHANGE_JSON:{"timestamp":1710000000000,"appName":"Docker Desktop","pid":1234,"bundleId":"com.docker.docker","appPath":"/Applications/Docker.app"}');

  assert.deepEqual(event, {
    type: 'app-change',
    timestamp: 1710000000000,
    appName: 'Docker Desktop',
    pid: 1234,
    bundleId: 'com.docker.docker',
    appPath: '/Applications/Docker.app',
    windowTitle: '',
    documentUrl: ''
  });
});
