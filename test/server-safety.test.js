import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { test } from 'node:test';

import {
  MAX_JSON_BODY_BYTES,
  allowedCorsOrigin,
  isBrowserActivityPayload,
  isProjectPayload,
  isRulePayload,
  isTimeEntryPayload,
  parseJsonBody
} from '../server-safety.js';

function requestWithBody(body) {
  const request = new EventEmitter();
  request.destroy = () => {};
  queueMicrotask(() => {
    request.emit('data', Buffer.from(body));
    request.emit('end');
  });
  return request;
}

function readJsonBody(body, limit = MAX_JSON_BODY_BYTES) {
  return new Promise(resolve => {
    parseJsonBody(requestWithBody(body), (error, value) => resolve({ error, value }), limit);
  });
}

test('transitional server accepts only the local dashboard and explicitly configured extension origins', () => {
  assert.equal(allowedCorsOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(allowedCorsOrigin('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(
    allowedCorsOrigin('chrome-extension://dev-extension', 'chrome-extension://dev-extension'),
    'chrome-extension://dev-extension'
  );
  assert.equal(allowedCorsOrigin('https://untrusted.example'), null);
});

test('JSON request parsing rejects oversized and malformed payloads', async () => {
  const valid = await readJsonBody('{"title":"valid"}');
  assert.equal(valid.error, null);
  assert.deepEqual(valid.value, { title: 'valid' });

  const oversized = await readJsonBody('{"value":"123456"}', 10);
  assert.equal(oversized.error.code, 'PAYLOAD_TOO_LARGE');

  const malformed = await readJsonBody('{');
  assert.equal(malformed.error.code, 'INVALID_JSON');
});

test('write payload checks reject malformed or unbounded values', () => {
  assert.equal(isBrowserActivityPayload({ title: 'Docs', url: 'https://example.com', browser: 'Brave Browser', active: true }), true);
  assert.equal(isBrowserActivityPayload({ title: '', browser: 'Brave Browser', active: true }), false);
  assert.equal(isProjectPayload({ name: 'Client', billable: true }), true);
  assert.equal(isProjectPayload({
    name: 'Client',
    billable: true,
    tasks: [{ id: 'task-1', name: 'Planning', archived: false }]
  }), true);
  assert.equal(isProjectPayload({ name: 'Client', tasks: [{ name: 'Planning' }] }), false);
  assert.equal(isProjectPayload({ name: 'Client', tasks: [{ id: 'task-1', name: ' ' }] }), false);
  assert.equal(isProjectPayload({ name: ' ', billable: true }), false);
  assert.equal(isTimeEntryPayload({ start: 1, end: 2, projectId: 'proj-1', taskId: 'task-1' }), true);
  assert.equal(isTimeEntryPayload({ start: 1, end: 2, projectId: 'proj-1', taskId: '' }), true);
  assert.equal(isTimeEntryPayload({ start: 1, end: 2, projectId: 'proj-1', taskId: 42 }), false);
  assert.equal(isTimeEntryPayload({ start: 2, end: 1, projectId: 'proj-1' }), false);
  assert.equal(isRulePayload({ field: 'app', matchType: 'contains', pattern: 'Code', projectId: 'proj-1' }), true);
  assert.equal(isRulePayload({ field: 'unsupported', matchType: 'contains', pattern: 'Code', projectId: 'proj-1' }), false);
});

test('server binds the transitional runtime to loopback and allows an isolated data directory', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

  assert.match(source, /const HOST = process\.env\.ORIEL_HOST \|\| '127\.0\.0\.1'/);
  assert.match(source, /process\.env\.ORIEL_DATA_DIR/);
  assert.match(source, /server\.listen\(PORT,\s*HOST/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin', '\*'/);
});

test('transitional server stamps assignment rule responses with createdAt', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

  assert.match(source, /createdAt:\s*Date\.now\(\)/);
});

test('static asset responses include an SVG image content type', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

  assert.match(source, /ext === '\.svg'/);
  assert.match(source, /image\/svg\+xml/);
});
