export function parseTrackerEvent(line) {
  if (!line || !line.startsWith('EVENT:')) return null;

  const parts = line.split(':');
  const eventName = parts[1];

  if (eventName === 'APP_CHANGE_JSON') {
    const jsonStart = 'EVENT:APP_CHANGE_JSON:'.length;
    try {
      const payload = JSON.parse(line.slice(jsonStart));
      if (!payload.appName || !Number.isFinite(payload.timestamp) || !Number.isFinite(payload.pid)) {
        return null;
      }

      return {
        type: 'app-change',
        timestamp: payload.timestamp,
        appName: payload.appName,
        pid: payload.pid,
        bundleId: payload.bundleId || '',
        appPath: payload.appPath || '',
        windowTitle: payload.windowTitle || '',
        documentUrl: payload.documentUrl || ''
      };
    } catch {
      return null;
    }
  }

  if (eventName === 'APP_CHANGE') {
    if (parts.length < 5) return null;

    const timestamp = Number(parts[2]);
    const pid = Number(parts[parts.length - 1]);
    const appName = parts.slice(3, -1).join(':');

    if (!Number.isFinite(timestamp) || !Number.isFinite(pid) || !appName) {
      return null;
    }

    return {
      type: 'app-change',
      timestamp,
      appName,
      pid
    };
  }

  if (eventName === 'TRACKER_STATUS') {
    const status = parts[2] || 'unknown';
    const message = parts.slice(3).join(':');

    return {
      type: 'tracker-status',
      status,
      message
    };
  }

  return null;
}
