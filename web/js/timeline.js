// Render background timeline grid lines
function renderTimelineGrids() {
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    const rowLayout = getDayTimelineRenderModel({
        dateStartOfDay,
        zoom: state.zoom
    }).rowLayout;
    let html = '';
    
    for (let displayRow = 0; displayRow < rowLayout.displayRowCount; displayRow++) {
        const sourceRow = getSourceRowForDisplayRow(rowLayout, displayRow);
        const totalMinutes = sourceRow * state.zoom;
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        
        html += `
            <div class="timeline-row" data-cell-index="${sourceRow}" data-display-row-index="${displayRow}">
                <div class="time-label">${timeStr}</div>
                <div class="timeline-line"></div>
            </div>
        `;
    }

    const gridMem = DOM.elGridMemoryAid;
    const gridTime = DOM.elGridTimeEntries;
    const itemsMem = DOM.elItemsMemoryAid;
    const itemsTime = DOM.elItemsTimeEntries;

    if (gridMem) gridMem.innerHTML = html;
    if (gridTime) gridTime.innerHTML = html;

    const gridHeight = rowLayout.displayRowCount * 40;
    if (itemsMem) itemsMem.style.height = `${gridHeight}px`;
    if (itemsTime) itemsTime.style.height = `${gridHeight}px`;
}

const ACTIVITY_STREAM_MIN_OWNERSHIP_RATIO = 0.1;
const ACTIVITY_STREAM_SUMMARY_ASSIGNMENT_MODEL = 'activity-stream-summary';
const ACTIVITY_STREAM_AUTO_ASSIGNMENT_MODEL = 'auto-assigned-capture';
const ACTIVITY_MIX_HANDS_ON_HELP = 'Hands-on: recent keyboard, mouse, click, or scroll input within 30 seconds.';
const ACTIVITY_MIX_HANDS_OFF_HELP = 'Hands-off: foreground time without input within 30 seconds, such as reading, watching, or listening.';
const ACTIVITY_MIX_HANDS_ON_TOOLTIP_DESCRIPTION = 'Recent keyboard, mouse, click, or scroll input within 30 seconds.';
const ACTIVITY_MIX_HANDS_OFF_TOOLTIP_DESCRIPTION = 'Foreground time without recent input, such as reading, watching, or listening.';
const ACTIVITY_MIX_INFO_HELP = 'Shows how much of this recorded foreground time included recent keyboard, mouse, click, or scroll input within 30 seconds. Hands-off still counts when the app stayed in front while you read, watched, or listened.';
const ACTIVITY_STREAM_MIN_VISIBLE_DURATION_MS = 60 * 1000;
const ACTIVITY_STREAM_SESSION_MERGE_GAP_MS = 15 * 1000;
const ACTIVITY_STREAM_MIN_VISIBLE_SESSION_DURATION_MS = 60 * 1000;
const ACTIVITY_STREAM_MIN_EXACT_FRAGMENT_DURATION_MS = 60 * 1000;
const LOGGED_TIME_ENTRY_MIN_RENDER_DURATION_MS = 60 * 1000;
const UNLOGGED_WORK_MIN_REVIEW_FRAGMENT_DURATION_MS = 1000;
const UNLOGGED_WORK_MIN_REVIEW_GROUP_DURATION_MS = 60 * 1000;
const TIME_ENTRY_FLOATING_LABEL_MIN_HEIGHT_PX = 120;
const TIME_ENTRY_FLOATING_LABEL_PADDING_PX = 6;
const POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS = 60 * 1000;
let visibleActivityCellsCache = null;
let floatingTimeEntryLabelScrollPane = null;
let floatingTimeEntryLabelFramePending = false;
let floatingTimeEntryLabelBlocks = [];
let dayTimelineRenderModelCache = null;

function incrementTimelineDiagnostic(name, amount = 1) {
    const diagnostics = window?.__orielTimelineDiagnostics;
    if (!diagnostics || !name) return;

    diagnostics[name] = (Number(diagnostics[name]) || 0) + amount;
}

function isHideEmptyActivityRowsEnabled() {
    return Boolean(state?.settings?.hideEmptyActivityRows);
}

function isCompressedDayTimelineDirectManipulationDisabled() {
    return state?.timelineMode !== 'week' && isHideEmptyActivityRowsEnabled();
}

function getTimelineRowDurationMs(zoom) {
    return Math.max(1, Number(zoom) || 1) * 60 * 1000;
}

function getTimelineTotalRows(zoom) {
    return Math.floor(1440 / Math.max(1, Number(zoom) || 1));
}

function shouldRenderExactActivityStreamSessions(zoom) {
    return Math.max(1, Number(zoom) || 1) === 1;
}

function buildFullDayTimelineRowLayout(dateStartOfDay, zoom) {
    const totalRows = getTimelineTotalRows(zoom);
    const sourceRows = Array.from({ length: totalRows }, (_value, index) => index);
    return {
        dateStartOfDay,
        zoom: Math.max(1, Number(zoom) || 1),
        rowDurationMs: getTimelineRowDurationMs(zoom),
        totalSourceRows: totalRows,
        displayRowCount: totalRows,
        sourceRows,
        sourceRowByDisplayRow: sourceRows,
        displayRowBySourceRow: sourceRows,
        hideEmptyRows: false
    };
}

function getCurrentDayTimelineActivityCells(dateStartOfDay, zoom) {
    const visibleActivities = Array.isArray(state.activities)
        ? state.activities
        : [];
    const ownershipActivities = Array.isArray(state.timelineActivities) && state.timelineActivities.length > 0
        ? state.timelineActivities
        : visibleActivities;
    return buildVisibleActivityCells({
        dateStartOfDay,
        zoom,
        ownershipActivities,
        visibleActivities
    });
}

function addSourceRowsForRange(keepRows, range, totalRows) {
    if (!range) return;
    const startRow = Math.max(0, Number(range.startRow) || 0);
    const endRow = Math.min(totalRows, Math.max(startRow + 1, Number(range.endRow) || startRow + 1));
    for (let row = startRow; row < endRow; row++) {
        keepRows.add(row);
    }
}

function buildDayTimelineRowLayout({
    dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0),
    zoom = state.zoom,
    activityCells = null,
    activitySessions = null,
    timeEntryRenderItems = null,
    hideEmptyRows = isHideEmptyActivityRowsEnabled()
} = {}) {
    const renderZoom = Math.max(1, Number(zoom) || 1);
    const totalRows = getTimelineTotalRows(renderZoom);
    if (!hideEmptyRows) {
        return buildFullDayTimelineRowLayout(dateStartOfDay, renderZoom);
    }

    const cells = Array.isArray(activityCells)
        ? activityCells
        : null;
    const sessions = Array.isArray(activitySessions)
        ? activitySessions
        : null;
    const renderItems = Array.isArray(timeEntryRenderItems)
        ? timeEntryRenderItems
        : buildLoggedTimeEntryRenderItems(state.timeEntries || [], renderZoom, dateStartOfDay);
    const keepRows = new Set();

    if (sessions) {
        sessions.forEach(session => {
            addSourceRowsForRange(keepRows, getTimelineDisplayRowRange(session.start, session.end, dateStartOfDay, renderZoom), totalRows);
        });
    } else {
        const fallbackCells = cells || getCurrentDayTimelineActivityCells(dateStartOfDay, renderZoom);
        fallbackCells.forEach((cell, index) => {
            if (cell) keepRows.add(index);
        });
    }

    renderItems.forEach(item => {
        const range = Number.isFinite(item?.displayStart) && Number.isFinite(item?.displayEnd) && item.displayEnd > item.displayStart
            ? getTimelineDisplayRowRange(item.displayStart, item.displayEnd, dateStartOfDay, renderZoom)
            : getTimelineDisplayRowRange(item.start, item.end, dateStartOfDay, renderZoom);
        addSourceRowsForRange(keepRows, range, totalRows);
    });

    const sourceRows = [...keepRows]
        .filter(row => row >= 0 && row < totalRows)
        .sort((left, right) => left - right);
    const displayRowBySourceRow = new Array(totalRows).fill(-1);
    sourceRows.forEach((sourceRow, displayRow) => {
        displayRowBySourceRow[sourceRow] = displayRow;
    });

    return {
        dateStartOfDay,
        zoom: renderZoom,
        rowDurationMs: getTimelineRowDurationMs(renderZoom),
        totalSourceRows: totalRows,
        displayRowCount: sourceRows.length,
        sourceRows,
        sourceRowByDisplayRow: sourceRows,
        displayRowBySourceRow,
        hideEmptyRows: true
    };
}

function getDayTimelineRenderModel({
    dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0),
    zoom = state.zoom,
    hideEmptyRows = isHideEmptyActivityRowsEnabled()
} = {}) {
    const renderZoom = Math.max(1, Number(zoom) || 1);
    const dayStart = Number.isFinite(dateStartOfDay)
        ? dateStartOfDay
        : new Date(state.currentDate).setHours(0,0,0,0);
    const ownershipActivities = Array.isArray(state.timelineActivities)
        ? state.timelineActivities
        : state.activities;
    const visibleActivities = Array.isArray(state.activities)
        ? state.activities
        : ownershipActivities;
    const timeEntries = Array.isArray(state.timeEntries) ? state.timeEntries : [];
    const signature = {
        dateStartOfDay: dayStart,
        zoom: renderZoom,
        hideEmptyRows: Boolean(hideEmptyRows),
        ownershipActivities,
        visibleActivities,
        timeEntries,
        ownershipSignature: getTimelineActivityListSignature(ownershipActivities),
        visibleSignature: ownershipActivities === visibleActivities
            ? 'same'
            : getTimelineActivityListSignature(visibleActivities),
        timeEntrySignature: getTimelineTimeEntryListSignature(timeEntries)
    };

    if (dayTimelineRenderModelCache
        && dayTimelineRenderModelCache.dateStartOfDay === signature.dateStartOfDay
        && dayTimelineRenderModelCache.zoom === signature.zoom
        && dayTimelineRenderModelCache.hideEmptyRows === signature.hideEmptyRows
        && dayTimelineRenderModelCache.ownershipActivities === signature.ownershipActivities
        && dayTimelineRenderModelCache.visibleActivities === signature.visibleActivities
        && dayTimelineRenderModelCache.timeEntries === signature.timeEntries
        && dayTimelineRenderModelCache.ownershipSignature === signature.ownershipSignature
        && dayTimelineRenderModelCache.visibleSignature === signature.visibleSignature
        && dayTimelineRenderModelCache.timeEntrySignature === signature.timeEntrySignature) {
        incrementTimelineDiagnostic('dayRenderModelCacheHits');
        return dayTimelineRenderModelCache.model;
    }

    incrementTimelineDiagnostic('dayRenderModelBuilds');
    const activityBlockDetails = new Map();
    const useActivitySessions = shouldRenderExactActivityStreamSessions(renderZoom);
    const activitySessions = useActivitySessions
        ? buildActivityStreamSessions({
            dateStartOfDay: dayStart,
            activities: ownershipActivities,
            detailActivities: visibleActivities,
            timeEntries
        })
        : null;
    const activityCells = useActivitySessions
        ? null
        : buildVisibleActivityCells({
            dateStartOfDay: dayStart,
            zoom: renderZoom,
            ownershipActivities,
            visibleActivities
        });
    const timeEntryRenderItems = buildLoggedTimeEntryRenderItems(timeEntries, renderZoom, dayStart);
    const rowLayout = buildDayTimelineRowLayout({
        dateStartOfDay: dayStart,
        zoom: renderZoom,
        activityCells,
        activitySessions,
        timeEntryRenderItems,
        hideEmptyRows
    });

    rowLayout.activityBlockDetails = activityBlockDetails;
    const model = {
        dateStartOfDay: dayStart,
        zoom: renderZoom,
        hideEmptyRows: Boolean(hideEmptyRows),
        useActivitySessions,
        activitySessions,
        activityCells,
        timeEntryRenderItems,
        rowLayout,
        activityBlockDetails
    };

    dayTimelineRenderModelCache = {
        ...signature,
        model
    };
    return model;
}

function shouldUseCurrentDayTimelineRenderModel(options = {}) {
    if (options?.sourceRows
        || Array.isArray(options?.activityCells)
        || Array.isArray(options?.activitySessions)
        || Array.isArray(options?.timeEntryRenderItems)
        || options?.useCachedModel === false) {
        return false;
    }

    const dateStartOfDay = Number.isFinite(options?.dateStartOfDay)
        ? options.dateStartOfDay
        : new Date(state.currentDate).setHours(0,0,0,0);
    const currentDateStart = new Date(state.currentDate).setHours(0,0,0,0);
    return dateStartOfDay === currentDateStart;
}

function getTimelineRowLayout(options = {}) {
    if (options?.sourceRows) return options;
    if (shouldUseCurrentDayTimelineRenderModel(options)) {
        return getDayTimelineRenderModel(options).rowLayout;
    }
    return buildDayTimelineRowLayout(options);
}

function getDisplayRowInsertionForSourceRow(layout, sourceRow) {
    const rows = Array.isArray(layout?.sourceRows) ? layout.sourceRows : [];
    let low = 0;
    let high = rows.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (rows[mid] < sourceRow) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

function getDisplayRowForSourceRow(layout, sourceRow) {
    const row = Math.max(0, Math.floor(Number(sourceRow) || 0));
    if (!layout?.hideEmptyRows) return row;
    return layout.displayRowBySourceRow?.[row] ?? -1;
}

function getSourceRowForDisplayRow(layout, displayRow) {
    const row = Math.max(0, Math.floor(Number(displayRow) || 0));
    if (!layout?.hideEmptyRows) return Math.min(row, Math.max(0, (layout?.totalSourceRows || 1) - 1));
    const rows = Array.isArray(layout.sourceRowByDisplayRow) ? layout.sourceRowByDisplayRow : [];
    if (rows.length === 0) return 0;
    return rows[Math.min(row, rows.length - 1)];
}

function getDisplayRowRangeForSourceRange(layout, startRow, endRow) {
    const normalizedStart = Math.max(0, Math.floor(Number(startRow) || 0));
    const normalizedEnd = Math.max(normalizedStart + 1, Math.ceil(Number(endRow) || normalizedStart + 1));
    if (!layout?.hideEmptyRows) {
        return {
            startRow: normalizedStart,
            endRow: normalizedEnd,
            rowSpan: normalizedEnd - normalizedStart
        };
    }

    const mappedStart = getDisplayRowForSourceRow(layout, normalizedStart);
    const mappedLast = getDisplayRowForSourceRow(layout, normalizedEnd - 1);
    const startDisplayRow = mappedStart >= 0
        ? mappedStart
        : getDisplayRowInsertionForSourceRow(layout, normalizedStart);
    let endDisplayRow = mappedLast >= 0
        ? mappedLast + 1
        : getDisplayRowInsertionForSourceRow(layout, normalizedEnd);

    if (endDisplayRow <= startDisplayRow && layout.displayRowCount > 0) {
        endDisplayRow = Math.min(layout.displayRowCount, startDisplayRow + 1);
    }

    return {
        startRow: startDisplayRow,
        endRow: endDisplayRow,
        rowSpan: Math.max(0, endDisplayRow - startDisplayRow)
    };
}

function getTimelineDisplayRangeGeometry(start, end, dateStartOfDay, zoom, layout = null) {
    const sourceRange = getTimelineDisplayRowRange(start, end, dateStartOfDay, zoom);
    const rowLayout = layout || getTimelineRowLayout({ dateStartOfDay, zoom });
    const displayRange = getDisplayRowRangeForSourceRange(rowLayout, sourceRange.startRow, sourceRange.endRow);
    return {
        ...sourceRange,
        displayStartRow: displayRange.startRow,
        displayEndRow: displayRange.endRow,
        displayRowSpan: displayRange.rowSpan,
        top: displayRange.startRow * 40 + 2,
        height: Math.max(0, displayRange.rowSpan * 40 - 3)
    };
}

function getTimelineExactDisplayRangeGeometry(start, end, dateStartOfDay, zoom, layout = null) {
    const rowLayout = layout || getTimelineRowLayout({ dateStartOfDay, zoom });
    const startTop = getTimelineDisplayTopForTime(start, rowLayout);
    const endTop = getTimelineDisplayTopForTime(end, rowLayout);
    return {
        top: Math.max(0, startTop + 2),
        height: Math.max(1, endTop - startTop - 3)
    };
}

function getTimelineDisplayTopForTime(timeMs, options = {}) {
    const layout = options?.sourceRows
        ? options
        : getTimelineRowLayout(options);
    const rowDurationMs = layout.rowDurationMs || getTimelineRowDurationMs(layout.zoom);
    const sourceRowFloat = Math.max(0, (Number(timeMs) - layout.dateStartOfDay) / rowDurationMs);
    const sourceRow = Math.min(layout.totalSourceRows - 1, Math.floor(sourceRowFloat));
    const rowFraction = Math.max(0, sourceRowFloat - Math.floor(sourceRowFloat));

    if (!layout.hideEmptyRows) return sourceRowFloat * 40;

    const mappedRow = getDisplayRowForSourceRow(layout, sourceRow);
    if (mappedRow >= 0) {
        return (mappedRow + rowFraction) * 40;
    }

    return getDisplayRowInsertionForSourceRow(layout, sourceRow) * 40;
}

function getTimelineTimeForDisplayTop(displayTop, options = {}) {
    const layout = options?.sourceRows
        ? options
        : getTimelineRowLayout(options);
    const displayRowFloat = Math.max(0, Number(displayTop) / 40);
    const displayRow = Math.floor(displayRowFloat);
    const rowFraction = displayRowFloat - displayRow;
    const sourceRow = getSourceRowForDisplayRow(layout, displayRow);
    return layout.dateStartOfDay + (sourceRow + rowFraction) * layout.rowDurationMs;
}

function normalizeTimelineInteractionState(activity) {
    return activity?.interactionState === 'handsOff' ? 'handsOff' : 'handsOn';
}

function emptyActivityMix() {
    return { handsOnMs: 0, handsOffMs: 0 };
}

function addTimelineActivityMix(left, right) {
    return {
        handsOnMs: Math.max(0, Number(left?.handsOnMs || 0)) + Math.max(0, Number(right?.handsOnMs || 0)),
        handsOffMs: Math.max(0, Number(left?.handsOffMs || 0)) + Math.max(0, Number(right?.handsOffMs || 0))
    };
}

function getClippedDurationMs(activity, rangeStart, rangeEnd) {
    if (!Number.isFinite(activity?.start) || !Number.isFinite(activity?.end)) {
        return Math.max(0, Number(activity?.duration) || 0);
    }

    const start = Number.isFinite(rangeStart) ? Math.max(activity.start, rangeStart) : activity.start;
    const end = Number.isFinite(rangeEnd) ? Math.min(activity.end, rangeEnd) : activity.end;
    return Math.max(0, end - start);
}

function activityMixFromDuration(activity, duration) {
    return normalizeTimelineInteractionState(activity) === 'handsOff'
        ? { handsOnMs: 0, handsOffMs: duration }
        : { handsOnMs: duration, handsOffMs: 0 };
}

function getActivityMixInRange(activity, rangeStart, rangeEnd) {
    const sourceSegments = Array.isArray(activity?.sourceSegments)
        ? activity.sourceSegments
        : [];

    if (sourceSegments.length > 0) {
        const effectiveRangeStart = Number.isFinite(activity?.start) && Number.isFinite(rangeStart)
            ? Math.max(activity.start, rangeStart)
            : rangeStart;
        const effectiveRangeEnd = Number.isFinite(activity?.end) && Number.isFinite(rangeEnd)
            ? Math.min(activity.end, rangeEnd)
            : rangeEnd;
        return sourceSegments.reduce((mix, segment) => {
            const duration = getClippedDurationMs(segment, effectiveRangeStart, effectiveRangeEnd);
            if (duration <= 0) return mix;
            return addTimelineActivityMix(mix, activityMixFromDuration(segment, duration));
        }, emptyActivityMix());
    }

    const clippedDuration = getClippedDurationMs(activity, rangeStart, rangeEnd);
    if (clippedDuration <= 0) return emptyActivityMix();

    const baseMix = activity?.activityMix;
    const baseHandsOn = Math.max(0, Number(baseMix?.handsOnMs || 0));
    const baseHandsOff = Math.max(0, Number(baseMix?.handsOffMs || 0));
    const baseTotal = baseHandsOn + baseHandsOff;

    if (baseTotal > 0) {
        const fullDuration = Math.max(
            baseTotal,
            Number.isFinite(activity?.start) && Number.isFinite(activity?.end)
                ? activity.end - activity.start
                : 0,
            Number(activity?.duration) || 0
        );
        const ratio = fullDuration > 0 ? Math.min(1, clippedDuration / fullDuration) : 1;
        return {
            handsOnMs: Math.round(baseHandsOn * ratio),
            handsOffMs: Math.round(baseHandsOff * ratio)
        };
    }

    return activityMixFromDuration(activity, clippedDuration);
}

function activityMixTotalMs(mix) {
    return Math.max(0, Number(mix?.handsOnMs || 0)) + Math.max(0, Number(mix?.handsOffMs || 0));
}

function activityMixHasAny(mix) {
    return activityMixTotalMs(mix) > 0;
}

function formatActivityMixDuration(ms) {
    const duration = Math.max(0, Number(ms) || 0);
    if (duration === 0) return '0s';
    if (duration >= 60000) return `${Math.round(duration / 60000)} min`;
    return `${Math.max(1, Math.round(duration / 1000))}s`;
}

function activityMixLabel(mix) {
    return `Hands-on ${formatActivityMixDuration(mix?.handsOnMs)} · Hands-off ${formatActivityMixDuration(mix?.handsOffMs)}`;
}

function activityMixTooltip(mix) {
    return `Activity Mix. ${activityMixLabel(mix)}. ${ACTIVITY_MIX_HANDS_ON_HELP} ${ACTIVITY_MIX_HANDS_OFF_HELP}`;
}

function activityMixTooltipData(mix) {
    return {
        tooltip: activityMixTooltip(mix),
        handsOnDuration: formatActivityMixDuration(mix?.handsOnMs),
        handsOffDuration: formatActivityMixDuration(mix?.handsOffMs)
    };
}

function activityMixHandsOnPercent(mix) {
    const handsOnMs = Math.max(0, Number(mix?.handsOnMs || 0));
    const handsOffMs = Math.max(0, Number(mix?.handsOffMs || 0));
    const totalMs = handsOnMs + handsOffMs;
    return totalMs > 0 ? (handsOnMs / totalMs) * 100 : 0;
}

function activityMixPillClass(mix, extraClass = '') {
    const classes = ['duration-pill'];
    if (activityMixHasAny(mix)) classes.push('activity-mix-pill');
    if (extraClass) classes.push(extraClass);
    return classes.join(' ');
}

function activityMixPillAttributes(mix) {
    if (!activityMixHasAny(mix)) return '';

    const tooltipData = activityMixTooltipData(mix);
    const handsOnPercent = formatCssNumber(activityMixHandsOnPercent(mix));
    return ` data-activity-mix-tooltip="${escapeAttribute(tooltipData.tooltip)}" data-activity-mix-hands-on-duration="${escapeAttribute(tooltipData.handsOnDuration)}" data-activity-mix-hands-off-duration="${escapeAttribute(tooltipData.handsOffDuration)}" aria-label="${escapeAttribute(tooltipData.tooltip)}" style="--activity-mix-hands-on: ${handsOnPercent}%"`;
}

function setActivityMixTooltipElementAttributes(element, mix) {
    if (!element) return;

    const tooltipData = activityMixTooltipData(mix);
    element.setAttribute?.('data-activity-mix-tooltip', tooltipData.tooltip);
    element.setAttribute?.('data-activity-mix-hands-on-duration', tooltipData.handsOnDuration);
    element.setAttribute?.('data-activity-mix-hands-off-duration', tooltipData.handsOffDuration);
    element.setAttribute?.('aria-label', tooltipData.tooltip);
}

function setActivityMixInfoTooltipElementAttributes(element) {
    if (!element) return;

    element.setAttribute?.('data-activity-mix-tooltip', ACTIVITY_MIX_INFO_HELP);
    element.setAttribute?.('data-activity-mix-tooltip-variant', 'summary');
    element.setAttribute?.('aria-label', ACTIVITY_MIX_INFO_HELP);
}

function clearActivityMixTooltipElementAttributes(element) {
    if (!element) return;

    element.removeAttribute?.('data-activity-mix-tooltip');
    element.removeAttribute?.('data-activity-mix-tooltip-variant');
    element.removeAttribute?.('data-activity-mix-hands-on-duration');
    element.removeAttribute?.('data-activity-mix-hands-off-duration');
    element.removeAttribute?.('aria-label');
}

function renderPopupActivityMix(mix) {
    const container = DOM.elPopupActivityMixContainer;
    const label = DOM.elPopupActivityMixLabel;
    const infoButton = DOM.elPopupActivityMixInfo;
    if (!container) return;

    if (!activityMixHasAny(mix)) {
        container.classList.add('hidden');
        container.title = '';
        container.removeAttribute?.('aria-label');
        clearActivityMixTooltipElementAttributes(infoButton);
        if (label) label.innerText = '';
        return;
    }

    const mixLabel = activityMixLabel(mix);
    const mixTooltip = activityMixTooltip(mix);
    container.classList.remove('hidden');
    container.title = '';
    container.setAttribute?.('aria-label', mixTooltip);
    setActivityMixInfoTooltipElementAttributes(infoButton);
    if (label) label.innerText = mixLabel;
    bindActivityMixTooltipInteractions(container);
}

function getActivityMixTooltipElement() {
    if (DOM.elActivityMixTooltip) return DOM.elActivityMixTooltip;
    if (!document?.createElement || !document?.body?.appendChild) return null;

    const tooltip = document.createElement('div');
    tooltip.id = 'activity-mix-tooltip';
    tooltip.className = 'activity-mix-tooltip hidden';
    tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltip);
    return tooltip;
}

function hideActivityMixTooltip() {
    const tooltip = getActivityMixTooltipElement();
    if (!tooltip) return;
    tooltip.classList.add('hidden');
    tooltip.innerText = '';
    tooltip.innerHTML = '';
}

function renderActivityMixTooltipHtml(trigger, tooltipText) {
    const variant = normalizeActivityText(trigger?.dataset?.activityMixTooltipVariant);
    const handsOnDuration = normalizeActivityText(trigger?.dataset?.activityMixHandsOnDuration);
    const handsOffDuration = normalizeActivityText(trigger?.dataset?.activityMixHandsOffDuration);

    if (variant === 'summary') {
        return `<div class="activity-mix-tooltip__body">${escapeTimelineText(tooltipText)}</div>`;
    }

    if (!handsOnDuration && !handsOffDuration) {
        return `<div class="activity-mix-tooltip__body">${escapeTimelineText(tooltipText)}</div>`;
    }

    return `
        <div class="activity-mix-tooltip__title">Activity Mix</div>
        <div class="activity-mix-tooltip__row">
            <div class="activity-mix-tooltip__row-header">
                <span class="activity-mix-tooltip__dot activity-mix-tooltip__dot--hands-on"></span>
                <span>Hands-on</span>
                <strong>${escapeTimelineText(handsOnDuration || '0s')}</strong>
            </div>
            <div class="activity-mix-tooltip__text">${escapeTimelineText(ACTIVITY_MIX_HANDS_ON_TOOLTIP_DESCRIPTION)}</div>
        </div>
        <div class="activity-mix-tooltip__row">
            <div class="activity-mix-tooltip__row-header">
                <span class="activity-mix-tooltip__dot activity-mix-tooltip__dot--hands-off"></span>
                <span>Hands-off</span>
                <strong>${escapeTimelineText(handsOffDuration || '0s')}</strong>
            </div>
            <div class="activity-mix-tooltip__text">${escapeTimelineText(ACTIVITY_MIX_HANDS_OFF_TOOLTIP_DESCRIPTION)}</div>
        </div>
    `;
}

function showActivityMixTooltip(trigger) {
    const tooltipText = normalizeActivityText(trigger?.dataset?.activityMixTooltip);
    if (!tooltipText) return;

    const tooltip = getActivityMixTooltipElement();
    if (!tooltip || !trigger?.getBoundingClientRect) return;

    tooltip.innerHTML = renderActivityMixTooltipHtml(trigger, tooltipText);
    tooltip.classList.remove('hidden');

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect?.() || { width: 0, height: 0 };
    const viewportWidth = window.innerWidth || document?.documentElement?.clientWidth || 0;
    const margin = 10;
    const preferredLeft = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);
    const maxLeft = Math.max(margin, viewportWidth - tooltipRect.width - margin);
    const left = Math.min(Math.max(margin, preferredLeft), maxLeft);
    const top = triggerRect.bottom + 8;

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
}

function bindActivityMixTooltipInteractions(root) {
    const triggers = root?.querySelectorAll?.('[data-activity-mix-tooltip]');
    if (!triggers) return;

    triggers.forEach(trigger => {
        if (trigger.dataset.activityMixTooltipBound === 'true') return;
        trigger.dataset.activityMixTooltipBound = 'true';
        trigger.addEventListener('mouseenter', () => showActivityMixTooltip(trigger));
        trigger.addEventListener('mouseleave', hideActivityMixTooltip);
        trigger.addEventListener('focus', () => showActivityMixTooltip(trigger));
        trigger.addEventListener('blur', hideActivityMixTooltip);
    });
}

function getActivityOverlapInRange(activity, rangeStart, rangeEnd) {
    if (!Number.isFinite(activity?.start) || !Number.isFinite(activity?.end)) return null;

    const start = Math.max(rangeStart, activity.start);
    const end = Math.min(rangeEnd, activity.end);
    if (end <= start) return null;

    return {
        ...activity,
        start,
        end,
        duration: end - start,
        activityMix: getActivityMixInRange(activity, start, end)
    };
}

function getActivityListCacheSignature(activities) {
    if (!Array.isArray(activities) || activities.length === 0) return '0';

    const first = activities[0] || {};
    const last = activities[activities.length - 1] || {};
    return [
        activities.length,
        first.start || '',
        first.end || '',
        last.start || '',
        last.end || ''
    ].join(':');
}

function hashTimelineSignatureValue(hash, value) {
    const text = normalizeActivityText(value);
    let nextHash = hash >>> 0;
    for (let index = 0; index < text.length; index++) {
        nextHash = ((nextHash * 33) ^ text.charCodeAt(index)) >>> 0;
    }
    return nextHash >>> 0;
}

function getTimelineActivityListSignature(activities) {
    if (!Array.isArray(activities) || activities.length === 0) return '0';

    let hash = activities.length >>> 0;
    activities.forEach(activity => {
        hash = hashTimelineSignatureValue(hash, activity?.start);
        hash = hashTimelineSignatureValue(hash, activity?.end);
        hash = hashTimelineSignatureValue(hash, activity?.duration);
        hash = hashTimelineSignatureValue(hash, activity?.app);
        hash = hashTimelineSignatureValue(hash, activity?.title);
        hash = hashTimelineSignatureValue(hash, activity?.url);
        hash = hashTimelineSignatureValue(hash, activity?.appPath);
        hash = hashTimelineSignatureValue(hash, activity?.bundleId);
    });
    return `${activities.length}:${hash}`;
}

function getTimelineTimeEntryListSignature(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '0';

    let hash = entries.length >>> 0;
    entries.forEach(entry => {
        hash = hashTimelineSignatureValue(hash, entry?.id);
        hash = hashTimelineSignatureValue(hash, entry?.start);
        hash = hashTimelineSignatureValue(hash, entry?.end);
        hash = hashTimelineSignatureValue(hash, entry?.projectId);
        hash = hashTimelineSignatureValue(hash, entry?.taskId);
        hash = hashTimelineSignatureValue(hash, entry?.createdBy);
        hash = hashTimelineSignatureValue(hash, entry?.autoRuleId);

        const activities = Array.isArray(entry?.activities) ? entry.activities : [];
        hash = hashTimelineSignatureValue(hash, activities.length);
        activities.forEach(activity => {
            hash = hashTimelineSignatureValue(hash, activity?.start);
            hash = hashTimelineSignatureValue(hash, activity?.end);
            hash = hashTimelineSignatureValue(hash, activity?.duration);
            hash = hashTimelineSignatureValue(hash, activity?.assignmentStart);
            hash = hashTimelineSignatureValue(hash, activity?.assignmentEnd);
            hash = hashTimelineSignatureValue(hash, activity?.assignedDurationMs);
            hash = hashTimelineSignatureValue(hash, activity?.assignmentSource);
            hash = hashTimelineSignatureValue(hash, activity?.assignmentModel);
            hash = hashTimelineSignatureValue(hash, activity?.assignmentDisplayStart);
            hash = hashTimelineSignatureValue(hash, activity?.assignmentDisplayEnd);
            hash = hashTimelineSignatureValue(hash, activity?.assignmentDisplayGroupKey);
            hash = hashTimelineSignatureValue(hash, activity?.assignmentDisplayZoom);
            hash = hashTimelineSignatureValue(hash, activity?.selectedSimilarityMode);
            hash = hashTimelineSignatureValue(hash, activity?.selectedSimilarityMatchKey);
            hash = hashTimelineSignatureValue(hash, activity?.app);
            hash = hashTimelineSignatureValue(hash, activity?.title);
            hash = hashTimelineSignatureValue(hash, activity?.url);
            hash = hashTimelineSignatureValue(hash, activity?.appPath);
            hash = hashTimelineSignatureValue(hash, activity?.bundleId);
            const sources = Array.isArray(activity?.sources) ? activity.sources : [];
            hash = hashTimelineSignatureValue(hash, sources.length);
            sources.forEach(source => {
                hash = hashTimelineSignatureValue(hash, source?.start);
                hash = hashTimelineSignatureValue(hash, source?.end);
                hash = hashTimelineSignatureValue(hash, source?.duration);
                hash = hashTimelineSignatureValue(hash, source?.assignedDurationMs);
                hash = hashTimelineSignatureValue(hash, source?.assignmentStart);
                hash = hashTimelineSignatureValue(hash, source?.assignmentEnd);
                hash = hashTimelineSignatureValue(hash, source?.app);
                hash = hashTimelineSignatureValue(hash, source?.title);
                hash = hashTimelineSignatureValue(hash, source?.url);
                hash = hashTimelineSignatureValue(hash, source?.appPath);
                hash = hashTimelineSignatureValue(hash, source?.bundleId);
            });
        });
    });
    return `${entries.length}:${hash}`;
}

function buildVisibleActivityCells({ dateStartOfDay, zoom, ownershipActivities, visibleActivities }) {
    const totalCells = Math.floor(1440 / zoom);
    const ownershipList = Array.isArray(ownershipActivities) ? ownershipActivities : [];
    const visibleList = Array.isArray(visibleActivities) ? visibleActivities : ownershipList;
    const usesSeparateVisibilitySource = ownershipList !== visibleList;
    const ownershipSignature = getActivityListCacheSignature(ownershipList);
    const visibleSignature = usesSeparateVisibilitySource
        ? getActivityListCacheSignature(visibleList)
        : 'same';

    if (visibleActivityCellsCache
        && visibleActivityCellsCache.dateStartOfDay === dateStartOfDay
        && visibleActivityCellsCache.zoom === zoom
        && visibleActivityCellsCache.ownershipList === ownershipList
        && visibleActivityCellsCache.visibleList === visibleList
        && visibleActivityCellsCache.ownershipSignature === ownershipSignature
        && visibleActivityCellsCache.visibleSignature === visibleSignature) {
        return visibleActivityCellsCache.cells;
    }

    const cellActivities = new Array(totalCells).fill(null);

    for (let i = 0; i < totalCells; i++) {
        const cellStart = dateStartOfDay + i * zoom * 60 * 1000;
        const cellEnd = cellStart + zoom * 60 * 1000;
        const ownershipOverlaps = ownershipList
            .map(activity => getActivityOverlapInRange(activity, cellStart, cellEnd))
            .filter(Boolean);

        if (ownershipOverlaps.length === 0) continue;

        const groups = {};
        for (const overlap of ownershipOverlaps) {
            const key = getActivitySummaryKey(overlap);
            if (!groups[key]) {
                groups[key] = {
                    duration: 0,
                    activityMix: emptyActivityMix(),
                    app: overlap.app,
                    title: getActivityDisplayTitle(overlap),
                    url: overlap.url,
                    appPath: overlap.appPath || '',
                    bundleId: overlap.bundleId || '',
                    summaryKey: key
                };
            }
            groups[key].duration += overlap.duration;
            groups[key].activityMix = addTimelineActivityMix(groups[key].activityMix, overlap.activityMix);
        }

        let dominant = null;
        for (const key in groups) {
            if (!dominant || groups[key].duration > dominant.duration) {
                dominant = groups[key];
            }
        }

        const minOwnershipDuration = zoom * 60 * 1000 * ACTIVITY_STREAM_MIN_OWNERSHIP_RATIO;
        const minVisibleDuration = Math.max(minOwnershipDuration, ACTIVITY_STREAM_MIN_VISIBLE_DURATION_MS);
        if (!dominant || dominant.duration < minVisibleDuration) {
            continue;
        }

        let detailsOverlaps = ownershipOverlaps;
        if (usesSeparateVisibilitySource) {
            const visibleOverlaps = visibleList
                .map(activity => getActivityOverlapInRange(activity, cellStart, cellEnd))
                .filter(Boolean);
            const dominantIsVisible = visibleOverlaps
                .some(overlap => getActivitySummaryKey(overlap) === dominant.summaryKey);

            if (!dominantIsVisible) continue;

            detailsOverlaps = visibleOverlaps.concat(
                ownershipOverlaps.filter(overlap => getActivitySummaryKey(overlap) === dominant.summaryKey)
            );
        }

        cellActivities[i] = {
            ...dominant,
            start: cellStart,
            end: cellEnd,
            overlaps: detailsOverlaps
        };
    }

    visibleActivityCellsCache = {
        dateStartOfDay,
        zoom,
        ownershipList,
        visibleList,
        ownershipSignature,
        visibleSignature,
        cells: cellActivities
    };

    return cellActivities;
}

function getMergedActivityRangeDurationMs(ranges) {
    const sortedRanges = (Array.isArray(ranges) ? ranges : [])
        .map(range => ({
            start: Number(range?.start),
            end: Number(range?.end)
        }))
        .filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
        .sort((left, right) => left.start - right.start || left.end - right.end);

    let total = 0;
    let current = null;
    for (const range of sortedRanges) {
        if (!current || range.start > current.end) {
            if (current) total += current.end - current.start;
            current = { ...range };
            continue;
        }

        current.end = Math.max(current.end, range.end);
    }

    if (current) total += current.end - current.start;
    return total;
}

function getActivityStreamSessionKey(activity) {
    return getActivitySimilarityKey(activity) || getActivitySummaryKey(activity);
}

function getActivityStreamSourceOverlaps(block, detailActivities) {
    const details = Array.isArray(detailActivities) && detailActivities.length > 0
        ? detailActivities
        : block.sources;
    const overlaps = details
        .map(activity => getActivityOverlapInRange(activity, block.start, block.end))
        .filter(Boolean);

    return overlaps.length > 0 ? overlaps : block.sources.map(source => ({ ...source }));
}

function getAssignedActivityStreamRange(activity) {
    const start = Number(activity?.assignmentStart ?? activity?.start);
    const end = Number(activity?.assignmentEnd ?? activity?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

    const duration = Number(activity?.assignedDurationMs);
    return {
        start,
        end,
        duration: Number.isFinite(duration) && duration > 0 ? duration : end - start
    };
}

function buildAssignedActivityStreamRangeIndex(timeEntries) {
    const index = new Map();

    (Array.isArray(timeEntries) ? timeEntries : []).forEach(entry => {
        getActivityStreamAssignmentActivities(entry).forEach(activity => {
            const key = getActivityStreamSessionKey(activity);
            const range = getAssignedActivityStreamRange(activity);
            if (!key || !range || range.duration <= 0) return;

            if (!index.has(key)) index.set(key, []);
            index.get(key).push(range);
        });
    });

    return index;
}

function getAssignedActivityStreamOverlapMs(source, assignedRangeIndex) {
    if (!assignedRangeIndex || assignedRangeIndex.size === 0) return 0;

    const key = source?.similarityKey || getActivityStreamSessionKey(source);
    const ranges = key ? assignedRangeIndex.get(key) : null;
    if (!Array.isArray(ranges) || ranges.length === 0) return 0;

    return ranges.reduce((total, range) => {
        const start = Math.max(source.start, range.start);
        const end = Math.min(source.end, range.end);
        return end > start ? total + (end - start) : total;
    }, 0);
}

function createActivityStreamForegroundBlock(source, detailActivities) {
    const duration = getActivitySourceDuration(source, source.start, source.end);
    const block = {
        app: source.app || '',
        title: getActivityDisplayTitle(source) || source.title || '',
        url: source.url || '',
        appPath: source.appPath || '',
        bundleId: source.bundleId || '',
        similarityKey: source.similarityKey,
        summaryKey: source.summaryKey,
        start: source.start,
        end: source.end,
        activeDurationMs: duration,
        elapsedDurationMs: source.end - source.start,
        duration,
        assignedDurationMs: Number(source.assignedDurationMs) || 0,
        interruptionCount: 0,
        sources: [source],
        activityMix: source.activityMix || emptyActivityMix()
    };
    return block;
}

function mergeAdjacentActivityStreamForegroundBlock(block, source, detailActivities) {
    const additionalActiveDurationMs = Math.max(0, source.end - Math.max(source.start, block.end));
    block.end = Math.max(block.end, source.end);
    block.sources.push(source);
    block.activeDurationMs += additionalActiveDurationMs;
    block.assignedDurationMs += Number(source.assignedDurationMs) || 0;
    block.elapsedDurationMs = block.end - block.start;
    block.duration = block.activeDurationMs;
    block.activityMix = addTimelineActivityMix(block.activityMix || emptyActivityMix(), source.activityMix || emptyActivityMix());
    return block;
}

function shouldTreatSourceAsAssignedSessionInterruption(currentBlock, source, mergeGapMs, minVisibleDurationMs) {
    if (!currentBlock || !source) return false;
    if (currentBlock.similarityKey === source.similarityKey) return false;
    if (source.start > currentBlock.end + mergeGapMs) return false;
    if ((Number(currentBlock.assignedDurationMs) || 0) <= 0) return false;
    if ((Number(source.assignedDurationMs) || 0) > 0) return false;

    return getActivitySourceDuration(source, source.start, source.end) < minVisibleDurationMs;
}

function collectVisibleActivityStreamSourceIndexes(sources, mergeGapMs, minVisibleDurationMs) {
    const byKey = new Map();
    for (const source of sources) {
        if (!source.similarityKey) continue;
        if (!byKey.has(source.similarityKey)) byKey.set(source.similarityKey, []);
        byKey.get(source.similarityKey).push(source);
    }

    const visibleIndexes = new Set();
    for (const keySources of byKey.values()) {
        keySources.sort((left, right) => left.start - right.start || left.end - right.end);

        let current = [];
        let currentEnd = null;
        const flushCurrent = () => {
            if (current.length === 0) return;
            if (getMergedActivityRangeDurationMs(current) >= minVisibleDurationMs) {
                current.forEach(source => visibleIndexes.add(source.sourceIndex));
            }
            current = [];
            currentEnd = null;
        };

        for (const source of keySources) {
            if (current.length === 0 || source.start <= currentEnd + mergeGapMs) {
                current.push(source);
                currentEnd = Number.isFinite(currentEnd) ? Math.max(currentEnd, source.end) : source.end;
                continue;
            }

            flushCurrent();
            current.push(source);
            currentEnd = source.end;
        }

        flushCurrent();
    }

    return visibleIndexes;
}

function buildActivityStreamSessions({
    dateStartOfDay,
    activities,
    detailActivities = null,
    timeEntries = null,
    mergeGapMs = ACTIVITY_STREAM_SESSION_MERGE_GAP_MS,
    minVisibleDurationMs = ACTIVITY_STREAM_MIN_VISIBLE_SESSION_DURATION_MS,
    minExactFragmentDurationMs = ACTIVITY_STREAM_MIN_EXACT_FRAGMENT_DURATION_MS
} = {}) {
    const dayStart = Number.isFinite(dateStartOfDay)
        ? dateStartOfDay
        : new Date(state.currentDate).setHours(0,0,0,0);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const list = Array.isArray(activities) ? activities : [];
    const detailList = Array.isArray(detailActivities) ? detailActivities : list;
    const assignedRangeIndex = buildAssignedActivityStreamRangeIndex(timeEntries);
    const sources = [];

    incrementTimelineDiagnostic('activitySessionBuilds');

    list.forEach((activity, sourceIndex) => {
        const source = getActivityOverlapInRange(activity, dayStart, dayEnd);
        if (!source) return;

        const key = getActivityStreamSessionKey(source);
        if (!key) return;

        const normalizedSource = {
            ...source,
            sourceIndex,
            similarityKey: key,
            summaryKey: getActivitySummaryKey(source),
            title: getActivityDisplayTitle(source) || source.title || '',
            duration: getActivitySourceDuration(source, source.start, source.end),
            activityMix: getActivityMixInRange(source, source.start, source.end)
        };
        normalizedSource.assignedDurationMs = getAssignedActivityStreamOverlapMs(normalizedSource, assignedRangeIndex);
        if (normalizedSource.duration > 0) sources.push(normalizedSource);
    });

    sources.sort((left, right) => left.start - right.start || left.end - right.end || left.sourceIndex - right.sourceIndex);
    const visibleIndexes = collectVisibleActivityStreamSourceIndexes(sources, mergeGapMs, minVisibleDurationMs);
    const blocks = [];
    let currentBlock = null;

    const flushCurrent = () => {
        if (!currentBlock) return;
        if ((currentBlock.activeDurationMs || 0) >= minExactFragmentDurationMs) {
            currentBlock.overlaps = getActivityStreamSourceOverlaps(currentBlock, detailList);
            blocks.push(currentBlock);
        }
        currentBlock = null;
    };

    for (const source of sources) {
        if (!visibleIndexes.has(source.sourceIndex)) {
            if (currentBlock && source.start <= currentBlock.end + mergeGapMs) {
                if (source.similarityKey !== currentBlock.similarityKey) {
                    currentBlock.interruptionCount = (Number(currentBlock.interruptionCount) || 0) + 1;
                }
            } else {
                flushCurrent();
            }
            continue;
        }

        if (shouldTreatSourceAsAssignedSessionInterruption(currentBlock, source, mergeGapMs, minVisibleDurationMs)) {
            currentBlock.interruptionCount = (Number(currentBlock.interruptionCount) || 0) + 1;
            continue;
        }

        const canMergeWithCurrent = currentBlock
            && currentBlock.similarityKey === source.similarityKey
            && source.start <= currentBlock.end + mergeGapMs;

        if (canMergeWithCurrent) {
            mergeAdjacentActivityStreamForegroundBlock(currentBlock, source, detailList);
            continue;
        }

        flushCurrent();
        currentBlock = createActivityStreamForegroundBlock(source, detailList);
    }

    flushCurrent();
    return blocks;
}

function getCurrentDayTimelineActivitySessions(dateStartOfDay) {
    const ownershipActivities = Array.isArray(state.timelineActivities)
        ? state.timelineActivities
        : state.activities;
    const visibleActivities = Array.isArray(state.activities)
        ? state.activities
        : ownershipActivities;
    return buildActivityStreamSessions({
        dateStartOfDay,
        activities: ownershipActivities,
        detailActivities: visibleActivities
    });
}

function getActivityDurationForSummaryWithinRange(activities, summaryKey, rangeStart, rangeEnd) {
    return (Array.isArray(activities) ? activities : []).reduce((total, activity) => {
        if (getActivitySummaryKey(activity) !== summaryKey) return total;

        const overlap = getActivityOverlapInRange(activity, rangeStart, rangeEnd);
        return total + (overlap?.duration || 0);
    }, 0);
}

function buildVisibleActivityRunsForSummary({
    dateStartOfDay,
    rangeStart,
    rangeEnd,
    summaryKey,
    ownershipActivities,
    visibleActivities,
    zoom = 1
}) {
    if (!Number.isFinite(dateStartOfDay)
        || !Number.isFinite(rangeStart)
        || !Number.isFinite(rangeEnd)
        || rangeEnd <= rangeStart
        || !summaryKey) {
        return [];
    }

    const cellDurationMs = zoom * 60 * 1000;
    const cellActivities = buildVisibleActivityCells({
        dateStartOfDay,
        zoom,
        ownershipActivities,
        visibleActivities
    });
    const firstCell = Math.max(0, Math.floor((rangeStart - dateStartOfDay) / cellDurationMs));
    const lastCell = Math.min(cellActivities.length, Math.ceil((rangeEnd - dateStartOfDay) / cellDurationMs));
    const runs = [];

    for (let i = firstCell; i < lastCell; i++) {
        const cell = cellActivities[i];
        if (!cell || cell.summaryKey !== summaryKey) continue;

        const start = Math.max(rangeStart, cell.start);
        const end = Math.min(rangeEnd, cell.end);
        if (end <= start) continue;

        const duration = start === cell.start && end === cell.end
            ? cell.duration
            : getActivityDurationForSummaryWithinRange(ownershipActivities, summaryKey, start, end);
        if (duration <= 0) continue;
        const activityMix = start === cell.start && end === cell.end
            ? (cell.activityMix || emptyActivityMix())
            : getActivityMixInRange(cell, start, end);

        const previous = runs[runs.length - 1];
        if (previous && previous.end === start) {
            previous.end = end;
            previous.duration += duration;
            previous.activityMix = addTimelineActivityMix(previous.activityMix, activityMix);
        } else {
            runs.push({
                app: cell.app,
                title: cell.title,
                url: cell.url,
                appPath: cell.appPath || '',
                bundleId: cell.bundleId || '',
                start,
                end,
                duration,
                activityMix
            });
        }
    }

    return runs;
}

function stripActivitySources(activity) {
    const { sources, ...snapshot } = activity || {};
    return snapshot;
}

function buildSourceBackedAssignmentRuns(selectedActivity, rangeStart, rangeEnd, summaryKey) {
    const sourceActivities = Array.isArray(selectedActivity?.sources) && selectedActivity.sources.length > 0
        ? selectedActivity.sources
        : [selectedActivity];
    const runs = [];

    for (const source of sourceActivities) {
        if (!source || getActivitySummaryKey(source) !== summaryKey) continue;

        const overlapStart = Math.max(source.start, rangeStart);
        const overlapEnd = Math.min(source.end, rangeEnd);
        if (!Number.isFinite(overlapStart) || !Number.isFinite(overlapEnd) || overlapEnd <= overlapStart) continue;

        const runStart = Math.floor(overlapStart / 60000) * 60000;
        const runEnd = Math.ceil(overlapEnd / 60000) * 60000;
        const duration = getActivitySourceDuration(source, rangeStart, rangeEnd);
        if (duration <= 0) continue;
        const previous = runs[runs.length - 1];

        if (previous && previous.end >= runStart) {
            previous.end = Math.max(previous.end, runEnd);
            previous.duration += duration;
        } else {
            runs.push({
                app: source.app,
                title: getActivityDisplayTitle(source),
                url: source.url,
                appPath: source.appPath || '',
                bundleId: source.bundleId || '',
                start: runStart,
                end: runEnd,
                duration,
                activityMix: getActivityMixInRange(source, rangeStart, rangeEnd)
            });
        }
    }

    return runs;
}

function buildActivityStreamAssignmentActivities(selectedActivity, rangeStart, rangeEnd, summaryKey, dateStartOfDay) {
    const key = summaryKey || getActivitySummaryKey(selectedActivity);
    const dayStart = Number.isFinite(dateStartOfDay)
        ? dateStartOfDay
        : new Date(state.currentDate).setHours(0,0,0,0);
    const ownershipActivities = Array.isArray(state.timelineActivities)
        ? state.timelineActivities
        : state.activities;
    const visibleActivities = Array.isArray(state.activities)
        ? state.activities
        : ownershipActivities;
    let runs = buildVisibleActivityRunsForSummary({
        dateStartOfDay: dayStart,
        rangeStart,
        rangeEnd,
        summaryKey: key,
        ownershipActivities,
        visibleActivities,
        zoom: 1
    });

    if (runs.length === 0) {
        runs = buildSourceBackedAssignmentRuns(selectedActivity, rangeStart, rangeEnd, key);
    }

    const base = stripActivitySources(selectedActivity);
    return runs.map(run => ({
        ...base,
        app: run.app || base.app,
        title: run.title || base.title,
        url: run.url || base.url,
        appPath: run.appPath || base.appPath || '',
        bundleId: run.bundleId || base.bundleId || '',
        start: run.start,
        end: run.end,
        duration: run.duration,
        activityMix: run.activityMix,
        assignedDurationMs: run.duration,
        assignmentStart: run.start,
        assignmentEnd: run.end,
        assignmentSource: 'activity-stream',
        assignmentModel: ACTIVITY_STREAM_SUMMARY_ASSIGNMENT_MODEL,
        assignmentDisplayZoom: Number.isFinite(state?.zoom) ? state.zoom : undefined
    }));
}

function getActivityStreamAssignmentDisplayBounds(activity) {
    const displayStart = Number(activity?.assignmentDisplayStart);
    const displayEnd = Number(activity?.assignmentDisplayEnd);
    if (!Number.isFinite(displayStart) || !Number.isFinite(displayEnd) || displayEnd <= displayStart) {
        return null;
    }

    return {
        start: displayStart,
        end: displayEnd
    };
}

function assignmentDisplayBoundsMatchCurrentZoom(activity, zoom) {
    const assignmentDisplayZoom = Number(activity?.assignmentDisplayZoom);
    const renderZoom = Math.max(1, Number(zoom) || 1);
    return Number.isFinite(assignmentDisplayZoom)
        && Math.max(1, assignmentDisplayZoom) === renderZoom;
}

function buildActivityStreamAssignmentDisplayGroupKey(activity, displayStart, displayEnd) {
    const explicitKey = normalizeActivityText(activity?.assignmentDisplayGroupKey).trim();
    if (explicitKey) return explicitKey;

    const summaryKey = getActivitySummaryKey(activity);
    return `activity-stream-row|||${summaryKey}|||${displayStart}|||${displayEnd}`;
}

function applyActivityStreamAssignmentDisplayMetadata(activity, displayStart, displayEnd, displayGroupKey = '') {
    if (!activity || !Number.isFinite(displayStart) || !Number.isFinite(displayEnd) || displayEnd <= displayStart) {
        return activity;
    }

    const assignmentDisplayGroupKey = displayGroupKey || buildActivityStreamAssignmentDisplayGroupKey(activity, displayStart, displayEnd);
    return {
        ...activity,
        assignmentDisplayStart: displayStart,
        assignmentDisplayEnd: displayEnd,
        assignmentDisplayGroupKey,
        ...(Array.isArray(activity.sources) ? {
            sources: activity.sources.map(source => applyActivityStreamAssignmentDisplayMetadata(
                source,
                displayStart,
                displayEnd,
                assignmentDisplayGroupKey
            ))
        } : {}),
        ...(Array.isArray(activity.modalSourceActivities) ? {
            modalSourceActivities: activity.modalSourceActivities.map(source => applyActivityStreamAssignmentDisplayMetadata(
                source,
                displayStart,
                displayEnd,
                assignmentDisplayGroupKey
            ))
        } : {})
    };
}

function buildActivityStreamSummaryAssignmentActivity(selectedActivity, rangeStart, rangeEnd, zoom = state.zoom, options = {}) {
    const duration = getActivitySourceDuration(selectedActivity, rangeStart, rangeEnd);
    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart || duration <= 0) {
        return null;
    }

    const base = stripActivitySources(selectedActivity);
    const sources = Array.isArray(selectedActivity?.sources)
        ? selectedActivity.sources.map(source => {
            const sourceStart = Number.isFinite(source?.start) ? Math.max(source.start, rangeStart) : source?.start;
            const sourceEnd = Number.isFinite(source?.end) ? Math.min(source.end, rangeEnd) : source?.end;
            const sourceDuration = getActivitySourceDuration(source, rangeStart, rangeEnd);
            if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart || sourceDuration <= 0) {
                return null;
            }
            return {
                ...stripActivitySources(source),
                title: getActivityDisplayTitle(source),
                appPath: source.appPath || '',
                bundleId: source.bundleId || '',
                start: sourceStart,
                end: sourceEnd,
                duration: sourceDuration,
                assignedDurationMs: sourceDuration,
                activityMix: getActivityMixInRange(source, rangeStart, rangeEnd),
                assignmentStart: sourceStart,
                assignmentEnd: sourceEnd,
                assignmentSource: 'activity-stream',
                assignmentModel: ACTIVITY_STREAM_SUMMARY_ASSIGNMENT_MODEL,
                assignmentDisplayZoom: zoom
            };
        }).filter(Boolean)
        : [];
    const assignment = {
        ...base,
        title: getActivityDisplayTitle(selectedActivity),
        start: rangeStart,
        end: rangeEnd,
        duration,
        activityMix: getActivityMixInRange(selectedActivity, rangeStart, rangeEnd),
        assignedDurationMs: duration,
        assignmentStart: rangeStart,
        assignmentEnd: rangeEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: ACTIVITY_STREAM_SUMMARY_ASSIGNMENT_MODEL,
        assignmentDisplayZoom: zoom,
        ...(sources.length > 0 ? { sources, modalSourceActivities: sources } : {})
    };

    const displayStart = Number(options?.assignmentDisplayStart);
    const displayEnd = Number(options?.assignmentDisplayEnd);
    if (Number.isFinite(displayStart) && Number.isFinite(displayEnd) && displayEnd > displayStart) {
        return applyActivityStreamAssignmentDisplayMetadata(
            assignment,
            displayStart,
            displayEnd,
            options?.assignmentDisplayGroupKey || ''
        );
    }

    return assignment;
}

function buildActivityStreamSummaryAssignmentActivities(activities, rangeStart, rangeEnd, zoom = state.zoom, options = {}) {
    return (Array.isArray(activities) ? activities : [])
        .map(activity => buildActivityStreamSummaryAssignmentActivity(activity, rangeStart, rangeEnd, zoom, options))
        .filter(Boolean);
}

function getMatchingActivitySourceRanges(overlaps, summaryKey) {
    return (Array.isArray(overlaps) ? overlaps : [])
        .filter(overlap => getActivitySummaryKey(overlap) === summaryKey)
        .map(overlap => ({
            start: Number(overlap?.start),
            end: Number(overlap?.end)
        }))
        .filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
        .sort((left, right) => left.start - right.start || left.end - right.end);
}

function hasContinuousMatchingActivityAcrossBoundary(currentBlock, nextCell) {
    if (!currentBlock || !nextCell || currentBlock.summaryKey !== nextCell.summaryKey) return false;

    const currentRanges = getMatchingActivitySourceRanges(currentBlock.overlaps, currentBlock.summaryKey);
    const nextRanges = getMatchingActivitySourceRanges(nextCell.overlaps, nextCell.summaryKey);
    if (currentRanges.length === 0 || nextRanges.length === 0) return false;

    const currentEnd = Math.max(...currentRanges.map(range => range.end));
    const nextStart = Math.min(...nextRanges.map(range => range.start));
    return nextStart <= currentEnd + ACTIVITY_STREAM_SESSION_MERGE_GAP_MS;
}

function subtractTimelineRanges(baseRanges, blockerRanges) {
    const blockers = (Array.isArray(blockerRanges) ? blockerRanges : [])
        .filter(range => Number.isFinite(range?.start) && Number.isFinite(range?.end) && range.end > range.start)
        .sort((left, right) => left.start - right.start || left.end - right.end);
    const output = [];

    for (const range of Array.isArray(baseRanges) ? baseRanges : []) {
        if (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.end <= range.start) continue;

        let fragments = [{ start: range.start, end: range.end }];
        for (const blocker of blockers) {
            fragments = fragments.flatMap(fragment => {
                if (blocker.end <= fragment.start || blocker.start >= fragment.end) return [fragment];

                const pieces = [];
                if (blocker.start > fragment.start) pieces.push({ start: fragment.start, end: blocker.start });
                if (blocker.end < fragment.end) pieces.push({ start: blocker.end, end: fragment.end });
                return pieces;
            });
        }
        output.push(...fragments.filter(fragment => fragment.end > fragment.start));
    }

    return output;
}

function getLoggedSourceSnapshotRange(entry, activity, dayStart, dayEnd) {
    if (!activity) return null;

    const rawStart = Number.isFinite(activity.assignmentStart)
        ? activity.assignmentStart
        : (Number.isFinite(activity.start) ? activity.start : entry?.start);
    const rawEnd = Number.isFinite(activity.assignmentEnd)
        ? activity.assignmentEnd
        : (Number.isFinite(activity.end) ? activity.end : entry?.end);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) return null;

    const start = Math.max(dayStart, rawStart);
    const end = Math.min(dayEnd, rawEnd);
    if (end <= start) return null;

    const matchKeys = new Set();
    addActivityMatchKeys(matchKeys, activity);
    if (matchKeys.size === 0) return null;

    return { start, end, matchKeys };
}

function getLoggedSourceSnapshotRanges(timeEntries, dayStart, dayEnd) {
    const ranges = [];

    for (const entry of Array.isArray(timeEntries) ? timeEntries : []) {
        for (const activity of Array.isArray(entry?.activities) ? entry.activities : []) {
            const sourceActivities = Array.isArray(activity?.sources) && activity.sources.length > 0
                ? activity.sources
                : [activity];
            sourceActivities.forEach(sourceActivity => {
                const range = getLoggedSourceSnapshotRange(entry, sourceActivity, dayStart, dayEnd);
                if (range) ranges.push(range);
            });
        }
    }

    return ranges;
}

function buildLoggedSourceSnapshotRangeIndex(timeEntries, dayStart, dayEnd) {
    const ranges = getLoggedSourceSnapshotRanges(timeEntries, dayStart, dayEnd);
    const rangesByKey = new Map();

    ranges.forEach((range, index) => {
        range.index = index;
        range.matchKeys.forEach(key => {
            if (!rangesByKey.has(key)) rangesByKey.set(key, []);
            rangesByKey.get(key).push(range);
        });
    });

    return { ranges, rangesByKey };
}

function getLoggedSourceSnapshotRangesForActivity(activity, index) {
    const matchKeys = new Set();
    addActivityMatchKeys(matchKeys, activity);
    if (matchKeys.size === 0 || !index?.rangesByKey) return [];

    const seenIndexes = new Set();
    const ranges = [];
    matchKeys.forEach(key => {
        for (const range of index.rangesByKey.get(key) || []) {
            if (seenIndexes.has(range.index)) continue;
            seenIndexes.add(range.index);
            ranges.push(range);
        }
    });
    incrementTimelineDiagnostic('unloggedCandidateRangeChecks', ranges.length);
    return ranges;
}

function getUnloggedActivityContextKey(activity) {
    return getActivitySummaryKey(activity) || getActivitySimilarityKey(activity) || getActivityIdentityKey(activity);
}

function getUnloggedActivityLabel(activity) {
    const title = getActivityDisplayTitle(activity);
    const host = getActivitySummaryHostname(activity);
    return title || host || normalizeActivityText(activity?.app).trim() || 'Recorded Activity';
}

function buildUnloggedActivityGroups({
    activities,
    timeEntries,
    dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0)
} = {}) {
    const dayStart = Number.isFinite(dateStartOfDay)
        ? dateStartOfDay
        : new Date(state.currentDate).setHours(0,0,0,0);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const loggedRangeIndex = buildLoggedSourceSnapshotRangeIndex(timeEntries || state.timeEntries, dayStart, dayEnd);
    const groupsByKey = new Map();
    let fragmentIndex = 0;

    for (const activity of Array.isArray(activities) ? activities : []) {
        const clipped = getActivityOverlapInRange(activity, dayStart, dayEnd);
        if (!clipped) continue;

        const matchingLoggedRanges = getLoggedSourceSnapshotRangesForActivity(clipped, loggedRangeIndex);
        const unloggedRanges = subtractTimelineRanges([clipped], matchingLoggedRanges);
        for (const range of unloggedRanges) {
            const duration = range.end - range.start;
            if (duration <= 0) continue;

            const groupKey = getUnloggedActivityContextKey(clipped);
            if (!groupsByKey.has(groupKey)) {
                groupsByKey.set(groupKey, {
                    id: `unlogged-group-${groupsByKey.size + 1}`,
                    key: groupKey,
                    app: normalizeActivityText(clipped.app),
                    title: getUnloggedActivityLabel(clipped),
                    url: normalizeActivityText(clipped.url),
                    appPath: normalizeActivityText(clipped.appPath),
                    bundleId: normalizeActivityText(clipped.bundleId),
                    durationMs: 0,
                    start: range.start,
                    end: range.end,
                    fragments: []
                });
            }

            const group = groupsByKey.get(groupKey);
            const fragment = {
                ...clipped,
                id: `unlogged-fragment-${++fragmentIndex}`,
                start: range.start,
                end: range.end,
                duration,
                assignedDurationMs: duration,
                assignmentStart: range.start,
                assignmentEnd: range.end,
                assignmentSource: 'activity-stream',
                assignmentModel: ACTIVITY_STREAM_SUMMARY_ASSIGNMENT_MODEL,
                assignmentDisplayZoom: Number.isFinite(state?.zoom) ? state.zoom : undefined
            };

            group.fragments.push(fragment);
            group.durationMs += duration;
            group.start = Math.min(group.start, range.start);
            group.end = Math.max(group.end, range.end);
        }
    }

    return Array.from(groupsByKey.values())
        .map(group => ({
            ...group,
            fragments: group.fragments.sort((left, right) => left.start - right.start || left.end - right.end)
        }))
        .sort((left, right) => right.durationMs - left.durationMs || left.start - right.start);
}

function buildUnloggedBackfillActivities(groups, selectedFragmentIds = null) {
    const selectedIds = Array.isArray(selectedFragmentIds) && selectedFragmentIds.length > 0
        ? new Set(selectedFragmentIds)
        : null;
    const activities = [];

    for (const group of Array.isArray(groups) ? groups : []) {
        for (const fragment of Array.isArray(group?.fragments) ? group.fragments : []) {
            if (selectedIds && !selectedIds.has(fragment.id)) continue;

            const duration = Math.max(0, fragment.end - fragment.start);
            if (duration <= 0) continue;
            activities.push({
                ...fragment,
                duration,
                assignedDurationMs: duration,
                assignmentStart: fragment.start,
                assignmentEnd: fragment.end,
                assignmentSource: 'activity-stream',
                assignmentModel: ACTIVITY_STREAM_SUMMARY_ASSIGNMENT_MODEL,
                assignmentDisplayZoom: Number.isFinite(state?.zoom) ? state.zoom : undefined,
                modalAggregateGroupKey: group?.key || getUnloggedActivityContextKey(fragment)
            });
        }
    }

    return activities.sort((left, right) => left.start - right.start || left.end - right.end);
}

function getCurrentUnloggedActivityGroups() {
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    return buildUnloggedActivityGroups({
        activities: Array.isArray(state.timelineActivities) ? state.timelineActivities : state.activities,
        timeEntries: state.timeEntries,
        dateStartOfDay
    });
}

function buildActionableUnloggedActivityReview(groups) {
    const visibleGroups = [];
    let hiddenFragmentCount = 0;

    for (const group of Array.isArray(groups) ? groups : []) {
        const actionableFragments = (Array.isArray(group?.fragments) ? group.fragments : [])
            .filter(fragment => {
                const duration = Number(fragment?.end) - Number(fragment?.start);
                return Number.isFinite(duration) && duration >= UNLOGGED_WORK_MIN_REVIEW_FRAGMENT_DURATION_MS;
            });
        hiddenFragmentCount += Math.max(0, (group?.fragments?.length || 0) - actionableFragments.length);

        const durationMs = actionableFragments.reduce((total, fragment) => {
            const duration = Math.max(0, Number(fragment.end) - Number(fragment.start));
            return total + duration;
        }, 0);

        if (durationMs < UNLOGGED_WORK_MIN_REVIEW_GROUP_DURATION_MS) {
            hiddenFragmentCount += actionableFragments.length;
            continue;
        }

        visibleGroups.push({
            ...group,
            durationMs,
            start: Math.min(...actionableFragments.map(fragment => fragment.start)),
            end: Math.max(...actionableFragments.map(fragment => fragment.end)),
            fragments: actionableFragments
        });
    }

    return {
        groups: visibleGroups.sort((left, right) => right.durationMs - left.durationMs || left.start - right.start),
        hiddenFragmentCount
    };
}

function getCurrentActionableUnloggedActivityReview() {
    return buildActionableUnloggedActivityReview(getCurrentUnloggedActivityGroups());
}

function draftUnloggedRecordedWorkGroup(groupId) {
    const groups = Array.isArray(state.unloggedActivityGroups) && state.unloggedActivityGroups.length > 0
        ? state.unloggedActivityGroups
        : getCurrentActionableUnloggedActivityReview().groups;
    const group = groups.find(candidate => candidate.id === groupId);
    if (!group) return;

    const activities = buildUnloggedBackfillActivities([group]);
    if (activities.length === 0) return;

    const start = Math.min(...activities.map(activity => activity.start));
    const end = Math.max(...activities.map(activity => activity.end));
    window.editingTimeEntryId = null;
    window.editingTimeEntryGroupIds = null;
    openTimeEntryModal(start, end, '', null, null, true, activities);
}

function updateUnloggedWorkReviewOverflow() {
    const panel = document?.getElementById?.('unlogged-work-review');
    const container = document?.getElementById?.('unlogged-work-review-list');
    if (!panel || !container?.classList) return;

    const scrollHeight = Number(container.scrollHeight) || 0;
    const clientHeight = Number(container.clientHeight) || 0;
    const scrollTop = Number(container.scrollTop) || 0;
    const hasOverflow = scrollHeight > clientHeight + 1;
    const hasMoreBelow = hasOverflow && scrollTop + clientHeight < scrollHeight - 1;

    panel.classList.toggle('unlogged-work-review--scrollable', hasOverflow);
    panel.classList.toggle('unlogged-work-review--has-more', hasMoreBelow);
}

function bindUnloggedWorkReviewOverflow() {
    const container = document?.getElementById?.('unlogged-work-review-list');
    if (!container || container.__orielUnloggedWorkOverflowBound) return;

    container.addEventListener?.('scroll', updateUnloggedWorkReviewOverflow, { passive: true });
    container.__orielUnloggedWorkOverflowBound = true;
}

function renderUnloggedRecordedWorkReview() {
    const container = document?.getElementById?.('unlogged-work-review-list');
    const totalEl = document?.getElementById?.('unlogged-work-review-total');
    if (!container) return;

    const review = getCurrentActionableUnloggedActivityReview();
    const groups = review.groups;
    const hiddenFragmentCount = review.hiddenFragmentCount;
    state.unloggedActivityGroups = groups;
    state.hiddenUnloggedActivityFragmentCount = hiddenFragmentCount;
    const totalMs = groups.reduce((total, group) => total + group.durationMs, 0);
    if (totalEl) totalEl.innerText = formatCompactDurationLabel(totalMs);
    bindUnloggedWorkReviewOverflow();

    if (groups.length === 0) {
        container.innerHTML = `
            <div class="empty-state empty-state--compact">
                ${hiddenFragmentCount > 0
                    ? `${hiddenFragmentCount} short ${hiddenFragmentCount === 1 ? 'fragment' : 'fragments'} hidden.`
                    : 'All recorded source work is covered.'}
            </div>
        `;
        updateUnloggedWorkReviewOverflow();
        return;
    }

    const hiddenSummaryHtml = hiddenFragmentCount > 0
        ? `<div class="unlogged-work-hidden-summary">${hiddenFragmentCount} short ${hiddenFragmentCount === 1 ? 'fragment' : 'fragments'} hidden</div>`
        : '';

    container.innerHTML = groups.map(group => `
        <div class="unlogged-work-row" data-unlogged-group-id="${escapeAttribute(group.id)}">
            <div class="min-w-0">
                <div class="unlogged-work-title truncate">${escapeTimelineText(group.title)}</div>
                <div class="unlogged-work-meta truncate">${escapeTimelineText(group.app)} · ${group.fragments.length} ${group.fragments.length === 1 ? 'fragment' : 'fragments'}</div>
            </div>
            <div class="unlogged-work-actions">
                <span class="duration-pill">${formatCompactDurationLabel(group.durationMs)}</span>
                <button type="button" class="button-secondary unlogged-work-log-button" data-unlogged-log-group-id="${escapeAttribute(group.id)}">
                    Log
                </button>
            </div>
        </div>
    `).join('') + hiddenSummaryHtml;

    container.querySelectorAll?.('[data-unlogged-log-group-id]')?.forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            draftUnloggedRecordedWorkGroup(button.dataset.unloggedLogGroupId);
        });
    });
    updateUnloggedWorkReviewOverflow();
}

// Merges raw activities into a grid structure and renders Activity Stream blocks
function buildActivityCellBlocksHTML(cellActivities, rowLayout) {
    let html = '';
    let currentBlock = null;

    for (let i = 0; i < cellActivities.length; i++) {
        const cellAct = cellActivities[i];

        if (cellAct) {
            if (hasContinuousMatchingActivityAcrossBoundary(currentBlock, cellAct)) {
                currentBlock.span++;
                if (cellAct.overlaps) {
                    currentBlock.overlaps = currentBlock.overlaps.concat(cellAct.overlaps);
                }
            } else {
                if (currentBlock) {
                    html += createActivityBlockHTML(currentBlock, rowLayout);
                }
                currentBlock = {
                    startCell: i,
                    span: 1,
                    app: cellAct.app,
                    title: cellAct.title,
                    url: cellAct.url,
                    appPath: cellAct.appPath || '',
                    bundleId: cellAct.bundleId || '',
                    summaryKey: cellAct.summaryKey,
                    overlaps: cellAct.overlaps ? [...cellAct.overlaps] : []
                };
            }
        } else if (currentBlock) {
            html += createActivityBlockHTML(currentBlock, rowLayout);
            currentBlock = null;
        }
    }

    if (currentBlock) {
        html += createActivityBlockHTML(currentBlock, rowLayout);
    }

    return html;
}

function renderMemoryAidActivities() {
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    const model = getDayTimelineRenderModel({
        dateStartOfDay,
        zoom: state.zoom
    });
    const html = model.useActivitySessions
        ? model.activitySessions.map(session => createActivityBlockHTML(session, model.rowLayout)).join('')
        : buildActivityCellBlocksHTML(model.activityCells, model.rowLayout);

    const itemsMem = DOM.elItemsMemoryAid;
    if (itemsMem) {
        itemsMem.innerHTML = html;
        attachMemoryAidInteractions();
        bindActivityMixTooltipInteractions(itemsMem);
    }
}

function getActivityIdentityKey(activity) {
    return `${activity.app || ''}|||${activity.title || ''}|||${activity.url || ''}|||${activity.appPath || ''}|||${activity.bundleId || ''}`;
}

function normalizeActivityText(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (text === 'null' || text === 'undefined') return '';
    return text;
}

function escapeAttribute(value) {
    return normalizeActivityText(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getActivityDisplayTitle(activity) {
    return cleanTitle(activity.title || '', activity).trim();
}

function getMeaningfulActivityDisplayTitle(activity) {
    const title = getActivityDisplayTitle(activity);
    return title && !isWeakPopupActivityTitle(title, activity) ? title : '';
}

function getTimelineBlockFallbackDisplayActivity(primaryActivity, popupDisplayModel) {
    const primaryTitle = getMeaningfulActivityDisplayTitle(primaryActivity);
    if (primaryTitle) return primaryActivity;

    const visibleRows = (popupDisplayModel?.visibleRows || [])
        .filter(row => Number(row?.duration) >= POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS);
    for (const row of visibleRows) {
        const labels = getPopupActivityDisplayLabels(row);
        const rowTitle = normalizeActivityText(labels?.primary).trim();
        if (rowTitle && !isWeakPopupActivityTitle(rowTitle, row)) return row;

        const children = Array.isArray(row?.children) ? row.children : [];
        for (const child of children) {
            const childDuration = Number(child?.duration);
            if (!Number.isFinite(childDuration) || childDuration < POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS) continue;

            const childLabels = getPopupActivityDisplayLabels(child);
            const childTitle = normalizeActivityText(childLabels?.primary).trim();
            if (childTitle && !isWeakPopupActivityTitle(childTitle, child)) return child;
        }
    }

    return primaryActivity;
}

function escapeTimelineText(value) {
    return normalizeActivityText(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getActivityUrlHostname(url) {
    const value = normalizeActivityText(url).trim();
    if (!value) return '';

    const normalizeHostname = (hostname) => normalizeActivityText(hostname)
        .trim()
        .toLowerCase()
        .replace(/^www\./, '');

    const parseHostname = (candidate) => {
        try {
            return normalizeHostname(new URL(candidate).hostname);
        } catch {
            return '';
        }
    };

    const parsedHost = parseHostname(value)
        || (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? parseHostname(`https://${value}`) : '');
    if (parsedHost) return parsedHost;

    const fallbackHost = value
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
        .split(/[/?#]/)[0];
    return normalizeHostname(fallbackHost || value);
}

function getActivityDurationTotalMs(overlaps) {
    return (Array.isArray(overlaps) ? overlaps : []).reduce((total, overlap) => {
        const duration = Number(overlap?.duration);
        return Number.isFinite(duration) && duration > 0 ? total + duration : total;
    }, 0);
}

function getBreakdownDisplayDurationMs(displayOverlaps, fallbackOverlaps) {
    const displayTotal = getActivityDurationTotalMs(displayOverlaps);
    if (displayTotal > 0) return displayTotal;
    return getActivityDurationTotalMs(fallbackOverlaps);
}

function formatActivityDurationLabel(totalMs, minimumSeconds = 0) {
    if (totalMs >= 60000) {
        return `${Math.round(totalMs / 60000)} min`;
    }

    return `${Math.max(minimumSeconds, Math.round(totalMs / 1000))}s`;
}

function formatPositiveActivityDurationLabel(totalMs) {
    const duration = Math.max(0, Number(totalMs) || 0);
    return formatActivityDurationLabel(duration, duration > 0 ? 1 : 0);
}

function formatCompactDurationLabel(totalMs, minimumSeconds = 0) {
    const ms = Math.max(0, Number(totalMs) || 0);
    if (ms >= 60000) {
        const minutes = Math.round(ms / 60000);
        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
        }
        return `${minutes}m`;
    }

    return `${Math.max(minimumSeconds, Math.round(ms / 1000))}s`;
}

function getActivitySummaryHostname(activity) {
    const host = getActivityUrlHostname(normalizeActivityText(activity?.url));
    if (host) return host;

    const sources = Array.isArray(activity?.sources) ? activity.sources : [];
    for (const source of sources) {
        const sourceHost = getActivityUrlHostname(normalizeActivityText(source?.url));
        if (sourceHost) return sourceHost;
    }

    return '';
}

function isWeakPopupActivityTitle(title, activity) {
    const label = normalizeActivityText(title).trim();
    if (!label) return true;

    const normalizedTitle = label.toLowerCase();
    const normalizedApp = normalizeActivityText(activity?.app).trim().toLowerCase();
    if (normalizedApp && normalizedTitle === normalizedApp) return true;
    if (normalizedTitle.startsWith('http://') || normalizedTitle.startsWith('https://')) return true;

    const host = getActivityUrlHostname(normalizeActivityText(activity?.url));
    if (!host) return false;

    const comparableTitle = normalizedTitle.replace(/^www\./, '');
    const comparableHost = host.replace(/^www\./, '');
    return comparableTitle === comparableHost
        || comparableTitle.startsWith(`${comparableHost}/`)
        || comparableTitle.startsWith(`${comparableHost}?`)
        || comparableTitle.startsWith(`${comparableHost}#`)
        || comparableTitle.startsWith(`${comparableHost} `);
}

function getDominantPopupActivitySource(activity) {
    const sources = Array.isArray(activity?.sources) ? activity.sources : [];
    const candidates = sources.length > 0 ? sources : [activity].filter(Boolean);
    let bestSource = null;
    let bestDuration = -1;

    for (const candidate of candidates) {
        const candidateTitle = getActivityDisplayTitle(candidate);
        if (isWeakPopupActivityTitle(candidateTitle, candidate)) continue;

        const duration = getActivitySourceDuration(candidate);
        if (!bestSource || duration > bestDuration) {
            bestSource = {
                source: candidate,
                title: candidateTitle
            };
            bestDuration = duration;
        }
    }

    return bestSource;
}

function getHttpActivityUrl(value) {
    const url = normalizeActivityText(value).trim();
    if (!url) return '';

    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol.toLowerCase()) ? url : '';
    } catch {
        return '';
    }
}

function getPopupActivityExternalUrl(activity, preferredSource) {
    const preferredUrl = getHttpActivityUrl(preferredSource?.url);
    if (preferredUrl) return preferredUrl;

    const sources = Array.isArray(activity?.sources) ? activity.sources : [];
    const candidates = sources.length > 0 ? sources : [activity].filter(Boolean);
    let bestUrl = '';
    let bestDuration = -1;

    for (const candidate of candidates) {
        const candidateUrl = getHttpActivityUrl(candidate?.url);
        if (!candidateUrl) continue;

        const duration = getActivitySourceDuration(candidate);
        if (!bestUrl || duration > bestDuration) {
            bestUrl = candidateUrl;
            bestDuration = duration;
        }
    }

    return bestUrl;
}

function getPopupActivityDisplayLabels(activity) {
    if (activity?.popupContextSummary) {
        const host = getActivitySummaryHostname(activity);
        const app = normalizeActivityText(activity?.app).trim();
        const primary = getActivityDisplayTitle(activity) || host || app || 'Recorded Activity';
        const secondary = app && primary.trim().toLowerCase() !== app.toLowerCase() ? app : '';

        return {
            primary,
            secondary,
            externalUrl: getHttpActivityUrl(activity?.url)
        };
    }

    const sources = Array.isArray(activity?.sources) ? activity.sources : [];
    const dominantSource = getDominantPopupActivitySource(activity);
    const bestTitle = dominantSource?.title || '';

    const host = getActivitySummaryHostname(activity);
    const app = normalizeActivityText(activity?.app || sources.find(source => source?.app)?.app).trim();
    const primary = bestTitle || host || app;
    let secondary = app;
    if (primary && secondary && primary.trim().toLowerCase() === secondary.trim().toLowerCase()) {
        secondary = '';
    }

    return {
        primary,
        secondary,
        externalUrl: getPopupActivityExternalUrl(activity, dominantSource?.source)
    };
}

function getActivitySummaryKey(activity) {
    const app = String(activity.app || '').trim().toLowerCase();
    const title = getActivityDisplayTitle(activity).toLowerCase();
    const host = getActivityUrlHostname(activity.url);
    const nativeIdentity = String(activity.bundleId || activity.appPath || '').trim().toLowerCase();
    return `${app}|||${title}|||${host || nativeIdentity}`;
}

function getActivitySimilarityKey(activity) {
    const app = normalizeActivityText(activity.app).trim().toLowerCase();
    const host = getActivityUrlHostname(normalizeActivityText(activity.url));
    return host ? `${app}|||${host}` : app;
}

function normalizeActivityExactUrl(value) {
    const url = normalizeActivityText(value).trim();
    if (!url) return '';

    const parseUrl = (candidate) => {
        try {
            const parsed = new URL(candidate);
            if (!['http:', 'https:'].includes(parsed.protocol.toLowerCase())) return '';
            const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
            const pathname = parsed.pathname || '/';
            return `${parsed.protocol.toLowerCase()}//${hostname}${pathname}${parsed.search}`;
        } catch {
            return '';
        }
    };

    return parseUrl(url)
        || (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? parseUrl(`https://${url}`) : '');
}

const BROWSER_ACTIVITY_APP_NAMES = [
    'brave browser',
    'brave browser beta',
    'brave browser nightly',
    'brave',
    'google chrome',
    'google chrome beta',
    'google chrome dev',
    'chrome canary',
    'chrome',
    'chromium',
    'webkit',
    'safari technology preview',
    'safari',
    'arc',
    'microsoft edge',
    'microsoft edge beta',
    'microsoft edge dev',
    'microsoft edge canary',
    'edge',
    'firefox developer edition',
    'firefox nightly',
    'firefox',
    'opera gx',
    'opera',
    'vivaldi',
    'vivaldi snapshot',
    'orion',
    'dia',
    'dia browser',
    'zen',
    'zen browser',
    'floorp',
    'librewolf',
    'waterfox',
    'tor browser',
    'duckduckgo',
    'mullvad browser'
];

const BROWSER_ACTIVITY_BUNDLE_FRAGMENTS = [
    'com.brave.browser',
    'com.brave.browser.beta',
    'com.brave.browser.nightly',
    'com.google.chrome',
    'com.google.chrome.beta',
    'com.google.chrome.dev',
    'com.google.chrome.canary',
    'com.apple.safari',
    'com.apple.safaritechnologypreview',
    'org.webkit.webkit',
    'company.thebrowser.browser',
    'company.thebrowser.dia',
    'com.microsoft.edgemac',
    'com.microsoft.edgemac.beta',
    'com.microsoft.edgemac.dev',
    'com.microsoft.edgemac.canary',
    'com.microsoft.edge',
    'org.mozilla.firefox',
    'org.mozilla.firefoxdeveloperedition',
    'org.mozilla.nightly',
    'com.operasoftware.opera',
    'com.operasoftware.operagx',
    'com.vivaldi.vivaldi',
    'com.vivaldi.vivaldi.snapshot',
    'com.kagi.kagimacos',
    'app.zen-browser.zen',
    'one.ablaze.floorp',
    'io.gitlab.librewolf-community',
    'net.waterfox.waterfox',
    'org.torproject.torbrowser',
    'com.duckduckgo.macos.browser',
    'net.mullvad.mullvadbrowser'
];

function normalizeBrowserIdentityText(value) {
    return normalizeActivityText(value)
        .toLowerCase()
        .replace(/\.app\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function browserNameMatches(value) {
    const normalized = normalizeBrowserIdentityText(value);
    if (!normalized) return false;

    return BROWSER_ACTIVITY_APP_NAMES.some(name => {
        const escaped = escapeRegExp(name);
        return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalized);
    });
}

function browserBundleMatches(value) {
    const normalized = normalizeActivityText(value).trim().toLowerCase();
    if (!normalized) return false;

    return BROWSER_ACTIVITY_BUNDLE_FRAGMENTS.some(fragment => normalized.includes(fragment));
}

function isBrowserLikeActivity(activity) {
    if (normalizeActivityExactUrl(activity?.url)) return true;

    return browserNameMatches(activity?.app)
        || browserNameMatches(activity?.appPath)
        || browserBundleMatches(activity?.bundleId);
}

function getSimilarModeAvailability(activity) {
    const canUseUrlModes = isBrowserLikeActivity(activity) && Boolean(normalizeActivityExactUrl(activity?.url));
    return {
        host: canUseUrlModes,
        url: canUseUrlModes,
        app: true,
        'app-title': true,
        defaultMode: canUseUrlModes ? 'host' : 'app'
    };
}

function setSimilarOptionAvailability(radio, enabled) {
    if (!radio) return;

    radio.disabled = !enabled;
    const option = radio.closest?.('.similar-option');
    option?.classList?.toggle?.('is-disabled', !enabled);
    if (enabled) {
        option?.removeAttribute?.('aria-disabled');
    } else {
        option?.setAttribute?.('aria-disabled', 'true');
    }
}

function updateSimilarModeAvailability(activity) {
    const availability = getSimilarModeAvailability(activity);
    const radios = {
        host: DOM.elSimilarModeHost,
        url: DOM.elSimilarModeUrl,
        app: DOM.elSimilarModeApp,
        'app-title': DOM.elSimilarModeAppTitle
    };

    Object.entries(radios).forEach(([mode, radio]) => {
        setSimilarOptionAvailability(radio, Boolean(availability[mode]));
    });

    const preferredMode = availability.defaultMode;
    const nextMode = availability[preferredMode]
        ? preferredMode
        : Object.keys(radios).find(mode => availability[mode]);
    Object.entries(radios).forEach(([mode, radio]) => {
        if (radio) radio.checked = mode === nextMode;
    });

    return availability;
}

function normalizeSimilarActivityMatchMode(mode) {
    return ['host', 'url', 'app', 'app-title'].includes(mode) ? mode : 'host';
}

function getActivitySimilarityKeyForMode(activity, mode = 'host') {
    const normalizedMode = normalizeSimilarActivityMatchMode(mode);
    const app = normalizeActivityText(activity?.app).trim().toLowerCase();
    if (!app) return '';

    if (normalizedMode === 'app') return app;

    if (normalizedMode === 'app-title') {
        const title = getActivityDisplayTitle(activity).trim().toLowerCase();
        return title ? `${app}|||${title}` : app;
    }

    if (normalizedMode === 'url') {
        const exactUrl = normalizeActivityExactUrl(activity?.url);
        return exactUrl ? `${app}|||${exactUrl}` : '';
    }

    const host = getActivityUrlHostname(normalizeActivityText(activity?.url));
    return host ? `${app}|||${host}` : '';
}

function getActivityAssignmentKeys(activity) {
    const keys = [];
    const addKey = key => {
        if (key && !keys.includes(key)) keys.push(key);
    };

    if (Array.isArray(activity?.sources) && activity.sources.length > 0) {
        activity.sources.forEach(source => {
            addKey(getActivitySourceKey(source));
            addKey(getActivitySummaryKey(source));
        });
    }

    addKey(getActivitySourceKey(activity));
    addKey(getActivitySummaryKey(activity));
    return keys;
}

function getActivitySelectionIdentityKeys(activity) {
    return Array.from(new Set([
        ...getActivityAssignmentKeys(activity),
        getActivitySimilarityKey(activity),
        getActivitySummaryKey(activity),
        getActivitySimilarityKeyForMode(activity, 'url'),
        getActivitySimilarityKeyForMode(activity, 'app-title'),
        getActivitySimilarityKeyForMode(activity, 'app')
    ].filter(Boolean)));
}

function getActivitySimilarityEntryForMode(activity, mode = 'host') {
    const matchKey = getActivitySimilarityKeyForMode(activity, mode);
    const assignmentKeys = getActivityAssignmentKeys(activity);
    if (!matchKey || assignmentKeys.length === 0) return null;

    return {
        matchKey,
        assignmentKeys,
        identityKeys: getActivitySelectionIdentityKeys(activity),
        activity
    };
}

function getActivityBlockData(blockEl) {
    return {
        app: blockEl.dataset.app || '',
        title: blockEl.dataset.title || '',
        url: blockEl.dataset.url || '',
        appPath: blockEl.dataset.appPath || '',
        bundleId: blockEl.dataset.bundleId || ''
    };
}

function getActivityBlockCandidateSimilarityActivities(blockEl, options = {}) {
    const includeBreakdown = options?.includeBreakdown !== false;
    const activities = [];
    const seen = new Set();
    const addActivity = activity => {
        const identityKey = getActivitySummaryKey(activity) || getActivitySimilarityKey(activity);
        if (!identityKey) return;
        const key = `${identityKey}|||${activity?.start || ''}|||${activity?.end || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        activities.push(activity);
    };

    const displayModel = buildActivityBlockPopupDisplayModel(blockEl);
    const primaryRow = displayModel?.primaryRow || getActivityBlockData(blockEl);
    const visibleRows = includeBreakdown && Array.isArray(displayModel?.visibleRows)
        ? displayModel.visibleRows
        : [primaryRow];

    visibleRows.forEach(row => {
        addActivity(row);
        if (includeBreakdown && Array.isArray(row?.children)) {
            row.children.forEach(child => {
                if (Number(child?.duration) >= POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS) {
                    addActivity(child);
                }
            });
        }
    });

    const primaryActivity = getActivityBlockData(blockEl);
    if (!activities.some(activity => getActivitySummaryKey(activity) === getActivitySummaryKey(primaryActivity))) {
        addActivity(primaryActivity);
    }

    return activities;
}

function getActivityBlockSimilarityEntriesForMode(blockEl, mode = 'host', options = {}) {
    const entries = [];
    const seen = new Set();
    getActivityBlockCandidateSimilarityActivities(blockEl, options).forEach(activity => {
        const entry = getActivitySimilarityEntryForMode(activity, mode);
        if (!entry) return;
        const key = `${entry.matchKey}|||${entry.assignmentKeys.join('|||')}`;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push(entry);
    });
    return entries;
}

function activityMatchesSelectedSimilarityKeys(activity, selectedKeys) {
    if (!selectedKeys || selectedKeys.size === 0) return false;
    return getActivitySelectionIdentityKeys(activity).some(key => selectedKeys.has(key));
}

function getActivityBlockSeedSimilarityEntriesForMode(blockEl, mode = 'host') {
    const storedKeys = new Set(getActivityBlockSelectedSimilarityKeys(blockEl));
    const seedActivities = storedKeys.size > 0
        ? getActivityBlockCandidateSimilarityActivities(blockEl)
            .filter(activity => activityMatchesSelectedSimilarityKeys(activity, storedKeys))
        : [getActivityBlockData(blockEl)];

    const entries = [];
    const seen = new Set();
    seedActivities.forEach(activity => {
        const entry = getActivitySimilarityEntryForMode(activity, mode);
        if (!entry) return;
        const key = `${entry.matchKey}|||${entry.assignmentKeys.join('|||')}`;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push(entry);
    });
    return entries;
}

function getActivityBlockSimilarModeActivity(blockEl) {
    const primaryActivity = getActivityBlockData(blockEl);
    const storedKeys = new Set(getActivityBlockSelectedSimilarityKeys(blockEl));
    if (storedKeys.size === 0) return primaryActivity;

    return getActivityBlockCandidateSimilarityActivities(blockEl)
        .find(activity => activityMatchesSelectedSimilarityKeys(activity, storedKeys))
        || primaryActivity;
}

function getActivityBlockTimeRange(blockEl) {
    const exactStart = Number(blockEl?.dataset?.startMs);
    const exactEnd = Number(blockEl?.dataset?.endMs);
    if (Number.isFinite(exactStart) && Number.isFinite(exactEnd) && exactEnd > exactStart) {
        return { start: exactStart, end: exactEnd };
    }

    const startCell = parseInt(blockEl?.dataset?.startCell, 10);
    const span = parseInt(blockEl?.dataset?.span, 10);
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    const start = dateStartOfDay + (Number.isFinite(startCell) ? startCell : 0) * state.zoom * 60 * 1000;
    const end = start + Math.max(1, Number.isFinite(span) ? span : 1) * state.zoom * 60 * 1000;
    return { start, end };
}

function getActivitySourceKey(activity) {
    if (Number.isFinite(activity.start) && Number.isFinite(activity.end)) {
        return `${getActivityIdentityKey(activity)}|||${activity.start}|||${activity.end}`;
    }

    return null;
}

function getActivitySourceDuration(activity, rangeStart, rangeEnd) {
    const assignedDuration = Number(activity?.assignedDurationMs);
    if (Number.isFinite(assignedDuration) && assignedDuration > 0) {
        return assignedDuration;
    }

    if (Array.isArray(activity?.sources) && Number.isFinite(activity.duration) && activity.duration > 0) {
        return activity.duration;
    }

    if (Number.isFinite(activity.start) && Number.isFinite(activity.end) && activity.end > activity.start) {
        const start = Number.isFinite(rangeStart) ? Math.max(activity.start, rangeStart) : activity.start;
        const end = Number.isFinite(rangeEnd) ? Math.min(activity.end, rangeEnd) : activity.end;
        return Math.max(0, end - start);
    }

    return Number.isFinite(activity.duration) ? activity.duration : 0;
}

function getRenderedTimeEntryDurationMs(entry) {
    const renderDuration = Number(entry?.renderDurationMs);
    if (Number.isFinite(renderDuration) && renderDuration >= 0) {
        return renderDuration;
    }

    if (entry?.createdBy === 'manual') {
        return Math.max(0, (entry?.end || 0) - (entry?.start || 0));
    }

    if (typeof getTimeEntryDurationMs === 'function') {
        return getTimeEntryDurationMs(entry);
    }

    const assignedDuration = Array.isArray(entry?.activities)
        ? entry.activities.reduce((total, activity) => {
            const duration = Number(activity?.assignedDurationMs);
            return total + (Number.isFinite(duration) && duration > 0 ? duration : 0);
        }, 0)
        : 0;
    return assignedDuration > 0
        ? assignedDuration
        : Math.max(0, (entry?.end || 0) - (entry?.start || 0));
}

function timeEntryHasCreatedBy(entry) {
    return entry && Object.prototype.hasOwnProperty.call(entry, 'createdBy');
}

function isTimelineHiddenAutoAssignedTimeEntry(entry) {
    if (typeof isHiddenAutoAssignedTimeEntry === 'function') {
        return isHiddenAutoAssignedTimeEntry(entry);
    }
    return false;
}

function isAutoRuleExactTimeEntry(entry) {
    if (entry?.createdBy === 'auto-rule') return true;
    if (timeEntryHasCreatedBy(entry)) return false;
    return getActivityStreamAssignmentActivities(entry).some(isAutoAssignedActivityStreamAssignment);
}

function getActivityStreamAssignmentActivities(entry) {
    return Array.isArray(entry?.activities)
        ? entry.activities.filter(activity => activity?.assignmentSource === 'activity-stream')
        : [];
}

function getActivityStreamAssignmentGroupKey(entry) {
    if (entry?.renderManualSavedRange) return null;

    const assignmentActivities = getActivityStreamAssignmentActivities(entry);
    if (assignmentActivities.length === 0) return null;

    const projectId = normalizeActivityText(entry.projectId);
    const taskId = normalizeActivityText(entry.taskId);
    const displayGroupKey = normalizeActivityText(assignmentActivities[0]?.assignmentDisplayGroupKey).trim();
    if (displayGroupKey) {
        return `${projectId}|||${taskId}|||display|||${displayGroupKey}`;
    }

    const app = normalizeActivityText(assignmentActivities[0].app).trim().toLowerCase();
    return `${projectId}|||${taskId}|||${app}`;
}

function getAutoRuleAssignmentGroupKey(entry) {
    const assignmentKey = getActivityStreamAssignmentGroupKey(entry);
    if (!assignmentKey) return null;

    const assignmentActivities = getActivityStreamAssignmentActivities(entry);
    const ruleId = normalizeActivityText(entry?.autoRuleId || assignmentActivities[0]?.autoAssignmentRuleId)
        .trim()
        .toLowerCase();
    return `${assignmentKey}|||auto-rule|||${ruleId}`;
}

function getDisplayedMinuteDurationMs(durationMs) {
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return Math.max(1, Math.round(duration / (60 * 1000))) * 60 * 1000;
}

function getActivityStreamAssignedDurationMs(entries) {
    const seenRepairKeys = new Set();
    const sourceBackedRepairDurations = new Map();
    let total = 0;

    (Array.isArray(entries) ? entries : []).forEach(entry => {
        const renderRepairKey = entry?.renderDisplayRepairKey;
        const renderDuration = Number(entry?.renderDurationMs);
        if (renderRepairKey && Number.isFinite(renderDuration) && renderDuration >= 0) {
            if (entry?.renderSourceBackedAssignment === true) {
                const displayDuration = getDisplayedMinuteDurationMs(renderDuration);
                sourceBackedRepairDurations.set(
                    renderRepairKey,
                    Math.max(sourceBackedRepairDurations.get(renderRepairKey) || 0, displayDuration)
                );
                return;
            }
            if (seenRepairKeys.has(renderRepairKey)) return;
            seenRepairKeys.add(renderRepairKey);
            total += renderDuration;
            return;
        }

        const assignmentActivities = getActivityStreamAssignmentActivities(entry);
        total += assignmentActivities.reduce((activityTotal, activity) => {
            if (activity.assignmentDisplayRepairKey) {
                if (seenRepairKeys.has(activity.assignmentDisplayRepairKey)) return activityTotal;
                seenRepairKeys.add(activity.assignmentDisplayRepairKey);
            }
            return activityTotal + getActivitySourceDuration(activity);
        }, 0);
    });

    return total + Array.from(sourceBackedRepairDurations.values())
        .reduce((sourceTotal, duration) => sourceTotal + duration, 0);
}

function isActivityStreamSummaryAssignment(activity) {
    return activity?.assignmentSource === 'activity-stream'
        && activity.assignmentModel === ACTIVITY_STREAM_SUMMARY_ASSIGNMENT_MODEL;
}

function isAutoAssignedActivityStreamAssignment(activity) {
    return activity?.assignmentSource === 'activity-stream'
        && activity.assignmentModel !== ACTIVITY_STREAM_SUMMARY_ASSIGNMENT_MODEL
        && (activity.autoAssigned === true
            || activity.assignmentModel === ACTIVITY_STREAM_AUTO_ASSIGNMENT_MODEL);
}

function getTimelineDisplayRowRange(start, end, dateStartOfDay, zoom) {
    const rowDurationMs = Math.max(1, Number(zoom) || 1) * 60 * 1000;
    const rawStart = Number(start);
    const rawEnd = Number(end);
    const normalizedStart = Number.isFinite(rawStart) ? rawStart : dateStartOfDay;
    const normalizedEnd = Number.isFinite(rawEnd) && rawEnd > normalizedStart
        ? rawEnd
        : normalizedStart + rowDurationMs;
    const startRow = Math.max(0, Math.floor((normalizedStart - dateStartOfDay) / rowDurationMs));
    const endRow = Math.max(startRow + 1, Math.ceil((normalizedEnd - dateStartOfDay) / rowDurationMs));

    return {
        start: dateStartOfDay + startRow * rowDurationMs,
        end: dateStartOfDay + endRow * rowDurationMs,
        startRow,
        endRow,
        rowSpan: endRow - startRow
    };
}

function getRenderEntryDisplayRowRange(entry, dateStartOfDay, zoom) {
    const displayStart = Number(entry?.renderDisplayStart);
    const displayEnd = Number(entry?.renderDisplayEnd);
    if (Number.isFinite(displayStart) && Number.isFinite(displayEnd) && displayEnd > displayStart) {
        const rowDurationMs = Math.max(1, Number(zoom) || 1) * 60 * 1000;
        const startRow = Math.max(0, Math.floor((displayStart - dateStartOfDay) / rowDurationMs));
        const endRow = Math.max(startRow + 1, Math.ceil((displayEnd - dateStartOfDay) / rowDurationMs));
        if (entry?.renderExactGeometry === true) {
            return {
                start: displayStart,
                end: displayEnd,
                startRow,
                endRow,
                rowSpan: endRow - startRow
            };
        }
        return {
            start: dateStartOfDay + startRow * rowDurationMs,
            end: dateStartOfDay + endRow * rowDurationMs,
            startRow,
            endRow,
            rowSpan: endRow - startRow
        };
    }

    return getTimelineDisplayRowRange(entry.start, entry.end, dateStartOfDay, zoom);
}

function isResolvedActivityStreamAssignmentRun(activity) {
    const start = Number(activity?.start);
    const end = Number(activity?.end);
    const assignmentStart = Number(activity?.assignmentStart);
    const assignmentEnd = Number(activity?.assignmentEnd);
    const assignedDuration = Number(activity?.assignedDurationMs);

    return activity?.assignmentSource === 'activity-stream'
        && Number.isFinite(start)
        && Number.isFinite(end)
        && Number.isFinite(assignmentStart)
        && Number.isFinite(assignmentEnd)
        && Number.isFinite(assignedDuration)
        && assignedDuration > 0
        && end > start
        && assignmentEnd > assignmentStart
        && start === assignmentStart
        && end === assignmentEnd;
}

function activityStreamBlockMatchesAssignment(block, activity, summaryKey) {
    if (block?.summaryKey === summaryKey) return true;

    const activitySimilarityKey = getActivitySimilarityKey(activity);
    return Boolean(activitySimilarityKey)
        && getActivitySimilarityKey(block) === activitySimilarityKey;
}

function activityMatchesAssignmentIdentity(candidate, activity, summaryKey) {
    if (summaryKey && getActivitySummaryKey(candidate) === summaryKey) return true;

    const activitySimilarityKey = getActivitySimilarityKey(activity);
    return Boolean(activitySimilarityKey)
        && getActivitySimilarityKey(candidate) === activitySimilarityKey;
}

function getNativeActivityIdentity(activity) {
    return normalizeActivityText(activity?.bundleId || activity?.appPath)
        .trim()
        .toLowerCase();
}

function getDominantNonWeakNativeAssignmentSummary(summaries, activity) {
    if (!isWeakNativeActivity(activity)) return null;

    const activitySimilarityKey = getActivitySimilarityKey(activity);
    const activityNativeIdentity = getNativeActivityIdentity(activity);
    let dominant = null;

    for (const summary of summaries || []) {
        if (!activitySimilarityKey || getActivitySimilarityKey(summary) !== activitySimilarityKey) continue;

        const summaryNativeIdentity = getNativeActivityIdentity(summary);
        if (activityNativeIdentity && summaryNativeIdentity && activityNativeIdentity !== summaryNativeIdentity) continue;
        if (isWeakPopupActivityTitle(getActivityDisplayTitle(summary), summary)) continue;

        if (!dominant || Number(summary.duration || 0) > Number(dominant.duration || 0)) {
            dominant = summary;
        }
    }

    return dominant;
}

function getExactActivitySummaryForAssignment(summaries, summaryKey) {
    if (!summaryKey) return null;
    return (summaries || []).find(summary => getActivitySummaryKey(summary) === summaryKey) || null;
}

function getSameNativeActivitySummaryDuration(summaries, activity) {
    if (!isNativeActivity(activity)) return 0;

    const activitySimilarityKey = getActivitySimilarityKey(activity);
    const activityNativeIdentity = getNativeActivityIdentity(activity);
    return (summaries || []).reduce((total, summary) => {
        if (activitySimilarityKey && getActivitySimilarityKey(summary) !== activitySimilarityKey) return total;

        const summaryNativeIdentity = getNativeActivityIdentity(summary);
        if (activityNativeIdentity && summaryNativeIdentity && activityNativeIdentity !== summaryNativeIdentity) return total;

        const duration = Number(summary?.duration);
        return total + (Number.isFinite(duration) && duration > 0 ? duration : 0);
    }, 0);
}

function applySameNativePopupAssignmentDuration(summary, summaries, activity) {
    if (!summary || !isActivityStreamSummaryAssignment(activity) || !isNativeActivity(activity)) return summary;

    const assignedDuration = Number(activity?.assignedDurationMs);
    const summaryDuration = Number(summary?.duration);
    if (!Number.isFinite(assignedDuration)
        || !Number.isFinite(summaryDuration)
        || assignedDuration <= summaryDuration) {
        return summary;
    }

    const sameNativeDuration = getSameNativeActivitySummaryDuration(summaries, activity);
    if (sameNativeDuration <= summaryDuration) return summary;

    const durationMatchesSavedPopupRow = Math.abs(sameNativeDuration - assignedDuration) <= 1000;
    return durationMatchesSavedPopupRow
        ? { ...summary, duration: sameNativeDuration }
        : summary;
}

function getActivitySummaryForAssignmentWithinRange(activities, activity, summaryKey, rangeStart, rangeEnd) {
    const summaries = summarizeActivityOverlaps(activities, rangeStart, rangeEnd);
    const isStrongNativeAssignment = isNativeActivity(activity) && !isWeakNativeActivity(activity);
    const summary = getDominantNonWeakNativeAssignmentSummary(summaries, activity)
        || (isStrongNativeAssignment ? getExactActivitySummaryForAssignment(summaries, summaryKey) : null)
        || summaries.find(summary => activityMatchesAssignmentIdentity(summary, activity, summaryKey))
        || null;
    return applySameNativePopupAssignmentDuration(summary, summaries, activity);
}

function buildVisibleActivityBlocks({ dateStartOfDay, zoom, ownershipActivities, visibleActivities }) {
    const renderZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const rowDurationMs = renderZoom * 60 * 1000;
    const cellActivities = buildVisibleActivityCells({
        dateStartOfDay,
        zoom: renderZoom,
        ownershipActivities,
        visibleActivities
    });
    const blocks = [];
    let currentBlock = null;

    const pushCurrentBlock = () => {
        if (!currentBlock) return;

        const start = dateStartOfDay + currentBlock.startCell * rowDurationMs;
        blocks.push({
            ...currentBlock,
            start,
            end: start + currentBlock.span * rowDurationMs
        });
    };

    for (let rowIndex = 0; rowIndex < cellActivities.length; rowIndex++) {
        const cell = cellActivities[rowIndex];
        if (hasContinuousMatchingActivityAcrossBoundary(currentBlock, cell)) {
            currentBlock.span++;
            currentBlock.overlaps = currentBlock.overlaps.concat(cell.overlaps || []);
            continue;
        }

        pushCurrentBlock();
        currentBlock = cell
            ? {
                startCell: rowIndex,
                span: 1,
                app: cell.app,
                title: cell.title,
                url: cell.url,
                appPath: cell.appPath || '',
                bundleId: cell.bundleId || '',
                summaryKey: cell.summaryKey,
                overlaps: cell.overlaps ? [...cell.overlaps] : []
            }
            : null;
    }

    pushCurrentBlock();
    return blocks;
}

function buildActivityStreamAssignmentProjectionBlocks({ dateStartOfDay, zoom, ownershipActivities, visibleActivities }) {
    const renderZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    if (shouldRenderExactActivityStreamSessions(renderZoom)) {
        return buildActivityStreamSessions({
            dateStartOfDay,
            activities: ownershipActivities,
            detailActivities: visibleActivities,
            timeEntries: Array.isArray(state.timeEntries) ? state.timeEntries : []
        });
    }

    return buildVisibleActivityBlocks({
        dateStartOfDay,
        zoom: renderZoom,
        ownershipActivities,
        visibleActivities
    });
}

function getActivityStreamVisibleBlocksForSummary(summaryKey, dateStartOfDay, zoom, activity = null) {
    if (!summaryKey) return [];
    const renderZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

    const ownershipActivities = Array.isArray(state.timelineActivities)
        ? state.timelineActivities
        : state.activities;
    const visibleActivities = Array.isArray(state.activities)
        ? state.activities
        : ownershipActivities;
    const cellActivities = buildVisibleActivityCells({
        dateStartOfDay,
        zoom: renderZoom,
        ownershipActivities,
        visibleActivities
    });
    const rowDurationMs = renderZoom * 60 * 1000;
    const blocks = [];
    let currentBlock = null;

    const pushCurrentBlock = () => {
        if (!currentBlock || !activityStreamBlockMatchesAssignment(currentBlock, activity, summaryKey)) return;

        const start = dateStartOfDay + currentBlock.startCell * rowDurationMs;
        const end = start + currentBlock.span * rowDurationMs;
        const summaries = summarizeActivityOverlaps(currentBlock.overlaps, start, end);
        const matchingSummary = summaries.find(summary => getActivitySummaryKey(summary) === summaryKey);
        const duration = matchingSummary?.duration || currentBlock.duration || 0;
        if (duration <= 0) return;

        blocks.push({
            ...currentBlock,
            start,
            end,
            duration
        });
    };

    for (let i = 0; i < cellActivities.length; i++) {
        const cell = cellActivities[i];
        if (hasContinuousMatchingActivityAcrossBoundary(currentBlock, cell)) {
            currentBlock.span++;
            currentBlock.duration += cell.duration || 0;
            currentBlock.overlaps = currentBlock.overlaps.concat(cell.overlaps || []);
            continue;
        }

        pushCurrentBlock();
        currentBlock = cell
            ? {
                startCell: i,
                span: 1,
                app: cell.app,
                title: cell.title,
                url: cell.url,
                appPath: cell.appPath || '',
                bundleId: cell.bundleId || '',
                summaryKey: cell.summaryKey,
                duration: cell.duration || 0,
                overlaps: cell.overlaps ? [...cell.overlaps] : []
            }
            : null;
    }

    pushCurrentBlock();
    return blocks;
}

function buildLegacyActivityStreamDisplayRepairActivities(activity, range, summaryKey, dateStartOfDay, zoom) {
    const blocks = getActivityStreamVisibleBlocksForSummary(summaryKey, dateStartOfDay, zoom, activity)
        .filter(block => block.start < range.end && block.end > range.start);
    if (blocks.length === 0) return [];

    const base = stripActivitySources(activity);
    return blocks.map(block => ({
        ...base,
        app: block.app || base.app,
        title: block.title || base.title,
        url: block.url || base.url,
        appPath: block.appPath || base.appPath || '',
        bundleId: block.bundleId || base.bundleId || '',
        start: block.start,
        end: block.end,
        duration: block.duration,
        assignedDurationMs: block.duration,
        assignmentStart: block.start,
        assignmentEnd: block.end,
        assignmentSource: 'activity-stream',
        assignmentModel: ACTIVITY_STREAM_SUMMARY_ASSIGNMENT_MODEL,
        assignmentDisplayZoom: zoom,
        assignmentDisplayRepairKey: `${summaryKey}|||${block.start}|||${block.end}`
    }));
}

function buildResolvedActivityStreamAssignmentActivity(activity) {
    const assignedDuration = Number(activity.assignedDurationMs);
    return {
        ...activity,
        start: activity.assignmentStart,
        end: activity.assignmentEnd,
        duration: Number.isFinite(assignedDuration) && assignedDuration > 0
            ? assignedDuration
            : getActivitySourceDuration(activity),
        assignedDurationMs: assignedDuration,
        assignmentSource: 'activity-stream'
    };
}

function buildAutoRuleActivityStreamAssignmentRenderEntries(entry, activity, range, dateStartOfDay, zoom) {
    const start = Number(range?.start);
    const end = Number(range?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

    const assignedDuration = getActivitySourceDuration(activity, start, end) || (end - start);
    if (!Number.isFinite(assignedDuration) || assignedDuration <= 0) return [];

    const renderActivity = {
        ...activity,
        start,
        end,
        duration: assignedDuration,
        assignedDurationMs: assignedDuration,
        assignmentStart: start,
        assignmentEnd: end,
        assignmentSource: 'activity-stream',
        assignmentModel: ACTIVITY_STREAM_AUTO_ASSIGNMENT_MODEL,
        activityMix: getActivityMixInRange(activity, start, end)
    };

    return [{
        ...entry,
        start,
        end,
        renderDisplayStart: start,
        renderDisplayEnd: end,
        renderDurationMs: assignedDuration,
        renderExactGeometry: true,
        activities: [renderActivity]
    }];
}

function getAssignmentSourceActivities(activity) {
    return Array.isArray(activity?.sources) && activity.sources.length > 0
        ? activity.sources.filter(source => Number.isFinite(source?.start) && Number.isFinite(source?.end) && source.end > source.start)
        : [];
}

function hasSourceBackedAssignment(activity) {
    return getAssignmentSourceActivities(activity).length > 0;
}

function activityMatchesSimilarityScope(activity, scopeActivity) {
    const mode = normalizeActivityText(scopeActivity?.selectedSimilarityMode).trim();
    const matchKey = normalizeActivityText(scopeActivity?.selectedSimilarityMatchKey).trim();
    if (!mode || !matchKey) return false;
    return getActivitySimilarityKeyForMode(activity, mode) === matchKey;
}

function activityMatchesSourceProjectionIdentity(candidate, source, assignmentActivity) {
    if (!candidate || !source) return false;
    if (activityMatchesSimilarityScope(candidate, assignmentActivity)
        && activityMatchesSimilarityScope(source, assignmentActivity)) {
        return true;
    }

    const sourceSummaryKey = getActivitySummaryKey(source);
    if (sourceSummaryKey && getActivitySummaryKey(candidate) === sourceSummaryKey) return true;

    const sourceSimilarityKey = getActivitySimilarityKey(source);
    return Boolean(sourceSimilarityKey && getActivitySimilarityKey(candidate) === sourceSimilarityKey);
}

function sourceIsVisibleInActivityBlock(source, block, assignmentActivity) {
    const visibleOverlaps = getVisibleMultiActivityBreakdownOverlaps(
        block?.overlaps,
        block?.start,
        block?.end
    );
    return visibleOverlaps.some(overlap => activityMatchesSourceProjectionIdentity(
        overlap,
        source,
        assignmentActivity
    ));
}

function getSourceBackedAssignmentProjectionDuration(activity, block, range) {
    const sources = getAssignmentSourceActivities(activity);
    if (sources.length === 0) return 0;

    const visibleOverlaps = getVisibleMultiActivityBreakdownOverlaps(
        block?.overlaps,
        block?.start,
        block?.end
    );
    const visibleSources = sources.filter(source => sourceIsVisibleInActivityBlock(source, block, activity));

    return visibleSources.reduce((total, source) => {
        const start = Math.max(range.start, block.start);
        const end = Math.min(range.end, block.end);
        return total + getActivitySourceOverlapDuration(source, start, end);
    }, 0);
}

function getSourceBackedAssignmentProjectionKey(activity, summaryKey) {
    const displayGroupKey = normalizeActivityText(activity?.assignmentDisplayGroupKey).trim();
    if (displayGroupKey) return `display|||${displayGroupKey}`;

    const displayRepairKey = normalizeActivityText(activity?.assignmentDisplayRepairKey).trim();
    if (displayRepairKey) return `display|||${displayRepairKey}`;

    const mode = normalizeActivityText(activity?.selectedSimilarityMode).trim();
    const matchKey = normalizeActivityText(activity?.selectedSimilarityMatchKey).trim();
    if (mode && matchKey) return `${mode}|||${matchKey}`;

    return getActivitySimilarityKey(activity) || summaryKey;
}

function getActivitySourceOverlapDuration(source, rangeStart, rangeEnd) {
    const sourceStart = Number(source?.start);
    const sourceEnd = Number(source?.end);
    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) {
        return 0;
    }

    const start = Number.isFinite(rangeStart) ? Math.max(sourceStart, rangeStart) : sourceStart;
    const end = Number.isFinite(rangeEnd) ? Math.min(sourceEnd, rangeEnd) : sourceEnd;
    if (end <= start) return 0;

    const activeDuration = getActivitySourceDuration(source);
    if (!Number.isFinite(activeDuration) || activeDuration <= 0) {
        return end - start;
    }

    if (start <= sourceStart && end >= sourceEnd) {
        return activeDuration;
    }

    const elapsedDuration = sourceEnd - sourceStart;
    return Math.min(activeDuration, activeDuration * ((end - start) / elapsedDuration));
}

function buildActivityStreamSummaryAssignmentDisplayProjections(activity, range, summaryKey, dateStartOfDay, zoom) {
    const renderZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const assignedDuration = getActivitySourceDuration(activity, range.start, range.end);
    if (!Number.isFinite(assignedDuration) || assignedDuration <= 0) {
        return { projections: [], shouldFallback: false };
    }

    const ownershipActivities = Array.isArray(state.timelineActivities)
        ? state.timelineActivities
        : state.activities;
    const visibleActivities = Array.isArray(state.activities)
        ? state.activities
        : ownershipActivities;
    const hasActivityData = (Array.isArray(ownershipActivities) && ownershipActivities.length > 0)
        || (Array.isArray(visibleActivities) && visibleActivities.length > 0);
    const visibleBlocks = buildActivityStreamAssignmentProjectionBlocks({
        dateStartOfDay,
        zoom: renderZoom,
        ownershipActivities,
        visibleActivities
    });
    const projections = [];

    for (const block of visibleBlocks) {
        if (block.end <= range.start || block.start >= range.end) continue;

        const sourceBackedDuration = getSourceBackedAssignmentProjectionDuration(activity, block, range);
        if (sourceBackedDuration > 0) {
            const exactStart = Math.max(range.start, block.start);
            const exactEnd = Math.min(range.end, block.end);
            if (exactEnd <= exactStart) continue;

            projections.push({
                displayStart: block.start,
                displayEnd: block.end,
                exactStart,
                exactEnd,
                durationMs: sourceBackedDuration,
                displayRepairKey: `${getSourceBackedAssignmentProjectionKey(activity, summaryKey)}|||sources|||${block.start}|||${block.end}`,
                sourceBacked: true,
                renderExactGeometry: shouldRenderExactActivityStreamSessions(renderZoom)
            });
            continue;
        }

        if (hasSourceBackedAssignment(activity)) continue;

        const visibleOverlaps = getVisibleMultiActivityBreakdownOverlaps(
            block.overlaps,
            block.start,
            block.end
        );
        const matchingSummary = getActivitySummaryForAssignmentWithinRange(
            visibleOverlaps,
            activity,
            summaryKey,
            block.start,
            block.end
        );
        if (!matchingSummary || matchingSummary.duration <= 0) continue;

        const exactStart = Math.max(range.start, block.start);
        const exactEnd = Math.min(range.end, block.end);
        if (exactEnd <= exactStart) continue;

        projections.push({
            displayStart: block.start,
            displayEnd: block.end,
            exactStart,
            exactEnd,
            durationMs: matchingSummary.duration,
            displayRepairKey: `${summaryKey}|||${block.start}|||${block.end}`
        });
    }

    return {
        projections,
        shouldFallback: !hasActivityData
    };
}

function buildActivityStreamSummaryAssignmentRenderEntries(entry, activity, range, summaryKey, dateStartOfDay, zoom, options = {}) {
    const projectionResult = buildActivityStreamSummaryAssignmentDisplayProjections(
        activity,
        range,
        summaryKey,
        dateStartOfDay,
        zoom
    );
    const projections = projectionResult.projections || [];

    if (projections.length === 0) {
        if (!projectionResult.shouldFallback) return [];

        const assignedDuration = getActivitySourceDuration(activity, range.start, range.end);
        const renderActivity = {
            ...activity,
            start: range.start,
            end: range.end,
            duration: assignedDuration,
            assignedDurationMs: assignedDuration,
            assignmentStart: range.start,
            assignmentEnd: range.end
        };

        return [{
            ...entry,
            start: range.start,
            end: range.end,
            renderDurationMs: assignedDuration,
            renderDisplayRepairKey: `${entry.id || 'entry'}|||fallback|||${range.start}|||${range.end}`,
            activities: [renderActivity]
        }];
    }

    return projections.map(projection => {
        const repairKey = projection.displayRepairKey || (activity.assignmentDisplayRepairKey
            ? `${activity.assignmentDisplayRepairKey}|||${projection.displayStart}|||${projection.displayEnd}`
            : undefined);
        const renderActivity = {
            ...activity,
            start: projection.exactStart,
            end: projection.exactEnd,
            duration: projection.durationMs,
            assignmentStart: projection.exactStart,
            assignmentEnd: projection.exactEnd,
            assignmentDisplayGroupKey: options.rowScopedDisplayGroups && repairKey ? repairKey : ''
        };

        if (repairKey) {
            renderActivity.assignmentDisplayRepairKey = repairKey;
        }

        return {
            ...entry,
            start: projection.exactStart,
            end: projection.exactEnd,
            renderDisplayStart: projection.displayStart,
            renderDisplayEnd: projection.displayEnd,
            renderDurationMs: projection.durationMs,
            renderDisplayRepairKey: repairKey,
            renderSourceBackedAssignment: projection.sourceBacked === true,
            renderExactGeometry: projection.renderExactGeometry === true,
            activities: [renderActivity]
        };
    });
}

function getAssignmentActivityRange(entry, activity) {
    const start = Number.isFinite(activity?.assignmentStart)
        ? activity.assignmentStart
        : (Number.isFinite(activity?.start) ? activity.start : entry.start);
    const end = Number.isFinite(activity?.assignmentEnd)
        ? activity.assignmentEnd
        : (Number.isFinite(activity?.end) ? activity.end : entry.end);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
    }

    return { start, end };
}

function shouldRenderManualSummaryAssignmentFromSavedRange(entry, assignmentActivities) {
    if (entry?.createdBy !== 'manual') return false;
    if (!Array.isArray(assignmentActivities) || assignmentActivities.length === 0) return false;
    if (!assignmentActivities.every(isActivityStreamSummaryAssignment)) return false;
    if (assignmentActivities.some(activity => getActivityStreamAssignmentDisplayBounds(activity))) return false;

    return assignmentActivities.some(activity => {
        const range = getAssignmentActivityRange(entry, activity);
        if (!range) return false;

        const rangeDuration = range.end - range.start;
        const assignedDuration = getActivitySourceDuration(activity, range.start, range.end);
        return Number.isFinite(rangeDuration)
            && Number.isFinite(assignedDuration)
            && rangeDuration - assignedDuration > 1000;
    });
}

function buildActivityStreamRenderEntries(entry, dateStartOfDay, zoom = state.zoom) {
    const renderZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const assignmentActivities = getActivityStreamAssignmentActivities(entry);
    if (assignmentActivities.length === 0) return [entry];
    if (shouldRenderManualSummaryAssignmentFromSavedRange(entry, assignmentActivities)) {
        return [{ ...entry, renderManualSavedRange: true }];
    }

    const renderEntries = [];
    assignmentActivities.forEach(activity => {
        const range = getAssignmentActivityRange(entry, activity);
        if (!range) return;

        const displayBounds = getActivityStreamAssignmentDisplayBounds(activity);
        if (displayBounds && assignmentDisplayBoundsMatchCurrentZoom(activity, renderZoom)) {
            const duration = getActivitySourceDuration(activity, range.start, range.end);
            if (duration <= 0) return;

            const renderActivity = {
                ...activity,
                start: range.start,
                end: range.end,
                duration,
                assignedDurationMs: duration,
                assignmentStart: range.start,
                assignmentEnd: range.end
            };
            renderEntries.push({
                ...entry,
                start: range.start,
                end: range.end,
                renderDisplayStart: displayBounds.start,
                renderDisplayEnd: displayBounds.end,
                renderDurationMs: duration,
                renderSourceBackedAssignment: hasSourceBackedAssignment(activity),
                renderExactGeometry: true,
                activities: [renderActivity]
            });
            return;
        }

        if (isAutoAssignedActivityStreamAssignment(activity)) {
            renderEntries.push(...buildAutoRuleActivityStreamAssignmentRenderEntries(
                entry,
                activity,
                range,
                dateStartOfDay,
                renderZoom
            ));
            return;
        }

        if (!isActivityStreamSummaryAssignment(activity)) {
            const repairedActivities = buildLegacyActivityStreamDisplayRepairActivities(
                activity,
                range,
                getActivitySummaryKey(activity),
                dateStartOfDay,
                renderZoom
            );

            if (repairedActivities.length > 0) {
                repairedActivities.forEach(renderActivity => {
                    renderEntries.push(...buildActivityStreamSummaryAssignmentRenderEntries(
                        entry,
                        renderActivity,
                        { start: renderActivity.start, end: renderActivity.end },
                        getActivitySummaryKey(renderActivity),
                        dateStartOfDay,
                        renderZoom
                    ));
                });
                return;
            }
        }

        if (isActivityStreamSummaryAssignment(activity)) {
            renderEntries.push(...buildActivityStreamSummaryAssignmentRenderEntries(
                entry,
                activity,
                range,
                getActivitySummaryKey(activity),
                dateStartOfDay,
                renderZoom,
                { rowScopedDisplayGroups: Boolean(displayBounds) }
            ));
            return;
        }

        if (isResolvedActivityStreamAssignmentRun(activity)) {
            const renderActivity = buildResolvedActivityStreamAssignmentActivity(activity);
            renderEntries.push({
                ...entry,
                start: renderActivity.start,
                end: renderActivity.end,
                activities: [renderActivity]
            });
            return;
        }

        const renderActivities = buildActivityStreamAssignmentActivities(
            activity,
            range.start,
            range.end,
            getActivitySummaryKey(activity),
            dateStartOfDay
        );

        renderActivities.forEach(renderActivity => {
            renderEntries.push({
                ...entry,
                start: renderActivity.start,
                end: renderActivity.end,
                activities: [renderActivity]
            });
        });
    });

    return renderEntries;
}

const TIME_ENTRY_CONTENT_LEFT_PX = 64;
const TIME_ENTRY_CONTENT_RIGHT_INSET_PX = 12;
const TIME_ENTRY_LANE_GAP_PX = 4;
const TIME_ENTRY_LANE_TOUCH_TOLERANCE_MS = 1000;
const AUTO_RULE_ASSIGNMENT_MERGE_GAP_MS = 30 * 1000;

function getLoggedTimeEntryLaneRange(item) {
    const start = Number(item?.displayStart);
    const end = Number(item?.displayEnd);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
    }

    return { start, end };
}

function compareLoggedTimeEntryLaneItems(left, right) {
    if (left.start !== right.start) return left.start - right.start;
    if (left.end !== right.end) return left.end - right.end;
    if (left.item.sourceIndex !== right.item.sourceIndex) {
        return left.item.sourceIndex - right.item.sourceIndex;
    }
    return left.index - right.index;
}

function areLoggedTimeEntryLaneRangesSeparated(previousEnd, nextStart) {
    return nextStart >= previousEnd - TIME_ENTRY_LANE_TOUCH_TOLERANCE_MS;
}

function assignLoggedTimeEntryLanes(renderItems) {
    const items = renderItems.map(item => ({
        ...item,
        laneIndex: 0,
        laneCount: 1
    }));
    const laneItems = items
        .map((item, index) => {
            const range = getLoggedTimeEntryLaneRange(item);
            return range ? { item, index, ...range } : null;
        })
        .filter(Boolean)
        .sort(compareLoggedTimeEntryLaneItems);
    const components = [];
    let currentComponent = null;

    for (const laneItem of laneItems) {
        if (!currentComponent || areLoggedTimeEntryLaneRangesSeparated(currentComponent.end, laneItem.start)) {
            currentComponent = {
                end: laneItem.end,
                items: []
            };
            components.push(currentComponent);
        }

        currentComponent.items.push(laneItem);
        currentComponent.end = Math.max(currentComponent.end, laneItem.end);
    }

    for (const component of components) {
        if (component.items.length <= 1) continue;

        let activeLanes = [];
        const availableLanes = [];
        let nextLane = 0;

        for (const laneItem of component.items) {
            const stillActive = [];

            for (const activeLane of activeLanes) {
                if (areLoggedTimeEntryLaneRangesSeparated(activeLane.end, laneItem.start)) {
                    availableLanes.push(activeLane.index);
                } else {
                    stillActive.push(activeLane);
                }
            }

            activeLanes = stillActive;
            availableLanes.sort((left, right) => left - right);

            const laneIndex = availableLanes.length > 0
                ? availableLanes.shift()
                : nextLane++;

            laneItem.item.laneIndex = laneIndex;
            activeLanes.push({
                index: laneIndex,
                end: laneItem.end
            });
        }

        const laneCount = Math.max(1, nextLane);
        component.items.forEach(laneItem => {
            laneItem.item.laneCount = laneCount;
        });
    }

    return items;
}

function formatCssNumber(value) {
    return Number(value.toFixed(6)).toString();
}

function formatCssLength(percent, pixelOffset) {
    const normalizedPercent = Math.abs(percent) < 0.000001 ? 0 : percent;
    const normalizedPixels = Math.abs(pixelOffset) < 0.000001 ? 0 : pixelOffset;

    if (normalizedPercent === 0) return `${formatCssNumber(normalizedPixels)}px`;
    if (normalizedPixels === 0) return `${formatCssNumber(normalizedPercent)}%`;

    const operator = normalizedPixels < 0 ? '-' : '+';
    return `calc(${formatCssNumber(normalizedPercent)}% ${operator} ${formatCssNumber(Math.abs(normalizedPixels))}px)`;
}

function getLoggedTimeEntryLaneStyle(item) {
    const laneCount = Number(item?.laneCount) || 1;
    const laneIndex = Number(item?.laneIndex) || 0;
    if (laneCount <= 1) return '';

    const totalGapPx = (laneCount - 1) * TIME_ENTRY_LANE_GAP_PX;
    const totalInsetAndGapPx = TIME_ENTRY_CONTENT_LEFT_PX + TIME_ENTRY_CONTENT_RIGHT_INSET_PX + totalGapPx;
    const widthPercent = 100 / laneCount;
    const widthPixelOffset = -(totalInsetAndGapPx / laneCount);
    const leftPercent = laneIndex * widthPercent;
    const leftPixelOffset = TIME_ENTRY_CONTENT_LEFT_PX
        + laneIndex * (widthPixelOffset + TIME_ENTRY_LANE_GAP_PX);

    return ` left: ${formatCssLength(leftPercent, leftPixelOffset)}; width: ${formatCssLength(widthPercent, widthPixelOffset)}; right: auto;`;
}

function getLoggedTimeEntryVisualMergeKey(item) {
    const entry = item?.firstEntry || item?.entries?.[0];
    const projectId = String(entry?.projectId || '');
    if (!projectId) return null;

    const taskId = String(entry?.taskId || '');
    const sourceBackedProjection = entry?.renderSourceBackedAssignment === true
        || (Array.isArray(item?.entries) && item.entries.some(itemEntry => itemEntry?.renderSourceBackedAssignment === true));
    const displayStart = Number(item?.displayStart);
    const displayEnd = Number(item?.displayEnd);
    if (sourceBackedProjection
        && Number.isFinite(displayStart)
        && Number.isFinite(displayEnd)
        && displayEnd > displayStart) {
        return `${projectId}\u0000${taskId}\u0000source-row\u0000${displayStart}\u0000${displayEnd}`;
    }

    const assignmentActivities = getActivityStreamAssignmentActivities(entry);
    const displayGroupKey = normalizeActivityText(assignmentActivities[0]?.assignmentDisplayGroupKey).trim();
    if (displayGroupKey) {
        return `${projectId}\u0000${taskId}\u0000display\u0000${displayGroupKey}`;
    }

    return `${projectId}\u0000${taskId}`;
}

function canMergeLoggedTimeEntryVisualItems(current, item, displayStart, displayEnd) {
    const hasTouchingDisplay = current
        && Number.isFinite(displayStart)
        && Number.isFinite(displayEnd)
        && Number.isFinite(current.displayEnd)
        && displayStart <= current.displayEnd;
    return hasTouchingDisplay;
}

function mergeLoggedTimeEntryVisualItems(renderItems) {
    const grouped = new Map();

    renderItems.forEach((item, index) => {
        const mergeKey = getLoggedTimeEntryVisualMergeKey(item);
        if (!mergeKey) {
            grouped.set(`__unmergeable_${index}`, [item]);
            return;
        }

        if (!grouped.has(mergeKey)) grouped.set(mergeKey, []);
        grouped.get(mergeKey).push(item);
    });

    const mergedItems = [];
    for (const items of grouped.values()) {
        items.sort((left, right) => {
            const leftDisplayStart = Number(left.displayStart);
            const rightDisplayStart = Number(right.displayStart);
            if (leftDisplayStart !== rightDisplayStart) return leftDisplayStart - rightDisplayStart;

            const leftDisplayEnd = Number(left.displayEnd);
            const rightDisplayEnd = Number(right.displayEnd);
            if (leftDisplayEnd !== rightDisplayEnd) return leftDisplayEnd - rightDisplayEnd;

            return left.sourceIndex - right.sourceIndex;
        });

        let current = null;
        for (const item of items) {
            const displayStart = Number(item.displayStart);
            const displayEnd = Number(item.displayEnd);
            const canMerge = canMergeLoggedTimeEntryVisualItems(current, item, displayStart, displayEnd);

            if (!canMerge) {
                current = { ...item, entries: [...(item.entries || [])] };
                mergedItems.push(current);
                continue;
            }

            current.entries.push(...(item.entries || []));
            current.firstEntry = current.firstEntry || item.firstEntry;
            current.start = Math.min(current.start, item.start);
            current.end = Math.max(current.end, item.end);
            current.displayStart = Math.min(current.displayStart, displayStart);
            current.displayEnd = Math.max(current.displayEnd, displayEnd);
            current.durationMs += item.durationMs;
            current.sourceIndex = Math.min(current.sourceIndex, item.sourceIndex);
            current.isAssignedGroup = current.isAssignedGroup || item.isAssignedGroup;
            current.renderExactGeometry = current.renderExactGeometry || item.renderExactGeometry;
        }
    }

    return mergedItems.sort((left, right) => left.sourceIndex - right.sourceIndex);
}

function getVisibleLoggedTimeEntryRenderItems(renderItems) {
    return renderItems.filter(item => {
        const durationMs = Number.isFinite(Number(item?.visibleDurationMs))
            ? Number(item.visibleDurationMs)
            : Number(item?.durationMs);
        return Number.isFinite(durationMs) && durationMs >= LOGGED_TIME_ENTRY_MIN_RENDER_DURATION_MS;
    });
}

function getVisiblePopupBreakdownOverlaps(overlaps) {
    return (Array.isArray(overlaps) ? overlaps : []).filter(overlap => {
        const duration = Number(overlap?.duration);
        return Number.isFinite(duration) && duration >= POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS;
    });
}

function getVisibleMultiActivityBreakdownOverlaps(overlaps, rangeStart, rangeEnd) {
    return getVisiblePopupBreakdownOverlaps(summarizeSimilarActivityOverlaps(overlaps, rangeStart, rangeEnd));
}

function getAutoRuleExactRange(entry) {
    const activityRanges = getActivityStreamAssignmentActivities(entry)
        .map(activity => getAssignmentActivityRange(entry, activity))
        .filter(Boolean);

    if (activityRanges.length > 0) {
        return {
            start: Math.min(...activityRanges.map(range => range.start)),
            end: Math.max(...activityRanges.map(range => range.end))
        };
    }

    const start = Number(entry?.start);
    const end = Number(entry?.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        return { start, end };
    }

    return null;
}

function getAutoRuleExactAssignedDurationMs(entries) {
    const ranges = entries
        .map(getAutoRuleExactRange)
        .filter(Boolean)
        .sort((left, right) => left.start - right.start || left.end - right.end);

    if (ranges.length === 0) {
        return entries.reduce((total, entry) => total + getRenderedTimeEntryDurationMs(entry), 0);
    }

    let total = 0;
    let current = null;
    for (const range of ranges) {
        if (!current || range.start > current.end) {
            if (current) total += current.end - current.start;
            current = { ...range };
            continue;
        }

        current.end = Math.max(current.end, range.end);
    }

    if (current) total += current.end - current.start;
    return total;
}

function addActivityMatchKeys(keys, activity) {
    const summaryKey = getActivitySummaryKey(activity);
    const similarityKey = getActivitySimilarityKey(activity);
    if (summaryKey) keys.add(summaryKey);
    if (similarityKey) keys.add(similarityKey);
}

function activityMatchesAnyKey(activity, keys) {
    if (!activity || !keys?.size) return false;
    const summaryKey = getActivitySummaryKey(activity);
    if (summaryKey && keys.has(summaryKey)) return true;

    const similarityKey = getActivitySimilarityKey(activity);
    return Boolean(similarityKey && keys.has(similarityKey));
}

function getAutoRuleVisibleActivityDisplaySegments(entry, exactStart, exactEnd, visibleActivityCells) {
    if (!Array.isArray(visibleActivityCells) || visibleActivityCells.length === 0) return [];
    const sourceActivities = getActivityStreamAssignmentActivities(entry);
    if (sourceActivities.length === 0) return [];

    const matchKeys = new Set();
    sourceActivities.forEach(activity => addActivityMatchKeys(matchKeys, activity));
    if (matchKeys.size === 0) return [];

    const segments = [];
    visibleActivityCells.forEach(cell => {
        if (!cell || cell.end <= exactStart || cell.start >= exactEnd) return;

        const visibleOverlaps = getVisibleMultiActivityBreakdownOverlaps(cell.overlaps || [cell], cell.start, cell.end);
        const hasVisibleMatch = visibleOverlaps.some(overlap => activityMatchesAnyKey(overlap, matchKeys));
        if (!hasVisibleMatch) return;

        const segmentExactStart = Math.max(exactStart, cell.start);
        const segmentExactEnd = Math.min(exactEnd, cell.end);
        if (segmentExactEnd <= segmentExactStart) return;

        const previous = segments[segments.length - 1];
        if (previous && previous.displayEnd === cell.start && previous.exactEnd >= segmentExactStart) {
            previous.displayEnd = cell.end;
            previous.exactEnd = Math.max(previous.exactEnd, segmentExactEnd);
            return;
        }

        segments.push({
            displayStart: cell.start,
            displayEnd: cell.end,
            exactStart: segmentExactStart,
            exactEnd: segmentExactEnd
        });
    });

    return segments;
}

function buildAutoRuleSegmentEntry(entry, segment) {
    const segmentStart = Number(segment?.exactStart);
    const segmentEnd = Number(segment?.exactEnd);
    if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) return null;

    const clippedActivities = getActivityStreamAssignmentActivities(entry)
        .map(activity => {
            const range = getAssignmentActivityRange(entry, activity);
            if (!range) return null;

            const start = Math.max(range.start, segmentStart);
            const end = Math.min(range.end, segmentEnd);
            if (end <= start) return null;

            const duration = Math.max(0, end - start);
            return {
                ...activity,
                start,
                end,
                duration,
                assignedDurationMs: duration,
                assignmentStart: start,
                assignmentEnd: end,
                activityMix: getActivityMixInRange(activity, start, end)
            };
        })
        .filter(Boolean);
    if (clippedActivities.length === 0) return null;

    const durationMs = clippedActivities.reduce((total, activity) => {
        return total + getActivitySourceDuration(activity);
    }, 0);
    if (durationMs <= 0) return null;

    return {
        ...entry,
        start: Math.min(...clippedActivities.map(activity => activity.start)),
        end: Math.max(...clippedActivities.map(activity => activity.end)),
        renderDisplayStart: segment.displayStart,
        renderDisplayEnd: segment.displayEnd,
        renderDurationMs: durationMs,
        renderExactGeometry: false,
        activities: clippedActivities
    };
}

function buildAutoRuleExactFragmentItems(groupEntries) {
    const sortedEntries = groupEntries
        .map(({ entry, sourceIndex }) => {
            const exactRange = getAutoRuleExactRange(entry);
            const exactStart = exactRange?.start ?? entry.start;
            const exactEnd = exactRange?.end ?? entry.end;
            if (!Number.isFinite(exactStart) || !Number.isFinite(exactEnd) || exactEnd <= exactStart) {
                return null;
            }
            return {
                entry,
                sourceIndex,
                exactStart,
                exactEnd,
                durationMs: getRenderedTimeEntryDurationMs(entry)
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.exactStart - right.exactStart || left.exactEnd - right.exactEnd);
    const clusters = [];
    let current = null;

    const flushCurrent = () => {
        if (!current) return;
        current.visibleDurationMs = current.items.reduce((total, item) => total + item.durationMs, 0);
        if (current.visibleDurationMs >= LOGGED_TIME_ENTRY_MIN_RENDER_DURATION_MS) {
            clusters.push(current);
        }
        current = null;
    };

    for (const item of sortedEntries) {
        const exactGapMs = current ? item.exactStart - current.end : Number.POSITIVE_INFINITY;
        if (!current || exactGapMs > ACTIVITY_STREAM_SESSION_MERGE_GAP_MS) {
            flushCurrent();
            current = {
                start: item.exactStart,
                end: item.exactEnd,
                items: [item]
            };
            continue;
        }

        current.items.push(item);
        current.end = Math.max(current.end, item.exactEnd);
    }

    flushCurrent();

    const renderItems = [];

    for (const cluster of clusters) {
        renderItems.push({
            entries: cluster.items.map(item => item.entry),
            firstEntry: cluster.items[0]?.entry,
            start: cluster.start,
            end: cluster.end,
            displayStart: cluster.start,
            displayEnd: cluster.end,
            durationMs: cluster.visibleDurationMs,
            visibleDurationMs: cluster.visibleDurationMs,
            isAssignedGroup: true,
            sourceIndex: Math.min(...cluster.items.map(item => item.sourceIndex)),
            renderExactGeometry: true
        });
    }

    return renderItems;
}

function buildAutoRuleDisplayRangeGroups(sortedEntries) {
    const groups = new Map();

    for (const item of sortedEntries) {
        const key = `${item.displayStart}:${item.displayEnd}`;
        if (!groups.has(key)) {
            groups.set(key, {
                entries: [],
                firstEntry: item.entry,
                start: item.exactStart,
                end: item.exactEnd,
                displayStart: item.displayStart,
                displayEnd: item.displayEnd,
                isAssignedGroup: true,
                sourceIndex: item.sourceIndex
            });
        }

        const group = groups.get(key);
        group.entries.push(item.entry);
        group.start = Math.min(group.start, item.exactStart);
        group.end = Math.max(group.end, item.exactEnd);
        group.sourceIndex = Math.min(group.sourceIndex, item.sourceIndex);
    }

    return [...groups.values()]
        .map(group => ({
            ...group,
            durationMs: getAutoRuleExactAssignedDurationMs(group.entries)
        }))
        .filter(group => group.durationMs >= LOGGED_TIME_ENTRY_MIN_RENDER_DURATION_MS)
        .sort((left, right) => {
            if (left.displayStart !== right.displayStart) return left.displayStart - right.displayStart;
            if (left.displayEnd !== right.displayEnd) return left.displayEnd - right.displayEnd;
            return left.sourceIndex - right.sourceIndex;
        });
}

function buildAutoRuleRowAggregatedItems(groupEntries, dateStartOfDay, zoom) {
    if (shouldRenderExactActivityStreamSessions(zoom)) {
        return buildAutoRuleExactFragmentItems(groupEntries);
    }

    const visibleActivityCells = shouldRenderExactActivityStreamSessions(zoom)
        ? null
        : buildVisibleActivityCells({
            dateStartOfDay,
            zoom,
            ownershipActivities: Array.isArray(state.timelineActivities) ? state.timelineActivities : state.activities,
            visibleActivities: state.activities
        });
    const sortedEntries = groupEntries
        .flatMap(({ entry, sourceIndex }) => {
            const exactRange = getAutoRuleExactRange(entry);
            const exactStart = exactRange?.start ?? entry.start;
            const exactEnd = exactRange?.end ?? entry.end;
            if (!Number.isFinite(exactStart) || !Number.isFinite(exactEnd) || exactEnd <= exactStart) {
                return [];
            }
            return getAutoRuleVisibleActivityDisplaySegments(entry, exactStart, exactEnd, visibleActivityCells)
                .map((segment, segmentIndex) => {
                    const segmentEntry = buildAutoRuleSegmentEntry(entry, segment);
                    if (!segmentEntry) return null;

                    return {
                        entry: segmentEntry,
                        sourceIndex: sourceIndex + (segmentIndex / 1000000),
                        exactStart: segmentEntry.start,
                        exactEnd: segmentEntry.end,
                        displayStart: segment.displayStart,
                        displayEnd: segment.displayEnd
                    };
                })
                .filter(Boolean);
        })
        .sort((left, right) => {
            if (left.displayStart !== right.displayStart) return left.displayStart - right.displayStart;
            if (left.displayEnd !== right.displayEnd) return left.displayEnd - right.displayEnd;
            return left.exactStart - right.exactStart || left.exactEnd - right.exactEnd;
        });
    return buildAutoRuleDisplayRangeGroups(sortedEntries);
}

function buildLoggedTimeEntryRenderItems(entries, zoom, dateStartOfDay) {
    const assignmentGroupsByKey = {};
    const autoAssignmentGroupsByKey = {};
    const manualItems = [];

    entries.forEach((entry, sourceIndex) => {
        if (isTimelineHiddenAutoAssignedTimeEntry(entry)) return;
        const renderEntries = buildActivityStreamRenderEntries(entry, dateStartOfDay, zoom);

        renderEntries.forEach((renderEntry, renderIndex) => {
            const assignmentKey = getActivityStreamAssignmentGroupKey(renderEntry);
            const renderSourceIndex = sourceIndex + (renderIndex / 1000);
            const displayRange = getRenderEntryDisplayRowRange(renderEntry, dateStartOfDay, zoom);
            if (!assignmentKey) {
                manualItems.push({
                    entries: [renderEntry],
                    firstEntry: renderEntry,
                    start: renderEntry.start,
                    end: renderEntry.end,
                    displayStart: displayRange.start,
                    displayEnd: displayRange.end,
                    durationMs: getRenderedTimeEntryDurationMs(renderEntry),
                    isAssignedGroup: false,
                    sourceIndex: renderSourceIndex
                });
                return;
            }

            if (isAutoRuleExactTimeEntry(renderEntry)) {
                const autoAssignmentKey = getAutoRuleAssignmentGroupKey(renderEntry) || assignmentKey;
                autoAssignmentGroupsByKey[autoAssignmentKey] ||= [];
                autoAssignmentGroupsByKey[autoAssignmentKey].push({
                    entry: renderEntry,
                    sourceIndex: renderSourceIndex
                });
                return;
            }

            assignmentGroupsByKey[assignmentKey] ||= [];
            assignmentGroupsByKey[assignmentKey].push({ entry: renderEntry, sourceIndex: renderSourceIndex });
        });
    });

    const assignmentItems = [];
    for (const groupEntries of Object.values(assignmentGroupsByKey)) {
        groupEntries.sort((left, right) => left.entry.start - right.entry.start);

        let currentGroup = null;
        for (const { entry, sourceIndex } of groupEntries) {
            const displayRange = getRenderEntryDisplayRowRange(entry, dateStartOfDay, zoom);
            const shouldStartGroup = !currentGroup
                || displayRange.start > currentGroup.displayEnd;

            if (shouldStartGroup) {
                currentGroup = {
                    entries: [entry],
                    firstEntry: entry,
                    start: entry.start,
                    end: entry.end,
                    displayStart: displayRange.start,
                    displayEnd: displayRange.end,
                    isAssignedGroup: true,
                    renderExactGeometry: entry.renderExactGeometry === true,
                    sourceIndex
                };
                assignmentItems.push(currentGroup);
                continue;
            }

            currentGroup.entries.push(entry);
            currentGroup.start = Math.min(currentGroup.start, entry.start);
            currentGroup.end = Math.max(currentGroup.end, entry.end);
            currentGroup.displayStart = Math.min(currentGroup.displayStart, displayRange.start);
            currentGroup.displayEnd = Math.max(currentGroup.displayEnd, displayRange.end);
            currentGroup.renderExactGeometry = currentGroup.renderExactGeometry || entry.renderExactGeometry === true;
            currentGroup.sourceIndex = Math.min(currentGroup.sourceIndex, sourceIndex);
        }
    }

    for (const groupEntries of Object.values(autoAssignmentGroupsByKey)) {
        const rowGroups = buildAutoRuleRowAggregatedItems(groupEntries, dateStartOfDay, zoom);
        let currentGroup = null;
        for (const rowGroup of rowGroups) {
            const canMergeWithCurrent = currentGroup
                && Number.isFinite(rowGroup.displayStart)
                && Number.isFinite(rowGroup.displayEnd)
                && Number.isFinite(currentGroup.displayEnd)
                && rowGroup.displayStart <= currentGroup.displayEnd
                && (rowGroup.displayStart < currentGroup.displayEnd
                    || rowGroup.start <= currentGroup.end + AUTO_RULE_ASSIGNMENT_MERGE_GAP_MS);
            const shouldStartGroup = !canMergeWithCurrent;

            if (shouldStartGroup) {
                currentGroup = {
                    ...rowGroup,
                    entries: [...rowGroup.entries]
                };
                assignmentItems.push(currentGroup);
                continue;
            }

            currentGroup.entries.push(...rowGroup.entries);
            currentGroup.start = Math.min(currentGroup.start, rowGroup.start);
            currentGroup.end = Math.max(currentGroup.end, rowGroup.end);
            currentGroup.displayStart = Math.min(currentGroup.displayStart, rowGroup.displayStart);
            currentGroup.displayEnd = Math.max(currentGroup.displayEnd, rowGroup.displayEnd);
            currentGroup.durationMs += rowGroup.durationMs;
            currentGroup.sourceIndex = Math.min(currentGroup.sourceIndex, rowGroup.sourceIndex);
        }
    }

    for (const item of assignmentItems) {
        item.durationMs = item.entries.some(isAutoRuleExactTimeEntry)
            ? getAutoRuleExactAssignedDurationMs(item.entries)
            : getActivityStreamAssignedDurationMs(item.entries);
    }

    const renderItems = mergeLoggedTimeEntryVisualItems([...manualItems, ...assignmentItems])
        .map(item => ({
            ...item,
            entries: [...new Map((item.entries || []).map(entry => [entry.id || `${entry.start}:${entry.end}:${entry.projectId}`, entry])).values()]
        }))
        .filter(item => item.entries.length > 0)
        .map(item => ({
            ...item,
            firstEntry: item.firstEntry || item.entries[0]
        }));
    const visibleRenderItems = getVisibleLoggedTimeEntryRenderItems(renderItems)
        .sort((left, right) => left.sourceIndex - right.sourceIndex);

    return assignLoggedTimeEntryLanes(visibleRenderItems);
}

function applyAssignmentSummaryMetadata(summary, overlap) {
    if (overlap?.assignmentSource) {
        summary.assignmentSource = overlap.assignmentSource;
    }

    const assignmentStart = Number(overlap?.assignmentStart);
    if (Number.isFinite(assignmentStart)) {
        summary.assignmentStart = Number.isFinite(summary.assignmentStart)
            ? Math.min(summary.assignmentStart, assignmentStart)
            : assignmentStart;
    }

    const assignmentEnd = Number(overlap?.assignmentEnd);
    if (Number.isFinite(assignmentEnd)) {
        summary.assignmentEnd = Number.isFinite(summary.assignmentEnd)
            ? Math.max(summary.assignmentEnd, assignmentEnd)
            : assignmentEnd;
    }

    const assignedDuration = Number(overlap?.assignedDurationMs);
    if (Number.isFinite(assignedDuration) && assignedDuration > 0) {
        summary.assignedDurationMs = (Number.isFinite(summary.assignedDurationMs) ? summary.assignedDurationMs : 0)
            + assignedDuration;
    }
}

function sortActivitySummaries(groupedOverlaps) {
    return Object.values(groupedOverlaps).map(summary => {
        if (summary.assignmentSource === 'activity-stream'
            && (!Number.isFinite(summary.assignedDurationMs) || summary.assignedDurationMs <= 0)) {
            summary.assignedDurationMs = summary.duration;
        }
        return summary;
    }).sort((a, b) => {
        const startA = Number.isFinite(a.start) ? a.start : Number.MAX_SAFE_INTEGER;
        const startB = Number.isFinite(b.start) ? b.start : Number.MAX_SAFE_INTEGER;
        if (startA !== startB) return startA - startB;
        return b.duration - a.duration;
    });
}

function registerActivityBlockDetailOverlaps(rowLayout, overlaps) {
    const detailMap = rowLayout?.activityBlockDetails;
    if (!detailMap || !Array.isArray(overlaps)) return null;

    const key = `activity-overlaps-${detailMap.size + 1}`;
    detailMap.set(key, overlaps);
    return key;
}

function parseActivityBlockOverlapsDataset(blockEl) {
    if (!blockEl?.dataset?.overlaps) return [];

    try {
        const parsed = JSON.parse(decodeURIComponent(blockEl.dataset.overlaps));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function getActivityBlockDetailOverlaps(blockEl) {
    const overlapKey = blockEl?.dataset?.overlapKey;
    if (overlapKey) {
        const overlaps = dayTimelineRenderModelCache?.model?.activityBlockDetails?.get(overlapKey);
        if (Array.isArray(overlaps)) return overlaps;
    }

    return parseActivityBlockOverlapsDataset(blockEl);
}

function summarizeActivityOverlaps(overlaps, rangeStart, rangeEnd) {
    const groupedOverlaps = {};
    const seenSources = new Set();

    for (const overlap of overlaps) {
        const key = getActivitySummaryKey(overlap);
        const sourceKey = getActivitySourceKey(overlap);
        const clippedStart = Number.isFinite(overlap.start) && Number.isFinite(rangeStart)
            ? Math.max(overlap.start, rangeStart)
            : overlap.start;
        const clippedEnd = Number.isFinite(overlap.end) && Number.isFinite(rangeEnd)
            ? Math.min(overlap.end, rangeEnd)
            : overlap.end;
        const clippedDuration = getActivitySourceDuration(overlap, rangeStart, rangeEnd);
        const clippedMix = getActivityMixInRange(overlap, rangeStart, rangeEnd);

        if (sourceKey) {
            if (seenSources.has(sourceKey)) continue;
            seenSources.add(sourceKey);
        }

        if (!groupedOverlaps[key]) {
            groupedOverlaps[key] = {
                duration: 0,
                activityMix: emptyActivityMix(),
                app: overlap.app,
                title: getActivityDisplayTitle(overlap),
                url: overlap.url,
                appPath: overlap.appPath || '',
                bundleId: overlap.bundleId || '',
                start: clippedStart,
                end: clippedEnd,
                sources: []
            };
        } else {
            const group = groupedOverlaps[key];
            if (Number.isFinite(clippedStart)) {
                group.start = Number.isFinite(group.start) ? Math.min(group.start, clippedStart) : clippedStart;
            }
            if (Number.isFinite(clippedEnd)) {
                group.end = Number.isFinite(group.end) ? Math.max(group.end, clippedEnd) : clippedEnd;
            }
        }

        applyAssignmentSummaryMetadata(groupedOverlaps[key], overlap);
        groupedOverlaps[key].duration += clippedDuration;
        groupedOverlaps[key].activityMix = addTimelineActivityMix(groupedOverlaps[key].activityMix, clippedMix);
        if (clippedDuration > 0) {
            groupedOverlaps[key].sources.push({
                ...overlap,
                title: getActivityDisplayTitle(overlap),
                appPath: overlap.appPath || '',
                bundleId: overlap.bundleId || '',
                start: clippedStart,
                end: clippedEnd,
                duration: clippedDuration,
                activityMix: clippedMix
            });
        }
    }

    return sortActivitySummaries(groupedOverlaps);
}

function summarizeSimilarActivityOverlaps(overlaps, rangeStart, rangeEnd) {
    const groupedOverlaps = {};
    const seenSources = new Set();

    for (const overlap of overlaps || []) {
        const key = getActivitySimilarityKey(overlap) || getActivitySummaryKey(overlap);
        const sourceKey = getActivitySourceKey(overlap);
        const clippedStart = Number.isFinite(overlap.start) && Number.isFinite(rangeStart)
            ? Math.max(overlap.start, rangeStart)
            : overlap.start;
        const clippedEnd = Number.isFinite(overlap.end) && Number.isFinite(rangeEnd)
            ? Math.min(overlap.end, rangeEnd)
            : overlap.end;
        const clippedDuration = getActivitySourceDuration(overlap, rangeStart, rangeEnd);
        const clippedMix = getActivityMixInRange(overlap, rangeStart, rangeEnd);

        if (sourceKey) {
            if (seenSources.has(sourceKey)) continue;
            seenSources.add(sourceKey);
        }

        if (!groupedOverlaps[key]) {
            groupedOverlaps[key] = {
                duration: 0,
                activityMix: emptyActivityMix(),
                app: overlap.app,
                title: getActivityDisplayTitle(overlap),
                url: overlap.url,
                appPath: overlap.appPath || '',
                bundleId: overlap.bundleId || '',
                start: clippedStart,
                end: clippedEnd,
                sources: []
            };
        } else {
            const group = groupedOverlaps[key];
            if (Number.isFinite(clippedStart)) {
                group.start = Number.isFinite(group.start) ? Math.min(group.start, clippedStart) : clippedStart;
            }
            if (Number.isFinite(clippedEnd)) {
                group.end = Number.isFinite(group.end) ? Math.max(group.end, clippedEnd) : clippedEnd;
            }
        }

        applyAssignmentSummaryMetadata(groupedOverlaps[key], overlap);
        groupedOverlaps[key].duration += clippedDuration;
        groupedOverlaps[key].activityMix = addTimelineActivityMix(groupedOverlaps[key].activityMix, clippedMix);
        if (clippedDuration > 0) {
            groupedOverlaps[key].sources.push({
                ...overlap,
                title: getActivityDisplayTitle(overlap),
                appPath: overlap.appPath || '',
                bundleId: overlap.bundleId || '',
                start: clippedStart,
                end: clippedEnd,
                duration: clippedDuration,
                activityMix: clippedMix
            });
        }
    }

    return sortActivitySummaries(groupedOverlaps);
}

function getPopupActivityExactGroupingKey(activity) {
    const app = normalizeActivityText(activity?.app).trim().toLowerCase();
    const title = getActivityDisplayTitle(activity).toLowerCase();
    const host = getActivitySummaryHostname(activity);
    if (host) {
        return `${app}|||${title}|||${host}`;
    }

    return `${app}|||${title || app}`;
}

function getPopupActivityHostBucketKey(activity) {
    const app = normalizeActivityText(activity?.app).trim().toLowerCase();
    const host = getActivitySummaryHostname(activity);
    return host ? `${app}|||${host}` : '';
}

function summarizePopupActivityOverlaps(overlaps, rangeStart, rangeEnd) {
    const groupedOverlaps = {};
    const seenSources = new Set();

    for (const overlap of overlaps || []) {
        const key = getPopupActivityExactGroupingKey(overlap) || getActivitySummaryKey(overlap);
        const sourceKey = getActivitySourceKey(overlap);
        const clippedStart = Number.isFinite(overlap.start) && Number.isFinite(rangeStart)
            ? Math.max(overlap.start, rangeStart)
            : overlap.start;
        const clippedEnd = Number.isFinite(overlap.end) && Number.isFinite(rangeEnd)
            ? Math.min(overlap.end, rangeEnd)
            : overlap.end;
        const clippedDuration = getActivitySourceDuration(overlap, rangeStart, rangeEnd);
        const clippedMix = getActivityMixInRange(overlap, rangeStart, rangeEnd);

        if (sourceKey) {
            if (seenSources.has(sourceKey)) continue;
            seenSources.add(sourceKey);
        }

        if (!groupedOverlaps[key]) {
            groupedOverlaps[key] = {
                duration: 0,
                activityMix: emptyActivityMix(),
                app: overlap.app,
                title: getActivityDisplayTitle(overlap),
                url: overlap.url,
                appPath: overlap.appPath || '',
                bundleId: overlap.bundleId || '',
                start: clippedStart,
                end: clippedEnd,
                sources: []
            };
        } else {
            const group = groupedOverlaps[key];
            if (Number.isFinite(clippedStart)) {
                group.start = Number.isFinite(group.start) ? Math.min(group.start, clippedStart) : clippedStart;
            }
            if (Number.isFinite(clippedEnd)) {
                group.end = Number.isFinite(group.end) ? Math.max(group.end, clippedEnd) : clippedEnd;
            }
        }

        applyAssignmentSummaryMetadata(groupedOverlaps[key], overlap);
        groupedOverlaps[key].duration += clippedDuration;
        groupedOverlaps[key].activityMix = addTimelineActivityMix(groupedOverlaps[key].activityMix, clippedMix);
        if (clippedDuration > 0) {
            groupedOverlaps[key].sources.push({
                ...overlap,
                title: getActivityDisplayTitle(overlap),
                appPath: overlap.appPath || '',
                bundleId: overlap.bundleId || '',
                start: clippedStart,
                end: clippedEnd,
                duration: clippedDuration,
                activityMix: clippedMix
            });
        }
    }

    return sortActivitySummaries(groupedOverlaps);
}

function getActivityPopupContextKey(activity) {
    const app = normalizeActivityText(activity?.app).trim().toLowerCase();
    const host = getActivitySummaryHostname(activity);
    if (host) return `browser|||${app}|||${host}`;

    const title = getActivityDisplayTitle(activity).trim().toLowerCase();
    const meaningfulTitle = title && !isWeakPopupActivityTitle(title, activity) ? title : '';
    return `native|||${app}|||${meaningfulTitle || app}`;
}

function getPopupRowSources(row) {
    return Array.isArray(row?.sources) && row.sources.length > 0
        ? row.sources
        : [row].filter(Boolean);
}

function getPopupSourceChildRow(source, rangeStart, rangeEnd) {
    const start = Number.isFinite(source?.start) ? source.start : undefined;
    const end = Number.isFinite(source?.end) ? source.end : undefined;
    const duration = getActivitySourceDuration(source, rangeStart, rangeEnd);
    if (!Number.isFinite(duration) || duration <= 0) return null;

    return {
        ...stripActivitySources(source),
        app: source?.app || '',
        title: getActivityDisplayTitle(source),
        url: source?.url || '',
        appPath: source?.appPath || '',
        bundleId: source?.bundleId || '',
        start,
        end,
        duration,
        activityMix: source?.activityMix || getActivityMixInRange(source, rangeStart, rangeEnd),
        popupSourceChild: true
    };
}

function getPopupPageChildKey(activity) {
    const app = normalizeActivityText(activity?.app).trim().toLowerCase();
    const rawTitle = getActivityDisplayTitle(activity).trim();
    const title = rawTitle.toLowerCase();
    const rawUrl = normalizeActivityText(activity?.url).trim();
    const host = getActivitySummaryHostname(activity);
    const weakBrowserTitle = Boolean(host && isWeakPopupActivityTitle(rawTitle, activity));
    let urlKey = '';

    if (weakBrowserTitle) {
        urlKey = host;
    } else if (rawUrl) {
        try {
            const parsed = new URL(rawUrl);
            if (['http:', 'https:'].includes(parsed.protocol.toLowerCase())) {
                parsed.hash = '';
                parsed.search = '';
                urlKey = `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname || '/'}`.toLowerCase();
            }
        } catch {
            urlKey = rawUrl.toLowerCase();
        }
    }

    const nativeIdentity = normalizeActivityText(activity?.bundleId || activity?.appPath || '').trim().toLowerCase();
    return `${app}|||${weakBrowserTitle ? host : (title || app)}|||${urlKey || host || nativeIdentity}`;
}

function buildPopupPageChildRows(rows, rangeStart, rangeEnd) {
    const groups = new Map();

    for (const source of (Array.isArray(rows) ? rows : []).flatMap(getPopupRowSources)) {
        const child = getPopupSourceChildRow(source, rangeStart, rangeEnd);
        if (!child) continue;

        const key = getPopupPageChildKey(child);
        if (!groups.has(key)) {
            groups.set(key, {
                ...child,
                duration: 0,
                activityMix: emptyActivityMix(),
                start: Number.isFinite(child.start) ? child.start : undefined,
                end: Number.isFinite(child.end) ? child.end : undefined,
                sources: []
            });
        }

        const group = groups.get(key);
        if (Number.isFinite(child.start)) {
            group.start = Number.isFinite(group.start) ? Math.min(group.start, child.start) : child.start;
        }
        if (Number.isFinite(child.end)) {
            group.end = Number.isFinite(group.end) ? Math.max(group.end, child.end) : child.end;
        }
        group.duration += child.duration;
        group.activityMix = addTimelineActivityMix(group.activityMix || emptyActivityMix(), child.activityMix || emptyActivityMix());
        group.sources.push(child);
    }

    return Array.from(groups.values())
        .filter(child => Number(child.duration) > 0)
        .map(child => ({
            ...child,
            popupSourceChild: true,
            popupSessionChild: true
        }))
        .sort((left, right) => {
            if (right.duration !== left.duration) return right.duration - left.duration;
            const startA = Number.isFinite(left.start) ? left.start : Number.MAX_SAFE_INTEGER;
            const startB = Number.isFinite(right.start) ? right.start : Number.MAX_SAFE_INTEGER;
            return startA - startB;
        });
}

function getPopupSessionDisplayTitle(rows, host) {
    if (host) return host;

    const groupRows = Array.isArray(rows) ? rows : [];
    const first = groupRows[0] || {};
    const title = getActivityDisplayTitle(first).trim();
    const app = normalizeActivityText(first?.app).trim();
    if (title && !isWeakPopupActivityTitle(title, first)) return title;
    return app || title || 'Recorded Activity';
}

function getRenderablePopupSessionChildren(children) {
    const childRows = Array.isArray(children) ? children.filter(child => Number(child?.duration) > 0) : [];
    if (childRows.length >= 2) return childRows;
    return [];
}

function doesPopupSessionChildAddDisplayContext(parent, child) {
    const parentLabel = getPopupActivityDisplayLabels(parent).primary.trim().toLowerCase();
    const childLabel = getPopupActivityDisplayLabels(child).primary.trim();
    const normalizedChildLabel = childLabel.toLowerCase();
    if (!normalizedChildLabel || normalizedChildLabel === parentLabel) return false;
    return !isWeakPopupActivityTitle(childLabel, child);
}

function promoteSinglePopupSessionChild(row, children) {
    const childRows = Array.isArray(children) ? children.filter(nextChild => Number(nextChild?.duration) > 0) : [];
    if (childRows.length !== 1) return row;
    const [child] = childRows;
    if (!doesPopupSessionChildAddDisplayContext(row, child)) return row;

    return {
        ...row,
        app: child.app || row.app,
        title: getActivityDisplayTitle(child) || row.title,
        url: child.url || row.url,
        appPath: child.appPath || row.appPath,
        bundleId: child.bundleId || row.bundleId
    };
}

function buildPopupSessionSummaryRow(rows, contextKey, rangeStart, rangeEnd) {
    const groupRows = Array.isArray(rows) ? rows : [];
    const first = groupRows[0] || {};
    const pageChildren = buildPopupPageChildRows(groupRows, rangeStart, rangeEnd);
    const duration = pageChildren.reduce((total, child) => total + child.duration, 0);
    if (duration <= 0) return null;

    const host = getActivitySummaryHostname(first);
    const title = getPopupSessionDisplayTitle(groupRows, host);
    const url = host ? `https://${host}` : normalizeActivityText(first.url);
    const start = pageChildren.reduce((value, child) => Number.isFinite(child.start) ? Math.min(value, child.start) : value, Number.MAX_SAFE_INTEGER);
    const end = pageChildren.reduce((value, child) => Number.isFinite(child.end) ? Math.max(value, child.end) : value, 0);
    const activityMix = pageChildren.reduce((mix, child) => {
        return addTimelineActivityMix(mix, child.activityMix || emptyActivityMix());
    }, emptyActivityMix());
    const sources = pageChildren.flatMap(child => Array.isArray(child.sources) && child.sources.length > 0 ? child.sources : [child]);
    const row = {
        app: first.app || '',
        title,
        url,
        appPath: first.appPath || '',
        bundleId: first.bundleId || '',
        start: start === Number.MAX_SAFE_INTEGER ? rangeStart : start,
        end: end > 0 ? end : rangeEnd,
        duration,
        activityMix,
        sources,
        popupContextSummary: true,
        popupSessionSummary: true,
        popupContextKey: contextKey
    };
    const displayRow = promoteSinglePopupSessionChild(row, pageChildren);

    return {
        ...displayRow,
        children: getRenderablePopupSessionChildren(pageChildren)
    };
}

function getSinglePopupDisplayActivity(activity) {
    if (!activity?.popupContextSummary || !getActivitySummaryHostname(activity)) return activity;
    if (Array.isArray(activity.children) && activity.children.length > 0) return activity;

    const pageChildren = buildPopupPageChildRows(getPopupRowSources(activity), activity.start, activity.end);
    return promoteSinglePopupSessionChild(activity, pageChildren);
}

function getTimelineBlockDisplayActivity(primaryActivity, popupDisplayModel) {
    const primaryDisplayActivity = getSinglePopupDisplayActivity(
        popupDisplayModel?.primaryRow || primaryActivity
    ) || primaryActivity;
    const primaryTitle = getMeaningfulActivityDisplayTitle(primaryActivity);
    if (!primaryTitle) {
        return getTimelineBlockFallbackDisplayActivity(primaryDisplayActivity, popupDisplayModel)
            || primaryDisplayActivity;
    }

    const primarySimilarityKey = getActivitySimilarityKey(primaryActivity);
    const candidates = [];
    (popupDisplayModel?.visibleRows || []).forEach(row => {
        const displayRow = getSinglePopupDisplayActivity(row);
        if (displayRow) candidates.push(displayRow);
        (Array.isArray(row?.children) ? row.children : []).forEach(child => candidates.push(child));
    });

    return candidates.find(candidate => {
        if (!candidate) return false;
        if (getMeaningfulActivityDisplayTitle(candidate) !== primaryTitle) return false;

        const candidateSimilarityKey = getActivitySimilarityKey(candidate);
        const hasDistinctMetadata = Boolean(normalizeActivityText(candidate?.url).trim())
            || (primarySimilarityKey && candidateSimilarityKey && candidateSimilarityKey !== primarySimilarityKey)
            || normalizeActivityText(candidate?.appPath).trim() !== normalizeActivityText(primaryActivity?.appPath).trim()
            || normalizeActivityText(candidate?.bundleId).trim() !== normalizeActivityText(primaryActivity?.bundleId).trim();
        return hasDistinctMetadata;
    }) || primaryDisplayActivity;
}

function getBestMeaningfulPopupPrimaryRow(rows) {
    return [...(Array.isArray(rows) ? rows : [])]
        .filter(row => {
            const displayRow = getSinglePopupDisplayActivity(row);
            const labels = getPopupActivityDisplayLabels(displayRow);
            const rowTitle = normalizeActivityText(labels?.primary).trim();
            return rowTitle && !isWeakPopupActivityTitle(rowTitle, displayRow);
        })
        .sort((left, right) => {
            const durationA = Number(left?.duration);
            const durationB = Number(right?.duration);
            if (Number.isFinite(durationA) && Number.isFinite(durationB) && durationA !== durationB) {
                return durationB - durationA;
            }
            if (Number.isFinite(durationB) && !Number.isFinite(durationA)) return 1;
            if (Number.isFinite(durationA) && !Number.isFinite(durationB)) return -1;

            const startA = Number.isFinite(left?.start) ? left.start : Number.MAX_SAFE_INTEGER;
            const startB = Number.isFinite(right?.start) ? right.start : Number.MAX_SAFE_INTEGER;
            return startA - startB;
        })[0] || null;
}

function sortPopupDisplayRows(rows) {
    return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
        const startA = Number.isFinite(left.start) ? left.start : Number.MAX_SAFE_INTEGER;
        const startB = Number.isFinite(right.start) ? right.start : Number.MAX_SAFE_INTEGER;
        if (startA !== startB) return startA - startB;
        return right.duration - left.duration;
    });
}

function buildTopLevelPopupDisplayRows(exactRows, rangeStart, rangeEnd, primaryActivity = null) {
    const groups = new Map();
    const primaryContextKey = getActivityPopupContextKey(primaryActivity || {});

    for (const row of Array.isArray(exactRows) ? exactRows : []) {
        const duration = Number(row?.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
            continue;
        }

        const contextKey = getActivityPopupContextKey(row);
        if (!contextKey) continue;

        if (!groups.has(contextKey)) {
            groups.set(contextKey, {
                contextKey,
                rows: []
            });
        }

        groups.get(contextKey).rows.push(row);
    }

    const rows = Array.from(groups.values())
        .map(group => buildPopupSessionSummaryRow(group.rows, group.contextKey, rangeStart, rangeEnd))
        .filter(Boolean)
        .filter(row => {
            const duration = Number(row?.duration);
            return (Number.isFinite(duration) && duration >= POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS)
                || row?.popupContextKey === primaryContextKey;
        });

    return sortPopupDisplayRows(rows);
}

function isGenericPopupPrimaryActivity(activity) {
    const title = getActivityDisplayTitle(activity).trim().toLowerCase();
    return title === 'multiple activities' || isWeakPopupActivityTitle(title, activity);
}

function buildPrimaryPopupDisplayRow(primaryActivity, exactRows, rangeStart, rangeEnd, activeDurationMs, zoom) {
    const primaryKey = getPopupActivityExactGroupingKey(primaryActivity);
    const exactRow = (Array.isArray(exactRows) ? exactRows : [])
        .find(row => getPopupActivityExactGroupingKey(row) === primaryKey);
    const fallbackExactRow = !exactRow && isGenericPopupPrimaryActivity(primaryActivity)
        ? (Array.isArray(exactRows) ? exactRows : [])
            .find(row => Number(row?.duration) >= POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS)
        : null;
    const sourceExactRow = exactRow || fallbackExactRow;
    const exactDuration = Number(sourceExactRow?.duration);
    const activeDuration = Number(activeDurationMs);
    const shouldUseExactRow = Number.isFinite(exactDuration)
        && exactDuration >= POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS;
    const duration = shouldUseExactRow
        ? exactDuration
        : Number.isFinite(activeDuration) && activeDuration > 0
        ? activeDuration
        : Number.isFinite(exactDuration) && exactDuration > 0
        ? exactDuration
        : Math.max(0, rangeEnd - rangeStart);
    const row = shouldUseExactRow ? { ...sourceExactRow } : {
        ...primaryActivity,
        start: rangeStart,
        end: rangeEnd,
        duration,
        activityMix: sourceExactRow?.activityMix || emptyActivityMix(),
        sources: []
    };

    return {
        ...row,
        app: row.app || primaryActivity.app || '',
        title: getActivityDisplayTitle(row) || getActivityDisplayTitle(primaryActivity),
        url: row.url || primaryActivity.url || '',
        appPath: row.appPath || primaryActivity.appPath || '',
        bundleId: row.bundleId || primaryActivity.bundleId || '',
        start: Number.isFinite(row.start) ? row.start : rangeStart,
        end: Number.isFinite(row.end) ? row.end : rangeEnd,
        duration,
        activityMix: row.activityMix || emptyActivityMix(),
        popupPrimarySummary: true,
        popupDisplayZoom: zoom
    };
}

function buildActivityPopupDisplayModel({
    overlaps,
    rangeStart,
    rangeEnd,
    primaryActivity,
    activeDurationMs,
    zoom = state.zoom
} = {}) {
    const exactRows = summarizePopupActivityOverlaps(overlaps || [], rangeStart, rangeEnd);
    const topLevelRows = buildTopLevelPopupDisplayRows(exactRows, rangeStart, rangeEnd, primaryActivity || {});
    const fallbackPrimaryRow = buildPrimaryPopupDisplayRow(
        primaryActivity || {},
        exactRows,
        rangeStart,
        rangeEnd,
        activeDurationMs,
        zoom
    );
    const primaryActivityExactKey = getPopupActivityExactGroupingKey(primaryActivity || {});
    const primaryActivityContextKey = getActivityPopupContextKey(primaryActivity || {});
    const isGenericPrimary = isGenericPopupPrimaryActivity(primaryActivity || {});
    const primaryRow = (isGenericPrimary ? getBestMeaningfulPopupPrimaryRow(topLevelRows) : null)
        || (!isGenericPrimary
            ? topLevelRows.find(row => row.popupSessionSummary && row.popupContextKey === primaryActivityContextKey)
                || topLevelRows.find(row => row.popupContextSummary && getActivityPopupContextKey(row) === primaryActivityContextKey)
                || topLevelRows.find(row => getPopupActivityExactGroupingKey(row) === primaryActivityExactKey)
            : null)
        || (topLevelRows.length === 1 ? topLevelRows[0] : null)
        || (isGenericPrimary ? topLevelRows[0] : null)
        || fallbackPrimaryRow;
    const secondaryRows = topLevelRows.filter(row => row !== primaryRow)
        .sort((left, right) => {
            const startA = Number.isFinite(left.start) ? left.start : Number.MAX_SAFE_INTEGER;
            const startB = Number.isFinite(right.start) ? right.start : Number.MAX_SAFE_INTEGER;
            if (startA !== startB) return startA - startB;
            return right.duration - left.duration;
        });
    const visibleRows = [primaryRow, ...secondaryRows];

    return {
        exactRows,
        primaryRow,
        secondaryRows,
        visibleRows,
        assignmentRows: visibleRows,
        isMultiple: secondaryRows.length > 0
    };
}

function getInlineBadgePopupRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(row => {
        const duration = Number(row?.duration);
        return Number.isFinite(duration) && duration >= POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS;
    });
}

function buildActivityBlockPopupDisplayModel(blockEl) {
    const { start: startMs, end: endMs } = getActivityBlockTimeRange(blockEl);
    return buildActivityPopupDisplayModel({
        overlaps: getActivityBlockDetailOverlaps(blockEl),
        rangeStart: startMs,
        rangeEnd: endMs,
        primaryActivity: getActivityBlockData(blockEl),
        activeDurationMs: Number(blockEl?.dataset?.activeDurationMs),
        zoom: state.zoom
    });
}

function getSelectedActivityScopeStore() {
    if (!(state.selectedActivityScopes instanceof Map)) {
        state.selectedActivityScopes = new Map();
    }
    return state.selectedActivityScopes;
}

function normalizeSelectedActivityScope(scope = {}, assignmentKeys = null) {
    const normalizedAssignmentKeys = Array.isArray(assignmentKeys)
        ? assignmentKeys
        : Array.isArray(scope.assignmentKeys)
        ? scope.assignmentKeys
        : [];
    const normalizedMatchKeys = Array.isArray(scope.matchKeys) ? scope.matchKeys : [];
    const mode = scope.mode ? normalizeSimilarActivityMatchMode(scope.mode) : '';
    return {
        mode,
        matchKeys: Array.from(new Set(normalizedMatchKeys.filter(Boolean))),
        assignmentKeys: Array.from(new Set(normalizedAssignmentKeys.filter(Boolean)))
    };
}

function getStoredSelectedActivityScope(selectionId) {
    if (selectionId === null || selectionId === undefined) return null;
    const scope = getSelectedActivityScopeStore().get(selectionId);
    if (!scope) return null;
    const normalizedScope = normalizeSelectedActivityScope(scope);
    if (!normalizedScope.mode && normalizedScope.assignmentKeys.length === 0 && normalizedScope.matchKeys.length === 0) {
        return null;
    }
    return normalizedScope;
}

function selectedActivityScopeAttributes(scope) {
    if (!scope) return '';
    const attributes = [];
    if (scope.assignmentKeys.length > 0) {
        attributes.push(`data-selected-similarity-keys="${escapeAttribute(encodeURIComponent(JSON.stringify(scope.assignmentKeys)))}"`);
    }
    if (scope.mode && scope.matchKeys.length > 0) {
        attributes.push(`data-selected-similarity-mode="${escapeAttribute(scope.mode)}"`);
        attributes.push(`data-selected-similarity-match-keys="${escapeAttribute(encodeURIComponent(JSON.stringify(scope.matchKeys)))}"`);
    }
    return attributes.join('\n             ');
}

// Generate the HTML for an individual activity block in Activity Stream
function createActivityBlockHTML(block, rowLayout = null) {
    const app = normalizeActivityText(block.app);
    const title = normalizeActivityText(block.title);
    const url = normalizeActivityText(block.url);
    const appPath = normalizeActivityText(block.appPath);
    const bundleId = normalizeActivityText(block.bundleId);
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    const layout = rowLayout || buildFullDayTimelineRowLayout(dateStartOfDay, state.zoom);
    const isSessionBlock = Number.isFinite(block.activeDurationMs)
        && Number.isFinite(block.start)
        && Number.isFinite(block.end)
        && block.end > block.start;
    const fallbackStartCell = Number.isFinite(block.startCell) ? block.startCell : 0;
    const fallbackSpan = Math.max(1, Number.isFinite(block.span) ? block.span : 1);
    const fallbackStart = dateStartOfDay + fallbackStartCell * state.zoom * 60 * 1000;
    const fallbackEnd = fallbackStart + fallbackSpan * state.zoom * 60 * 1000;
    const blockStart = isSessionBlock ? block.start : fallbackStart;
    const blockEnd = isSessionBlock ? block.end : fallbackEnd;
    const sourceRange = getTimelineDisplayRowRange(blockStart, blockEnd, dateStartOfDay, state.zoom);
    const startCell = isSessionBlock ? sourceRange.startRow : fallbackStartCell;
    const span = isSessionBlock ? Math.max(1, sourceRange.endRow - sourceRange.startRow) : fallbackSpan;
    const rawPrimaryActivity = { app, title, url, appPath, bundleId };
    const blockOverlaps = block.overlaps || [];
    const uniqueOverlaps = summarizeActivityOverlaps(blockOverlaps, blockStart, blockEnd);
    const overlapsData = encodeURIComponent(JSON.stringify(uniqueOverlaps));
    const popupDisplayModel = buildActivityPopupDisplayModel({
        overlaps: uniqueOverlaps,
        rangeStart: blockStart,
        rangeEnd: blockEnd,
        primaryActivity: rawPrimaryActivity,
        activeDurationMs: block.activeDurationMs,
        zoom: state.zoom
    });
    const displayActivity = getTimelineBlockDisplayActivity(rawPrimaryActivity, popupDisplayModel);
    const displayLabels = getPopupActivityDisplayLabels(displayActivity);
    const displayApp = normalizeActivityText(displayActivity.app || app);
    const displayTitleSource = normalizeActivityText(displayActivity.title || displayLabels.primary || title);
    const displayUrl = normalizeActivityText(displayActivity.url || displayLabels.externalUrl || url);
    const displayAppPath = normalizeActivityText(displayActivity.appPath || appPath);
    const displayBundleId = normalizeActivityText(displayActivity.bundleId || bundleId);
    const displaySubtitle = normalizeActivityText(displayLabels.secondary || displayApp || app);
    const displaySessionKey = getActivityStreamSessionKey(displayActivity) || block.similarityKey || block.summaryKey || '';
    const selectionId = isSessionBlock
        ? `activity:${blockStart}:${blockEnd}:${displaySessionKey}`
        : startCell;

    const isSelected = state.selectedActivities.has(selectionId);
    const selectedClass = isSelected ? 'selected' : '';
    const selectedScope = isSelected ? getStoredSelectedActivityScope(selectionId) : null;
    const selectedScopeAttributes = selectedActivityScopeAttributes(selectedScope);

    const displayRange = getDisplayRowRangeForSourceRange(layout, startCell, startCell + span);
    const exactGeometry = isSessionBlock
        ? getTimelineExactDisplayRangeGeometry(blockStart, blockEnd, dateStartOfDay, state.zoom, layout)
        : null;
    const displayStartRow = displayRange.startRow;
    const displayRowSpan = Math.max(1, displayRange.rowSpan);
    const naturalHeightPx = exactGeometry ? exactGeometry.height : (displayRowSpan * 40 - 3);
    const compactClass = naturalHeightPx < 24 ? ' activity-block--compact' : '';
    const blockStyle = exactGeometry
        ? `top: ${formatCssNumber(exactGeometry.top)}px; height: ${formatCssNumber(exactGeometry.height)}px;`
        : `top: calc(var(--row-height) * ${displayStartRow} + 2px); height: calc(var(--row-height) * ${displayRowSpan} - 3px);`;
    const displayTitleActivity = {
        ...displayActivity,
        app: displayApp,
        title: displayTitleSource,
        url: displayUrl,
        appPath: displayAppPath,
        bundleId: displayBundleId
    };
    const displayTitle = getMeaningfulActivityDisplayTitle(displayTitleActivity)
        || getActivityDisplayTitle(displayTitleActivity)
        || normalizeActivityText(displayLabels.primary).trim()
        || displayApp
        || 'Recorded Activity';
    const visibleSecondaryOverlaps = getInlineBadgePopupRows(popupDisplayModel.secondaryRows);
    const inlineIconOverlaps = visibleSecondaryOverlaps.slice(0, 2);
    const hiddenInlineIconCount = Math.max(0, visibleSecondaryOverlaps.length - inlineIconOverlaps.length);

    const iconHTML = getActivityIconHTML(displayApp, displayUrl, displayTitleSource, displayAppPath, displayBundleId);

    const fallbackDurationMs = blockEnd - blockStart;
    const actualDurationMs = getActivityDurationTotalMs(uniqueOverlaps) || fallbackDurationMs;
    const isMultipleActivityBlock = popupDisplayModel.isMultiple || uniqueOverlaps.length > 1;
    const displayDurationMs = Number.isFinite(block.activeDurationMs) && block.activeDurationMs > 0
        ? block.activeDurationMs
        : isMultipleActivityBlock
        ? (getBreakdownDisplayDurationMs(popupDisplayModel.visibleRows, uniqueOverlaps) || actualDurationMs)
        : actualDurationMs;
    const durationStr = formatActivityDurationLabel(displayDurationMs, isMultipleActivityBlock ? 0 : 1);
    const blockActivityMix = popupDisplayModel.visibleRows.reduce((mix, overlap) => {
        return addTimelineActivityMix(mix, overlap.activityMix || emptyActivityMix());
    }, emptyActivityMix());
    const durationPillClass = activityMixPillClass(blockActivityMix, 'shrink-0');
    const durationPillAttributes = activityMixPillAttributes(blockActivityMix);
    const overlapKey = isSessionBlock
        ? registerActivityBlockDetailOverlaps(layout, uniqueOverlaps)
        : null;
    const overlapDataAttribute = overlapKey
        ? `data-overlap-key="${escapeAttribute(overlapKey)}"`
        : `data-overlaps="${overlapsData}"`;

    return `
        <div class="activity-block${compactClass} ${selectedClass}"
             style="${blockStyle}"
             data-start-cell="${startCell}"
             data-span="${span}"
             data-start-ms="${blockStart}"
             data-end-ms="${blockEnd}"
             data-active-duration-ms="${Number.isFinite(block.activeDurationMs) ? block.activeDurationMs : displayDurationMs}"
             data-elapsed-duration-ms="${blockEnd - blockStart}"
             data-exact-geometry="${isSessionBlock ? 'true' : 'false'}"
             data-fragment-count="${Array.isArray(block.sources) ? block.sources.length : 1}"
             data-interruption-count="${Number.isFinite(block.interruptionCount) ? block.interruptionCount : 0}"
             data-session-key="${escapeAttribute(displaySessionKey)}"
             data-app="${escapeAttribute(displayApp)}"
             data-title="${escapeAttribute(displayTitleSource)}"
             data-url="${escapeAttribute(displayUrl)}"
             data-app-path="${escapeAttribute(displayAppPath)}"
             data-bundle-id="${escapeAttribute(displayBundleId)}"
             ${selectedScopeAttributes}
             ${overlapDataAttribute}>
            <div class="activity-checkbox activity-block__checkbox ${isSelected ? 'is-selected' : ''}">
                <i class="${isSelected ? 'ph-fill ph-check-square' : 'ph ph-square'} text-base"></i>
            </div>
            <div class="activity-block__icon">
                ${iconHTML}
            </div>
            <div class="activity-block__content">
                <span class="activity-block__title">${displayTitle}</span>
                <span class="activity-block__subtitle">${escapeTimelineText(displaySubtitle)}</span>
            </div>
            <div class="activity-block__actions">
                ${visibleSecondaryOverlaps.length > 0 ? `
                    <div class="activity-block__secondary-icons">
                        ${inlineIconOverlaps.map(o => {
                            return `<div class="activity-block__secondary-icon">${getActivityIconHTML(o.app, o.url, o.title, o.appPath, o.bundleId)}</div>`;
                        }).join('')}
                        ${hiddenInlineIconCount > 0 ? `
                            <div class="duration-pill activity-block__overflow-pill">
                                +${hiddenInlineIconCount}
                            </div>
                        ` : ''}
                    </div>
                ` : ''}
                <div class="${durationPillClass}"${durationPillAttributes}>
                    ${durationStr}
                </div>
                <button class="activity-quick-add activity-block__quick-add" title="Assign to Project">
                    <i class="ph ph-plus-circle text-lg"></i>
                </button>
            </div>
        </div>
    `;
}

// Binds visual event handlers to Activity Stream blocks
function attachMemoryAidInteractions() {
    const itemsMem = DOM.elItemsMemoryAid;
    if (!itemsMem) return;

    const blocks = itemsMem.querySelectorAll('.activity-block');
    blocks.forEach(b => {
        const btnQuickAdd = b.querySelector('.activity-quick-add');
        if (btnQuickAdd) {
            btnQuickAdd.addEventListener('click', (e) => {
                e.stopPropagation();
                const { start: startMs, end: endMs } = getActivityBlockTimeRange(b);
                const displayModel = buildActivityBlockPopupDisplayModel(b);
                const assignmentActivities = buildPopupAssignmentActivities(displayModel.assignmentRows, startMs, endMs, {
                    assignmentDisplayStart: startMs,
                    assignmentDisplayEnd: endMs
                });
                openTimeEntryModal(startMs, endMs, '', null, null, false, assignmentActivities);
            });
        }

        b.addEventListener('click', (e) => {
            if (e.target.closest('.activity-quick-add')) return;

            const isCheckbox = e.target.closest('.activity-checkbox');
            const isModifier = e.ctrlKey || e.metaKey || e.shiftKey;

            if (isCheckbox || isModifier) {
                e.stopPropagation();
                toggleActivitySelection(b);
            } else {
                showActivityDetailsPopup(b);
            }
        });

        b.addEventListener('dblclick', (e) => {
            if (e.target.closest('.activity-quick-add') || e.target.closest('.activity-checkbox')) return;
            const { start: startMs, end: endMs } = getActivityBlockTimeRange(b);
            const displayModel = buildActivityBlockPopupDisplayModel(b);
            const assignmentActivities = buildPopupAssignmentActivities(displayModel.assignmentRows, startMs, endMs, {
                assignmentDisplayStart: startMs,
                assignmentDisplayEnd: endMs
            });
            openTimeEntryModal(startMs, endMs, '', null, null, false, assignmentActivities);
        });
    });
}

function parseActivityBlockEncodedList(blockEl, datasetKey) {
    const rawValue = blockEl?.dataset?.[datasetKey];
    if (!rawValue) return [];

    try {
        const parsed = JSON.parse(decodeURIComponent(rawValue));
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
        try {
            const parsed = JSON.parse(rawValue);
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch {
            return [];
        }
    }
}

function parseActivityBlockSelectedSimilarityKeys(blockEl) {
    return parseActivityBlockEncodedList(blockEl, 'selectedSimilarityKeys');
}

function getActivityBlockSelectedSimilarityKeys(blockEl) {
    return parseActivityBlockSelectedSimilarityKeys(blockEl);
}

function getActivityBlockSelectedSimilarityMode(blockEl) {
    const mode = blockEl?.dataset?.selectedSimilarityMode || '';
    return mode ? normalizeSimilarActivityMatchMode(mode) : '';
}

function getActivityBlockSelectedSimilarityMatchKeys(blockEl) {
    return parseActivityBlockEncodedList(blockEl, 'selectedSimilarityMatchKeys');
}

function getActivityBlockSelectedSimilarityScope(blockEl) {
    const storedScope = getStoredSelectedActivityScope(getActivityBlockSelectionId(blockEl));
    const datasetScope = {
        mode: getActivityBlockSelectedSimilarityMode(blockEl),
        matchKeys: getActivityBlockSelectedSimilarityMatchKeys(blockEl),
        assignmentKeys: getActivityBlockSelectedSimilarityKeys(blockEl)
    };
    if (
        datasetScope.mode
        || datasetScope.matchKeys.length > 0
        || datasetScope.assignmentKeys.length > 0
    ) {
        return datasetScope;
    }
    return storedScope || datasetScope;
}

function getActivityBlockSelectionKeys(blockEl) {
    const storedKeys = parseActivityBlockSelectedSimilarityKeys(blockEl);
    if (storedKeys.length > 0) return storedKeys;

    const storedScope = getStoredSelectedActivityScope(getActivityBlockSelectionId(blockEl));
    if (storedScope?.assignmentKeys?.length > 0) return storedScope.assignmentKeys;

    const primaryKey = getActivitySimilarityKey(getActivityBlockData(blockEl));
    return primaryKey ? [primaryKey] : [];
}

function getActivityBlockSelectionId(blockEl) {
    const startCell = parseInt(blockEl?.dataset?.startCell, 10);
    const exactStart = Number(blockEl?.dataset?.startMs);
    const exactEnd = Number(blockEl?.dataset?.endMs);
    if (blockEl?.dataset?.exactGeometry === 'true'
        && Number.isFinite(exactStart)
        && Number.isFinite(exactEnd)
        && exactEnd > exactStart) {
        const key = blockEl.dataset.sessionKey || getActivitySimilarityKey(getActivityBlockData(blockEl)) || '';
        return `activity:${exactStart}:${exactEnd}:${key}`;
    }

    return Number.isFinite(startCell) ? startCell : null;
}

function setActivityBlockSelected(blockEl, selected, selectedSimilarityKeys = null, selectedSimilarityScope = null) {
    const selectionId = getActivityBlockSelectionId(blockEl);
    const checkbox = blockEl.querySelector('.activity-checkbox');
    const iconEl = blockEl.querySelector('.activity-checkbox i');

    if (selectionId === null) return;

    if (selected) {
        state.selectedActivities.add(selectionId);
        blockEl.classList.add('selected');
        checkbox?.classList.add('is-selected');
        if (iconEl) iconEl.className = 'ph-fill ph-check-square text-base';
        const normalizedScope = normalizeSelectedActivityScope(selectedSimilarityScope || {}, selectedSimilarityKeys);
        if (normalizedScope.assignmentKeys.length > 0 || normalizedScope.mode || normalizedScope.matchKeys.length > 0) {
            getSelectedActivityScopeStore().set(selectionId, normalizedScope);
        } else {
            getSelectedActivityScopeStore().delete(selectionId);
        }
        if (normalizedScope.assignmentKeys.length > 0) {
            const uniqueKeys = normalizedScope.assignmentKeys;
            blockEl.dataset.selectedSimilarityKeys = encodeURIComponent(JSON.stringify(uniqueKeys));
        } else {
            delete blockEl.dataset.selectedSimilarityKeys;
        }
        const mode = normalizedScope.mode;
        const matchKeys = normalizedScope.matchKeys;
        if (mode && matchKeys.length > 0) {
            blockEl.dataset.selectedSimilarityMode = mode;
            blockEl.dataset.selectedSimilarityMatchKeys = encodeURIComponent(JSON.stringify(matchKeys));
        } else {
            delete blockEl.dataset.selectedSimilarityMode;
            delete blockEl.dataset.selectedSimilarityMatchKeys;
        }
    } else {
        state.selectedActivities.delete(selectionId);
        getSelectedActivityScopeStore().delete(selectionId);
        blockEl.classList.remove('selected');
        checkbox?.classList.remove('is-selected');
        if (iconEl) iconEl.className = 'ph ph-square text-base';
        delete blockEl.dataset.selectedSimilarityKeys;
        delete blockEl.dataset.selectedSimilarityMode;
        delete blockEl.dataset.selectedSimilarityMatchKeys;
    }
}

function getPopupActivitySelectionKey(activity) {
    if (activity?.popupSourceChild) {
        return getActivitySourceKey(activity) || `${getActivitySummaryKey(activity)}|||${activity.start || ''}|||${activity.end || ''}`;
    }
    return getActivitySimilarityKey(activity) || getActivitySummaryKey(activity);
}

function getPopupActivitySelectionKeys(activity) {
    const keys = [];
    const addKey = key => {
        if (key && !keys.includes(key)) keys.push(key);
    };
    const addActivityKeys = nextActivity => {
        if (!nextActivity) return;
        getActivitySelectionIdentityKeys(nextActivity).forEach(addKey);
    };

    addActivityKeys(activity);
    getPopupRowSources(activity).forEach(addActivityKeys);
    if (Array.isArray(activity?.children)) {
        activity.children.forEach(child => {
            addActivityKeys(child);
            getPopupRowSources(child).forEach(addActivityKeys);
        });
    }

    return keys;
}

function popupActivityMatchesSelectionKeys(activity, selectedKeys) {
    if (!selectedKeys || selectedKeys.size === 0) return false;
    return getPopupActivitySelectionKeys(activity).some(key => selectedKeys.has(key));
}

function isNativeActivity(activity) {
    return !getActivitySummaryHostname(activity)
        && Boolean(normalizeActivityText(activity?.bundleId || activity?.appPath || activity?.app).trim());
}

function isWeakNativeActivity(activity) {
    return isNativeActivity(activity)
        && isWeakPopupActivityTitle(getActivityDisplayTitle(activity), activity);
}

function getDominantNonWeakNativeActivitySource(activity) {
    if (!isWeakNativeActivity(activity)) return null;

    const dominantSource = getDominantPopupActivitySource(activity);
    if (!dominantSource?.source || !dominantSource.title) return null;

    return dominantSource;
}

function getPopupAssignmentActivity(activity) {
    const dominantSource = getDominantNonWeakNativeActivitySource(activity);
    if (!dominantSource) return activity;

    const source = dominantSource.source;
    return {
        ...activity,
        app: source.app || activity.app,
        title: dominantSource.title,
        url: source.url || activity.url || '',
        appPath: source.appPath || activity.appPath || '',
        bundleId: source.bundleId || activity.bundleId || ''
    };
}

function getPopupContextSourceDuration(source) {
    const assignedDuration = Number(source?.assignedDurationMs);
    if (Number.isFinite(assignedDuration) && assignedDuration > 0) {
        return assignedDuration;
    }

    const duration = Number(source?.duration);
    if (Number.isFinite(duration) && duration > 0) {
        return duration;
    }

    return getActivitySourceDuration(source);
}

function buildPopupContextSourceActivity(source) {
    const duration = getPopupContextSourceDuration(source);
    const start = Number.isFinite(source?.start) ? source.start : undefined;
    const end = Number.isFinite(source?.end) ? source.end : undefined;

    return {
        ...stripActivitySources(source),
        title: getActivityDisplayTitle(source),
        appPath: source?.appPath || '',
        bundleId: source?.bundleId || '',
        start,
        end,
        duration,
        assignedDurationMs: duration,
        assignmentStart: start,
        assignmentEnd: end,
        assignmentSource: 'activity-stream',
        assignmentModel: ACTIVITY_STREAM_SUMMARY_ASSIGNMENT_MODEL,
        assignmentDisplayZoom: Number.isFinite(state?.zoom) ? state.zoom : undefined
    };
}

function getPopupModalAggregateGroupKey(activity) {
    return getActivitySimilarityKeyForMode(activity, 'app-title') || getActivitySummaryKey(activity) || '';
}

function applyPopupModalAggregation(activity) {
    const aggregateKey = getPopupModalAggregateGroupKey(activity);
    if (!aggregateKey) return activity;
    return {
        ...activity,
        modalAggregateGroupKey: aggregateKey
    };
}

function popupActivityMatchesAssignmentKeys(activity, selectedKeys) {
    if (!selectedKeys || selectedKeys.size === 0) return false;
    return getActivityAssignmentKeys(activity).some(key => selectedKeys.has(key));
}

function getScopedPopupAssignmentSources(activity, selectedKeys) {
    if (!selectedKeys || selectedKeys.size === 0) return [];

    const sources = [];
    const seen = new Set();
    const addSource = source => {
        if (!source || !popupActivityMatchesAssignmentKeys(source, selectedKeys)) return;
        const key = getActivitySourceKey(source) || getActivitySummaryKey(source);
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        sources.push(source);
    };

    getPopupRowSources(activity).forEach(addSource);
    if (Array.isArray(activity?.children)) {
        activity.children.forEach(child => {
            getPopupRowSources(child).forEach(addSource);
        });
    }

    return sources;
}

function expandPopupActivitiesForScopedAssignment(activities, selectedKeys) {
    if (!selectedKeys || selectedKeys.size === 0) return Array.isArray(activities) ? activities : [];

    const scopedActivities = [];
    for (const activity of Array.isArray(activities) ? activities : []) {
        scopedActivities.push(...getScopedPopupAssignmentSources(activity, selectedKeys));
    }

    return scopedActivities;
}

function buildPopupContextAssignmentActivity(activity) {
    const sources = getPopupRowSources(activity)
        .map(buildPopupContextSourceActivity)
        .filter(source => Number.isFinite(source.duration) && source.duration > 0);
    const duration = sources.reduce((total, source) => total + source.duration, 0);
    if (duration <= 0) return null;

    const start = sources.reduce((value, source) => Number.isFinite(source.start) ? Math.min(value, source.start) : value, Number.MAX_SAFE_INTEGER);
    const end = sources.reduce((value, source) => Number.isFinite(source.end) ? Math.max(value, source.end) : value, 0);
    const { children, ...baseActivity } = stripActivitySources(activity);

    return {
        ...baseActivity,
        title: getActivityDisplayTitle(activity),
        appPath: activity?.appPath || '',
        bundleId: activity?.bundleId || '',
        start: start === Number.MAX_SAFE_INTEGER ? activity.start : start,
        end: end > 0 ? end : activity.end,
        duration,
        assignedDurationMs: duration,
        assignmentStart: start === Number.MAX_SAFE_INTEGER ? activity.start : start,
        assignmentEnd: end > 0 ? end : activity.end,
        assignmentSource: 'activity-stream',
        assignmentModel: ACTIVITY_STREAM_SUMMARY_ASSIGNMENT_MODEL,
        assignmentDisplayZoom: Number.isFinite(state?.zoom) ? state.zoom : undefined,
        sources,
        modalSourceActivities: sources,
        modalAggregateGroupKey: getPopupModalAggregateGroupKey(activity)
    };
}

function buildPopupAssignmentActivities(activities, startMs, endMs, options = {}) {
    const assignmentActivities = [];
    const selectedKeys = options?.selectedKeys instanceof Set
        ? options.selectedKeys
        : new Set(Array.isArray(options?.selectedKeys) ? options.selectedKeys.filter(Boolean) : []);
    const sourceActivities = selectedKeys.size > 0
        ? expandPopupActivitiesForScopedAssignment(activities, selectedKeys)
        : (Array.isArray(activities) ? activities : []);

    for (const activity of sourceActivities) {
        const assignmentInput = getPopupAssignmentActivity(activity);
        if (assignmentInput?.popupContextSummary) {
            const contextAssignment = buildPopupContextAssignmentActivity(assignmentInput);
            if (contextAssignment) {
                const displayAssignment = Number.isFinite(options?.assignmentDisplayStart)
                    && Number.isFinite(options?.assignmentDisplayEnd)
                    && options.assignmentDisplayEnd > options.assignmentDisplayStart
                    ? applyActivityStreamAssignmentDisplayMetadata(
                        contextAssignment,
                        options.assignmentDisplayStart,
                        options.assignmentDisplayEnd,
                        options.assignmentDisplayGroupKey || ''
                    )
                    : contextAssignment;
                assignmentActivities.push(applyPopupModalAggregation(displayAssignment));
            }
            continue;
        }

        const [summaryAssignment] = buildActivityStreamSummaryAssignmentActivities([assignmentInput], startMs, endMs, state.zoom, {
            assignmentDisplayStart: options?.assignmentDisplayStart,
            assignmentDisplayEnd: options?.assignmentDisplayEnd,
            assignmentDisplayGroupKey: options?.assignmentDisplayGroupKey
        });
        assignmentActivities.push(applyPopupModalAggregation(summaryAssignment || assignmentInput));
    }

    return assignmentActivities.filter(Boolean);
}

function setPopupActivityRowSelected(row, selected) {
    const selectButton = row?.querySelector?.('.popup-activity-select');
    const iconEl = selectButton?.querySelector?.('i');

    row?.classList?.toggle?.('is-selected', selected);
    if (selected) {
        row?.classList?.add?.('is-selected');
        selectButton?.classList?.add?.('is-selected');
        if (iconEl) iconEl.className = 'ph-fill ph-check-square text-base';
    } else {
        row?.classList?.remove?.('is-selected');
        selectButton?.classList?.remove?.('is-selected');
        if (iconEl) iconEl.className = 'ph ph-square text-base';
    }
    selectButton?.setAttribute?.('aria-pressed', String(Boolean(selected)));
}

function syncPopupActivitySelectionRows() {
    const rows = DOM.elPopupMultiListContainer?.querySelectorAll?.('[data-popup-overlap-index]');
    if (!rows) return;

    rows.forEach(row => {
        setPopupActivityRowSelected(row, row?.classList?.contains?.('is-selected'));
    });
}

function togglePopupActivitySelection(row) {
    if (DOM.elPopupMultiListContainer?.dataset) {
        DOM.elPopupMultiListContainer.dataset.popupSelectionDirty = 'true';
    }
    setPopupActivityRowSelected(row, !row?.classList?.contains?.('is-selected'));
}

function getPopupRowDisplayActivity(row, displayOverlaps) {
    const parentIndex = parseInt(row?.dataset?.popupOverlapIndex, 10);
    if (!Number.isFinite(parentIndex)) return null;

    const parentActivity = displayOverlaps[parentIndex];
    const childIndex = parseInt(row?.dataset?.popupChildIndex, 10);
    if (Number.isFinite(childIndex) && Array.isArray(parentActivity?.children)) {
        return parentActivity.children[childIndex] || null;
    }

    return parentActivity || null;
}

function getPopupSelectedSimilarityKeySet() {
    const rawKeys = DOM.elPopupMultiListContainer?.dataset?.selectedSimilarityKeys;
    if (!rawKeys) return new Set();
    try {
        const parsed = JSON.parse(decodeURIComponent(rawKeys));
        return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
    } catch {
        try {
            const parsed = JSON.parse(rawKeys);
            return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
        } catch {
            return new Set();
        }
    }
}

function isPopupSelectionDirty() {
    return DOM.elPopupMultiListContainer?.dataset?.popupSelectionDirty === 'true';
}

function getSelectedPopupAssignmentActivities(displayOverlaps, fallbackOverlaps = displayOverlaps) {
    const rows = DOM.elPopupMultiListContainer?.querySelectorAll?.('[data-popup-overlap-index]');
    if (!rows) return fallbackOverlaps;

    const scopedKeys = getPopupSelectedSimilarityKeySet();
    const hasScopedSelection = scopedKeys.size > 0;
    const selectionDirty = isPopupSelectionDirty();
    const selectedActivities = [];
    rows.forEach(row => {
        if (!row?.classList?.contains?.('is-selected')) return;

        const activity = getPopupRowDisplayActivity(row, displayOverlaps);
        if (activity) selectedActivities.push(activity);
    });

    if (selectedActivities.length > 0) return selectedActivities;
    if (hasScopedSelection || selectionDirty) return [];

    return displayOverlaps.length > 0 ? displayOverlaps : fallbackOverlaps;
}

function assignPopupActivity(activity, startMs, endMs) {
    dismissActivityDetailsPopup();
    openTimeEntryModal(startMs, endMs, '', null, null, false, buildPopupAssignmentActivities([activity], startMs, endMs, {
        assignmentDisplayStart: startMs,
        assignmentDisplayEnd: endMs
    }));
}

function setPopupActivityChildrenExpanded(parentIndex, expanded, expandButton = null) {
    const childRows = DOM.elPopupMultiListContainer?.querySelectorAll?.(`[data-popup-child-parent-index="${parentIndex}"]`);
    childRows?.forEach?.(row => {
        row.classList?.toggle?.('hidden', !expanded);
    });
    const childGroups = DOM.elPopupMultiListContainer?.querySelectorAll?.(`[data-popup-child-group-index="${parentIndex}"]`);
    childGroups?.forEach?.(group => {
        group.classList?.toggle?.('hidden', !expanded);
    });

    expandButton?.setAttribute?.('aria-expanded', String(Boolean(expanded)));
    const icon = expandButton?.querySelector?.('i');
    if (icon) {
        icon.className = expanded ? 'ph ph-caret-down text-[13px]' : 'ph ph-caret-right text-[13px]';
    }
}

function bindActivityPopupBreakdownControls(blockEl, displayOverlaps, startMs, endMs) {
    const rows = DOM.elPopupMultiListContainer?.querySelectorAll?.('[data-popup-overlap-index]');
    if (!rows) return;

    rows.forEach(row => {
        const activity = getPopupRowDisplayActivity(row, displayOverlaps);
        if (!activity) return;

        const key = getPopupActivitySelectionKey(activity);
        if (key) row.dataset.popupSimilarityKey = key;

        row.querySelector?.('.popup-activity-expand')?.addEventListener('click', event => {
            event.stopPropagation();
            event.preventDefault?.();
            const parentIndex = parseInt(row.dataset?.popupOverlapIndex, 10);
            if (!Number.isFinite(parentIndex)) return;
            const expanded = row.querySelector?.('.popup-activity-expand')?.getAttribute?.('aria-expanded') === 'true';
            setPopupActivityChildrenExpanded(parentIndex, !expanded, row.querySelector?.('.popup-activity-expand'));
        });

        row.querySelector?.('.popup-activity-select')?.addEventListener('click', event => {
            event.stopPropagation();
            togglePopupActivitySelection(row);
        });

        row.querySelector?.('.popup-activity-quick-add')?.addEventListener('click', event => {
            event.stopPropagation();
            assignPopupActivity(activity, startMs, endMs);
        });
    });

    syncPopupActivitySelectionRows();
}

// Selects or deselects an activity block for bulk actions
function toggleActivitySelection(blockEl) {
    const selectionId = getActivityBlockSelectionId(blockEl);
    setActivityBlockSelected(blockEl, !state.selectedActivities.has(selectionId));
    updateMultiSelectBar();
}

function clearActivitySelection() {
    state.selectedActivities.clear();
    getSelectedActivityScopeStore().clear();
    DOM.elItemsMemoryAid?.querySelectorAll('.activity-block.selected').forEach(el => {
        setActivityBlockSelected(el, false);
    });
    updateMultiSelectBar();
}

function getSelectedSimilarActivityMode() {
    const radios = [
        DOM.elSimilarModeHost,
        DOM.elSimilarModeUrl,
        DOM.elSimilarModeApp,
        DOM.elSimilarModeAppTitle
    ].filter(Boolean);
    const selectedRadio = radios.find(radio => radio.checked && !radio.disabled);
    return normalizeSimilarActivityMatchMode(selectedRadio?.value || 'host');
}

function closeSimilarSelectionModal() {
    DOM.elSimilarModal?.classList?.add('hidden');
}

function bindSimilarSelectionModal() {
    const modal = DOM.elSimilarModal;
    if (!modal || modal.__orielSimilarModalBound) return;

    modal.__orielSimilarModalBound = true;
    DOM.elSimilarModalBtnClose?.addEventListener?.('click', closeSimilarSelectionModal);
    DOM.elSimilarModalBtnCancel?.addEventListener?.('click', closeSimilarSelectionModal);
    DOM.elSimilarModalBtnApply?.addEventListener?.('click', () => {
        selectSimilarActivities({ mode: getSelectedSimilarActivityMode() });
        closeSimilarSelectionModal();
    });
}

function openSimilarSelectionModal() {
    const itemsMem = DOM.elItemsMemoryAid;
    const selectedEls = Array.from(itemsMem?.querySelectorAll?.('.activity-block.selected') || []);
    if (selectedEls.length !== 1) return false;

    bindSimilarSelectionModal();
    updateSimilarModeAvailability(getActivityBlockSimilarModeActivity(selectedEls[0]));
    DOM.elSimilarModal?.classList?.remove('hidden');
    DOM.elSimilarModalBtnApply?.focus?.();
    return true;
}

function selectSimilarActivities(options = {}) {
    const itemsMem = DOM.elItemsMemoryAid;
    if (!itemsMem) return 0;

    const selectedEls = Array.from(itemsMem.querySelectorAll('.activity-block.selected'));
    if (!selectedEls.length) return 0;

    const mode = normalizeSimilarActivityMatchMode(options?.mode);
    const selectedKeys = new Set(selectedEls
        .flatMap(el => getActivityBlockSeedSimilarityEntriesForMode(el, mode))
        .map(entry => entry.matchKey)
        .filter(Boolean));

    let selectedCount = 0;
    itemsMem.querySelectorAll('.activity-block').forEach(el => {
        const entries = getActivityBlockSimilarityEntriesForMode(el, mode);
        const matchingEntries = entries
            .filter(entry => selectedKeys.has(entry.matchKey));

        if (matchingEntries.length > 0) {
            const assignmentKeys = matchingEntries.flatMap(entry => entry.assignmentKeys);
            const matchKeys = matchingEntries.map(entry => entry.matchKey).filter(Boolean);
            setActivityBlockSelected(el, true, assignmentKeys, { mode, matchKeys });
            selectedCount++;
        } else {
            setActivityBlockSelected(el, false);
        }
    });

    updateMultiSelectBar();
    return selectedCount;
}

// Shows/hides the floating multi-select bar
function updateMultiSelectBar() {
    const size = state.selectedActivities.size;
    const bar = DOM.elMultiSelectBar;
    const canSelectSimilar = size === 1;
    if (bar) {
        if (size > 0) {
            DOM.elSelectedCount.innerText = size;
            bar.classList.remove('hidden');
        } else {
            bar.classList.add('hidden');
        }
    }

    if (DOM.elBtnSelectSimilar) {
        DOM.elBtnSelectSimilar.disabled = !canSelectSimilar;
        DOM.elBtnSelectSimilar.classList?.toggle?.('hidden', !canSelectSimilar);
        if (canSelectSimilar) {
            DOM.elBtnSelectSimilar.removeAttribute?.('aria-hidden');
        } else {
            DOM.elBtnSelectSimilar.setAttribute?.('aria-hidden', 'true');
            closeSimilarSelectionModal();
        }
    } else if (!canSelectSimilar) {
        closeSimilarSelectionModal();
    }
}

function setElementCssProperty(element, name, value) {
    if (element?.style && typeof element.style.setProperty === 'function') {
        element.style.setProperty(name, value);
        return;
    }

    if (element?.style) {
        element.style[name] = value;
    }
}

function refreshFloatingTimeEntryLabelBlocks() {
    const itemsTime = DOM.elItemsTimeEntries;
    const blocks = itemsTime?.querySelectorAll?.('.time-entry-block') || [];
    floatingTimeEntryLabelBlocks = Array.from(blocks)
        .map(block => ({
            block,
            label: block.querySelector?.('.time-entry-main--floating') || null
        }))
        .filter(item => item.label);
    return floatingTimeEntryLabelBlocks;
}

function scheduleFloatingTimeEntryLabelUpdate() {
    if (floatingTimeEntryLabelFramePending) return;

    floatingTimeEntryLabelFramePending = true;
    const scheduleFrame = typeof window?.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback) => (typeof setTimeout === 'function' ? setTimeout(callback, 0) : callback());
    scheduleFrame(() => {
        floatingTimeEntryLabelFramePending = false;
        updateFloatingTimeEntryLabels();
    });
}

function updateFloatingTimeEntryLabels() {
    const itemsTime = DOM.elItemsTimeEntries;
    const scrollPane = DOM.elTimeEntriesScroll;
    if (!itemsTime || !scrollPane) return;

    const scrollTop = Number(scrollPane.scrollTop) || 0;
    const blocks = floatingTimeEntryLabelBlocks.length > 0
        ? floatingTimeEntryLabelBlocks
        : refreshFloatingTimeEntryLabelBlocks();

    blocks.forEach(({ block, label }) => {
        if (!block || !label) return;

        const blockTop = Number(block.offsetTop) || 0;
        const blockHeight = Number(block.offsetHeight)
            || Number.parseFloat(block.style?.height)
            || 0;
        const labelHeight = Number(label.offsetHeight) || 24;
        const maxOffset = Math.max(
            TIME_ENTRY_FLOATING_LABEL_PADDING_PX,
            blockHeight - labelHeight - TIME_ENTRY_FLOATING_LABEL_PADDING_PX
        );
        const nextOffset = Math.min(
            maxOffset,
            Math.max(TIME_ENTRY_FLOATING_LABEL_PADDING_PX, scrollTop - blockTop + TIME_ENTRY_FLOATING_LABEL_PADDING_PX)
        );

        setElementCssProperty(block, '--time-entry-label-offset', `${Math.round(nextOffset)}px`);
    });
}

function bindFloatingTimeEntryLabelUpdates() {
    const scrollPane = DOM.elTimeEntriesScroll;
    refreshFloatingTimeEntryLabelBlocks();
    if (scrollPane && floatingTimeEntryLabelScrollPane !== scrollPane) {
        scrollPane.addEventListener?.('scroll', scheduleFloatingTimeEntryLabelUpdate, { passive: true });
        floatingTimeEntryLabelScrollPane = scrollPane;
    }

    if (window && !window.__orielFloatingTimeEntryResizeBound) {
        window.addEventListener?.('resize', scheduleFloatingTimeEntryLabelUpdate);
        window.__orielFloatingTimeEntryResizeBound = true;
    }
}

// Renders the Logged Time Entries inside the center timeline panel
function renderLoggedTimeEntries() {
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    let html = '';
    const model = getDayTimelineRenderModel({
        dateStartOfDay,
        zoom: state.zoom
    });
    const renderItems = model.timeEntryRenderItems;
    const rowLayout = model.rowLayout;

    for (const item of renderItems) {
        const entry = item.firstEntry;
        const rangeStart = Number.isFinite(item.displayStart) && Number.isFinite(item.displayEnd) && item.displayEnd > item.displayStart
            ? item.displayStart
            : item.start;
        const rangeEnd = Number.isFinite(item.displayStart) && Number.isFinite(item.displayEnd) && item.displayEnd > item.displayStart
            ? item.displayEnd
            : item.end;
        const geometry = item.renderExactGeometry
            ? getTimelineExactDisplayRangeGeometry(rangeStart, rangeEnd, dateStartOfDay, state.zoom, rowLayout)
            : getTimelineDisplayRangeGeometry(rangeStart, rangeEnd, dateStartOfDay, state.zoom, rowLayout);
        const topPx = Math.max(0, geometry.top);
        const naturalHeightPx = geometry.height;
        const heightPx = item.renderExactGeometry
            ? naturalHeightPx
            : Math.max(37, naturalHeightPx);

        const project = state.projects.find(p => p.id === entry.projectId) || { name: 'Unknown Project', color: '#4b5563' };
        const task = Array.isArray(project.tasks)
            ? project.tasks.find(projectTask => projectTask.id === entry.taskId)
            : null;
        const duration = Math.max(1, Math.round(item.durationMs / (60 * 1000)));
        const sizeClass = naturalHeightPx < 20
            ? 'time-entry-block--tiny'
            : naturalHeightPx < 36
                ? 'time-entry-block--compact'
                : '';
        const assignmentClass = item.isAssignedGroup ? 'time-entry-block--assigned' : '';
        const className = ['time-entry-block', sizeClass, assignmentClass].filter(Boolean).join(' ');
        const floatingLabelClass = naturalHeightPx >= TIME_ENTRY_FLOATING_LABEL_MIN_HEIGHT_PX ? ' time-entry-main--floating' : '';
        const description = (entry.description || '').trim();
        const descriptionHtml = description
            ? `<span class="time-entry-description">${escapeTimelineText(description)}</span>`
            : '';
        const projectSummaryHtml = `
                    <span class="project-marker" style="background-color: ${project.color}"></span>
                    <span class="truncate">${escapeTimelineText(project.name)}</span>
                    ${task ? `<span class="time-entry-task duration-pill shrink-0">${escapeTimelineText(task.name)}</span>` : ''}
        `;
        const mainContentHtml = descriptionHtml || `
                    <span class="time-entry-project-summary">
                        ${projectSummaryHtml}
                    </span>
        `;
        const timeEntryMainHtml = (extraClass = '', inlineStyle = '', ariaHidden = false) => `
                <div class="time-entry-main${extraClass}"${inlineStyle ? ` style="${inlineStyle}"` : ''}${ariaHidden ? ' aria-hidden="true"' : ''}>
                    ${mainContentHtml}
                    <span class="duration-pill time-entry-duration shrink-0">${duration} min</span>
                </div>
        `;
        const projectRowHtml = description
            ? `
                <div class="time-entry-project">
                    ${projectSummaryHtml}
                </div>
            `
            : '';
        const groupIds = [...new Set(item.entries.map(groupEntry => groupEntry.id).filter(Boolean))];
        const groupDataHtml = groupIds.length > 1
            ? `
                 data-group-ids="${encodeURIComponent(JSON.stringify(groupIds))}"
                 data-group-start="${item.start}"
                 data-group-end="${item.end}"`
            : '';
        const laneStyle = getLoggedTimeEntryLaneStyle(item);

        const resizeTopHandleHtml = isCompressedDayTimelineDirectManipulationDisabled()
            ? ''
            : '<div class="resize-handle-top"></div>';
        const resizeBottomHandleHtml = isCompressedDayTimelineDirectManipulationDisabled()
            ? ''
            : '<div class="resize-handle-bottom"></div>';

        html += `
            <div class="${className}"
                 style="top: ${topPx}px; height: ${heightPx}px; --entry-project-color: ${project.color};${laneStyle}"
                 data-id="${entry.id}"${groupDataHtml}>
                ${resizeTopHandleHtml}
                ${timeEntryMainHtml(floatingLabelClass)}
                ${projectRowHtml}
                ${resizeBottomHandleHtml}
            </div>
        `;
    }

    const itemsTime = DOM.elItemsTimeEntries;
    if (itemsTime) {
        itemsTime.innerHTML = html;
        attachTimeEntriesInteractions();
        bindFloatingTimeEntryLabelUpdates();
        updateFloatingTimeEntryLabels();
    }
}

function showTimeEntryHoverPreview(cellIndex) {
    const itemsTime = DOM.elItemsTimeEntries;
    if (!itemsTime) return;
    if (isCompressedDayTimelineDirectManipulationDisabled()) {
        hideTimeEntryHoverPreview();
        return;
    }

    let preview = itemsTime.querySelector('.time-entry-hover-preview');
    if (!preview) {
        preview = document.createElement('div');
        preview.className = 'time-entry-hover-preview';
        itemsTime.appendChild(preview);
    }

    const sourceCell = Math.max(0, Math.floor(Number(cellIndex) || 0));
    const top = `${sourceCell * 40 + 2}px`;
    const previewDataset = preview.dataset || (preview.dataset = {});
    if (previewDataset.sourceCell === String(sourceCell) && preview.style.top === top) {
        return;
    }

    previewDataset.sourceCell = String(sourceCell);
    preview.style.top = top;
    preview.style.height = '37px';
    preview.innerHTML = `
        <span class="time-entry-hover-label">Click &amp; drag to log</span>
    `;
}

function hideTimeEntryHoverPreview() {
    const itemsTime = DOM.elItemsTimeEntries;
    if (!itemsTime) return;

    const preview = itemsTime.querySelector('.time-entry-hover-preview');
    if (preview) {
        preview.remove();
    }
}

function getTimeEntryGroupIds(blockEl) {
    if (!blockEl?.dataset?.groupIds) return [];
    try {
        const ids = JSON.parse(decodeURIComponent(blockEl.dataset.groupIds));
        return Array.isArray(ids) ? ids.filter(Boolean) : [];
    } catch {
        return [];
    }
}

function getGroupedTimeEntryActivities(entries) {
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    const activities = entries.flatMap(entry => {
        const assignmentActivities = getActivityStreamAssignmentActivities(entry);
        const hasOnlySummaryAssignments = assignmentActivities.length > 0
            && assignmentActivities.every(activity => isActivityStreamSummaryAssignment(activity));

        if (hasOnlySummaryAssignments) {
            return Array.isArray(entry.activities) ? entry.activities : [];
        }

        return buildActivityStreamRenderEntries(entry, dateStartOfDay)
            .flatMap(renderEntry => Array.isArray(renderEntry.activities) ? renderEntry.activities : []);
    });
    return summarizeSimilarActivityOverlaps(activities);
}

function openTimeEntryBlockEditor(blockEl, sourceEntries = state.timeEntries) {
    const groupIds = getTimeEntryGroupIds(blockEl);
    const entries = Array.isArray(sourceEntries) ? sourceEntries : [];
    const groupEntries = groupIds
        .map(id => entries.find(ent => ent.id === id))
        .filter(Boolean);
    if (groupEntries.length > 1) {
        const [firstEntry] = groupEntries;
        const groupStart = Number(blockEl.dataset.groupStart);
        const groupEnd = Number(blockEl.dataset.groupEnd);
        window.editingTimeEntryId = firstEntry.id;
        window.editingTimeEntryGroupIds = groupEntries.map(entry => entry.id);
        openTimeEntryModal(
            Number.isFinite(groupStart) ? groupStart : Math.min(...groupEntries.map(entry => entry.start)),
            Number.isFinite(groupEnd) ? groupEnd : Math.max(...groupEntries.map(entry => entry.end)),
            firstEntry.description,
            firstEntry.projectId,
            firstEntry.billable,
            false,
            getGroupedTimeEntryActivities(groupEntries),
            firstEntry.taskId || ''
        );
        return true;
    }

    const entryId = blockEl.dataset.id;
    const entry = entries.find(ent => ent.id === entryId);
    if (!entry) return false;

    window.editingTimeEntryId = entry.id;
    window.editingTimeEntryGroupIds = null;
    openTimeEntryModal(entry.start, entry.end, entry.description, entry.projectId, entry.billable, false, null, entry.taskId || '');
    return true;
}

// Binds resizing handles and mouse interaction listeners to time entry blocks
function attachTimeEntriesInteractions() {
    const itemsTime = DOM.elItemsTimeEntries;
    if (!itemsTime) return;

    const blocks = itemsTime.querySelectorAll('.time-entry-block');
    blocks.forEach(b => {
        b.addEventListener('mousedown', (e) => {
            if (e.target.closest('.resize-handle-top') || e.target.closest('.resize-handle-bottom')) return;
            e.preventDefault();
        });

        b.addEventListener('click', (e) => {
            if (e.target.closest('.resize-handle-top') || e.target.closest('.resize-handle-bottom')) return;
            e.stopPropagation();
            if (window.suppressNextTimeEntryClick) {
                window.suppressNextTimeEntryClick = false;
                return;
            }
            openTimeEntryBlockEditor(b);
        });

        const topHandle = b.querySelector('.resize-handle-top');
        if (topHandle) {
            topHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                startResizingEntry(b, 'top', e.clientY);
            });
        }

        const bottomHandle = b.querySelector('.resize-handle-bottom');
        if (bottomHandle) {
            bottomHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                startResizingEntry(b, 'bottom', e.clientY);
            });
        }
    });
}

// Initialize drag resize handlers over a time entry block
function startResizingEntry(entryEl, side, clientY) {
    if (isCompressedDayTimelineDirectManipulationDisabled()) return;

    const entryId = entryEl.dataset.id;
    const rect = entryEl.getBoundingClientRect();
    const parentRect = DOM.elItemsTimeEntries.getBoundingClientRect();
    
    resizeState.isResizing = true;
    resizeState.entryEl = entryEl;
    resizeState.entryId = entryId;
    resizeState.side = side;
    resizeState.initialY = clientY;
    resizeState.initialTop = rect.top - parentRect.top;
    resizeState.initialHeight = rect.height;
    resizeState.dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);

    hideTimeEntryHoverPreview();
    
    document.body.style.cursor = 'ns-resize';
}

// Renders absolute details overlay popover next to Activity Stream blocks
function showActivityDetailsPopup(b) {
    const startCell = parseInt(b.dataset.startCell, 10);
    const span = parseInt(b.dataset.span, 10);
    const app = b.dataset.app;
    const title = b.dataset.title;
    const url = normalizeActivityText(b.dataset.url);
    const appPath = b.dataset.appPath || '';
    const bundleId = b.dataset.bundleId || '';

    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    const { start: startMs, end: endMs } = getActivityBlockTimeRange(b);
    const activeDurationMs = Number(b.dataset.activeDurationMs);
    const elapsedDurationMs = Number(b.dataset.elapsedDurationMs);
    const interruptionCount = Number(b.dataset.interruptionCount);

    const formatTimeHM = (ms) => {
        const date = new Date(ms);
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    };

    const timeRangeStr = `${formatTimeHM(startMs)} – ${formatTimeHM(endMs)}`;

    const popupDisplayModel = buildActivityBlockPopupDisplayModel(b);
    const displayOverlaps = popupDisplayModel.visibleRows;
    const assignmentOverlaps = popupDisplayModel.assignmentRows;
    const isMultipleActivityPopup = popupDisplayModel.isMultiple;

    const totalMs = Number.isFinite(activeDurationMs) && activeDurationMs > 0
        ? activeDurationMs
        : isMultipleActivityPopup
        ? getBreakdownDisplayDurationMs(displayOverlaps, popupDisplayModel.exactRows)
        : (getActivityDurationTotalMs(displayOverlaps) || (span * state.zoom * 60000));
    const durationStr = formatPositiveActivityDurationLabel(totalMs);
    const popupActivityMix = displayOverlaps.reduce((mix, overlap) => {
        return addTimelineActivityMix(mix, overlap.activityMix || emptyActivityMix());
    }, emptyActivityMix());

    DOM.elPopupDuration.innerText = durationStr;
    if (DOM.elPopupDuration) {
        const elapsedLabel = Number.isFinite(elapsedDurationMs) && elapsedDurationMs > 0
            ? formatActivityDurationLabel(elapsedDurationMs, 0)
            : '';
        const interruptionLabel = Number.isFinite(interruptionCount) && interruptionCount > 0
            ? ` · ${interruptionCount} interruption${interruptionCount === 1 ? '' : 's'}`
            : '';
        DOM.elPopupDuration.title = elapsedLabel
            ? `Active ${durationStr} · elapsed ${elapsedLabel}${interruptionLabel}`
            : '';
    }
    DOM.elPopupRange.innerText = timeRangeStr;
    renderPopupActivityMix(popupActivityMix);

    const renderPopupActivityChildRow = (o, parentIndex, childIndex, options = {}) => {
        const rowDurationMs = Number(o.duration) || 0;
        const oDurationStr = formatPositiveActivityDurationLabel(rowDurationMs);
        const rowKey = getPopupActivitySelectionKey(o);
        const displayLabels = getPopupActivityDisplayLabels(o);
        const hiddenClass = options.hidden === false ? '' : ' hidden';
        const externalLinkHTML = displayLabels.externalUrl
            ? `<a href="${escapeAttribute(displayLabels.externalUrl)}"
                   target="_blank"
                   rel="noopener noreferrer"
                   class="popup-activity-external-link"
                   title="Open in browser"
                   aria-label="Open ${escapeAttribute(displayLabels.primary)} in browser">
                    <i class="ph ph-arrow-square-out" aria-hidden="true"></i>
               </a>`
            : '';
        return `
            <div class="popup-activity-row popup-activity-child-row${hiddenClass}"
                 data-popup-overlap-index="${parentIndex}"
                 data-popup-child-index="${childIndex}"
                 data-popup-child-parent-index="${parentIndex}"
                 data-popup-similarity-key="${escapeAttribute(rowKey)}">
                <div class="popup-activity-row__main popup-activity-row__main--child">
                    <div class="popup-activity-row__label">
                        <span class="popup-activity-title popup-activity-title--child" title="${escapeAttribute(displayLabels.primary)}">${escapeTimelineText(displayLabels.primary)}</span>
                        ${externalLinkHTML}
                    </div>
                </div>
                <span class="popup-activity-duration popup-activity-child-duration">${oDurationStr}</span>
            </div>
        `;
    };

    if (isMultipleActivityPopup) {
        DOM.elPopupIconContainer.innerHTML = '<i class="ph ph-dots-three-circle text-base text-accent"></i>';
        DOM.elPopupAppName.innerText = 'Multiple Activities';

        DOM.elPopupSingleDetails.classList.add('hidden');
        DOM.elPopupSingleChildrenContainer?.classList?.add('hidden');
        if (DOM.elPopupSingleChildrenContainer) DOM.elPopupSingleChildrenContainer.innerHTML = '';
        DOM.elPopupMultiDetails.classList.remove('hidden');

        const renderPopupActivityBreakdownRow = (o, index, options = {}) => {
            const childIndex = Number.isFinite(options.childIndex) ? options.childIndex : null;
            const isChildRow = childIndex !== null;
            const children = !isChildRow && Array.isArray(o.children) ? o.children : [];
            const rowDurationMs = Number(o.duration) || 0;
            const oDurationStr = formatPositiveActivityDurationLabel(rowDurationMs);
            const rowKey = getPopupActivitySelectionKey(o);
            const selectedKeys = state.selectedActivities.has(getActivityBlockSelectionId(b)) ? getActivityBlockSelectionKeys(b) : [];
            const selectedKeySet = new Set(selectedKeys);
            const isRowSelected = selectedKeySet.size > 0
                ? popupActivityMatchesSelectionKeys(o, selectedKeySet)
                : false;
            const rowSelectedClass = isRowSelected ? ' is-selected' : '';
            const checkboxIconClass = isRowSelected ? 'ph-fill ph-check-square' : 'ph ph-square';
            const displayLabels = getPopupActivityDisplayLabels(o);
            const externalLinkHTML = displayLabels.externalUrl
                ? `<a href="${escapeAttribute(displayLabels.externalUrl)}"
                       target="_blank"
                       rel="noopener noreferrer"
                       class="popup-activity-external-link"
                       title="Open in browser"
                       aria-label="Open ${escapeAttribute(displayLabels.primary)} in browser">
                        <i class="ph ph-arrow-square-out" aria-hidden="true"></i>
                   </a>`
                : '';
            const secondaryLabelHTML = displayLabels.secondary
                ? `<span class="popup-activity-secondary" title="${escapeAttribute(displayLabels.secondary)}">${escapeTimelineText(displayLabels.secondary)}</span>`
                : '';
            const rowDurationPillClass = activityMixPillClass(o.activityMix, 'shrink-0');
            const rowDurationPillAttributes = activityMixPillAttributes(o.activityMix);
            const expandButtonHTML = children.length > 0
                ? `<button type="button"
                           class="popup-activity-expand"
                           title="Show source rows"
                           aria-label="Show source rows for ${escapeAttribute(displayLabels.primary)}"
                           aria-expanded="false">
                        <i class="ph ph-caret-right" aria-hidden="true"></i>
                   </button>`
                : '';
            if (isChildRow) {
                return renderPopupActivityChildRow(o, index, childIndex);
            }

            const rowClass = `popup-activity-row${rowSelectedClass}`;
            const childRowsHTML = children.length > 0
                ? `<div class="popup-activity-children popup-activity-children--multi hidden" data-popup-child-group-index="${index}">
                        ${children.map((child, nextChildIndex) => renderPopupActivityBreakdownRow(child, index, { childIndex: nextChildIndex })).join('')}
                   </div>`
                : '';

            return `
                <div class="${rowClass}"
                     data-popup-overlap-index="${index}"
                     data-popup-similarity-key="${escapeAttribute(rowKey)}">
                    ${expandButtonHTML}
                    <button type="button"
                            class="popup-activity-select activity-checkbox${isRowSelected ? ' is-selected' : ''}"
                            title="Select activity"
                            aria-label="Select activity"
                            aria-pressed="${String(isRowSelected)}">
                        <i class="${checkboxIconClass} text-base"></i>
                    </button>
                    <div class="popup-activity-row__main">
                        <div class="popup-activity-row__icon">
                            ${getActivityIconHTML(o.app, o.url, o.title, o.appPath, o.bundleId)}
                        </div>
                        <div class="popup-activity-row__label">
                            <span class="popup-activity-title" title="${escapeAttribute(displayLabels.primary)}">${escapeTimelineText(displayLabels.primary)}</span>
                            ${externalLinkHTML}
                        </div>
                        ${secondaryLabelHTML}
                    </div>
                    <span class="${rowDurationPillClass}"${rowDurationPillAttributes}>${oDurationStr}</span>
                    <button type="button"
                            class="popup-activity-quick-add activity-quick-add"
                            title="Assign to Project"
                            aria-label="Assign activity to project">
                        <i class="ph ph-plus-circle text-lg"></i>
                    </button>
                </div>
                ${childRowsHTML}
            `;
        };
        const selectedKeys = state.selectedActivities.has(getActivityBlockSelectionId(b)) ? getActivityBlockSelectionKeys(b) : [];
        if (DOM.elPopupMultiListContainer?.dataset) {
            DOM.elPopupMultiListContainer.dataset.selectedSimilarityKeys = selectedKeys.length > 0
                ? encodeURIComponent(JSON.stringify(selectedKeys))
                : '';
            DOM.elPopupMultiListContainer.dataset.popupSelectionDirty = 'false';
        }
        DOM.elPopupMultiListContainer.innerHTML = displayOverlaps.map((o, index) => renderPopupActivityBreakdownRow(o, index)).join('');
        bindActivityMixTooltipInteractions(DOM.elPopupMultiListContainer);
        bindActivityPopupBreakdownControls(b, displayOverlaps, startMs, endMs);

        DOM.elPopupAssignBtn.onclick = () => {
            const selectedOverlaps = getSelectedPopupAssignmentActivities(displayOverlaps, assignmentOverlaps);
            const scopedKeys = isPopupSelectionDirty() ? new Set() : getPopupSelectedSimilarityKeySet();
            const assignmentActivities = buildPopupAssignmentActivities(selectedOverlaps, startMs, endMs, {
                selectedKeys: scopedKeys,
                ...(scopedKeys.size === 0 ? {
                    assignmentDisplayStart: startMs,
                    assignmentDisplayEnd: endMs
                } : {})
            });
            dismissActivityDetailsPopup();
            if (selectedOverlaps.length === 0) return;
            if (assignmentActivities.length === 0) return;
            openTimeEntryModal(startMs, endMs, '', null, null, false, assignmentActivities);
        };
    } else {
        const visibleActivity = { app, title, url, appPath, bundleId };
        const exactRow = (Array.isArray(popupDisplayModel.exactRows) ? popupDisplayModel.exactRows : [])
            .find(row => getPopupActivityExactGroupingKey(row) === getPopupActivityExactGroupingKey(visibleActivity));
        const displayPrimaryRow = getSinglePopupDisplayActivity(popupDisplayModel.primaryRow || {});
        const sourceActivity = exactRow || displayPrimaryRow || {};
        const sourceTitle = getActivityDisplayTitle(sourceActivity) || sourceActivity.title || title;
        const singleSource = {
            ...sourceActivity,
            app: sourceActivity.app || app,
            title: sourceTitle,
            url: sourceActivity.url || url,
            appPath: sourceActivity.appPath || appPath,
            bundleId: sourceActivity.bundleId || bundleId,
            start: startMs,
            end: endMs,
            duration: totalMs,
            activityMix: popupActivityMix
        };
        const singleActivity = {
            ...sourceActivity,
            app: sourceActivity.app || app,
            title: sourceTitle,
            url: sourceActivity.url || url,
            appPath: sourceActivity.appPath || appPath,
            bundleId: sourceActivity.bundleId || bundleId,
            start: startMs,
            end: endMs,
            duration: totalMs,
            activityMix: popupActivityMix,
            popupContextSummary: true,
            popupContextKey: sourceActivity.popupContextKey || popupDisplayModel.primaryRow?.popupContextKey,
            sources: [singleSource]
        };
        const singleApp = normalizeActivityText(singleActivity.app || app);
        const singleTitle = normalizeActivityText(singleActivity.title || title);
        const singleUrl = normalizeActivityText(singleActivity.url || url);
        const singleAppPath = normalizeActivityText(singleActivity.appPath || appPath);
        const singleBundleId = normalizeActivityText(singleActivity.bundleId || bundleId);

        DOM.elPopupIconContainer.innerHTML = getActivityIconHTML(singleApp, singleUrl, singleTitle, singleAppPath, singleBundleId);
        DOM.elPopupAppName.innerText = cleanTitle(singleTitle, singleActivity) || singleApp;
        DOM.elPopupTitle.innerText = singleApp;
        const titleLabel = DOM.elPopupSingleDetails.querySelector('span');
        if (titleLabel) titleLabel.innerText = 'Application';

        DOM.elPopupSingleDetails.classList.remove('hidden');
        DOM.elPopupMultiDetails.classList.add('hidden');
        DOM.elPopupMultiListContainer.innerHTML = '';

        if (DOM.elPopupSingleChildrenContainer) {
            DOM.elPopupSingleChildrenContainer.innerHTML = '';
            DOM.elPopupSingleChildrenContainer.classList.add('hidden');
        }

        if (singleUrl) {
            DOM.elPopupUrlContainer.classList.remove('hidden');
            DOM.elPopupUrl.href = singleUrl.startsWith('http') ? singleUrl : `https://${singleUrl}`;
            DOM.elPopupUrl.innerText = singleUrl;
        } else {
            DOM.elPopupUrlContainer.classList.add('hidden');
        }

        DOM.elPopupAssignBtn.onclick = () => {
            dismissActivityDetailsPopup();
            openTimeEntryModal(startMs, endMs, '', null, null, false, buildPopupAssignmentActivities([singleActivity], startMs, endMs, {
                assignmentDisplayStart: startMs,
                assignmentDisplayEnd: endMs
            }));
        };
    }

    const rowLayout = getTimelineRowLayout({ dateStartOfDay, zoom: state.zoom });
    const blockTop = getTimelineDisplayTopForTime(startMs, rowLayout);
    DOM.elActivityDetailsPopup.style.top = `${blockTop + 6}px`;
    DOM.elActivityDetailsPopup.classList.remove('hidden');
}

function dismissActivityDetailsPopup() {
    const popup = DOM.elActivityDetailsPopup;
    if (popup) {
        popup.classList.add('hidden');
    }
    if (DOM.elPopupMultiListContainer?.dataset) {
        delete DOM.elPopupMultiListContainer.dataset.selectedSimilarityKeys;
        delete DOM.elPopupMultiListContainer.dataset.popupSelectionDirty;
    }
}

// Bind to window namespace
window.renderTimelineGrids = renderTimelineGrids;
window.getDayTimelineRenderModel = getDayTimelineRenderModel;
window.buildVisibleActivityCells = buildVisibleActivityCells;
window.buildActivityStreamSessions = buildActivityStreamSessions;
window.isCompressedDayTimelineDirectManipulationDisabled = isCompressedDayTimelineDirectManipulationDisabled;
window.buildDayTimelineRowLayout = buildDayTimelineRowLayout;
window.getDisplayRowForSourceRow = getDisplayRowForSourceRow;
window.getSourceRowForDisplayRow = getSourceRowForDisplayRow;
window.getTimelineDisplayTopForTime = getTimelineDisplayTopForTime;
window.getTimelineTimeForDisplayTop = getTimelineTimeForDisplayTop;
window.getTimelineDisplayRangeGeometry = getTimelineDisplayRangeGeometry;
window.getTimelineExactDisplayRangeGeometry = getTimelineExactDisplayRangeGeometry;
window.buildVisibleActivityRunsForSummary = buildVisibleActivityRunsForSummary;
window.buildActivityStreamSummaryAssignmentActivity = buildActivityStreamSummaryAssignmentActivity;
window.buildActivityStreamAssignmentActivities = buildActivityStreamAssignmentActivities;
window.buildActivityStreamSummaryAssignmentActivities = buildActivityStreamSummaryAssignmentActivities;
window.buildActivityStreamRenderEntries = buildActivityStreamRenderEntries;
window.buildLoggedTimeEntryRenderItems = buildLoggedTimeEntryRenderItems;
window.buildUnloggedActivityGroups = buildUnloggedActivityGroups;
window.buildUnloggedBackfillActivities = buildUnloggedBackfillActivities;
window.renderUnloggedRecordedWorkReview = renderUnloggedRecordedWorkReview;
window.draftUnloggedRecordedWorkGroup = draftUnloggedRecordedWorkGroup;
window.getLoggedTimeEntryLaneStyle = getLoggedTimeEntryLaneStyle;
window.getTimelineDisplayRowRange = getTimelineDisplayRowRange;
window.isResolvedActivityStreamAssignmentRun = isResolvedActivityStreamAssignmentRun;
window.renderMemoryAidActivities = renderMemoryAidActivities;
window.createActivityBlockHTML = createActivityBlockHTML;
window.getActivitySummaryKey = getActivitySummaryKey;
window.getActivitySimilarityKey = getActivitySimilarityKey;
window.getActivityAssignmentKeys = getActivityAssignmentKeys;
window.getActivitySelectionIdentityKeys = getActivitySelectionIdentityKeys;
window.getActivitySimilarityKeyForMode = getActivitySimilarityKeyForMode;
window.getActivityBlockSelectionKeys = getActivityBlockSelectionKeys;
window.getActivityBlockSelectedSimilarityKeys = getActivityBlockSelectedSimilarityKeys;
window.getActivityBlockSelectedSimilarityMode = getActivityBlockSelectedSimilarityMode;
window.getActivityBlockSelectedSimilarityMatchKeys = getActivityBlockSelectedSimilarityMatchKeys;
window.getActivityBlockSelectedSimilarityScope = getActivityBlockSelectedSimilarityScope;
window.getActivityBlockDetailOverlaps = getActivityBlockDetailOverlaps;
window.getActivityMixInRange = getActivityMixInRange;
window.summarizeActivityOverlaps = summarizeActivityOverlaps;
window.summarizeSimilarActivityOverlaps = summarizeSimilarActivityOverlaps;
window.summarizePopupActivityOverlaps = summarizePopupActivityOverlaps;
window.attachMemoryAidInteractions = attachMemoryAidInteractions;
window.setActivityBlockSelected = setActivityBlockSelected;
window.toggleActivitySelection = toggleActivitySelection;
window.clearActivitySelection = clearActivitySelection;
window.openSimilarSelectionModal = openSimilarSelectionModal;
window.selectSimilarActivities = selectSimilarActivities;
window.updateMultiSelectBar = updateMultiSelectBar;
window.renderLoggedTimeEntries = renderLoggedTimeEntries;
window.bindFloatingTimeEntryLabelUpdates = bindFloatingTimeEntryLabelUpdates;
window.updateFloatingTimeEntryLabels = updateFloatingTimeEntryLabels;
window.showTimeEntryHoverPreview = showTimeEntryHoverPreview;
window.hideTimeEntryHoverPreview = hideTimeEntryHoverPreview;
window.attachTimeEntriesInteractions = attachTimeEntriesInteractions;
window.openTimeEntryBlockEditor = openTimeEntryBlockEditor;
window.startResizingEntry = startResizingEntry;
window.showActivityDetailsPopup = showActivityDetailsPopup;
window.dismissActivityDetailsPopup = dismissActivityDetailsPopup;
