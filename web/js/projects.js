// User-selectable project identity colors, kept to small markers in the interface.
const PRESET_COLORS = [
    '#3b82f6', // Blue
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#ef4444', // Red
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#06b6d4', // Cyan
    '#f97316', // Orange
    '#14b8a6', // Teal
    '#a855f7', // Purple-light
    '#6366f1', // Indigo
    '#84cc16'  // Lime
];

let currentProjectDetailEntries = [];
let currentProjectDetailsId = null;
let projectDescriptionAutosave = null;
const PROJECT_DESCRIPTION_AUTOSAVE_DELAY_MS = 300;
let projectTimeHistoryState = {
    projectId: null,
    entries: [],
    dayMap: new Map(),
    viewedMonth: null
};
let sidebarAllTimeEntries = null;
let sidebarAllTimeEntriesPromise = null;

function escapeProjectText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getProjectTasks(project) {
    return Array.isArray(project?.tasks) ? project.tasks : [];
}

function getTimeEntryMergeKey(entry) {
    if (entry?.id) return `id:${entry.id}`;
    return [
        entry?.projectId || '',
        Number.isFinite(entry?.start) ? entry.start : '',
        Number.isFinite(entry?.end) ? entry.end : '',
        String(entry?.description || '')
    ].join('|');
}

function mergeSidebarHistoricalEntriesWithCurrent(allEntries = []) {
    const merged = Array.isArray(allEntries) ? [...allEntries] : [];
    const seen = new Set(merged.map(getTimeEntryMergeKey));
    for (const entry of Array.isArray(state.timeEntries) ? state.timeEntries : []) {
        const key = getTimeEntryMergeKey(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(entry);
    }
    return merged;
}

function getSidebarMetricAllTimeEntries() {
    if (Array.isArray(sidebarAllTimeEntries)) {
        return mergeSidebarHistoricalEntriesWithCurrent(sidebarAllTimeEntries);
    }
    return state.timeEntries;
}

function shouldFetchSidebarHistoricalEntries() {
    return (Array.isArray(state.projects) ? state.projects : []).some(project => (
        project?.rateType === 'fixed' && Number(project?.fixedRate || 0) > 0
    ));
}

function refreshSidebarHistoricalEntriesForMetrics() {
    if (!shouldFetchSidebarHistoricalEntries()) return;
    if (Array.isArray(sidebarAllTimeEntries) || sidebarAllTimeEntriesPromise) return;
    if (typeof fetchAllTimeEntries !== 'function') return;

    sidebarAllTimeEntriesPromise = fetchAllTimeEntries()
        .then(entries => {
            sidebarAllTimeEntries = Array.isArray(entries) ? entries : [];
            sidebarAllTimeEntriesPromise = null;
            recalculateStatistics();
        })
        .catch(error => {
            console.error('Error fetching all-time sidebar stats:', error);
            sidebarAllTimeEntries = [];
            sidebarAllTimeEntriesPromise = null;
        });
}

function newProjectTaskId() {
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function saveProjectTasks(projectId, tasks) {
    const response = await fetch(`${API_BASE}/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks })
    });
    if (!response.ok) {
        alert('Failed to save project category');
        return null;
    }

    const updatedProject = await response.json();
    const index = state.projects.findIndex(project => project.id === projectId);
    if (index !== -1) {
        state.projects[index] = updatedProject;
    }
    return updatedProject;
}

function getProjectDescriptionHelperText() {
    return 'Used by Ask AI to match captured activity when you explicitly ask it to suggest entries.';
}

function clearProjectDescriptionAutosaveTimer() {
    if (projectDescriptionAutosave?.timer) {
        clearTimeout(projectDescriptionAutosave.timer);
        projectDescriptionAutosave.timer = null;
    }
}

async function saveProjectDescriptionNow() {
    const autosave = projectDescriptionAutosave;
    if (!autosave) return null;

    clearProjectDescriptionAutosaveTimer();
    const description = autosave.textarea.value.trim();
    if (description === autosave.lastSavedDescription) {
        if (autosave.status) {
            autosave.status.textContent = description
                ? 'Saved.'
                : getProjectDescriptionHelperText();
        }
        return null;
    }

    if (autosave.status) autosave.status.textContent = 'Saving...';

    try {
        const response = await fetch(`${API_BASE}/projects/${autosave.projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description })
        });

        if (!response.ok) {
            throw new Error('Failed to save project context.');
        }

        const updated = await response.json().catch(() => null);
        const index = state.projects.findIndex(project => project.id === autosave.projectId);
        if (index >= 0) {
            state.projects[index] = updated && typeof updated === 'object'
                ? updated
                : { ...state.projects[index], description };
        }
        autosave.lastSavedDescription = description;
        if (autosave.status) autosave.status.textContent = 'Saved.';
        return state.projects[index] || updated;
    } catch (error) {
        console.error('Error saving project context:', error);
        if (autosave.status) {
            autosave.status.textContent = 'Unable to save project context.';
        }
        return null;
    }
}

function setupProjectDescriptionAutosave(projectId) {
    clearProjectDescriptionAutosaveTimer();

    const textarea = document.getElementById('proj-details-description');
    const status = document.getElementById('proj-details-description-status');
    const project = state.projects.find(p => p.id === projectId);
    if (!textarea || !project) {
        projectDescriptionAutosave = null;
        return null;
    }

    projectDescriptionAutosave = {
        projectId,
        textarea,
        status,
        timer: null,
        lastSavedDescription: String(project.description || '').trim()
    };

    if (status) status.textContent = getProjectDescriptionHelperText();

    textarea.oninput = () => {
        clearProjectDescriptionAutosaveTimer();
        if (status) status.textContent = 'Saving...';
        projectDescriptionAutosave.timer = setTimeout(() => {
            saveProjectDescriptionNow();
        }, PROJECT_DESCRIPTION_AUTOSAVE_DELAY_MS);
    };
    textarea.onblur = () => {
        saveProjectDescriptionNow();
    };

    return projectDescriptionAutosave;
}

function flushProjectDescriptionAutosave() {
    return saveProjectDescriptionNow();
}

function formatProjectTaskDuration(ms) {
    const totalMins = Math.round((ms || 0) / (60 * 1000));
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function getProjectActivityDurationMs(activity) {
    const assignedDuration = Number(activity?.assignedDurationMs);
    if (Number.isFinite(assignedDuration) && assignedDuration > 0) return assignedDuration;

    const duration = Number(activity?.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;

    if (Number.isFinite(activity?.start) && Number.isFinite(activity?.end) && activity.end > activity.start) {
        return activity.end - activity.start;
    }

    return 0;
}

function getCurrentDayStartMs() {
    if (!Number.isFinite(state.currentDate?.getTime?.())) return null;
    return new Date(state.currentDate).setHours(0,0,0,0);
}

function getCurrentDayActivityStreamDurationMs(entry) {
    if (typeof buildActivityStreamRenderEntries !== 'function') return null;
    if (typeof isHiddenAutoAssignedTimeEntry === 'function' && isHiddenAutoAssignedTimeEntry(entry)) return null;
    if (!Array.isArray(entry?.activities)
        || !entry.activities.some(activity => activity?.assignmentSource === 'activity-stream')) {
        return null;
    }

    const dateStartOfDay = getCurrentDayStartMs();
    if (!Number.isFinite(dateStartOfDay)) return null;

    const dateEndOfDay = dateStartOfDay + 24 * 60 * 60 * 1000;
    if (!Number.isFinite(entry?.start) || entry.start < dateStartOfDay || entry.start >= dateEndOfDay) {
        return null;
    }

    const renderEntries = buildActivityStreamRenderEntries(entry, dateStartOfDay);
    const duration = renderEntries.reduce((entryTotal, renderEntry) => {
        const activities = Array.isArray(renderEntry.activities) ? renderEntry.activities : [];
        return entryTotal + activities.reduce((activityTotal, activity) => (
            activityTotal + getProjectActivityDurationMs(activity)
        ), 0);
    }, 0);

    return duration > 0 ? duration : null;
}

function getProjectTimeEntryDurationMs(entry) {
    if (typeof isHiddenAutoAssignedTimeEntry === 'function' && isHiddenAutoAssignedTimeEntry(entry)) {
        return 0;
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

function getProjectEntryActivityFallback(activity) {
    if (!activity || typeof activity !== 'object') return '';

    const title = String(activity.title || '').trim();
    if (title) {
        const cleaned = typeof cleanTitle === 'function' ? cleanTitle(title, activity) : title;
        if (String(cleaned || '').trim()) return String(cleaned).trim();
    }

    const app = String(activity.app || '').trim();
    if (app) return app;

    const url = String(activity.url || '').trim();
    if (url && typeof URL === 'function') {
        try {
            return new URL(url).hostname.replace(/^www\./i, '');
        } catch (_) {
            return '';
        }
    }

    return '';
}

function getProjectEntryDescriptionHTML(entry) {
    const description = String(entry?.description || '').trim();
    if (description) return escapeProjectText(description);

    const isAutoRule = entry?.createdBy === 'auto-rule' || Boolean(entry?.autoRuleId);
    if (isAutoRule && Array.isArray(entry?.activities)) {
        const fallback = entry.activities
            .map(getProjectEntryActivityFallback)
            .find(Boolean);
        if (fallback) return `Auto-assigned: ${escapeProjectText(fallback)}`;
    }

    return '<span class="project-entry-empty-description">No description provided</span>';
}

function getProjectTimeHistoryDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    if (typeof getFormattedDate === 'function') return getFormattedDate(date);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseProjectTimeHistoryDate(value) {
    const [year, month, day] = String(value || '').split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const date = new Date(year, month - 1, day);
    return Number.isFinite(date.getTime()) ? date : null;
}

function getProjectTimeHistoryMonthKey(date) {
    const key = getProjectTimeHistoryDateKey(date);
    return key ? key.slice(0, 7) : '';
}

function getProjectTimeHistoryMonthStart(date) {
    const source = Number.isFinite(date?.getTime?.()) ? date : new Date();
    return new Date(source.getFullYear(), source.getMonth(), 1);
}

function buildProjectTimeHistoryDayMap(entries = []) {
    const dayMap = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
        const duration = getProjectTimeEntryDurationMs(entry);
        if (duration <= 0) continue;
        const dateKey = getProjectTimeHistoryDateKey(entry?.start);
        if (!dateKey) continue;
        const existing = dayMap.get(dateKey) || { dateKey, totalMs: 0, entries: [] };
        existing.totalMs += duration;
        existing.entries.push(entry);
        dayMap.set(dateKey, existing);
    }
    return dayMap;
}

function formatProjectTimeHistoryDuration(ms) {
    const duration = Math.max(0, Number(ms) || 0);
    if (duration <= 0) return '0 min';
    if (duration < 60 * 1000) return '<1 min';
    const totalMins = Math.max(1, Math.round(duration / (60 * 1000)));
    if (totalMins < 60) return `${totalMins} min`;
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function projectTimeHistoryMonthHasTime(dayMap, monthDate) {
    const monthKey = getProjectTimeHistoryMonthKey(monthDate);
    if (!monthKey) return false;
    return Array.from(dayMap.keys()).some(dateKey => dateKey.startsWith(`${monthKey}-`));
}

function resolveProjectTimeHistoryInitialMonth(dayMap, selectedDate = state.currentDate) {
    const selectedMonth = getProjectTimeHistoryMonthStart(
        Number.isFinite(selectedDate?.getTime?.()) ? selectedDate : new Date()
    );
    if (projectTimeHistoryMonthHasTime(dayMap, selectedMonth)) {
        return selectedMonth;
    }

    const latestDateKey = Array.from(dayMap.keys()).sort().at(-1);
    if (latestDateKey) {
        return getProjectTimeHistoryMonthStart(parseProjectTimeHistoryDate(latestDateKey));
    }

    return selectedMonth;
}

function shiftProjectTimeHistoryMonth(delta) {
    if (!projectTimeHistoryState.viewedMonth) {
        projectTimeHistoryState.viewedMonth = resolveProjectTimeHistoryInitialMonth(
            projectTimeHistoryState.dayMap,
            state.currentDate
        );
    }
    projectTimeHistoryState.viewedMonth.setMonth(projectTimeHistoryState.viewedMonth.getMonth() + delta);
    renderProjectTimeHistoryCalendar(projectTimeHistoryState.projectId, projectTimeHistoryState.entries, {
        preserveMonth: true
    });
}

async function openProjectTimeHistoryDay(dateKey) {
    const targetDate = parseProjectTimeHistoryDate(dateKey);
    if (!targetDate) return;
    if (currentProjectDetailsId) {
        flushProjectTaskNameEdits(currentProjectDetailsId);
    }
    const modal = document.getElementById('project-details-modal');
    modal?.classList?.add('hidden');
    if (typeof window.openTimelineDate === 'function') {
        await window.openTimelineDate(targetDate, { mode: 'day' });
    }
}

function renderProjectTimeHistoryCalendar(projectId, entries = [], options = {}) {
    const monthLabel = document.getElementById('proj-details-time-history-month-label');
    const weekdays = document.getElementById('proj-details-time-history-weekdays');
    const days = document.getElementById('proj-details-time-history-days');
    if (!monthLabel || !weekdays || !days) return;

    const dayMap = buildProjectTimeHistoryDayMap(entries);
    if (!options.preserveMonth || projectTimeHistoryState.projectId !== projectId) {
        projectTimeHistoryState.viewedMonth = resolveProjectTimeHistoryInitialMonth(dayMap, state.currentDate);
    }

    projectTimeHistoryState = {
        projectId,
        entries: Array.isArray(entries) ? entries : [],
        dayMap,
        viewedMonth: projectTimeHistoryState.viewedMonth
    };

    const viewedMonth = projectTimeHistoryState.viewedMonth || getProjectTimeHistoryMonthStart(state.currentDate);
    const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
    monthLabel.textContent = monthFormatter.format(viewedMonth);
    weekdays.innerHTML = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
        .map(day => `<div class="project-time-history-weekday">${day}</div>`)
        .join('');

    const gridStart = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth(), 1);
    const mondayOffset = (gridStart.getDay() + 6) % 7;
    gridStart.setDate(gridStart.getDate() - mondayOffset);

    const todayStr = getProjectTimeHistoryDateKey(new Date());
    const selectedStr = getProjectTimeHistoryDateKey(state.currentDate || new Date());
    const currentMonth = viewedMonth.getMonth();
    const dayHtml = [];

    for (let index = 0; index < 42; index++) {
        const day = new Date(gridStart);
        day.setDate(gridStart.getDate() + index);
        const dateKey = getProjectTimeHistoryDateKey(day);
        const daySummary = dayMap.get(dateKey);
        const hasTime = Boolean(daySummary?.totalMs > 0);
        const isSelected = dateKey === selectedStr;
        const isToday = dateKey === todayStr;
        const isOutsideMonth = day.getMonth() !== currentMonth;
        const durationLabel = hasTime ? formatProjectTimeHistoryDuration(daySummary.totalMs) : '';
        const durationClass = hasTime
            ? 'project-time-history-day__duration'
            : 'project-time-history-day__duration project-time-history-day__duration--empty';
        const dayClasses = [
            'calendar-day',
            'project-time-history-day',
            hasTime ? 'project-time-history-day--logged' : 'project-time-history-day--muted',
            isSelected ? 'calendar-day--selected' : '',
            isOutsideMonth ? 'calendar-day--outside' : '',
            isToday && !isSelected ? 'calendar-day--today' : ''
        ].filter(Boolean).join(' ');
        const labelDate = day.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const ariaLabel = hasTime
            ? `${labelDate}, ${durationLabel} logged`
            : `${labelDate}, no project time logged`;

        dayHtml.push(`
            <button type="button"
                    class="${dayClasses}"
                    ${hasTime ? `data-date="${dateKey}"` : 'disabled'}
                    aria-label="${ariaLabel}">
                <span class="project-time-history-day__number">${day.getDate()}</span>
                <span class="${durationClass}" ${hasTime ? '' : 'aria-hidden="true"'}>${hasTime ? durationLabel : '0 min'}</span>
            </button>
        `);
    }

    days.innerHTML = dayHtml.join('');
    days.querySelectorAll('button[data-date]').forEach(button => {
        button.addEventListener('click', async event => {
            event.stopPropagation();
            await openProjectTimeHistoryDay(button.dataset.date);
        });
    });
}

function renderProjectTasks(project, projectEntries = []) {
    const list = document.getElementById('proj-details-tasks-list');
    if (!list) return;

    const activeTasks = getProjectTasks(project).filter(task => !task.archived);
    if (activeTasks.length === 0) {
        list.innerHTML = '<div class="empty-state empty-state--compact">No categories yet.</div>';
        return;
    }

    const taskDurations = {};
    for (const entry of projectEntries) {
        if (!entry.taskId) continue;
        taskDurations[entry.taskId] = (taskDurations[entry.taskId] || 0) + getProjectTimeEntryDurationMs(entry);
    }

    list.innerHTML = activeTasks.map(task => {
        const projectId = escapeProjectText(project.id);
        const taskId = escapeProjectText(task.id);
        const taskName = escapeProjectText(task.name);
        const loggedDuration = formatProjectTaskDuration(taskDurations[task.id] || 0);

        return `
            <div class="project-task-row">
                <input type="text"
                       class="field project-task-name-input"
                       value="${taskName}"
                       aria-label="Category name"
                       data-project-task-name="${taskId}"
                       data-original-name="${taskName}"
                       onblur="saveProjectTaskNameOnBlur(event, '${projectId}', '${taskId}')"
                       onkeydown="handleProjectTaskNameKeydown(event, '${projectId}', '${taskId}')">
                <div class="project-task-row-meta">
                    <div class="project-task-duration">${loggedDuration} logged</div>
                    <div class="project-task-actions">
                        <button type="button"
                                class="icon-button icon-button--danger project-task-delete"
                                aria-label="Remove category ${taskName}"
                                title="Remove category"
                                onclick="deleteProjectTask(event, '${projectId}', '${taskId}')">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function addProjectTask(event, projectId) {
    event?.stopPropagation();
    event?.preventDefault();

    const input = document.getElementById('proj-details-task-name');
    const name = input ? input.value.trim() : '';
    if (!name) {
        alert('Please enter a category name.');
        return;
    }

    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;

    const tasks = [
        ...getProjectTasks(project),
        { id: newProjectTaskId(), name, archived: false }
    ];
    const updatedProject = await saveProjectTasks(projectId, tasks);
    if (!updatedProject) return;

    if (input) input.value = '';
    await openProjectDetails(projectId, { tab: 'overview' });
    if (typeof renderModalTaskSelect === 'function') {
        renderModalTaskSelect('', projectId);
    }
    if (state.currentView === 'projects' && window.renderProjectsPage) {
        renderProjectsPage();
    }
}

function setProjectTaskCreateVisible(visible) {
    const row = document.getElementById('proj-details-task-create-row');
    const input = document.getElementById('proj-details-task-name');
    const btnTaskAddToggle = document.getElementById('proj-details-task-add-toggle');
    if (!row) return;

    row.classList.toggle('hidden', !visible);
    if (visible) {
        if (btnTaskAddToggle) btnTaskAddToggle.classList.add('hidden');
    } else if (btnTaskAddToggle) {
        btnTaskAddToggle.classList.remove('hidden');
    }
    if (visible) {
        input?.focus?.();
    } else if (input) {
        input.value = '';
    }
}

async function saveProjectTaskName(projectId, taskId, input) {
    const project = state.projects.find(p => p.id === projectId);
    if (!project || !input) return null;

    const name = input ? input.value.trim() : '';
    const originalName = String(input.dataset?.originalName || '').trim();
    if (!name) {
        input.value = originalName;
        return null;
    }
    if (name === originalName) {
        input.value = originalName;
        return null;
    }

    const tasks = getProjectTasks(project).map(task =>
        task.id === taskId ? { ...task, name } : task
    );
    const updatedProject = await saveProjectTasks(projectId, tasks);
    if (!updatedProject) {
        input.value = originalName;
        return null;
    }

    input.dataset.originalName = name;
    renderProjectTasks(updatedProject, currentProjectDetailEntries);
    if (typeof renderModalTaskSelect === 'function') {
        renderModalTaskSelect('', projectId);
    }
    if (state.currentView === 'projects' && window.renderProjectsPage) {
        renderProjectsPage();
    }
    return updatedProject;
}

function saveProjectTaskNameOnBlur(event, projectId, taskId) {
    saveProjectTaskName(projectId, taskId, event?.currentTarget || event?.target);
}

function handleProjectTaskNameKeydown(event, projectId, taskId) {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget?.blur?.();
    } else if (event.key === 'Escape') {
        event.preventDefault();
        const originalName = String(event.currentTarget?.dataset?.originalName || '');
        if (event.currentTarget) event.currentTarget.value = originalName;
        event.currentTarget?.blur?.();
    }
}

function flushProjectTaskNameEdits(projectId) {
    if (!projectId || !document?.querySelectorAll) return Promise.resolve([]);
    const inputs = Array.from(document.querySelectorAll('[data-project-task-name]'));
    return Promise.all(inputs.map(input => {
        const taskId = input.dataset?.projectTaskName;
        return taskId ? saveProjectTaskName(projectId, taskId, input) : null;
    }));
}

async function archiveProjectTask(projectId, taskId) {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;

    const tasks = getProjectTasks(project).map(task =>
        task.id === taskId ? { ...task, archived: true } : task
    );
    const updatedProject = await saveProjectTasks(projectId, tasks);
    if (!updatedProject) return;
    await openProjectDetails(projectId, { tab: 'overview' });
    if (typeof renderModalTaskSelect === 'function') {
        renderModalTaskSelect('', projectId);
    }
    if (state.currentView === 'projects' && window.renderProjectsPage) {
        renderProjectsPage();
    }
}

function deleteProjectTask(event, projectId, taskId) {
    event?.stopPropagation();
    event?.preventDefault();

    const project = state.projects.find(p => p.id === projectId);
    const task = getProjectTasks(project).find(candidate => candidate.id === taskId);
    if (!project || !task) return;

    showCustomConfirm({
        title: 'Remove Category',
        message: `"${task.name}" will no longer appear in category lists. Existing time entries keep their stored reference.`,
        actionText: 'Remove',
        actionClass: 'button-danger',
        onConfirm: () => archiveProjectTask(projectId, taskId)
    });
}

// Recalculates stats, charts, and projects breakdown on the right panel
function recalculateStatistics() {
    // Recorded active time includes short timeline-owned activity segments.
    const capturedActivities = Array.isArray(state.timelineActivities)
        ? state.timelineActivities
        : state.activities;
    const metrics = typeof calculateSelectedPeriodMetrics === 'function'
        ? calculateSelectedPeriodMetrics({
            activities: capturedActivities,
            timeEntries: state.timeEntries,
            projects: state.projects,
            allTimeEntries: getSidebarMetricAllTimeEntries()
        })
        : {
            totalCapturedMs: 0,
            totalLoggedMs: 0,
            billableMs: 0,
            billableEarnings: 0,
            dominantCurrency: '$',
            conversionPercent: 0,
            projectDurations: {}
        };
    const projectDurations = metrics.projectDurations || {};
    const formatProjectDuration = typeof formatSidebarProjectDuration === 'function'
        ? formatSidebarProjectDuration
        : (ms) => {
            const totalMins = Math.floor(ms / (60 * 1000));
            const hours = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            return `${hours}h ${mins}m`;
        };
    const formatMetricDuration = typeof formatStatsDuration === 'function'
        ? formatStatsDuration
        : formatProjectDuration;

    if (DOM.elStatCapturedActive) DOM.elStatCapturedActive.innerText = formatProjectDuration(metrics.totalCapturedMs);
    if (DOM.elWorkStatCaptured) DOM.elWorkStatCaptured.innerText = formatMetricDuration(metrics.totalCapturedMs);
    if (DOM.elWorkStatLogged) DOM.elWorkStatLogged.innerText = formatMetricDuration(metrics.totalLoggedMs);
    if (DOM.elWorkStatEarnings) DOM.elWorkStatEarnings.innerText = `${metrics.dominantCurrency || '$'}${(metrics.billableEarnings || 0).toFixed(2)}`;
    if (DOM.elWorkStatBillableHours) DOM.elWorkStatBillableHours.innerText = `${((metrics.billableMs || 0) / (3600 * 1000)).toFixed(1)}h of billable work`;
    if (DOM.elWorkStatConversionPercent) DOM.elWorkStatConversionPercent.innerText = `${metrics.conversionPercent || 0}%`;
    if (DOM.elWorkStatConversionBar) DOM.elWorkStatConversionBar.style.width = `${metrics.conversionPercent || 0}%`;
    refreshSidebarHistoricalEntriesForMetrics();

    // Safety check for getElStatBillable vs elStatBillable in state.js
    const elBillableNode = DOM.getElStatBillable || document.getElementById('stat-billable');
    if (elBillableNode) elBillableNode.innerText = formatProjectDuration(metrics.billableMs);
    if (DOM.elStatNonbillable) DOM.elStatNonbillable.innerText = formatProjectDuration(Math.max(0, metrics.totalLoggedMs - metrics.billableMs));

    // Project bar visual update relative to recorded active time.
    const projectPct = metrics.totalCapturedMs > 0
        ? Math.min(100, Math.round((metrics.totalLoggedMs / metrics.totalCapturedMs) * 100))
        : 0;
    if (DOM.elBarProject) DOM.elBarProject.style.width = `${projectPct}%`;

    // Projects Breakdown render
    const projectIds = Object.keys(projectDurations);
    if (projectIds.length === 0) {
        DOM.elProjectsList.innerHTML = `
            <div class="empty-state empty-state--compact">
                No time entries logged for this day.
            </div>
        `;
        return;
    }

    DOM.elProjectsList.innerHTML = projectIds.map(pid => {
        const proj = state.projects.find(p => p.id === pid) || { name: 'Unknown Project', color: '#4b5563', billable: false };
        const ms = projectDurations[pid];
        const pct = metrics.totalLoggedMs > 0 ? Math.round((ms / metrics.totalLoggedMs) * 100) : 0;

        return `
            <div class="project-breakdown-card">
                <div class="project-breakdown-header">
                    <div class="project-breakdown-title">
                        <span class="project-marker" style="background-color: ${proj.color}"></span>
                        ${proj.name}
                    </div>
                    <span class="metric-value metric-value--success">${formatProjectDuration(ms)}</span>
                </div>
                <div class="progress-track progress-track--thin">
                    <div class="progress-fill" style="background-color: ${proj.color}; width: ${pct}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

// Render project cards on portfolio page using historical logged totals.
async function renderProjectsPage() {
    let allTimeEntries = null;
    try {
        const response = await fetch(`${API_BASE}/time-entries?date=all`);
        if (!response.ok) {
            throw new Error('Failed to fetch all-time project entries');
        }
        allTimeEntries = await response.json();
    } catch (error) {
        console.error('Error fetching all-time project totals:', error);
    }

    const hasHistoricalTotals = Array.isArray(allTimeEntries);
    const projectDurations = {};
    if (hasHistoricalTotals) {
        allTimeEntries.forEach(entry => {
            const duration = getProjectTimeEntryDurationMs(entry);
            if (duration <= 0) return;
            if (!projectDurations[entry.projectId]) {
                projectDurations[entry.projectId] = 0;
            }
            projectDurations[entry.projectId] += duration;
        });
    }

    const formatHoursMins = (ms) => {
        if (!hasHistoricalTotals) {
            return 'Unavailable';
        }
        const totalMins = Math.floor((ms || 0) / (60 * 1000));
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        return `${hours}h ${mins}m`;
    };

    DOM.elProjectsPageGrid.innerHTML = state.projects.map(proj => {
        const isDefault = false; // Internal Admin can now be edited and deleted like a normal project!
        const ms = projectDurations[proj.id] || 0;

        // Pricing / Financial values calculations
        const currencySymbol = proj.currency || '$';
        let earningsHTML = '';

        if (proj.rateType === 'hourly') {
            const earningsText = hasHistoricalTotals
                ? `${currencySymbol}${((ms / (60 * 60 * 1000)) * (proj.hourlyRate || 0)).toFixed(2)}`
                : 'Unavailable';
            earningsHTML = `
                <div class="project-card-metric project-card-metric--end">
                    <span class="metric-label">Total Earnings</span>
                    <span class="metric-value ${hasHistoricalTotals ? 'metric-value--success' : 'metric-value--muted'}">${earningsText}</span>
                    <span class="metric-helper">(${currencySymbol}${proj.hourlyRate || 0}/hr rate)</span>
                </div>
            `;
        } else if (proj.rateType === 'fixed') {
            earningsHTML = `
                <div class="project-card-metric project-card-metric--end">
                    <span class="metric-label">Fixed Budget</span>
                    <span class="metric-value text-accent">${currencySymbol}${proj.fixedRate || 0}</span>
                    <span class="metric-helper">Project fixed pricing</span>
                </div>
            `;
        }

        return `
            <div class="project-card p-5 flex flex-col gap-4 relative">
                <div class="flex items-center justify-between">
                    <div class="card-title-row">
                        <span class="project-marker project-marker--large" style="background-color: ${proj.color};"></span>
                        <h3 class="card-title">
                            ${proj.name}
                            ${isDefault ? '<i class="ph-fill ph-lock shrink-0" title="Protected System Default"></i>' : ''}
                        </h3>
                    </div>
                </div>

                <div class="project-card-body">
                    <div class="project-card-metric">
                        <span class="metric-label">Total Logged</span>
                        <span class="metric-value">${formatHoursMins(ms)}</span>
                    </div>
                    ${earningsHTML}
                </div>

                <div class="card-actions z-20">
                    <button class="button-secondary"
                            onclick="openProjectDetails('${proj.id}')">
                        <i class="ph ph-folder-open"></i> Details
                    </button>
                    ${isDefault ? '' : `
                    <button class="button-danger"
                            onclick="deleteProjectInline('${proj.id}')">
                        <i class="ph ph-trash-simple"></i> Delete
                    </button>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

// Inline edit a project
function editProjectInline(id) {
    openProjectDetails(id, { tab: 'settings' });
}

// Inline delete a project
function deleteProjectInline(id) {
    const proj = state.projects.find(p => p.id === id);
    if (!proj) return;

    showCustomConfirm({
        title: 'Delete Project',
        message: `"${proj.name}" will be removed. All time entries for this project will be reassigned.`,
        actionText: 'Delete',
        actionClass: 'button-danger',
        onConfirm: async () => {
            try {
                const res = await fetch(`${API_BASE}/projects/${id}`, {
                    method: 'DELETE'
                });

                if (res.ok) {
                    await fetchProjects();
                    await refreshData();
                } else {
                    alert('Failed to delete project');
                }
            } catch (err) {
                console.error('Error deleting project:', err);
            }
        }
    });
}

// Shows or hides rate fields based on chosen rate type
function toggleProjectRateFields() {
    const rateTypeSelect = document.getElementById('project-rate-type');
    const containerHourly = document.getElementById('project-hourly-rate-container');
    const containerFixed = document.getElementById('project-fixed-rate-container');
    const containerCurrency = document.getElementById('project-currency-container');

    if (!rateTypeSelect) return;

    if (rateTypeSelect.value === 'hourly') {
        if (containerHourly) containerHourly.classList.remove('hidden');
        if (containerFixed) containerFixed.classList.add('hidden');
        if (containerCurrency) containerCurrency.classList.remove('hidden');
    } else if (rateTypeSelect.value === 'fixed') {
        if (containerHourly) containerHourly.classList.add('hidden');
        if (containerFixed) containerFixed.classList.remove('hidden');
        if (containerCurrency) containerCurrency.classList.remove('hidden');
    } else {
        if (containerHourly) containerHourly.classList.add('hidden');
        if (containerFixed) containerFixed.classList.add('hidden');
        if (containerCurrency) containerCurrency.classList.add('hidden');
    }
}

// Initialize the project identity color picker UI.
function renderPresetColorGrid() {
    const container = document.getElementById('project-colors-grid');
    if (!container) return;

    container.innerHTML = PRESET_COLORS.map(color => {
        return `
            <button type="button"
                    class="color-ring"
                    style="background-color: ${color};"
                    data-color="${color}"
                    title="${color}">
            </button>
        `;
    }).join('');

    // Bind click events to color buttons
    container.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const color = btn.getAttribute('data-color');
            DOM.elProjColor.value = color;
            highlightSelectedColorCircle(color);
        });
    });
}

// Highlights chosen circle in preset colors grid
function highlightSelectedColorCircle(color) {
    const container = document.getElementById('project-colors-grid');
    if (!container) return;

    container.querySelectorAll('button').forEach(btn => {
        const btnColor = btn.getAttribute('data-color');
        if (btnColor.toLowerCase() === color.toLowerCase()) {
            btn.className = 'color-ring selected';
        } else {
            btn.className = 'color-ring';
        }
    });
}

function setProjectDetailsTab(tab = 'overview') {
    const safeTab = ['overview', 'settings'].includes(tab) ? tab : 'overview';
    document.querySelectorAll?.('[data-project-details-tab]')?.forEach(button => {
        const isActive = button.getAttribute('data-project-details-tab') === safeTab;
        button.classList.toggle('app-tab--active', isActive);
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll?.('[data-project-details-panel]')?.forEach(panel => {
        panel.classList.toggle('hidden', panel.getAttribute('data-project-details-panel') !== safeTab);
    });
}

function highlightProjectDetailsColorCircle(color) {
    const container = document.getElementById('proj-details-colors-grid');
    if (!container) return;

    container.querySelectorAll('button').forEach(btn => {
        const btnColor = btn.getAttribute('data-color');
        btn.className = btnColor?.toLowerCase() === String(color || '').toLowerCase()
            ? 'color-ring selected'
            : 'color-ring';
    });
}

function renderProjectDetailsColorGrid(selectedColor = '#3b82f6') {
    const container = document.getElementById('proj-details-colors-grid');
    const input = document.getElementById('proj-details-color-input');
    if (!container) return;

    container.innerHTML = PRESET_COLORS.map(color => `
        <button type="button"
                class="color-ring"
                style="background-color: ${color};"
                data-color="${color}"
                title="${color}">
        </button>
    `).join('');

    container.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', event => {
            event.stopPropagation();
            const color = btn.getAttribute('data-color');
            if (input) input.value = color;
            highlightProjectDetailsColorCircle(color);
        });
    });

    if (input) input.value = selectedColor || '#3b82f6';
    highlightProjectDetailsColorCircle(selectedColor || '#3b82f6');
}

function toggleProjectDetailsRateFields() {
    const rateTypeSelect = document.getElementById('proj-details-rate-type');
    const containerHourly = document.getElementById('proj-details-hourly-rate-container');
    const containerFixed = document.getElementById('proj-details-fixed-rate-container');
    const containerCurrency = document.getElementById('proj-details-currency-container');
    const rateType = rateTypeSelect?.value || 'none';

    containerHourly?.classList?.toggle('hidden', rateType !== 'hourly');
    containerFixed?.classList?.toggle('hidden', rateType !== 'fixed');
    containerCurrency?.classList?.toggle('hidden', rateType === 'none');
}

function populateProjectDetailsSettings(project) {
    if (!project) return;

    const elName = document.getElementById('proj-details-name');
    const elDescription = document.getElementById('proj-details-description');
    const elColorInput = document.getElementById('proj-details-color-input');
    const elRateType = document.getElementById('proj-details-rate-type');
    const elHourlyRate = document.getElementById('proj-details-hourly-rate');
    const elFixedRate = document.getElementById('proj-details-fixed-rate');
    const elCurrency = document.getElementById('proj-details-currency');
    const elStatus = document.getElementById('proj-details-settings-status');

    if (elName) elName.value = project.name || '';
    if (elDescription) elDescription.value = String(project.description || '');
    if (elColorInput) elColorInput.value = project.color || '#3b82f6';
    if (elRateType) elRateType.value = project.rateType || 'none';
    if (elHourlyRate) elHourlyRate.value = project.hourlyRate || '';
    if (elFixedRate) elFixedRate.value = project.fixedRate || '';
    if (elCurrency) elCurrency.value = project.currency || '$';
    if (elStatus) elStatus.textContent = '';

    renderProjectDetailsColorGrid(project.color || '#3b82f6');
    toggleProjectDetailsRateFields();
    window.refreshCustomSelects?.(document.getElementById('project-details-modal'));
}

function readProjectDetailsSettingsPayload() {
    const elName = document.getElementById('proj-details-name');
    const elDescription = document.getElementById('proj-details-description');
    const elColorInput = document.getElementById('proj-details-color-input');
    const elRateType = document.getElementById('proj-details-rate-type');
    const elHourlyRate = document.getElementById('proj-details-hourly-rate');
    const elFixedRate = document.getElementById('proj-details-fixed-rate');
    const elCurrency = document.getElementById('proj-details-currency');
    const rateType = elRateType?.value || 'none';

    return {
        name: String(elName?.value || '').trim(),
        description: String(elDescription?.value || '').trim(),
        color: elColorInput?.value || '#3b82f6',
        billable: rateType === 'hourly' || rateType === 'fixed',
        rateType,
        hourlyRate: elHourlyRate?.value ? parseFloat(elHourlyRate.value) : 0,
        fixedRate: elFixedRate?.value ? parseFloat(elFixedRate.value) : 0,
        currency: elCurrency?.value || '$'
    };
}

async function saveProjectDetailsSettings(projectId) {
    const payload = readProjectDetailsSettingsPayload();
    if (!payload.name) {
        alert('Please enter a project name.');
        return null;
    }

    const status = document.getElementById('proj-details-settings-status');
    if (status) status.textContent = 'Saving...';

    try {
        const response = await fetch(`${API_BASE}/projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error('Failed to save project');
        }

        const updatedProject = await response.json();
        const index = state.projects.findIndex(project => project.id === projectId);
        if (index !== -1) {
            state.projects[index] = updatedProject;
        }

        const project = index !== -1 ? state.projects[index] : updatedProject;
        const elColor = document.getElementById('proj-details-color');
        const elTitle = document.getElementById('proj-details-title');
        if (elColor) elColor.style.backgroundColor = project.color;
        if (elTitle) elTitle.innerText = project.name;

        populateProjectDetailsSettings(project);
        if (status) status.textContent = 'Saved.';
        if (state.currentView === 'projects' && window.renderProjectsPage) {
            renderProjectsPage();
        }
        return project;
    } catch (error) {
        console.error('Error saving project settings:', error);
        if (status) status.textContent = 'Unable to save project settings.';
        alert('Failed to save project');
        return null;
    }
}

function resetProjectDetailsSettings(projectId) {
    const project = state.projects.find(p => p.id === projectId);
    if (project) populateProjectDetailsSettings(project);
}

function closeProjectDetailsModal() {
    if (currentProjectDetailsId) {
        flushProjectTaskNameEdits(currentProjectDetailsId);
    }
    if (currentProjectDetailsId) {
        resetProjectDetailsSettings(currentProjectDetailsId);
    }
    document.getElementById('project-details-modal')?.classList?.add('hidden');
}

// Open and populate the Project Details Modal
async function openProjectDetails(projectId, options = {}) {
    const proj = state.projects.find(p => p.id === projectId);
    if (!proj) return;
    currentProjectDetailsId = projectId;

    // Reset manual form inputs
    const elManualDate = document.getElementById('proj-details-manual-date');
    const elManualHours = document.getElementById('proj-details-manual-hours');
    const elManualMinutes = document.getElementById('proj-details-manual-minutes');
    const elManualDescription = document.getElementById('proj-details-manual-description');
    const elTaskName = document.getElementById('proj-details-task-name');
    const btnTaskAddToggle = document.getElementById('proj-details-task-add-toggle');
    const btnTaskAdd = document.getElementById('proj-details-task-add');
    const btnTaskCancel = document.getElementById('proj-details-task-cancel');
    const formContainer = document.getElementById('proj-details-manual-form-container');
    const formCaret = document.getElementById('proj-details-form-caret');

    if (elManualDate) {
        const today = new Date();
        if (typeof window.setProjectManualDate === 'function') {
            window.setProjectManualDate(today);
        } else {
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            elManualDate.value = `${yyyy}-${mm}-${dd}`;
        }
    }
    if (elManualHours) elManualHours.value = '';
    if (elManualMinutes) elManualMinutes.value = '';
    if (elManualDescription) elManualDescription.value = '';
    populateProjectDetailsSettings(proj);
    if (elTaskName) elTaskName.value = '';
    setProjectTaskCreateVisible(false);
    if (formContainer) formContainer.classList.add('hidden');
    if (formCaret) {
        formCaret.style.transform = 'rotate(0deg)';
        formCaret.style.transition = 'transform 0.2s ease';
    }

    const toggleBtn = document.getElementById('proj-details-toggle-manual-form');
    if (toggleBtn) {
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            if (formContainer) {
                const isHidden = formContainer.classList.contains('hidden');
                if (isHidden) {
                    formContainer.classList.remove('hidden');
                    if (formCaret) formCaret.style.transform = 'rotate(180deg)';
                } else {
                    formContainer.classList.add('hidden');
                    if (formCaret) formCaret.style.transform = 'rotate(0deg)';
                }
            }
        };
    }

    const cancelBtn = document.getElementById('proj-details-manual-cancel');
    if (cancelBtn) {
        cancelBtn.onclick = (e) => {
            e.stopPropagation();
            if (formContainer) formContainer.classList.add('hidden');
            if (formCaret) formCaret.style.transform = 'rotate(0deg)';
        };
    }

    if (btnTaskAddToggle) {
        btnTaskAddToggle.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            setProjectTaskCreateVisible(true);
        };
    }
    if (btnTaskAdd) {
        btnTaskAdd.onclick = (e) => addProjectTask(e, projectId);
    }
    if (btnTaskCancel) {
        btnTaskCancel.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            setProjectTaskCreateVisible(false);
        };
    }
    if (elTaskName) {
        elTaskName.onkeydown = (e) => {
            if (e.key === 'Enter') {
                addProjectTask(e, projectId);
            } else if (e.key === 'Escape') {
                e.stopPropagation();
                setProjectTaskCreateVisible(false);
            }
        };
    }

    document.querySelectorAll?.('[data-project-details-tab]')?.forEach(button => {
        button.onclick = event => {
            event.stopPropagation();
            setProjectDetailsTab(button.getAttribute('data-project-details-tab'));
        };
    });

    const rateTypeSelect = document.getElementById('proj-details-rate-type');
    if (rateTypeSelect) {
        rateTypeSelect.onchange = () => {
            toggleProjectDetailsRateFields();
            window.refreshCustomSelects?.(document.getElementById('project-details-modal'));
        };
    }

    const settingsSave = document.getElementById('proj-details-settings-save');
    if (settingsSave) {
        settingsSave.onclick = event => {
            event.stopPropagation();
            event.preventDefault();
            saveProjectDetailsSettings(projectId);
        };
    }

    const settingsCancel = document.getElementById('proj-details-settings-cancel');
    if (settingsCancel) {
        settingsCancel.onclick = event => {
            event.stopPropagation();
            event.preventDefault();
            closeProjectDetailsModal();
        };
    }

    const saveBtn = document.getElementById('proj-details-manual-save');
    if (saveBtn) {
        saveBtn.onclick = async (e) => {
            e.stopPropagation();
            e.preventDefault();

            const dateStr = elManualDate ? elManualDate.value : '';
            const hoursVal = elManualHours ? parseInt(elManualHours.value, 10) || 0 : 0;
            const minsVal = elManualMinutes ? parseInt(elManualMinutes.value, 10) || 0 : 0;
            const description = elManualDescription ? elManualDescription.value.trim() : '';

            if (!dateStr) {
                alert("Please select a date.");
                return;
            }
            if (hoursVal <= 0 && minsVal <= 0) {
                alert("Please enter a duration (hours and/or minutes).");
                return;
            }
            if (hoursVal < 0 || minsVal < 0) {
                alert("Duration values cannot be negative.");
                return;
            }

            // Create start and end timestamps
            // Default start time to 09:00 AM local time on that day
            const startObj = new Date(`${dateStr}T09:00:00`);
            if (isNaN(startObj.getTime())) {
                alert("Invalid date selection.");
                return;
            }

            const startTimestamp = startObj.getTime();
            const durationMs = (hoursVal * 3600000) + (minsVal * 60000);
            const endTimestamp = startTimestamp + durationMs;

            const payload = {
                start: startTimestamp,
                end: endTimestamp,
                projectId: projectId,
                description: description || "Imported historic time log",
                billable: proj.billable
            };

            try {
                const response = await fetch(`${API_BASE}/time-entries`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    // Collapse and reload modal and timeline stats
                    if (formContainer) formContainer.classList.add('hidden');
                    if (formCaret) formCaret.style.transform = 'rotate(0deg)';

                    // Reload modal contents
                    await openProjectDetails(projectId, { tab: 'overview' });

                    // Refresh main workspace datasets
                    if (window.refreshData) {
                        await window.refreshData();
                    }
                } else {
                    alert("Failed to save manual time entry.");
                }
            } catch (err) {
                console.error("Error saving manual time entry:", err);
                alert("An error occurred while saving the time entry.");
            }
        };
    }

    const historyPrev = document.getElementById('proj-details-time-history-prev-month');
    const historyNext = document.getElementById('proj-details-time-history-next-month');
    if (historyPrev) {
        historyPrev.onclick = (event) => {
            event.stopPropagation();
            shiftProjectTimeHistoryMonth(-1);
        };
    }
    if (historyNext) {
        historyNext.onclick = (event) => {
            event.stopPropagation();
            shiftProjectTimeHistoryMonth(1);
        };
    }

    // Header color & Title
    const elColor = document.getElementById('proj-details-color');
    const elTitle = document.getElementById('proj-details-title');
    if (elColor) elColor.style.backgroundColor = proj.color;
    if (elTitle) elTitle.innerText = proj.name;

    const currencySymbol = proj.currency || '$';

    // Fetch all historical entries
    let entries = [];
    try {
        const res = await fetch(`${API_BASE}/time-entries?date=all`);
        if (res.ok) {
            entries = await res.json();
        }
    } catch (e) {
        console.error("Error fetching historical entries:", e);
    }

    // Filter for this project
    const projEntries = entries.filter(e => e.projectId === projectId)
        .sort((a, b) => b.start - a.start); // Chronological desc (latest first)
    currentProjectDetailEntries = projEntries;
    renderProjectTasks(proj, projEntries);
    renderProjectTimeHistoryCalendar(projectId, projEntries);

    // Calculate sum metrics
    const totalMs = projEntries.reduce((sum, e) => sum + getProjectTimeEntryDurationMs(e), 0);

    // Formatting total duration
    const totalHrs = totalMs / (60 * 60 * 1000);
    const displayHrs = Math.floor(totalHrs);
    const displayMins = Math.round((totalHrs - displayHrs) * 60);
    const totalDurationStr = `${displayHrs}h ${displayMins}m`;

    // Billing type and total earnings
    let billingTypeStr = 'Non-Billable';
    let totalEarningsVal = 0;
    if (proj.rateType === 'hourly') {
        billingTypeStr = `Hourly (${currencySymbol}${proj.hourlyRate || 0}/hr)`;
        totalEarningsVal = totalHrs * (proj.hourlyRate || 0);
    } else if (proj.rateType === 'fixed') {
        billingTypeStr = `Fixed Rate (${currencySymbol}${proj.fixedRate || 0})`;
        totalEarningsVal = proj.fixedRate || 0;
    } else {
        billingTypeStr = 'No Billing Rate';
    }

    const totalEarningsStr = `${currencySymbol}${totalEarningsVal.toFixed(2)}`;

    // Set text contents
    const elTotalDuration = document.getElementById('proj-details-total-duration');
    const elBillingType = document.getElementById('proj-details-billing-type');
    const elTotalEarnings = document.getElementById('proj-details-total-earnings');

    if (elTotalDuration) elTotalDuration.innerText = totalDurationStr;
    if (elBillingType) elBillingType.innerText = billingTypeStr;
    if (elTotalEarnings) {
        elTotalEarnings.innerText = totalEarningsStr;
        if (proj.rateType === 'hourly' || proj.rateType === 'fixed') {
            elTotalEarnings.className = 'metric-value metric-value--success';
        } else {
            elTotalEarnings.className = 'metric-value metric-value--muted';
        }
    }

    // Modal show
    const modal = document.getElementById('project-details-modal');
    if (modal) {
        setProjectDetailsTab(options.tab || 'overview');
        modal.classList.remove('hidden');

        // Bind close event handlers once
        const btnClose = document.getElementById('proj-details-btn-close');
        if (btnClose) btnClose.onclick = closeProjectDetailsModal;
    }
}

// Expose functions to window namespace
window.recalculateStatistics = recalculateStatistics;
window.renderProjectsPage = renderProjectsPage;
window.editProjectInline = editProjectInline;
window.deleteProjectInline = deleteProjectInline;
window.toggleProjectRateFields = toggleProjectRateFields;
window.renderPresetColorGrid = renderPresetColorGrid;
window.highlightSelectedColorCircle = highlightSelectedColorCircle;
window.populateProjectDetailsSettings = populateProjectDetailsSettings;
window.saveProjectDetailsSettings = saveProjectDetailsSettings;
window.resetProjectDetailsSettings = resetProjectDetailsSettings;
window.closeProjectDetailsModal = closeProjectDetailsModal;
window.toggleProjectDetailsRateFields = toggleProjectDetailsRateFields;
window.setProjectDetailsTab = setProjectDetailsTab;
window.openProjectDetails = openProjectDetails;
window.addProjectTask = addProjectTask;
window.setProjectTaskCreateVisible = setProjectTaskCreateVisible;
window.saveProjectTaskNameOnBlur = saveProjectTaskNameOnBlur;
window.handleProjectTaskNameKeydown = handleProjectTaskNameKeydown;
window.flushProjectTaskNameEdits = flushProjectTaskNameEdits;
window.archiveProjectTask = archiveProjectTask;
window.deleteProjectTask = deleteProjectTask;
window.setupProjectDescriptionAutosave = setupProjectDescriptionAutosave;
window.flushProjectDescriptionAutosave = flushProjectDescriptionAutosave;
window.getProjectEntryDescriptionHTML = getProjectEntryDescriptionHTML;
window.buildProjectTimeHistoryDayMap = buildProjectTimeHistoryDayMap;
window.formatProjectTimeHistoryDuration = formatProjectTimeHistoryDuration;
window.resolveProjectTimeHistoryInitialMonth = resolveProjectTimeHistoryInitialMonth;
window.renderProjectTimeHistoryCalendar = renderProjectTimeHistoryCalendar;
window.openProjectTimeHistoryDay = openProjectTimeHistoryDay;
window.PRESET_COLORS = PRESET_COLORS;
