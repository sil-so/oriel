// Fetch configured projects from backend
async function fetchProjects() {
    try {
        const res = await fetch(`${API_BASE}/projects`);
        state.projects = await res.json();
        populateProjectDropdowns();
    } catch (err) {
        console.error('Error fetching projects:', err);
    }
}

// Populate the time entry dialog dropdown (legacy select no-op)
function populateProjectDropdowns() {
    // Handled dynamically via renderModalProjectGrid in js/modals.js
}

// Rules API client CRUD routines
async function fetchRules() {
    try {
        const res = await fetch(`${API_BASE}/rules`);
        state.rules = await res.json();
    } catch (err) {
        console.error('Error fetching rules:', err);
    }
}

async function fetchTrackingExclusions() {
    try {
        const res = await fetch(`${API_BASE}/exclusions`);
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        state.trackingExclusions = await res.json();
    } catch (err) {
        console.error('Error fetching tracking exclusions:', err);
        state.trackingExclusions = [];
    }
}

function updateTrackingStatusIndicator(trackerStatus = {}) {
    const indicator = DOM.elTrackingStatusIndicator;
    if (!indicator) return;

    const status = trackerStatus.nativeStatus || 'error';
    const message = trackerStatus.nativeMessage || '';
    let presentation;

    if (status === 'active') {
        presentation = {
            className: 'tracking-status-dot--active',
            title: `Tracking active: ${message || 'Native activity tracking is active'}`
        };
    } else if (status === 'starting') {
        presentation = {
            className: 'tracking-status-dot--starting',
            title: `Tracking starting: ${message || 'Waiting for native tracker status'}`
        };
    } else if (status === 'unavailable' || status === 'degraded') {
        presentation = {
            className: 'tracking-status-dot--degraded',
            title: `Tracking limited: ${message || 'Native tracking is unavailable'}`
        };
    } else {
        presentation = {
            className: 'tracking-status-dot--error',
            title: `Tracking unavailable: ${message || 'Unable to connect to the tracker'}`
        };
    }

    indicator.className = `tracking-status-dot ${presentation.className}`;
    indicator.setAttribute('aria-label', presentation.title);
    const tooltip = document.getElementById('tracking-status-tooltip');
    if (tooltip) {
        tooltip.textContent = presentation.title;
    }
}

async function refreshTrackingStatus() {
    try {
        const res = await fetch(`${API_BASE}/status`);
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        const trackerStatus = await res.json();
        updateTrackingStatusIndicator(trackerStatus);
    } catch (err) {
        updateTrackingStatusIndicator({
            nativeStatus: 'error',
            nativeMessage: 'Unable to reach the local tracker service'
        });
    }
}

// Pre-merges consecutive segments of identical app and title within a 5-second gap
function isActivityStreamExcluded(activity) {
    const app = String(activity?.app || '').toLowerCase();
    return app === 'idle' || app === 'loginwindow';
}

function normalizeInteractionState(activity) {
    return activity?.interactionState === 'handsOff' ? 'handsOff' : 'handsOn';
}

function getRawActivityDurationMs(activity) {
    if (Number.isFinite(activity?.start) && Number.isFinite(activity?.end) && activity.end > activity.start) {
        return activity.end - activity.start;
    }
    return 0;
}

function activityMixForSegment(activity) {
    const duration = getRawActivityDurationMs(activity);
    return normalizeInteractionState(activity) === 'handsOff'
        ? { handsOnMs: 0, handsOffMs: duration }
        : { handsOnMs: duration, handsOffMs: 0 };
}

function addActivityMix(left, right) {
    return {
        handsOnMs: Math.max(0, Number(left?.handsOnMs || 0)) + Math.max(0, Number(right?.handsOnMs || 0)),
        handsOffMs: Math.max(0, Number(left?.handsOffMs || 0)) + Math.max(0, Number(right?.handsOffMs || 0))
    };
}

function sourceSegmentForActivity(activity) {
    return {
        ...activity,
        interactionState: normalizeInteractionState(activity),
        activityMix: activityMixForSegment(activity)
    };
}

function enrichActivityMix(activity) {
    const sourceSegment = sourceSegmentForActivity(activity);
    return {
        ...activity,
        interactionState: normalizeInteractionState(activity),
        activityMix: sourceSegment.activityMix,
        sourceSegments: [sourceSegment]
    };
}

function preMergeActivities(raw) {
    raw = raw.filter(activity => !isActivityStreamExcluded(activity));
    if (raw.length === 0) return [];
    
    // Sort chronologically by start time
    const sorted = [...raw].sort((a, b) => a.start - b.start);
    const merged = [];
    
    let current = enrichActivityMix(sorted[0]);
    
    for (let i = 1; i < sorted.length; i++) {
        const next = enrichActivityMix(sorted[i]);
        const gap = next.start - current.end;
        
        // Group segments if identical app + title and gap is within 5 seconds (5000ms)
        if (
            current.app === next.app &&
            current.title === next.title &&
            gap <= 5000
        ) {
            current.end = Math.max(current.end, next.end);
            current.activityMix = addActivityMix(current.activityMix, next.activityMix);
            current.sourceSegments = [...(current.sourceSegments || []), ...(next.sourceSegments || [])];
        } else {
            merged.push(current);
            current = next;
        }
    }
    
    merged.push(current);
    return merged;
}

function getRefreshWeekRange() {
    if (typeof window.getSelectedWeekRange === 'function') {
        return window.getSelectedWeekRange(state.currentDate);
    }

    const start = new Date(state.currentDate);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

async function refreshWeekData() {
    const { start, end } = getRefreshWeekRange();
    const startDate = getFormattedDate(start);
    const endDate = getFormattedDate(end);

    try {
        const [, resActivities, resTimeEntries] = await Promise.all([
            refreshTrackingStatus(),
            fetch(`${API_BASE}/activities?startDate=${startDate}&endDate=${endDate}`),
            fetch(`${API_BASE}/time-entries?startDate=${startDate}&endDate=${endDate}`)
        ]);

        const rawActivities = await resActivities.json();
        const preMergedActivities = preMergeActivities(rawActivities);

        state.weekTimelineActivities = preMergedActivities;
        state.weekActivities = preMergedActivities;
        state.weekTimeEntries = await resTimeEntries.json();

        if (window.renderWeekTimelineGrids) renderWeekTimelineGrids();
        if (window.renderWeekTimeline) renderWeekTimeline();
        if (window.recalculateStatistics) recalculateStatistics();
    } catch (err) {
        console.error('Error refreshing week timeline data:', err);
    }
}

// Refreshes activities and time entries, applies pre-merging filters, and updates UI
async function refreshData() {
    if (state.currentView === 'timeline' && state.timelineMode === 'week') {
        await refreshWeekData();
        return;
    }

    const dateStr = getFormattedDate(state.currentDate);
    try {
        const [, resActivities, resTimeEntries] = await Promise.all([
            refreshTrackingStatus(),
            fetch(`${API_BASE}/activities?date=${dateStr}`),
            fetch(`${API_BASE}/time-entries?date=${dateStr}`)
        ]);

        const rawActivities = await resActivities.json();
        
        // 1. Pre-merge consecutive raw segments of identical app & title within 5s
        const preMergedActivities = preMergeActivities(rawActivities);

        // Keep the full captured stream for summaries, details, and timeline ownership.
        state.timelineActivities = preMergedActivities;
        state.activities = preMergedActivities;
        
        state.timeEntries = await resTimeEntries.json();
        
        // Redraw components
        if (window.renderTimelineGrids) renderTimelineGrids();
        if (window.renderMemoryAidActivities) renderMemoryAidActivities();
        if (window.renderLoggedTimeEntries) renderLoggedTimeEntries();
        if (window.recalculateStatistics) recalculateStatistics();
        
        if (state.currentView === 'projects' && window.renderProjectsPage) {
            renderProjectsPage();
        }
    } catch (err) {
        console.error('Error refreshing backend data:', err);
    }
}

// Bind to window
window.fetchProjects = fetchProjects;
window.populateProjectDropdowns = populateProjectDropdowns;
window.fetchRules = fetchRules;
window.fetchTrackingExclusions = fetchTrackingExclusions;
window.updateTrackingStatusIndicator = updateTrackingStatusIndicator;
window.preMergeActivities = preMergeActivities;
window.refreshWeekData = refreshWeekData;
window.refreshData = refreshData;
