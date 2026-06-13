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

let editingProjectTaskId = null;
let currentProjectDetailEntries = [];

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
        alert('Failed to save project task');
        return null;
    }

    const updatedProject = await response.json();
    const index = state.projects.findIndex(project => project.id === projectId);
    if (index !== -1) {
        state.projects[index] = updatedProject;
    }
    return updatedProject;
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

function renderProjectTasks(project, projectEntries = []) {
    const list = document.getElementById('proj-details-tasks-list');
    if (!list) return;

    const activeTasks = getProjectTasks(project).filter(task => !task.archived);
    if (activeTasks.length === 0) {
        list.innerHTML = '<div class="empty-state empty-state--spacious">No tasks yet.</div>';
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

        if (task.id === editingProjectTaskId) {
            return `
                <div class="surface-panel project-task-row project-task-row--editing">
                    <input type="text"
                           class="field flex-1 min-w-0"
                           value="${taskName}"
                           data-project-task-edit="${taskId}"
                           onkeydown="handleProjectTaskRenameKeydown(event, '${projectId}', '${taskId}')">
                    <button type="button"
                            class="button-primary shrink-0"
                            title="Save task name"
                            onclick="saveProjectTaskRename(event, '${projectId}', '${taskId}')">
                        <i class="ph ph-check"></i>
                    </button>
                    <button type="button"
                            class="button-secondary shrink-0"
                            title="Cancel rename"
                            onclick="cancelProjectTaskRename(event, '${projectId}')">
                        <i class="ph ph-x"></i>
                    </button>
                </div>
            `;
        }

        return `
            <div class="surface-panel project-task-row">
                <div class="flex-1 min-w-0">
                    <div class="project-task-name">${taskName}</div>
                    <div class="project-task-meta">${loggedDuration} logged</div>
                </div>
                <button type="button"
                        class="button-secondary shrink-0"
                        title="Rename task"
                        onclick="startProjectTaskRename(event, '${projectId}', '${taskId}')">
                    <i class="ph ph-pencil-simple-line"></i>
                </button>
                <button type="button"
                        class="button-secondary shrink-0"
                        title="Archive task"
                        onclick="archiveProjectTask(event, '${projectId}', '${taskId}')">
                    <i class="ph ph-archive"></i>
                </button>
            </div>
        `;
    }).join('');

    const editInput = list.querySelector('[data-project-task-edit]');
    if (editInput) {
        editInput.focus();
        editInput.select();
    }
}

async function addProjectTask(event, projectId) {
    event?.stopPropagation();
    event?.preventDefault();

    const input = document.getElementById('proj-details-task-name');
    const name = input ? input.value.trim() : '';
    if (!name) {
        alert('Please enter a task name.');
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
    await openProjectDetails(projectId);
    if (typeof renderModalTaskSelect === 'function') {
        renderModalTaskSelect('', projectId);
    }
    if (state.currentView === 'projects' && window.renderProjectsPage) {
        renderProjectsPage();
    }
}

function startProjectTaskRename(event, projectId, taskId) {
    event?.stopPropagation();
    event?.preventDefault();

    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;

    editingProjectTaskId = taskId;
    renderProjectTasks(project, currentProjectDetailEntries);
}

async function saveProjectTaskRename(event, projectId, taskId) {
    event?.stopPropagation();
    event?.preventDefault();

    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;

    const input = Array.from(document.querySelectorAll('[data-project-task-edit]'))
        .find(element => element.dataset.projectTaskEdit === taskId);
    const name = input ? input.value.trim() : '';
    if (!name) {
        alert('Please enter a task name.');
        return;
    }

    const tasks = getProjectTasks(project).map(task =>
        task.id === taskId ? { ...task, name } : task
    );
    const updatedProject = await saveProjectTasks(projectId, tasks);
    if (!updatedProject) return;

    editingProjectTaskId = null;
    await openProjectDetails(projectId);
    if (typeof renderModalTaskSelect === 'function') {
        renderModalTaskSelect('', projectId);
    }
    if (state.currentView === 'projects' && window.renderProjectsPage) {
        renderProjectsPage();
    }
}

function cancelProjectTaskRename(event, projectId) {
    event?.stopPropagation();
    event?.preventDefault();

    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;

    editingProjectTaskId = null;
    renderProjectTasks(project, currentProjectDetailEntries);
}

function handleProjectTaskRenameKeydown(event, projectId, taskId) {
    if (event.key === 'Enter') {
        saveProjectTaskRename(event, projectId, taskId);
    } else if (event.key === 'Escape') {
        cancelProjectTaskRename(event, projectId);
    }
}

async function archiveProjectTask(event, projectId, taskId) {
    event?.stopPropagation();
    event?.preventDefault();

    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;

    const tasks = getProjectTasks(project).map(task =>
        task.id === taskId ? { ...task, archived: true } : task
    );
    const updatedProject = await saveProjectTasks(projectId, tasks);
    if (!updatedProject) return;
    await openProjectDetails(projectId);
    if (typeof renderModalTaskSelect === 'function') {
        renderModalTaskSelect('', projectId);
    }
    if (state.currentView === 'projects' && window.renderProjectsPage) {
        renderProjectsPage();
    }
}

// Recalculates stats, charts, and projects breakdown on the right panel
function recalculateStatistics() {
    // 1. Recorded active time includes short timeline-owned activity segments.
    const capturedActivities = Array.isArray(state.timelineActivities)
        ? state.timelineActivities
        : state.activities;
    const totalActiveMs = capturedActivities.reduce(
        (total, activity) => total + Math.max(0, activity.end - activity.start),
        0
    );

    const formatHoursMins = (ms) => {
        const totalMins = Math.floor(ms / (60 * 1000));
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        return `${hours}h ${mins}m`;
    };

    DOM.elStatCapturedActive.innerText = formatHoursMins(totalActiveMs);

    // 2. Time Entries (Logged Projects Calculation)
    let totalProjectMs = 0;
    let totalBillableMs = 0;
    let totalNonBillableMs = 0;

    const projectDurations = {}; // Keep map of project ID to total logged duration

    for (const entry of state.timeEntries) {
        const duration = getProjectTimeEntryDurationMs(entry);
        if (duration <= 0) continue;
        totalProjectMs += duration;

        if (entry.billable) {
            totalBillableMs += duration;
        } else {
            totalNonBillableMs += duration;
        }

        if (!projectDurations[entry.projectId]) {
            projectDurations[entry.projectId] = 0;
        }
        projectDurations[entry.projectId] += duration;
    }

    DOM.elStatProjectTotal.innerText = formatHoursMins(totalProjectMs);

    // Safety check for getElStatBillable vs elStatBillable in state.js
    const elBillableNode = DOM.getElStatBillable || document.getElementById('stat-billable');
    if (elBillableNode) elBillableNode.innerText = formatHoursMins(totalBillableMs);
    if (DOM.elStatNonbillable) DOM.elStatNonbillable.innerText = formatHoursMins(totalNonBillableMs);

    // Project bar visual update relative to recorded active time.
    const projectPct = totalActiveMs > 0 ? Math.min(100, Math.round((totalProjectMs / totalActiveMs) * 100)) : 0;
    DOM.elBarProject.style.width = `${projectPct}%`;

    // 3. Projects Breakdown render
    const projectIds = Object.keys(projectDurations);
    if (projectIds.length === 0) {
        DOM.elProjectsList.innerHTML = `
            <div class="empty-state empty-state--spacious">
                No time entries logged for this day. Click and drag in the scheduler to create one!
            </div>
        `;
        return;
    }

    DOM.elProjectsList.innerHTML = projectIds.map(pid => {
        const proj = state.projects.find(p => p.id === pid) || { name: 'Unknown Project', color: '#4b5563', billable: false };
        const ms = projectDurations[pid];
        const pct = totalProjectMs > 0 ? Math.round((ms / totalProjectMs) * 100) : 0;

        return `
            <div class="surface-panel project-breakdown-card">
                <div class="project-breakdown-header">
                    <div class="project-breakdown-title">
                        <span class="project-marker" style="background-color: ${proj.color}"></span>
                        ${proj.name}
                    </div>
                    <span class="metric-value metric-value--success">${formatHoursMins(ms)}</span>
                </div>
                <div class="progress-track progress-track--thin">
                    <div class="progress-fill" style="background-color: ${proj.color}; width: ${pct}%"></div>
                </div>
                <div class="project-breakdown-footer">
                    <span>Contribution</span>
                    <span>${pct}%</span>
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
        } else {
            earningsHTML = `
                <div class="project-card-metric project-card-metric--end">
                    <span class="metric-label">Financial Mode</span>
                    <span class="metric-value metric-value--muted">No billing rate set</span>
                </div>
            `;
        }

        return `
            <div class="project-card p-5 flex flex-col gap-4 relative cursor-pointer"
                 onclick="openProjectDetails('${proj.id}')">
                <div class="flex items-center justify-between">
                    <div class="card-title-row">
                        <span class="project-marker project-marker--large" style="background-color: ${proj.color};"></span>
                        <h3 class="card-title">
                            ${proj.name}
                            ${isDefault ? '<i class="ph-fill ph-lock shrink-0" title="Protected System Default"></i>' : ''}
                        </h3>
                    </div>
                    <span class="status-pill shrink-0 ${
                        proj.billable
                        ? 'status-pill--success'
                        : ''
                    }">
                        ${proj.billable ? 'Billable' : 'Non-Billable'}
                    </span>
                </div>

                <div class="border-t my-0.5" style="border-color: var(--border);"></div>

                <div class="project-card-body">
                    <div class="project-card-metric">
                        <span class="metric-label">Total Logged</span>
                        <span class="metric-value">${formatHoursMins(ms)}</span>
                    </div>
                    ${earningsHTML}
                </div>

                <div class="card-actions z-20">
                    <button class="button-secondary"
                            onclick="event.stopPropagation(); editProjectInline('${proj.id}')">
                        <i class="ph ph-pencil-simple-line"></i> Edit
                    </button>
                    ${isDefault ? '' : `
                    <button class="button-danger"
                            onclick="event.stopPropagation(); deleteProjectInline('${proj.id}')">
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
    const proj = state.projects.find(p => p.id === id);
    if (!proj) return;

    window.editingProjectId = id;
    DOM.elProjName.value = proj.name;
    DOM.elProjColor.value = proj.color;
    DOM.elProjBillable.checked = proj.billable;

    // Select rate type and fill rates
    const rateTypeSelect = document.getElementById('project-rate-type');
    const hourlyRateInput = document.getElementById('project-hourly-rate');
    const fixedRateInput = document.getElementById('project-fixed-rate');
    const currencySelect = document.getElementById('project-currency');

    if (rateTypeSelect) rateTypeSelect.value = proj.rateType || 'none';
    if (hourlyRateInput) hourlyRateInput.value = proj.hourlyRate || '';
    if (fixedRateInput) fixedRateInput.value = proj.fixedRate || '';
    if (currencySelect) currencySelect.value = proj.currency || '$';

    // Trigger display toggle
    toggleProjectRateFields();
    window.refreshCustomSelects?.(DOM.elProjModal);

    // Highlight the selected circle color
    highlightSelectedColorCircle(proj.color);

    DOM.elProjModal.querySelector('h3').innerText = 'Edit Project';
    const btnSave = DOM.getElProjBtnSave || document.getElementById('project-btn-save');
    if (btnSave) btnSave.innerText = 'Save Changes';

    DOM.elProjModal.classList.remove('hidden');
}

// Inline delete a project
function deleteProjectInline(id) {
    const proj = state.projects.find(p => p.id === id);
    if (!proj) return;

    showCustomConfirm({
        title: 'Delete Project',
        message: `Are you sure you want to delete project "${proj.name}"? All time entries for this project will be reassigned.`,
        actionText: 'Delete Project',
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

// Open and populate the Project Details Modal
async function openProjectDetails(projectId) {
    const proj = state.projects.find(p => p.id === projectId);
    if (!proj) return;

    // Reset manual form inputs
    const elManualDate = document.getElementById('proj-details-manual-date');
    const elManualHours = document.getElementById('proj-details-manual-hours');
    const elManualMinutes = document.getElementById('proj-details-manual-minutes');
    const elManualDescription = document.getElementById('proj-details-manual-description');
    const elTaskName = document.getElementById('proj-details-task-name');
    const btnTaskAdd = document.getElementById('proj-details-task-add');
    const formContainer = document.getElementById('proj-details-manual-form-container');
    const formCaret = document.getElementById('proj-details-form-caret');

    if (elManualDate) {
        // Default to today's date in local YYYY-MM-DD format
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        elManualDate.value = `${yyyy}-\ ${mm}-\ ${dd}`.replace(/-\ /g, '-');
    }
    if (elManualHours) elManualHours.value = '';
    if (elManualMinutes) elManualMinutes.value = '';
    if (elManualDescription) elManualDescription.value = '';
    if (elTaskName) elTaskName.value = '';
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

    if (btnTaskAdd) {
        btnTaskAdd.onclick = (e) => addProjectTask(e, projectId);
    }
    if (elTaskName) {
        elTaskName.onkeydown = (e) => {
            if (e.key === 'Enter') {
                addProjectTask(e, projectId);
            }
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
                    await openProjectDetails(projectId);

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

    // Render list
    const elList = document.getElementById('proj-details-entries-list');
    if (elList) {
        if (projEntries.length === 0) {
            elList.innerHTML = `<div class="empty-state empty-state--spacious">No entries logged to this project yet.</div>`;
        } else {
            elList.innerHTML = projEntries.map(e => {
                const dateObj = new Date(e.start);
                const dateStr = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                const durMin = Math.round(getProjectTimeEntryDurationMs(e) / (60 * 1000));
                const task = getProjectTasks(proj).find(projectTask => projectTask.id === e.taskId);
                const taskLabel = task
                    ? `<span class="duration-pill shrink-0">${escapeProjectText(task.name)}</span>`
                    : '';

                let itemHrs = getProjectTimeEntryDurationMs(e) / (60 * 60 * 1000);
                let itemEarningsStr = '';
                if (proj.rateType === 'hourly') {
                    itemEarningsStr = `<span class="metric-value metric-value--success shrink-0">${currencySymbol}${(itemHrs * (proj.hourlyRate || 0)).toFixed(2)}</span>`;
                } else if (proj.rateType === 'fixed') {
                    itemEarningsStr = `<span class="metric-value text-accent shrink-0">Fixed</span>`;
                }

                return `
                    <div class="surface-panel project-entry-row">
                        <div class="project-entry-header">
                            <span class="project-entry-meta">${dateStr}</span>
                            <div class="project-entry-actions">
                                ${taskLabel}
                                <span class="duration-pill shrink-0">${durMin} min</span>
                                ${itemEarningsStr}
                                <button class="icon-button icon-button--danger" title="Delete entry" aria-label="Delete entry" onclick="deleteProjectDetailEntry(event, '${e.id}', '${projectId}')">
                                    <i class="ph ph-trash-simple text-sm"></i>
                                </button>
                            </div>
                        </div>
                        <p class="project-entry-description">${e.description || '<span class="project-entry-empty-description">No description provided</span>'}</p>
                    </div>
                `;
            }).join('');
        }
    }

    // Modal show
    const modal = document.getElementById('project-details-modal');
    if (modal) {
        modal.classList.remove('hidden');

        // Bind close event handlers once
        const btnClose = document.getElementById('proj-details-btn-close');
        const hideModal = () => modal.classList.add('hidden');

        if (btnClose) btnClose.onclick = hideModal;
    }
}

// Delete a specific time entry from the project details modal
function deleteProjectDetailEntry(event, entryId, projectId) {
    event.stopPropagation();
    event.preventDefault();

    showCustomConfirm({
        title: 'Delete Time Entry?',
        message: 'Are you sure you want to permanently delete this logged time entry?',
        actionText: 'Delete Entry',
        actionClass: 'button-danger',
        onConfirm: async () => {
            try {
                const res = await fetch(`${API_BASE}/time-entries/${entryId}`, {
                    method: 'DELETE'
                });

                if (res.ok) {
                    await openProjectDetails(projectId);
                    if (window.refreshData) {
                        await window.refreshData();
                    }
                } else {
                    alert('Failed to delete time entry');
                }
            } catch (err) {
                console.error('Error deleting time entry:', err);
            }
        }
    });
}

// Expose functions to window namespace
window.recalculateStatistics = recalculateStatistics;
window.renderProjectsPage = renderProjectsPage;
window.editProjectInline = editProjectInline;
window.deleteProjectInline = deleteProjectInline;
window.toggleProjectRateFields = toggleProjectRateFields;
window.renderPresetColorGrid = renderPresetColorGrid;
window.highlightSelectedColorCircle = highlightSelectedColorCircle;
window.openProjectDetails = openProjectDetails;
window.addProjectTask = addProjectTask;
window.startProjectTaskRename = startProjectTaskRename;
window.saveProjectTaskRename = saveProjectTaskRename;
window.cancelProjectTaskRename = cancelProjectTaskRename;
window.handleProjectTaskRenameKeydown = handleProjectTaskRenameKeydown;
window.archiveProjectTask = archiveProjectTask;
window.deleteProjectDetailEntry = deleteProjectDetailEntry;
window.PRESET_COLORS = PRESET_COLORS;
