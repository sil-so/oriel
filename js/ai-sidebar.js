(function initializeAiSidebar(global) {
    const AI_PROMPT_MESSAGE_LIMIT = 8;
    const AI_CONTEXT_ITEM_LIMIT = 60;
    const AI_UNLOGGED_RANGE_DETAIL_MIN_MS = 60 * 1000;
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
    let aiInitialized = false;
    let aiIsLoading = false;

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

    function openAiConfiguration() {
        if (typeof global.openSettingsModal === 'function') {
            global.openSettingsModal({ section: 'ai' });
        } else {
            setAiStatus('Open Preferences to configure AI.', 'error');
        }
    }

    function currentAiSelection() {
        return typeof global.getSelectedAiProviderAndModel === 'function'
            ? global.getSelectedAiProviderAndModel()
            : { provider: '', model: '', hasKey: false };
    }

    function hasAnyAiProviderKey() {
        if (typeof global.hasAnyAiProviderKey === 'function') {
            return global.hasAnyAiProviderKey();
        }
        const providers = Array.isArray(global.AI_PROVIDERS) ? global.AI_PROVIDERS : [];
        if (typeof global.aiProviderHasSavedKey === 'function') {
            return providers.some(provider => global.aiProviderHasSavedKey(provider.id));
        }
        return Boolean(currentAiSelection().hasKey);
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

        const renderMessageContent = content => (
            typeof global.renderOrielMarkdown === 'function'
                ? global.renderOrielMarkdown(content)
                : escapeHtml(content)
        );

        messagesEl.innerHTML = chat.messages.map(message => `
            <div class="ai-message ai-message--${message.role}">
                <div class="ai-message-role">${message.role === 'user' ? 'You' : 'Oriel AI'}</div>
                <div class="ai-message-content">${renderMessageContent(message.content)}</div>
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
        renderMessages(dateStr);
        const newChatButton = byId('ai-new-chat-button');
        if (newChatButton) {
            const activeChat = aiChats.getActiveChat(dateStr);
            newChatButton.disabled = !activeChat || activeChat.messages.length === 0;
        }

        byId('ai-unconfigured-status')?.classList.toggle('hidden', hasAnyAiProviderKey());
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

        const selection = currentAiSelection();
        const provider = selection.provider;
        if (!provider) {
            setAiStatus('Choose an AI provider first.', 'error');
            openAiConfiguration();
            return;
        }
        if (!global.OrielData?.isNative) {
            setAiStatus('Ask AI requires Oriel.app so your API key can stay in Keychain.', 'error');
            openAiConfiguration();
            return;
        }
        if (!selection.hasKey) {
            setAiStatus('Save an API key for the selected provider first.', 'error');
            openAiConfiguration();
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
                model: selection.model,
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

    function bindAiSidebar() {
        if (aiInitialized || !global.document) return;
        aiInitialized = true;

        byId('sidebar-tab-work-times')?.addEventListener('click', () => setSidebarTab('work-times'));
        byId('sidebar-tab-ai')?.addEventListener('click', () => setSidebarTab('ai'));
        byId('ai-settings-button')?.addEventListener('click', openAiConfiguration);
        byId('ai-new-chat-button')?.addEventListener('click', () => {
            aiChats.resetChatForDate(getDateString());
            renderAiSidebar();
        });
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
        if (typeof global.initAiSettings === 'function') {
            await global.initAiSettings();
        } else if (typeof global.refreshAiSettingsStatus === 'function') {
            await global.refreshAiSettingsStatus();
        }
        renderAiSidebar();
    }

    function handleAiDateChanged() {
        renderAiSidebar();
    }

    global.createAiChatState = createAiChatState;
    global.buildAiDayContext = buildAiDayContext;
    global.buildAiDraftActivitySet = buildAiDraftActivitySet;
    global.classifyAiPromptIntent = classifyAiPromptIntent;
    global.normalizeAiResponse = normalizeAiResponse;
    global.describeAiSuggestion = describeAiSuggestion;
    global.applyAiSuggestion = applyAiSuggestion;
    global.setAiLoadingState = setAiLoadingState;
    global.renderAiSidebar = renderAiSidebar;
    global.initAiSidebar = initAiSidebar;
    global.handleAiDateChanged = handleAiDateChanged;
})(window);
