// Render background timeline grid lines
function renderTimelineGrids() {
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    const activityCells = getCurrentDayTimelineActivityCells(dateStartOfDay, state.zoom);
    const timeEntryRenderItems = buildLoggedTimeEntryRenderItems(state.timeEntries || [], state.zoom, dateStartOfDay);
    const rowLayout = buildDayTimelineRowLayout({
        dateStartOfDay,
        zoom: state.zoom,
        activityCells,
        timeEntryRenderItems
    });
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
const LOGGED_TIME_ENTRY_MIN_RENDER_DURATION_MS = 60 * 1000;
const POPUP_BREAKDOWN_MIN_VISIBLE_DURATION_MS = 60 * 1000;
let visibleActivityCellsCache = null;

function isHideEmptyActivityRowsEnabled() {
    return Boolean(state?.settings?.hideEmptyActivityRows);
}

function getTimelineRowDurationMs(zoom) {
    return Math.max(1, Number(zoom) || 1) * 60 * 1000;
}

function getTimelineTotalRows(zoom) {
    return Math.floor(1440 / Math.max(1, Number(zoom) || 1));
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
    const ownershipActivities = Array.isArray(state.timelineActivities)
        ? state.timelineActivities
        : state.activities;
    const visibleActivities = Array.isArray(state.activities)
        ? state.activities
        : ownershipActivities;
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
        : getCurrentDayTimelineActivityCells(dateStartOfDay, renderZoom);
    const renderItems = Array.isArray(timeEntryRenderItems)
        ? timeEntryRenderItems
        : buildLoggedTimeEntryRenderItems(state.timeEntries || [], renderZoom, dateStartOfDay);
    const keepRows = new Set();

    cells.forEach((cell, index) => {
        if (cell) keepRows.add(index);
    });

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
    const rowLayout = layout || buildDayTimelineRowLayout({ dateStartOfDay, zoom });
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

function getTimelineDisplayTopForTime(timeMs, options = {}) {
    const layout = options?.sourceRows
        ? options
        : buildDayTimelineRowLayout(options);
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
        : buildDayTimelineRowLayout(options);
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
        assignmentSource: 'activity-stream'
    }));
}

function buildActivityStreamSummaryAssignmentActivity(selectedActivity, rangeStart, rangeEnd, zoom = state.zoom) {
    const duration = getActivitySourceDuration(selectedActivity, rangeStart, rangeEnd);
    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart || duration <= 0) {
        return null;
    }

    const base = stripActivitySources(selectedActivity);
    return {
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
        assignmentDisplayZoom: zoom
    };
}

function buildActivityStreamSummaryAssignmentActivities(activities, rangeStart, rangeEnd, zoom = state.zoom) {
    return (Array.isArray(activities) ? activities : [])
        .map(activity => buildActivityStreamSummaryAssignmentActivity(activity, rangeStart, rangeEnd, zoom))
        .filter(Boolean);
}

// Merges raw activities into a grid structure and renders Activity Stream blocks
function renderMemoryAidActivities() {
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    const ownershipActivities = Array.isArray(state.timelineActivities)
        ? state.timelineActivities
        : state.activities;
    const cellActivities = buildVisibleActivityCells({
        dateStartOfDay,
        zoom: state.zoom,
        ownershipActivities,
        visibleActivities: state.activities
    });
    const timeEntryRenderItems = buildLoggedTimeEntryRenderItems(state.timeEntries || [], state.zoom, dateStartOfDay);
    const rowLayout = buildDayTimelineRowLayout({
        dateStartOfDay,
        zoom: state.zoom,
        activityCells: cellActivities,
        timeEntryRenderItems
    });
    const totalCells = cellActivities.length;

    // Step 2: Merge adjacent similar cells to make beautiful unified activity blocks
    let html = '';
    let currentBlock = null;

    for (let i = 0; i < totalCells; i++) {
        const cellAct = cellActivities[i];

        if (cellAct) {
            if (currentBlock && currentBlock.summaryKey === cellAct.summaryKey) {
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
        } else {
            if (currentBlock) {
                html += createActivityBlockHTML(currentBlock, rowLayout);
                currentBlock = null;
            }
        }
    }

    if (currentBlock) {
        html += createActivityBlockHTML(currentBlock, rowLayout);
    }

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

function getActivityBlockData(blockEl) {
    return {
        app: blockEl.dataset.app || '',
        title: blockEl.dataset.title || '',
        url: blockEl.dataset.url || '',
        appPath: blockEl.dataset.appPath || '',
        bundleId: blockEl.dataset.bundleId || ''
    };
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
    const assignmentActivities = getActivityStreamAssignmentActivities(entry);
    if (assignmentActivities.length === 0) return null;

    const projectId = normalizeActivityText(entry.projectId);
    const taskId = normalizeActivityText(entry.taskId);
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

function getActivityStreamAssignedDurationMs(entries) {
    const seenRepairKeys = new Set();

    return entries.reduce((entryTotal, entry) => {
        const renderRepairKey = entry?.renderDisplayRepairKey;
        const renderDuration = Number(entry?.renderDurationMs);
        if (renderRepairKey && Number.isFinite(renderDuration) && renderDuration >= 0) {
            if (seenRepairKeys.has(renderRepairKey)) return entryTotal;
            seenRepairKeys.add(renderRepairKey);
            return entryTotal + renderDuration;
        }

        const assignmentActivities = getActivityStreamAssignmentActivities(entry);
        return entryTotal + assignmentActivities.reduce((activityTotal, activity) => {
            if (activity.assignmentDisplayRepairKey) {
                if (seenRepairKeys.has(activity.assignmentDisplayRepairKey)) return activityTotal;
                seenRepairKeys.add(activity.assignmentDisplayRepairKey);
            }
            return activityTotal + getActivitySourceDuration(activity);
        }, 0);
    }, 0);
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
        if (cell && cell.summaryKey === currentBlock?.summaryKey) {
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
        if (cell && cell.summaryKey === currentBlock?.summaryKey) {
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
    const summaryKey = getActivitySummaryKey(activity);
    if (!summaryKey) return [];

    const renderZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const rowDurationMs = renderZoom * 60 * 1000;
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
    const startCell = Math.max(0, Math.floor((range.start - dateStartOfDay) / rowDurationMs));
    const endCell = Math.min(cellActivities.length, Math.ceil((range.end - dateStartOfDay) / rowDurationMs));
    const renderEntries = [];

    for (let cellIndex = startCell; cellIndex < endCell; cellIndex++) {
        const cell = cellActivities[cellIndex];
        if (!cell) continue;

        const cellStart = dateStartOfDay + cellIndex * rowDurationMs;
        const cellEnd = cellStart + rowDurationMs;
        const matchingSummary = getActivitySummaryForAssignmentWithinRange(
            cell.overlaps || [],
            activity,
            summaryKey,
            cellStart,
            cellEnd
        );
        if (!matchingSummary || matchingSummary.duration <= 0) continue;

        const matchesCellOwner = activityStreamBlockMatchesAssignment(cell, activity, summaryKey);
        if (!matchesCellOwner) {
            const summarizedOverlaps = summarizeActivityOverlaps(cell.overlaps || [], cellStart, cellEnd);
            const visibleBreakdownOverlaps = getVisibleMultiActivityBreakdownOverlaps(
                summarizedOverlaps,
                cellStart,
                cellEnd
            );
            const hasVisibleSecondaryMatch = visibleBreakdownOverlaps
                .some(summary => activityMatchesAssignmentIdentity(summary, activity, summaryKey));
            if (!hasVisibleSecondaryMatch) continue;
        }

        const start = Math.max(range.start, cellStart);
        const end = Math.min(range.end, cellEnd);
        if (end <= start) continue;

        const assignedDuration = end - start;
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

        renderEntries.push({
            ...entry,
            start,
            end,
            renderDisplayStart: cellStart,
            renderDisplayEnd: cellEnd,
            renderDurationMs: assignedDuration,
            activities: [renderActivity]
        });
    }

    return renderEntries;
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
    const visibleBlocks = buildVisibleActivityBlocks({
        dateStartOfDay,
        zoom: renderZoom,
        ownershipActivities,
        visibleActivities
    });
    const projections = [];

    for (const block of visibleBlocks) {
        if (block.end <= range.start || block.start >= range.end) continue;

        const matchingSummary = getActivitySummaryForAssignmentWithinRange(
            block.overlaps,
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

function buildActivityStreamSummaryAssignmentRenderEntries(entry, activity, range, summaryKey, dateStartOfDay, zoom) {
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
            assignmentEnd: projection.exactEnd
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

function buildActivityStreamRenderEntries(entry, dateStartOfDay, zoom = state.zoom) {
    const renderZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const assignmentActivities = getActivityStreamAssignmentActivities(entry);
    if (assignmentActivities.length === 0) return [entry];

    const renderEntries = [];
    assignmentActivities.forEach(activity => {
        const range = getAssignmentActivityRange(entry, activity);
        if (!range) return;

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
                renderZoom
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
        if (!currentComponent || laneItem.start >= currentComponent.end) {
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
                if (activeLane.end <= laneItem.start) {
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
    return `${projectId}\u0000${taskId}`;
}

function itemHasAutoRuleExactTimeEntry(item) {
    return (item?.entries || []).some(isAutoRuleExactTimeEntry);
}

function canMergeLoggedTimeEntryVisualItems(current, item, displayStart, displayEnd) {
    const hasTouchingDisplay = current
        && Number.isFinite(displayStart)
        && Number.isFinite(displayEnd)
        && Number.isFinite(current.displayEnd)
        && displayStart <= current.displayEnd;
    if (!hasTouchingDisplay) return false;

    if (itemHasAutoRuleExactTimeEntry(current) && itemHasAutoRuleExactTimeEntry(item)) {
        if (displayStart < current.displayEnd) return true;

        const currentEnd = Number(current.end);
        const itemStart = Number(item.start);
        const hasNearExactRange = Number.isFinite(currentEnd)
            && Number.isFinite(itemStart)
            && itemStart <= currentEnd + AUTO_RULE_ASSIGNMENT_MERGE_GAP_MS;
        if (hasNearExactRange) return true;

        const currentDuration = Number(current.durationMs);
        const itemDuration = Number(item.durationMs);
        return Number.isFinite(currentDuration)
            && Number.isFinite(itemDuration)
            && currentDuration >= LOGGED_TIME_ENTRY_MIN_RENDER_DURATION_MS
            && itemDuration >= LOGGED_TIME_ENTRY_MIN_RENDER_DURATION_MS;
    }

    return true;
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
        }
    }

    return mergedItems.sort((left, right) => left.sourceIndex - right.sourceIndex);
}

function getVisibleLoggedTimeEntryRenderItems(renderItems) {
    return renderItems.filter(item => {
        const durationMs = Number(item?.durationMs);
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

function getVisibleSecondaryActivityBreakdownOverlaps(overlaps, primaryActivity) {
    const primaryKey = getActivitySimilarityKey(primaryActivity) || getActivitySummaryKey(primaryActivity);
    if (!primaryKey) return overlaps;

    return (Array.isArray(overlaps) ? overlaps : []).filter(overlap => {
        const overlapKey = getActivitySimilarityKey(overlap) || getActivitySummaryKey(overlap);
        return overlapKey !== primaryKey;
    });
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

function buildAutoRuleRowAggregatedItems(groupEntries, dateStartOfDay, zoom) {
    const rowsByDisplayRange = new Map();

    for (const { entry, sourceIndex } of groupEntries) {
        const exactRange = getAutoRuleExactRange(entry);
        const exactStart = exactRange?.start ?? entry.start;
        const exactEnd = exactRange?.end ?? entry.end;
        if (!Number.isFinite(exactStart) || !Number.isFinite(exactEnd) || exactEnd <= exactStart) continue;

        const displayRange = getRenderEntryDisplayRowRange(entry, dateStartOfDay, zoom);
        const displayStart = Number(displayRange.start);
        const displayEnd = Number(displayRange.end);
        if (!Number.isFinite(displayStart) || !Number.isFinite(displayEnd) || displayEnd <= displayStart) continue;

        const rowKey = `${displayStart}:${displayEnd}`;
        if (!rowsByDisplayRange.has(rowKey)) {
            rowsByDisplayRange.set(rowKey, {
                entries: [],
                firstEntry: entry,
                start: exactStart,
                end: exactEnd,
                displayStart,
                displayEnd,
                isAssignedGroup: true,
                sourceIndex
            });
        }

        const row = rowsByDisplayRange.get(rowKey);
        row.entries.push(entry);
        row.start = Math.min(row.start, exactStart);
        row.end = Math.max(row.end, exactEnd);
        row.sourceIndex = Math.min(row.sourceIndex, sourceIndex);
    }

    return [...rowsByDisplayRange.values()]
        .map(row => ({
            ...row,
            durationMs: getAutoRuleExactAssignedDurationMs(row.entries)
        }))
        .filter(row => row.durationMs >= LOGGED_TIME_ENTRY_MIN_RENDER_DURATION_MS)
        .sort((left, right) => {
            if (left.displayStart !== right.displayStart) return left.displayStart - right.displayStart;
            if (left.displayEnd !== right.displayEnd) return left.displayEnd - right.displayEnd;
            return left.sourceIndex - right.sourceIndex;
        });
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
            currentGroup.sourceIndex = Math.min(currentGroup.sourceIndex, sourceIndex);
        }
    }

    for (const groupEntries of Object.values(autoAssignmentGroupsByKey)) {
        const rowGroups = buildAutoRuleRowAggregatedItems(groupEntries, dateStartOfDay, zoom);
        let currentGroup = null;
        for (const rowGroup of rowGroups) {
            const shouldStartGroup = !currentGroup
                || rowGroup.displayStart > currentGroup.displayEnd;

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

// Generate the HTML for an individual activity block in Activity Stream
function createActivityBlockHTML(block, rowLayout = null) {
    const app = normalizeActivityText(block.app);
    const title = normalizeActivityText(block.title);
    const url = normalizeActivityText(block.url);
    const appPath = normalizeActivityText(block.appPath);
    const bundleId = normalizeActivityText(block.bundleId);

    const textStyle = 'text-white font-semibold';
    const isSelected = state.selectedActivities.has(block.startCell);
    const selectedClass = isSelected ? 'selected' : '';

    let displayTitle = cleanTitle(title, { app, title, url, appPath, bundleId });

    const blockOverlaps = block.overlaps || [];
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    const blockStart = dateStartOfDay + block.startCell * state.zoom * 60 * 1000;
    const blockEnd = blockStart + block.span * state.zoom * 60 * 1000;
    const layout = rowLayout || buildFullDayTimelineRowLayout(dateStartOfDay, state.zoom);
    const displayRange = getDisplayRowRangeForSourceRange(layout, block.startCell, block.startCell + block.span);
    const displayStartRow = displayRange.startRow;
    const displayRowSpan = Math.max(1, displayRange.rowSpan);
    const uniqueOverlaps = summarizeActivityOverlaps(blockOverlaps, blockStart, blockEnd);
    const overlapsData = encodeURIComponent(JSON.stringify(uniqueOverlaps));
    const visibleBreakdownOverlaps = getVisibleMultiActivityBreakdownOverlaps(uniqueOverlaps, blockStart, blockEnd);
    const visibleSecondaryOverlaps = getVisibleSecondaryActivityBreakdownOverlaps(visibleBreakdownOverlaps, {
        app,
        title,
        url,
        appPath,
        bundleId
    });
    const inlineIconOverlaps = visibleSecondaryOverlaps.slice(0, 2);
    const hiddenInlineIconCount = Math.max(0, visibleSecondaryOverlaps.length - inlineIconOverlaps.length);

    const iconHTML = getActivityIconHTML(app, url, title, appPath, bundleId);

    const fallbackDurationMs = block.span * state.zoom * 60000;
    const actualDurationMs = getActivityDurationTotalMs(uniqueOverlaps) || fallbackDurationMs;
    const isMultipleActivityBlock = uniqueOverlaps.length > 1;
    const displayDurationMs = isMultipleActivityBlock
        ? (getBreakdownDisplayDurationMs(visibleBreakdownOverlaps, uniqueOverlaps) || actualDurationMs)
        : actualDurationMs;
    const durationStr = formatActivityDurationLabel(displayDurationMs, isMultipleActivityBlock ? 0 : 1);
    const blockActivityMix = uniqueOverlaps.reduce((mix, overlap) => {
        return addTimelineActivityMix(mix, overlap.activityMix || emptyActivityMix());
    }, emptyActivityMix());
    const durationPillClass = activityMixPillClass(blockActivityMix, 'shrink-0');
    const durationPillAttributes = activityMixPillAttributes(blockActivityMix);

    return `
        <div class="activity-block ${selectedClass}"
             style="top: calc(var(--row-height) * ${displayStartRow} + 2px); height: calc(var(--row-height) * ${displayRowSpan} - 3px);"
             data-start-cell="${block.startCell}"
             data-span="${block.span}"
             data-app="${escapeAttribute(app)}"
             data-title="${escapeAttribute(title)}"
             data-url="${escapeAttribute(url)}"
             data-app-path="${escapeAttribute(appPath)}"
             data-bundle-id="${escapeAttribute(bundleId)}"
             data-overlaps="${overlapsData}">
            <div class="activity-checkbox ${isSelected ? 'is-selected' : ''} mr-2 shrink-0 cursor-pointer z-20 flex items-center justify-center">
                <i class="${isSelected ? 'ph-fill ph-check-square' : 'ph ph-square'} text-base"></i>
            </div>
            <div class="w-5 h-5 flex items-center justify-center mr-3 shrink-0">
                ${iconHTML}
            </div>
            <div class="flex-1 min-w-0 flex items-center gap-1.5 text-[11px] leading-none pr-3">
                <span class="${textStyle} truncate flex-1 min-w-0">${displayTitle}</span>
                <span class="text-gray-400 font-normal text-[10px] shrink-0">${escapeTimelineText(app)}</span>
            </div>
            <div class="flex items-center gap-1.5 shrink-0 ml-auto z-20">
                ${visibleSecondaryOverlaps.length > 0 ? `
                    <div class="flex items-center gap-1 mr-2">
                        ${inlineIconOverlaps.map(o => {
                            return `<div class="w-5 h-5 flex items-center justify-center shrink-0">${getActivityIconHTML(o.app, o.url, o.title, o.appPath, o.bundleId)}</div>`;
                        }).join('')}
                        ${hiddenInlineIconCount > 0 ? `
                            <div class="duration-pill h-4 ml-0.5 min-w-[14px]">
                                +${hiddenInlineIconCount}
                            </div>
                        ` : ''}
                    </div>
                ` : ''}
                <div class="${durationPillClass}"${durationPillAttributes}>
                    ${durationStr}
                </div>
                <button class="activity-quick-add bg-transparent w-7 h-7 rounded-full flex items-center justify-center" title="Assign to Project">
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
                const startCell = parseInt(b.dataset.startCell, 10);
                const span = parseInt(b.dataset.span, 10);
                const app = b.dataset.app;
                const title = b.dataset.title;

                const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
                const startMs = dateStartOfDay + startCell * state.zoom * 60 * 1000;
                const endMs = startMs + span * state.zoom * 60 * 1000;

                let overlaps = [];
                if (b.dataset.overlaps) {
                    try {
                        overlaps = JSON.parse(decodeURIComponent(b.dataset.overlaps));
                    } catch (err) {}
                }

                const displayOverlaps = summarizeSimilarActivityOverlaps(overlaps, startMs, endMs);
                const assignmentActivities = buildActivityStreamSummaryAssignmentActivities(displayOverlaps, startMs, endMs);
                openTimeEntryModal(startMs, endMs, '', null, null, false, assignmentActivities.length > 0 ? assignmentActivities : displayOverlaps);
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
            
            const startCell = parseInt(b.dataset.startCell, 10);
            const span = parseInt(b.dataset.span, 10);
            const app = b.dataset.app;
            const title = b.dataset.title;

            const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
            const startMs = dateStartOfDay + startCell * state.zoom * 60 * 1000;
            const endMs = startMs + span * state.zoom * 60 * 1000;

            let overlaps = [];
            if (b.dataset.overlaps) {
                try {
                    overlaps = JSON.parse(decodeURIComponent(b.dataset.overlaps));
                } catch (err) {}
            }

            const displayOverlaps = summarizeSimilarActivityOverlaps(overlaps, startMs, endMs);
            const assignmentActivities = buildActivityStreamSummaryAssignmentActivities(displayOverlaps, startMs, endMs);
            openTimeEntryModal(startMs, endMs, '', null, null, false, assignmentActivities.length > 0 ? assignmentActivities : displayOverlaps);
        });
    });
}

function parseActivityBlockSelectedSimilarityKeys(blockEl) {
    const rawValue = blockEl?.dataset?.selectedSimilarityKeys;
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

function getActivityBlockSelectedSimilarityKeys(blockEl) {
    return parseActivityBlockSelectedSimilarityKeys(blockEl);
}

function getActivityBlockSelectionKeys(blockEl) {
    const storedKeys = parseActivityBlockSelectedSimilarityKeys(blockEl);
    if (storedKeys.length > 0) return storedKeys;

    const primaryKey = getActivitySimilarityKey(getActivityBlockData(blockEl));
    return primaryKey ? [primaryKey] : [];
}

function setActivityBlockSelected(blockEl, selected, selectedSimilarityKeys = null) {
    const startCell = parseInt(blockEl.dataset.startCell, 10);
    const checkbox = blockEl.querySelector('.activity-checkbox');
    const iconEl = blockEl.querySelector('.activity-checkbox i');

    if (!Number.isFinite(startCell)) return;

    if (selected) {
        state.selectedActivities.add(startCell);
        blockEl.classList.add('selected');
        checkbox?.classList.add('is-selected');
        if (iconEl) iconEl.className = 'ph-fill ph-check-square text-base';
        if (Array.isArray(selectedSimilarityKeys) && selectedSimilarityKeys.length > 0) {
            const uniqueKeys = Array.from(new Set(selectedSimilarityKeys.filter(Boolean)));
            blockEl.dataset.selectedSimilarityKeys = encodeURIComponent(JSON.stringify(uniqueKeys));
        } else {
            delete blockEl.dataset.selectedSimilarityKeys;
        }
    } else {
        state.selectedActivities.delete(startCell);
        blockEl.classList.remove('selected');
        checkbox?.classList.remove('is-selected');
        if (iconEl) iconEl.className = 'ph ph-square text-base';
        delete blockEl.dataset.selectedSimilarityKeys;
    }
}

function getPopupActivitySelectionKey(activity) {
    return getActivitySimilarityKey(activity) || getActivitySummaryKey(activity);
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

function buildPopupAssignmentActivities(activities, startMs, endMs) {
    const assignmentInputs = (Array.isArray(activities) ? activities : [])
        .map(getPopupAssignmentActivity);
    const assignmentActivities = buildActivityStreamSummaryAssignmentActivities(assignmentInputs, startMs, endMs);
    return assignmentActivities.length > 0 ? assignmentActivities : assignmentInputs;
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
    setPopupActivityRowSelected(row, !row?.classList?.contains?.('is-selected'));
}

function getSelectedPopupAssignmentActivities(displayOverlaps) {
    const rows = DOM.elPopupMultiListContainer?.querySelectorAll?.('[data-popup-overlap-index]');
    if (!rows) return displayOverlaps;

    const selectedActivities = [];
    rows.forEach(row => {
        if (!row?.classList?.contains?.('is-selected')) return;

        const index = parseInt(row.dataset?.popupOverlapIndex, 10);
        const activity = Number.isFinite(index) ? displayOverlaps[index] : null;
        if (activity) selectedActivities.push(activity);
    });

    return selectedActivities.length > 0 ? selectedActivities : displayOverlaps;
}

function assignPopupActivity(activity, startMs, endMs) {
    dismissActivityDetailsPopup();
    openTimeEntryModal(startMs, endMs, '', null, null, false, buildPopupAssignmentActivities([activity], startMs, endMs));
}

function bindActivityPopupBreakdownControls(blockEl, displayOverlaps, startMs, endMs) {
    const rows = DOM.elPopupMultiListContainer?.querySelectorAll?.('[data-popup-overlap-index]');
    if (!rows) return;

    rows.forEach(row => {
        const index = parseInt(row.dataset?.popupOverlapIndex, 10);
        const activity = Number.isFinite(index) ? displayOverlaps[index] : null;
        if (!activity) return;

        const key = getPopupActivitySelectionKey(activity);
        if (key) row.dataset.popupSimilarityKey = key;

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
    const startCell = parseInt(blockEl.dataset.startCell, 10);
    setActivityBlockSelected(blockEl, !state.selectedActivities.has(startCell));
    updateMultiSelectBar();
}

function clearActivitySelection() {
    state.selectedActivities.clear();
    DOM.elItemsMemoryAid?.querySelectorAll('.activity-block.selected').forEach(el => {
        setActivityBlockSelected(el, false);
    });
    updateMultiSelectBar();
}

function selectSimilarActivities() {
    const itemsMem = DOM.elItemsMemoryAid;
    if (!itemsMem) return 0;

    const selectedEls = Array.from(itemsMem.querySelectorAll('.activity-block.selected'));
    if (!selectedEls.length) return 0;

    const selectedKeys = new Set(selectedEls.flatMap(el => getActivityBlockSelectionKeys(el)));

    let selectedCount = 0;
    itemsMem.querySelectorAll('.activity-block').forEach(el => {
        const primaryKey = getActivitySimilarityKey(getActivityBlockData(el));
        const primaryMatches = primaryKey && selectedKeys.has(primaryKey);
        const matchedSecondaryKeys = [];

        if (!primaryMatches && el.dataset.overlaps) {
            try {
                const overlaps = JSON.parse(decodeURIComponent(el.dataset.overlaps));
                for (const overlap of overlaps) {
                    const key = getActivitySimilarityKey(overlap);
                    if (key && selectedKeys.has(key)) {
                        matchedSecondaryKeys.push(key);
                    }
                }
            } catch {}
        }

        if (primaryMatches || matchedSecondaryKeys.length > 0) {
            setActivityBlockSelected(el, true, primaryMatches ? null : matchedSecondaryKeys);
            selectedCount++;
        }
    });

    updateMultiSelectBar();
    return selectedCount;
}

// Shows/hides the floating multi-select bar
function updateMultiSelectBar() {
    const size = state.selectedActivities.size;
    const bar = DOM.elMultiSelectBar;
    if (bar) {
        if (size > 0) {
            DOM.elSelectedCount.innerText = size;
            bar.classList.remove('hidden');
        } else {
            bar.classList.add('hidden');
        }
    }
}

// Renders the Logged Time Entries inside the center timeline panel
function renderLoggedTimeEntries() {
    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    let html = '';
    const renderItems = buildLoggedTimeEntryRenderItems(state.timeEntries, state.zoom, dateStartOfDay);
    const activityCells = getCurrentDayTimelineActivityCells(dateStartOfDay, state.zoom);
    const rowLayout = buildDayTimelineRowLayout({
        dateStartOfDay,
        zoom: state.zoom,
        activityCells,
        timeEntryRenderItems: renderItems
    });

    for (const item of renderItems) {
        const entry = item.firstEntry;
        const rangeStart = Number.isFinite(item.displayStart) && Number.isFinite(item.displayEnd) && item.displayEnd > item.displayStart
            ? item.displayStart
            : item.start;
        const rangeEnd = Number.isFinite(item.displayStart) && Number.isFinite(item.displayEnd) && item.displayEnd > item.displayStart
            ? item.displayEnd
            : item.end;
        const geometry = getTimelineDisplayRangeGeometry(rangeStart, rangeEnd, dateStartOfDay, state.zoom, rowLayout);
        const topPx = Math.max(0, geometry.top);
        const naturalHeightPx = geometry.height;
        const heightPx = Math.max(37, naturalHeightPx);

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
        const description = (entry.description || '').trim();
        const descriptionHtml = description
            ? `<span class="time-entry-description truncate pr-2">${escapeTimelineText(description)}</span>`
            : '';
        const projectSummaryHtml = `
                    <span class="project-marker" style="background-color: ${project.color}"></span>
                    <span class="truncate">${escapeTimelineText(project.name)}</span>
                    ${task ? `<span class="time-entry-task duration-pill shrink-0">${escapeTimelineText(task.name)}</span>` : ''}
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
        const groupIds = [...new Set(item.entries.map(groupEntry => groupEntry.id).filter(Boolean))];
        const groupDataHtml = groupIds.length > 1
            ? `
                 data-group-ids="${encodeURIComponent(JSON.stringify(groupIds))}"
                 data-group-start="${item.start}"
                 data-group-end="${item.end}"`
            : '';
        const laneStyle = getLoggedTimeEntryLaneStyle(item);

        html += `
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

    const itemsTime = DOM.elItemsTimeEntries;
    if (itemsTime) {
        itemsTime.innerHTML = html;
        attachTimeEntriesInteractions();
    }
}

function showTimeEntryHoverPreview(cellIndex) {
    const itemsTime = DOM.elItemsTimeEntries;
    if (!itemsTime) return;

    let preview = itemsTime.querySelector('.time-entry-hover-preview');
    if (!preview) {
        preview = document.createElement('div');
        preview.className = 'time-entry-hover-preview';
        itemsTime.appendChild(preview);
    }

    const dateStartOfDay = new Date(state.currentDate).setHours(0,0,0,0);
    const rowLayout = buildDayTimelineRowLayout({ dateStartOfDay, zoom: state.zoom });
    const displayRow = rowLayout.hideEmptyRows
        ? Math.max(0, getDisplayRowForSourceRow(rowLayout, cellIndex))
        : cellIndex;
    preview.style.top = `${displayRow * 40 + 2}px`;
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
    const startMs = dateStartOfDay + startCell * state.zoom * 60 * 1000;
    const endMs = startMs + span * state.zoom * 60 * 1000;

    const formatTimeHM = (ms) => {
        const date = new Date(ms);
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    };

    const duration = span * state.zoom;
    const timeRangeStr = `${formatTimeHM(startMs)} – ${formatTimeHM(endMs)}`;

    let overlaps = [];
    if (b.dataset.overlaps) {
        try {
            overlaps = JSON.parse(decodeURIComponent(b.dataset.overlaps));
        } catch (e) {
            console.error("Error parsing overlaps data:", e);
        }
    }
    const summarizedOverlaps = summarizeSimilarActivityOverlaps(overlaps, startMs, endMs);
    const visibleSummarizedOverlaps = getVisiblePopupBreakdownOverlaps(summarizedOverlaps);
    const displayOverlaps = visibleSummarizedOverlaps.length > 0
        ? visibleSummarizedOverlaps
        : summarizedOverlaps;
    const isMultipleActivityPopup = displayOverlaps.length > 1;

    const totalMs = isMultipleActivityPopup
        ? getBreakdownDisplayDurationMs(displayOverlaps, summarizedOverlaps)
        : (getActivityDurationTotalMs(displayOverlaps) || (span * state.zoom * 60000));
    const durationStr = formatActivityDurationLabel(totalMs, 0);
    const popupActivityMix = displayOverlaps.reduce((mix, overlap) => {
        return addTimelineActivityMix(mix, overlap.activityMix || emptyActivityMix());
    }, emptyActivityMix());

    DOM.elPopupDuration.innerText = durationStr;
    if (DOM.elPopupDuration) {
        DOM.elPopupDuration.title = '';
    }
    DOM.elPopupRange.innerText = timeRangeStr;
    renderPopupActivityMix(popupActivityMix);

    if (isMultipleActivityPopup) {
        DOM.elPopupIconContainer.innerHTML = '<i class="ph ph-dots-three-circle text-base text-accent"></i>';
        DOM.elPopupAppName.innerText = 'Multiple Activities';

        DOM.elPopupSingleDetails.classList.add('hidden');
        DOM.elPopupMultiDetails.classList.remove('hidden');

        DOM.elPopupMultiListContainer.innerHTML = displayOverlaps.map((o, index) => {
            let oDurationStr = '';
            if (o.duration < 60000) {
                oDurationStr = `${Math.round(o.duration / 1000)}s`;
            } else {
                oDurationStr = `${Math.round(o.duration / (60 * 1000))} min`;
            }
            const rowKey = getPopupActivitySelectionKey(o);
            const selectedKeys = state.selectedActivities.has(startCell) ? getActivityBlockSelectionKeys(b) : [];
            const isRowSelected = Boolean(rowKey && selectedKeys.includes(rowKey));
            const rowSelectedClass = isRowSelected ? ' is-selected' : '';
            const checkboxIconClass = isRowSelected ? 'ph-fill ph-check-square' : 'ph ph-square';
            const displayLabels = getPopupActivityDisplayLabels(o);
            const externalLinkHTML = displayLabels.externalUrl
                ? `<a href="${escapeAttribute(displayLabels.externalUrl)}"
                       target="_blank"
                       rel="noopener noreferrer"
                       class="popup-activity-external-link text-gray-400 hover:text-blue-300 focus-visible:text-blue-300 w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                       title="Open in browser"
                       aria-label="Open ${escapeAttribute(displayLabels.primary)} in browser">
                        <i class="ph ph-arrow-square-out text-[13px]" aria-hidden="true"></i>
                   </a>`
                : '';
            const secondaryLabelHTML = displayLabels.secondary
                ? `<span class="text-gray-400 text-right truncate shrink-0 max-w-[42%]" title="${escapeAttribute(displayLabels.secondary)}">${escapeTimelineText(displayLabels.secondary)}</span>`
                : '';
            const rowDurationPillClass = activityMixPillClass(o.activityMix, 'shrink-0');
            const rowDurationPillAttributes = activityMixPillAttributes(o.activityMix);
            return `
                <div class="flex items-center justify-between text-[11px] py-1.5 border-b border-[#2d2f34]/40 last:border-b-0 popup-activity-row${rowSelectedClass}"
                     data-popup-overlap-index="${index}"
                     data-popup-similarity-key="${escapeAttribute(rowKey)}">
                    <button type="button"
                            class="popup-activity-select activity-checkbox ${isRowSelected ? 'is-selected ' : ''}w-7 h-7 rounded-full flex items-center justify-center shrink-0 mr-1"
                            title="Select activity"
                            aria-label="Select activity"
                            aria-pressed="${String(isRowSelected)}">
                        <i class="${checkboxIconClass} text-base"></i>
                    </button>
                    <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                        <div class="w-5 h-5 flex items-center justify-center shrink-0">
                            ${getActivityIconHTML(o.app, o.url, o.title, o.appPath, o.bundleId)}
                        </div>
                        <div class="flex items-center gap-1 min-w-0 flex-1">
                            <span class="font-bold text-gray-200 truncate min-w-0" title="${escapeAttribute(displayLabels.primary)}">${escapeTimelineText(displayLabels.primary)}</span>
                            ${externalLinkHTML}
                        </div>
                        ${secondaryLabelHTML}
                    </div>
                    <span class="${rowDurationPillClass}"${rowDurationPillAttributes}>${oDurationStr}</span>
                    <button type="button"
                            class="popup-activity-quick-add activity-quick-add bg-transparent w-7 h-7 rounded-full flex items-center justify-center shrink-0 ml-1"
                            title="Assign to Project"
                            aria-label="Assign activity to project">
                        <i class="ph ph-plus-circle text-lg"></i>
                    </button>
                </div>
            `;
        }).join('');
        bindActivityMixTooltipInteractions(DOM.elPopupMultiListContainer);
        bindActivityPopupBreakdownControls(b, displayOverlaps, startMs, endMs);

        DOM.elPopupAssignBtn.onclick = () => {
            dismissActivityDetailsPopup();
            const selectedOverlaps = getSelectedPopupAssignmentActivities(displayOverlaps);
            openTimeEntryModal(startMs, endMs, '', null, null, false, buildPopupAssignmentActivities(selectedOverlaps, startMs, endMs));
        };
    } else {
        const singleActivity = displayOverlaps[0] || { app, title, url, appPath, bundleId };
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

        if (singleUrl) {
            DOM.elPopupUrlContainer.classList.remove('hidden');
            DOM.elPopupUrl.href = singleUrl.startsWith('http') ? singleUrl : `https://${singleUrl}`;
            DOM.elPopupUrl.innerText = singleUrl;
        } else {
            DOM.elPopupUrlContainer.classList.add('hidden');
        }

        DOM.elPopupAssignBtn.onclick = () => {
            dismissActivityDetailsPopup();
            openTimeEntryModal(startMs, endMs, '', null, null, false, buildPopupAssignmentActivities(displayOverlaps, startMs, endMs));
        };
    }

    const rowLayout = buildDayTimelineRowLayout({ dateStartOfDay, zoom: state.zoom });
    const displayRow = rowLayout.hideEmptyRows
        ? Math.max(0, getDisplayRowForSourceRow(rowLayout, startCell))
        : startCell;
    const blockTop = displayRow * 40;
    DOM.elActivityDetailsPopup.style.top = `${blockTop + 6}px`;
    DOM.elActivityDetailsPopup.classList.remove('hidden');
}

function dismissActivityDetailsPopup() {
    const popup = DOM.elActivityDetailsPopup;
    if (popup) {
        popup.classList.add('hidden');
    }
}

// Bind to window namespace
window.renderTimelineGrids = renderTimelineGrids;
window.buildVisibleActivityCells = buildVisibleActivityCells;
window.buildDayTimelineRowLayout = buildDayTimelineRowLayout;
window.getDisplayRowForSourceRow = getDisplayRowForSourceRow;
window.getSourceRowForDisplayRow = getSourceRowForDisplayRow;
window.getTimelineDisplayTopForTime = getTimelineDisplayTopForTime;
window.getTimelineTimeForDisplayTop = getTimelineTimeForDisplayTop;
window.getTimelineDisplayRangeGeometry = getTimelineDisplayRangeGeometry;
window.buildVisibleActivityRunsForSummary = buildVisibleActivityRunsForSummary;
window.buildActivityStreamAssignmentActivities = buildActivityStreamAssignmentActivities;
window.buildActivityStreamSummaryAssignmentActivity = buildActivityStreamSummaryAssignmentActivity;
window.buildActivityStreamSummaryAssignmentActivities = buildActivityStreamSummaryAssignmentActivities;
window.buildActivityStreamRenderEntries = buildActivityStreamRenderEntries;
window.buildLoggedTimeEntryRenderItems = buildLoggedTimeEntryRenderItems;
window.getLoggedTimeEntryLaneStyle = getLoggedTimeEntryLaneStyle;
window.getTimelineDisplayRowRange = getTimelineDisplayRowRange;
window.isResolvedActivityStreamAssignmentRun = isResolvedActivityStreamAssignmentRun;
window.renderMemoryAidActivities = renderMemoryAidActivities;
window.createActivityBlockHTML = createActivityBlockHTML;
window.getActivitySummaryKey = getActivitySummaryKey;
window.getActivitySimilarityKey = getActivitySimilarityKey;
window.getActivityBlockSelectionKeys = getActivityBlockSelectionKeys;
window.getActivityBlockSelectedSimilarityKeys = getActivityBlockSelectedSimilarityKeys;
window.getActivityMixInRange = getActivityMixInRange;
window.summarizeActivityOverlaps = summarizeActivityOverlaps;
window.summarizeSimilarActivityOverlaps = summarizeSimilarActivityOverlaps;
window.attachMemoryAidInteractions = attachMemoryAidInteractions;
window.setActivityBlockSelected = setActivityBlockSelected;
window.toggleActivitySelection = toggleActivitySelection;
window.clearActivitySelection = clearActivitySelection;
window.selectSimilarActivities = selectSimilarActivities;
window.updateMultiSelectBar = updateMultiSelectBar;
window.renderLoggedTimeEntries = renderLoggedTimeEntries;
window.showTimeEntryHoverPreview = showTimeEntryHoverPreview;
window.hideTimeEntryHoverPreview = hideTimeEntryHoverPreview;
window.attachTimeEntriesInteractions = attachTimeEntriesInteractions;
window.openTimeEntryBlockEditor = openTimeEntryBlockEditor;
window.startResizingEntry = startResizingEntry;
window.showActivityDetailsPopup = showActivityDetailsPopup;
window.dismissActivityDetailsPopup = dismissActivityDetailsPopup;
