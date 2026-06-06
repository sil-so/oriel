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
                    const check = b.querySelector('.ph-check');
                    if (b === btn) {
                        b.classList.add('is-selected');
                        if (check) {
                            check.classList.remove('opacity-0');
                            check.classList.add('opacity-100');
                        }
                    } else {
                        b.classList.remove('is-selected');
                        if (check) {
                            check.classList.add('opacity-0');
                            check.classList.remove('opacity-100');
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
}

function closeAllCustomSelects(exceptWrapper = null) {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('.custom-select-wrapper.is-open').forEach(wrapper => {
        if (wrapper !== exceptWrapper) closeCustomSelect(wrapper);
    });
}

function hasTimeRange(activity) {
    return Number.isFinite(activity?.start)
        && Number.isFinite(activity?.end)
        && activity.end > activity.start;
}

function timeEntryActivitySnapshot(activity) {
    const { sources, ...snapshot } = activity || {};
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
    const duration = getActivityDurationMs(activity);
    const start = Number.isFinite(activity?.assignmentStart)
        ? activity.assignmentStart
        : activity?.start;
    const end = Number.isFinite(activity?.assignmentEnd) && activity.assignmentEnd > start
        ? activity.assignmentEnd
        : activity?.end;

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
            : state.zoom
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
    return (activities || []).map(normalizer);
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
    if (isActivityStreamAssignment(activity)) {
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
        return [{ start, end, description, projectId, taskId, billable, activities }];
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

function buildVisibleAssignmentActivities(blockOverlaps, selectedActivity, rangeStart, rangeEnd) {
    if (typeof window.buildActivityStreamSummaryAssignmentActivity === 'function') {
        const assignmentActivity = buildActivityStreamSummaryAssignmentActivity(selectedActivity, rangeStart, rangeEnd, state.zoom);
        return assignmentActivity ? [assignmentActivity] : [];
    }

    const duration = getActivityDurationMs(selectedActivity)
        || getActivityDurationWithinRange(selectedActivity, rangeStart, rangeEnd);
    if (duration <= 0) return [];

    return [timeEntryActivitySnapshot({
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
    })];
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
        emptyOption.className = 'custom-select-option';
        emptyOption.disabled = true;
        emptyOption.textContent = 'No options';
        custom.menu.appendChild(emptyOption);
        return;
    }

    options.forEach(option => {
        const menuOption = document.createElement('button');
        const isSelected = option.value === select.value;
        menuOption.type = 'button';
        menuOption.className = `custom-select-option${isSelected ? ' is-selected' : ''}`;
        menuOption.disabled = option.disabled;
        menuOption.setAttribute('role', 'option');
        menuOption.setAttribute('aria-selected', String(isSelected));

        const optionLabel = document.createElement('span');
        optionLabel.className = 'custom-select-option-label';
        optionLabel.textContent = option.textContent.trim();

        const check = document.createElement('i');
        check.className = `ph ph-check text-blue-400 text-xs shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0'}`;

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
    viewedMonth: null
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
    clearTimelineSelectionForDateChange();
    setupDateDisplay();
    await refreshData();
    requestTimelineCurrentJump();
    if (closePicker) {
        closeDatePicker();
    }
}

function clearTimelineSelectionForDateChange() {
    if (typeof clearSelectedActivityBlocks === 'function') {
        clearSelectedActivityBlocks();
    } else {
        state.selectedActivities?.clear();
    }

    if (typeof dismissActivityDetailsPopup === 'function') {
        dismissActivityDetailsPopup();
    }

    if (typeof handleAiDateChanged === 'function') {
        handleAiDateChanged();
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

    if (modalId === 'time-entry-modal' && typeof closeTimeEntryModal === 'function') {
        closeTimeEntryModal();
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
        'settings-modal',
        'rules-modal',
        'project-modal',
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
        'settings-modal',
        'rules-modal',
        'project-modal',
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

    const exclusionFieldLabels = {
        app: 'Application',
        title: 'Window Title',
        url: 'URL'
    };

    function renderTrackingExclusions() {
        if (!settingsExclusionsList) return;
        settingsExclusionsList.replaceChildren();

        if (!state.trackingExclusions.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state text-[11px] py-2';
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
            empty.className = 'empty-state text-[11px] py-2';
            empty.textContent = 'No title cleanup rules configured.';
            settingsTitleCleanupList.appendChild(empty);
            return;
        }

        rules.forEach((rule, index) => {
            const row = document.createElement('div');
            row.className = 'surface-panel flex flex-col gap-2 px-3 py-2';

            const top = document.createElement('div');
            top.className = 'flex items-center gap-2';

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

            const name = document.createElement('input');
            name.type = 'text';
            name.className = 'field flex-1 px-3 text-[12px]';
            name.value = rule.name;
            name.setAttribute('aria-label', 'Title cleanup rule name');

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'text-gray-500 hover:text-red-400 transition shrink-0';
            removeButton.title = 'Remove title cleanup rule';
            removeButton.innerHTML = '<i class="ph ph-trash text-sm"></i>';

            top.appendChild(toggleLabel);
            top.appendChild(name);
            top.appendChild(removeButton);

            const pattern = document.createElement('input');
            pattern.type = 'text';
            pattern.className = 'field px-3 text-[12px]';
            pattern.value = rule.pattern;
            pattern.setAttribute('aria-label', 'Regex pattern to remove');

            const scopes = document.createElement('div');
            scopes.className = 'grid grid-cols-2 gap-2';
            const appScope = document.createElement('input');
            appScope.type = 'text';
            appScope.className = 'field px-3 text-[12px]';
            appScope.placeholder = 'App contains';
            appScope.value = rule.appContains || '';
            appScope.setAttribute('aria-label', 'Optional app scope');
            const urlScope = document.createElement('input');
            urlScope.type = 'text';
            urlScope.className = 'field px-3 text-[12px]';
            urlScope.placeholder = 'URL contains';
            urlScope.value = rule.urlContains || '';
            urlScope.setAttribute('aria-label', 'Optional URL scope');
            scopes.appendChild(appScope);
            scopes.appendChild(urlScope);

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
                await persistTitleCleanupRules(nextRules);
            };

            toggle.addEventListener('change', saveEditedRule);
            name.addEventListener('change', saveEditedRule);
            pattern.addEventListener('change', saveEditedRule);
            appScope.addEventListener('change', saveEditedRule);
            urlScope.addEventListener('change', saveEditedRule);
            removeButton.addEventListener('click', async () => {
                const nextRules = normalizeSettingsTitleCleanupRules(state.settings.titleCleanupRules);
                nextRules.splice(index, 1);
                await persistTitleCleanupRules(nextRules);
            });

            row.appendChild(top);
            row.appendChild(pattern);
            row.appendChild(scopes);
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

    if (btnSettings) {
        btnSettings.addEventListener('click', async () => {
            if (window.OrielData && window.OrielData.isNative) {
                try {
                    const nativeSettings = await window.OrielData.request('settings.get', {});
                    Object.assign(state.settings, nativeSettings);
                    if (typeof window.applyTheme === 'function') {
                        window.applyTheme(state.settings.theme);
                    }
                    syncEmptyActivityRowsToggle();
                } catch (error) {
                    console.error('Error fetching native settings:', error);
                }
            }
            await refreshLogoDevKeyStatus();
            syncSettingsControls();
            if (settingsModal) {
                settingsModal.classList.remove('hidden');
            }
            if (typeof window.fetchTrackingExclusions === 'function') {
                await window.fetchTrackingExclusions();
                renderTrackingExclusions();
            }
        });
    }

    if (settingsModalBtnClose) {
        settingsModalBtnClose.addEventListener('click', () => {
            if (settingsModal) settingsModal.classList.add('hidden');
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
                    title: 'Purge All Data',
                    message: 'Are you sure you want to wipes all local time tracker records permanently? This cannot be undone.',
                    actionText: 'Purge Permanently',
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

    function setActiveWorkspaceTab(activeTab) {
        [DOM.elTabTimeline, DOM.elTabProjects, DOM.elTabStats].forEach(tab => {
            const active = tab === activeTab;
            tab.classList.toggle('app-tab--active', active);
            if (typeof tab.setAttribute === 'function') {
                tab.setAttribute('aria-selected', String(active));
            }
        });
    }

    DOM.elTimelineModeDay?.addEventListener('click', async () => {
        await setTimelineMode('day');
    });

    DOM.elTimelineModeWeek?.addEventListener('click', async () => {
        await setTimelineMode('week');
    });
    syncTimelineModeControls();

    // View navigation tab workspace switchers
    DOM.elTabTimeline.addEventListener('click', () => {
        state.currentView = 'timeline';
        DOM.elSchedulerWorkspace.classList.remove('hidden');
        DOM.elProjectsWorkspace.classList.add('hidden');
        DOM.elStatsWorkspace.classList.add('hidden');
        setDateNavigationVisible(true);
        syncTimelineModeControls();

        setActiveWorkspaceTab(DOM.elTabTimeline);

        refreshData();
    });

    DOM.elTabProjects.addEventListener('click', () => {
        state.currentView = 'projects';
        DOM.elSchedulerWorkspace.classList.add('hidden');
        DOM.elProjectsWorkspace.classList.remove('hidden');
        DOM.elStatsWorkspace.classList.add('hidden');
        setDateNavigationVisible(false);

        setActiveWorkspaceTab(DOM.elTabProjects);

        renderProjectsPage();
    });

    DOM.elTabStats.addEventListener('click', () => {
        state.currentView = 'stats';
        DOM.elSchedulerWorkspace.classList.add('hidden');
        DOM.elProjectsWorkspace.classList.add('hidden');
        DOM.elStatsWorkspace.classList.remove('hidden');
        setDateNavigationVisible(false);

        setActiveWorkspaceTab(DOM.elTabStats);

        if (window.refreshStatsView) {
            window.refreshStatsView();
        }
    });

    // Details Popup handlers
    DOM.elPopupCloseBtn.addEventListener('click', dismissActivityDetailsPopup);

    // Global window Esc key overlay / multi-select dismiss logic
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDatePicker();
            if (closeTopModal()) return;

            // 1. Clear multi-selected activities and reset icons
            clearSelectedActivityBlocks();

            // 2. Dismiss details popover
            dismissActivityDetailsPopup();
        }
    });

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
        state.currentDate.setDate(state.currentDate.getDate() - (state.timelineMode === 'week' ? 7 : 1));
        clearTimelineSelectionForDateChange();
        setupDateDisplay();
        await refreshData();
    });

    document.getElementById('btn-next-day').addEventListener('click', async () => {
        state.currentDate.setDate(state.currentDate.getDate() + (state.timelineMode === 'week' ? 7 : 1));
        clearTimelineSelectionForDateChange();
        setupDateDisplay();
        await refreshData();
    });

    document.getElementById('btn-today').addEventListener('click', async () => {
        await goToToday();
    });

    DOM.elDatePickerInput.addEventListener('change', async () => {
        const [year, month, day] = DOM.elDatePickerInput.value.split('-').map(Number);
        state.currentDate = new Date(year, month - 1, day);
        clearTimelineSelectionForDateChange();
        setupDateDisplay();
        await refreshData();
    });

    const datePickerTrigger = document.getElementById('date-picker-trigger');
    if (datePickerTrigger) {
        datePickerTrigger.addEventListener('click', (e) => {
            if (e.target.closest('#date-picker-popover')) return;
            openDatePicker();
        });
    }

    const datePickerPopover = document.getElementById('date-picker-popover');
    if (datePickerPopover) {
        datePickerPopover.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    const btnDatePickerPrev = document.getElementById('date-picker-prev-month');
    if (btnDatePickerPrev) {
        btnDatePickerPrev.addEventListener('click', () => {
            shiftDatePickerMonth(-1);
        });
    }

    const btnDatePickerNext = document.getElementById('date-picker-next-month');
    if (btnDatePickerNext) {
        btnDatePickerNext.addEventListener('click', () => {
            shiftDatePickerMonth(1);
        });
    }

    const btnDatePickerClose = document.getElementById('date-picker-clear');
    if (btnDatePickerClose) {
        btnDatePickerClose.addEventListener('click', () => {
            closeDatePicker();
        });
    }

    const btnDatePickerToday = document.getElementById('date-picker-today');
    if (btnDatePickerToday) {
        btnDatePickerToday.addEventListener('click', async () => {
            await goToToday({ closePicker: true });
        });
    }

    document.addEventListener('click', (e) => {
        if (!datePickerTrigger || e.target.closest('#date-picker-trigger')) return;
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
                updateMultiSelectBar();
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
            message: 'Are you sure you want to delete this logged time entry permanently?',
            actionText: 'Delete Entry',
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
            DOM.elProjColor.value = '#3b82f6';
            DOM.elProjBillable.checked = true;
            
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
            DOM.elProjColor.value = '#3b82f6';
            DOM.elProjBillable.checked = true;
            
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

            const payload = {
                name,
                color: DOM.elProjColor.value,
                billable: DOM.elProjBillable.checked,
                rateType: rateTypeSelect ? rateTypeSelect.value : 'none',
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
        selectSimilarActivities();
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
            if (el.dataset.overlaps) {
                try {
                    const blockOverlaps = JSON.parse(decodeURIComponent(el.dataset.overlaps));
                    const blockKey = getActivitySummaryKey(getActivityBlockData(el));
                    const selectedSimilarityKeys = typeof getActivityBlockSelectedSimilarityKeys === 'function'
                        ? getActivityBlockSelectedSimilarityKeys(el)
                        : [];
                    const blockStart = dateStartOfDay + sc * state.zoom * 60 * 1000;
                    const blockEnd = dateStartOfDay + (sc + sp) * state.zoom * 60 * 1000;
                    const matchingOverlaps = selectedSimilarityKeys.length > 0
                        ? blockOverlaps.filter(overlap => selectedSimilarityKeys.includes(getActivitySimilarityKey(overlap)))
                        : blockOverlaps.filter(overlap => (
                            getActivitySummaryKey(overlap) === blockKey
                        ));
                    const selectedSummaries = typeof window.summarizeActivityOverlaps === 'function'
                        ? summarizeActivityOverlaps(matchingOverlaps, blockStart, blockEnd)
                        : matchingOverlaps;
                    const assignmentActivities = selectedSummaries.flatMap(overlap => (
                        buildVisibleAssignmentActivities(blockOverlaps, overlap, blockStart, blockEnd)
                    ));
                    overlaps.push(...(assignmentActivities.length > 0
                        ? assignmentActivities
                        : matchingOverlaps.map(overlap => ({
                            ...overlap,
                            assignmentStart: blockStart,
                            assignmentEnd: blockEnd,
                            assignmentSource: 'activity-stream'
                        }))));
                } catch (e) {}
            }
        });

        const startMs = dateStartOfDay + minStartCell * state.zoom * 60 * 1000;
        const endMs = dateStartOfDay + maxEndCell * state.zoom * 60 * 1000;

        const selectedOverlaps = overlaps.sort((first, second) => {
            const startA = Number.isFinite(first.start) ? first.start : Number.MAX_SAFE_INTEGER;
            const startB = Number.isFinite(second.start) ? second.start : Number.MAX_SAFE_INTEGER;
            return startA - startB;
        });

        openTimeEntryModal(startMs, endMs, '', null, null, true, selectedOverlaps);
    });
}

function setDateNavigationVisible(isVisible) {
    const dateNavigation = document.getElementById('date-navigation');
    if (!dateNavigation) return;
    if (!isVisible) closeDatePicker();
    dateNavigation.classList.toggle('hidden', !isVisible);
}

function openDatePicker() {
    const popover = document.getElementById('date-picker-popover');
    if (!popover) return;

    datePickerState.viewedMonth = new Date(
        state.currentDate.getFullYear(),
        state.currentDate.getMonth(),
        1
    );
    renderDatePicker();
    popover.classList.remove('hidden');
}

function closeDatePicker() {
    const popover = document.getElementById('date-picker-popover');
    if (!popover) return;
    popover.classList.add('hidden');
}

function shiftDatePickerMonth(delta) {
    if (!datePickerState.viewedMonth) {
        datePickerState.viewedMonth = new Date(
            state.currentDate.getFullYear(),
            state.currentDate.getMonth(),
            1
        );
    }
    datePickerState.viewedMonth.setMonth(datePickerState.viewedMonth.getMonth() + delta);
    renderDatePicker();
}

function renderDatePicker() {
    const monthLabel = document.getElementById('date-picker-month-label');
    const weekdaysEl = document.getElementById('date-picker-weekdays');
    const daysEl = document.getElementById('date-picker-days');
    if (!monthLabel || !weekdaysEl || !daysEl) return;

    const viewedMonth = datePickerState.viewedMonth || new Date(
        state.currentDate.getFullYear(),
        state.currentDate.getMonth(),
        1
    );
    const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
    monthLabel.innerText = monthFormatter.format(viewedMonth);

    weekdaysEl.innerHTML = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
        .map(day => `<div class="h-7 flex items-center justify-center">${day}</div>`)
        .join('');

    const gridStart = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth(), 1);
    const mondayOffset = (gridStart.getDay() + 6) % 7;
    gridStart.setDate(gridStart.getDate() - mondayOffset);

    const todayStr = getFormattedDate(new Date());
    const selectedStr = getFormattedDate(state.currentDate);
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

    daysEl.innerHTML = daysHtml.join('');
    daysEl.querySelectorAll('button[data-date]').forEach(button => {
        button.addEventListener('click', async (e) => {
            e.stopPropagation();
            const [year, month, day] = button.dataset.date.split('-').map(Number);
            state.currentDate = new Date(year, month - 1, day);
            clearTimelineSelectionForDateChange();
            setupDateDisplay();
            await refreshData();
            closeDatePicker();
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
            }
            window.systemTodayDateStr = currentRealTodayStr;
        }
        await refreshData();
    }, 10000);
}

// Bind to window
window.goToToday = goToToday;
window.setTimelineMode = setTimelineMode;
window.syncTimelineModeControls = syncTimelineModeControls;
window.init = init;

// Auto-initialize when the DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
