// Shared confirmation modal presentation and behavior.
function showCustomConfirm({ title, message, actionText, actionClass, onConfirm }) {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const messageEl = document.getElementById('confirm-modal-message');
    const confirmBtn = document.getElementById('confirm-modal-btn-confirm');
    const cancelBtn = document.getElementById('confirm-modal-btn-cancel');
    
    if (!modal) return;
    
    titleEl.innerText = title || 'Are you sure?';
    messageEl.innerText = message || '';
    confirmBtn.innerText = actionText || 'Confirm';
    
    confirmBtn.className = actionClass || 'button-primary';
    
    confirmBtn.onclick = () => {
        modal.classList.add('hidden');
        if (onConfirm) onConfirm();
    };
    
    cancelBtn.onclick = () => {
        modal.classList.add('hidden');
    };
    
    modal.classList.remove('hidden');
}

function summarizeModalActivities(activities) {
    if (!activities || activities.length === 0) return [];
    if (typeof summarizeSimilarActivityOverlaps === 'function') {
        return summarizeSimilarActivityOverlaps(activities);
    }
    if (typeof summarizeActivityOverlaps === 'function') {
        return summarizeActivityOverlaps(activities);
    }
    return activities;
}

const MODAL_ACTIVITY_MIN_VISIBLE_DURATION_MS = 60 * 1000;
const MODAL_DURATION_MODE_RANGE = 'range';
const MODAL_DURATION_MODE_SELECTED_ACTIVITIES = 'selected-activities';

function getModalAssignmentActivityRange(entry, activity) {
    const start = Number.isFinite(activity?.assignmentStart)
        ? activity.assignmentStart
        : (Number.isFinite(activity?.start) ? activity.start : entry?.start);
    const end = Number.isFinite(activity?.assignmentEnd)
        ? activity.assignmentEnd
        : (Number.isFinite(activity?.end) ? activity.end : entry?.end);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
    }

    return { start, end };
}

function deriveModalActivityStreamActivities(entry, activities) {
    if (typeof buildActivityStreamAssignmentActivities !== 'function'
        || typeof getActivitySummaryKey !== 'function') {
        return activities;
    }

    const dateBasis = Number.isFinite(state.currentDate?.getTime?.())
        ? state.currentDate
        : new Date(entry?.start || activities?.[0]?.start || Date.now());
    const dateStartOfDay = new Date(dateBasis).setHours(0,0,0,0);
    const hasLegacyActivityStreamAssignment = (activities || []).some(activity => (
        activity?.assignmentSource === 'activity-stream'
        && activity.assignmentModel !== 'activity-stream-summary'
    ));
    if (hasLegacyActivityStreamAssignment && typeof buildActivityStreamRenderEntries === 'function') {
        return buildActivityStreamRenderEntries(entry, dateStartOfDay)
            .flatMap(renderEntry => Array.isArray(renderEntry.activities) ? renderEntry.activities : []);
    }

    const derivedActivities = [];

    for (const activity of activities || []) {
        if (activity?.assignmentSource !== 'activity-stream') {
            derivedActivities.push(activity);
            continue;
        }

        if (typeof isResolvedActivityStreamAssignmentRun === 'function'
            && isResolvedActivityStreamAssignmentRun(activity)) {
            derivedActivities.push(activity);
            continue;
        }

        const range = getModalAssignmentActivityRange(entry, activity);
        if (!range) {
            derivedActivities.push(activity);
            continue;
        }

        const renderActivities = buildActivityStreamAssignmentActivities(
            activity,
            range.start,
            range.end,
            getActivitySummaryKey(activity),
            dateStartOfDay
        );

        if (renderActivities.length > 0) {
            derivedActivities.push(...renderActivities);
        } else {
            derivedActivities.push(activity);
        }
    }

    return derivedActivities;
}

function getSelectedModalActivities() {
    const allActivities = state.currentModalAllActivities || state.currentModalActivities || [];
    const selection = state.modalActivitySelection;
    if (!selection || selection.size === 0) return [];
    return allActivities.filter((_, index) => selection.has(index));
}

function getModalActivityDurationMs(activity) {
    if (Number.isFinite(activity?.assignedDurationMs) && activity.assignedDurationMs > 0) {
        return activity.assignedDurationMs;
    }
    if (Number.isFinite(activity?.duration) && activity.duration > 0) {
        return activity.duration;
    }
    if (Number.isFinite(activity?.start) && Number.isFinite(activity?.end) && activity.end > activity.start) {
        return activity.end - activity.start;
    }
    return 0;
}

function isVisibleModalActivityCandidate(activity) {
    return getModalActivityDurationMs(activity) >= MODAL_ACTIVITY_MIN_VISIBLE_DURATION_MS;
}

function isAssignedModalActivity(activity) {
    return activity?.assignmentSource === 'activity-stream'
        || (Number.isFinite(activity?.assignedDurationMs) && activity.assignedDurationMs > 0);
}

function shouldUseSelectedModalActivityDuration(isBulk = window.isBulkAllocation) {
    return Boolean(isBulk)
        || state.currentModalDurationMode === MODAL_DURATION_MODE_SELECTED_ACTIVITIES;
}

function updateModalDurationLabel(startMs = state.currentModalStartMs, endMs = state.currentModalEndMs, isBulk = window.isBulkAllocation) {
    const selectedActivities = getSelectedModalActivities();
    const selectedDurationMs = shouldUseSelectedModalActivityDuration(isBulk)
        ? selectedActivities.reduce((total, activity) => total + getModalActivityDurationMs(activity), 0)
        : 0;
    const rangeDurationMs = Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, endMs - startMs)
        : 0;
    const durationMs = shouldUseSelectedModalActivityDuration(isBulk)
        ? selectedDurationMs
        : rangeDurationMs;
    const durationMinutes = Math.round(durationMs / (60 * 1000));

    DOM.elModalDuration.innerText = `${durationMinutes} min`;
}

function escapeModalText(value) {
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

function renderModalTaskSelect(selectedTaskId = '', projectId = DOM.elModalProjectSelect?.value || '') {
    const container = DOM.elModalTaskContainer;
    const select = DOM.elModalTaskSelect;
    if (!container || !select) return;

    const project = state.projects.find(p => p.id === projectId);
    const tasks = getProjectTasks(project);
    const activeTasks = tasks.filter(task => !task.archived);
    const selectedArchivedTask = selectedTaskId
        ? tasks.find(task => task.id === selectedTaskId && task.archived)
        : null;
    const visibleTasks = selectedArchivedTask
        ? [...activeTasks, selectedArchivedTask]
        : activeTasks;

    if (visibleTasks.length === 0) {
        select.innerHTML = '<option value="">No task</option>';
        select.value = '';
        container.classList.add('hidden');
        if (typeof refreshCustomSelects === 'function') refreshCustomSelects(container);
        return;
    }

    const taskOptions = visibleTasks.map(task => {
        const archivedLabel = task.archived ? ' (archived)' : '';
        return `<option value="${escapeModalText(task.id)}">${escapeModalText(task.name)}${archivedLabel}</option>`;
    }).join('');
    select.innerHTML = `<option value="">No task</option>${taskOptions}`;
    select.value = visibleTasks.some(task => task.id === selectedTaskId) ? selectedTaskId : '';
    container.classList.remove('hidden');
    if (typeof refreshCustomSelects === 'function') refreshCustomSelects(container);
}

function applyModalProjectSuggestion(activities) {
    if (!state.modalProjectAutoManaged) return;
    const matchedProjId = matchRulesForActivities(activities);
    if (matchedProjId) {
        DOM.elModalProjectSelect.value = matchedProjId;
    } else if (state.projects.length > 0 && !DOM.elModalProjectSelect.value) {
        DOM.elModalProjectSelect.value = state.projects[0].id;
    }

    const selectedProj = state.projects.find(p => p.id === DOM.elModalProjectSelect.value);
    DOM.elModalBillable.checked = selectedProj ? selectedProj.billable : false;
    renderModalProjectGrid(DOM.elModalProjectSelect.value);
    renderModalTaskSelect('', DOM.elModalProjectSelect.value);
}

function refreshModalActivitySelectionEffects() {
    state.currentModalActivities = getSelectedModalActivities();

    updateModalDurationLabel();
    applyModalProjectSuggestion(state.currentModalActivities);
}

function setModalActivityIncluded(index, included) {
    if (!state.modalActivitySelection) {
        state.modalActivitySelection = new Set();
    }

    if (included) {
        state.modalActivitySelection.add(index);
    } else {
        state.modalActivitySelection.delete(index);
    }

    const row = DOM.elModalMemoryAidList && typeof DOM.elModalMemoryAidList.querySelector === 'function'
        ? DOM.elModalMemoryAidList.querySelector(`[data-modal-activity-index="${index}"]`)
        : null;
    if (row) {
        row.classList.toggle('opacity-50', !included);
        row.classList.toggle('is-selected', included);
        const icon = row.querySelector('.modal-activity-toggle i');
        if (icon) {
            icon.className = included
                ? 'ph-fill ph-check-square text-base'
                : 'ph ph-square text-base';
        }
    }

    refreshModalActivitySelectionEffects();
}

function attachModalActivitySelectionHandlers() {
    if (!DOM.elModalMemoryAidList) return;
    DOM.elModalMemoryAidList.querySelectorAll('[data-modal-activity-index]').forEach(row => {
        row.addEventListener('click', (e) => {
            const index = parseInt(row.getAttribute('data-modal-activity-index'), 10);
            const nextIncluded = !state.modalActivitySelection.has(index);
            setModalActivityIncluded(index, nextIncluded);
            e.stopPropagation();
        });
    });
}

// Create or Edit time logs modal opening logic
function openTimeEntryModal(startMs, endMs, defaultDescription = '', defaultProjectId = null, defaultBillable = null, isBulk = false, rangeActivities = null, defaultTaskId = '') {
    window.isBulkAllocation = isBulk;
    const hasExplicitRangeActivities = Array.isArray(rangeActivities);
    const isDragCreatedActivityModal = hasExplicitRangeActivities
        && !isBulk
        && !window.editingTimeEntryId;

    // Handle assignment layout copy.
    if (isBulk) {
        DOM.elModalTitle.innerText = 'Assign Selected Activity';
    } else {
        DOM.elModalTitle.innerText = window.editingTimeEntryId ? 'Edit Time Entry' : 'Log Time Entry';
    }

    const formatTime = (ms) => {
        const date = new Date(ms);
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    };

    DOM.elModalStart.value = formatTime(startMs);
    DOM.elModalEnd.value = formatTime(endMs);
    state.currentModalStartMs = startMs;
    state.currentModalEndMs = endMs;

    // Populate current activities list for the left panel snapshot
    let finalActivities = [];
    if (hasExplicitRangeActivities && rangeActivities.length > 0) {
        finalActivities = rangeActivities;
    } else if (window.editingTimeEntryId) {
        const entry = state.timeEntries.find(ent => ent.id === window.editingTimeEntryId);
        if (entry && entry.activities && entry.activities.length > 0) {
            finalActivities = deriveModalActivityStreamActivities(entry, entry.activities);
        }
    }

    // Live scan of overlaps in state.activities if still empty
    if (finalActivities.length === 0 && !hasExplicitRangeActivities && startMs && endMs) {
        const scanOverlaps = [];
        for (const act of state.activities) {
            const overlapStart = Math.max(startMs, act.start);
            const overlapEnd = Math.min(endMs, act.end);
            if (overlapEnd > overlapStart) {
                scanOverlaps.push({ ...act, duration: (overlapEnd - overlapStart) });
            }
        }

        finalActivities = summarizeModalActivities(scanOverlaps);
    }

    if (!isBulk) {
        finalActivities = summarizeModalActivities(finalActivities);
    }
    if (isDragCreatedActivityModal) {
        finalActivities = finalActivities.filter(isVisibleModalActivityCandidate);
    }
    const shouldUseSelectedDuration = isBulk
        || finalActivities.some(isAssignedModalActivity)
        || (isDragCreatedActivityModal && finalActivities.length > 0);
    state.currentModalDurationMode = shouldUseSelectedDuration
        ? MODAL_DURATION_MODE_SELECTED_ACTIVITIES
        : MODAL_DURATION_MODE_RANGE;
    state.currentModalAllActivities = finalActivities;
    state.modalActivitySelection = new Set(finalActivities.map((_, index) => index));
    state.currentModalActivities = getSelectedModalActivities();
    updateModalDurationLabel(startMs, endMs, isBulk);
    state.modalDescriptionAutoManaged = false;
    state.modalProjectAutoManaged = !defaultProjectId;
    const initialDescription = window.editingTimeEntryId ? defaultDescription : '';

    // Handle left panel responsive layout and detailed recorded activity snapshot.
    if (finalActivities.length > 0) {
        DOM.elModalContent.classList.remove('w-[420px]');
        DOM.elModalContent.classList.add('w-[800px]');
        DOM.elModalLeftPanel.classList.remove('hidden');

        // Render activities breakdown checklist snapshot
        DOM.elModalMemoryAidList.innerHTML = finalActivities.map((act, index) => {
            let displayTitle = cleanTitle(act.title, act);
            const durMin = Math.round(getModalActivityDurationMs(act) / (60 * 1000));
            return `
                <div class="modal-activity-row is-selected flex items-center justify-between text-xs p-2.5 cursor-pointer"
                     data-modal-activity-index="${index}">
                    <div class="flex items-center gap-2.5 truncate max-w-[80%]">
                        <button type="button" class="modal-activity-toggle shrink-0" title="Include recorded activity">
                            <i class="ph-fill ph-check-square text-base"></i>
                        </button>
                        <div class="w-5 h-5 flex items-center justify-center shrink-0">
                            ${getActivityIconHTML(act.app, act.url, act.title, act.appPath, act.bundleId)}
                        </div>
                        <div class="flex flex-col truncate">
                            <span class="font-semibold text-white leading-tight">${displayTitle}</span>
                            <span class="text-gray-400 text-[10px] truncate leading-normal">${act.app}</span>
                        </div>
                    </div>
                    <span class="duration-pill shrink-0">${durMin} min</span>
                </div>
            `;
        }).join('');
        attachModalActivitySelectionHandlers();

        DOM.elModalDescription.value = initialDescription;
        DOM.elModalDescription.oninput = () => {
            state.modalDescriptionAutoManaged = false;
        };

        // Evaluate auto-assignment rules against overlaps
        if (defaultProjectId) {
            DOM.elModalProjectSelect.value = defaultProjectId;
        } else {
            const matchedProjId = matchRulesForActivities(state.currentModalActivities);
            if (matchedProjId) {
                DOM.elModalProjectSelect.value = matchedProjId;
                const selectedProj = state.projects.find(p => p.id === matchedProjId);
                DOM.elModalBillable.checked = selectedProj ? selectedProj.billable : false;
            } else if (state.projects.length > 0) {
                DOM.elModalProjectSelect.value = state.projects[0].id;
            }
        }
    } else {
        DOM.elModalContent.classList.remove('w-[800px]');
        DOM.elModalContent.classList.add('w-[420px]');
        DOM.elModalLeftPanel.classList.add('hidden');
        DOM.elModalMemoryAidList.innerHTML = '';
        state.currentModalAllActivities = [];
        state.modalActivitySelection = new Set();
        state.currentModalActivities = [];

        DOM.elModalDescription.value = initialDescription;
        DOM.elModalDescription.oninput = () => {
            state.modalDescriptionAutoManaged = false;
        };

        if (defaultProjectId) {
            DOM.elModalProjectSelect.value = defaultProjectId;
        } else if (state.projects.length > 0) {
            DOM.elModalProjectSelect.value = state.projects[0].id;
        }
    }

    // Set billable checkbox
    if (defaultBillable !== null) {
        DOM.elModalBillable.checked = defaultBillable;
    } else if (state.projects.length > 0) {
        // Pre-fill according to the selected project default billable status
        const selectedProj = state.projects.find(p => p.id === DOM.elModalProjectSelect.value);
        DOM.elModalBillable.checked = selectedProj ? selectedProj.billable : false;
    }

    // Title setup
    if (window.editingTimeEntryId) {
        DOM.elModalBtnDelete.classList.remove('hidden');
    } else {
        DOM.elModalBtnDelete.classList.add('hidden');
    }

    // Render visual 1-click project grid
    renderModalProjectGrid(DOM.elModalProjectSelect.value);
    renderModalTaskSelect(defaultTaskId, DOM.elModalProjectSelect.value);

    DOM.elModal.classList.remove('hidden');
    DOM.elModalDescription.focus();
}

// Render visual project selection cards in a grid
function renderModalProjectGrid(selectedProjId) {
    const container = DOM.elModalProjectGrid;
    if (!container) return;

    if (!selectedProjId && state.projects.length > 0) {
        selectedProjId = state.projects[0].id;
        DOM.elModalProjectSelect.value = selectedProjId;
        DOM.elModalBillable.checked = state.projects[0].billable;
    }

    container.innerHTML = state.projects.map(p => {
        const isSelected = p.id === selectedProjId;
        const selectedClass = isSelected ? 'is-selected' : '';
        const isLocked = p.id === 'proj-1';
        
        return `
            <div class="project-choice ${selectedClass} flex items-center gap-2.5 p-3 cursor-pointer" data-proj-id="${p.id}">
                <span class="project-marker project-marker--large" style="background-color: ${p.color || '#3b82f6'};"></span>
                <div class="flex-1 min-w-0 flex items-center justify-between">
                    <span class="text-xs font-semibold text-white truncate mr-1.5">${p.name}</span>
                    ${isLocked ? '<i class="ph-fill ph-lock text-gray-500 text-[11px] shrink-0" title="Protected System Default"></i>' : ''}
                </div>
            </div>
        `;
    }).join('');

    // Attach click events
    container.querySelectorAll('[data-proj-id]').forEach(card => {
        card.onclick = () => {
            const projId = card.getAttribute('data-proj-id');
            const proj = state.projects.find(p => p.id === projId);
            if (proj) {
                state.modalProjectAutoManaged = false;
                DOM.elModalProjectSelect.value = projId;
                DOM.elModalBillable.checked = proj.billable;
                renderModalProjectGrid(projId);
                renderModalTaskSelect('', projId);
                DOM.elModalProjectSelect.dispatchEvent(new Event('change'));
            }
        };
    });
}

// Close Modal Helper
function closeTimeEntryModal() {
    DOM.elModal.classList.add('hidden');
    window.editingTimeEntryId = null;
    window.editingTimeEntryGroupIds = null;
    window.isBulkAllocation = false;
    state.currentModalAllActivities = [];
    state.currentModalActivities = [];
    state.modalActivitySelection = new Set();
    state.currentModalStartMs = null;
    state.currentModalEndMs = null;
    state.currentModalDurationMode = MODAL_DURATION_MODE_RANGE;
    state.modalDescriptionAutoManaged = false;
    state.modalProjectAutoManaged = false;
    if (DOM.elModalTaskSelect) DOM.elModalTaskSelect.value = '';
    if (DOM.elModalTaskContainer) DOM.elModalTaskContainer.classList.add('hidden');
    
    // Remove visual drag box if any
    const dragBox = DOM.elItemsTimeEntries.querySelector('.drag-box-visual');
    if (dragBox) dragBox.remove();
}

// Match helper evaluating auto-assignment rules against captures
function matchRulesForActivities(activities) {
    if (!activities || activities.length === 0) return null;
    
    // Loop through each rule to see if it matches any activity in the range
    for (const rule of state.rules) {
        for (const act of activities) {
            let valueToCompare = '';
            if (rule.field === 'app') {
                valueToCompare = act.app || '';
            } else if (rule.field === 'title') {
                valueToCompare = act.title || '';
            } else if (rule.field === 'url') {
                valueToCompare = act.url || '';
            }
            
            let isMatch = false;
            const val = valueToCompare.toLowerCase();
            const pat = rule.pattern.toLowerCase();
            
            if (rule.matchType === 'equals') {
                isMatch = (val === pat);
            } else if (rule.matchType === 'regex') {
                try {
                    const regex = new RegExp(rule.pattern, 'i');
                    isMatch = regex.test(valueToCompare);
                } catch (e) {
                    console.error('Invalid regex in rule:', rule.pattern, e);
                }
            } else { // default: contains
                isMatch = val.includes(pat);
            }
            
            if (isMatch) {
                return rule.projectId;
            }
        }
    }
    return null;
}

// Render rules on Rules Manager modal list
function renderRulesList() {
    const container = document.getElementById('rules-list-container');
    if (!container) return;
    if (!state.rules || state.rules.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-8 text-gray-500">
                <i class="ph ph-list-bullets text-2xl mb-1"></i>
                <span class="text-xs">No auto-assignment rules defined</span>
            </div>
        `;
        return;
    }

    container.innerHTML = state.rules.map(rule => {
        const project = state.projects.find(p => p.id === rule.projectId);
        const projColor = project ? project.color : '#3b82f6';
        const projName = project ? project.name : 'Unknown Project';
        
        let fieldLabel = 'App Name';
        if (rule.field === 'title') fieldLabel = 'Window Title';
        else if (rule.field === 'url') fieldLabel = 'URL/Domain';

        let matchLabel = 'contains';
        if (rule.matchType === 'equals') matchLabel = 'equals exact';
        else if (rule.matchType === 'regex') matchLabel = 'matches regex';

        return `
            <div class="surface-panel flex items-center justify-between p-3 text-xs gap-3">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-gray-400">If</span>
                        <span class="status-pill">${fieldLabel}</span>
                        <span class="text-gray-400">${matchLabel}</span>
                        <span class="status-pill text-white truncate max-w-[200px]" title="${rule.pattern}">${rule.pattern}</span>
                    </div>
                    <div class="flex items-center gap-1.5 mt-2">
                        <span class="text-gray-400">Assign to:</span>
                        <span class="flex items-center gap-1.5 font-semibold text-white">
                            <span class="project-marker" style="background-color: ${projColor}"></span>
                            ${projName}
                        </span>
                    </div>
                </div>
                <button class="button-danger"
                        onclick="deleteRule('${rule.id}')">
                    Delete
                </button>
            </div>
        `;
    }).join('');
}

// Rules Delete inline handler
async function deleteRule(id) {
    try {
        const res = await fetch(`${API_BASE}/rules/${id}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            await fetchRules();
            renderRulesList();
        }
    } catch (err) {
        console.error('Error deleting rule:', err);
    }
}

// Bind to window for global access
window.showCustomConfirm = showCustomConfirm;
window.getSelectedModalActivities = getSelectedModalActivities;
window.updateModalDurationLabel = updateModalDurationLabel;
window.setModalActivityIncluded = setModalActivityIncluded;
window.renderModalTaskSelect = renderModalTaskSelect;
window.openTimeEntryModal = openTimeEntryModal;
window.closeTimeEntryModal = closeTimeEntryModal;
window.matchRulesForActivities = matchRulesForActivities;
window.renderRulesList = renderRulesList;
window.deleteRule = deleteRule;
