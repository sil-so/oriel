// Keep both timeline panes on the same row without depending on paired scroll events.
function syncScrollPosition(source, target) {
    if (!source || !target) return;
    const nextTop = source.scrollTop;
    if (Math.abs(target.scrollTop - nextTop) > 0.5) {
        target.scrollTop = nextTop;
    }
}

function createScrollSyncScheduler() {
    let framePending = false;
    let pendingSource = null;
    let pendingTarget = null;
    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback) => (typeof setTimeout === 'function' ? setTimeout(callback, 0) : callback());

    return (source, target) => {
        pendingSource = source;
        pendingTarget = target;
        if (framePending) return;

        framePending = true;
        scheduleFrame(() => {
            framePending = false;
            const sourceToSync = pendingSource;
            const targetToSync = pendingTarget;
            pendingSource = null;
            pendingTarget = null;
            syncScrollPosition(sourceToSync, targetToSync);
        });
    };
}

function setupScrollSync() {
    const elMemAid = DOM.elMemAidScroll;
    const elTimeEntries = DOM.elTimeEntriesScroll;

    if (elMemAid && elTimeEntries) {
        const scheduleSync = createScrollSyncScheduler();
        elMemAid.addEventListener('scroll', () => scheduleSync(elMemAid, elTimeEntries), { passive: true });
        elTimeEntries.addEventListener('scroll', () => scheduleSync(elTimeEntries, elMemAid), { passive: true });
    }
}

// Center current time in timelines immediately
function jumpToCurrentTime() {
    const elMemAid = DOM.elMemAidScroll;
    const elTimeEntries = DOM.elTimeEntriesScroll;
    if (!elMemAid && !elTimeEntries) return;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const dateStartOfDay = new Date(state.currentDate || now).setHours(0,0,0,0);
    const targetTime = dateStartOfDay + currentMinutes * 60 * 1000;
    const targetY = typeof window.getTimelineDisplayTopForTime === 'function'
        ? window.getTimelineDisplayTopForTime(targetTime, { dateStartOfDay, zoom: state.zoom })
        : (currentMinutes / state.zoom) * 40;
    const containerHeight = (elMemAid || elTimeEntries).clientHeight;
    const scrollTop = Math.max(0, targetY - (containerHeight / 2));

    for (const el of [elMemAid, elTimeEntries]) {
        if (!el) continue;
        el.scrollTop = scrollTop;
    }
}

// Bind to window
window.syncScrollPosition = syncScrollPosition;
window.createScrollSyncScheduler = createScrollSyncScheduler;
window.setupScrollSync = setupScrollSync;
window.jumpToCurrentTime = jumpToCurrentTime;
