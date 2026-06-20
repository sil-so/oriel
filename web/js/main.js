// Binds zoom controls and custom dropdown handling
function setupZoomDropdown() {
    const elZoomBtn = document.getElementById('zoom-dropdown-btn');
    const elZoomMenu = document.getElementById('zoom-dropdown-menu');
    const elZoomCaret = document.getElementById('zoom-dropdown-caret');
    const elZoomLabel = document.getElementById('zoom-dropdown-label');

    if (elZoomBtn && elZoomMenu) {
        elZoomBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = elZoomMenu.classList.contains('opacity-100');
            if (isOpen) {
                elZoomMenu.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
                elZoomMenu.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
                if (elZoomCaret) elZoomCaret.classList.remove('rotate-180');
            } else {
                elZoomMenu.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
                elZoomMenu.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
                if (elZoomCaret) elZoomCaret.classList.add('rotate-180');
            }
        });

        // Handle option clicks
        elZoomMenu.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newZoom = parseInt(btn.getAttribute('data-value'), 10);
                const oldZoom = state.zoom;
                const isWeekMode = state.timelineMode === 'week';
                const scrollPane = isWeekMode ? DOM.elWeekTimelineContainer : DOM.elMemAidScroll;
                
                // Centering calculation
                const scrollTopBefore = scrollPane?.scrollTop || 0;
                const viewportHeight = scrollPane?.clientHeight || DOM.elMemAidScroll?.clientHeight || 0;
                const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
                const viewportCenterMs = isWeekMode
                    ? dateStartOfDay + (((scrollTopBefore + viewportHeight / 2) / 40) * oldZoom * 60 * 1000)
                    : getDayTimelineViewportCenterMs(scrollPane, viewportHeight, oldZoom);

                state.zoom = newZoom;
                
                // Update checkmark states and text
                if (elZoomLabel) elZoomLabel.textContent = btn.querySelector('span').textContent;
                
                elZoomMenu.querySelectorAll('button').forEach(b => {
                    const check = b.querySelector('.menu-option-check');
                    if (b === btn) {
                        b.classList.add('is-selected');
                        if (check) {
                            check.classList.add('is-visible');
                        }
                    } else {
                        b.classList.remove('is-selected');
                        if (check) {
                            check.classList.remove('is-visible');
                        }
                    }
                });

                // Close menu
                elZoomMenu.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
                elZoomMenu.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
                if (elZoomCaret) elZoomCaret.classList.remove('rotate-180');

                // Redraw
                if (isWeekMode) {
                    renderWeekTimelineGrids();
                    renderWeekTimeline();
                } else {
                    renderTimelineGrids();
                    renderMemoryAidActivities();
                    renderLoggedTimeEntries();
                }

                const newScrollTop = isWeekMode
                    ? ((((viewportCenterMs - dateStartOfDay) / (60 * 1000)) * 40) / state.zoom) - (viewportHeight / 2)
                    : (typeof window.getTimelineDisplayTopForTime === 'function'
                        ? window.getTimelineDisplayTopForTime(viewportCenterMs, {
                            dateStartOfDay,
                            zoom: state.zoom
                        }) - (viewportHeight / 2)
                        : ((((viewportCenterMs - dateStartOfDay) / (60 * 1000)) * 40) / state.zoom) - (viewportHeight / 2));
                if (isWeekMode) {
                    if (scrollPane) scrollPane.scrollTop = newScrollTop;
                } else {
                    DOM.elMemAidScroll.scrollTop = newScrollTop;
                    DOM.elTimeEntriesScroll.scrollTop = newScrollTop;
                }
            });
        });

        // Close when clicking outside
        document.addEventListener('click', () => {
            if (elZoomMenu.classList.contains('opacity-100')) {
                elZoomMenu.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
                elZoomMenu.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
                if (elZoomCaret) elZoomCaret.classList.remove('rotate-180');
            }
        });
    }
}

let customSelectsInitialized = false;
let customSelectIdCounter = 0;
let settingsTooltipsInitialized = false;

function getSelectedCustomOption(select) {
    return Array.from(select.options || []).find(option => option.value === select.value)
        || select.options?.[select.selectedIndex]
        || select.options?.[0]
        || null;
}

function closeCustomSelect(wrapper) {
    if (!wrapper || !wrapper._customSelect) return;
    wrapper.classList.remove('is-open');
    wrapper._customSelect.button.setAttribute('aria-expanded', 'false');
    wrapper._customSelect.menu.classList.add('hidden');
    resetCustomSelectMenuPosition(wrapper._customSelect.menu);
}

function closeAllCustomSelects(exceptWrapper = null) {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('.custom-select-wrapper.is-open').forEach(wrapper => {
        if (wrapper !== exceptWrapper) closeCustomSelect(wrapper);
    });
}

let appContextMenu = null;
let appContextMenuBlock = null;
let appContextMenuBound = false;

function getContextMenuTimeEntryIds(blockEl) {
    const groupIds = typeof getTimeEntryGroupIds === 'function'
        ? getTimeEntryGroupIds(blockEl)
        : [];
    if (groupIds.length > 0) return groupIds;

    const entryId = blockEl?.dataset?.id;
    return entryId ? [entryId] : [];
}

async function deleteTimeEntriesByIds(entryIds) {
    const ids = Array.isArray(entryIds) ? entryIds.filter(Boolean) : [];
    if (ids.length === 0) return;

    const responses = await Promise.all(ids.map(entryId => (
        fetch(`${API_BASE}/time-entries/${entryId}`, { method: 'DELETE' })
    )));
    if (responses.every(response => response.ok)) {
        await refreshData();
    } else {
        alert('Failed to delete time entry');
    }
}

function closeAppContextMenu() {
    appContextMenuBlock = null;
    appContextMenu?.classList?.add('hidden');
}

function createContextMenuButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-option app-context-menu__item';
    button.textContent = label;
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', event => {
        event.stopPropagation?.();
        onClick();
    });
    return button;
}

function ensureAppContextMenu() {
    if (appContextMenu) return appContextMenu;

    const menu = document.createElement('div');
    menu.className = 'app-context-menu popover hidden';
    menu.classList?.add('app-context-menu', 'popover', 'hidden');
    menu.setAttribute('role', 'menu');
    menu.appendChild(createContextMenuButton('Edit Time Entry', () => {
        const block = appContextMenuBlock;
        closeAppContextMenu();
        if (block && typeof openTimeEntryBlockEditor === 'function') {
            openTimeEntryBlockEditor(block);
        }
    }));
    menu.appendChild(createContextMenuButton('Delete Time Entry', () => {
        const ids = getContextMenuTimeEntryIds(appContextMenuBlock);
        closeAppContextMenu();
        if (ids.length === 0) return;

        const message = ids.length > 1
            ? `${ids.length} logged entries will be permanently removed.`
            : 'This logged entry will be permanently removed.';
        const onConfirm = async () => {
            try {
                await deleteTimeEntriesByIds(ids);
            } catch (error) {
                console.error('Error deleting entry:', error);
            }
        };

        if (typeof showCustomConfirm === 'function') {
            showCustomConfirm({
                title: 'Delete Time Entry',
                message,
                actionText: 'Delete',
                actionClass: 'button-danger',
                onConfirm
            });
        } else if (confirm(message)) {
            onConfirm();
        }
    }));

    document.body?.appendChild(menu);
    appContextMenu = menu;
    return menu;
}

function showAppContextMenuForTimeEntry(blockEl, event) {
    const menu = ensureAppContextMenu();
    appContextMenuBlock = blockEl;

    const menuWidth = 188;
    const menuHeight = 88;
    const viewportWidth = Number.isFinite(window.innerWidth) ? window.innerWidth : event.clientX + menuWidth;
    const viewportHeight = Number.isFinite(window.innerHeight) ? window.innerHeight : event.clientY + menuHeight;
    const left = Math.max(8, Math.min(event.clientX, viewportWidth - menuWidth - 8));
    const top = Math.max(8, Math.min(event.clientY, viewportHeight - menuHeight - 8));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.classList.remove('hidden');
}

function setupAppContextMenu() {
    if (appContextMenuBound) return;
    appContextMenuBound = true;
    ensureAppContextMenu();

    document.addEventListener('contextmenu', event => {
        event.preventDefault?.();
        closeAppContextMenu();

        const block = event.target?.closest?.('.time-entry-block');
        if (!block) return;

        showAppContextMenuForTimeEntry(block, event);
    });

    document.addEventListener('click', event => {
        if (!appContextMenu || appContextMenu.classList.contains('hidden')) return;
        if (appContextMenu.contains?.(event.target)) return;
        closeAppContextMenu();
    });

}

function hasTimeRange(activity) {
    return Number.isFinite(activity?.start)
        && Number.isFinite(activity?.end)
        && activity.end > activity.start;
}

function timeEntryActivitySnapshot(activity) {
    const {
        sources,
        modalSourceActivities,
        modalAggregateGroupKey,
        modalGroupedReviewRow,
        alreadyLogged,
        loggedState,
        loggedEntryIds,
        ...snapshot
    } = activity || {};
    return snapshot;
}

function manualTimeEntryActivitySnapshot(activity) {
    const { autoAssigned, autoAssignmentRuleId, ...snapshot } = timeEntryActivitySnapshot(activity);
    return snapshot;
}

function isActivityStreamAssignment(activity) {
    return activity?.assignmentSource === 'activity-stream';
}

function normalizeActivityStreamAssignmentForSave(activity) {
    const sourceActivities = getBulkAssignmentSourceActivities(activity);
    const sourceSnapshots = sourceActivities.map(source => {
        const sourceDuration = getActivityDurationMs(source);
        const sourceStart = Number.isFinite(source?.assignmentStart)
            ? source.assignmentStart
            : source?.start;
        const sourceEnd = Number.isFinite(source?.assignmentEnd) && source.assignmentEnd > sourceStart
            ? source.assignmentEnd
            : source?.end;

        if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart || sourceDuration <= 0) {
            return null;
        }

        return manualTimeEntryActivitySnapshot({
            ...source,
            start: sourceStart,
            end: sourceEnd,
            duration: sourceDuration,
            assignedDurationMs: sourceDuration,
            assignmentStart: sourceStart,
            assignmentEnd: sourceEnd,
            assignmentSource: 'activity-stream',
            assignmentModel: 'activity-stream-summary',
            assignmentDisplayZoom: Number.isFinite(activity?.assignmentDisplayZoom)
                ? activity.assignmentDisplayZoom
                : source.assignmentDisplayZoom
        });
    }).filter(Boolean);
    const sourceDuration = sourceSnapshots.reduce((total, source) => total + getActivityDurationMs(source), 0);
    const duration = getActivityDurationMs(activity) || sourceDuration;
    const start = Number.isFinite(activity?.assignmentStart)
        ? activity.assignmentStart
        : (Number.isFinite(activity?.assignmentDisplayStart)
            ? activity.assignmentDisplayStart
            : activity?.start);
    const end = Number.isFinite(activity?.assignmentEnd) && activity.assignmentEnd > start
        ? activity.assignmentEnd
        : (Number.isFinite(activity?.assignmentDisplayEnd) && activity.assignmentDisplayEnd > start
            ? activity.assignmentDisplayEnd
            : activity?.end);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || duration <= 0) {
        return timeEntryActivitySnapshot(activity);
    }

    return {
        ...manualTimeEntryActivitySnapshot(activity),
        start,
        end,
        duration,
        assignedDurationMs: duration,
        assignmentStart: start,
        assignmentEnd: end,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: Number.isFinite(activity?.assignmentDisplayZoom)
            ? activity.assignmentDisplayZoom
            : state.zoom,
        ...(sourceSnapshots.length > 0 ? { sources: sourceSnapshots } : {})
    };
}

function normalizeActivityForTimeEntrySave(activity) {
    return isActivityStreamAssignment(activity)
        ? normalizeActivityStreamAssignmentForSave(activity)
        : timeEntryActivitySnapshot(activity);
}

function shouldSaveSelectedModalActivityDurations() {
    return !window.isBulkAllocation
        && state.currentModalDurationMode === 'selected-activities';
}

function isAlreadyLoggedSelectionActivity(activity) {
    if (!activity) return false;
    if (activity.alreadyLogged === true || activity.loggedState === 'already-logged') return true;

    const sources = Array.isArray(activity.modalSourceActivities) && activity.modalSourceActivities.length > 0
        ? activity.modalSourceActivities
        : (Array.isArray(activity.sources) ? activity.sources : []);
    return sources.length > 0 && sources.every(isAlreadyLoggedSelectionActivity);
}

function shouldIncludeAlreadyLoggedActivityChanges() {
    return Boolean(window.editingTimeEntryId || state.modalIncludeAlreadyLoggedActivities);
}

function shouldSaveSelectionActivity(activity) {
    return shouldIncludeAlreadyLoggedActivityChanges()
        || !isAlreadyLoggedSelectionActivity(activity);
}

function normalizeSelectedModalActivityForTimeEntrySave(activity) {
    const snapshot = normalizeActivityForTimeEntrySave(activity);
    if (isActivityStreamAssignment(activity)) {
        return snapshot;
    }

    const duration = getActivityDurationMs(activity);
    if (duration <= 0) {
        return snapshot;
    }

    return {
        ...snapshot,
        duration,
        assignedDurationMs: duration
    };
}

function normalizeModalActivitiesForTimeEntrySave(activities) {
    const normalizer = shouldSaveSelectedModalActivityDurations()
        ? normalizeSelectedModalActivityForTimeEntrySave
        : normalizeActivityForTimeEntrySave;
    return (activities || [])
        .filter(shouldSaveSelectionActivity)
        .map(normalizer);
}

function getModalSelectedActivitiesDurationMs(activities) {
    return (activities || []).reduce((total, activity) => total + getActivityDurationMs(activity), 0);
}

function getActivityDurationMs(activity) {
    const assignedDuration = Number(activity?.assignedDurationMs);
    if (Number.isFinite(assignedDuration) && assignedDuration > 0) {
        return assignedDuration;
    }
    if (Number.isFinite(activity?.duration) && activity.duration > 0) {
        return activity.duration;
    }
    if (hasTimeRange(activity)) {
        return activity.end - activity.start;
    }
    return 0;
}

function getBulkAssignmentSourceActivities(activity) {
    if (Array.isArray(activity?.modalSourceActivities) && activity.modalSourceActivities.length > 0) {
        return activity.modalSourceActivities.filter(hasTimeRange);
    }
    if (Array.isArray(activity?.sources) && activity.sources.length > 0) {
        return activity.sources.filter(hasTimeRange);
    }
    return [];
}

function buildSourceBackedBulkActivitySnapshots(activity) {
    return getBulkAssignmentSourceActivities(activity).filter(shouldSaveSelectionActivity).map(source => {
        const duration = getActivityDurationMs(source);
        if (duration <= 0) return null;
        return normalizeActivityStreamAssignmentForSave({
            ...activity,
            ...source,
            modalSourceActivities: source.modalSourceActivities,
            title: source.title || activity.title,
            app: source.app || activity.app,
            url: source.url || activity.url || '',
            appPath: source.appPath || activity.appPath || '',
            bundleId: source.bundleId || activity.bundleId || '',
            start: source.start,
            end: source.end,
            duration,
            assignedDurationMs: duration,
            assignmentStart: source.start,
            assignmentEnd: source.end,
            assignmentSource: 'activity-stream',
            assignmentModel: activity.assignmentModel || source.assignmentModel,
            assignmentDisplayZoom: Number.isFinite(activity?.assignmentDisplayZoom)
                ? activity.assignmentDisplayZoom
                : source.assignmentDisplayZoom
        });
    }).filter(activity => activity && hasTimeRange(activity));
}

function collectSummarizedActivityOverlaps(startMs, endMs) {
    const blockOverlaps = [];
    for (const act of state.activities || []) {
        const overlapStart = Math.max(startMs, act.start);
        const overlapEnd = Math.min(endMs, act.end);
        if (overlapEnd > overlapStart) {
            blockOverlaps.push({ ...act, duration: (overlapEnd - overlapStart) });
        }
    }

    return typeof window.summarizeActivityOverlaps === 'function'
        ? summarizeActivityOverlaps(blockOverlaps)
        : blockOverlaps;
}

function buildManualTimeEntryUpdatePayload(entry, startMs, endMs, activities) {
    return {
        start: startMs,
        end: endMs,
        description: entry?.description || '',
        projectId: entry?.projectId || '',
        taskId: entry?.taskId || '',
        billable: Boolean(entry?.billable),
        createdBy: 'manual',
        autoRuleId: '',
        activities: (activities || []).map(normalizeSelectedModalActivityForTimeEntrySave)
    };
}

function getBulkTimeEntryActivities(activity) {
    if (!shouldSaveSelectionActivity(activity)) return [];

    if (isActivityStreamAssignment(activity)) {
        if (activity?.modalGroupedReviewRow) {
            const groupedSnapshots = buildSourceBackedBulkActivitySnapshots(activity);
            if (groupedSnapshots.length > 0) return groupedSnapshots;
        }
        const snapshot = normalizeActivityStreamAssignmentForSave(activity);
        return hasTimeRange(snapshot) ? [snapshot] : [];
    }

    const sourceActivities = Array.isArray(activity?.sources)
        ? activity.sources.filter(hasTimeRange).map(timeEntryActivitySnapshot)
        : [];

    if (sourceActivities.length > 0) {
        const duration = getActivityDurationMs(activity) || sourceActivities.reduce((total, source) => (
            total + getActivityDurationMs(source)
        ), 0);
        const firstSourceStart = Math.min(...sourceActivities.map(source => source.start));
        const start = Number.isFinite(activity?.assignmentStart)
            ? activity.assignmentStart
            : (Number.isFinite(activity?.start) ? activity.start : firstSourceStart);
        const end = Number.isFinite(activity?.assignmentEnd) && activity.assignmentEnd > start
            ? activity.assignmentEnd
            : start + duration;

        if (!Number.isFinite(start) || duration <= 0) {
            return [];
        }

        return [timeEntryActivitySnapshot({
            ...activity,
            start,
            end,
            duration,
            assignedDurationMs: duration
        })];
    }

    return hasTimeRange(activity) ? [timeEntryActivitySnapshot(activity)] : [];
}

function buildBulkTimeEntryPayloads({ start, end, description, projectId, taskId, billable, activities }) {
    const timedActivities = (activities || [])
        .flatMap(getBulkTimeEntryActivities)
        .sort((first, second) => first.start - second.start);

    if (timedActivities.length === 0) {
        return shouldIncludeAlreadyLoggedActivityChanges()
            ? [{ start, end, description, projectId, taskId, billable, activities }]
            : [];
    }

    return timedActivities.map(activity => ({
        start: activity.start,
        end: activity.end,
        description,
        projectId,
        taskId,
        billable,
        activities: [activity]
    }));
}

function getActivitySegments(activity) {
    if (Array.isArray(activity?.sources) && activity.sources.length > 0) {
        return activity.sources.filter(hasTimeRange);
    }
    return hasTimeRange(activity) ? [activity] : [];
}

function getActivityDurationWithinRange(activity, rangeStart, rangeEnd) {
    return getActivitySegments(activity).reduce((total, segment) => {
        const start = Math.max(segment.start, rangeStart);
        const end = Math.min(segment.end, rangeEnd);
        return total + Math.max(0, end - start);
    }, 0);
}

function buildActivityStreamDisplayGroupKey(activity, rangeStart, rangeEnd) {
    const key = typeof getActivitySummaryKey === 'function'
        ? getActivitySummaryKey(activity)
        : `${activity?.app || ''}|||${activity?.title || ''}|||${activity?.url || activity?.bundleId || activity?.appPath || ''}`;
    return `activity-stream-row|||${key}|||${rangeStart}|||${rangeEnd}`;
}

function withActivityStreamDisplayBounds(activity, rangeStart, rangeEnd) {
    if (!activity || !Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
        return activity;
    }

    return {
        ...activity,
        assignmentDisplayStart: rangeStart,
        assignmentDisplayEnd: rangeEnd,
        assignmentDisplayGroupKey: activity.assignmentDisplayGroupKey || buildActivityStreamDisplayGroupKey(activity, rangeStart, rangeEnd),
        ...(Array.isArray(activity.sources) ? {
            sources: activity.sources.map(source => withActivityStreamDisplayBounds(source, rangeStart, rangeEnd))
        } : {}),
        ...(Array.isArray(activity.modalSourceActivities) ? {
            modalSourceActivities: activity.modalSourceActivities.map(source => withActivityStreamDisplayBounds(source, rangeStart, rangeEnd))
        } : {})
    };
}

function buildVisibleAssignmentActivities(blockOverlaps, selectedActivity, rangeStart, rangeEnd, options = {}) {
    const preserveDisplayBounds = options?.preserveDisplayBounds !== false;
    if (typeof window.buildActivityStreamSummaryAssignmentActivity === 'function') {
        const assignmentActivity = buildActivityStreamSummaryAssignmentActivity(
            selectedActivity,
            rangeStart,
            rangeEnd,
            state.zoom,
            preserveDisplayBounds
                ? {
                    assignmentDisplayStart: rangeStart,
                    assignmentDisplayEnd: rangeEnd
                }
                : {}
        );
        return assignmentActivity ? [assignmentActivity] : [];
    }

    const duration = getActivityDurationMs(selectedActivity)
        || getActivityDurationWithinRange(selectedActivity, rangeStart, rangeEnd);
    if (duration <= 0) return [];

    const assignmentActivity = timeEntryActivitySnapshot({
        ...selectedActivity,
        start: rangeStart,
        end: rangeEnd,
        duration,
        assignedDurationMs: duration,
        assignmentStart: rangeStart,
        assignmentEnd: rangeEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: state.zoom
    });
    return [preserveDisplayBounds
        ? withActivityStreamDisplayBounds(assignmentActivity, rangeStart, rangeEnd)
        : assignmentActivity];
}

function getActivityStreamSessionKeyForAssignment(activity) {
    if (typeof getActivityStreamSessionKey === 'function') return getActivityStreamSessionKey(activity);
    if (typeof getActivitySimilarityKey === 'function') {
        const similarityKey = getActivitySimilarityKey(activity);
        if (similarityKey) return similarityKey;
    }
    return typeof getActivitySummaryKey === 'function' ? getActivitySummaryKey(activity) : '';
}

function getSelectedActivityBlockSessionKey(blockEl) {
    return String(blockEl?.dataset?.sessionKey || '').trim();
}

function getAssignmentSourceCandidates(activity) {
    const sources = Array.isArray(activity?.sources) && activity.sources.length > 0
        ? activity.sources
        : [activity];
    return sources.filter(hasTimeRange);
}

function clipAssignmentSourceToRange(source, rangeStart, rangeEnd) {
    if (!source || !hasTimeRange(source)) return null;

    const start = Math.max(source.start, rangeStart);
    const end = Math.min(source.end, rangeEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

    const duration = end - start;
    return timeEntryActivitySnapshot({
        ...source,
        start,
        end,
        duration,
        assignedDurationMs: duration,
        assignmentStart: start,
        assignmentEnd: end,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: Number.isFinite(state?.zoom) ? state.zoom : undefined
    });
}

function buildVisibleRowUnitAssignmentActivity(blockData, sourceActivities, rangeStart, rangeEnd) {
    const clippedSources = [];
    const seenSources = new Set();

    (Array.isArray(sourceActivities) ? sourceActivities : []).forEach(activity => {
        getAssignmentSourceCandidates(activity).forEach(source => {
            const clippedSource = clipAssignmentSourceToRange(source, rangeStart, rangeEnd);
            if (!clippedSource) return;

            const sourceKey = typeof getActivitySourceKey === 'function'
                ? getActivitySourceKey(clippedSource)
                : `${clippedSource.app || ''}|||${clippedSource.title || ''}|||${clippedSource.url || ''}|||${clippedSource.start}|||${clippedSource.end}`;
            if (sourceKey && seenSources.has(sourceKey)) return;
            if (sourceKey) seenSources.add(sourceKey);
            clippedSources.push(clippedSource);
        });
    });

    if (clippedSources.length === 0) return null;

    clippedSources.sort((first, second) => first.start - second.start || first.end - second.end);
    const duration = clippedSources.reduce((total, source) => total + getActivityDurationMs(source), 0);
    if (duration <= 0) return null;

    const firstSource = clippedSources[0] || {};
    const rowActivity = {
        app: blockData?.app || firstSource.app || '',
        title: blockData?.title || firstSource.title || '',
        url: blockData?.url || firstSource.url || '',
        appPath: blockData?.appPath || firstSource.appPath || '',
        bundleId: blockData?.bundleId || firstSource.bundleId || '',
        start: rangeStart,
        end: rangeEnd,
        duration,
        assignedDurationMs: duration,
        assignmentStart: rangeStart,
        assignmentEnd: rangeEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: Number.isFinite(state?.zoom) ? state.zoom : undefined,
        sources: clippedSources,
        modalSourceActivities: clippedSources
    };
    const displayGroupKey = buildActivityStreamDisplayGroupKey(rowActivity, rangeStart, rangeEnd);

    return {
        ...rowActivity,
        assignmentDisplayStart: rangeStart,
        assignmentDisplayEnd: rangeEnd,
        assignmentDisplayGroupKey: displayGroupKey,
        modalAggregateGroupKey: displayGroupKey,
        sources: clippedSources.map(source => withActivityStreamDisplayBounds(source, rangeStart, rangeEnd)),
        modalSourceActivities: clippedSources.map(source => withActivityStreamDisplayBounds(source, rangeStart, rangeEnd))
    };
}

function getActivityBlockAssignmentOverlaps(blockEl) {
    if (typeof getActivityBlockDetailOverlaps === 'function') {
        const overlaps = getActivityBlockDetailOverlaps(blockEl);
        if (Array.isArray(overlaps)) return overlaps;
    }

    if (!blockEl?.dataset?.overlaps) return [];
    try {
        const parsed = JSON.parse(decodeURIComponent(blockEl.dataset.overlaps));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function getSelectedActivityBlockTimeRange(blockEl, fallbackStartCell, fallbackEndCell, dateStartOfDay) {
    if (typeof getActivityBlockTimeRange === 'function') {
        const range = getActivityBlockTimeRange(blockEl);
        if (Number.isFinite(range?.start) && Number.isFinite(range?.end) && range.end > range.start) {
            return range;
        }
    }

    const exactStart = Number(blockEl?.dataset?.startMs);
    const exactEnd = Number(blockEl?.dataset?.endMs);
    if (Number.isFinite(exactStart) && Number.isFinite(exactEnd) && exactEnd > exactStart) {
        return { start: exactStart, end: exactEnd };
    }

    return {
        start: dateStartOfDay + fallbackStartCell * state.zoom * 60 * 1000,
        end: dateStartOfDay + fallbackEndCell * state.zoom * 60 * 1000
    };
}

function getSelectedActivityBlockSimilarityScope(blockEl) {
    if (typeof getActivityBlockSelectedSimilarityScope === 'function') {
        return getActivityBlockSelectedSimilarityScope(blockEl);
    }

    return {
        mode: typeof getActivityBlockSelectedSimilarityMode === 'function'
            ? getActivityBlockSelectedSimilarityMode(blockEl)
            : '',
        matchKeys: typeof getActivityBlockSelectedSimilarityMatchKeys === 'function'
            ? getActivityBlockSelectedSimilarityMatchKeys(blockEl)
            : [],
        assignmentKeys: typeof getActivityBlockSelectedSimilarityKeys === 'function'
            ? getActivityBlockSelectedSimilarityKeys(blockEl)
            : []
    };
}

function getActivitySimilarityScopeMatchKey(activity, scope) {
    const mode = scope?.mode || '';
    const matchKeys = Array.isArray(scope?.matchKeys) ? scope.matchKeys.filter(Boolean) : [];
    if (!mode || matchKeys.length === 0 || typeof getActivitySimilarityKeyForMode !== 'function') return '';

    const matchKeySet = new Set(matchKeys);
    const directKey = getActivitySimilarityKeyForMode(activity, mode);
    if (directKey && matchKeySet.has(directKey)) return directKey;

    const sources = Array.isArray(activity?.sources) ? activity.sources : [];
    for (const source of sources) {
        const sourceKey = getActivitySimilarityKeyForMode(source, mode);
        if (sourceKey && matchKeySet.has(sourceKey)) return sourceKey;
    }

    return '';
}

function getAssignmentModalAggregateGroupKey(activity) {
    if (typeof getActivitySimilarityKeyForMode === 'function') {
        const titleKey = getActivitySimilarityKeyForMode(activity, 'app-title');
        if (titleKey) return titleKey;
    }

    const app = String(activity?.app || '').trim().toLowerCase();
    const title = String(
        typeof getActivityDisplayTitle === 'function'
            ? getActivityDisplayTitle(activity)
            : activity?.title || ''
    ).trim().toLowerCase();
    return app && title ? `${app}|||${title}` : app;
}

function applySimilarityScopeToAssignmentActivity(activity, scope) {
    const matchKey = getActivitySimilarityScopeMatchKey(activity, scope);
    if (!matchKey) return activity;

    return {
        ...activity,
        selectedSimilarityMode: scope.mode,
        selectedSimilarityMatchKey: matchKey,
        modalAggregateGroupKey: activity.modalAggregateGroupKey || getAssignmentModalAggregateGroupKey(activity)
    };
}

function decorateSelectedAssignmentActivity(activity) {
    return typeof window.withSelectedActivityLoggedState === 'function'
        ? withSelectedActivityLoggedState(activity)
        : activity;
}

function syncCustomSelect(select) {
    if (!select || !select._customSelect) return;
    const { button, label, menu } = select._customSelect;
    const selectedOption = getSelectedCustomOption(select);

    label.textContent = selectedOption ? selectedOption.textContent.trim() : '';
    button.disabled = Boolean(select.disabled);
    button.classList.toggle('is-disabled', Boolean(select.disabled));

    if (!menu.classList.contains('hidden')) {
        buildCustomSelectMenu(select);
    }
}

function buildCustomSelectMenu(select) {
    const custom = select._customSelect;
    if (!custom) return;

    custom.menu.replaceChildren();
    const options = Array.from(select.options || []);

    if (!options.length) {
        const emptyOption = document.createElement('button');
        emptyOption.type = 'button';
        emptyOption.className = 'menu-option custom-select-option';
        emptyOption.disabled = true;
        emptyOption.textContent = 'No options';
        custom.menu.appendChild(emptyOption);
        return;
    }

    options.forEach(option => {
        const menuOption = document.createElement('button');
        const isSelected = option.value === select.value;
        menuOption.type = 'button';
        menuOption.className = `menu-option custom-select-option${isSelected ? ' is-selected' : ''}`;
        menuOption.disabled = option.disabled;
        menuOption.setAttribute('role', 'option');
        menuOption.setAttribute('aria-selected', String(isSelected));

        const optionLabel = document.createElement('span');
        optionLabel.className = 'custom-select-option-label';
        optionLabel.textContent = option.textContent.trim();

        const check = document.createElement('i');
        check.className = `ph ph-check menu-option-check custom-select-option-check${isSelected ? ' is-visible' : ''}`;

        menuOption.appendChild(optionLabel);
        menuOption.appendChild(check);

        menuOption.addEventListener('click', event => {
            event.stopPropagation();
            if (option.disabled) return;

            select.value = option.value;
            syncCustomSelect(select);

            const EventCtor = select.ownerDocument?.defaultView?.Event || window.Event;
            select.dispatchEvent(new EventCtor('change', { bubbles: true }));

            closeCustomSelect(custom.wrapper);
            custom.button.focus();
        });

        menuOption.addEventListener('keydown', event => {
            const enabledOptions = Array.from(custom.menu.querySelectorAll('.custom-select-option:not(:disabled)'));
            const index = enabledOptions.indexOf(event.currentTarget);
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                enabledOptions[Math.min(index + 1, enabledOptions.length - 1)]?.focus();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                enabledOptions[Math.max(index - 1, 0)]?.focus();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closeCustomSelect(custom.wrapper);
                custom.button.focus();
            }
        });

        custom.menu.appendChild(menuOption);
    });
}

function resetCustomSelectMenuPosition(menu) {
    if (!menu?.style) return;
    ['position', 'left', 'right', 'top', 'bottom', 'width', 'maxHeight'].forEach(prop => {
        menu.style[prop] = '';
    });
}

function positionCustomSelectMenu(select) {
    const custom = select?._customSelect;
    if (!custom?.button || !custom?.menu) return;

    const rect = custom.button.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    const gap = 4;
    const viewportMargin = 12;
    const belowSpace = viewportHeight - rect.bottom - viewportMargin;
    const aboveSpace = rect.top - viewportMargin;
    const openUpward = belowSpace < 140 && aboveSpace > belowSpace;

    custom.menu.style.position = 'fixed';
    custom.menu.style.left = `${Math.max(viewportMargin, rect.left)}px`;
    custom.menu.style.right = 'auto';
    custom.menu.style.width = `${rect.width}px`;
    custom.menu.style.maxHeight = `${Math.max(96, Math.min(220, openUpward ? aboveSpace - gap : belowSpace - gap))}px`;

    if (openUpward) {
        custom.menu.style.top = 'auto';
        custom.menu.style.bottom = `${Math.max(viewportMargin, viewportHeight - rect.top + gap)}px`;
    } else {
        custom.menu.style.top = `${rect.bottom + gap}px`;
        custom.menu.style.bottom = 'auto';
    }
}

function openCustomSelect(select) {
    const custom = select._customSelect;
    if (!custom || select.disabled) return;

    const isOpen = custom.wrapper.classList.contains('is-open');
    closeAllCustomSelects(custom.wrapper);

    if (isOpen) {
        closeCustomSelect(custom.wrapper);
        return;
    }

    syncCustomSelect(select);
    buildCustomSelectMenu(select);
    positionCustomSelectMenu(select);
    custom.wrapper.classList.add('is-open');
    custom.button.setAttribute('aria-expanded', 'true');
    custom.menu.classList.remove('hidden');

    const selectedMenuOption = custom.menu.querySelector('.custom-select-option.is-selected:not(:disabled)')
        || custom.menu.querySelector('.custom-select-option:not(:disabled)');
    selectedMenuOption?.focus({ preventScroll: true });
}

function enhanceCustomSelect(select) {
    const wrapper = select.closest?.('.custom-select-wrapper');
    if (!wrapper) return;

    if (select._customSelect) {
        syncCustomSelect(select);
        return;
    }

    const menuId = `${select.id || 'custom-select'}-menu-${customSelectIdCounter++}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'custom-select-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', menuId);

    const label = document.createElement('span');
    label.className = 'custom-select-button-label';
    button.appendChild(label);

    const menu = document.createElement('div');
    menu.id = menuId;
    menu.className = 'custom-select-menu app-scrollbar-safe popover hidden';
    menu.setAttribute('role', 'listbox');

    wrapper.insertBefore(button, select.nextSibling);
    wrapper.appendChild(menu);

    select.classList.add('custom-select--native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;

    wrapper._customSelect = { wrapper, select, button, label, menu };
    select._customSelect = wrapper._customSelect;

    button.addEventListener('click', event => {
        event.stopPropagation();
        openCustomSelect(select);
    });

    button.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openCustomSelect(select);
        } else if (event.key === 'Escape') {
            closeCustomSelect(wrapper);
        }
    });

    select.addEventListener('change', () => syncCustomSelect(select));

    if (typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => syncCustomSelect(select));
        observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true });
    }

    syncCustomSelect(select);
}

function refreshCustomSelects(target = null) {
    if (!document.querySelectorAll) return;

    let root = target;
    if (typeof target === 'string') root = document.getElementById(target);

    let selects = [];
    if (!root) {
        selects = Array.from(document.querySelectorAll('select.custom-select'));
    } else if (root.tagName && root.tagName.toLowerCase() === 'select') {
        selects = [root];
    } else if (typeof root.querySelectorAll === 'function') {
        selects = Array.from(root.querySelectorAll('select.custom-select'));
    }

    selects.forEach(select => {
        enhanceCustomSelect(select);
        syncCustomSelect(select);
    });
}
window.refreshCustomSelects = refreshCustomSelects;

function setupCustomSelects() {
    refreshCustomSelects();

    if (customSelectsInitialized || !document.addEventListener) return;
    customSelectsInitialized = true;

    document.addEventListener('click', event => {
        if (!event.target.closest?.('.custom-select-wrapper')) {
            closeAllCustomSelects();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeAllCustomSelects();
    });
}

// Binds custom project creation rates type toggles
function setupProjectRatesToggles() {
    const rateTypeSelect = document.getElementById('project-rate-type');
    if (rateTypeSelect) {
        rateTypeSelect.addEventListener('change', toggleProjectRateFields);
    }
}

const datePickerState = {
    viewedMonth: null,
    activeKey: null,
    activeTrigger: null
};

const datePickerConfigs = {
    header: {
        triggerId: 'date-picker-trigger',
        popoverId: 'date-picker-popover',
        prevId: 'date-picker-prev-month',
        nextId: 'date-picker-next-month',
        closeId: 'date-picker-clear',
        todayId: 'date-picker-today',
        monthLabelId: 'date-picker-month-label',
        weekdaysId: 'date-picker-weekdays',
        daysId: 'date-picker-days',
        getSelectedDate: () => state.currentDate,
        onSelect: async date => {
            state.currentDate = date;
            await refreshCurrentDateView();
        },
        onToday: async () => {
            await goToToday({ closePicker: true });
        }
    },
    projectManual: {
        triggerId: 'proj-details-manual-date-trigger',
        popoverId: 'proj-details-manual-date-picker-popover',
        prevId: 'proj-details-manual-date-picker-prev-month',
        nextId: 'proj-details-manual-date-picker-next-month',
        closeId: 'proj-details-manual-date-picker-clear',
        todayId: 'proj-details-manual-date-picker-today',
        monthLabelId: 'proj-details-manual-date-picker-month-label',
        weekdaysId: 'proj-details-manual-date-picker-weekdays',
        daysId: 'proj-details-manual-date-picker-days',
        getSelectedDate: () => getProjectManualDate(),
        onSelect: async date => {
            setProjectManualDate(date);
            closeDatePicker();
        },
        onToday: async () => {
            setProjectManualDate(new Date());
            closeDatePicker();
        }
    }
};

const aiInsightsState = {
    isLoading: false,
    rows: [],
    generatingKey: '',
    selectedYear: '',
    detailRowKey: ''
};

function requestJumpToCurrentTime() {
    if (typeof window.jumpToCurrentTime === 'function') {
        window.jumpToCurrentTime();
    }
}

function requestTimelineCurrentJump() {
    if (state.timelineMode === 'week') {
        if (typeof window.jumpToCurrentWeekTime === 'function') {
            window.jumpToCurrentWeekTime();
        }
        return;
    }
    requestJumpToCurrentTime();
}

async function goToToday({ closePicker = false } = {}) {
    state.currentDate = new Date();
    await refreshCurrentDateView({ jumpToCurrent: true });
    if (closePicker) {
        closeDatePicker();
    }
}

function clearTimelineSelectionForDateChange() {
    if (typeof clearSelectedActivityBlocks === 'function') {
        clearSelectedActivityBlocks();
    } else {
        state.selectedActivities?.clear();
        state.selectedActivityScopes?.clear?.();
    }

    if (typeof dismissActivityDetailsPopup === 'function') {
        dismissActivityDetailsPopup();
    }

    if (typeof handleAiDateChanged === 'function') {
        handleAiDateChanged();
    }
}

function aiInsightsDateString() {
    const date = typeof state !== 'undefined' && state.currentDate ? state.currentDate : new Date();
    if (typeof getFormattedDate === 'function') return getFormattedDate(date);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function syncAiInsightsDateControl() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const date = aiInsightsDateString();
    const summaryDate = document.getElementById('ai-insights-summary-date');
    const summaryDateDisplay = document.getElementById('ai-insights-summary-date-display');
    if (summaryDate) summaryDate.value = date;
    if (summaryDateDisplay && typeof state !== 'undefined' && state.currentDate) {
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        summaryDateDisplay.textContent = state.currentDate.toLocaleDateString('en-GB', options);
    }
    if (typeof DOM !== 'undefined' && DOM.elDatePickerInput) DOM.elDatePickerInput.value = date;
}

async function refreshCurrentDateView({ jumpToCurrent = false } = {}) {
    clearTimelineSelectionForDateChange();
    setupDateDisplay();
    syncAiInsightsDateControl();

    if (state.currentView === 'aiInsights') {
        if (typeof window.refreshAiInsights === 'function') {
            await window.refreshAiInsights();
        }
        return;
    }

    await refreshData();
    if (jumpToCurrent) {
        requestTimelineCurrentJump();
    }
}

function syncTimelineModeControls() {
    const isWeek = state.timelineMode === 'week';

    DOM.elTimelineModeDay?.classList.toggle('timeline-mode-option--active', !isWeek);
    DOM.elTimelineModeWeek?.classList.toggle('timeline-mode-option--active', isWeek);
    DOM.elTimelineModeDay?.classList.toggle('app-tab--active', !isWeek);
    DOM.elTimelineModeWeek?.classList.toggle('app-tab--active', isWeek);
    DOM.elTimelineModeDay?.setAttribute('aria-checked', String(!isWeek));
    DOM.elTimelineModeWeek?.setAttribute('aria-checked', String(isWeek));
    DOM.elSchedulerWorkspace?.classList.toggle('timeline-mode-week', isWeek);
    DOM.elWeekTimelineWorkspace?.classList.toggle('hidden', !isWeek);
}

async function setTimelineMode(mode, { refresh = true } = {}) {
    const nextMode = mode === 'week' ? 'week' : 'day';
    const changed = state.timelineMode !== nextMode;
    state.timelineMode = nextMode;
    syncTimelineModeControls();

    if (changed) {
        clearTimelineSelectionForDateChange();
        setupDateDisplay();
        syncAiInsightsDateControl();
    }

    if (refresh) {
        await refreshData();
        requestTimelineCurrentJump();
    }
}

function setWorkTimesCollapsed(collapsed) {
    const workspace = document.getElementById('scheduler-workspace');
    const sidebar = document.getElementById('work-times-sidebar');
    const toggle = document.getElementById('btn-toggle-work-times');
    if (!workspace || !sidebar || !toggle) return;

    sidebar.classList.toggle('is-collapsed', collapsed);
    workspace.classList.toggle('is-work-times-collapsed', collapsed);
    toggle.setAttribute('aria-pressed', String(collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand Sidebar' : 'Collapse Sidebar');
    toggle.setAttribute('title', collapsed ? 'Expand Sidebar' : 'Collapse Sidebar');
}

function syncHeaderActionsForView() {
    const toggle = document.getElementById('btn-toggle-work-times');
    if (!toggle) return;
    const hidden = state.currentView !== 'timeline';
    toggle.hidden = hidden;
    toggle.classList.toggle('hidden', hidden);
}

function setupWorkTimesToggle() {
    const toggle = document.getElementById('btn-toggle-work-times');
    if (!toggle) return;

    const initialCollapsed = localStorage.getItem('workTimesCollapsed') === 'true';
    setWorkTimesCollapsed(initialCollapsed);

    toggle.addEventListener('click', () => {
        const sidebar = document.getElementById('work-times-sidebar');
        const collapsed = !sidebar?.classList.contains('is-collapsed');
        setWorkTimesCollapsed(collapsed);
        localStorage.setItem('workTimesCollapsed', String(collapsed));
    });
}

function hideSettingsTooltip() {
    const tooltip = document.getElementById('settings-floating-tooltip');
    if (!tooltip) return;
    tooltip.classList.add('hidden');
    tooltip.textContent = '';
}

function buildSettingsTooltipContent(tooltip, trigger) {
    const text = String(trigger?.dataset?.settingsTooltip || '').trim();
    const title = String(trigger?.dataset?.settingsTooltipTitle || '').trim();
    const list = String(trigger?.dataset?.settingsTooltipList || '').trim();
    const note = String(trigger?.dataset?.settingsTooltipNote || '').trim();

    tooltip.textContent = '';

    if (title || list || note) {
        if (title) {
            const titleEl = document.createElement('div');
            titleEl.className = 'settings-tooltip-title';
            titleEl.textContent = title;
            tooltip.appendChild(titleEl);
        }

        const rows = list
            .split(/\n+/)
            .map(row => row.trim())
            .filter(Boolean)
            .map(row => {
                const separatorIndex = row.indexOf('|');
                if (separatorIndex === -1) {
                    return { term: '', detail: row };
                }
                return {
                    term: row.slice(0, separatorIndex).trim(),
                    detail: row.slice(separatorIndex + 1).trim()
                };
            })
            .filter(row => row.term || row.detail);

        if (rows.length) {
            const listEl = document.createElement('div');
            listEl.className = 'settings-tooltip-list';
            rows.forEach(row => {
                const rowEl = document.createElement('div');
                rowEl.className = 'settings-tooltip-row';

                const termEl = document.createElement('span');
                termEl.className = 'settings-tooltip-term';
                termEl.textContent = row.term;

                const detailEl = document.createElement('span');
                detailEl.className = 'settings-tooltip-detail';
                detailEl.textContent = row.detail;

                rowEl.append(termEl, detailEl);
                listEl.appendChild(rowEl);
            });
            tooltip.appendChild(listEl);
        }

        if (note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'settings-tooltip-note';
            noteEl.textContent = note;
            tooltip.appendChild(noteEl);
        }

        return true;
    }

    if (!text) return false;
    tooltip.textContent = text;
    return true;
}

function showSettingsTooltip(trigger) {
    const tooltip = document.getElementById('settings-floating-tooltip');
    if (!tooltip || typeof trigger?.getBoundingClientRect !== 'function') return;

    if (!buildSettingsTooltipContent(tooltip, trigger)) return;
    tooltip.classList.remove('hidden');

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect?.() || { width: 260, height: 80 };
    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 1024;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 768;
    const margin = 12;
    const preferredLeft = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);
    const maxLeft = Math.max(margin, viewportWidth - tooltipRect.width - margin);
    const left = Math.min(Math.max(preferredLeft, margin), maxLeft);
    let top = triggerRect.top - tooltipRect.height - 8;
    if (top < margin) {
        top = triggerRect.bottom + 8;
    }
    top = Math.min(Math.max(top, margin), Math.max(margin, viewportHeight - tooltipRect.height - margin));

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
}

function settingsTooltipTriggerFromTarget(target) {
    return target?.closest?.('[data-settings-tooltip], [data-settings-tooltip-list], [data-settings-tooltip-note], [data-settings-tooltip-title]') || null;
}

function bindSettingsTooltips() {
    if (!settingsTooltipsInitialized) {
        settingsTooltipsInitialized = true;
        document.addEventListener('pointerover', event => {
            const trigger = settingsTooltipTriggerFromTarget(event.target);
            if (trigger) showSettingsTooltip(trigger);
        });
        document.addEventListener('pointerout', event => {
            const trigger = settingsTooltipTriggerFromTarget(event.target);
            if (!trigger) return;
            if (!event.relatedTarget || !trigger.contains?.(event.relatedTarget)) {
                hideSettingsTooltip();
            }
        });
        document.addEventListener('focusin', event => {
            const trigger = settingsTooltipTriggerFromTarget(event.target);
            if (trigger) showSettingsTooltip(trigger);
        });
        document.addEventListener('focusout', event => {
            if (settingsTooltipTriggerFromTarget(event.target)) hideSettingsTooltip();
        });
    }

    const settingsBody = document.getElementById('settings-modal-body');
    if (settingsBody && !settingsBody._settingsTooltipScrollBound) {
        settingsBody._settingsTooltipScrollBound = true;
        settingsBody.addEventListener('scroll', hideSettingsTooltip);
    }
}

function syncEmptyActivityRowsToggle() {
    const toggle = document.getElementById('btn-toggle-empty-activity-rows');
    if (!toggle) return;

    const enabled = Boolean(state.settings.hideEmptyActivityRows);
    toggle.classList.toggle('is-active', enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.setAttribute('aria-label', enabled ? 'Show Empty Rows' : 'Hide Empty Rows');
    toggle.setAttribute('title', enabled ? 'Show Empty Rows' : 'Hide Empty Rows');
}

function getDayTimelineViewportCenterMs(scrollPane, viewportHeight, zoom) {
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    const centerTop = (scrollPane?.scrollTop || 0) + (viewportHeight / 2);
    if (typeof window.getTimelineTimeForDisplayTop === 'function') {
        return window.getTimelineTimeForDisplayTop(centerTop, {
            dateStartOfDay,
            zoom
        });
    }

    const centerMinutes = (centerTop / 40) * zoom;
    return dateStartOfDay + centerMinutes * 60 * 1000;
}

function renderDayTimelinesPreservingCenter(centerMs = null) {
    const scrollPane = DOM.elMemAidScroll || DOM.elTimeEntriesScroll;
    const viewportHeight = scrollPane?.clientHeight || DOM.elTimeEntriesScroll?.clientHeight || 0;
    const preservedCenterMs = Number.isFinite(centerMs)
        ? centerMs
        : getDayTimelineViewportCenterMs(scrollPane, viewportHeight, state.zoom);
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);

    if (typeof renderTimelineGrids === 'function') renderTimelineGrids();
    if (typeof renderMemoryAidActivities === 'function') renderMemoryAidActivities();
    if (typeof renderLoggedTimeEntries === 'function') renderLoggedTimeEntries();

    const targetTop = typeof window.getTimelineDisplayTopForTime === 'function'
        ? window.getTimelineDisplayTopForTime(preservedCenterMs, { dateStartOfDay, zoom: state.zoom })
        : ((preservedCenterMs - dateStartOfDay) / (60 * 1000)) * (40 / state.zoom);
    const nextScrollTop = Math.max(0, targetTop - (viewportHeight / 2));

    for (const el of [DOM.elMemAidScroll, DOM.elTimeEntriesScroll]) {
        if (!el) continue;
        el.scrollTop = nextScrollTop;
    }
}

async function setHideEmptyActivityRows(enabled, { persist = true } = {}) {
    const shouldRenderDayTimelines = state.timelineMode !== 'week';
    const scrollPane = shouldRenderDayTimelines ? (DOM.elMemAidScroll || DOM.elTimeEntriesScroll) : null;
    const viewportHeight = scrollPane?.clientHeight || DOM.elTimeEntriesScroll?.clientHeight || 0;
    const preservedCenterMs = shouldRenderDayTimelines
        ? getDayTimelineViewportCenterMs(scrollPane, viewportHeight, state.zoom)
        : null;

    state.settings.hideEmptyActivityRows = Boolean(enabled);
    localStorage.setItem('hideEmptyActivityRows', String(state.settings.hideEmptyActivityRows));
    syncEmptyActivityRowsToggle();

    if (persist && window.OrielData && window.OrielData.isNative) {
        try {
            const nativeSettings = await window.OrielData.request('settings.update', {
                hideEmptyActivityRows: state.settings.hideEmptyActivityRows
            });
            Object.assign(state.settings, nativeSettings);
            syncEmptyActivityRowsToggle();
        } catch (error) {
            console.error('Error saving empty row preference:', error);
        }
    }

    if (shouldRenderDayTimelines) {
        renderDayTimelinesPreservingCenter(preservedCenterMs);
    }
}

function setupEmptyActivityRowsToggle() {
    const toggle = document.getElementById('btn-toggle-empty-activity-rows');
    if (!toggle) return;

    syncEmptyActivityRowsToggle();
    toggle.addEventListener('click', () => {
        return setHideEmptyActivityRows(!state.settings.hideEmptyActivityRows);
    });
}

function closeModalById(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal || modal.classList.contains('hidden')) return false;

    if (modalId === 'settings-modal') {
        hideSettingsTooltip();
    }

    if (modalId === 'time-entry-modal' && typeof closeTimeEntryModal === 'function') {
        closeTimeEntryModal();
    } else if (modalId === 'project-details-modal' && typeof window.closeProjectDetailsModal === 'function') {
        window.closeProjectDetailsModal();
    } else {
        modal.classList.add('hidden');
    }

    if (modalId === 'project-modal') {
        window.editingProjectId = null;
    }

    return true;
}

function closeTopModal() {
    const modalIds = [
        'confirm-modal',
        'project-details-modal',
        'ai-insights-detail-modal',
        'settings-modal',
        'rules-modal',
        'project-modal',
        'similar-modal',
        'time-entry-modal'
    ];

    for (const modalId of modalIds) {
        if (closeModalById(modalId)) return true;
    }
    return false;
}

function setupModalDismissalHandlers() {
    [
        'confirm-modal',
        'project-details-modal',
        'ai-insights-detail-modal',
        'settings-modal',
        'rules-modal',
        'project-modal',
        'similar-modal',
        'time-entry-modal'
    ].forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (!modal || modal._orielOutsideDismissBound) return;

        modal._orielOutsideDismissBound = true;
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeModalById(modalId);
            }
        });
    });
}

function clearSelectedActivityBlocks() {
    if (typeof clearActivitySelection === 'function') {
        clearActivitySelection();
        return;
    }

    state.selectedActivities.clear();
    state.selectedActivityScopes?.clear?.();
    if (typeof DOM === 'undefined') return;

    DOM.elItemsMemoryAid?.querySelectorAll('.activity-block.selected').forEach(el => {
        el.classList.remove('selected');
        const checkbox = el.querySelector('.activity-checkbox');
        const iconEl = el.querySelector('.activity-checkbox i');
        checkbox?.classList.remove('is-selected');
        if (iconEl) iconEl.className = 'ph ph-square text-base';
    });
    updateMultiSelectBar();
}

// Set up UI click event listeners
function setupMainEventListeners() {
    // Zoom and Project rates toggling triggers
    setupZoomDropdown();
    setupCustomSelects();
    setupProjectRatesToggles();
    setupWorkTimesToggle();
    setupEmptyActivityRowsToggle();
    setupModalDismissalHandlers();
    setupAppContextMenu();
    bindSettingsTooltips();

    // Auto-Assignment Rules Modal triggers
    const btnRules = document.getElementById('btn-rules');
    const rulesModal = document.getElementById('rules-modal');
    const rulesModalBtnClose = document.getElementById('rules-modal-btn-close');
    const ruleBtnSave = document.getElementById('rule-btn-save');

    if (btnRules) {
        btnRules.addEventListener('click', () => {
            const ruleProjSelect = document.getElementById('rule-project-select');
            if (ruleProjSelect) {
                ruleProjSelect.innerHTML = state.projects.map(p => 
                    `<option value="${p.id}">${p.name}</option>`
                ).join('');
                refreshCustomSelects(ruleProjSelect);
            }
            renderRulesList();
            rulesModal.classList.remove('hidden');
        });
    }

    if (rulesModalBtnClose) {
        rulesModalBtnClose.addEventListener('click', () => {
            rulesModal.classList.add('hidden');
        });
    }

    if (ruleBtnSave) {
        ruleBtnSave.addEventListener('click', async () => {
            const fieldSelect = document.getElementById('rule-field-select');
            const matchSelect = document.getElementById('rule-match-select');
            const patternInput = document.getElementById('rule-pattern-input');
            const projectSelect = document.getElementById('rule-project-select');

            const pattern = patternInput.value.trim();
            if (!pattern) return;

            const payload = {
                field: fieldSelect.value,
                matchType: matchSelect.value,
                pattern,
                projectId: projectSelect.value
            };

            try {
                const res = await fetch(`${API_BASE}/rules`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    patternInput.value = '';
                    await fetchRules();
                    renderRulesList();
                }
            } catch (e) {
                console.error('Error saving rule:', e);
            }
        });
    }

    // Settings Modal triggers
    const btnSettings = document.getElementById('btn-settings');
    const settingsModal = document.getElementById('settings-modal');
    const settingsModalBtnClose = document.getElementById('settings-modal-btn-close');
    const settingsThemeSelect = document.getElementById('settings-theme-select');
    const settingsLogoDevIcons = document.getElementById('settings-logo-dev-icons');
    const settingsLogoDevApiKeyInput = document.getElementById('settings-logo-dev-api-key-input');
    const settingsLogoDevKeyEditButton = document.getElementById('settings-logo-dev-key-edit-button');
    const settingsLogoDevKeySaveButton = document.getElementById('settings-logo-dev-key-save-button');
    const settingsLogoDevKeySaveLabel = document.getElementById('settings-logo-dev-key-save-label');
    const settingsLogoDevKeyCancelButton = document.getElementById('settings-logo-dev-key-cancel-button');
    const settingsLogoDevKeyDeleteButton = document.getElementById('settings-logo-dev-key-delete-button');
    const settingsLogoDevKeyFeedback = document.getElementById('settings-logo-dev-key-feedback');
    const settingsBtnPurge = document.getElementById('settings-btn-purge');
    const settingsExclusionField = document.getElementById('settings-exclusion-field');
    const settingsExclusionMatch = document.getElementById('settings-exclusion-match');
    const settingsExclusionPattern = document.getElementById('settings-exclusion-pattern');
    const settingsExclusionApplyHistory = document.getElementById('settings-exclusion-apply-history');
    const settingsExclusionAdd = document.getElementById('settings-exclusion-add');
    const settingsExclusionStatus = document.getElementById('settings-exclusion-status');
    const settingsExclusionsList = document.getElementById('settings-exclusions-list');
    const settingsTitleCleanupList = document.getElementById('settings-title-cleanup-list');
    const settingsTitleCleanupName = document.getElementById('settings-title-cleanup-name');
    const settingsTitleCleanupPattern = document.getElementById('settings-title-cleanup-pattern');
    const settingsTitleCleanupApp = document.getElementById('settings-title-cleanup-app');
    const settingsTitleCleanupUrl = document.getElementById('settings-title-cleanup-url');
    const settingsTitleCleanupAdd = document.getElementById('settings-title-cleanup-add');
    const settingsTitleCleanupResetDefaults = document.getElementById('settings-title-cleanup-reset-defaults');
    const settingsTitleCleanupStatus = document.getElementById('settings-title-cleanup-status');
    let logoDevKeySaved = false;
    let logoDevKeyEditMode = false;
    let logoDevKeyFeedbackTimer = null;
    let expandedTitleCleanupRuleId = null;

    const exclusionFieldLabels = {
        app: 'Application',
        title: 'Window Title',
        url: 'URL'
    };

    function setSettingsSection(section = 'general') {
        const nextSection = ['general', 'capture', 'ai', 'data'].includes(section) ? section : 'general';
        hideSettingsTooltip();
        document.querySelectorAll?.('[data-settings-section-button]')?.forEach(button => {
            const isActive = button.dataset.settingsSectionButton === nextSection;
            button.classList.toggle('is-active', isActive);
            button.classList.toggle('app-tab--active', isActive);
            button.setAttribute('aria-selected', String(isActive));
        });
        document.querySelectorAll?.('[data-settings-section-panel]')?.forEach(panel => {
            panel.classList.toggle('hidden', panel.dataset.settingsSectionPanel !== nextSection);
        });
        bindSettingsTooltips();
    }

    async function openSettingsModal({ section = 'general' } = {}) {
        if (window.OrielData && window.OrielData.isNative) {
            try {
                const nativeSettings = await window.OrielData.request('settings.get', {});
                const reconciledSettings = await reconcileTitleCleanupRulesFromLocalStorage(nativeSettings);
                Object.assign(state.settings, reconciledSettings);
                if (typeof window.applyTheme === 'function') {
                    window.applyTheme(state.settings.theme);
                }
                syncEmptyActivityRowsToggle();
            } catch (error) {
                console.error('Error fetching native settings:', error);
            }
        }
        await refreshLogoDevKeyStatus();
        if (typeof window.refreshAiSettingsStatus === 'function') {
            await window.refreshAiSettingsStatus();
        }
        syncSettingsControls();
        setSettingsSection(section);
        bindSettingsTooltips();
        if (settingsModal) {
            settingsModal.classList.remove('hidden');
        }
        if (typeof window.fetchTrackingExclusions === 'function') {
            await window.fetchTrackingExclusions();
            renderTrackingExclusions();
        }
    }
    window.openSettingsModal = openSettingsModal;

    function renderTrackingExclusions() {
        if (!settingsExclusionsList) return;
        settingsExclusionsList.replaceChildren();

        if (!state.trackingExclusions.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state empty-state--compact';
            empty.textContent = 'No tracking exclusions configured.';
            settingsExclusionsList.appendChild(empty);
            return;
        }

        state.trackingExclusions.forEach((exclusion) => {
            const row = document.createElement('div');
            row.className = 'surface-panel flex items-center justify-between gap-3 px-3 py-2';

            const description = document.createElement('span');
            description.className = 'text-[11px] text-gray-300 truncate';
            const fieldLabel = exclusionFieldLabels[exclusion.field] || exclusion.field;
            description.textContent = `${fieldLabel} ${exclusion.matchType} "${exclusion.pattern}"`;

            const removeButton = document.createElement('button');
            removeButton.className = 'text-gray-500 hover:text-red-400 transition shrink-0';
            removeButton.type = 'button';
            removeButton.title = 'Remove exclusion';
            removeButton.innerHTML = '<i class="ph ph-trash text-sm"></i>';
            removeButton.addEventListener('click', async () => {
                try {
                    const res = await fetch(`${API_BASE}/exclusions/${exclusion.id}`, { method: 'DELETE' });
                    if (res.ok && typeof window.fetchTrackingExclusions === 'function') {
                        await window.fetchTrackingExclusions();
                        renderTrackingExclusions();
                        await refreshData();
                    }
                } catch (err) {
                    console.error('Error deleting tracking exclusion:', err);
                }
            });

            row.appendChild(description);
            row.appendChild(removeButton);
            settingsExclusionsList.appendChild(row);
        });
    }
    window.renderTrackingExclusions = renderTrackingExclusions;

    function syncSettingsControls() {
        if (settingsThemeSelect) {
            settingsThemeSelect.value = state.settings.theme || document.documentElement.dataset.theme || 'graphite';
            refreshCustomSelects(settingsThemeSelect);
        }
        if (settingsLogoDevIcons) {
            settingsLogoDevIcons.checked = Boolean(state.settings.logoDevIconsEnabled);
        }
        state.settings.titleCleanupRules = normalizeSettingsTitleCleanupRules(state.settings.titleCleanupRules);
        renderTitleCleanupRules();
    }

    function setTrackingExclusionStatus(message) {
        if (!settingsExclusionStatus) return;
        const text = String(message || '').trim();
        settingsExclusionStatus.textContent = text;
        settingsExclusionStatus.classList.toggle('hidden', text.length === 0);
    }

    setTrackingExclusionStatus('');

    function normalizeSettingsTitleCleanupRule(rule) {
        if (typeof window.normalizeTitleCleanupRule === 'function') {
            return window.normalizeTitleCleanupRule(rule);
        }
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
        const id = String(rule.id || '').trim();
        const name = String(rule.name || '').trim();
        const pattern = String(rule.pattern || '').trim();
        if (!id || !name || !pattern) return null;
        return {
            id,
            name,
            enabled: rule.enabled !== false,
            pattern,
            appContains: String(rule.appContains || '').trim(),
            urlContains: String(rule.urlContains || '').trim()
        };
    }

    function normalizeSettingsTitleCleanupRules(rules) {
        if (typeof window.normalizeTitleCleanupRules === 'function') {
            return window.normalizeTitleCleanupRules(rules);
        }
        return Array.isArray(rules)
            ? rules.map(normalizeSettingsTitleCleanupRule).filter(Boolean)
            : [];
    }

    function cloneSettingsDefaultTitleCleanupRules() {
        return typeof window.cloneDefaultTitleCleanupRules === 'function'
            ? window.cloneDefaultTitleCleanupRules()
            : [];
    }

    function comparableTitleCleanupRules(rules) {
        return normalizeSettingsTitleCleanupRules(rules).map(rule => ({
            id: rule.id,
            name: rule.name,
            enabled: rule.enabled !== false,
            pattern: rule.pattern,
            appContains: rule.appContains || '',
            urlContains: rule.urlContains || ''
        }));
    }

    function titleCleanupRulesEqual(leftRules, rightRules) {
        return JSON.stringify(comparableTitleCleanupRules(leftRules)) === JSON.stringify(comparableTitleCleanupRules(rightRules));
    }

    function readStoredTitleCleanupRules() {
        try {
            const rawValue = localStorage.getItem('titleCleanupRules');
            if (!rawValue) return [];
            const parsedRules = JSON.parse(rawValue);
            return normalizeSettingsTitleCleanupRules(parsedRules);
        } catch {
            return [];
        }
    }

    async function reconcileTitleCleanupRulesFromLocalStorage(nativeSettings) {
        const nextSettings = { ...(nativeSettings || {}) };
        if (!window.OrielData?.isNative) return nextSettings;

        const nativeRules = normalizeSettingsTitleCleanupRules(nextSettings.titleCleanupRules);
        const storedRules = readStoredTitleCleanupRules();
        const defaultRules = normalizeSettingsTitleCleanupRules(cloneSettingsDefaultTitleCleanupRules());

        const hasRecoverableStoredRules = storedRules.length > 0
            && !titleCleanupRulesEqual(storedRules, defaultRules)
            && !titleCleanupRulesEqual(storedRules, nativeRules);
        const nativeLooksUncustomized = defaultRules.length > 0
            && titleCleanupRulesEqual(nativeRules, defaultRules);

        if (!hasRecoverableStoredRules || !nativeLooksUncustomized) return nextSettings;

        if (!titleCleanupRulesHaveValidPatterns(storedRules)) return nextSettings;

        try {
            const updatedSettings = await window.OrielData.request('settings.update', { titleCleanupRules: storedRules });
            nextSettings.titleCleanupRules = normalizeSettingsTitleCleanupRules(updatedSettings?.titleCleanupRules || storedRules);
            localStorage.setItem('titleCleanupRules', JSON.stringify(nextSettings.titleCleanupRules));
        } catch (error) {
            console.error('Error migrating title cleanup rules:', error);
        }

        return nextSettings;
    }

    function validateTitleCleanupPattern(pattern) {
        try {
            // The cleaner applies rules with these flags, so validate the same shape here.
            new RegExp(pattern, 'gi');
            return true;
        } catch (error) {
            return false;
        }
    }

    function setTitleCleanupStatus(message) {
        if (!settingsTitleCleanupStatus) return;
        const text = String(message || '').trim();
        settingsTitleCleanupStatus.textContent = text;
        settingsTitleCleanupStatus.classList.toggle('hidden', text.length === 0);
    }

    function titleCleanupRulesHaveValidPatterns(rules) {
        return (rules || []).every(rule => validateTitleCleanupPattern(rule.pattern));
    }

    function makeTitleCleanupRuleId(name) {
        const slug = String(name || 'rule').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rule';
        return `custom-${slug}-${Date.now().toString(36)}`;
    }

    async function persistTitleCleanupRules(rules, { rerender = true, refresh = true } = {}) {
        const normalizedRules = normalizeSettingsTitleCleanupRules(rules);
        if (!titleCleanupRulesHaveValidPatterns(normalizedRules)) {
            setTitleCleanupStatus('Enter a valid JavaScript regular expression.');
            return false;
        }
        let savedRules = normalizedRules;
        if (window.OrielData && window.OrielData.isNative) {
            try {
                const updatedSettings = await window.OrielData.request('settings.update', { titleCleanupRules: normalizedRules });
                savedRules = normalizeSettingsTitleCleanupRules(updatedSettings?.titleCleanupRules || normalizedRules);
            } catch (error) {
                console.error('Error saving title cleanup rules:', error);
                setTitleCleanupStatus('Could not save title cleanup rules.');
                return false;
            }
        }
        state.settings.titleCleanupRules = savedRules;
        localStorage.setItem('titleCleanupRules', JSON.stringify(savedRules));
        setTitleCleanupStatus(savedRules.length ? 'Title cleanup rules saved.' : 'No title cleanup rules configured.');
        if (rerender) renderTitleCleanupRules();
        if (refresh) await refreshData();
        return true;
    }

    function renderTitleCleanupRules() {
        if (!settingsTitleCleanupList) return;
        settingsTitleCleanupList.replaceChildren();
        const rules = normalizeSettingsTitleCleanupRules(state.settings.titleCleanupRules);

        if (rules.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state empty-state--compact';
            empty.textContent = 'No title cleanup rules configured.';
            settingsTitleCleanupList.appendChild(empty);
            return;
        }

        const createText = (className, text) => {
            const element = document.createElement('span');
            element.className = className;
            element.textContent = text;
            return element;
        };

        const createRuleField = (labelText, input) => {
            const field = document.createElement('label');
            field.className = 'title-cleanup-rule__field';
            const label = document.createElement('span');
            label.className = 'title-cleanup-rule__label';
            label.textContent = labelText;
            field.appendChild(label);
            field.appendChild(input);
            return field;
        };

        rules.forEach((rule, index) => {
            const row = document.createElement('div');
            row.className = 'title-cleanup-rule';
            const isExpanded = expandedTitleCleanupRuleId === rule.id;
            row.classList.toggle('is-expanded', isExpanded);

            const top = document.createElement('div');
            top.className = 'title-cleanup-rule__header';

            const toggleLabel = document.createElement('label');
            toggleLabel.className = 'oriel-toggle oriel-toggle--sm shrink-0';
            toggleLabel.setAttribute('for', `title-cleanup-enabled-${rule.id}`);
            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.id = `title-cleanup-enabled-${rule.id}`;
            toggle.className = 'oriel-toggle-input';
            toggle.checked = rule.enabled !== false;
            const toggleTrack = document.createElement('span');
            toggleTrack.className = 'oriel-toggle-track';
            toggleTrack.setAttribute('aria-hidden', 'true');
            toggleLabel.appendChild(toggle);
            toggleLabel.appendChild(toggleTrack);

            const summary = document.createElement('div');
            summary.className = 'title-cleanup-rule__summary';
            const summaryTitle = createText('title-cleanup-rule__name', rule.name);
            const chips = document.createElement('div');
            chips.className = 'title-cleanup-rule__chips';
            const patternChip = createText('title-cleanup-rule__chip title-cleanup-rule__chip--pattern', 'Pattern set');
            patternChip.title = rule.pattern;
            chips.appendChild(patternChip);
            if (rule.appContains) {
                chips.appendChild(createText('title-cleanup-rule__chip', `App: ${rule.appContains}`));
            }
            if (rule.urlContains) {
                chips.appendChild(createText('title-cleanup-rule__chip', `URL: ${rule.urlContains}`));
            }
            if (!rule.appContains && !rule.urlContains) {
                chips.appendChild(createText('title-cleanup-rule__chip', 'All activity'));
            }
            summary.appendChild(summaryTitle);
            summary.appendChild(chips);

            const headerActions = document.createElement('div');
            headerActions.className = 'title-cleanup-rule__actions';

            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.className = 'icon-button';
            editButton.title = isExpanded ? 'Close title cleanup rule editor' : 'Edit title cleanup rule';
            editButton.setAttribute('aria-label', 'Edit title cleanup rule');
            editButton.setAttribute('aria-expanded', String(isExpanded));
            editButton.innerHTML = `<i class="ph ph-${isExpanded ? 'caret-up' : 'pencil-simple'} text-sm" aria-hidden="true"></i>`;

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'icon-button icon-button--danger shrink-0';
            removeButton.title = 'Remove title cleanup rule';
            removeButton.setAttribute('aria-label', 'Remove title cleanup rule');
            removeButton.innerHTML = '<i class="ph ph-trash text-sm" aria-hidden="true"></i>';

            top.appendChild(toggleLabel);
            top.appendChild(summary);
            headerActions.appendChild(editButton);
            headerActions.appendChild(removeButton);
            top.appendChild(headerActions);

            const editor = document.createElement('div');
            editor.className = 'title-cleanup-rule__editor';
            if (!isExpanded) editor.classList.add('hidden');

            const name = document.createElement('input');
            name.type = 'text';
            name.className = 'field';
            name.value = rule.name;
            name.setAttribute('aria-label', 'Title cleanup rule name');

            const pattern = document.createElement('input');
            pattern.type = 'text';
            pattern.className = 'field';
            pattern.value = rule.pattern;
            pattern.setAttribute('aria-label', 'Regex pattern to remove');

            const scopes = document.createElement('div');
            scopes.className = 'title-cleanup-rule__fields';
            const appScope = document.createElement('input');
            appScope.type = 'text';
            appScope.className = 'field';
            appScope.placeholder = 'App contains';
            appScope.value = rule.appContains || '';
            appScope.setAttribute('aria-label', 'Optional app scope');
            const urlScope = document.createElement('input');
            urlScope.type = 'text';
            urlScope.className = 'field';
            urlScope.placeholder = 'URL contains';
            urlScope.value = rule.urlContains || '';
            urlScope.setAttribute('aria-label', 'Optional URL scope');

            scopes.appendChild(createRuleField('Name', name));
            scopes.appendChild(createRuleField('Regex Pattern', pattern));
            scopes.appendChild(createRuleField('App Scope', appScope));
            scopes.appendChild(createRuleField('URL Scope', urlScope));

            const editorActions = document.createElement('div');
            editorActions.className = 'title-cleanup-rule__editor-actions';
            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.className = 'button-secondary';
            cancelButton.textContent = 'Cancel';
            const saveButton = document.createElement('button');
            saveButton.type = 'button';
            saveButton.className = 'button-primary';
            saveButton.textContent = 'Save Rule';
            editorActions.appendChild(cancelButton);
            editorActions.appendChild(saveButton);
            editor.appendChild(scopes);
            editor.appendChild(editorActions);

            const saveEditedRule = async () => {
                const nextRules = normalizeSettingsTitleCleanupRules(state.settings.titleCleanupRules);
                nextRules[index] = {
                    ...rule,
                    enabled: toggle.checked,
                    name: name.value,
                    pattern: pattern.value,
                    appContains: appScope.value,
                    urlContains: urlScope.value
                };
                const saved = await persistTitleCleanupRules(nextRules, { rerender: false });
                if (saved) {
                    expandedTitleCleanupRuleId = null;
                    renderTitleCleanupRules();
                }
            };

            toggle.addEventListener('change', async () => {
                const nextRules = normalizeSettingsTitleCleanupRules(state.settings.titleCleanupRules);
                nextRules[index] = { ...rule, enabled: toggle.checked };
                await persistTitleCleanupRules(nextRules);
            });
            editButton.addEventListener('click', () => {
                expandedTitleCleanupRuleId = isExpanded ? null : rule.id;
                renderTitleCleanupRules();
            });
            cancelButton.addEventListener('click', () => {
                expandedTitleCleanupRuleId = null;
                renderTitleCleanupRules();
            });
            saveButton.addEventListener('click', saveEditedRule);
            removeButton.addEventListener('click', async () => {
                const nextRules = normalizeSettingsTitleCleanupRules(state.settings.titleCleanupRules);
                nextRules.splice(index, 1);
                if (expandedTitleCleanupRuleId === rule.id) expandedTitleCleanupRuleId = null;
                await persistTitleCleanupRules(nextRules);
            });

            row.appendChild(top);
            row.appendChild(editor);
            settingsTitleCleanupList.appendChild(row);
        });
    }

    setTitleCleanupStatus('');

    function setSettingsElementHidden(element, isHidden) {
        element?.classList.toggle('hidden', Boolean(isHidden));
    }

    function setLogoDevKeyFeedback(message, tone = 'muted', { autoClear = true } = {}) {
        if (!settingsLogoDevKeyFeedback) return;
        if (logoDevKeyFeedbackTimer && typeof clearTimeout === 'function') {
            clearTimeout(logoDevKeyFeedbackTimer);
            logoDevKeyFeedbackTimer = null;
        }
        settingsLogoDevKeyFeedback.textContent = message || '';
        settingsLogoDevKeyFeedback.dataset.tone = tone;
        if (message && autoClear && typeof setTimeout === 'function') {
            logoDevKeyFeedbackTimer = setTimeout(() => {
                settingsLogoDevKeyFeedback.textContent = '';
                logoDevKeyFeedbackTimer = null;
            }, 2800);
        }
    }

    function syncLogoDevKeyControls({ resetKey = false } = {}) {
        const hasKey = Boolean(logoDevKeySaved);
        const isEditing = hasKey && logoDevKeyEditMode;

        if (settingsLogoDevApiKeyInput) {
            settingsLogoDevApiKeyInput.disabled = hasKey && !isEditing;
            settingsLogoDevApiKeyInput.placeholder = hasKey && !isEditing
                ? ''
                : (isEditing ? 'Paste new publishable key' : 'Paste publishable key');
            if (resetKey || (hasKey && !isEditing)) {
                settingsLogoDevApiKeyInput.value = hasKey && !isEditing ? '********' : '';
            }
        }

        setSettingsElementHidden(settingsLogoDevKeyEditButton, !hasKey || isEditing);
        setSettingsElementHidden(settingsLogoDevKeySaveButton, hasKey && !isEditing);
        setSettingsElementHidden(settingsLogoDevKeyCancelButton, !isEditing);
        setSettingsElementHidden(settingsLogoDevKeyDeleteButton, !hasKey || isEditing);
        if (settingsLogoDevKeySaveLabel) settingsLogoDevKeySaveLabel.textContent = isEditing ? 'Save new key' : 'Save key';
    }

    async function refreshLogoDevKeyStatus() {
        logoDevKeyEditMode = false;
        if (!window.OrielData?.isNative) {
            logoDevKeySaved = false;
            syncLogoDevKeyControls({ resetKey: true });
            return;
        }
        try {
            const status = await window.OrielData.request('logoDev.key.status', {});
            logoDevKeySaved = Boolean(status?.saved);
        } catch (error) {
            console.error('Error fetching Logo.dev key status:', error);
            logoDevKeySaved = false;
            setLogoDevKeyFeedback('Could not read key status.', 'error');
        }
        syncLogoDevKeyControls({ resetKey: true });
    }

    function setLogoDevKeyEditMode(isEditing) {
        logoDevKeyEditMode = isEditing && logoDevKeySaved;
        syncLogoDevKeyControls({ resetKey: true });
        if (logoDevKeyEditMode) settingsLogoDevApiKeyInput?.focus?.({ preventScroll: true });
    }

    async function saveLogoDevKey() {
        const apiKey = settingsLogoDevApiKeyInput?.value?.trim() || '';
        if (!apiKey.startsWith('pk_')) {
            setLogoDevKeyFeedback('Paste a Logo.dev publishable key that starts with pk_.', 'error');
            return;
        }
        if (!window.OrielData?.isNative) {
            setLogoDevKeyFeedback('Keychain storage is available in Oriel.app.', 'error');
            return;
        }
        try {
            const status = await window.OrielData.request('logoDev.key.save', { apiKey });
            logoDevKeySaved = Boolean(status?.saved);
            logoDevKeyEditMode = false;
            setLogoDevKeyFeedback('Key saved in Keychain.', 'success');
            syncLogoDevKeyControls({ resetKey: true });
            refreshData();
        } catch (error) {
            console.error('Error saving Logo.dev key:', error);
            setLogoDevKeyFeedback('Could not save Logo.dev API key.', 'error');
        }
    }

    async function deleteLogoDevKey() {
        if (!window.OrielData?.isNative || !logoDevKeySaved) return;
        const confirmed = typeof window.confirm === 'function'
            ? window.confirm('Remove the saved Logo.dev API key from Keychain?')
            : true;
        if (!confirmed) return;
        try {
            const status = await window.OrielData.request('logoDev.key.delete', {});
            logoDevKeySaved = Boolean(status?.saved);
            logoDevKeyEditMode = false;
            setLogoDevKeyFeedback('Key removed.', 'success');
            syncLogoDevKeyControls({ resetKey: true });
            refreshData();
        } catch (error) {
            console.error('Error deleting Logo.dev key:', error);
            setLogoDevKeyFeedback('Could not remove Logo.dev API key.', 'error');
        }
    }

    document.querySelectorAll?.('[data-settings-section-button]')?.forEach(button => {
        button.addEventListener('click', () => setSettingsSection(button.dataset.settingsSectionButton));
    });

    if (btnSettings) {
        btnSettings.addEventListener('click', () => openSettingsModal({ section: 'general' }));
    }

    if (settingsModalBtnClose) {
        settingsModalBtnClose.addEventListener('click', () => {
            closeModalById('settings-modal');
        });
    }

    if (settingsThemeSelect) {
        settingsThemeSelect.addEventListener('change', async (e) => {
            if (typeof window.applyTheme === 'function') {
                window.applyTheme(e.target.value, { persist: true });
            }
            syncSettingsControls();
            if (window.OrielData && window.OrielData.isNative) {
                try {
                    await window.OrielData.request('settings.update', { theme: e.target.value });
                } catch (error) {
                    console.error('Error saving native theme:', error);
                }
            }
        });
    }

    if (settingsLogoDevIcons) {
        settingsLogoDevIcons.addEventListener('change', async (event) => {
            state.settings.logoDevIconsEnabled = Boolean(event.target.checked);
            localStorage.setItem('logoDevIconsEnabled', String(state.settings.logoDevIconsEnabled));
            if (window.OrielData && window.OrielData.isNative) {
                try {
                    await window.OrielData.request('settings.update', {
                        logoDevIconsEnabled: state.settings.logoDevIconsEnabled
                    });
                    const nativeSettings = await window.OrielData.request('settings.get', {});
                    Object.assign(state.settings, nativeSettings);
                } catch (error) {
                    console.error('Error saving native brand icon preference:', error);
                }
            }
            syncSettingsControls();
            refreshData();
        });
    }

    settingsLogoDevKeyEditButton?.addEventListener('click', () => setLogoDevKeyEditMode(true));
    settingsLogoDevKeyCancelButton?.addEventListener('click', () => setLogoDevKeyEditMode(false));
    settingsLogoDevKeySaveButton?.addEventListener('click', saveLogoDevKey);
    settingsLogoDevKeyDeleteButton?.addEventListener('click', deleteLogoDevKey);

    settingsTitleCleanupAdd?.addEventListener('click', async () => {
        const name = settingsTitleCleanupName?.value?.trim() || '';
        const pattern = settingsTitleCleanupPattern?.value?.trim() || '';
        if (!name || !pattern) {
            setTitleCleanupStatus('Enter a rule name and regex pattern.');
            return;
        }
        if (!validateTitleCleanupPattern(pattern)) {
            setTitleCleanupStatus('Enter a valid JavaScript regular expression.');
            return;
        }
        const nextRules = normalizeSettingsTitleCleanupRules(state.settings.titleCleanupRules);
        nextRules.push({
            id: makeTitleCleanupRuleId(name),
            name,
            enabled: true,
            pattern,
            appContains: settingsTitleCleanupApp?.value?.trim() || '',
            urlContains: settingsTitleCleanupUrl?.value?.trim() || ''
        });
        const saved = await persistTitleCleanupRules(nextRules);
        if (!saved) return;
        if (settingsTitleCleanupName) settingsTitleCleanupName.value = '';
        if (settingsTitleCleanupPattern) settingsTitleCleanupPattern.value = '';
        if (settingsTitleCleanupApp) settingsTitleCleanupApp.value = '';
        if (settingsTitleCleanupUrl) settingsTitleCleanupUrl.value = '';
    });

    settingsTitleCleanupResetDefaults?.addEventListener('click', async () => {
        await persistTitleCleanupRules(cloneSettingsDefaultTitleCleanupRules());
    });

    if (settingsExclusionAdd) {
        settingsExclusionAdd.addEventListener('click', async () => {
            const pattern = settingsExclusionPattern.value.trim();
            if (!pattern) return;
            const shouldApplyHistory = Boolean(settingsExclusionApplyHistory?.checked);
            setTrackingExclusionStatus('');

            try {
                const res = await fetch(`${API_BASE}/exclusions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        field: settingsExclusionField.value,
                        matchType: settingsExclusionMatch.value,
                        pattern,
                        applyToHistory: shouldApplyHistory
                    })
                });
                if (res.ok && typeof window.fetchTrackingExclusions === 'function') {
                    const created = await res.json().catch(() => null);
                    settingsExclusionPattern.value = '';
                    if (settingsExclusionApplyHistory) settingsExclusionApplyHistory.checked = false;
                    const removed = Number(created?.removedHistoryCount);
                    if (shouldApplyHistory && Number.isFinite(removed)) {
                        setTrackingExclusionStatus(`Cleaned ${removed} existing ${removed === 1 ? 'activity' : 'activities'}.`);
                    } else if (shouldApplyHistory) {
                        setTrackingExclusionStatus('Existing history cleanup completed.');
                    } else {
                        setTrackingExclusionStatus('Exclusion added.');
                    }
                    await window.fetchTrackingExclusions();
                    renderTrackingExclusions();
                    await refreshData();
                }
            } catch (err) {
                console.error('Error saving tracking exclusion:', err);
            }
        });
    }

    let purgeConfirmCount = 0;
    if (settingsBtnPurge) {
        settingsBtnPurge.addEventListener('click', () => {
            purgeConfirmCount++;
            if (purgeConfirmCount === 1) {
                settingsBtnPurge.innerText = 'Are you absolutely sure?';
                settingsBtnPurge.className = 'button-danger shrink-0';
                setTimeout(() => {
                    purgeConfirmCount = 0;
                    settingsBtnPurge.innerText = 'Purge All Data';
                    settingsBtnPurge.className = 'button-danger shrink-0';
                }, 4000);
            } else if (purgeConfirmCount === 2) {
                purgeConfirmCount = 0;
                showCustomConfirm({
                    title: 'Purge Local Data',
                    message: 'All local time tracker records will be wiped permanently. This cannot be undone.',
                    actionText: 'Purge',
                    actionClass: 'button-danger',
                    onConfirm: async () => {
                        try {
                            const res = await fetch(`${API_BASE}/purge`, { method: 'POST' });
                            if (res.ok) {
                                localStorage.clear();
                                window.location.reload();
                            } else {
                                alert('Failed to purge data on the server.');
                            }
                        } catch (err) {
                            console.error('Error purging data:', err);
                            alert('An error occurred while purging data.');
                        }
                    }
                });
            }
        });
    }

    function parseAiInsightsDate(value) {
        const [year, month, day] = String(value || '').split('-').map(Number);
        if (!year || !month || !day) return null;
        return new Date(year, month - 1, day);
    }

    function formatAiInsightsDate(date) {
        if (typeof getFormattedDate === 'function') return getFormattedDate(date);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function aiInsightsRangeBounds() {
        const current = aiInsightsTodayDate();
        current.setHours(0, 0, 0, 0);
        const end = new Date(current);
        const start = new Date(current);
        start.setDate(start.getDate() - 365);
        return {
            startDate: formatAiInsightsDate(start),
            endDate: formatAiInsightsDate(end)
        };
    }

    function aiInsightsTodayDate() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
    }

    function aiInsightsFriendlyDate(date) {
        const parsed = parseAiInsightsDate(date);
        if (!parsed) return date;
        return parsed.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    function aiInsightsPeriodType(row) {
        const type = String(row?.periodType || '').toLowerCase();
        return (type === 'week' || type === 'month') ? type : 'day';
    }

    function aiInsightsPrimaryDate(row) {
        return aiInsightsPeriodType(row) === 'day'
            ? String(row?.date || '')
            : String(row?.periodStart || '');
    }

    function aiInsightsPeriodEndDate(row) {
        const explicitEnd = String(row?.periodEnd || '');
        if (parseAiInsightsDate(explicitEnd)) return explicitEnd;
        const type = aiInsightsPeriodType(row);
        const start = parseAiInsightsDate(row?.periodStart);
        if (!start) return aiInsightsPrimaryDate(row);
        if (type === 'week') {
            const end = new Date(start);
            end.setDate(end.getDate() + 6);
            return formatAiInsightsDate(end);
        }
        if (type === 'month') {
            return formatAiInsightsDate(new Date(start.getFullYear(), start.getMonth() + 1, 0));
        }
        return aiInsightsPrimaryDate(row);
    }

    function aiInsightsSortDate(row) {
        return aiInsightsPeriodType(row) === 'day'
            ? aiInsightsPrimaryDate(row)
            : aiInsightsPeriodEndDate(row);
    }

    function aiInsightsRowKey(row) {
        const type = aiInsightsPeriodType(row);
        return `${type}:${aiInsightsPrimaryDate(row)}`;
    }

    function aiInsightsCardId(row) {
        return `ai-insights-card-${aiInsightsRowKey(row).replace(/[^a-z0-9-]/gi, '-')}`;
    }

    function aiInsightsWeekInfo(date) {
        const thursday = new Date(date);
        const day = thursday.getDay() || 7;
        thursday.setDate(thursday.getDate() + 4 - day);
        const year = thursday.getFullYear();
        const yearStart = new Date(year, 0, 1);
        const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
        return { week, year };
    }

    function aiInsightsWeekLabel(date, { includeYear = true } = {}) {
        const { week, year } = aiInsightsWeekInfo(date);
        return includeYear ? `Week ${week}, ${year}` : `Week ${week}`;
    }

    function aiInsightsTitle(row) {
        const type = aiInsightsPeriodType(row);
        const start = parseAiInsightsDate(aiInsightsPrimaryDate(row));
        if (!start) return aiInsightsPrimaryDate(row);
        if (type === 'month') {
            return start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        }
        if (type === 'week') {
            return aiInsightsWeekLabel(start);
        }
        return aiInsightsFriendlyDate(row.date || '');
    }

    function aiInsightsCardTitle(row) {
        const type = aiInsightsPeriodType(row);
        const start = parseAiInsightsDate(aiInsightsPrimaryDate(row));
        if (!start) return aiInsightsPrimaryDate(row);
        if (type === 'week') return 'Weekly recap';
        if (type === 'day') {
            return start.toLocaleDateString('en-GB', {
                weekday: 'short',
                day: 'numeric',
                month: 'short'
            }).replace(',', '');
        }
        return aiInsightsTitle(row);
    }

    function aiInsightsDetailTitle(row) {
        return aiInsightsTitle(row);
    }

    function aiInsightsMetadataLabel(row) {
        const type = aiInsightsPeriodType(row);
        if (type === 'month') return 'Monthly recap';
        return '';
    }

    function aiInsightsDefaultSummaryText(row) {
        return aiInsightsPeriodType(row) === 'day'
            ? 'Daily summary generated.'
            : 'AI Insights recap generated.';
    }

    function aiInsightsGenerateLabel(row, prefix = 'Generate') {
        const type = aiInsightsPeriodType(row);
        if (type === 'month') return `${prefix} monthly recap`;
        if (type === 'week') return `${prefix} weekly recap`;
        return `${prefix} daily summary`;
    }

    function aiInsightsOpenLabel(row) {
        const type = aiInsightsPeriodType(row);
        if (type === 'month') return 'Open monthly recap';
        if (type === 'week') return 'Open weekly recap';
        return 'Open daily summary';
    }

    function aiInsightsReadyNote(row) {
        const type = aiInsightsPeriodType(row);
        if (type === 'month') return 'Successful daily summaries are available for this month.';
        if (type === 'week') return 'Successful daily summaries are available for this week.';
        return 'Screenshot activity summaries are available for this day.';
    }

    function createAiInsightsElement(tag, className, text = '') {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text) element.textContent = text;
        return element;
    }

    function appendAiInsightsInlineText(container, text) {
        if (!text) return;
        container.appendChild(createAiInsightsElement('span', '', text));
    }

    function safeAiInsightsMarkdownUrl(url) {
        try {
            const parsed = new URL(String(url || ''));
            return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : '';
        } catch {
            return '';
        }
    }

    function appendAiInsightsInlineMarkdown(container, text) {
        const source = String(text || '');
        let index = 0;

        const appendPlainUntil = nextIndex => {
            if (nextIndex > index) {
                appendAiInsightsInlineText(container, source.slice(index, nextIndex));
                index = nextIndex;
            }
        };

        while (index < source.length) {
            if (source.startsWith('**', index)) {
                const end = source.indexOf('**', index + 2);
                if (end > index + 2) {
                    const strong = createAiInsightsElement('strong', '');
                    appendAiInsightsInlineMarkdown(strong, source.slice(index + 2, end));
                    container.appendChild(strong);
                    index = end + 2;
                    continue;
                }
            }

            if (source[index] === '`') {
                const end = source.indexOf('`', index + 1);
                if (end > index + 1) {
                    container.appendChild(createAiInsightsElement('code', '', source.slice(index + 1, end)));
                    index = end + 1;
                    continue;
                }
            }

            if (source[index] === '[') {
                const match = source.slice(index).match(/^\[([^\]]+)\]\(([^)]+)\)/);
                if (match) {
                    const href = safeAiInsightsMarkdownUrl(match[2]);
                    if (href) {
                        const link = createAiInsightsElement('a', '');
                        link.setAttribute('href', href);
                        link.setAttribute('target', '_blank');
                        link.setAttribute('rel', 'noopener noreferrer');
                        appendAiInsightsInlineMarkdown(link, match[1]);
                        container.appendChild(link);
                        index += match[0].length;
                        continue;
                    }
                }
            }

            if (source[index] === '*') {
                const end = source.indexOf('*', index + 1);
                if (end > index + 1 && source[index + 1] !== '*') {
                    const emphasis = createAiInsightsElement('em', '');
                    appendAiInsightsInlineMarkdown(emphasis, source.slice(index + 1, end));
                    container.appendChild(emphasis);
                    index = end + 1;
                    continue;
                }
            }

            const nextSpecial = ['**', '`', '[', '*']
                .map(token => source.indexOf(token, index + 1))
                .filter(position => position >= 0)
                .sort((first, second) => first - second)[0] ?? source.length;
            appendPlainUntil(nextSpecial);
        }
    }

    function appendAiInsightsMarkdownParagraph(container, lines) {
        const text = lines.join(' ').replace(/\s+/g, ' ').trim();
        if (!text) return;
        const paragraph = createAiInsightsElement('p', '');
        appendAiInsightsInlineMarkdown(paragraph, text);
        container.appendChild(paragraph);
    }

    function appendAiInsightsMarkdownList(container, items, ordered = false) {
        const list = createAiInsightsElement(ordered ? 'ol' : 'ul', 'ai-insights-card-markdown-list');
        items
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .forEach(item => {
                const listItem = createAiInsightsElement('li', '');
                appendAiInsightsInlineMarkdown(listItem, item);
                list.appendChild(listItem);
            });
        if (list.children?.length) {
            container.appendChild(list);
        }
    }

    function appendAiInsightsMarkdownHeading(container, line) {
        const match = String(line || '').trim().match(/^(#{1,6})\s+(.+)$/);
        if (!match) return false;
        const level = Math.min(6, Math.max(4, match[1].length));
        const heading = createAiInsightsElement(`h${level}`, 'ai-insights-card-markdown-heading');
        appendAiInsightsInlineMarkdown(heading, match[2]);
        container.appendChild(heading);
        return true;
    }

    function renderAiInsightsMarkdown(text, className = 'ai-insights-card-summary ai-insights-card-markdown') {
        const container = createAiInsightsElement('div', className);
        const lines = String(text || '')
            .replace(/\r\n?/g, '\n')
            .split('\n');
        let paragraphLines = [];
        let listItems = [];
        let listOrdered = false;

        const flushParagraph = () => {
            appendAiInsightsMarkdownParagraph(container, paragraphLines);
            paragraphLines = [];
        };
        const flushList = () => {
            appendAiInsightsMarkdownList(container, listItems, listOrdered);
            listItems = [];
        };

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) {
                flushParagraph();
                flushList();
                return;
            }

            if (/^#{1,6}\s+/.test(trimmed)) {
                flushParagraph();
                flushList();
                appendAiInsightsMarkdownHeading(container, trimmed);
                return;
            }

            const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
            const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
            if (unorderedMatch || orderedMatch) {
                flushParagraph();
                const ordered = Boolean(orderedMatch);
                if (listItems.length && listOrdered !== ordered) {
                    flushList();
                }
                listOrdered = ordered;
                listItems.push((unorderedMatch || orderedMatch)[1]);
                return;
            }

            flushList();
            paragraphLines.push(trimmed);
        });

        flushParagraph();
        flushList();

        if (!container.children?.length) {
            container.appendChild(createAiInsightsElement('p', '', 'Daily summary generated.'));
        }
        return container;
    }

    function aiInsightsPreviewMarkdown(text) {
        const lines = String(text || '')
            .replace(/\r\n?/g, '\n')
            .split('\n');
        const blockLines = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                if (blockLines.length > 0) break;
                continue;
            }
            if (/^(highlights?|uncertainties):$/i.test(trimmed)) {
                if (blockLines.length > 0) break;
                continue;
            }
            blockLines.push(trimmed);
        }

        return blockLines.join('\n').trim() || 'Daily summary generated.';
    }

    function renderAiInsightsPreview(text) {
        return renderAiInsightsMarkdown(
            aiInsightsPreviewMarkdown(text),
            'ai-insights-card-summary ai-insights-card-markdown'
        );
    }

    function aiInsightsAddDays(date, days) {
        const next = new Date(date);
        next.setDate(next.getDate() + days);
        next.setHours(0, 0, 0, 0);
        return next;
    }

    function aiInsightsWeekStart(date) {
        if (typeof getWeekStart === 'function') return getWeekStart(date);
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const day = start.getDay();
        start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day));
        return start;
    }

    function aiInsightsWeekStartString(date) {
        return formatAiInsightsDate(aiInsightsWeekStart(date));
    }

    function aiInsightsWeekRangeLabel(startDate) {
        const endDate = aiInsightsAddDays(startDate, 6);
        const sameMonth = startDate.getMonth() === endDate.getMonth();
        const sameYear = startDate.getFullYear() === endDate.getFullYear();
        const startDay = startDate.toLocaleDateString('en-GB', { day: 'numeric' });
        const endDay = endDate.toLocaleDateString('en-GB', { day: 'numeric' });
        const startMonth = startDate.toLocaleDateString('en-GB', { month: 'short' });
        const endMonth = endDate.toLocaleDateString('en-GB', { month: 'short' });
        const endYear = endDate.toLocaleDateString('en-GB', { year: 'numeric' });
        if (sameMonth && sameYear) {
            return `${startDay}–${endDay} ${endMonth} ${endYear}`;
        }
        if (sameYear) {
            return `${startDay} ${startMonth}–${endDay} ${endMonth} ${endYear}`;
        }
        const startYear = startDate.toLocaleDateString('en-GB', { year: 'numeric' });
        return `${startDay} ${startMonth} ${startYear}–${endDay} ${endMonth} ${endYear}`;
    }

    function aiInsightsRowStatus(row) {
        return row?.status || 'empty';
    }

    function aiInsightsPlaceholderNote(row) {
        return 'Not yet available';
    }

    function aiInsightsPlaceholderDailyRow(dateText, todayText) {
        return {
            date: dateText,
            status: 'placeholder',
            sourceSummaryCount: 0,
            placeholderKind: dateText > todayText ? 'future' : 'missing'
        };
    }

    function aiInsightsPlaceholderWeeklyRow(weekStartText) {
        const start = parseAiInsightsDate(weekStartText);
        const end = start ? formatAiInsightsDate(aiInsightsAddDays(start, 6)) : weekStartText;
        return {
            periodType: 'week',
            periodStart: weekStartText,
            periodEnd: end,
            status: 'placeholder',
            sourceDailyCount: 0,
            placeholderKind: 'missing'
        };
    }

    function buildAiInsightsViewModel() {
        const rows = Array.isArray(aiInsightsState.rows) ? aiInsightsState.rows : [];
        if (!window.OrielData?.isNative && rows.length === 0) {
            return { monthlyRows: [], sections: [] };
        }

        const today = aiInsightsTodayDate();
        const currentYear = String(today.getFullYear());
        const todayText = formatAiInsightsDate(today);
        const dailyByDate = new Map();
        const weeklyByStart = new Map();
        const monthlyRows = [];
        const weekStarts = new Set([aiInsightsWeekStartString(today)]);
        const years = new Set([currentYear]);

        rows.forEach(row => {
            const type = aiInsightsPeriodType(row);
            if (type === 'month') {
                monthlyRows.push(row);
                const start = parseAiInsightsDate(aiInsightsPrimaryDate(row));
                if (start) years.add(String(start.getFullYear()));
                return;
            }
            if (type === 'week') {
                const start = parseAiInsightsDate(aiInsightsPrimaryDate(row));
                if (!start) return;
                const key = formatAiInsightsDate(start);
                weeklyByStart.set(key, row);
                weekStarts.add(key);
                years.add(String(aiInsightsWeekInfo(start).year));
                return;
            }
            const dateText = aiInsightsPrimaryDate(row);
            const date = parseAiInsightsDate(dateText);
            if (!date) return;
            dailyByDate.set(dateText, row);
            weekStarts.add(aiInsightsWeekStartString(date));
            years.add(String(aiInsightsWeekInfo(date).year));
        });

        const availableYears = Array.from(years).sort((first, second) => second.localeCompare(first));
        if (!aiInsightsState.selectedYear || !years.has(String(aiInsightsState.selectedYear))) {
            aiInsightsState.selectedYear = currentYear;
        }
        const selectedYear = String(aiInsightsState.selectedYear);

        const sections = Array.from(weekStarts)
            .sort((first, second) => {
                return second.localeCompare(first);
            })
            .map(weekStartText => {
                const weekStart = parseAiInsightsDate(weekStartText);
                const weekInfo = aiInsightsWeekInfo(weekStart);
                if (String(weekInfo.year) !== selectedYear) return null;
                const days = Array.from({ length: 7 }, (_, index) => {
                    const dateText = formatAiInsightsDate(aiInsightsAddDays(weekStart, 6 - index));
                    return dailyByDate.get(dateText) || aiInsightsPlaceholderDailyRow(dateText, todayText);
                });
                return {
                    weekStart: weekStartText,
                    year: weekInfo.year,
                    title: aiInsightsWeekLabel(weekStart, { includeYear: false }),
                    rangeLabel: aiInsightsWeekRangeLabel(weekStart),
                    rows: [
                        weeklyByStart.get(weekStartText) || aiInsightsPlaceholderWeeklyRow(weekStartText),
                        ...days
                    ]
                };
            })
            .filter(Boolean);

        return {
            monthlyRows: monthlyRows
                .slice()
                .filter(row => {
                    const start = parseAiInsightsDate(aiInsightsPrimaryDate(row));
                    return start && String(start.getFullYear()) === selectedYear;
                })
                .sort((first, second) => aiInsightsSortDate(second).localeCompare(aiInsightsSortDate(first))),
            sections,
            years: availableYears,
            selectedYear
        };
    }

    function renderAiInsightsCards() {
        const grid = document.getElementById('ai-insights-card-grid');
        const emptyState = document.getElementById('ai-insights-empty-state');
        if (!grid) return;
        const viewModel = buildAiInsightsViewModel();
        renderAiInsightsYearTabs(viewModel);
        const hasContent = viewModel.monthlyRows.length > 0 || viewModel.sections.length > 0;
        grid.replaceChildren();
        if (emptyState) {
            emptyState.classList.toggle('hidden', hasContent || aiInsightsState.isLoading);
            emptyState.textContent = aiInsightsState.isLoading
                ? 'Loading AI summaries...'
                : 'No generated or ready-to-generate AI summaries in this range.';
        }
        if (aiInsightsState.isLoading && !hasContent) {
            const loading = createAiInsightsElement('div', 'ai-insights-loading', 'Loading AI summaries...');
            grid.appendChild(loading);
            return;
        }
        if (viewModel.monthlyRows.length > 0) {
            grid.appendChild(createAiInsightsMonthlyStrip(viewModel.monthlyRows));
        }
        viewModel.sections.forEach(section => {
            grid.appendChild(createAiInsightsWeekSection(section));
        });
        syncAiInsightsDetailRefreshButton();
    }

    function renderAiInsightsYearTabs(viewModel) {
        const container = document.getElementById('ai-insights-year-tabs');
        if (!container) return;
        container.replaceChildren();
        (viewModel.years || []).forEach(year => {
            const button = createAiInsightsElement('button', 'app-tab ai-insights-year-tab', year);
            const active = year === viewModel.selectedYear;
            button.type = 'button';
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(active));
            button.classList.toggle('app-tab--active', active);
            button.addEventListener('click', () => {
                aiInsightsState.selectedYear = year;
                renderAiInsightsCards();
            });
            container.appendChild(button);
        });
    }

    function createAiInsightsMonthlyStrip(rows) {
        const strip = createAiInsightsElement('section', 'ai-insights-monthly-strip');
        strip.appendChild(createAiInsightsElement('h2', 'ai-insights-section-title', 'Monthly recaps'));
        const list = createAiInsightsElement('div', 'ai-insights-monthly-list');
        rows.forEach(row => {
            list.appendChild(createAiInsightsCard(row, { compact: true }));
        });
        strip.appendChild(list);
        return strip;
    }

    function createAiInsightsWeekSection(section) {
        const sectionEl = createAiInsightsElement('section', 'ai-insights-week-section');
        const header = createAiInsightsElement('div', 'ai-insights-week-header');
        const titleBlock = createAiInsightsElement('div', 'ai-insights-week-heading');
        titleBlock.appendChild(createAiInsightsElement('h2', 'ai-insights-section-title', section.title));
        titleBlock.appendChild(createAiInsightsElement('span', 'ai-insights-section-meta', section.rangeLabel));
        header.appendChild(titleBlock);
        sectionEl.appendChild(header);

        const grid = createAiInsightsElement('div', 'ai-insights-week-grid');
        section.rows.forEach(row => {
            grid.appendChild(createAiInsightsCard(row));
        });
        sectionEl.appendChild(grid);
        return sectionEl;
    }

    function createAiInsightsCard(row, options = {}) {
        const status = aiInsightsRowStatus(row);
        const type = aiInsightsPeriodType(row);
        const classes = ['ai-insights-card', `ai-insights-card--${status}`];
        if (type === 'week') classes.push('ai-insights-card--weekly');
        if (type === 'month') classes.push('ai-insights-card--monthly');
        if (status === 'placeholder') classes.push('ai-insights-card--placeholder');
        if (options.compact) classes.push('ai-insights-card--compact');
        const card = createAiInsightsElement('article', classes.join(' '));
        if (aiInsightsPrimaryDate(row)) {
            card.id = aiInsightsCardId(row);
        }
        if (status === 'placeholder') {
            card.setAttribute('aria-disabled', 'true');
        }

        const header = createAiInsightsElement('div', 'ai-insights-card-header');
        const titleBlock = createAiInsightsElement('div', 'ai-insights-card-title');
        titleBlock.appendChild(createAiInsightsElement('h2', 'card-title', aiInsightsCardTitle(row)));
        const metadata = aiInsightsMetadataLabel(row);
        if (metadata) {
            titleBlock.appendChild(createAiInsightsElement('span', 'ai-insights-card-metadata', metadata));
        }
        header.appendChild(titleBlock);
        card.appendChild(header);

        if (status === 'succeeded') {
            appendGeneratedAiInsightsContent(card, row);
        } else if (status === 'failed') {
            appendFailedAiInsightsContent(card, row);
        } else if (status === 'ready') {
            appendReadyAiInsightsContent(card, row);
        } else if (status === 'placeholder') {
            appendPlaceholderAiInsightsContent(card, row);
        }
        return card;
    }

    function renderAiInsightsTldr(highlights, className = 'ai-insights-tldr', options = {}) {
        if (!Array.isArray(highlights)) return;
        const cleanHighlights = highlights.map(item => String(item || '').trim()).filter(Boolean);
        if (cleanHighlights.length === 0) return;
        const showHeading = options.showHeading !== false;
        const section = createAiInsightsElement('div', className);
        if (showHeading) {
            section.appendChild(createAiInsightsElement('h3', 'ai-insights-tldr-heading', 'TL;DR'));
        }
        const list = createAiInsightsElement('ul', 'ai-insights-tldr-list');
        cleanHighlights.forEach(item => {
            const listItem = createAiInsightsElement('li', '');
            appendAiInsightsInlineMarkdown(listItem, item);
            list.appendChild(listItem);
        });
        section.appendChild(list);
        return section;
    }

    function aiInsightsCurrentDetailRow() {
        const key = aiInsightsState.detailRowKey;
        if (!key) return null;
        return (Array.isArray(aiInsightsState.rows) ? aiInsightsState.rows : [])
            .find(row => aiInsightsRowKey(row) === key) || null;
    }

    function syncAiInsightsDetailRefreshButton(row = aiInsightsCurrentDetailRow()) {
        const refreshButton = document.getElementById('ai-insights-detail-refresh');
        if (!refreshButton) return;
        const shouldShow = row && aiInsightsRowStatus(row) === 'succeeded';
        refreshButton.classList.toggle('hidden', !shouldShow);
        if (!shouldShow) {
            refreshButton.disabled = true;
            return;
        }
        const label = aiInsightsGenerateLabel(row, 'Refresh');
        refreshButton.setAttribute('aria-label', label);
        refreshButton.setAttribute('title', label);
        refreshButton.disabled = !window.OrielData?.isNative || aiInsightsState.generatingKey === aiInsightsRowKey(row);
    }

    function openAiInsightsDetail(row) {
        const modal = document.getElementById('ai-insights-detail-modal');
        const title = document.getElementById('ai-insights-detail-title');
        const body = document.getElementById('ai-insights-detail-body');
        if (!modal || !body) return;
        aiInsightsState.detailRowKey = aiInsightsRowKey(row || {});
        if (title) title.textContent = aiInsightsDetailTitle(row || {});
        syncAiInsightsDetailRefreshButton(row);

        const summary = row?.summary || {};
        const text = String(summary.text || aiInsightsDefaultSummaryText(row || {})).trim();
        body.replaceChildren();
        const tldr = renderAiInsightsTldr(summary.highlights, 'ai-insights-detail-tldr ai-insights-tldr');
        if (tldr) body.appendChild(tldr);
        body.appendChild(renderAiInsightsMarkdown(text, 'ai-insights-detail-summary ai-insights-card-markdown'));
        modal.classList.remove('hidden');
    }

    function appendGeneratedAiInsightsContent(card, row) {
        const summary = row.summary || {};
        const text = String(summary.text || aiInsightsDefaultSummaryText(row)).trim();
        const preview = createAiInsightsElement('div', 'ai-insights-card-preview ai-insights-card-preview--fade');
        const tldr = renderAiInsightsTldr(summary.highlights, 'ai-insights-card-tldr ai-insights-tldr', { showHeading: false });
        if (tldr) preview.appendChild(tldr);
        preview.appendChild(renderAiInsightsPreview(text));
        card.appendChild(preview);

        const actions = createAiInsightsElement('div', 'card-actions ai-insights-card-actions');
        const openLabel = aiInsightsOpenLabel(row);
        const openButton = createAiInsightsElement('button', 'icon-button ai-insights-card-open');
        openButton.type = 'button';
        openButton.dataset.action = 'open';
        openButton.setAttribute('aria-label', openLabel);
        openButton.setAttribute('title', openLabel);
        const openIcon = createAiInsightsElement('i', 'ph ph-arrows-out-simple');
        openButton.appendChild(openIcon);
        openButton.addEventListener('click', () => openAiInsightsDetail(row));
        actions.appendChild(openButton);
        card.appendChild(actions);
    }

    function appendReadyAiInsightsContent(card, row) {
        card.appendChild(createAiInsightsElement(
            'p',
            'ai-insights-card-note',
            aiInsightsReadyNote(row)
        ));
        const isGenerating = aiInsightsState.generatingKey === aiInsightsRowKey(row);
        const generateButton = createAiInsightsElement('button', 'button-primary ai-insights-card-generate', isGenerating ? 'Generating...' : aiInsightsGenerateLabel(row));
        generateButton.type = 'button';
        generateButton.dataset.action = 'generate';
        generateButton.disabled = !window.OrielData?.isNative || isGenerating;
        generateButton.addEventListener('click', () => generateAiInsightsSummary(row));
        const actions = createAiInsightsElement('div', 'card-actions ai-insights-card-actions');
        actions.appendChild(generateButton);
        card.appendChild(actions);
    }

    function appendFailedAiInsightsContent(card, row) {
        const message = row.errorMessage || `${aiInsightsMetadataLabel(row)} generation failed.`;
        card.appendChild(createAiInsightsElement('p', 'ai-insights-card-error', message));
        const isGenerating = aiInsightsState.generatingKey === aiInsightsRowKey(row);
        const retryButton = createAiInsightsElement('button', 'button-secondary ai-insights-card-generate', isGenerating ? 'Generating...' : 'Try again');
        retryButton.type = 'button';
        retryButton.dataset.action = 'generate';
        retryButton.disabled = !window.OrielData?.isNative || isGenerating;
        retryButton.addEventListener('click', () => generateAiInsightsSummary(row));
        const actions = createAiInsightsElement('div', 'card-actions ai-insights-card-actions');
        actions.appendChild(retryButton);
        card.appendChild(actions);
    }

    function appendPlaceholderAiInsightsContent(card, row) {
        card.appendChild(createAiInsightsElement(
            'p',
            'ai-insights-card-note',
            aiInsightsPlaceholderNote(row)
        ));
    }

    async function refreshAiInsights({ focusDate = '', focusKey = '' } = {}) {
        syncAiInsightsDateControl();
        if (!window.OrielData?.isNative) {
            aiInsightsState.rows = [];
            aiInsightsState.isLoading = false;
            renderAiInsightsCards();
            return;
        }
        try {
            aiInsightsState.isLoading = true;
            renderAiInsightsCards();
            const bounds = aiInsightsRangeBounds();
            const dailyPayload = await window.OrielData.request('dailyAISummaries.list', {
                ...bounds,
                includeEmpty: false
            });
            const rollupPayload = await window.OrielData.request('aiInsightRollups.list', {
                ...bounds,
                includeEmpty: false
            });
            aiInsightsState.rows = [
                ...(Array.isArray(dailyPayload) ? dailyPayload : []),
                ...(Array.isArray(rollupPayload) ? rollupPayload : [])
            ];
            aiInsightsState.isLoading = false;
            renderAiInsightsCards();
            const targetKey = focusKey || (focusDate ? `day:${focusDate}` : `day:${aiInsightsDateString()}`);
            const targetCard = targetKey ? document.getElementById(`ai-insights-card-${targetKey.replace(/[^a-z0-9-]/gi, '-')}`) : null;
            targetCard?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            targetCard?.classList?.add?.('is-focused');
            if (targetCard) {
                setTimeout(() => targetCard.classList?.remove?.('is-focused'), 1200);
            }
        } catch (error) {
            aiInsightsState.rows = [{
                date: aiInsightsDateString(),
                status: 'failed',
                sourceSummaryCount: 0,
                errorMessage: error?.message || 'Could not load AI Insights.'
            }];
            aiInsightsState.isLoading = false;
            renderAiInsightsCards();
        }
    }
    window.refreshAiInsights = refreshAiInsights;

    async function generateAiInsightsSummary(row) {
        if (!window.OrielData?.isNative || !row) return;
        const type = aiInsightsPeriodType(row);
        const key = aiInsightsRowKey(row);
        try {
            aiInsightsState.generatingKey = key;
            renderAiInsightsCards();
            syncAiInsightsDetailRefreshButton(row);
            if (type === 'day') {
                await window.OrielData.request('dailyAISummaries.generate', { date: row.date });
            } else {
                await window.OrielData.request('aiInsightRollups.generate', {
                    period: type,
                    periodStart: row.periodStart
                });
            }
            aiInsightsState.generatingKey = '';
            await refreshAiInsights({ focusKey: key });
            syncAiInsightsDetailRefreshButton(aiInsightsCurrentDetailRow());
        } catch (error) {
            aiInsightsState.generatingKey = '';
            const existingRows = Array.isArray(aiInsightsState.rows) ? aiInsightsState.rows : [];
            aiInsightsState.rows = existingRows.map(existing => aiInsightsRowKey(existing) === key
                ? { ...existing, status: 'failed', errorMessage: error?.message || `Could not generate the ${aiInsightsMetadataLabel(existing).toLowerCase()}.` }
                : existing);
            renderAiInsightsCards();
            syncAiInsightsDetailRefreshButton(aiInsightsCurrentDetailRow());
        }
    }

    async function generateAiInsightsDailySummary(date = aiInsightsDateString()) {
        if (!window.OrielData?.isNative || !date) return;
        await generateAiInsightsSummary({ date, status: 'ready' });
    }

    DOM.elTimelineModeDay?.addEventListener('click', async () => {
        await setTimelineMode('day');
    });

    DOM.elTimelineModeWeek?.addEventListener('click', async () => {
        await setTimelineMode('week');
    });
    syncTimelineModeControls();
    syncHeaderActionsForView();

    // View navigation tab workspace switchers
    DOM.elTabTimeline.addEventListener('click', () => {
        state.currentView = 'timeline';
        DOM.elSchedulerWorkspace.classList.remove('hidden');
        DOM.elProjectsWorkspace.classList.add('hidden');
        DOM.elStatsWorkspace.classList.add('hidden');
        DOM.elAiInsightsWorkspace?.classList.add('hidden');
        setDateNavigationVisible(true);
        syncTimelineModeControls();
        syncHeaderActionsForView();

        setActiveWorkspaceTab(DOM.elTabTimeline);

        refreshData();
    });

    DOM.elTabProjects.addEventListener('click', () => {
        state.currentView = 'projects';
        DOM.elSchedulerWorkspace.classList.add('hidden');
        DOM.elProjectsWorkspace.classList.remove('hidden');
        DOM.elStatsWorkspace.classList.add('hidden');
        DOM.elAiInsightsWorkspace?.classList.add('hidden');
        setDateNavigationVisible(false);
        syncHeaderActionsForView();

        setActiveWorkspaceTab(DOM.elTabProjects);

        renderProjectsPage();
    });

    DOM.elTabStats.addEventListener('click', () => {
        state.currentView = 'stats';
        DOM.elSchedulerWorkspace.classList.add('hidden');
        DOM.elProjectsWorkspace.classList.add('hidden');
        DOM.elStatsWorkspace.classList.remove('hidden');
        DOM.elAiInsightsWorkspace?.classList.add('hidden');
        setDateNavigationVisible(false);
        syncHeaderActionsForView();

        setActiveWorkspaceTab(DOM.elTabStats);

        if (window.refreshStatsView) {
            window.refreshStatsView();
        }
    });

    DOM.elTabAiInsights?.addEventListener('click', async () => {
        state.currentView = 'aiInsights';
        DOM.elSchedulerWorkspace.classList.add('hidden');
        DOM.elProjectsWorkspace.classList.add('hidden');
        DOM.elStatsWorkspace.classList.add('hidden');
        DOM.elAiInsightsWorkspace?.classList.remove('hidden');
        setDateNavigationVisible(false);
        syncHeaderActionsForView();

        setActiveWorkspaceTab(DOM.elTabAiInsights);
        await refreshAiInsights();
    });

    document.getElementById('ai-insights-detail-refresh')?.addEventListener('click', async () => {
        const row = aiInsightsCurrentDetailRow();
        if (!row) return;
        await generateAiInsightsSummary(row);
    });

    document.getElementById('ai-insights-detail-close')?.addEventListener('click', () => {
        aiInsightsState.detailRowKey = '';
        syncAiInsightsDetailRefreshButton(null);
        closeModalById('ai-insights-detail-modal');
    });

    // Details Popup handlers
    DOM.elPopupCloseBtn.addEventListener('click', dismissActivityDetailsPopup);

    // Global window Esc key overlay / multi-select dismiss logic
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAppContextMenu();
            hideSettingsTooltip();
            closeDatePicker();
            if (closeTopModal()) return;

            // 1. Clear multi-selected activities and reset icons
            clearSelectedActivityBlocks();

            // 2. Dismiss details popover
            dismissActivityDetailsPopup();
        }
    });
    window.addEventListener('scroll', hideSettingsTooltip);

    // Global dismiss of Details Popover when clicking outside
    window.addEventListener('click', (e) => {
        if (DOM.elActivityDetailsPopup && !DOM.elActivityDetailsPopup.classList.contains('hidden')) {
            if (!e.target.closest('#activity-details-popup') && !e.target.closest('.activity-block')) {
                dismissActivityDetailsPopup();
            }
        }
    });

    // Date navigation controls
    document.getElementById('btn-prev-day').addEventListener('click', async () => {
        const deltaDays = state.currentView === 'aiInsights' ? 1 : (state.timelineMode === 'week' ? 7 : 1);
        state.currentDate.setDate(state.currentDate.getDate() - deltaDays);
        await refreshCurrentDateView();
    });

    document.getElementById('btn-next-day').addEventListener('click', async () => {
        const deltaDays = state.currentView === 'aiInsights' ? 1 : (state.timelineMode === 'week' ? 7 : 1);
        state.currentDate.setDate(state.currentDate.getDate() + deltaDays);
        await refreshCurrentDateView();
    });

    document.getElementById('btn-today').addEventListener('click', async () => {
        await goToToday();
    });

    DOM.elDatePickerInput.addEventListener('change', async () => {
        const [year, month, day] = DOM.elDatePickerInput.value.split('-').map(Number);
        state.currentDate = new Date(year, month - 1, day);
        await refreshCurrentDateView();
    });

    setupDatePicker('header');
    setupDatePicker('projectManual');

    document.addEventListener('click', (e) => {
        const elements = getDatePickerElements(datePickerState.activeKey);
        if (elements.trigger && elements.trigger.contains(e.target)) return;
        if (elements.popover && elements.popover.contains(e.target)) return;
        closeDatePicker();
    });

    // Modal cancel controls
    DOM.elModalBtnCancel.addEventListener('click', closeTimeEntryModal);
    
    // Project dropdown auto-billable sync
    DOM.elModalProjectSelect.addEventListener('change', () => {
        const proj = state.projects.find(p => p.id === DOM.elModalProjectSelect.value);
        if (proj) {
            DOM.elModalBillable.checked = proj.billable;
        }
        if (typeof renderModalTaskSelect === 'function') {
            renderModalTaskSelect('', DOM.elModalProjectSelect.value);
        }
    });

    // Save Time Entry event
    DOM.elModalBtnSave.addEventListener('click', async () => {
        const startMs = parseInputTimeToMs(DOM.elModalStart.value);
        const endMs = parseInputTimeToMs(DOM.elModalEnd.value);
        
        if (!startMs || !endMs || startMs >= endMs) {
            alert('Please enter valid start and end times (e.g. 09:00 to 09:15)');
            return;
        }

        const description = DOM.elModalDescription.value.trim();
        const projectId = DOM.elModalProjectSelect.value;
        const taskId = DOM.elModalTaskSelect ? DOM.elModalTaskSelect.value : '';
        const billable = DOM.elModalBillable.checked;
        const selectedModalActivities = typeof window.getSelectedModalActivities === 'function'
            ? getSelectedModalActivities()
            : (state.currentModalActivities || []);
        if (shouldSaveSelectedModalActivityDurations()
            && getModalSelectedActivitiesDurationMs(selectedModalActivities) <= 0) {
            alert('Select at least one recorded activity to save this entry.');
            return;
        }

        try {
            if (window.isBulkAllocation) {
                const payloads = buildBulkTimeEntryPayloads({
                    start: startMs,
                    end: endMs,
                    description,
                    projectId,
                    taskId,
                    billable,
                    activities: selectedModalActivities
                });

                if (payloads.length === 0) {
                    alert('Selected activities are already logged. Include already logged activities to reassign them.');
                    return;
                }

                const responses = await Promise.all(payloads.map(payload => (
                    fetch(`${API_BASE}/time-entries`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    })
                )));

                if (!responses.every(res => res.ok)) {
                    alert('Failed to save time entry');
                    return;
                }
                
                // Reset selection & UI
                state.selectedActivities.clear();
                state.selectedActivityScopes?.clear?.();
                updateMultiSelectBar();
                const pendingAiSuggestionId = window.pendingAiSuggestionCompletion?.suggestionId || '';
                if (pendingAiSuggestionId && typeof window.completeAiSuggestionAssignment === 'function') {
                    window.completeAiSuggestionAssignment(pendingAiSuggestionId);
                }
                closeTimeEntryModal();
                await refreshData();
            } else {
                // Standard single entry save flow
                const payload = {
                    start: startMs,
                    end: endMs,
                    description,
                    projectId,
                    taskId,
                    billable,
                    activities: normalizeModalActivitiesForTimeEntrySave(selectedModalActivities)
                };
                if (window.editingTimeEntryId && Array.isArray(window.editingTimeEntryPersistedActivities)) {
                    const persistedRange = window.editingTimeEntryPersistedRange || {};
                    if (Number.isFinite(persistedRange.start)
                        && Number.isFinite(persistedRange.end)
                        && persistedRange.end > persistedRange.start) {
                        payload.start = persistedRange.start;
                        payload.end = persistedRange.end;
                    }
                    payload.activities = window.editingTimeEntryPersistedActivities.map(normalizeActivityForTimeEntrySave);
                }
                if (window.editingTimeEntryId) {
                    payload.createdBy = 'manual';
                    payload.autoRuleId = '';
                }

                let res;
                const editingGroupIds = Array.isArray(window.editingTimeEntryGroupIds)
                    ? window.editingTimeEntryGroupIds.filter(Boolean)
                    : [];
                if (editingGroupIds.length > 1) {
                    const [primaryId, ...duplicateIds] = editingGroupIds;
                    const responses = await Promise.all([
                        fetch(`${API_BASE}/time-entries/${primaryId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        }),
                        ...duplicateIds.map(entryId => fetch(`${API_BASE}/time-entries/${entryId}`, {
                            method: 'DELETE'
                        }))
                    ]);

                    if (responses.every(response => response.ok)) {
                        closeTimeEntryModal();
                        await refreshData();
                    } else {
                        alert('Failed to save time entry');
                    }
                    return;
                }

                if (window.editingTimeEntryId) {
                    res = await fetch(`${API_BASE}/time-entries/${window.editingTimeEntryId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } else {
                    res = await fetch(`${API_BASE}/time-entries`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }

                if (res.ok) {
                    closeTimeEntryModal();
                    await refreshData();
                } else {
                    alert('Failed to save time entry');
                }
            }
        } catch (err) {
            console.error('Error saving entry:', err);
        }
    });

    // Delete Time Entry event
    DOM.elModalBtnDelete.addEventListener('click', async () => {
        if (!window.editingTimeEntryId) return;
        
        showCustomConfirm({
            title: 'Delete Time Entry',
            message: 'This logged entry will be permanently removed.',
            actionText: 'Delete',
            actionClass: 'button-danger',
            onConfirm: async () => {
                try {
                    const editingGroupIds = Array.isArray(window.editingTimeEntryGroupIds)
                        ? window.editingTimeEntryGroupIds.filter(Boolean)
                        : [];
                    const idsToDelete = editingGroupIds.length > 1
                        ? editingGroupIds
                        : [window.editingTimeEntryId];
                    const responses = await Promise.all(idsToDelete.map(entryId => (
                        fetch(`${API_BASE}/time-entries/${entryId}`, { method: 'DELETE' })
                    )));
                    if (responses.every(response => response.ok)) {
                        closeTimeEntryModal();
                        await refreshData();
                    }
                } catch (err) {
                    console.error('Error deleting entry:', err);
                }
            }
        });
    });

    // DRAG AND DROP TIMELINE LOGGING SCHEDULER
    let isMouseDown = false;
    let dragBoxVisual = null;
    let pendingEntryCreateDrag = null;
    const ENTRY_DRAG_THRESHOLD_PX = 3;

    function getCellIndexFromY(y) {
        return Math.floor(y / 40);
    }

    function areCompressedTimeEntryRangeEditsDisabled() {
        if (typeof window.isCompressedDayTimelineDirectManipulationDisabled === 'function') {
            return window.isCompressedDayTimelineDirectManipulationDisabled();
        }
        return state.timelineMode !== 'week' && Boolean(state.settings?.hideEmptyActivityRows);
    }

    function getCurrentTimeEntryRowLayout() {
        if (typeof window.buildDayTimelineRowLayout !== 'function') return null;
        const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
        return window.buildDayTimelineRowLayout({ dateStartOfDay, zoom: state.zoom });
    }

    function getSourceCellIndexFromDisplayY(y) {
        const displayCellIndex = getCellIndexFromY(y);
        const rowLayout = getCurrentTimeEntryRowLayout();
        if (!rowLayout || !rowLayout.hideEmptyRows) {
            const maxCellIndex = Math.floor(1440 / state.zoom) - 1;
            return Math.max(0, Math.min(maxCellIndex, displayCellIndex));
        }

        if (rowLayout.displayRowCount <= 0) return 0;
        const boundedDisplayIndex = Math.max(0, Math.min(rowLayout.displayRowCount - 1, displayCellIndex));
        return window.getSourceRowForDisplayRow(rowLayout, boundedDisplayIndex);
    }

    function getBoundedTimeEntryCellIndex(clientY) {
        const rect = DOM.elItemsTimeEntries.getBoundingClientRect();
        return getSourceCellIndexFromDisplayY(clientY - rect.top);
    }

    function setDragBoxGeometry(startCell, endCell) {
        if (!dragBoxVisual) return;

        const firstCell = Math.min(startCell, endCell);
        const lastCell = Math.max(startCell, endCell);
        const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
        const startMs = dateStartOfDay + firstCell * state.zoom * 60 * 1000;
        const endMs = dateStartOfDay + (lastCell + 1) * state.zoom * 60 * 1000;
        const geometry = typeof window.getTimelineDisplayRangeGeometry === 'function'
            ? window.getTimelineDisplayRangeGeometry(startMs, endMs, dateStartOfDay, state.zoom)
            : {
                top: firstCell * 40 + 2,
                height: (lastCell - firstCell + 1) * 40 - 3
            };
        dragBoxVisual.style.top = `${geometry.top}px`;
        dragBoxVisual.style.height = `${Math.max(37, geometry.height)}px`;
    }

    function renderActiveDragFeedback() {
        if (!dragBoxVisual) return;
        const selectedCells = Math.abs(state.dragEndCell - state.dragStartCell) + 1;
        const durationMinutes = selectedCells * state.zoom;
        const instruction = selectedCells > 1
            ? '<span class="drag-box-hint">Click & drag to log</span>'
            : '';
        dragBoxVisual.innerHTML = `
            <div class="drag-box-header">
                <span class="drag-box-label">New time entry</span>
                <span class="drag-box-duration">${durationMinutes} min</span>
            </div>
            ${instruction}
        `;
    }

    function beginCreateDragAtClientY(clientY) {
        const rect = DOM.elItemsTimeEntries.getBoundingClientRect();
        const y = clientY - rect.top;

        state.dragStartCell = getSourceCellIndexFromDisplayY(y);
        state.dragEndCell = state.dragStartCell;

        dragBoxVisual = document.createElement('div');
        dragBoxVisual.className = 'drag-box-visual';

        setDragBoxGeometry(state.dragStartCell, state.dragEndCell);
        renderActiveDragFeedback();

        DOM.elItemsTimeEntries.appendChild(dragBoxVisual);
    }

    const hideTimeEntryHoverPreview = () => {
        if (typeof window.hideTimeEntryHoverPreview === 'function') {
            window.hideTimeEntryHoverPreview();
        }
    };

    DOM.elItemsTimeEntries.addEventListener('mousemove', (e) => {
        if (
            isMouseDown ||
            resizeState.isResizing ||
            e.target.closest('.resize-handle-top') ||
            e.target.closest('.resize-handle-bottom')
        ) {
            hideTimeEntryHoverPreview();
            return;
        }
        if (areCompressedTimeEntryRangeEditsDisabled()) {
            return;
        }

        const rect = DOM.elItemsTimeEntries.getBoundingClientRect();
        const boundedCellIndex = getSourceCellIndexFromDisplayY(e.clientY - rect.top);
        if (typeof window.showTimeEntryHoverPreview === 'function') {
            window.showTimeEntryHoverPreview(boundedCellIndex);
        }
    });

    DOM.elItemsTimeEntries.addEventListener('mouseleave', hideTimeEntryHoverPreview);

    DOM.elItemsTimeEntries.addEventListener('mousedown', (e) => {
        hideTimeEntryHoverPreview();
        // Resize handles keep priority over create-drag.
        if (e.target.closest('.resize-handle-top') || e.target.closest('.resize-handle-bottom')) return;
        // Only left click triggers drag log
        if (e.button !== 0) return;

        const entryBlock = e.target.closest('.time-entry-block');
        if (areCompressedTimeEntryRangeEditsDisabled()) {
            pendingEntryCreateDrag = null;
            return;
        }

        isMouseDown = true;
        if (entryBlock) {
            pendingEntryCreateDrag = {
                startY: e.clientY,
                entryBlock
            };
            return;
        }

        pendingEntryCreateDrag = null;
        beginCreateDragAtClientY(e.clientY);
    });

    // Drag-to-resize mousemove and general mousemove listener
    window.addEventListener('mousemove', (e) => {
        // Scenario 1: Drag column sizing
        if (isResizing) {
            const pct = (e.clientX / window.innerWidth) * 100;
            const elLeftCol = DOM.elGridMemoryAid.closest('.flex');
            if (pct > 25 && pct < 70 && elLeftCol) {
                elLeftCol.style.width = `${pct}%`;
            }
            return;
        }

        // Scenario 2: Active timeline drag to create entry
        if (isMouseDown) {
            if (!dragBoxVisual) {
                if (!pendingEntryCreateDrag) return;
                if (Math.abs(e.clientY - pendingEntryCreateDrag.startY) < ENTRY_DRAG_THRESHOLD_PX) return;

                beginCreateDragAtClientY(pendingEntryCreateDrag.startY);
                window.suppressNextTimeEntryClick = true;
                setTimeout(() => {
                    window.suppressNextTimeEntryClick = false;
                }, 0);
            }

            const currentCell = getBoundedTimeEntryCellIndex(e.clientY);
            
            if (currentCell >= state.dragStartCell) {
                state.dragEndCell = currentCell;
            } else {
                state.dragEndCell = currentCell;
            }
            setDragBoxGeometry(state.dragStartCell, state.dragEndCell);
            renderActiveDragFeedback();
            return;
        }

        // Scenario 3: Time entry block border resize handle dragging
        if (resizeState.isResizing) {
            const deltaY = e.clientY - resizeState.initialY;
            const rowHeight = 40;
            
            if (resizeState.side === 'top') {
                let newTop = resizeState.initialTop + deltaY;
                let newHeight = resizeState.initialHeight - deltaY;
                
                if (newHeight < rowHeight) {
                    const diff = rowHeight - newHeight;
                    newTop -= diff;
                    newHeight = rowHeight;
                }
                
                const snappedTop = Math.round(newTop / rowHeight) * rowHeight;
                const snappedHeight = resizeState.initialTop + resizeState.initialHeight - snappedTop;
                
                if (snappedHeight >= rowHeight && snappedTop >= 0) {
                    resizeState.entryEl.style.top = `${snappedTop}px`;
                    resizeState.entryEl.style.height = `${snappedHeight - 1}px`;
                }
            } else if (resizeState.side === 'bottom') {
                const newHeight = resizeState.initialHeight + deltaY;
                const snappedHeight = Math.round(newHeight / rowHeight) * rowHeight;
                
                if (snappedHeight >= rowHeight) {
                    resizeState.entryEl.style.height = `${snappedHeight - 1}px`;
                }
            }
        }
    });

    window.addEventListener('mouseup', async () => {
        // Scenario 1: drag column sizing
        if (isResizing) {
            isResizing = false;
            document.body?.classList.remove('is-column-resizing');
            document.body.style.cursor = 'default';
        }

        // Scenario 2: Active timeline drag to create entry
        if (isMouseDown) {
            isMouseDown = false;
            if (dragBoxVisual) {
                const cellStart = Math.min(state.dragStartCell, state.dragEndCell);
                const cellEnd = Math.max(state.dragStartCell, state.dragEndCell) + 1;

                const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
                const startMs = dateStartOfDay + cellStart * state.zoom * 60 * 1000;
                const endMs = dateStartOfDay + cellEnd * state.zoom * 60 * 1000;

                const mergedOverlaps = collectSummarizedActivityOverlaps(startMs, endMs);

                openTimeEntryModal(startMs, endMs, '', null, null, false, mergedOverlaps);
                dragBoxVisual?.remove?.();
                dragBoxVisual = null;
            }
            pendingEntryCreateDrag = null;
        }

        // Scenario 3: Time entry block border resize handle dragging release
        if (resizeState.isResizing) {
            const entryEl = resizeState.entryEl;
            const entryId = resizeState.entryId;
            
            resizeState.isResizing = false;
            document.body.style.cursor = 'default';
            
            const topPx = parseInt(entryEl.style.top || '0', 10);
            const heightPx = parseInt(entryEl.style.height || '0', 10) + 1;
            
            const rowHeight = 40;
            const displayStartCell = Math.max(0, Math.round(topPx / rowHeight));
            const displaySpan = Math.max(1, Math.round(heightPx / rowHeight));
            const rowLayout = getCurrentTimeEntryRowLayout();
            const startCell = rowLayout?.hideEmptyRows
                ? window.getSourceRowForDisplayRow(rowLayout, displayStartCell)
                : displayStartCell;
            const endSourceCell = rowLayout?.hideEmptyRows
                ? window.getSourceRowForDisplayRow(rowLayout, displayStartCell + displaySpan - 1) + 1
                : startCell + displaySpan;
            
            const startMs = resizeState.dateStartOfDay + startCell * state.zoom * 60 * 1000;
            const endMs = resizeState.dateStartOfDay + endSourceCell * state.zoom * 60 * 1000;
            
            const entry = state.timeEntries.find(ent => ent.id === entryId);
            if (entry) {
                const blockActivities = collectSummarizedActivityOverlaps(startMs, endMs);
                if (blockActivities.length > 1) {
                    window.editingTimeEntryId = entry.id;
                    window.editingTimeEntryGroupIds = null;
                    window.editingTimeEntryPersistedRange = null;
                    window.editingTimeEntryPersistedActivities = null;
                    openTimeEntryModal(
                        startMs,
                        endMs,
                        entry.description,
                        entry.projectId,
                        entry.billable,
                        false,
                        blockActivities,
                        entry.taskId || ''
                    );
                    return;
                }

                const payload = buildManualTimeEntryUpdatePayload(entry, startMs, endMs, blockActivities);
                
                try {
                    const res = await fetch(`${API_BASE}/time-entries/${entryId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    
                    if (res.ok) {
                        await refreshData();
                    } else {
                        alert('Failed to save resized time entry');
                        await refreshData();
                    }
                } catch (err) {
                    console.error('Error saving resized entry:', err);
                    await refreshData();
                }
            }
        }
    });

    // Dynamic Resizing for columns
    const elResizeHandle = document.getElementById('resize-handle');
    let isResizing = false;

    if (elResizeHandle) {
        elResizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isResizing = true;
            document.body?.classList.add('is-column-resizing');
            document.body.style.cursor = 'col-resize';
        });
    }

    // Jump to current time button triggers
    const btnJumpCurrent = document.getElementById('btn-jump-current');
    if (btnJumpCurrent) {
        btnJumpCurrent.addEventListener('click', requestJumpToCurrentTime);
    }

    // Project Creator modal triggers
    const btnNewProject = document.getElementById('btn-new-project');
    if (btnNewProject) {
        btnNewProject.addEventListener('click', () => {
            window.editingProjectId = null;
            DOM.elProjName.value = '';
            if (DOM.elProjDescription) DOM.elProjDescription.value = '';
            DOM.elProjColor.value = '#3b82f6';
            
            // Reset rates info
            const rateTypeSelect = document.getElementById('project-rate-type');
            const hourlyRateInput = document.getElementById('project-hourly-rate');
            const fixedRateInput = document.getElementById('project-fixed-rate');
            const currencySelect = document.getElementById('project-currency');
            
            if (rateTypeSelect) rateTypeSelect.value = 'none';
            if (hourlyRateInput) hourlyRateInput.value = '';
            if (fixedRateInput) fixedRateInput.value = '';
            if (currencySelect) currencySelect.value = '$';
            
            toggleProjectRateFields();
            refreshCustomSelects(DOM.elProjModal);
            highlightSelectedColorCircle('#3b82f6');
            
            DOM.elProjModal.querySelector('h3').innerText = 'Create New Project';
            const btnSave = DOM.getElProjBtnSave || document.getElementById('project-btn-save');
            if (btnSave) btnSave.innerText = 'Create';
            DOM.elProjModal.classList.remove('hidden');
        });
    }

    const btnProjPageNew = document.getElementById('btn-projects-page-new');
    if (btnProjPageNew) {
        btnProjPageNew.addEventListener('click', () => {
            window.editingProjectId = null;
            DOM.elProjName.value = '';
            if (DOM.elProjDescription) DOM.elProjDescription.value = '';
            DOM.elProjColor.value = '#3b82f6';
            
            const rateTypeSelect = document.getElementById('project-rate-type');
            const hourlyRateInput = document.getElementById('project-hourly-rate');
            const fixedRateInput = document.getElementById('project-fixed-rate');
            const currencySelect = document.getElementById('project-currency');
            
            if (rateTypeSelect) rateTypeSelect.value = 'none';
            if (hourlyRateInput) hourlyRateInput.value = '';
            if (fixedRateInput) fixedRateInput.value = '';
            if (currencySelect) currencySelect.value = '$';
            
            toggleProjectRateFields();
            refreshCustomSelects(DOM.elProjModal);
            highlightSelectedColorCircle('#3b82f6');
            
            DOM.elProjModal.querySelector('h3').innerText = 'Create New Project';
            const btnSave = DOM.getElProjBtnSave || document.getElementById('project-btn-save');
            if (btnSave) btnSave.innerText = 'Create';
            DOM.elProjModal.classList.remove('hidden');
        });
    }

    DOM.elProjBtnCancel.addEventListener('click', () => {
        DOM.elProjModal.classList.add('hidden');
        window.editingProjectId = null;
    });

    const elProjBtnSaveNode = DOM.getElProjBtnSave || document.getElementById('project-btn-save');
    if (elProjBtnSaveNode) {
        elProjBtnSaveNode.addEventListener('click', async () => {
            const name = DOM.elProjName.value.trim();
            if (!name) {
                alert('Please enter a project name.');
                return;
            }

            const rateTypeSelect = document.getElementById('project-rate-type');
            const hourlyRateInput = document.getElementById('project-hourly-rate');
            const fixedRateInput = document.getElementById('project-fixed-rate');
            const currencySelect = document.getElementById('project-currency');
            const rateType = rateTypeSelect ? rateTypeSelect.value : 'none';

            const payload = {
                name,
                description: DOM.elProjDescription ? DOM.elProjDescription.value.trim() : '',
                color: DOM.elProjColor.value,
                billable: rateType === 'hourly' || rateType === 'fixed',
                rateType,
                hourlyRate: hourlyRateInput && hourlyRateInput.value ? parseFloat(hourlyRateInput.value) : 0,
                fixedRate: fixedRateInput && fixedRateInput.value ? parseFloat(fixedRateInput.value) : 0,
                currency: currencySelect ? currencySelect.value : '$'
            };

            try {
                let res;
                if (window.editingProjectId) {
                    res = await fetch(`${API_BASE}/projects/${window.editingProjectId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } else {
                    res = await fetch(`${API_BASE}/projects`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }

                if (res.ok) {
                    DOM.elProjModal.classList.add('hidden');
                    window.editingProjectId = null;
                    await fetchProjects();
                    if (state.currentView === 'projects') {
                        renderProjectsPage();
                    } else {
                        await refreshData();
                    }
                } else {
                    alert('Failed to save project');
                }
            } catch (err) {
                console.error('Error creating/editing project:', err);
            }
        });
    }

    // Selection controls in floating bar
    DOM.elBtnClearSelection.addEventListener('click', () => {
        clearSelectedActivityBlocks();
    });

    DOM.elBtnSelectSimilar?.addEventListener('click', () => {
        if (typeof openSimilarSelectionModal === 'function') {
            openSimilarSelectionModal();
        } else {
            selectSimilarActivities();
        }
    });

    DOM.elBtnAssignSelected.addEventListener('click', () => {
        const selectedEls = Array.from(DOM.elItemsMemoryAid.querySelectorAll('.activity-block.selected'));
        if (selectedEls.length === 0) return;

        let minStartCell = Infinity;
        let maxEndCell = -Infinity;
        const overlaps = [];

        const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);

        selectedEls.forEach(el => {
            const sc = parseInt(el.dataset.startCell, 10);
            const sp = parseInt(el.dataset.span, 10);
            if (sc < minStartCell) minStartCell = sc;
            if (sc + sp > maxEndCell) maxEndCell = sc + sp;
            
            // Accrue activities overlapping blocks to accurately record assigned items
            const blockOverlaps = getActivityBlockAssignmentOverlaps(el);
            if (blockOverlaps.length === 0) return;

            try {
                const blockData = getActivityBlockData(el);
                const blockKey = getActivitySummaryKey(blockData);
                const blockSessionKey = getSelectedActivityBlockSessionKey(el);
                const similarityScope = getSelectedActivityBlockSimilarityScope(el);
                const selectedSimilarityKeys = Array.isArray(similarityScope.assignmentKeys)
                    ? similarityScope.assignmentKeys
                    : [];
                const selectedSimilarityKeySet = new Set(selectedSimilarityKeys);
                const activityMatchesSelectedAssignmentKeys = activity => {
                    if (selectedSimilarityKeySet.size === 0) return false;
                    const keys = typeof getActivityAssignmentKeys === 'function'
                        ? getActivityAssignmentKeys(activity)
                        : [
                            typeof getActivitySummaryKey === 'function' ? getActivitySummaryKey(activity) : ''
                        ].filter(Boolean);
                    return keys.some(key => selectedSimilarityKeySet.has(key));
                };
                const { start: blockStart, end: blockEnd } = getSelectedActivityBlockTimeRange(el, sc, sc + sp, dateStartOfDay);
                let matchingOverlaps = [];
                if (selectedSimilarityKeys.length > 0) {
                    matchingOverlaps = blockOverlaps.filter(activityMatchesSelectedAssignmentKeys);
                } else if (blockSessionKey) {
                    matchingOverlaps = blockOverlaps.filter(overlap => (
                        getActivityStreamSessionKeyForAssignment(overlap) === blockSessionKey
                    ));
                    if (matchingOverlaps.length === 0) {
                        matchingOverlaps = blockOverlaps.filter(overlap => (
                            getActivitySummaryKey(overlap) === blockKey
                        ));
                    }
                } else {
                    matchingOverlaps = blockOverlaps.filter(overlap => (
                        getActivitySummaryKey(overlap) === blockKey
                    ));
                }
                if (selectedSimilarityKeys.length > 0 && matchingOverlaps.length === 0) {
                    return;
                }
                const shouldUseVisibleRowUnit = (
                    (selectedSimilarityKeys.length > 0 && ['app', 'host'].includes(similarityScope.mode))
                    || (selectedSimilarityKeys.length === 0 && Boolean(blockSessionKey))
                );
                const rowUnitActivity = shouldUseVisibleRowUnit
                    ? buildVisibleRowUnitAssignmentActivity(blockData, matchingOverlaps, blockStart, blockEnd)
                    : null;
                if (rowUnitActivity) {
                    overlaps.push(applySimilarityScopeToAssignmentActivity(rowUnitActivity, similarityScope));
                    return;
                }
                const selectedSummaries = typeof window.summarizeActivityOverlaps === 'function'
                    ? summarizeActivityOverlaps(matchingOverlaps, blockStart, blockEnd)
                    : matchingOverlaps;
                const assignmentActivities = selectedSummaries.flatMap(overlap => (
                    buildVisibleAssignmentActivities(blockOverlaps, overlap, blockStart, blockEnd, {
                        preserveDisplayBounds: true
                    })
                        .map(activity => applySimilarityScopeToAssignmentActivity(activity, similarityScope))
                ));
                overlaps.push(...(assignmentActivities.length > 0
                    ? assignmentActivities
                    : matchingOverlaps.map(overlap => applySimilarityScopeToAssignmentActivity({
                        ...overlap,
                        assignmentStart: blockStart,
                        assignmentEnd: blockEnd,
                        assignmentSource: 'activity-stream'
                    }, similarityScope)).map(activity => (
                        withActivityStreamDisplayBounds(activity, blockStart, blockEnd)
                    ))));
            } catch (e) {}
        });

        const startMs = dateStartOfDay + minStartCell * state.zoom * 60 * 1000;
        const endMs = dateStartOfDay + maxEndCell * state.zoom * 60 * 1000;

        const selectedOverlaps = overlaps.map(decorateSelectedAssignmentActivity).sort((first, second) => {
            const startA = Number.isFinite(first.start) ? first.start : Number.MAX_SAFE_INTEGER;
            const startB = Number.isFinite(second.start) ? second.start : Number.MAX_SAFE_INTEGER;
            return startA - startB;
        });

        if (selectedOverlaps.length === 0) return;
        openTimeEntryModal(startMs, endMs, '', null, null, true, selectedOverlaps);
    });
}

function setTimelineNavigationControlsVisible(isVisible) {
    const timelineControls = document.getElementById('timeline-navigation-controls');
    if (!timelineControls) return;

    timelineControls.classList.toggle('hidden', !isVisible);
    if (isVisible) return;

    const zoomMenu = document.getElementById('zoom-dropdown-menu');
    const zoomCaret = document.getElementById('zoom-dropdown-caret');
    zoomMenu?.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
    zoomMenu?.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    zoomCaret?.classList.remove('rotate-180');
}

function setDateNavigationVisible(isVisible) {
    const dateNavigation = document.getElementById('date-navigation');
    if (!dateNavigation) return;
    if (!isVisible) closeDatePicker();
    setTimelineNavigationControlsVisible(isVisible);
    dateNavigation.classList.toggle('hidden', !isVisible);
}

function setActiveWorkspaceTab(activeTab) {
    [DOM.elTabTimeline, DOM.elTabProjects, DOM.elTabStats, DOM.elTabAiInsights].forEach(tab => {
        const active = tab === activeTab;
        if (!tab) return;
        tab.classList.toggle('app-tab--active', active);
        if (typeof tab.setAttribute === 'function') {
            tab.setAttribute('aria-selected', String(active));
        }
    });
}

async function openTimelineDate(date, { mode = 'day' } = {}) {
    const targetDate = Number.isFinite(date?.getTime?.()) ? new Date(date) : parseLocalDateValue(date);
    if (!targetDate) return;

    state.currentView = 'timeline';
    DOM.elSchedulerWorkspace.classList.remove('hidden');
    DOM.elProjectsWorkspace.classList.add('hidden');
    DOM.elStatsWorkspace.classList.add('hidden');
    DOM.elAiInsightsWorkspace?.classList.add('hidden');
    setDateNavigationVisible(true);
    syncHeaderActionsForView();
    setActiveWorkspaceTab(DOM.elTabTimeline);

    if (mode === 'day') {
        await setTimelineMode('day', { refresh: false });
    }

    state.currentDate = targetDate;
    await refreshCurrentDateView();
}

function parseLocalDateValue(value) {
    if (!value || typeof value !== 'string') return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const date = new Date(year, month - 1, day);
    return Number.isFinite(date.getTime()) ? date : null;
}

function formatProjectManualDateLabel(date) {
    if (!Number.isFinite(date?.getTime?.())) return 'Today';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getProjectManualDate() {
    const input = document.getElementById('proj-details-manual-date');
    return parseLocalDateValue(input?.value) || new Date();
}

function setProjectManualDate(date) {
    const selectedDate = Number.isFinite(date?.getTime?.()) ? date : new Date();
    const input = document.getElementById('proj-details-manual-date');
    const label = document.getElementById('proj-details-manual-date-label');
    if (input) input.value = getFormattedDate(selectedDate);
    if (label) label.textContent = formatProjectManualDateLabel(selectedDate);
}

function getDatePickerConfig(key = datePickerState.activeKey || 'header') {
    return datePickerConfigs[key] || null;
}

function getDatePickerElements(key = datePickerState.activeKey) {
    const config = getDatePickerConfig(key);
    if (!config) return {};
    return {
        trigger: document.getElementById(config.triggerId),
        popover: document.getElementById(config.popoverId),
        prev: document.getElementById(config.prevId),
        next: document.getElementById(config.nextId),
        close: document.getElementById(config.closeId),
        today: document.getElementById(config.todayId),
        monthLabel: document.getElementById(config.monthLabelId),
        weekdays: document.getElementById(config.weekdaysId),
        days: document.getElementById(config.daysId)
    };
}

function setupDatePicker(key) {
    const config = getDatePickerConfig(key);
    const elements = getDatePickerElements(key);
    if (!config || !elements.trigger || !elements.popover || elements.trigger.dataset.datePickerReady === 'true') return;
    elements.trigger.dataset.datePickerReady = 'true';

    elements.trigger.addEventListener('click', event => {
        if (elements.popover.contains(event.target)) return;
        event.stopPropagation();
        openDatePicker(key, elements.trigger);
    });

    elements.popover.addEventListener('click', event => {
        event.stopPropagation();
    });

    elements.prev?.addEventListener('click', () => {
        shiftDatePickerMonth(-1);
    });

    elements.next?.addEventListener('click', () => {
        shiftDatePickerMonth(1);
    });

    elements.close?.addEventListener('click', () => {
        closeDatePicker();
    });

    elements.today?.addEventListener('click', async () => {
        if (typeof config.onToday === 'function') {
            await config.onToday();
        }
    });
}

function setDatePickerTriggerExpanded(trigger, expanded) {
    if (trigger && typeof trigger.setAttribute === 'function') {
        trigger.setAttribute('aria-expanded', String(expanded));
    }
}

function resetDatePickerPopoverPosition(popover) {
    if (!popover?.style) return;
    ['position', 'top', 'left', 'right', 'bottom', 'width'].forEach(prop => {
        popover.style[prop] = '';
    });
}

function resolveDatePickerOpenArgs(keyOrTrigger, trigger = null) {
    if (typeof keyOrTrigger === 'string') {
        return { key: keyOrTrigger, trigger };
    }
    return { key: 'header', trigger: keyOrTrigger };
}

function openDatePicker(keyOrTrigger = 'header', trigger = null) {
    const { key, trigger: resolvedTrigger } = resolveDatePickerOpenArgs(keyOrTrigger, trigger);
    const config = getDatePickerConfig(key);
    const elements = getDatePickerElements(key);
    if (!config || !elements.popover) return;

    if (datePickerState.activeKey && datePickerState.activeKey !== key) {
        closeDatePicker(datePickerState.activeKey);
    }
    setDatePickerTriggerExpanded(datePickerState.activeTrigger, false);
    datePickerState.activeKey = key;
    datePickerState.activeTrigger = resolvedTrigger || elements.trigger;
    setDatePickerTriggerExpanded(datePickerState.activeTrigger, true);
    const selectedDate = config.getSelectedDate?.() || new Date();
    datePickerState.viewedMonth = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        1
    );
    renderDatePicker(key);
    resetDatePickerPopoverPosition(elements.popover);
    elements.popover.classList.remove('hidden');
}

function closeDatePicker(key = datePickerState.activeKey || 'header') {
    const elements = getDatePickerElements(key);
    if (!elements.popover) return;
    elements.popover.classList.add('hidden');
    setDatePickerTriggerExpanded(datePickerState.activeTrigger, false);
    if (!key || key === datePickerState.activeKey) {
        datePickerState.activeKey = null;
        datePickerState.activeTrigger = null;
    }
    resetDatePickerPopoverPosition(elements.popover);
}

function shiftDatePickerMonth(delta) {
    const key = datePickerState.activeKey || 'header';
    const config = getDatePickerConfig(key);
    const selectedDate = config?.getSelectedDate?.() || new Date();
    if (!datePickerState.viewedMonth) {
        datePickerState.viewedMonth = new Date(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            1
        );
    }
    datePickerState.viewedMonth.setMonth(datePickerState.viewedMonth.getMonth() + delta);
    renderDatePicker(key);
}

function renderDatePicker(key = datePickerState.activeKey || 'header') {
    const config = getDatePickerConfig(key);
    const elements = getDatePickerElements(key);
    if (!config || !elements.monthLabel || !elements.weekdays || !elements.days) return;
    const selectedDate = config.getSelectedDate?.() || new Date();

    const viewedMonth = datePickerState.viewedMonth || new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        1
    );
    const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
    elements.monthLabel.innerText = monthFormatter.format(viewedMonth);

    elements.weekdays.innerHTML = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
        .map(day => `<div class="h-7 flex items-center justify-center">${day}</div>`)
        .join('');

    const gridStart = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth(), 1);
    const mondayOffset = (gridStart.getDay() + 6) % 7;
    gridStart.setDate(gridStart.getDate() - mondayOffset);

    const todayStr = getFormattedDate(new Date());
    const selectedStr = getFormattedDate(selectedDate);
    const currentMonth = viewedMonth.getMonth();
    const daysHtml = [];

    for (let i = 0; i < 42; i++) {
        const day = new Date(gridStart);
        day.setDate(gridStart.getDate() + i);
        const dateStr = getFormattedDate(day);
        const isSelected = dateStr === selectedStr;
        const isToday = dateStr === todayStr;
        const isOutsideMonth = day.getMonth() !== currentMonth;
        const dayClasses = [
            'calendar-day',
            isSelected ? 'calendar-day--selected' : '',
            isOutsideMonth ? 'calendar-day--outside' : '',
            isToday && !isSelected ? 'calendar-day--today' : ''
        ].join(' ');

        daysHtml.push(`
            <button type="button" class="${dayClasses}" data-date="${dateStr}" aria-label="${dateStr}">
                ${day.getDate()}
            </button>
        `);
    }

    elements.days.innerHTML = daysHtml.join('');
    elements.days.querySelectorAll('button[data-date]').forEach(button => {
        button.addEventListener('click', async (e) => {
            e.stopPropagation();
            const [year, month, day] = button.dataset.date.split('-').map(Number);
            await config.onSelect?.(new Date(year, month - 1, day));
        });
    });
}

// Initializer
async function init() {
    if (window.OrielData && window.OrielData.isNative) {
        try {
            const nativeSettings = await window.OrielData.request('settings.get', {});
            Object.assign(state.settings, nativeSettings);
            if (typeof window.applyTheme === 'function') {
                window.applyTheme(state.settings.theme);
            }
            syncEmptyActivityRowsToggle();
        } catch (error) {
            console.error('Error loading native settings:', error);
        }
    }
    setupDateDisplay();
    syncAiInsightsDateControl();
    setupMainEventListeners();
    if (window.setupScrollSync) setupScrollSync();
    
    await fetchProjects();
    await fetchRules();

    if (window.initAiSidebar) {
        await window.initAiSidebar();
    }

    if (window.initReporting) {
        window.initReporting();
    }
    
    // Set up preset color palettes grid
    renderPresetColorGrid();
    
    await refreshData();
    
    // Jump to the current hour at startup (auto-center)
    setTimeout(requestTimelineCurrentJump, 50);
    setTimeout(requestTimelineCurrentJump, 300);
    setTimeout(requestTimelineCurrentJump, 800);
    
    // Store original page-load real-world system today's date
    window.systemTodayDateStr = getFormattedDate(new Date());
    
    // Sync polling for real-time updates every 10 seconds
    setInterval(async () => {
        // Automatically rollover state.currentDate if real-world calendar day advances
        const currentRealTodayStr = getFormattedDate(new Date());
        if (currentRealTodayStr !== window.systemTodayDateStr) {
            if (getFormattedDate(state.currentDate) === window.systemTodayDateStr) {
                state.currentDate = new Date();
                clearTimelineSelectionForDateChange();
                setupDateDisplay();
                syncAiInsightsDateControl();
            }
            window.systemTodayDateStr = currentRealTodayStr;
        }
        await refreshData();
    }, 10000);
}

// Bind to window
window.goToToday = goToToday;
window.setProjectManualDate = setProjectManualDate;
window.setTimelineMode = setTimelineMode;
window.openTimelineDate = openTimelineDate;
window.syncTimelineModeControls = syncTimelineModeControls;
window.init = init;

// Auto-initialize when the DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
