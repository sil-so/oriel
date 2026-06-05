(function initializeAiSidebar(global) {
    const DEFAULT_OPENAI_MODEL = 'gpt-5.2';
    const DEFAULT_GOOGLE_MODEL = 'gemini-3.5-flash';
    const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
    const AI_PROMPT_MESSAGE_LIMIT = 8;
    const AI_CONTEXT_ITEM_LIMIT = 60;
    const AI_UNLOGGED_RANGE_DETAIL_MIN_MS = 60 * 1000;
    const AI_MODEL_CACHE_KEY = 'oriel.aiModelCache.v1';
    const AI_MODEL_REFRESH_SUCCESS_MS = 2600;
    const AI_PROVIDERS = [
        {
            id: 'openai',
            label: 'OpenAI',
            settingKey: 'aiOpenAIModel',
            storageKey: 'aiOpenAIModel',
            defaultModel: DEFAULT_OPENAI_MODEL,
            curatedModels: ['gpt-5.2', 'gpt-5.2-mini', 'gpt-5.1', 'gpt-4.1']
        },
        {
            id: 'google',
            label: 'Gemini',
            settingKey: 'aiGoogleModel',
            storageKey: 'aiGoogleModel',
            defaultModel: DEFAULT_GOOGLE_MODEL,
            curatedModels: ['gemini-3.5-flash', 'gemini-3.5-pro', 'gemini-2.5-flash', 'gemini-2.5-pro']
        },
        {
            id: 'anthropic',
            label: 'Claude',
            settingKey: 'aiAnthropicModel',
            storageKey: 'aiAnthropicModel',
            defaultModel: DEFAULT_ANTHROPIC_MODEL,
            curatedModels: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-20250514']
        }
    ];
    const AI_DRAFT_EXCLUDED_APPS = new Set([
        'music',
        'spotify',
        'podcasts',
        'tv',
        'quicktime player',
        'vlc',
        'iina'
    ]);
    const AI_DRAFT_EXCLUDED_DOMAINS = [
        'youtube.com',
        'youtu.be',
        'facebook.com',
        'instagram.com',
        'tiktok.com',
        'netflix.com',
        'hulu.com',
        'disneyplus.com',
        'soundcloud.com',
        'twitch.tv'
    ];
    const AI_DRAFT_EXCLUDED_BROWSER_TITLE_PATTERN = /\b(youtube|facebook|instagram|tiktok|netflix|hulu|disney\+|soundcloud|twitch)\b/i;

    function getDateString(date = global.state?.currentDate || new Date()) {
        if (typeof global.getFormattedDate === 'function') {
            return global.getFormattedDate(date);
        }
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function getDayBounds(dateStr) {
        const [year, month, day] = String(dateStr).split('-').map(Number);
        const start = new Date(year, month - 1, day).getTime();
        return { start, end: start + 24 * 60 * 60 * 1000 };
    }

    function formatClock(ms) {
        const date = new Date(ms);
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    function formatDuration(ms) {
        const totalMins = Math.max(0, Math.round((ms || 0) / (60 * 1000)));
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }

    function cleanActivityTitle(title, activityContext = {}) {
        if (typeof global.cleanTitle === 'function') {
            return global.cleanTitle(title || '', activityContext);
        }
        return String(title || '').trim();
    }

    function domainFromUrl(value) {
        if (!value) return '';
        try {
            const parsed = new URL(value);
            return parsed.hostname.replace(/^www\./, '');
        } catch (_error) {
            return '';
        }
    }

    function isBrowserLikeApp(app) {
        return /\b(browser|safari|chrome|brave|firefox|arc|edge)\b/i.test(String(app || ''));
    }

    function hostMatchesBlockedDomain(host, blockedDomain) {
        return host === blockedDomain || host.endsWith(`.${blockedDomain}`);
    }

    function shouldExcludeAiDraftActivity(activity) {
        const app = String(activity?.app || '').trim().toLowerCase();
        if (AI_DRAFT_EXCLUDED_APPS.has(app)) return true;

        const domain = domainFromUrl(activity?.url || '').toLowerCase();
        if (domain && AI_DRAFT_EXCLUDED_DOMAINS.some(blocked => hostMatchesBlockedDomain(domain, blocked))) {
            return true;
        }

        const title = cleanActivityTitle(activity?.title || '', activity).trim();
        return isBrowserLikeApp(activity?.app) && AI_DRAFT_EXCLUDED_BROWSER_TITLE_PATTERN.test(title);
    }

    function getProject(projectId) {
        return (global.state?.projects || []).find(project => project.id === projectId) || null;
    }

    function getTaskName(project, taskId) {
        if (!project || !taskId || !Array.isArray(project.tasks)) return '';
        return project.tasks.find(task => task.id === taskId)?.name || '';
    }

    function isValidTask(project, taskId) {
        if (!taskId) return true;
        if (!project || !Array.isArray(project.tasks)) return false;
        return Boolean(project.tasks.find(task => task.id === taskId && !task.archived));
    }

    function getTimeEntryDurationMs(entry) {
        if (typeof global.isHiddenAutoAssignedTimeEntry === 'function' && global.isHiddenAutoAssignedTimeEntry(entry)) {
            return 0;
        }
        if (typeof global.getTimeEntryDurationMs === 'function') {
            return global.getTimeEntryDurationMs(entry);
        }
        if (typeof global.getProjectTimeEntryDurationMs === 'function') {
            return global.getProjectTimeEntryDurationMs(entry);
        }
        const assigned = Array.isArray(entry?.activities)
            ? entry.activities.reduce((total, activity) => {
                const assignedDuration = Number(activity?.assignedDurationMs);
                const duration = Number(activity?.duration);
                if (Number.isFinite(assignedDuration) && assignedDuration > 0) return total + assignedDuration;
                if (Number.isFinite(duration) && duration > 0) return total + duration;
                return total;
            }, 0)
            : 0;
        return assigned > 0
            ? assigned
            : Math.max(0, Number(entry?.end || 0) - Number(entry?.start || 0));
    }

    function clipRangeToDay(item, dayStart, dayEnd) {
        const start = Math.max(dayStart, Number(item?.start || 0));
        const end = Math.min(dayEnd, Number(item?.end || 0));
        return end > start ? { start, end } : null;
    }

    function subtractRanges(baseRanges, blockerRanges) {
        const blockers = blockerRanges
            .filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
            .sort((first, second) => first.start - second.start);
        const output = [];

        for (const range of baseRanges) {
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

    function getRawTimelineActivities() {
        return Array.isArray(global.state?.timelineActivities) && global.state.timelineActivities.length > 0
            ? global.state.timelineActivities
            : (global.state?.activities || []);
    }

    function getLoggedRangesForDay(dayStart, dayEnd) {
        return (global.state?.timeEntries || [])
            .filter(entry => getTimeEntryDurationMs(entry) > 0)
            .map(entry => clipRangeToDay(entry, dayStart, dayEnd))
            .filter(Boolean);
    }

    function buildAiDraftActivityFragments(dateStr = getDateString()) {
        const { start: dayStart, end: dayEnd } = getDayBounds(dateStr);
        const loggedRanges = getLoggedRangesForDay(dayStart, dayEnd);
        const fragments = [];

        for (const activity of getRawTimelineActivities()) {
            if (shouldExcludeAiDraftActivity(activity)) continue;
            const clipped = clipRangeToDay(activity, dayStart, dayEnd);
            if (!clipped) continue;
            const unloggedPieces = subtractRanges([clipped], loggedRanges)
                .filter(range => range.end - range.start >= AI_UNLOGGED_RANGE_DETAIL_MIN_MS);

            for (const range of unloggedPieces) {
                const duration = range.end - range.start;
                fragments.push({
                    ...activity,
                    start: range.start,
                    end: range.end,
                    duration,
                    assignedDurationMs: duration,
                    assignmentStart: range.start,
                    assignmentEnd: range.end,
                    assignmentSource: 'activity-stream',
                    assignmentModel: 'activity-stream-summary',
                    assignmentDisplayZoom: Number.isFinite(global.state?.zoom) ? global.state.zoom : undefined
                });
            }
        }

        return fragments.sort((first, second) => first.start - second.start || first.end - second.end);
    }

    function sanitizeAiDraftCandidate(activity, index) {
        const durationMs = Math.max(0, Number(activity?.duration || 0));
        return {
            id: `draft-candidate-${index + 1}`,
            start: activity.start,
            end: activity.end,
            startTime: formatClock(activity.start),
            endTime: formatClock(activity.end),
            durationMs,
            duration: formatDuration(durationMs),
            app: String(activity.app || ''),
            title: cleanActivityTitle(activity.title || activity.app || '', activity),
            domain: domainFromUrl(activity.url),
            description: activityContextLabel(activity)
        };
    }

    function buildAiDraftActivitySet(dateStr = getDateString()) {
        const activities = buildAiDraftActivityFragments(dateStr);
        if (activities.length === 0) return null;

        const durationMs = activities.reduce((total, activity) => total + Math.max(0, Number(activity.duration || 0)), 0);
        return {
            type: 'draftActivitySet',
            activityCount: activities.length,
            durationMs,
            duration: formatDuration(durationMs),
            activities
        };
    }

    function classifyAiPromptIntent(prompt) {
        const text = String(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const entryDraftPattern = /\b(suggest|draft|create|make|add|propose)\s+(?:time\s+)?entries?\b|\b(draft|create|make|add|log)\s+(?:a\s+|an\s+|the\s+)?(?:time\s+)?entry\b|\blog\s+(?:this|that|the unlogged|unlogged time)\b/;
        const specificRangePattern = /\b(?:\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm))\b.*\b(?:\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm))\b/;
        const assignmentPattern = /\b(update|change|move|assign|reassign)\b.*\b(project|assignment|entry|task)\b/;
        const projectTotalsPattern = /\b(project totals?|show project totals?|project time|billable|non-?billable)\b/;
        const loggingReviewPattern = /\b(unlogged|still needs logging|needs logging|missing log|missing time|gaps?)\b/;

        if (entryDraftPattern.test(text)) {
            return {
                kind: 'entryDraft',
                allowDraftSuggestions: true,
                allowUpdateAssignmentSuggestions: false,
                draftMode: specificRangePattern.test(text) ? 'singleRange' : 'activitySet'
            };
        }
        if (assignmentPattern.test(text)) {
            return {
                kind: 'assignmentUpdate',
                allowDraftSuggestions: false,
                allowUpdateAssignmentSuggestions: true
            };
        }
        if (projectTotalsPattern.test(text)) {
            return {
                kind: 'projectTotals',
                allowDraftSuggestions: false,
                allowUpdateAssignmentSuggestions: false
            };
        }
        if (loggingReviewPattern.test(text)) {
            return {
                kind: 'loggingReview',
                allowDraftSuggestions: false,
                allowUpdateAssignmentSuggestions: false
            };
        }
        return {
            kind: 'summary',
            allowDraftSuggestions: false,
            allowUpdateAssignmentSuggestions: false
        };
    }

    function createAiChatState({ maxPromptMessages = AI_PROMPT_MESSAGE_LIMIT } = {}) {
        const chatsByDate = new Map();
        let sequence = 0;

        function createChat(dateStr) {
            const chat = {
                id: `chat-${Date.now()}-${sequence++}`,
                date: dateStr,
                title: 'New Chat',
                createdAt: Date.now(),
                messages: []
            };
            return chat;
        }

        function getChatsForDate(dateStr) {
            const chat = chatsByDate.get(dateStr);
            return chat ? [chat] : [];
        }

        function resetChatForDate(dateStr) {
            const chat = createChat(dateStr);
            chatsByDate.set(dateStr, chat);
            return chat;
        }

        function startNewChat(dateStr) {
            return resetChatForDate(dateStr);
        }

        function getActiveChat(dateStr) {
            return chatsByDate.get(dateStr) || null;
        }

        function ensureChatForDate(dateStr) {
            return getActiveChat(dateStr) || resetChatForDate(dateStr);
        }

        function setActiveChat(dateStr, chatId) {
            const chat = getActiveChat(dateStr);
            if (!chatId) return chat;
            return chat?.id === chatId ? chat : null;
        }

        function appendMessage(dateStr, chatId, message) {
            const chat = setActiveChat(dateStr, chatId) || ensureChatForDate(dateStr);
            const normalized = {
                id: `message-${Date.now()}-${sequence++}`,
                role: message.role,
                content: String(message.content || ''),
                suggestions: Array.isArray(message.suggestions) ? message.suggestions : [],
                createdAt: Date.now()
            };
            chat.messages.push(normalized);
            if (normalized.role === 'user' && chat.title === 'New Chat') {
                chat.title = normalized.content.slice(0, 42) || 'New Chat';
            }
            return normalized;
        }

        function getPromptMessages(dateStr, chatId) {
            const chat = setActiveChat(dateStr, chatId);
            if (!chat) return [];
            return chat.messages
                .filter(message => ['user', 'assistant'].includes(message.role) && message.content.trim())
                .slice(-maxPromptMessages)
                .map(message => ({ role: message.role, content: message.content }));
        }

        return {
            getChatsForDate,
            getActiveChat,
            ensureChatForDate,
            resetChatForDate,
            startNewChat,
            setActiveChat,
            appendMessage,
            getPromptMessages
        };
    }

    function buildAiDayContext(dateStr = getDateString()) {
        const { start: dayStart, end: dayEnd } = getDayBounds(dateStr);
        const allActivities = getRawTimelineActivities()
            .map(activity => {
                const range = clipRangeToDay(activity, dayStart, dayEnd);
                if (!range) return null;
                return {
                    start: range.start,
                    end: range.end,
                    startTime: formatClock(range.start),
                    endTime: formatClock(range.end),
                    durationMs: range.end - range.start,
                    duration: formatDuration(range.end - range.start),
                    app: String(activity.app || ''),
                    title: cleanActivityTitle(activity.title || activity.app || '', activity),
                    domain: domainFromUrl(activity.url)
                };
            })
            .filter(Boolean);
        const activities = allActivities.slice(0, AI_CONTEXT_ITEM_LIMIT);

        const allLoggedEntries = (global.state?.timeEntries || [])
            .filter(entry => getTimeEntryDurationMs(entry) > 0)
            .map(entry => {
                const range = clipRangeToDay(entry, dayStart, dayEnd);
                if (!range) return null;
                const project = getProject(entry.projectId);
                const durationMs = getTimeEntryDurationMs(entry);
                return {
                    id: String(entry.id || ''),
                    start: range.start,
                    end: range.end,
                    startTime: formatClock(range.start),
                    endTime: formatClock(range.end),
                    durationMs,
                    duration: formatDuration(durationMs),
                    description: String(entry.description || ''),
                    projectId: String(entry.projectId || ''),
                    projectName: project?.name || 'Unknown Project',
                    taskId: String(entry.taskId || ''),
                    taskName: getTaskName(project, entry.taskId),
                    billable: Boolean(entry.billable)
                };
            })
            .filter(Boolean);
        const loggedEntries = allLoggedEntries.slice(0, AI_CONTEXT_ITEM_LIMIT);

        const activityRanges = allActivities.map(activity => ({ start: activity.start, end: activity.end }));
        const loggedRanges = allLoggedEntries.map(entry => ({ start: entry.start, end: entry.end }));
        const allUnloggedFragments = subtractRanges(activityRanges, loggedRanges)
            .filter(range => range.end > range.start)
            .map(range => ({
                start: range.start,
                end: range.end,
                startTime: formatClock(range.start),
                endTime: formatClock(range.end),
                durationMs: range.end - range.start,
                duration: formatDuration(range.end - range.start)
            }));
        const allActionableUnloggedRanges = allUnloggedFragments
            .filter(range => range.durationMs >= AI_UNLOGGED_RANGE_DETAIL_MIN_MS);
        const unloggedRanges = allActionableUnloggedRanges.slice(0, AI_CONTEXT_ITEM_LIMIT);

        const recordedMs = allActivities.reduce((total, activity) => total + activity.durationMs, 0);
        const loggedMs = allLoggedEntries.reduce((total, entry) => total + entry.durationMs, 0);
        const billableMs = allLoggedEntries.reduce((total, entry) => total + (entry.billable ? entry.durationMs : 0), 0);
        const unloggedMs = allUnloggedFragments.reduce((total, range) => total + range.durationMs, 0);
        const actionableUnloggedMs = allActionableUnloggedRanges.reduce((total, range) => total + range.durationMs, 0);
        const shortUnloggedMs = Math.max(0, unloggedMs - actionableUnloggedMs);
        const allDraftCandidates = buildAiDraftActivityFragments(dateStr)
            .map((activity, index) => sanitizeAiDraftCandidate(activity, index));
        const draftCandidates = allDraftCandidates.slice(0, AI_CONTEXT_ITEM_LIMIT);
        const draftCandidateDurationMs = allDraftCandidates.reduce((total, candidate) => total + candidate.durationMs, 0);

        return {
            date: dateStr,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
            metadata: {
                activityCount: allActivities.length,
                activitiesIncluded: activities.length,
                activitiesOmitted: Math.max(0, allActivities.length - activities.length),
                loggedEntryCount: allLoggedEntries.length,
                loggedEntriesIncluded: loggedEntries.length,
                loggedEntriesOmitted: Math.max(0, allLoggedEntries.length - loggedEntries.length),
                unloggedRangeCount: allActionableUnloggedRanges.length,
                unloggedRangesIncluded: unloggedRanges.length,
                unloggedRangesOmitted: Math.max(0, allActionableUnloggedRanges.length - unloggedRanges.length),
                unloggedFragmentCount: allUnloggedFragments.length,
                actionableUnloggedRangeCount: allActionableUnloggedRanges.length,
                unloggedRangeDetailMinimumMs: AI_UNLOGGED_RANGE_DETAIL_MIN_MS,
                draftCandidateCount: allDraftCandidates.length,
                draftCandidatesIncluded: draftCandidates.length,
                draftCandidatesOmitted: Math.max(0, allDraftCandidates.length - draftCandidates.length),
                draftCandidateDurationMs,
                draftCandidateDuration: formatDuration(draftCandidateDurationMs)
            },
            totals: {
                recordedMs,
                recorded: formatDuration(recordedMs),
                loggedMs,
                logged: formatDuration(loggedMs),
                billableMs,
                billable: formatDuration(billableMs),
                nonBillableMs: Math.max(0, loggedMs - billableMs),
                nonBillable: formatDuration(Math.max(0, loggedMs - billableMs)),
                unloggedMs,
                unlogged: formatDuration(unloggedMs),
                actionableUnloggedMs,
                actionableUnlogged: formatDuration(actionableUnloggedMs),
                shortUnloggedMs,
                shortUnlogged: formatDuration(shortUnloggedMs)
            },
            activities,
            loggedEntries,
            unloggedRanges,
            draftCandidates,
            projects: (global.state?.projects || []).map(project => ({
                id: String(project.id || ''),
                name: String(project.name || ''),
                billable: Boolean(project.billable),
                tasks: Array.isArray(project.tasks)
                    ? project.tasks.filter(task => !task.archived).map(task => ({ id: task.id, name: task.name }))
                    : []
            }))
        };
    }

    function isValidProject(projectId) {
        return Boolean((global.state?.projects || []).find(project => project.id === projectId));
    }

    function activityContextLabel(activity) {
        const app = String(activity?.app || '').trim();
        const title = cleanActivityTitle(activity?.title || '', activity).trim();
        const domain = domainFromUrl(activity?.url || '');
        if (title && title !== app && isBrowserLikeApp(app)) return title;
        return app || title || domain || 'Unlogged work';
    }

    function deriveAiDraftDescription(start, end) {
        const rawActivities = Array.isArray(global.state?.timelineActivities) && global.state.timelineActivities.length > 0
            ? global.state.timelineActivities
            : (global.state?.activities || []);
        const totalsByLabel = new Map();
        for (const activity of rawActivities) {
            const overlap = activityOverlapMs(activity, start, end);
            if (overlap <= 0) continue;
            const label = activityContextLabel(activity);
            totalsByLabel.set(label, (totalsByLabel.get(label) || 0) + overlap);
        }
        const ranked = Array.from(totalsByLabel.entries())
            .sort((first, second) => second[1] - first[1]);
        if (ranked.length === 0) return '';

        const duration = Math.max(1, end - start);
        const meaningfulLabels = ranked
            .filter(([_label, overlap]) => overlap >= Math.max(60 * 1000, duration * 0.2))
            .slice(0, 2)
            .map(([label]) => label);
        const labels = meaningfulLabels.length > 0 ? meaningfulLabels : [ranked[0][0]];
        return labels.length === 2 ? `${labels[0]} and ${labels[1]}` : labels[0];
    }

    function rangeIsContained(start, end, ranges) {
        return ranges.some(range => start >= Number(range.start || 0) && end <= Number(range.end || 0));
    }

    function normalizeAiResponseIntent(options = {}) {
        return options.intent || {
            kind: 'entryDraft',
            allowDraftSuggestions: true,
            allowUpdateAssignmentSuggestions: true
        };
    }

    function normalizeAiResponse(raw, options = {}) {
        let candidate = raw;
        if (typeof candidate === 'string') {
            try {
                candidate = JSON.parse(candidate);
            } catch (_error) {
                candidate = { text: candidate, suggestions: [] };
            }
        }

        const text = String(candidate?.text || candidate?.message || candidate?.answer || '').trim();
        const suggestions = Array.isArray(candidate?.suggestions)
            ? candidate.suggestions
            : [];
        const intent = normalizeAiResponseIntent(options);
        const dayContext = options.dayContext || null;
        const dateStr = dayContext?.date || getDateString();
        const dayBounds = getDayBounds(dateStr);
        const useLocalDraftSet = intent.kind === 'entryDraft' && intent.draftMode === 'activitySet';
        const localDraftActivitySet = useLocalDraftSet && options.draftActivitySet?.activityCount > 0
            ? options.draftActivitySet
            : null;
        const providerSuggestions = useLocalDraftSet ? [] : suggestions;
        const normalizedSuggestions = providerSuggestions
            .map(suggestion => {
                const type = suggestion?.type;
                if (type === 'draftEntry') {
                    if (!intent.allowDraftSuggestions) return null;
                    const start = Number(suggestion.start);
                    const end = Number(suggestion.end);
                    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
                    if (end - start < AI_UNLOGGED_RANGE_DETAIL_MIN_MS) return null;
                    if (start < dayBounds.start || end > dayBounds.end) return null;
                    const projectId = String(suggestion.projectId || '');
                    const taskId = String(suggestion.taskId || '');
                    const project = projectId ? getProject(projectId) : null;
                    if (projectId && !project) return null;
                    if (taskId && !isValidTask(project, taskId)) return null;
                    if (dayContext && !rangeIsContained(start, end, dayContext.unloggedRanges || [])) return null;
                    return {
                        type,
                        start,
                        end,
                        description: deriveAiDraftDescription(start, end),
                        projectId,
                        taskId,
                        billable: Boolean(suggestion.billable)
                    };
                }
                if (type === 'updateAssignment') {
                    if (!intent.allowUpdateAssignmentSuggestions) return null;
                    const entryId = String(suggestion.entryId || '');
                    const projectId = String(suggestion.projectId || '');
                    const taskId = String(suggestion.taskId || '');
                    const project = getProject(projectId);
                    if (!entryId || !projectId || !project) return null;
                    if (taskId && !isValidTask(project, taskId)) return null;
                    return {
                        type,
                        entryId,
                        projectId,
                        taskId
                    };
                }
                return null;
            })
            .filter(Boolean);

        if (localDraftActivitySet) {
            normalizedSuggestions.unshift(localDraftActivitySet);
        }

        return {
            text: text || 'No response text returned.',
            suggestions: normalizedSuggestions
        };
    }

    const aiChats = createAiChatState();
    let aiKeyStatus = { openai: false, google: false, anthropic: false };
    let aiModelCache = loadAiModelCache();
    let aiInitialized = false;
    let aiIsLoading = false;
    let aiSettingsFeedbackTimer = null;
    let aiKeyEditProvider = null;
    let aiModelRefreshState = { provider: '', status: 'idle', message: '', count: 0, refreshedAt: '' };
    let aiModelRefreshConfirmProvider = '';
    let aiModelRefreshSuccessTimer = null;

    function byId(id) {
        return global.document?.getElementById?.(id) || null;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function providerConfig(provider) {
        return AI_PROVIDERS.find(candidate => candidate.id === provider) || null;
    }

    function providerIds() {
        return AI_PROVIDERS.map(provider => provider.id);
    }

    function selectedProvider() {
        const provider = global.state?.settings?.aiProvider || '';
        return providerConfig(provider) ? provider : '';
    }

    function modelForProvider(provider) {
        const config = providerConfig(provider) || AI_PROVIDERS[0];
        return global.state?.settings?.[config.settingKey] || config.defaultModel;
    }

    function selectedModel() {
        return modelForProvider(selectedProvider() || 'openai');
    }

    function loadAiModelCache() {
        try {
            const parsed = JSON.parse(global.localStorage?.getItem?.(AI_MODEL_CACHE_KEY) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_error) {
            return {};
        }
    }

    function saveAiModelCache() {
        try {
            global.localStorage?.setItem?.(AI_MODEL_CACHE_KEY, JSON.stringify(aiModelCache));
        } catch (_error) {
            // Model cache is a non-secret convenience; ignore storage failures.
        }
    }

    function cachedModelsForProvider(provider) {
        const cached = aiModelCache?.[provider]?.models;
        return Array.isArray(cached) ? cached.filter(Boolean) : [];
    }

    function isCuratedModel(provider, model) {
        const config = providerConfig(provider);
        return Boolean(config?.curatedModels?.includes(model));
    }

    function isCachedModel(provider, model) {
        return cachedModelsForProvider(provider).includes(model);
    }

    function modelOptionsForProvider(provider) {
        const config = providerConfig(provider) || AI_PROVIDERS[0];
        const ids = [...config.curatedModels, ...cachedModelsForProvider(config.id), modelForProvider(config.id)];
        return Array.from(new Set(ids.map(model => String(model || '').trim()).filter(Boolean)));
    }

    function activityOverlapMs(activity, start, end) {
        return Math.max(0, Math.min(Number(activity?.end || 0), end) - Math.max(Number(activity?.start || 0), start));
    }

    function dominantActivityLabel(start, end) {
        const rawActivities = Array.isArray(global.state?.timelineActivities) && global.state.timelineActivities.length > 0
            ? global.state.timelineActivities
            : (global.state?.activities || []);
        let bestActivity = null;
        let bestOverlap = 0;
        for (const activity of rawActivities) {
            const overlap = activityOverlapMs(activity, start, end);
            if (overlap > bestOverlap) {
                bestActivity = activity;
                bestOverlap = overlap;
            }
        }
        return bestActivity ? String(bestActivity.app || cleanActivityTitle(bestActivity.title || '', bestActivity) || '').trim() : '';
    }

    function describeAiSuggestion(suggestion) {
        if (suggestion.type === 'draftActivitySet') {
            const count = Number(suggestion.activityCount || suggestion.activities?.length || 0);
            const duration = suggestion.duration || formatDuration(suggestion.durationMs);
            return {
                title: `Review ${count} proposed ${count === 1 ? 'activity' : 'activities'}`,
                detail: duration ? `${duration} captured activity` : ''
            };
        }
        if (suggestion.type === 'draftEntry') {
            const range = `${formatClock(suggestion.start)}-${formatClock(suggestion.end)}`;
            const description = String(suggestion.description || '').trim();
            const fallback = dominantActivityLabel(suggestion.start, suggestion.end);
            const subject = description || fallback;
            const project = getProject(suggestion.projectId);
            const taskName = getTaskName(project, suggestion.taskId);
            return {
                title: subject ? `Draft: ${subject}, ${range}` : `Draft entry, ${range}`,
                detail: project ? [project.name, taskName].filter(Boolean).join(' / ') : ''
            };
        }
        const project = getProject(suggestion.projectId);
        const taskName = getTaskName(project, suggestion.taskId);
        return {
            title: 'Review assignment change',
            detail: project ? [project.name, taskName].filter(Boolean).join(' / ') : ''
        };
    }

    function setAiStatus(message, tone = 'muted') {
        const status = byId('ai-status');
        if (!status) return;
        status.textContent = message;
        status.dataset.tone = tone;
        status.closest?.('.ai-status-line')?.classList.toggle('is-empty', !message && !aiIsLoading);
    }

    function setAiSettingsFeedback(message, tone = 'muted', { autoClear = true } = {}) {
        const feedback = byId('ai-settings-feedback');
        if (!feedback) return;
        if (aiSettingsFeedbackTimer) {
            clearTimeout(aiSettingsFeedbackTimer);
            aiSettingsFeedbackTimer = null;
        }
        feedback.textContent = message;
        feedback.dataset.tone = tone;
        if (message && autoClear) {
            aiSettingsFeedbackTimer = setTimeout(() => {
                feedback.textContent = '';
                feedback.dataset.tone = 'muted';
                aiSettingsFeedbackTimer = null;
            }, 2600);
        }
    }

    function clearAiModelRefreshSuccessTimer() {
        if (!aiModelRefreshSuccessTimer) return;
        global.clearTimeout?.(aiModelRefreshSuccessTimer);
        aiModelRefreshSuccessTimer = null;
    }

    function scheduleAiModelRefreshSuccessClear(provider) {
        clearAiModelRefreshSuccessTimer();
        if (typeof global.setTimeout !== 'function') return;
        aiModelRefreshSuccessTimer = global.setTimeout(() => {
            aiModelRefreshSuccessTimer = null;
            if (aiModelRefreshState.provider === provider && aiModelRefreshState.status === 'success') {
                aiModelRefreshState = { provider: '', status: 'idle', message: '', count: 0, refreshedAt: '' };
                renderAiModelPicker();
            }
        }, AI_MODEL_REFRESH_SUCCESS_MS);
    }

    function clearAiModelRefreshSuccessState() {
        clearAiModelRefreshSuccessTimer();
        if (aiModelRefreshState.status === 'success') {
            aiModelRefreshState = { provider: '', status: 'idle', message: '', count: 0, refreshedAt: '' };
        }
    }

    function providerLabel(provider) {
        return providerConfig(provider)?.label || 'AI';
    }

    function setAiSettingsOpen(isOpen) {
        const panel = byId('ai-settings-panel');
        const button = byId('ai-settings-button');
        panel?.classList.toggle('hidden', !isOpen);
        button?.setAttribute('aria-expanded', String(Boolean(isOpen)));
        if (!isOpen) setAiSettingsFeedback('', 'muted', { autoClear: false });
        if (isOpen) renderAiModelOptions();
        if (!isOpen) setAiModelPickerOpen(false);
    }

    function setAiLoadingState(isLoading) {
        aiIsLoading = Boolean(isLoading);
        const composer = global.document?.querySelector?.('.ai-composer');
        const spinner = byId('ai-loading-spinner');
        const input = byId('ai-chat-input');
        const sendButton = byId('ai-send-button');
        const sendLabel = sendButton?.querySelector?.('span');
        const status = byId('ai-status');

        composer?.setAttribute('aria-busy', String(aiIsLoading));
        spinner?.classList.toggle('hidden', !aiIsLoading);
        if (input) input.disabled = aiIsLoading;
        if (sendButton) sendButton.disabled = aiIsLoading;
        if (sendLabel) sendLabel.textContent = aiIsLoading ? 'Asking' : 'Send';
        status?.closest?.('.ai-status-line')?.classList.toggle('is-empty', !status.textContent && !aiIsLoading);
        global.document?.querySelectorAll?.('[data-ai-prompt]')?.forEach(button => {
            button.disabled = aiIsLoading;
        });
    }

    function setSidebarTab(tab, { persist = true } = {}) {
        const nextTab = tab === 'ai' ? 'ai' : 'work-times';
        const workTab = byId('sidebar-tab-work-times');
        const aiTab = byId('sidebar-tab-ai');
        const workPanel = byId('work-times-panel');
        const aiPanel = byId('ai-sidebar-panel');

        workTab?.classList.toggle('is-active', nextTab === 'work-times');
        aiTab?.classList.toggle('is-active', nextTab === 'ai');
        workTab?.setAttribute('aria-selected', String(nextTab === 'work-times'));
        aiTab?.setAttribute('aria-selected', String(nextTab === 'ai'));
        workPanel?.classList.toggle('hidden', nextTab !== 'work-times');
        aiPanel?.classList.toggle('hidden', nextTab !== 'ai');

        if (persist) {
            try {
                global.localStorage?.setItem?.('sidebarActiveTab', nextTab);
            } catch (_error) {
                // Ignore storage failures in private or restricted contexts.
            }
        }
        if (nextTab === 'ai') renderAiSidebar();
    }

    function syncAiSettingsControls({ resetKey = false } = {}) {
        renderAiProviderCards();
        renderAiKeyControls({ resetKey });
        renderAiModelPicker();
    }

    function setElementHidden(element, isHidden) {
        element?.classList.toggle('hidden', Boolean(isHidden));
    }

    function renderAiKeyControls({ resetKey = false } = {}) {
        const provider = selectedProvider();
        const hasProvider = Boolean(provider);
        const hasKey = hasProvider && Boolean(aiKeyStatus[provider]);
        const isEditing = hasKey && aiKeyEditProvider === provider;
        const keyInput = byId('ai-api-key-input');
        const editButton = byId('ai-key-edit-button');
        const saveButton = byId('ai-key-save-button');
        const saveLabel = byId('ai-key-save-label') || saveButton?.querySelector?.('span');
        const cancelButton = byId('ai-key-cancel-button');
        const deleteButton = byId('ai-key-delete-button');

        if (aiKeyEditProvider && aiKeyEditProvider !== provider) {
            aiKeyEditProvider = null;
        }

        if (keyInput) {
            keyInput.disabled = !hasProvider || (hasKey && !isEditing);
            keyInput.placeholder = !hasProvider
                ? 'Choose provider first'
                : (hasKey && !isEditing ? '' : (isEditing ? 'Paste new API key' : 'Paste API key'));
            if (resetKey || (hasKey && !isEditing)) {
                keyInput.value = hasKey && !isEditing ? '********' : '';
            }
        }

        setElementHidden(editButton, !hasKey || isEditing);
        setElementHidden(saveButton, !hasProvider || (hasKey && !isEditing));
        setElementHidden(cancelButton, !isEditing);
        setElementHidden(deleteButton, !hasKey || isEditing);
        if (saveLabel) saveLabel.textContent = isEditing ? 'Save new key' : 'Save key';
    }

    function setAiKeyEditMode(isEditing) {
        const provider = selectedProvider();
        aiKeyEditProvider = isEditing && provider ? provider : null;
        syncAiSettingsControls({ resetKey: true });
        if (isEditing) byId('ai-api-key-input')?.focus?.({ preventScroll: true });
    }

    async function saveAiSettings(partial) {
        Object.assign(global.state.settings, partial);
        if (partial.aiProvider !== undefined) global.localStorage?.setItem?.('aiProvider', partial.aiProvider);
        if (partial.aiOpenAIModel !== undefined) global.localStorage?.setItem?.('aiOpenAIModel', partial.aiOpenAIModel);
        if (partial.aiGoogleModel !== undefined) global.localStorage?.setItem?.('aiGoogleModel', partial.aiGoogleModel);
        if (partial.aiAnthropicModel !== undefined) global.localStorage?.setItem?.('aiAnthropicModel', partial.aiAnthropicModel);
        if (!global.OrielData?.isNative) return;
        try {
            const updated = await global.OrielData.request('ai.settings.update', partial);
            Object.assign(global.state.settings, updated);
        } catch (error) {
            console.error('Error saving AI settings:', error);
            setAiSettingsFeedback('Could not save AI settings.', 'error');
        }
    }

    async function resolveAiProviderSelection(status = aiKeyStatus) {
        if (selectedProvider()) return selectedProvider();
        const configuredProviders = providerIds().filter(provider => Boolean(status?.[provider]));
        if (configuredProviders.length !== 1) return '';
        const provider = configuredProviders[0];
        await saveAiSettings({ aiProvider: provider });
        return provider;
    }

    function renderAiProviderCards() {
        const provider = selectedProvider();
        AI_PROVIDERS.forEach(config => {
            const card = global.document?.querySelector?.(`[data-ai-provider="${config.id}"]`);
            const keyState = byId(`ai-provider-${config.id}-key-state`);
            const hasKey = Boolean(aiKeyStatus[config.id]);
            card?.classList.toggle('is-selected', provider === config.id);
            card?.setAttribute('aria-checked', String(provider === config.id));
            if (keyState) {
                keyState.dataset.state = hasKey ? 'saved' : 'missing';
                if (hasKey) {
                    keyState.textContent = '';
                    keyState.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i>';
                    keyState.setAttribute('aria-label', 'Key saved');
                    keyState.setAttribute('title', 'Key saved');
                } else {
                    keyState.innerHTML = '';
                    keyState.textContent = 'No key';
                    keyState.removeAttribute?.('aria-label');
                    keyState.removeAttribute?.('title');
                }
            }
        });
    }

    function renderAiSettingsStatus() {
        const keyStatus = byId('ai-settings-key-status');
        if (!keyStatus) return;

        const provider = selectedProvider();
        const configuredCount = providerIds().filter(candidate => Boolean(aiKeyStatus[candidate])).length;
        if (provider && aiKeyStatus[provider]) {
            keyStatus.textContent = 'Configured';
            keyStatus.dataset.state = 'ready';
        } else if (!provider && configuredCount > 1) {
            keyStatus.textContent = 'Choose provider';
            keyStatus.dataset.state = 'unconfigured';
        } else if (!provider) {
            keyStatus.textContent = 'Add key';
            keyStatus.dataset.state = 'missing';
        } else {
            keyStatus.textContent = 'Key needed';
            keyStatus.dataset.state = 'missing';
        }
    }

    function setAiModelPickerOpen(isOpen) {
        const menu = byId('ai-model-picker-menu');
        const button = byId('ai-model-picker-button');
        menu?.classList.toggle('hidden', !isOpen);
        button?.setAttribute('aria-expanded', String(Boolean(isOpen)));
        if (!isOpen) aiModelRefreshConfirmProvider = '';
        if (isOpen) {
            const search = byId('ai-model-search-input');
            if (search) search.value = '';
            renderAiModelOptions();
            search?.focus?.({ preventScroll: true });
        }
    }

    function renderAiModelPicker() {
        const provider = selectedProvider() || 'openai';
        const label = byId('ai-model-picker-label');
        const button = byId('ai-model-picker-button');
        const refreshButton = byId('ai-model-refresh-button');
        const refreshIcon = refreshButton?.querySelector?.('i');
        const refreshLabel = byId('ai-model-refresh-label') || refreshButton?.querySelector?.('span');
        const refreshConfirm = byId('ai-model-refresh-confirm');
        const refreshConfirmText = byId('ai-model-refresh-confirm-text');
        const refreshConfirmButton = byId('ai-model-refresh-confirm-button');
        const refreshCancelButton = byId('ai-model-refresh-cancel-button');
        const meta = byId('ai-model-refresh-meta');
        const selected = modelForProvider(provider);
        const stateApplies = aiModelRefreshState.provider === provider;
        if (aiModelRefreshConfirmProvider && aiModelRefreshConfirmProvider !== selectedProvider()) {
            aiModelRefreshConfirmProvider = '';
        }
        if (label) label.textContent = selected;
        if (button) button.disabled = !selectedProvider();

        const isRefreshing = stateApplies && aiModelRefreshState.status === 'loading';
        const isSuccess = stateApplies && aiModelRefreshState.status === 'success' && aiModelRefreshState.count > 0;
        const isConfirming = Boolean(selectedProvider()) && aiModelRefreshConfirmProvider === provider;
        if (refreshButton) {
            refreshButton.disabled = !selectedProvider() || isRefreshing;
            refreshButton.classList.toggle('is-loading', isRefreshing);
            refreshButton.classList.toggle('is-success', isSuccess);
        }
        if (refreshIcon) {
            refreshIcon.className = isSuccess ? 'ph ph-check' : 'ph ph-arrows-clockwise';
            refreshIcon.classList.toggle('is-loading', isRefreshing);
        }
        if (refreshLabel) {
            refreshLabel.textContent = isRefreshing
                ? 'Refreshing...'
                : (isSuccess ? 'Models refreshed' : 'Refresh from provider...');
        }
        setElementHidden(refreshConfirm, !isConfirming);
        if (refreshConfirmText && isConfirming) {
            refreshConfirmText.textContent = `Refresh ${providerLabel(provider)} models now? This will contact the provider API once.`;
        }
        if (refreshConfirmButton) refreshConfirmButton.disabled = isRefreshing;
        if (refreshCancelButton) refreshCancelButton.disabled = isRefreshing;

        if (meta) {
            meta.dataset.tone = 'muted';
            if (stateApplies && aiModelRefreshState.status === 'loading') {
                meta.textContent = 'Refreshing models...';
            } else if (stateApplies && aiModelRefreshState.status === 'error') {
                meta.textContent = aiModelRefreshState.message || 'Could not refresh models.';
                meta.dataset.tone = 'error';
            } else if (stateApplies && aiModelRefreshState.status === 'success' && aiModelRefreshState.count === 0) {
                meta.textContent = 'No compatible models returned.';
            } else {
                meta.textContent = '';
            }
        }
        renderAiModelOptions();
    }

    function modelOptionSource(provider, model, { isCustomSearch = false } = {}) {
        if (isCustomSearch) return 'Custom';
        if (isCuratedModel(provider, model)) return 'Model';
        if (isCachedModel(provider, model)) return 'Fetched';
        return 'Custom';
    }

    function renderAiModelOptions() {
        const list = byId('ai-model-option-list');
        if (!list) return;
        const provider = selectedProvider() || 'openai';
        const search = String(byId('ai-model-search-input')?.value || '').trim();
        const selected = modelForProvider(provider);
        const lowerSearch = search.toLowerCase();
        const options = modelOptionsForProvider(provider)
            .filter(model => !lowerSearch || model.toLowerCase().includes(lowerSearch));

        const exactSearchMatch = search && modelOptionsForProvider(provider).some(model => model.toLowerCase() === lowerSearch);
        if (search && !exactSearchMatch) options.unshift(search);

        if (options.length === 0) {
            list.innerHTML = '<div class="ai-model-option" aria-disabled="true">No matching models</div>';
            return;
        }

        list.innerHTML = options.map(model => {
            const isSelected = model === selected;
            const source = modelOptionSource(provider, model, { isCustomSearch: search && model === search && !exactSearchMatch });
            return `
                <button type="button" class="ai-model-option${isSelected ? ' is-selected' : ''}" data-ai-model="${escapeHtml(model)}" role="option" aria-selected="${String(isSelected)}">
                    <span>${escapeHtml(model)}</span>
                    <span class="ai-model-option-source">${source}</span>
                </button>
            `;
        }).join('');

        list.querySelectorAll?.('[data-ai-model]')?.forEach(button => {
            button.addEventListener('click', () => selectAiModel(button.dataset.aiModel));
        });
    }

    async function selectAiModel(model) {
        const provider = selectedProvider();
        const config = providerConfig(provider);
        const value = String(model || '').trim();
        if (!config || !value) return;
        await saveAiSettings({ [config.settingKey]: value });
        setAiModelPickerOpen(false);
        renderAiSidebar();
    }

    function requestAiModelRefreshConfirmation() {
        clearAiModelRefreshSuccessState();
        const provider = selectedProvider();
        if (!provider) {
            aiModelRefreshConfirmProvider = '';
            aiModelRefreshState = { provider: '', status: 'error', message: 'Choose a provider first.', count: 0, refreshedAt: '' };
            renderAiModelPicker();
            return;
        }
        if (!global.OrielData?.isNative) {
            aiModelRefreshConfirmProvider = '';
            aiModelRefreshState = { provider, status: 'error', message: 'Model refresh requires Oriel.app.', count: 0, refreshedAt: '' };
            renderAiModelPicker();
            return;
        }
        if (!aiKeyStatus[provider]) {
            aiModelRefreshConfirmProvider = '';
            aiModelRefreshState = { provider, status: 'error', message: 'Save a key for this provider first.', count: 0, refreshedAt: '' };
            renderAiModelPicker();
            return;
        }

        aiModelRefreshConfirmProvider = provider;
        renderAiModelPicker();
        setAiModelPickerOpen(true);
    }

    function cancelAiModelRefreshConfirmation() {
        aiModelRefreshConfirmProvider = '';
        renderAiModelPicker();
    }

    async function refreshAiModelsForSelectedProvider() {
        const provider = selectedProvider();
        if (!provider || !global.OrielData?.isNative || !aiKeyStatus[provider]) {
            requestAiModelRefreshConfirmation();
            return;
        }
        if (aiModelRefreshConfirmProvider !== provider) {
            requestAiModelRefreshConfirmation();
            return;
        }

        clearAiModelRefreshSuccessTimer();
        aiModelRefreshConfirmProvider = '';
        aiModelRefreshState = { provider, status: 'loading', message: '', count: 0, refreshedAt: '' };
        renderAiModelPicker();
        try {
            const response = await global.OrielData.request('ai.models.list', { provider });
            const models = Array.isArray(response?.models) ? response.models.filter(Boolean) : [];
            const mergedModels = Array.from(new Set([...cachedModelsForProvider(provider), ...models].map(model => String(model || '').trim()).filter(Boolean)));
            const refreshedAt = response?.refreshedAt || new Date().toISOString();
            aiModelCache[provider] = {
                models: mergedModels,
                refreshedAt
            };
            aiModelRefreshState = {
                provider,
                status: 'success',
                message: models.length > 0 ? 'Model list refreshed.' : 'No compatible models returned.',
                count: models.length,
                refreshedAt
            };
            saveAiModelCache();
            if (models.length > 0) scheduleAiModelRefreshSuccessClear(provider);
            renderAiModelPicker();
        } catch (error) {
            console.error('Error refreshing AI models:', error);
            aiModelRefreshState = {
                provider,
                status: 'error',
                message: error?.message || 'Could not refresh models.',
                count: 0,
                refreshedAt: ''
            };
            renderAiModelPicker();
        }
    }

    async function refreshAiKeyStatus() {
        if (!global.OrielData?.isNative) {
            aiKeyStatus = { openai: false, google: false, anthropic: false };
            return aiKeyStatus;
        }
        try {
            aiKeyStatus = await global.OrielData.request('ai.keys.status', {});
        } catch (error) {
            console.error('Error loading AI key status:', error);
            aiKeyStatus = { openai: false, google: false, anthropic: false };
            setAiSettingsFeedback('Could not read key status.', 'error');
        }
        return aiKeyStatus;
    }

    function renderMessages(dateStr) {
        const messagesEl = byId('ai-chat-messages');
        if (!messagesEl) return;
        const chat = aiChats.getActiveChat(dateStr);
        if (!chat || chat.messages.length === 0) {
            messagesEl.innerHTML = `
                <div class="ai-empty-state">
                    Ask about this day or use Suggest entries to review unlogged work.
                </div>
            `;
            return;
        }

        messagesEl.innerHTML = chat.messages.map(message => `
            <div class="ai-message ai-message--${message.role}">
                <div class="ai-message-role">${message.role === 'user' ? 'You' : 'Oriel AI'}</div>
                <div class="ai-message-content">${escapeHtml(message.content)}</div>
                ${message.suggestions?.length ? `
                    <div class="ai-suggestion-list">
                        ${message.suggestions.map((suggestion, index) => {
                            const description = describeAiSuggestion(suggestion);
                            return `
                            <button type="button" class="ai-suggestion-card" data-suggestion-index="${index}" data-message-id="${escapeHtml(message.id)}">
                                <i class="ph ph-sparkle"></i>
                                <span class="ai-suggestion-text">
                                    <span>${escapeHtml(description.title)}</span>
                                    ${description.detail ? `<span>${escapeHtml(description.detail)}</span>` : ''}
                                </span>
                            </button>
                        `; }).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('');

        messagesEl.querySelectorAll('[data-suggestion-index]').forEach(button => {
            button.addEventListener('click', () => {
                const message = chat.messages.find(candidate => candidate.id === button.dataset.messageId);
                const suggestion = message?.suggestions?.[Number(button.dataset.suggestionIndex)];
                if (suggestion) applyAiSuggestion(suggestion);
            });
        });
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderAiSidebar() {
        const dateStr = getDateString();
        const dateLabel = byId('ai-day-label');
        if (dateLabel) dateLabel.textContent = dateStr;
        syncAiSettingsControls();
        renderMessages(dateStr);
        const newChatButton = byId('ai-new-chat-button');
        if (newChatButton) {
            const activeChat = aiChats.getActiveChat(dateStr);
            newChatButton.disabled = !activeChat || activeChat.messages.length === 0;
        }

        renderAiSettingsStatus();
        setAiLoadingState(aiIsLoading);
    }

    function applyAiSuggestion(suggestion) {
        if (suggestion.type === 'draftActivitySet' && typeof global.openTimeEntryModal === 'function') {
            const activities = Array.isArray(suggestion.activities)
                ? suggestion.activities.filter(activity => (
                    Number.isFinite(activity?.start)
                    && Number.isFinite(activity?.end)
                    && activity.end > activity.start
                ))
                : [];
            if (activities.length === 0) {
                setAiStatus('No draftable activity was found for this suggestion.', 'error');
                return;
            }
            const start = Math.min(...activities.map(activity => activity.start));
            const end = Math.max(...activities.map(activity => activity.end));
            global.window.editingTimeEntryId = null;
            global.window.editingTimeEntryGroupIds = null;
            global.openTimeEntryModal(start, end, '', null, null, true, activities);
            return;
        }

        if (suggestion.type === 'draftEntry' && typeof global.openTimeEntryModal === 'function') {
            global.window.editingTimeEntryId = null;
            global.window.editingTimeEntryGroupIds = null;
            global.openTimeEntryModal(
                suggestion.start,
                suggestion.end,
                suggestion.description,
                suggestion.projectId || null,
                suggestion.billable,
                false,
                null,
                suggestion.taskId || ''
            );
            const descriptionInput = byId('modal-description-input');
            if (descriptionInput && suggestion.description) {
                descriptionInput.value = suggestion.description;
            }
            return;
        }

        if (suggestion.type === 'updateAssignment' && typeof global.openTimeEntryModal === 'function') {
            const entry = (global.state?.timeEntries || []).find(candidate => candidate.id === suggestion.entryId);
            if (!entry) {
                setAiStatus('Suggested entry was not found on this day.', 'error');
                return;
            }
            global.window.editingTimeEntryId = entry.id;
            global.window.editingTimeEntryGroupIds = null;
            global.openTimeEntryModal(
                entry.start,
                entry.end,
                entry.description,
                suggestion.projectId,
                entry.billable,
                false,
                null,
                suggestion.taskId || entry.taskId || ''
            );
        }
    }

    async function sendAiMessage(promptText = null) {
        const input = byId('ai-chat-input');
        const content = String(promptText ?? input?.value ?? '').trim();
        if (!content) return;

        const provider = selectedProvider();
        if (!provider) {
            setAiStatus('Choose an AI provider first.', 'error');
            setAiSettingsOpen(true);
            return;
        }
        if (!global.OrielData?.isNative) {
            setAiStatus('Ask AI requires Oriel.app so your API key can stay in Keychain.', 'error');
            setAiSettingsOpen(true);
            return;
        }
        if (!aiKeyStatus[provider]) {
            setAiStatus('Save an API key for the selected provider first.', 'error');
            setAiSettingsOpen(true);
            return;
        }

        const dateStr = getDateString();
        const intent = classifyAiPromptIntent(content);
        const dayContext = buildAiDayContext(dateStr);
        const draftActivitySet = intent.kind === 'entryDraft' && intent.draftMode === 'activitySet'
            ? buildAiDraftActivitySet(dateStr)
            : null;
        const chat = aiChats.ensureChatForDate(dateStr);
        aiChats.appendMessage(dateStr, chat.id, { role: 'user', content });
        if (input) input.value = '';
        renderAiSidebar();

        setAiLoadingState(true);
        setAiStatus('Asking AI...', 'muted');

        try {
            const activeChat = aiChats.getActiveChat(dateStr);
            const response = await global.OrielData.request('ai.chat', {
                chatId: activeChat.id,
                date: dateStr,
                provider,
                model: selectedModel(),
                messages: aiChats.getPromptMessages(dateStr, activeChat.id),
                intent,
                dayContext
            });
            const normalized = normalizeAiResponse(response, { intent, dayContext, draftActivitySet });
            aiChats.appendMessage(dateStr, activeChat.id, {
                role: 'assistant',
                content: normalized.text,
                suggestions: normalized.suggestions
            });
            setAiStatus('', 'muted');
        } catch (error) {
            console.error('Error asking AI:', error);
            aiChats.appendMessage(dateStr, chat.id, {
                role: 'assistant',
                content: error?.message || 'The AI request failed.'
            });
            setAiStatus('AI request failed.', 'error');
        } finally {
            setAiLoadingState(false);
            renderAiSidebar();
        }
    }

    async function saveAiKey() {
        const provider = selectedProvider();
        const apiKey = byId('ai-api-key-input')?.value?.trim() || '';
        if (!provider || !apiKey) {
            setAiSettingsFeedback('Choose a provider and paste a key.', 'error');
            return;
        }
        if (!global.OrielData?.isNative) {
            setAiSettingsFeedback('Keychain storage is available in Oriel.app.', 'error');
            return;
        }
        try {
            aiKeyStatus = await global.OrielData.request('ai.keys.save', { provider, apiKey });
            aiKeyEditProvider = null;
            byId('ai-api-key-input').value = '';
            setAiSettingsFeedback('Key saved in Keychain.', 'success');
            syncAiSettingsControls({ resetKey: true });
            renderAiSidebar();
        } catch (error) {
            console.error('Error saving AI key:', error);
            setAiSettingsFeedback('Could not save API key.', 'error');
        }
    }

    async function deleteAiKey() {
        const provider = selectedProvider();
        if (!provider || !global.OrielData?.isNative) return;
        const confirmed = typeof global.confirm === 'function'
            ? global.confirm(`Remove the saved ${providerLabel(provider)} API key from Keychain?`)
            : true;
        if (!confirmed) return;
        try {
            aiKeyStatus = await global.OrielData.request('ai.keys.delete', { provider });
            aiKeyEditProvider = null;
            setAiSettingsFeedback('Key removed.', 'success');
            syncAiSettingsControls({ resetKey: true });
            renderAiSidebar();
        } catch (error) {
            console.error('Error deleting AI key:', error);
            setAiSettingsFeedback('Could not remove API key.', 'error');
        }
    }

    function bindAiSidebar() {
        if (aiInitialized || !global.document) return;
        aiInitialized = true;

        byId('sidebar-tab-work-times')?.addEventListener('click', () => setSidebarTab('work-times'));
        byId('sidebar-tab-ai')?.addEventListener('click', () => setSidebarTab('ai'));
        byId('ai-settings-button')?.addEventListener('click', () => {
            const panel = byId('ai-settings-panel');
            setAiSettingsOpen(panel?.classList.contains('hidden'));
        });
        byId('ai-settings-close-button')?.addEventListener('click', () => setAiSettingsOpen(false));
        byId('ai-key-edit-button')?.addEventListener('click', () => setAiKeyEditMode(true));
        byId('ai-key-cancel-button')?.addEventListener('click', () => setAiKeyEditMode(false));
        byId('ai-new-chat-button')?.addEventListener('click', () => {
            aiChats.resetChatForDate(getDateString());
            renderAiSidebar();
        });
        global.document.querySelectorAll?.('[data-ai-provider]')?.forEach(button => {
            button.addEventListener('click', async () => {
                const provider = button.dataset.aiProvider;
                if (!providerConfig(provider)) return;
                aiKeyEditProvider = null;
                aiModelRefreshConfirmProvider = '';
                await saveAiSettings({ aiProvider: provider });
                syncAiSettingsControls({ resetKey: true });
                renderAiSidebar();
            });
        });
        byId('ai-model-picker-button')?.addEventListener('click', event => {
            event.stopPropagation();
            const menu = byId('ai-model-picker-menu');
            setAiModelPickerOpen(menu?.classList.contains('hidden'));
        });
        byId('ai-model-search-input')?.addEventListener('input', renderAiModelOptions);
        byId('ai-model-search-input')?.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                selectAiModel(event.target.value);
            } else if (event.key === 'Escape') {
                setAiModelPickerOpen(false);
            }
        });
        byId('ai-model-refresh-button')?.addEventListener('click', requestAiModelRefreshConfirmation);
        byId('ai-model-refresh-confirm-button')?.addEventListener('click', refreshAiModelsForSelectedProvider);
        byId('ai-model-refresh-cancel-button')?.addEventListener('click', cancelAiModelRefreshConfirmation);
        global.document.addEventListener?.('click', event => {
            if (!event.target?.closest?.('.ai-model-picker')) setAiModelPickerOpen(false);
        });
        byId('ai-key-save-button')?.addEventListener('click', saveAiKey);
        byId('ai-key-delete-button')?.addEventListener('click', deleteAiKey);
        byId('ai-send-button')?.addEventListener('click', () => sendAiMessage());
        global.document.querySelectorAll?.('[data-ai-prompt]')?.forEach(button => {
            button.addEventListener('click', () => sendAiMessage(button.dataset.aiPrompt));
        });
        byId('ai-chat-input')?.addEventListener('keydown', event => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                sendAiMessage();
            }
        });

        const initialTab = global.localStorage?.getItem?.('sidebarActiveTab') === 'ai' ? 'ai' : 'work-times';
        setSidebarTab(initialTab, { persist: false });
    }

    async function initAiSidebar() {
        bindAiSidebar();
        syncAiSettingsControls({ resetKey: true });
        await refreshAiKeyStatus();
        await resolveAiProviderSelection(aiKeyStatus);
        renderAiSidebar();
    }

    function handleAiDateChanged() {
        renderAiSidebar();
    }

    global.DEFAULT_OPENAI_MODEL = DEFAULT_OPENAI_MODEL;
    global.DEFAULT_GOOGLE_MODEL = DEFAULT_GOOGLE_MODEL;
    global.DEFAULT_ANTHROPIC_MODEL = DEFAULT_ANTHROPIC_MODEL;
    global.createAiChatState = createAiChatState;
    global.buildAiDayContext = buildAiDayContext;
    global.buildAiDraftActivitySet = buildAiDraftActivitySet;
    global.classifyAiPromptIntent = classifyAiPromptIntent;
    global.normalizeAiResponse = normalizeAiResponse;
    global.describeAiSuggestion = describeAiSuggestion;
    global.applyAiSuggestion = applyAiSuggestion;
    global.setAiLoadingState = setAiLoadingState;
    global.resolveAiProviderSelection = resolveAiProviderSelection;
    global.refreshAiModelsForSelectedProvider = refreshAiModelsForSelectedProvider;
    global.initAiSidebar = initAiSidebar;
    global.handleAiDateChanged = handleAiDateChanged;
})(window);
