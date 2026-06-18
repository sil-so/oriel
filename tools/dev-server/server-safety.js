export const MAX_JSON_BODY_BYTES = 64 * 1024;

const MAX_SHORT_TEXT = 512;
const MAX_TITLE = 4096;
const MAX_URL = 16384;
const SUPPORTED_FIELDS = new Set(['app', 'title', 'url']);
const SUPPORTED_MATCH_TYPES = new Set(['contains', 'equals', 'regex']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isString(value, maxLength, allowEmpty = false) {
  return typeof value === 'string' &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0);
}

export function allowedCorsOrigin(origin, extensionOrigin = process.env.ORIEL_EXTENSION_ORIGIN || '') {
  const allowed = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
  if (extensionOrigin) allowed.add(extensionOrigin);
  return allowed.has(origin) ? origin : null;
}

export function parseJsonBody(req, callback, maxBytes = MAX_JSON_BODY_BYTES) {
  let body = '';
  let complete = false;
  const finish = (error, value = null) => {
    if (complete) return;
    complete = true;
    callback(error, value);
  };

  req.on('data', chunk => {
    if (complete) return;
    body += chunk.toString();
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error('Request body exceeds maximum size');
      error.code = 'PAYLOAD_TOO_LARGE';
      finish(error);
    }
  });
  req.on('end', () => {
    if (complete) return;
    try {
      finish(null, body ? JSON.parse(body) : {});
    } catch {
      const error = new Error('Request body is not valid JSON');
      error.code = 'INVALID_JSON';
      finish(error);
    }
  });
  req.on('error', error => finish(error));
}

export function isBrowserActivityPayload(value) {
  return isObject(value) &&
    isString(value.title, MAX_TITLE) &&
    (!('url' in value) || isString(value.url, MAX_URL, true)) &&
    isString(value.browser, MAX_SHORT_TEXT) &&
    typeof value.active === 'boolean';
}

export function isProjectPayload(value, partial = false) {
  if (!isObject(value)) return false;
  if (!partial && !isString(value.name, MAX_SHORT_TEXT)) return false;
  if ('name' in value && !isString(value.name, MAX_SHORT_TEXT)) return false;
  if ('color' in value && !isString(value.color, MAX_SHORT_TEXT)) return false;
  if ('billable' in value && typeof value.billable !== 'boolean') return false;
  if ('tasks' in value && (
    !Array.isArray(value.tasks) ||
    !value.tasks.every(task => isObject(task) &&
      isString(task.id, MAX_SHORT_TEXT) &&
      isString(task.name, MAX_SHORT_TEXT) &&
      (!('archived' in task) || typeof task.archived === 'boolean'))
  )) return false;
  return true;
}

export function isTimeEntryPayload(value, partial = false) {
  if (!isObject(value)) return false;
  if (!partial && (!Number.isFinite(value.start) || !Number.isFinite(value.end) || !isString(value.projectId, MAX_SHORT_TEXT))) return false;
  if ('start' in value && !Number.isFinite(value.start)) return false;
  if ('end' in value && !Number.isFinite(value.end)) return false;
  if ('projectId' in value && !isString(value.projectId, MAX_SHORT_TEXT)) return false;
  if ('taskId' in value && !isString(value.taskId, MAX_SHORT_TEXT, true)) return false;
  if ('description' in value && !isString(value.description, MAX_TITLE, true)) return false;
  if ('billable' in value && typeof value.billable !== 'boolean') return false;
  if (
    Number.isFinite(value.start) &&
    Number.isFinite(value.end) &&
    value.end <= value.start
  ) return false;
  return true;
}

export function isRulePayload(value) {
  return isObject(value) &&
    SUPPORTED_FIELDS.has(value.field) &&
    SUPPORTED_MATCH_TYPES.has(value.matchType) &&
    isString(value.pattern, MAX_TITLE) &&
    isString(value.projectId, MAX_SHORT_TEXT);
}
