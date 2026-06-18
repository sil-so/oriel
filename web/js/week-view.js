function getWeekStart(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    return start;
}

function getWeekDays(date = state.currentDate) {
    const start = getWeekStart(date);
    return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        return day;
    });
}

function getSelectedWeekRange(date = state.currentDate) {
    const start = getWeekStart(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

function formatSelectedWeekLabel(date = state.currentDate) {
    const { start, end } = getSelectedWeekRange(date);
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    return `${start.toLocaleDateString('en-GB', options)} - ${end.toLocaleDateString('en-GB', options)}`;
}

function escapeWeekText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getWeekDayKey(date) {
    return getFormattedDate(date);
}

function getWeekDayStart(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
}

function getWeekDayEnd(date) {
    return getWeekDayStart(date) + 24 * 60 * 60 * 1000;
}

function formatWeekDayHeader(date) {
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

function formatWeekTimeLabel(cellIndex, zoom) {
    const totalMinutes = cellIndex * zoom;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getWeekRowCount() {
    return Math.floor(1440 / state.zoom);
}

const WEEK_ROW_TOP_INSET_PX = 2;
const WEEK_ROW_HEIGHT_INSET_PX = 3;
const WEEK_MIN_ENTRY_HEIGHT_PX = 37;
const WEEK_LOGGED_TIME_ENTRY_MIN_RENDER_DURATION_MS = 60 * 1000;

function getWeekActivitiesForDay(activities, dayStart, dayEnd) {
    return (Array.isArray(activities) ? activities : []).filter(activity => {
        return Number.isFinite(activity?.start)
            && Number.isFinite(activity?.end)
            && activity.end > dayStart
            && activity.start < dayEnd;
    });
}

function buildWeekRenderItemsForDay(entries, dayStart, dayEnd) {
    const dayEntries = (Array.isArray(entries) ? entries : []).filter(entry => {
        return Number.isFinite(entry?.start)
            && Number.isFinite(entry?.end)
            && entry.end > dayStart
            && entry.start < dayEnd;
    });

    const previousActivities = state.activities;
    const previousTimelineActivities = state.timelineActivities;
    state.activities = getWeekActivitiesForDay(state.weekActivities, dayStart, dayEnd);
    state.timelineActivities = getWeekActivitiesForDay(state.weekTimelineActivities, dayStart, dayEnd);

    try {
        if (typeof window.buildLoggedTimeEntryRenderItems === 'function') {
            return window.buildLoggedTimeEntryRenderItems(dayEntries, state.zoom, dayStart);
        }

        return dayEntries
            .map((entry, index) => ({
                entries: [entry],
                firstEntry: entry,
                start: entry.start,
                end: entry.end,
                displayStart: entry.start,
                displayEnd: entry.end,
                durationMs: Math.max(0, entry.end - entry.start),
                sourceIndex: index,
                isAssignedGroup: false
            }))
            .filter(item => item.durationMs >= WEEK_LOGGED_TIME_ENTRY_MIN_RENDER_DURATION_MS);
    } finally {
        state.activities = previousActivities;
        state.timelineActivities = previousTimelineActivities;
    }
}

function getWeekEntryDisplayRange(item, dayStart) {
    if (Number.isFinite(item.displayStart) && Number.isFinite(item.displayEnd) && item.displayEnd > item.displayStart) {
        return { start: item.displayStart, end: item.displayEnd };
    }

    if (typeof window.getTimelineDisplayRowRange === 'function') {
        return window.getTimelineDisplayRowRange(item.start, item.end, dayStart, state.zoom);
    }

    return {
        start: Math.max(dayStart, item.start),
        end: Math.min(dayStart + 24 * 60 * 60 * 1000, item.end)
    };
}

function renderWeekTimeEntryBlock(item, dayStart) {
    const entry = item.firstEntry;
    if (!entry) return '';

    const renderRange = getWeekEntryDisplayRange(item, dayStart);
    const startMins = (renderRange.start - dayStart) / (60 * 1000);
    const endMins = (renderRange.end - dayStart) / (60 * 1000);
    const pixelsPerMinute = 40 / state.zoom;
    const topPx = Math.max(0, startMins * pixelsPerMinute) + WEEK_ROW_TOP_INSET_PX;
    const naturalHeightPx = ((endMins - startMins) * pixelsPerMinute) - WEEK_ROW_HEIGHT_INSET_PX;
    const heightPx = Math.max(WEEK_MIN_ENTRY_HEIGHT_PX, naturalHeightPx);

    const project = state.projects.find(p => p.id === entry.projectId) || { name: 'Unknown Project', color: '#4b5563', tasks: [] };
    const task = Array.isArray(project.tasks)
        ? project.tasks.find(projectTask => projectTask.id === entry.taskId)
        : null;
    const duration = Math.max(1, Math.round((item.durationMs || Math.max(0, entry.end - entry.start)) / (60 * 1000)));
    const description = String(entry.description || '').trim();
    const sizeClass = naturalHeightPx < 20
        ? 'time-entry-block--tiny'
        : naturalHeightPx < 36
            ? 'time-entry-block--compact'
            : '';
    const assignmentClass = item.isAssignedGroup ? 'time-entry-block--assigned' : '';
    const className = ['time-entry-block', 'week-time-entry-block', sizeClass, assignmentClass].filter(Boolean).join(' ');
    const descriptionHtml = description
        ? `<span class="time-entry-description truncate pr-2">${escapeWeekText(description)}</span>`
        : '';
    const projectSummaryHtml = `
                    <span class="project-marker" style="background-color: ${project.color}"></span>
                    <span class="truncate">${escapeWeekText(project.name)}</span>
                    ${task ? `<span class="time-entry-task duration-pill shrink-0">${escapeWeekText(task.name)}</span>` : ''}
    `;
    const mainContentHtml = descriptionHtml || `
                    <span class="time-entry-project-summary min-w-0 flex items-center gap-1.5 truncate">
                        ${projectSummaryHtml}
                    </span>
    `;
    const projectRowHtml = description
        ? `
                <div class="time-entry-project text-[10px] font-bold mt-1 text-white/80 uppercase tracking-wider flex items-center gap-1.5 pointer-events-none">
                    ${projectSummaryHtml}
                </div>
        `
        : '';
    const groupIds = [...new Set((item.entries || []).map(groupEntry => groupEntry.id).filter(Boolean))];
    const groupDataHtml = item.isAssignedGroup && groupIds.length > 1
        ? `
             data-group-ids="${encodeURIComponent(JSON.stringify(groupIds))}"
             data-group-start="${item.start}"
             data-group-end="${item.end}"`
        : '';
    const laneStyle = typeof window.getLoggedTimeEntryLaneStyle === 'function'
        ? window.getLoggedTimeEntryLaneStyle(item)
        : '';

    return `
        <div class="${className}"
             style="top: ${topPx}px; height: ${heightPx}px; --entry-project-color: ${project.color};${laneStyle}"
             data-id="${entry.id}"${groupDataHtml}>
            <div class="resize-handle-top"></div>
            <div class="time-entry-main flex justify-between items-start text-white text-[12px] font-semibold leading-tight pointer-events-none">
                ${mainContentHtml}
                <span class="duration-pill time-entry-duration shrink-0">${duration} min</span>
            </div>
            ${projectRowHtml}
            <div class="resize-handle-bottom"></div>
        </div>
    `;
}

function setWeekStyleProperty(element, name, value) {
    if (typeof element?.style?.setProperty === 'function') {
        element.style.setProperty(name, value);
    } else if (element?.style) {
        element.style[name] = value;
    }
}

function renderWeekTimelineGrids() {
    const grid = DOM.elWeekTimelineGrid;
    if (grid) {
        setWeekStyleProperty(grid, '--week-row-count', String(getWeekRowCount()));
    }
}

function renderWeekRowLines(rowCount) {
    return Array.from({ length: rowCount }, () => '<div class="week-row-line"></div>').join('');
}

function renderWeekTimeline() {
    const grid = DOM.elWeekTimelineGrid;
    if (!grid) return;

    const days = getWeekDays(state.currentDate);
    const rowCount = getWeekRowCount();
    const rowLinesHtml = renderWeekRowLines(rowCount);
    const timeLabels = Array.from({ length: rowCount }, (_, index) => `
        <div class="week-time-label">${index % Math.max(1, Math.floor(60 / state.zoom)) === 0 ? formatWeekTimeLabel(index, state.zoom) : ''}</div>
    `).join('');

    const headers = days.map((day, index) => `
        <div class="week-day-header" style="grid-column: ${index + 2};">${escapeWeekText(formatWeekDayHeader(day))}</div>
    `).join('');

    const columns = days.map((day, index) => {
        const key = getWeekDayKey(day);
        const dayStart = getWeekDayStart(day);
        const dayEnd = getWeekDayEnd(day);
        const renderItems = buildWeekRenderItemsForDay(state.weekTimeEntries, dayStart, dayEnd);
        const entriesHtml = renderItems.map(item => renderWeekTimeEntryBlock(item, dayStart)).join('');

        return `
            <div id="week-day-${key}"
                 class="week-day-column"
                 style="grid-column: ${index + 2};"
                 data-week-date="${key}"
                 data-day-start="${dayStart}">
                <div class="week-row-lines" aria-hidden="true">${rowLinesHtml}</div>
                ${entriesHtml}
            </div>
        `;
    }).join('');

    setWeekStyleProperty(grid, '--week-row-count', String(rowCount));
    grid.innerHTML = `
        <div class="week-time-corner">
            <button
                id="btn-week-jump-current"
                class="icon-button week-current-time-button"
                type="button"
                title="Jump to Current Time"
                aria-label="Jump to Current Time">
                <i class="ph ph-arrow-line-down text-lg" aria-hidden="true"></i>
            </button>
        </div>
        ${headers}
        <div class="week-time-labels">${timeLabels}</div>
        ${columns}
    `;

    attachWeekTimelineInteractions(days);
}

function getWeekCellIndexFromClientY(column, clientY) {
    const rect = column.getBoundingClientRect();
    const rawCell = Math.floor((clientY - rect.top) / 40);
    return Math.max(0, Math.min(getWeekRowCount() - 1, rawCell));
}

const weekDragState = {
    active: false,
    column: null,
    dragBox: null,
    startCell: 0,
    endCell: 0,
    dayStart: 0
};

let weekWindowListenersAttached = false;

function setWeekDragBoxGeometry() {
    if (!weekDragState.dragBox) return;

    const firstCell = Math.min(weekDragState.startCell, weekDragState.endCell);
    const selectedCells = Math.abs(weekDragState.endCell - weekDragState.startCell) + 1;
    weekDragState.dragBox.style.top = `${firstCell * 40 + WEEK_ROW_TOP_INSET_PX}px`;
    weekDragState.dragBox.style.height = `${selectedCells * 40 - WEEK_ROW_HEIGHT_INSET_PX}px`;
    weekDragState.dragBox.innerHTML = `
        <span>New time entry</span>
        <span>${selectedCells * state.zoom} min</span>
    `;
}

function showWeekHoverPreview(column, cellIndex) {
    let preview = column.querySelector?.('.week-hover-preview');
    if (!preview) {
        preview = document.createElement('div');
        preview.className = 'time-entry-hover-preview week-hover-preview';
        column.appendChild(preview);
    }

    preview.style.top = `${cellIndex * 40 + WEEK_ROW_TOP_INSET_PX}px`;
    preview.style.height = `${WEEK_MIN_ENTRY_HEIGHT_PX}px`;
    preview.innerHTML = '<span class="time-entry-hover-label">Click &amp; drag to log</span>';
}

function hideWeekHoverPreview(column) {
    column?.querySelector?.('.week-hover-preview')?.remove?.();
}

function beginWeekCreateDrag(column, clientY) {
    const dayStart = Number(column.dataset.dayStart);
    if (!Number.isFinite(dayStart)) return;

    weekDragState.active = true;
    weekDragState.column = column;
    weekDragState.dayStart = dayStart;
    weekDragState.startCell = getWeekCellIndexFromClientY(column, clientY);
    weekDragState.endCell = weekDragState.startCell;
    weekDragState.dragBox = document.createElement('div');
    weekDragState.dragBox.className = 'week-drag-box';
    setWeekDragBoxGeometry();
    column.appendChild(weekDragState.dragBox);
}

function getWeekDragOverlaps(startMs, endMs) {
    const overlaps = [];
    for (const activity of state.weekActivities || []) {
        const overlapStart = Math.max(startMs, activity.start);
        const overlapEnd = Math.min(endMs, activity.end);
        if (overlapEnd > overlapStart) {
            overlaps.push({ ...activity, duration: overlapEnd - overlapStart });
        }
    }
    return typeof window.summarizeActivityOverlaps === 'function'
        ? window.summarizeActivityOverlaps(overlaps)
        : overlaps;
}

function ensureWeekWindowListeners() {
    if (weekWindowListenersAttached || !window.addEventListener) return;
    weekWindowListenersAttached = true;

    window.addEventListener('mousemove', event => {
        if (!weekDragState.active || !weekDragState.column) return;
        weekDragState.endCell = getWeekCellIndexFromClientY(weekDragState.column, event.clientY);
        setWeekDragBoxGeometry();
    });

    window.addEventListener('mouseup', () => {
        if (!weekDragState.active) return;

        const cellStart = Math.min(weekDragState.startCell, weekDragState.endCell);
        const cellEnd = Math.max(weekDragState.startCell, weekDragState.endCell) + 1;
        const startMs = weekDragState.dayStart + cellStart * state.zoom * 60 * 1000;
        const endMs = weekDragState.dayStart + cellEnd * state.zoom * 60 * 1000;
        const overlaps = getWeekDragOverlaps(startMs, endMs);
        const dragBox = weekDragState.dragBox;

        weekDragState.active = false;
        weekDragState.column = null;
        weekDragState.dragBox = null;
        dragBox?.remove?.();
        openTimeEntryModal(startMs, endMs, '', null, null, false, overlaps);
    });
}

function attachWeekTimelineInteractions(days = getWeekDays(state.currentDate)) {
    ensureWeekWindowListeners();
    const jumpButton = document.getElementById('btn-week-jump-current');
    if (jumpButton && !jumpButton.dataset.weekJumpBound) {
        jumpButton.dataset.weekJumpBound = 'true';
        jumpButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            jumpToCurrentWeekTime();
        });
    }

    days.forEach(day => {
        const column = document.getElementById(`week-day-${getWeekDayKey(day)}`);
        if (!column) return;
        column.dataset.weekDate ||= getWeekDayKey(day);
        column.dataset.dayStart ||= String(getWeekDayStart(day));

        column.addEventListener('mousemove', event => {
            if (weekDragState.active || event.target?.closest?.('.time-entry-block')) {
                hideWeekHoverPreview(column);
                return;
            }

            showWeekHoverPreview(column, getWeekCellIndexFromClientY(column, event.clientY));
        });

        column.addEventListener('mouseleave', () => {
            hideWeekHoverPreview(column);
        });

        column.addEventListener('mousedown', event => {
            if (event.button !== 0) return;
            hideWeekHoverPreview(column);
            if (event.target?.closest?.('.time-entry-block')) return;
            event.preventDefault();
            beginWeekCreateDrag(column, event.clientY);
        });
    });

    const blocks = DOM.elWeekTimelineGrid?.querySelectorAll?.('.week-time-entry-block') || [];
    blocks.forEach(block => {
        block.addEventListener('click', event => {
            event.stopPropagation();
            if (typeof window.openTimeEntryBlockEditor === 'function') {
                window.openTimeEntryBlockEditor(block, state.weekTimeEntries);
            }
        });
    });
}

function jumpToCurrentWeekTime() {
    const container = DOM.elWeekTimelineContainer;
    if (!container) return;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const targetTop = Math.max(0, (currentMinutes / state.zoom) * 40 - container.clientHeight / 3);
    if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: targetTop, behavior: 'auto' });
    } else {
        container.scrollTop = targetTop;
    }
}

window.getWeekStart = getWeekStart;
window.getWeekDays = getWeekDays;
window.getSelectedWeekRange = getSelectedWeekRange;
window.formatSelectedWeekLabel = formatSelectedWeekLabel;
window.renderWeekTimelineGrids = renderWeekTimelineGrids;
window.renderWeekTimeline = renderWeekTimeline;
window.attachWeekTimelineInteractions = attachWeekTimelineInteractions;
window.jumpToCurrentWeekTime = jumpToCurrentWeekTime;
