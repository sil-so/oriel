const API_BASE = '/api';
const SUPPORTED_THEMES = new Set(['graphite', 'light', 'reference']);
const SUPPORTED_MIN_ACTIVITY_THRESHOLDS = new Set([10, 30, 60]);
const DEFAULT_AI_OPENAI_MODEL = 'gpt-5.2';
const DEFAULT_AI_GOOGLE_MODEL = 'gemini-3.5-flash';
const DEFAULT_AI_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_AI_OPENROUTER_MODEL = 'google/gemini-3.1-flash-lite';
const TITLE_CLEANUP_RULE_STRING_LIMIT = 500;
const DEFAULT_AI_SCREENSHOT_SENSITIVE_APPS = [
    '1password',
    'bitwarden',
    'dashlane',
    'keychain access',
    'lastpass',
    'proton pass',
    'keeper password',
    'authenticator'
];

const DEFAULT_TITLE_CLEANUP_RULES = [
    {
        id: 'brave-base-profile',
        name: 'Brave profile suffix',
        enabled: true,
        pattern: '\\s+-\\s*Brave\\s+-\\s*Base$',
        appContains: '',
        urlContains: ''
    },
    {
        id: 'browser-prefix',
        name: 'Browser title prefix',
        enabled: true,
        pattern: '^(Brave Browser|Google Chrome|Brave|Chrome|Safari|Arc|Microsoft Edge|Edge)\\s+-\\s*',
        appContains: '',
        urlContains: ''
    },
    {
        id: 'browser-suffix',
        name: 'Browser title suffix',
        enabled: true,
        pattern: '\\s+-\\s*(Brave Browser|Google Chrome|Brave|Chrome|Safari|Arc|Microsoft Edge|Edge)$',
        appContains: '',
        urlContains: ''
    },
    {
        id: 'audio-playing',
        name: 'Audio playing status',
        enabled: true,
        pattern: '\\s+-\\s*Audio playing',
        appContains: '',
        urlContains: ''
    },
    {
        id: 'high-memory-usage',
        name: 'High memory usage status',
        enabled: true,
        pattern: '\\s+-\\s*High memory usage\\s+-\\s*\\d+(?:\\.\\d+)?\\s*(?:MB|GB)',
        appContains: '',
        urlContains: ''
    },
    {
        id: 'youtube-site-suffix',
        name: 'YouTube site suffix',
        enabled: true,
        pattern: '\\s+-\\s*YouTube$',
        appContains: '',
        urlContains: 'youtube.com'
    },
    {
        id: 'brave-notification-count',
        name: 'Brave notification count',
        enabled: true,
        pattern: '^\\(\\d+\\)\\s+',
        appContains: 'Brave',
        urlContains: ''
    },
    {
        id: 'chrome-notification-count',
        name: 'Chrome notification count',
        enabled: true,
        pattern: '^\\(\\d+\\)\\s+',
        appContains: 'Chrome',
        urlContains: ''
    },
    {
        id: 'obsidian-version-suffix',
        name: 'Obsidian version suffix',
        enabled: true,
        pattern: '\\s+-\\s*Obsidian\\s+\\d+(?:\\.\\d+)+$',
        appContains: 'Obsidian',
        urlContains: ''
    }
];

function normalizeTheme(theme) {
    if (theme === 'variant') return 'reference';
    return SUPPORTED_THEMES.has(theme) ? theme : 'graphite';
}

const initialTheme = normalizeTheme(localStorage.getItem('theme'));

function normalizeMinActivityThreshold(value) {
    const threshold = Number.parseInt(value, 10);
    return SUPPORTED_MIN_ACTIVITY_THRESHOLDS.has(threshold) ? threshold : 60;
}

function cloneDefaultTitleCleanupRules() {
    return DEFAULT_TITLE_CLEANUP_RULES.map(rule => ({ ...rule }));
}

function stringSetting(value, maxLength = TITLE_CLEANUP_RULE_STRING_LIMIT) {
    return String(value || '').trim().slice(0, maxLength);
}

function normalizeTitleCleanupRule(rule) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
    const id = stringSetting(rule.id, 120);
    const name = stringSetting(rule.name, 160);
    const pattern = stringSetting(rule.pattern);
    if (!id || !name || !pattern) return null;
    return {
        id,
        name,
        enabled: rule.enabled !== false,
        pattern,
        appContains: stringSetting(rule.appContains, 160),
        urlContains: stringSetting(rule.urlContains, 300)
    };
}

function normalizeTitleCleanupRules(value) {
    if (!Array.isArray(value)) return cloneDefaultTitleCleanupRules();
    const normalizedRules = value
        .map(normalizeTitleCleanupRule)
        .filter(Boolean);
    if (value.length > 0 && normalizedRules.length === 0) {
        return cloneDefaultTitleCleanupRules();
    }
    return normalizedRules;
}

function parseStoredTitleCleanupRules() {
    try {
        const stored = localStorage.getItem('titleCleanupRules');
        if (!stored) return cloneDefaultTitleCleanupRules();
        return normalizeTitleCleanupRules(JSON.parse(stored));
    } catch (error) {
        return cloneDefaultTitleCleanupRules();
    }
}

function parseStoredBooleanSetting(key, defaultValue = false) {
    const stored = localStorage.getItem(key);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return defaultValue;
}

function parseStoredStringListSetting(key, defaultValue = []) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        if (!Array.isArray(parsed)) return Array.from(defaultValue);
        return Array.from(new Set(parsed
            .map(value => String(value || '').trim())
            .filter(Boolean)));
    } catch (_error) {
        return Array.from(defaultValue);
    }
}

const state = {
    currentDate: new Date(),
    zoom: 5, // zoom interval in minutes
    projects: [],
    activities: [],
    timelineActivities: [],
    timeEntries: [],
    weekActivities: [],
    weekTimelineActivities: [],
    weekTimeEntries: [],
    rules: [],
    trackingExclusions: [],
    currentModalActivities: [],
    currentModalAllActivities: [],
    modalActivitySelection: new Set(),
    currentModalDurationMode: 'range',
    modalDescriptionAutoManaged: false,
    modalProjectAutoManaged: false,
    settings: {
        minActivityThreshold: normalizeMinActivityThreshold(localStorage.getItem('minActivityThreshold')),
        theme: initialTheme,
        logoDevIconsEnabled: localStorage.getItem('logoDevIconsEnabled') === 'true',
        hideEmptyActivityRows: parseStoredBooleanSetting('hideEmptyActivityRows', false),
        aiProvider: localStorage.getItem('aiProvider') || '',
        aiOpenAIModel: localStorage.getItem('aiOpenAIModel') || DEFAULT_AI_OPENAI_MODEL,
        aiGoogleModel: localStorage.getItem('aiGoogleModel') || DEFAULT_AI_GOOGLE_MODEL,
        aiAnthropicModel: localStorage.getItem('aiAnthropicModel') || DEFAULT_AI_ANTHROPIC_MODEL,
        aiOpenRouterModel: localStorage.getItem('aiOpenRouterModel') || DEFAULT_AI_OPENROUTER_MODEL,
        aiScreenshotProvider: localStorage.getItem('aiScreenshotProvider') || '',
        aiScreenshotSummariesEnabled: parseStoredBooleanSetting('aiScreenshotSummariesEnabled', false),
        aiScreenshotFrequencyPreset: localStorage.getItem('aiScreenshotFrequencyPreset') || 'balanced',
        aiScreenshotDailyCap: Number.parseInt(localStorage.getItem('aiScreenshotDailyCap') || '100', 10),
        aiScreenshotTimeoutSeconds: Number.parseInt(localStorage.getItem('aiScreenshotTimeoutSeconds') || '20', 10),
        aiScreenshotModelMode: localStorage.getItem('aiScreenshotModelMode') || 'askAI',
        aiScreenshotOpenAIModel: localStorage.getItem('aiScreenshotOpenAIModel') || DEFAULT_AI_OPENAI_MODEL,
        aiScreenshotGoogleModel: localStorage.getItem('aiScreenshotGoogleModel') || DEFAULT_AI_GOOGLE_MODEL,
        aiScreenshotAnthropicModel: localStorage.getItem('aiScreenshotAnthropicModel') || DEFAULT_AI_ANTHROPIC_MODEL,
        aiScreenshotOpenRouterModel: localStorage.getItem('aiScreenshotOpenRouterModel') || DEFAULT_AI_OPENROUTER_MODEL,
        aiScreenshotSensitiveApps: parseStoredStringListSetting('aiScreenshotSensitiveApps', DEFAULT_AI_SCREENSHOT_SENSITIVE_APPS),
        titleCleanupRules: parseStoredTitleCleanupRules()
    },
    
    // Drag-to-create time entry variables
    isDragging: false,
    dragStartCell: null,
    dragEndCell: null,
    dragTargetCol: 'time-entries',
    
    // Selected activity blocks for bulk actions
    selectedActivities: new Set(),
    selectedActivityScopes: new Map(),
    
    // Active application workspace view
    currentView: 'timeline',
    timelineMode: 'day'
};

function applyTheme(theme, { persist = false } = {}) {
    const nextTheme = normalizeTheme(theme);
    document.documentElement.dataset.theme = nextTheme;
    state.settings.theme = nextTheme;
    if (persist) {
        localStorage.setItem('theme', nextTheme);
    }
    return nextTheme;
}

applyTheme(initialTheme);

// Resizing state for time entries
let resizeState = {
    isResizing: false,
    entryEl: null,
    entryId: null,
    side: null, // 'top' or 'bottom'
    initialY: 0,
    initialTop: 0,
    initialHeight: 0,
    dateStartOfDay: 0
};

window.editingProjectId = null;
window.isBulkAllocation = false;
window.editingTimeEntryId = null;
window.editingTimeEntryPersistedRange = null;
window.editingTimeEntryPersistedActivities = null;
window.editingTimeEntryFilterPersistedBySelection = false;

const browserPatterns = [
    /^Brave Browser\s*-\s*/i,
    /^Google Chrome\s*-\s*/i,
    /^Brave\s*-\s*/i,
    /^Chrome\s*-\s*/i,
    /^Safari\s*-\s*/i,
    /^Arc\s*-\s*/i,
    /^Edge\s*-\s*/i,
    /^Microsoft Edge\s*-\s*/i,
    /\s*-\s*Brave Browser$/i,
    /\s*-\s*Google Chrome$/i,
    /\s*-\s*Brave\s*-\s*Base$/i,
    /\s*-\s*Brave$/i,
    /\s*-\s*Chrome$/i,
    /\s*-\s*Safari$/i,
    /\s*-\s*Arc$/i,
    /\s*-\s*Microsoft Edge$/i,
    /\s*-\s*Edge$/i
];

// Global DOM Getters to ensure safe DOM access regardless of script execution order
const DOM = {
    get elGridMemoryAid() { return document.getElementById('memory-aid-grid'); },
    get elItemsMemoryAid() { return document.getElementById('memory-aid-items'); },
    get elGridTimeEntries() { return document.getElementById('time-entries-grid'); },
    get elItemsTimeEntries() { return document.getElementById('time-entries-items'); },
    get elDateDisplay() { return document.getElementById('date-display'); },
    get elDatePickerInput() { return document.getElementById('date-picker-input'); },
    get elTrackingStatusIndicator() { return document.getElementById('tracking-status-indicator'); },
    get elProjectsList() { return document.getElementById('projects-breakdown-list'); },
    
    // Scroll containers
    get elMemAidScroll() { return document.getElementById('memory-aid-container'); },
    get elTimeEntriesScroll() { return document.getElementById('time-entries-container'); },
    
    // Multi-select bar
    get elMultiSelectBar() { return document.getElementById('multi-select-bar'); },
    get elSelectedCount() { return document.getElementById('lbl-selected-count'); },
    get elSelectedState() { return document.getElementById('lbl-selected-state'); },
    get elBtnSelectSimilar() { return document.getElementById('btn-select-similar'); },
    get elBtnClearSelection() { return document.getElementById('btn-clear-selection'); },
    get elBtnAssignSelected() { return document.getElementById('btn-assign-selected'); },
    get elSimilarModal() { return document.getElementById('similar-modal'); },
    get elSimilarModeHost() { return document.getElementById('similar-mode-host'); },
    get elSimilarModeUrl() { return document.getElementById('similar-mode-url'); },
    get elSimilarModeApp() { return document.getElementById('similar-mode-app'); },
    get elSimilarModeAppTitle() { return document.getElementById('similar-mode-app-title'); },
    get elSimilarModalBtnClose() { return document.getElementById('similar-modal-btn-close'); },
    get elSimilarModalBtnCancel() { return document.getElementById('similar-modal-btn-cancel'); },
    get elSimilarModalBtnApply() { return document.getElementById('similar-modal-btn-apply'); },

    // Tabs & Workspaces
    get elTabTimeline() { return document.getElementById('tab-timeline'); },
    get elTabProjects() { return document.getElementById('tab-projects'); },
    get elTabStats() { return document.getElementById('tab-stats'); },
    get elTabAiInsights() { return document.getElementById('tab-ai-insights'); },
    get elTimelineModeSwitch() { return document.getElementById('timeline-mode-switch'); },
    get elTimelineModeDay() { return document.getElementById('timeline-mode-day'); },
    get elTimelineModeWeek() { return document.getElementById('timeline-mode-week'); },
    get elSchedulerWorkspace() { return document.getElementById('scheduler-workspace'); },
    get elWeekTimelineWorkspace() { return document.getElementById('week-timeline-workspace'); },
    get elWeekTimelineGrid() { return document.getElementById('week-timeline-grid'); },
    get elWeekTimelineContainer() { return document.getElementById('week-timeline-container'); },
    get elProjectsWorkspace() { return document.getElementById('projects-workspace'); },
    get elStatsWorkspace() { return document.getElementById('stats-workspace'); },
    get elAiInsightsWorkspace() { return document.getElementById('ai-insights-workspace'); },
    get elProjectsPageGrid() { return document.getElementById('projects-page-grid'); },

    // Popup details
    get elActivityDetailsPopup() { return document.getElementById('activity-details-popup'); },
    get elPopupIconContainer() { return document.getElementById('popup-icon-container'); },
    get elPopupAppName() { return document.getElementById('popup-app-name'); },
    get elPopupTitle() { return document.getElementById('popup-title'); },
    get elPopupUrlContainer() { return document.getElementById('popup-url-container'); },
    get elPopupUrl() { return document.getElementById('popup-url'); },
    get elPopupDuration() { return document.getElementById('popup-duration'); },
    get elPopupRange() { return document.getElementById('popup-range'); },
    get elPopupActivityMixContainer() { return document.getElementById('popup-activity-mix-container'); },
    get elPopupActivityMixLabel() { return document.getElementById('popup-activity-mix-label'); },
    get elPopupActivityMixInfo() { return document.getElementById('popup-activity-mix-info'); },
    get elActivityMixTooltip() { return document.getElementById('activity-mix-tooltip'); },
    get elPopupAssignBtn() { return document.getElementById('popup-assign-btn'); },
    get elPopupCloseBtn() { return document.getElementById('popup-close-btn'); },
    get elPopupSingleDetails() { return document.getElementById('popup-single-details'); },
    get elPopupSingleChildrenContainer() { return document.getElementById('popup-single-children-container'); },
    get elPopupMultiDetails() { return document.getElementById('popup-multi-details'); },
    get elPopupMultiListContainer() { return document.getElementById('popup-multi-list-container'); },
    
    // Statistics
    get elStatCapturedActive() { return document.getElementById('stat-captured-active'); },
    get elWorkStatCaptured() { return document.getElementById('work-stat-captured'); },
    get elWorkStatLogged() { return document.getElementById('work-stat-logged'); },
    get elWorkStatEarnings() { return document.getElementById('work-stat-earnings'); },
    get elWorkStatBillableHours() { return document.getElementById('work-stat-billable-hours'); },
    get elWorkStatConversionPercent() { return document.getElementById('work-stat-conversion-percent'); },
    get elWorkStatConversionBar() { return document.getElementById('work-stat-conversion-bar'); },
    get getElStatBillable() { return document.getElementById('stat-billable'); },
    get elStatNonbillable() { return document.getElementById('stat-nonbillable'); },
    get elBarProject() { return document.getElementById('bar-project'); },

    // Time entry modal
    get elModal() { return document.getElementById('time-entry-modal'); },
    get elModalTitle() { return document.getElementById('modal-title'); },
    get elModalStart() { return document.getElementById('modal-start-time'); },
    get elModalEnd() { return document.getElementById('modal-end-time'); },
    get elModalDuration() { return document.getElementById('modal-duration-lbl'); },
    get elModalDescription() { return document.getElementById('modal-description-input'); },
    get elModalProjectSelect() { return document.getElementById('modal-project-select'); },
    get elModalProjectGrid() { return document.getElementById('modal-project-grid'); },
    get elModalTaskContainer() { return document.getElementById('modal-task-container'); },
    get elModalTaskSelect() { return document.getElementById('modal-task-select'); },
    get elModalBillable() { return document.getElementById('modal-billable-toggle'); },
    get elModalBtnDelete() { return document.getElementById('modal-btn-delete'); },
    get elModalBtnCancel() { return document.getElementById('modal-btn-cancel'); },
    get elModalBtnSave() { return document.getElementById('modal-btn-save'); },
    get elModalContent() { return document.getElementById('time-entry-modal-content'); },
    get elModalLeftPanel() { return document.getElementById('modal-left-panel'); },
    get elModalMemoryAidList() { return document.getElementById('modal-memory-aid-list'); },

    // Project creation modal
    get elProjModal() { return document.getElementById('project-modal'); },
    get elProjName() { return document.getElementById('project-name-input'); },
    get elProjDescription() { return document.getElementById('project-description-input'); },
    get elProjColor() { return document.getElementById('project-color-input'); },
    get elProjBtnCancel() { return document.getElementById('project-btn-cancel'); },
    get getElProjBtnSave() { return document.getElementById('project-btn-save'); }
};

// Bind to window for global access
window.API_BASE = API_BASE;
window.state = state;
window.applyTheme = applyTheme;
window.normalizeTheme = normalizeTheme;
window.normalizeMinActivityThreshold = normalizeMinActivityThreshold;
window.cloneDefaultTitleCleanupRules = cloneDefaultTitleCleanupRules;
window.normalizeTitleCleanupRule = normalizeTitleCleanupRule;
window.normalizeTitleCleanupRules = normalizeTitleCleanupRules;
window.resizeState = resizeState;
window.browserPatterns = browserPatterns;
window.DOM = DOM;
