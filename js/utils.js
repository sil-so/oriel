// Setup date strings in top bar
function setupDateDisplay() {
    if (state.timelineMode === 'week') {
        DOM.elDateDisplay.innerText = formatSelectedWeekLabel(state.currentDate);
    } else {
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        DOM.elDateDisplay.innerText = state.currentDate.toLocaleDateString('en-GB', options);
    }
    DOM.elDatePickerInput.value = getFormattedDate(state.currentDate);
}

// Format local Date object to YYYY-MM-DD cleanly
function getFormattedDate(date) {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().split('T')[0];
}

function getWeekStart(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    return start;
}

function getWeekDays(date) {
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

const NATIVE_ICON_CACHE_VERSION = 'native-icons-v6';

function buildNativeIconUrl(appName, appPath = '', bundleId = '') {
    const encodedName = encodeURIComponent(appName);
    const query = new URLSearchParams({ v: NATIVE_ICON_CACHE_VERSION });
    if (appPath) query.set('appPath', appPath);
    if (bundleId) query.set('bundleId', bundleId);
    if (window.OrielData && window.OrielData.isNative) {
        query.set('appName', appName);
        return `oriel-icon://app/icon?${query.toString()}`;
    }
    return `/api/icons/${encodedName}?${query.toString()}`;
}

function buildWebsiteIconUrl(domain) {
    if (window.OrielData && window.OrielData.isNative) {
        return `oriel-icon://website/icon?domain=${encodeURIComponent(domain)}`;
    }
    return '';
}

function normalizeWebsiteDomain(domain) {
    return String(domain || '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0]
        .split(':')[0];
}

function domainHue(domain) {
    let hash = 0;
    for (let i = 0; i < domain.length; i++) {
        hash = ((hash << 5) - hash) + domain.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % 360;
}

function websiteFallbackIconHTML(domain) {
    const normalized = normalizeWebsiteDomain(domain);
    if (!normalized) return '';
    const label = normalized.replace(/[^a-z0-9]/g, '').charAt(0) || '?';
    return `<span class="website-icon-fallback" style="--website-icon-hue: ${domainHue(normalized)}" aria-label="${normalized}">${label}</span>`;
}

function activityIconFrameHTML(innerHTML, modifierClass = '') {
    if (!innerHTML) return '';
    const modifier = modifierClass ? ` ${modifierClass}` : '';
    return `<span class="activity-icon-frame${modifier}">${innerHTML}</span>`;
}

// Convert absolute HH:MM string back to a timestamp for current tracking date
function parseInputTimeToMs(timeStr) {
    const parts = timeStr.trim().split(':').map(Number);
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1]) || parts[0] < 0 || parts[0] > 23 || parts[1] < 0 || parts[1] > 59) {
        return null;
    }
    const [hours, minutes] = parts;
    const date = new Date(state.currentDate);
    date.setHours(hours, minutes, 0, 0);
    return date.getTime();
}

function getAssignedActivityDurationMs(activity) {
    const duration = Number(activity?.assignedDurationMs);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function getConfiguredMinActivityThresholdMs() {
    return 0;
}

function hasAutoAssignedActivitySnapshot(entry) {
    return Array.isArray(entry?.activities)
        && entry.activities.some(activity => activity?.autoAssigned === true);
}

function isAutoRuleTimeEntry(entry) {
    if (entry?.createdBy === 'auto-rule') return true;
    if (entry && Object.prototype.hasOwnProperty.call(entry, 'createdBy')) return false;
    return hasAutoAssignedActivitySnapshot(entry);
}

function getTimeEntryAssignedDurationMs(entry) {
    return Array.isArray(entry?.activities)
        ? entry.activities.reduce((total, activity) => total + getAssignedActivityDurationMs(activity), 0)
        : 0;
}

function isHiddenAutoAssignedTimeEntry(entry) {
    return false;
}

function getTimeEntryDurationMs(entry) {
    const assignedDuration = getTimeEntryAssignedDurationMs(entry);
    if (assignedDuration > 0) return assignedDuration;
    if (Number.isFinite(entry?.start) && Number.isFinite(entry?.end) && entry.end > entry.start) {
        return entry.end - entry.start;
    }
    return 0;
}

function compactCleanedTitle(title) {
    return String(title || '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+-\s*$/g, '')
        .replace(/^\s*-\s+/g, '')
        .trim();
}

function titleCleanupScopeMatches(value, scope) {
    const needle = String(scope || '').trim().toLowerCase();
    if (!needle) return true;
    return String(value || '').toLowerCase().includes(needle);
}

function shouldApplyTitleCleanupRule(rule, context) {
    return rule?.enabled !== false
        && titleCleanupScopeMatches(context?.app || '', rule.appContains)
        && titleCleanupScopeMatches(context?.url || '', rule.urlContains);
}

// Strips configured browser/status/title noise from displayed activity titles only.
function cleanTitle(title, activityContext = {}) {
    if (!title) return '';
    const context = {
        ...activityContext,
        title
    };
    const configuredRules = typeof state !== 'undefined'
        ? state?.settings?.titleCleanupRules
        : undefined;
    const rules = typeof normalizeTitleCleanupRules === 'function'
        ? normalizeTitleCleanupRules(configuredRules)
        : [];
    let displayTitle = String(title);

    for (const rule of rules) {
        if (!shouldApplyTitleCleanupRule(rule, context)) continue;
        try {
            displayTitle = displayTitle.replace(new RegExp(rule.pattern, 'gi'), '');
        } catch (error) {
            continue;
        }
    }

    return compactCleanedTitle(displayTitle);
}

// Restrained fallback icon set used when a native or website icon is unavailable.
function getAppIconClass(appName) {
    const formatted = appName.toLowerCase().replace(/\s+/g, '-');
    if (formatted.includes('chrome')) return 'ph ph-google-chrome-logo';
    if (formatted.includes('brave')) return 'ph ph-lightning-b';
    if (formatted.includes('code') || formatted.includes('vscode')) return 'ph ph-file-code';
    if (formatted.includes('slack')) return 'ph ph-slack-logo';
    if (formatted.includes('figma')) return 'ph ph-figma-logo';
    if (formatted.includes('terminal')) return 'ph ph-terminal-window';
    if (formatted.includes('finder')) return 'ph ph-folder';
    if (formatted.includes('oriel') || formatted.includes('timetracker')) return 'ph ph-clock-countdown';
    return 'ph ph-app-window';
}

// Resolves and returns full favicon tag with responsive error fallbacks
function getActivityIconHTML(appName, url, title = '', appPath = '', bundleId = '') {
    let domain = '';
    if (url) {
        try {
            domain = new URL(url).hostname;
        } catch {
            domain = url;
        }
    }

    // Extract domain from title parentheses if URL is empty
    if (!domain && title) {
        const parenMatch = title.match(/\(([^)]+)\)/);
        if (parenMatch) {
            const candidate = parenMatch[1].trim();
            if (candidate.includes('.') && !candidate.includes(' ') && !candidate.startsWith('localhost') && !candidate.startsWith('127.0.0.1')) {
                domain = normalizeWebsiteDomain(candidate);
            }
        }
    }

    domain = normalizeWebsiteDomain(domain);
    if (domain && (domain.includes('localhost') || domain.includes('127.0.0.1'))) {
        domain = '';
    }

    if (domain && state.settings.logoDevIconsEnabled) {
        const serviceUrl = buildWebsiteIconUrl(domain);
        if (serviceUrl) {
            const browserIconUrl = buildNativeIconUrl(appName, appPath, bundleId);
            return activityIconFrameHTML(`<img src="${serviceUrl}" class="activity-icon-img" referrerpolicy="origin" onerror="this.onerror=function(){this.style.display='none';this.nextElementSibling.style.display='inline-block';};this.src='${browserIconUrl}';"><i class="${getAppIconClass(appName)} activity-icon-fallback" style="display:none;"></i>`, 'activity-icon-frame--brand activity-icon-frame--image');
        }
    }

    if (domain) {
        return activityIconFrameHTML(websiteFallbackIconHTML(domain), 'activity-icon-frame--website');
    }

    // For native macOS apps, try local icon extraction.
    if (appName) {
        const iconClass = getAppIconClass(appName);
        const iconUrl = buildNativeIconUrl(appName, appPath, bundleId);
        return activityIconFrameHTML(`<img src="${iconUrl}" class="activity-icon-img native-app-icon" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';"><i class="${iconClass} activity-icon-fallback" style="display:none;"></i>`, 'activity-icon-frame--native');
    }

    const iconClass = getAppIconClass(appName);
    return activityIconFrameHTML(`<i class="${iconClass} activity-icon-fallback"></i>`, 'activity-icon-frame--fallback');
}

function setBrandIconPreferenceForTesting(enabled) {
    state.settings.logoDevIconsEnabled = Boolean(enabled);
}

function escapeMarkdownHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeMarkdownAttribute(value) {
    return escapeMarkdownHtml(value).replace(/`/g, '&#96;');
}

function isSafeMarkdownUrl(value) {
    try {
        const parsed = new URL(String(value || '').trim());
        return ['http:', 'https:'].includes(parsed.protocol.toLowerCase());
    } catch {
        return false;
    }
}

function renderOrielInlineMarkdown(value) {
    const text = String(value ?? '');
    const codeSegments = [];
    const codeToken = index => `\u0000CODE${index}\u0000`;
    let escaped = text.replace(/`([^`]+)`/g, (_, code) => {
        const index = codeSegments.length;
        codeSegments.push(`<code>${escapeMarkdownHtml(code)}</code>`);
        return codeToken(index);
    });

    escaped = escapeMarkdownHtml(escaped);
    escaped = escaped.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
        const decodedLabel = label
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        const decodedHref = href.replace(/&amp;/g, '&');
        if (!isSafeMarkdownUrl(decodedHref)) {
            return escapeMarkdownHtml(decodedLabel);
        }
        return `<a href="${escapeMarkdownAttribute(decodedHref)}" target="_blank" rel="noopener noreferrer">${renderOrielInlineMarkdown(decodedLabel)}</a>`;
    });
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    codeSegments.forEach((html, index) => {
        escaped = escaped.replace(codeToken(index), html);
    });
    return escaped;
}

function renderOrielMarkdown(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];
    let listItems = [];
    let listType = '';

    const flushParagraph = () => {
        if (paragraph.length === 0) return;
        blocks.push(`<p>${paragraph.map(line => renderOrielInlineMarkdown(line)).join('<br>')}</p>`);
        paragraph = [];
    };
    const flushList = () => {
        if (listItems.length === 0) return;
        const tag = listType === 'ol' ? 'ol' : 'ul';
        blocks.push(`<${tag}>${listItems.map(item => `<li>${renderOrielInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
        listItems = [];
        listType = '';
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            flushParagraph();
            flushList();
            continue;
        }

        const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
        const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
        if (orderedMatch || unorderedMatch) {
            const nextType = orderedMatch ? 'ol' : 'ul';
            flushParagraph();
            if (listType && listType !== nextType) flushList();
            listType = nextType;
            listItems.push((orderedMatch || unorderedMatch)[1]);
            continue;
        }

        flushList();
        paragraph.push(line);
    }

    flushParagraph();
    flushList();
    return blocks.join('');
}

function formatStatsDuration(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    if (safeMs < 60000) {
        return `${Math.round(safeMs / 1000)}s`;
    }
    const minutes = Math.round(safeMs / 60000);
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
}

function formatSidebarProjectDuration(ms) {
    const totalMins = Math.floor(Math.max(0, Number(ms) || 0) / (60 * 1000));
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return `${hours}h ${mins}m`;
}

function getSelectedPeriodTimeEntryDurationMs(entry) {
    if (typeof isHiddenAutoAssignedTimeEntry === 'function' && isHiddenAutoAssignedTimeEntry(entry)) {
        return 0;
    }
    if (typeof getTimeEntryDurationMs === 'function') {
        return getTimeEntryDurationMs(entry);
    }
    const assignedDuration = Array.isArray(entry?.activities)
        ? entry.activities.reduce((total, activity) => total + getAssignedActivityDurationMs(activity), 0)
        : 0;
    return assignedDuration > 0
        ? assignedDuration
        : Math.max(0, (entry?.end || 0) - (entry?.start || 0));
}

function calculateSelectedPeriodMetrics({
    activities = [],
    timeEntries = [],
    projects = [],
    allTimeEntries = timeEntries
} = {}) {
    const totalCapturedMs = (Array.isArray(activities) ? activities : []).reduce((total, activity) => (
        total + Math.max(0, (activity?.end || 0) - (activity?.start || 0))
    ), 0);
    const projectDurations = {};
    const entriesByProject = {};
    let totalLoggedMs = 0;

    for (const entry of Array.isArray(timeEntries) ? timeEntries : []) {
        const duration = getSelectedPeriodTimeEntryDurationMs(entry);
        if (duration <= 0) continue;
        totalLoggedMs += duration;
        projectDurations[entry.projectId] = (projectDurations[entry.projectId] || 0) + duration;
        entriesByProject[entry.projectId] = (entriesByProject[entry.projectId] || 0) + duration;
    }

    const historicalHoursByProject = {};
    for (const entry of Array.isArray(allTimeEntries) ? allTimeEntries : []) {
        const duration = getSelectedPeriodTimeEntryDurationMs(entry);
        if (duration <= 0) continue;
        historicalHoursByProject[entry.projectId] = (historicalHoursByProject[entry.projectId] || 0) + duration / (3600 * 1000);
    }

    let billableMs = 0;
    let billableEarnings = 0;
    let dominantCurrency = '$';
    const projectList = Array.isArray(projects) ? projects : [];

    for (const projectId of Object.keys(entriesByProject)) {
        const periodMs = entriesByProject[projectId];
        const project = projectList.find(candidate => candidate.id === projectId);
        if (!project) continue;

        const currency = project.currency || '$';
        dominantCurrency = currency;
        if (project.billable) billableMs += periodMs;

        const periodHours = periodMs / (3600 * 1000);
        if (project.rateType === 'hourly') {
            billableEarnings += periodHours * (project.hourlyRate || 0);
        } else if (project.rateType === 'fixed') {
            const totalProjectHours = historicalHoursByProject[projectId] || periodHours;
            billableEarnings += totalProjectHours > 0
                ? (periodHours / totalProjectHours) * (project.fixedRate || 0)
                : (project.fixedRate || 0);
        }
    }

    const conversionPercent = totalCapturedMs > 0
        ? Math.min(100, Math.round((totalLoggedMs / totalCapturedMs) * 100))
        : 0;

    return {
        totalCapturedMs,
        totalLoggedMs,
        billableMs,
        billableEarnings,
        dominantCurrency,
        conversionPercent,
        projectDurations
    };
}

// Bind utilities to window
window.setupDateDisplay = setupDateDisplay;
window.getFormattedDate = getFormattedDate;
window.getWeekStart = getWeekStart;
window.getWeekDays = getWeekDays;
window.getSelectedWeekRange = getSelectedWeekRange;
window.formatSelectedWeekLabel = formatSelectedWeekLabel;
window.parseInputTimeToMs = parseInputTimeToMs;
window.getAssignedActivityDurationMs = getAssignedActivityDurationMs;
window.getConfiguredMinActivityThresholdMs = getConfiguredMinActivityThresholdMs;
window.hasAutoAssignedActivitySnapshot = hasAutoAssignedActivitySnapshot;
window.isAutoRuleTimeEntry = isAutoRuleTimeEntry;
window.getTimeEntryAssignedDurationMs = getTimeEntryAssignedDurationMs;
window.isHiddenAutoAssignedTimeEntry = isHiddenAutoAssignedTimeEntry;
window.getTimeEntryDurationMs = getTimeEntryDurationMs;
window.cleanTitle = cleanTitle;
window.compactCleanedTitle = compactCleanedTitle;
window.getAppIconClass = getAppIconClass;
window.getActivityIconHTML = getActivityIconHTML;
window.buildNativeIconUrl = buildNativeIconUrl;
window.buildWebsiteIconUrl = buildWebsiteIconUrl;
window.normalizeWebsiteDomain = normalizeWebsiteDomain;
window.websiteFallbackIconHTML = websiteFallbackIconHTML;
window.NATIVE_ICON_CACHE_VERSION = NATIVE_ICON_CACHE_VERSION;
window.setBrandIconPreferenceForTesting = setBrandIconPreferenceForTesting;
window.renderOrielInlineMarkdown = renderOrielInlineMarkdown;
window.renderOrielMarkdown = renderOrielMarkdown;
window.formatStatsDuration = formatStatsDuration;
window.formatSidebarProjectDuration = formatSidebarProjectDuration;
window.getSelectedPeriodTimeEntryDurationMs = getSelectedPeriodTimeEntryDurationMs;
window.calculateSelectedPeriodMetrics = calculateSelectedPeriodMetrics;
