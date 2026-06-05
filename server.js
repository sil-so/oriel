import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn, exec, execFile, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { resolveAppBundlePath, safeIconFileName } from './app-icon-resolver.js';
import { resolveNativeTrackerCommand } from './native-tracker.js';
import { parseTrackerEvent } from './tracker-events.js';
import { matchesTrackingExclusion, normalizeTrackingExclusion, pruneActivitiesByExclusion } from './tracking-exclusions.js';
import {
  allowedCorsOrigin,
  isBrowserActivityPayload,
  isProjectPayload,
  isRulePayload,
  isTimeEntryPayload,
  parseJsonBody
} from './server-safety.js';
import {
  activeEndAtIdleThreshold,
  clipSegmentToInterval,
  getLocalDateRangeBounds,
  getLocalDateString,
  getLocalDayBounds,
  isIdleSegment,
  splitSegmentByLocalDay
} from './activity-segments.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.ORIEL_PORT || '3000', 10);
const HOST = process.env.ORIEL_HOST || '127.0.0.1';
const DATA_DIR = process.env.ORIEL_DATA_DIR || path.join(__dirname, 'data');
const ACTIVITIES_DIR = path.join(DATA_DIR, 'activities');
const ICONS_DIR = path.join(DATA_DIR, 'icons');
const PID_FILE = path.join(DATA_DIR, 'oriel-server.pid');
const ICON_EXTRACTOR = path.join(__dirname, 'scratch', 'extract_icon');
const ICON_EXTRACTOR_SOURCE = path.join(__dirname, 'script', 'extract_icon.swift');
const TRACKER_SOURCE = path.join(__dirname, 'tracker.swift');
const TRACKER_BINARY = path.join(__dirname, 'scratch', 'tracker');

// Ensure data directories exist
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ACTIVITIES_DIR, { recursive: true });
fs.mkdirSync(ICONS_DIR, { recursive: true });

function writePidFile() {
  try {
    fs.writeFileSync(PID_FILE, `${process.pid}\n`);
  } catch (err) {
    console.warn('Unable to write server PID file:', err.message);
  }
}

function removePidFile() {
  try {
    if (!fs.existsSync(PID_FILE)) return;

    const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
    if (!pid || pid === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch (err) {
    console.warn('Unable to remove server PID file:', err.message);
  }
}

function buildSwiftToolIfNeeded(sourcePath, binaryPath, label) {
  if (fs.existsSync(binaryPath)) {
    const sourceStat = fs.statSync(sourcePath);
    const binaryStat = fs.statSync(binaryPath);
    if (binaryStat.mtimeMs >= sourceStat.mtimeMs) return;
  }

  const build = spawnSync('swiftc', [sourcePath, '-o', binaryPath], { encoding: 'utf8' });
  if (build.status !== 0) {
    const detail = (build.stderr || build.stdout || 'unknown compiler error').trim();
    console.warn(`[${label}] Failed to compile helper. ${detail}`);
  }
}

function isIconCacheFresh(iconPath) {
  if (!fs.existsSync(iconPath)) return false;

  const iconStat = fs.statSync(iconPath);
  const extractorStat = fs.existsSync(ICON_EXTRACTOR) ? fs.statSync(ICON_EXTRACTOR) : null;
  const sourceStat = fs.statSync(ICON_EXTRACTOR_SOURCE);
  const newestExtractorMtime = Math.max(
    sourceStat.mtimeMs,
    extractorStat ? extractorStat.mtimeMs : 0
  );

  return iconStat.mtimeMs >= newestExtractorMtime;
}

buildSwiftToolIfNeeded(ICON_EXTRACTOR_SOURCE, ICON_EXTRACTOR, 'Icon Extractor');

// Seed default projects if none exist
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
if (!fs.existsSync(PROJECTS_FILE)) {
  const defaultProjects = [
    { id: 'proj-1', name: 'Internal Admin', color: '#4b5563', billable: false },
    { id: 'proj-2', name: 'Client Development', color: '#3b82f6', billable: true },
    { id: 'proj-3', name: 'UI/UX Design', color: '#ec4899', billable: true },
    { id: 'proj-4', name: 'Meetings', color: '#10b981', billable: false },
    { id: 'proj-5', name: 'Break', color: '#f59e0b', billable: false }
  ];
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(defaultProjects, null, 2));
}

// Seed default time entries if none exist
const ENTRIES_FILE = path.join(DATA_DIR, 'time_entries.json');
if (!fs.existsSync(ENTRIES_FILE)) {
  fs.writeFileSync(ENTRIES_FILE, JSON.stringify([], null, 2));
}

// Seed default auto-assignment rules if none exist
const RULES_FILE = path.join(DATA_DIR, 'rules.json');
if (!fs.existsSync(RULES_FILE)) {
  fs.writeFileSync(RULES_FILE, JSON.stringify([], null, 2));
}

function ruleResponse(rule) {
  return {
    ...rule,
    createdAt: Number.isFinite(rule.createdAt) ? rule.createdAt : Date.now()
  };
}

const EXCLUSIONS_FILE = path.join(DATA_DIR, 'exclusions.json');
if (!fs.existsSync(EXCLUSIONS_FILE)) {
  fs.writeFileSync(EXCLUSIONS_FILE, JSON.stringify([], null, 2));
}


// Global active tracking state
const state = {
  currentActivity: {
    start: Date.now(),
    app: 'Finder',
    title: 'Desktop',
    url: '',
    bundleId: '',
    appPath: ''
  },
  lastBrowserTab: {
    title: '',
    url: '',
    browser: '',
    timestamp: Date.now()
  },
  tracker: {
    nativeStatus: 'starting',
    nativeMessage: '',
    lastNativeEventAt: 0
  },
  isIdle: false,
  idleStartTimestamp: 0
};

function readTrackingExclusions() {
  try {
    return JSON.parse(fs.readFileSync(EXCLUSIONS_FILE, 'utf8'));
  } catch (err) {
    console.error('Error reading tracking exclusions:', err);
    return [];
  }
}

function isTrackingExcluded(app, title, url) {
  return matchesTrackingExclusion({ app, title, url }, readTrackingExclusions());
}

function pruneActivityHistoryByExclusion(exclusion) {
  let removedCount = 0;
  const files = fs.readdirSync(ACTIVITIES_DIR)
    .filter(fileName => /^\d{4}-\d{2}-\d{2}\.json$/.test(fileName));

  for (const fileName of files) {
    const filePath = path.join(ACTIVITIES_DIR, fileName);
    try {
      const activities = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(activities)) continue;
      const { kept, removed } = pruneActivitiesByExclusion(activities, exclusion);
      if (removed.length === 0) continue;
      removedCount += removed.length;
      if (kept.length > 0) {
        fs.writeFileSync(filePath, JSON.stringify(kept, null, 2));
      } else {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error(`Error pruning activity history for ${fileName}:`, err);
    }
  }

  return removedCount;
}

// Log a finished activity segment
function logActivitySegment(start, end, app, title, url, metadata = {}) {
  const duration = end - start;
  if (duration < 1000) return; // Skip sub-second noise
  if (isIdleSegment({ app })) return;
  if (isTrackingExcluded(app, title, url)) return;

  const segment = {
    start,
    end,
    app,
    title,
    url,
    bundleId: metadata.bundleId || '',
    appPath: metadata.appPath || ''
  };

  for (const dailySegment of splitSegmentByLocalDay(segment)) {
    const dateStr = getLocalDateString(dailySegment.start);
    const logFile = path.join(ACTIVITIES_DIR, `${dateStr}.json`);
    let activities = [];
    try {
      if (fs.existsSync(logFile)) {
        activities = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      }
      activities.push(dailySegment);
      fs.writeFileSync(logFile, JSON.stringify(activities, null, 2));
    } catch (err) {
      console.error('Error writing activities log file:', err);
    }
  }
}

function rolloverCurrentActivity() {
  if (!state.currentActivity) return;
  const now = Date.now();
  logActivitySegment(
    state.currentActivity.start,
    now,
    state.currentActivity.app,
    state.currentActivity.title,
    state.currentActivity.url,
    {
      bundleId: state.currentActivity.bundleId,
      appPath: state.currentActivity.appPath
    }
  );
  state.currentActivity.start = now;
}

// Transition into a new active activity state
function transitionActivity(newApp, newTitle, newUrl, metadata = {}) {
  const now = Date.now();
  
  // Ignore state updates that are identical to avoid segment fragmentation
  if (
    state.currentActivity &&
    state.currentActivity.app === newApp &&
    state.currentActivity.title === newTitle &&
    state.currentActivity.url === newUrl &&
    state.currentActivity.bundleId === (metadata.bundleId || '') &&
    state.currentActivity.appPath === (metadata.appPath || '')
  ) {
    return;
  }

  // Log the finished segment
  if (state.currentActivity) {
    logActivitySegment(
      state.currentActivity.start,
      now,
      state.currentActivity.app,
      state.currentActivity.title,
      state.currentActivity.url,
      {
        bundleId: state.currentActivity.bundleId,
        appPath: state.currentActivity.appPath
      }
    );
  }

  // Start new segment
  state.currentActivity = {
    start: now,
    app: newApp,
    title: newTitle,
    url: newUrl,
    bundleId: metadata.bundleId || '',
    appPath: metadata.appPath || ''
  };

  console.log(`[Activity Transition] App: "${newApp}", Title: "${newTitle}"`);
}

function stopCurrentActivity(end) {
  if (!state.currentActivity) return;
  logActivitySegment(
    state.currentActivity.start,
    end,
    state.currentActivity.app,
    state.currentActivity.title,
    state.currentActivity.url,
    {
      bundleId: state.currentActivity.bundleId,
      appPath: state.currentActivity.appPath
    }
  );
  state.currentActivity = null;
}

function readActivitiesInInterval(intervalStart, intervalEnd) {
  const activities = [];
  const firstCandidateDate = getLocalDateString(intervalStart - 1);
  let cursor = getLocalDayBounds(firstCandidateDate).start;
  let daysCount = 0;

  while (cursor < intervalEnd && daysCount < 367) {
    const dateStr = getLocalDateString(cursor);
    const logFile = path.join(ACTIVITIES_DIR, `${dateStr}.json`);
    try {
      if (fs.existsSync(logFile)) {
        const dailyActivities = JSON.parse(fs.readFileSync(logFile, 'utf8'));
        activities.push(
          ...dailyActivities
            .map(activity => clipSegmentToInterval(activity, intervalStart, intervalEnd))
            .filter(Boolean)
        );
      }
    } catch (err) {
      console.error(`Error reading activities for ${dateStr}:`, err);
    }
    cursor = getLocalDayBounds(dateStr).end;
    daysCount++;
  }

  if (state.currentActivity && !state.isIdle) {
    const currentActivity = clipSegmentToInterval(
      { ...state.currentActivity, end: Date.now() },
      intervalStart,
      intervalEnd
    );
    if (
      currentActivity &&
      !isTrackingExcluded(currentActivity.app, currentActivity.title, currentActivity.url)
    ) {
      activities.push(currentActivity);
    }
  }

  return activities.sort((first, second) => first.start - second.start);
}

function readAllActivities() {
  const activities = [];
  const files = fs.readdirSync(ACTIVITIES_DIR)
    .filter(fileName => /^\d{4}-\d{2}-\d{2}\.json$/.test(fileName))
    .sort();

  for (const fileName of files) {
    const logFile = path.join(ACTIVITIES_DIR, fileName);
    try {
      const dailyActivities = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      if (!Array.isArray(dailyActivities)) continue;
      activities.push(
        ...dailyActivities
          .filter(activity => !isIdleSegment(activity))
          .filter(activity => !isTrackingExcluded(activity.app, activity.title, activity.url))
      );
    } catch (err) {
      console.error(`Error reading activities for ${fileName}:`, err);
    }
  }

  if (
    state.currentActivity &&
    !state.isIdle &&
    !isIdleSegment(state.currentActivity) &&
    !isTrackingExcluded(state.currentActivity.app, state.currentActivity.title, state.currentActivity.url)
  ) {
    activities.push({ ...state.currentActivity, end: Date.now() });
  }

  return activities.sort((first, second) => first.start - second.start);
}

// Helper: Query frontmost macOS window title using ONLY System Events
// This avoids per-app permission dialogs entirely.
function getActiveWindowTitle(processName, callback) {
  if (!processName) {
    callback('');
    return;
  }
  const cleanName = processName.replace(/"/g, '\\"').replace(/'/g, "'\\''");
  const script = `tell application "System Events"
  set windowTitle to ""
  try
    tell process "${cleanName}"
      try
        set windowTitle to name of first window whose name is not ""
      on error
        try
          set windowTitle to name of first window
        end try
      end try
    end tell
  end try
  if windowTitle is missing value then
    return ""
  else
    return windowTitle
  end if
end tell`;
  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 3000 }, (err, stdout) => {
    if (err) {
      callback('');
    } else {
      callback(stdout.trim());
    }
  });
}


// 1. Spawning Native Swift Workspace Observer
console.log('Starting native macOS app tracker...');
const trackerCommand = resolveNativeTrackerCommand({
  sourcePath: TRACKER_SOURCE,
  binaryPath: TRACKER_BINARY
});
console.log(`[Native Tracker] Launching ${trackerCommand.mode} helper`);
const swiftProcess = spawn(trackerCommand.command, trackerCommand.args);

let stdoutBuffer = '';
swiftProcess.stdout.on('data', (data) => {
  stdoutBuffer += data.toString();
  const lines = stdoutBuffer.split('\n');
  stdoutBuffer = lines.pop(); // Keep partial line in buffer

  for (const line of lines) {
    const event = parseTrackerEvent(line);
    if (!event) continue;

    if (event.type === 'tracker-status') {
      state.tracker.nativeStatus = event.status;
      state.tracker.nativeMessage = event.message;
      state.tracker.lastNativeEventAt = Date.now();

      if (event.status === 'active') {
        console.log(`[Native Tracker] ${event.message}`);
      } else {
        console.warn(`[Native Tracker] ${event.status}: ${event.message}`);
      }
      continue;
    }

    if (event.type === 'app-change') {
      const appName = event.appName;
      state.tracker.nativeStatus = 'active';
      state.tracker.lastNativeEventAt = Date.now();

      if (state.isIdle) continue; // Ignore workspace changes if currently idle

      const appMetadata = {
        bundleId: event.bundleId || '',
        appPath: event.appPath || ''
      };

      if (appName === 'Google Chrome' || appName === 'Brave Browser') {
        // If browser is now frontmost, transition using our latest extension tab logs
        const activeBrowser = appName;
        const matchedTab = state.lastBrowserTab.browser.toLowerCase().includes(activeBrowser.toLowerCase().split(' ')[0].toLowerCase())
          ? state.lastBrowserTab
          : { title: activeBrowser, url: '', browser: activeBrowser };

        transitionActivity(activeBrowser, matchedTab.title || activeBrowser, matchedTab.url || '', appMetadata);
      } else if (event.windowTitle) {
        // Use native event-driven window title and documentUrl directly for 100% real-time tracking!
        transitionActivity(appName, event.windowTitle, event.documentUrl || '', appMetadata);
      } else {
        // Fallback for general macOS applications without native title (e.g. AX not allowed)
        getActiveWindowTitle(appName, (title) => {
          if (state.isIdle) return;
          transitionActivity(appName, title || appName, '', appMetadata);
        });
      }
    }
  }
});

swiftProcess.stderr.on('data', (data) => {
  console.error('[Swift Observer Error]:', data.toString());
});

swiftProcess.on('error', (err) => {
  state.tracker.nativeStatus = 'error';
  state.tracker.nativeMessage = `Native tracker failed to start: ${err.message}`;
  state.tracker.lastNativeEventAt = Date.now();
  console.error('[Native Tracker Error]:', err.message);
});

swiftProcess.on('close', (code) => {
  if (state.tracker.nativeStatus !== 'error') {
    state.tracker.nativeStatus = 'stopped';
    state.tracker.nativeMessage = `Native tracker exited with code ${code}`;
    state.tracker.lastNativeEventAt = Date.now();
  }
  console.warn(`Swift Observer process exited with code ${code}`);
});

// 2. System Idle Tracker (ioreg check every 5 seconds) & Active Window Poller
setInterval(() => {
  exec("ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'", (err, stdout) => {
    if (err) return;
    
    const idleSeconds = parseInt(stdout.trim(), 10);
    const IDLE_THRESHOLD = 120; // 2 minutes

    if (idleSeconds >= IDLE_THRESHOLD) {
      if (!state.isIdle) {
        const now = Date.now();
        state.isIdle = true;
        state.idleStartTimestamp = now - (idleSeconds * 1000);

        if (state.currentActivity) {
          const activeEnd = activeEndAtIdleThreshold(
            state.currentActivity.start,
            now,
            idleSeconds,
            IDLE_THRESHOLD
          );
          stopCurrentActivity(activeEnd);
        }
      }
    } else {
      state.isIdle = false;

      // Query frontmost app and window title via System Events ONLY (no per-app permission dialogs)
      const pollerScript = `tell application "System Events"
  set frontProc to first process whose frontmost is true
  set appName to name of frontProc
  set windowTitle to ""
  try
    tell frontProc
      try
        set windowTitle to name of first window whose name is not ""
      on error
        try
          set windowTitle to name of first window
        end try
      end try
    end tell
  end try
  if windowTitle is missing value then
    set windowTitle to ""
  end if
  return appName & "|||" & windowTitle
end tell`;
      exec(`osascript -e '${pollerScript.replace(/'/g, "'\\''")}'`, { timeout: 3000 }, (err, stdoutRes) => {
        if (err) return;
        const result = stdoutRes.trim();
        if (!result) return;

        const parts = result.split('|||');
        const activeApp = parts[0];
        const activeTitle = parts[1] || activeApp;
        const fallbackMetadata = activeApp === state.currentActivity?.app
          ? {
              bundleId: state.currentActivity.bundleId,
              appPath: state.currentActivity.appPath
            }
          : {};

        if (activeApp === 'Google Chrome' || activeApp === 'Brave Browser') {
          const matchedTab = state.lastBrowserTab.browser && 
            state.lastBrowserTab.browser.toLowerCase().includes(activeApp.toLowerCase().split(' ')[0])
            ? state.lastBrowserTab
            : null;

          if (matchedTab) {
            transitionActivity(activeApp, matchedTab.title || activeApp, matchedTab.url || '', fallbackMetadata);
          } else {
            transitionActivity(activeApp, activeTitle, '', fallbackMetadata);
          }
        } else {
          transitionActivity(activeApp, activeTitle, '', fallbackMetadata);
        }
      });
    }
  });
}, 5000);

// 3. HTTP Server Setup
const server = http.createServer((req, res) => {
  const origin = allowedCorsOrigin(req.headers.origin);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(origin ? 204 : 403);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Serve Frontend index.html
  if (pathname === '/' || pathname === '/index.html') {
    const indexPath = path.join(__dirname, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading dashboard');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      }
    });
    return;
  }

  // Serve modular static assets securely
  const ext = path.extname(pathname);
  if (ext && (pathname.startsWith('/js/') || pathname.startsWith('/css/') || pathname.startsWith('/assets/') || ext === '.png' || ext === '.jpg' || ext === '.ico' || ext === '.svg')) {
    const safePath = path.normalize(path.join(__dirname, pathname));
    const realSafePath = fs.existsSync(safePath) ? fs.realpathSync(safePath) : safePath;
    const realDirname = fs.realpathSync(__dirname);
    if (realSafePath.startsWith(realDirname)) {
      if (fs.existsSync(safePath) && !fs.statSync(safePath).isDirectory()) {
        let contentType = 'text/plain';
        if (ext === '.css') contentType = 'text/css';
        if (ext === '.js') contentType = 'application/javascript';
        if (ext === '.png') contentType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        if (ext === '.ico') contentType = 'image/x-icon';
        if (ext === '.svg') contentType = 'image/svg+xml';
        if (ext === '.woff2') contentType = 'font/woff2';
        if (ext === '.woff') contentType = 'font/woff';
        const headers = { 'Content-Type': contentType };
        if (pathname.startsWith('/js/') || pathname.startsWith('/css/')) {
          headers['Cache-Control'] = 'no-cache, max-age=0';
        }

        fs.readFile(safePath, (err, content) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error serving static asset');
          } else {
            res.writeHead(200, headers);
            res.end(content);
          }
        });
        return;
      }
    }
  }

  // --- API ROUTING ---

  // GET /api/status
  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      nativeStatus: state.tracker.nativeStatus,
      nativeMessage: state.tracker.nativeMessage,
      lastNativeEventAt: state.tracker.lastNativeEventAt
    }));
    return;
  }

  // POST /api/browser-activity (from Extension)
  if (pathname === '/api/browser-activity' && req.method === 'POST') {
    parseJsonBody(req, (err, data) => {
      if (err || !isBrowserActivityPayload(data)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid browser activity payload' }));
        return;
      }

      const { title, url: tabUrl, browser, active } = data;
      state.lastBrowserTab = { title, url: tabUrl, browser, timestamp: Date.now() };

      // Transition immediately if this browser window is currently active and user not away
      if (active && !state.isIdle) {
        transitionActivity(browser, title, tabUrl);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // GET /api/activities?date=YYYY-MM-DD or ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  if (pathname === '/api/activities' && req.method === 'GET') {
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    if (startDate && endDate) {
      try {
        const { start, end } = getLocalDateRangeBounds(startDate, endDate);
        const activities = readActivitiesInInterval(start, end);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(activities));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    const dateStr = url.searchParams.get('date') || getLocalDateString();
    if (dateStr === 'all') {
      const activities = readAllActivities();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(activities));
      return;
    }
    try {
      const { start, end } = getLocalDayBounds(dateStr);
      const activities = readActivitiesInInterval(start, end);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(activities));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }


  // GET /api/projects
  if (pathname === '/api/projects' && req.method === 'GET') {
    const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(projects));
    return;
  }

  // POST /api/projects
  if (pathname === '/api/projects' && req.method === 'POST') {
    parseJsonBody(req, (err, project) => {
      if (err || !isProjectPayload(project)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid project payload' }));
        return;
      }
      const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
      project.id = 'proj-' + Date.now();
      projects.push(project);
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(project));
    });
    return;
  }

  // PUT /api/projects/:id
  if (pathname.startsWith('/api/projects/') && req.method === 'PUT') {
    const id = pathname.split('/').pop();
    parseJsonBody(req, (err, updatedProj) => {
      if (err || !isProjectPayload(updatedProj, true)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload' }));
        return;
      }
      const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
      const index = projects.findIndex(p => p.id === id);

      if (index === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Project not found' }));
        return;
      }

      projects[index] = { ...projects[index], ...updatedProj };
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(projects[index]));
    });
    return;
  }

  // DELETE /api/projects/:id
  if (pathname.startsWith('/api/projects/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
    const filtered = projects.filter(p => p.id !== id);

    if (projects.length === filtered.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
      return;
    }

    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(filtered, null, 2));

    // Remove time entries that were assigned to the deleted project
    try {
      const entries = JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8'));
      const updatedEntries = entries.filter(e => e.projectId !== id);
      if (updatedEntries.length !== entries.length) {
        fs.writeFileSync(ENTRIES_FILE, JSON.stringify(updatedEntries, null, 2));
      }
    } catch (err) {
      console.error('Error updating entries on project deletion:', err);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // GET /api/time-entries?date=YYYY-MM-DD or ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD or ?date=all
  if (pathname === '/api/time-entries' && req.method === 'GET') {
    const dateStr = url.searchParams.get('date');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const entries = JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8'));
    
    let filtered = entries;
    if (startDate && endDate) {
      filtered = entries.filter(e => {
        const entryDate = getLocalDateString(e.start);
        return entryDate >= startDate && entryDate <= endDate;
      });
    } else if (dateStr && dateStr !== 'all') {
      filtered = entries.filter(e => {
        const entryDate = getLocalDateString(e.start);
        return entryDate === dateStr;
      });
    } else if (!dateStr) {
      // Default to today
      const todayStr = getLocalDateString();
      filtered = entries.filter(e => {
        const entryDate = getLocalDateString(e.start);
        return entryDate === todayStr;
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(filtered));
    return;
  }

  // POST /api/time-entries
  if (pathname === '/api/time-entries' && req.method === 'POST') {
    parseJsonBody(req, (err, entry) => {
      if (err || !isTimeEntryPayload(entry)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid time entry payload' }));
        return;
      }
      const entries = JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8'));
      entry.id = 'entry-' + Date.now() + Math.random().toString(36).substr(2, 5);
      entries.push(entry);
      fs.writeFileSync(ENTRIES_FILE, JSON.stringify(entries, null, 2));

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(entry));
    });
    return;
  }

  // PUT /api/time-entries/:id
  if (pathname.startsWith('/api/time-entries/') && req.method === 'PUT') {
    const id = pathname.split('/').pop();
    parseJsonBody(req, (err, updatedEntry) => {
      if (err || !isTimeEntryPayload(updatedEntry, true)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload' }));
        return;
      }
      const entries = JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8'));
      const index = entries.findIndex(e => e.id === id);

      if (index === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Time entry not found' }));
        return;
      }

      entries[index] = { ...entries[index], ...updatedEntry };
      fs.writeFileSync(ENTRIES_FILE, JSON.stringify(entries, null, 2));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(entries[index]));
    });
    return;
  }

  // DELETE /api/time-entries/:id
  if (pathname.startsWith('/api/time-entries/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    const entries = JSON.parse(fs.readFileSync(ENTRIES_FILE, 'utf8'));
    const filtered = entries.filter(e => e.id !== id);

    if (entries.length === filtered.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Time entry not found' }));
      return;
    }

    fs.writeFileSync(ENTRIES_FILE, JSON.stringify(filtered, null, 2));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // GET /api/rules
  if (pathname === '/api/rules' && req.method === 'GET') {
    try {
      const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rules.map(ruleResponse)));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read rules' }));
    }
    return;
  }

  // POST /api/rules
  if (pathname === '/api/rules' && req.method === 'POST') {
    parseJsonBody(req, (err, rule) => {
      if (err || !isRulePayload(rule)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid rule payload' }));
        return;
      }
      try {
        const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
        const created = {
          ...rule,
          id: 'rule-' + Date.now() + Math.random().toString(36).substr(2, 5),
          createdAt: Date.now()
        };
        rules.push(created);
        fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(created));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to write rules' }));
      }
    });
    return;
  }

  // DELETE /api/rules/:id
  if (pathname.startsWith('/api/rules/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    try {
      const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
      const filtered = rules.filter(r => r.id !== id);

      if (rules.length === filtered.length) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Rule not found' }));
        return;
      }

      fs.writeFileSync(RULES_FILE, JSON.stringify(filtered, null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to delete rule' }));
    }
    return;
  }

  // GET /api/exclusions
  if (pathname === '/api/exclusions' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(readTrackingExclusions()));
    return;
  }

  // POST /api/exclusions
  if (pathname === '/api/exclusions' && req.method === 'POST') {
    parseJsonBody(req, (err, payload) => {
      const exclusion = !err ? normalizeTrackingExclusion(payload) : null;
      if (!exclusion) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid exclusion payload' }));
        return;
      }

      try {
        rolloverCurrentActivity();
        const exclusions = readTrackingExclusions();
        const created = {
          ...exclusion,
          id: 'exclusion-' + Date.now() + Math.random().toString(36).substr(2, 5)
        };
        exclusions.push(created);
        fs.writeFileSync(EXCLUSIONS_FILE, JSON.stringify(exclusions, null, 2));
        if (created.applyToHistory) {
          created.removedHistoryCount = pruneActivityHistoryByExclusion(created);
        }
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(created));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to write exclusion' }));
      }
    });
    return;
  }

  // DELETE /api/exclusions/:id
  if (pathname.startsWith('/api/exclusions/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    try {
      const exclusions = readTrackingExclusions();
      const filtered = exclusions.filter(exclusion => exclusion.id !== id);
      if (exclusions.length === filtered.length) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Exclusion not found' }));
        return;
      }

      rolloverCurrentActivity();
      fs.writeFileSync(EXCLUSIONS_FILE, JSON.stringify(filtered, null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to delete exclusion' }));
    }
    return;
  }

  // POST /api/purge
  if (pathname === '/api/purge' && req.method === 'POST') {
    try {
      rolloverCurrentActivity();

      // 1. Truncate time entries
      fs.writeFileSync(ENTRIES_FILE, JSON.stringify([], null, 2));

      // 2. Truncate rules
      fs.writeFileSync(RULES_FILE, JSON.stringify([], null, 2));

      // 3. Truncate capture exclusions
      fs.writeFileSync(EXCLUSIONS_FILE, JSON.stringify([], null, 2));

      // 4. Clear activities dir
      if (fs.existsSync(ACTIVITIES_DIR)) {
        const files = fs.readdirSync(ACTIVITIES_DIR);
        for (const file of files) {
          fs.unlinkSync(path.join(ACTIVITIES_DIR, file));
        }
      }

      // 5. Reset projects.json to default demo seed values
      const defaultProjects = [
        { id: 'proj-1', name: 'Internal Admin', color: '#4b5563', billable: false },
        { id: 'proj-2', name: 'Client Development', color: '#3b82f6', billable: true },
        { id: 'proj-3', name: 'UI/UX Design', color: '#ec4899', billable: true },
        { id: 'proj-4', name: 'Meetings', color: '#10b981', billable: false },
        { id: 'proj-5', name: 'Break', color: '#f59e0b', billable: false }
      ];
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(defaultProjects, null, 2));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      console.error('Error purging data:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to purge application data' }));
    }
    return;
  }

  // GET /api/icons/:appName — extract and serve native macOS app icons
  if (pathname.startsWith('/api/icons/') && req.method === 'GET') {
    const appName = decodeURIComponent(pathname.split('/api/icons/')[1]);
    if (!appName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing app name' }));
      return;
    }

    const requestedAppPath = url.searchParams.get('appPath') || '';
    const requestedBundleId = url.searchParams.get('bundleId') || '';
    const safeName = safeIconFileName(appName, requestedBundleId);
    const iconPath = path.join(ICONS_DIR, `${safeName}.png`);

    const iconHeaders = {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache, max-age=0'
    };

    // Serve cached icon if available and generated by the current extractor.
    if (isIconCacheFresh(iconPath)) {
      res.writeHead(200, iconHeaders);
      fs.createReadStream(iconPath).pipe(res);
      return;
    }

    // Resolve the app path via mdfind (Spotlight), then extract the icon
    exec(`mdfind "kMDItemFSName == '${safeName}.app'" | head -1`, { timeout: 5000 }, (err, stdout) => {
      let appPath = resolveAppBundlePath({
        appName,
        appPath: requestedAppPath,
        bundleId: requestedBundleId
      }) || (stdout ? stdout.trim() : '');

      // Fallback: check common locations
      if (!appPath) {
        const candidates = [
          `/Applications/${safeName}.app`,
          `/System/Applications/${safeName}.app`,
          path.join(process.env.HOME || '', 'Applications', `${safeName}.app`),
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            appPath = c;
            break;
          }
        }
      }

      if (!appPath || !fs.existsSync(appPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'App not found' }));
        return;
      }

      execFile(ICON_EXTRACTOR, [appPath, iconPath], { timeout: 5000 }, (extractErr) => {
        if (extractErr || !fs.existsSync(iconPath)) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Icon extraction failed' }));
          return;
        }
        res.writeHead(200, iconHeaders);
        fs.createReadStream(iconPath).pipe(res);
      });
    });
    return;
  }

  // Route Not Found
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

let isShuttingDown = false;

function saveCurrentActivitySegment() {
  if (!state.currentActivity) return;
  const now = Date.now();
  logActivitySegment(
    state.currentActivity.start,
    now,
    state.currentActivity.app,
    state.currentActivity.title,
    state.currentActivity.url,
    {
      bundleId: state.currentActivity.bundleId,
      appPath: state.currentActivity.appPath
    }
  );
}

// Close gracefully for Terminal Ctrl-C, LaunchAgent stop, and stop launchers.
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\nStopping tracking engine (${signal})...`);
  saveCurrentActivitySegment();

  if (swiftProcess && !swiftProcess.killed) {
    swiftProcess.kill();
  }

  server.close(() => {
    removePidFile();
    process.exit(0);
  });

  setTimeout(() => {
    removePidFile();
    process.exit(0);
  }, 1000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', removePidFile);

server.listen(PORT, HOST, () => {
  writePidFile();
  console.log(`\n======================================================`);
  console.log(`Time Tracker backend running at http://${HOST}:${PORT}`);
  console.log(`🧠 Local data folder: ${DATA_DIR}`);
  console.log(`Transitional local development service active`);
  console.log(`======================================================\n`);
});
