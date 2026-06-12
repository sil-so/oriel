/**
 * Statistics reporting and custom zero-dependency canvas rendering.
 */

// Local dashboard range state
let statsState = {
    activeRange: 'today', // 'today', 'yesterday', 'week', 'last7', 'last30', 'all', 'custom'
    startDate: '', // YYYY-MM-DD
    endDate: ''   // YYYY-MM-DD
};

// Muted chart accents retain distinction without competing with content.
const STATS_COLORS = [
    'oklch(0.70 0.065 255)',
    'oklch(0.72 0.065 205)',
    'oklch(0.72 0.075 155)',
    'oklch(0.76 0.070 88)',
    'oklch(0.70 0.065 310)',
    'oklch(0.68 0.070 28)'
];

function getReportingTimeEntryDurationMs(entry) {
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

/**
 * Initialize Reporting Dashboard events and preset selectors
 */
function initReporting() {
    const presetsContainer = document.getElementById('stats-presets-container');
    const customRangeInputs = document.getElementById('stats-custom-range-inputs');
    const startDateInput = document.getElementById('stats-start-date');
    const endDateInput = document.getElementById('stats-end-date');

    if (!presetsContainer) return;

    // Default dates on custom picker
    const todayStr = getFormattedDate(new Date());
    if (startDateInput) startDateInput.value = todayStr;
    if (endDateInput) endDateInput.value = todayStr;

    // Preset buttons click handler
    presetsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        presetsContainer.querySelectorAll('button').forEach(b => {
            b.classList.remove('range-pill--active');
        });
        btn.classList.add('range-pill--active');

        const range = btn.dataset.range;
        statsState.activeRange = range;

        if (range === 'custom') {
            customRangeInputs.classList.remove('hidden');
            calculatePresetDates('custom');
        } else {
            customRangeInputs.classList.add('hidden');
            calculatePresetDates(range);
        }

        refreshStatsView();
    });

    // Custom date pickers change listeners
    if (startDateInput) {
        startDateInput.addEventListener('change', () => {
            if (statsState.activeRange === 'custom') {
                const [year, month, day] = startDateInput.value.split('-').map(Number);
                statsState.startDate = getFormattedDate(new Date(year, month - 1, day));
                refreshStatsView();
            }
        });
    }

    if (endDateInput) {
        endDateInput.addEventListener('change', () => {
            if (statsState.activeRange === 'custom') {
                const [year, month, day] = endDateInput.value.split('-').map(Number);
                statsState.endDate = getFormattedDate(new Date(year, month - 1, day));
                refreshStatsView();
            }
        });
    }

    // Set default preset dates (Today)
    calculatePresetDates('today');
}

/**
 * Calculates start and end dates based on selected preset
 */
function calculatePresetDates(range) {
    const today = new Date();
    let start = new Date(today);
    let end = new Date(today);

    switch (range) {
        case 'today':
            statsState.startDate = getFormattedDate(today);
            statsState.endDate = getFormattedDate(today);
            break;
        case 'yesterday':
            start.setDate(today.getDate() - 1);
            statsState.startDate = getFormattedDate(start);
            statsState.endDate = getFormattedDate(start);
            break;
        case 'week':
            // Monday of this week
            const day = today.getDay();
            const diff = today.getDate() - day + (day === 0 ? -6 : 1);
            start.setDate(diff);
            statsState.startDate = getFormattedDate(start);
            statsState.endDate = getFormattedDate(end);
            break;
        case 'last7':
            start.setDate(today.getDate() - 6);
            statsState.startDate = getFormattedDate(start);
            statsState.endDate = getFormattedDate(end);
            break;
        case 'last30':
            start.setDate(today.getDate() - 29);
            statsState.startDate = getFormattedDate(start);
            statsState.endDate = getFormattedDate(end);
            break;
        case 'all':
            statsState.startDate = '';
            statsState.endDate = '';
            break;
        case 'custom':
            const startInput = document.getElementById('stats-start-date');
            const endInput = document.getElementById('stats-end-date');
            if (startInput && endInput) {
                statsState.startDate = startInput.value;
                statsState.endDate = endInput.value;
            }
            break;
    }
}

/**
 * Clean domain extractor helper
 */
function extractDomain(url, title) {
    if (url) {
        try {
            return new URL(url).hostname.replace(/^www\./i, '');
        } catch {
            return url.replace(/^www\./i, '');
        }
    }
    // Fallback parsing from title if URL is missing
    if (title) {
        const match = title.match(/https?:\/\/([^/\s]+)/i);
        if (match) return match[1].replace(/^www\./i, '');
    }
    return '';
}

/**
 * Formats duration in ms to clean readable string (e.g. 5h 12m or 45s)
 */
function formatStatsDuration(ms) {
    if (ms < 60000) {
        return `${Math.max(0, Math.round(ms / 1000))}s`;
    }
    const minutes = Math.round(ms / 60000);
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
}

/**
 * Main function to refresh the Statistics dashboard elements
 */
async function refreshStatsView() {
    if (state.currentView !== 'stats') return;

    const isAllTime = statsState.activeRange === 'all';
    const startDate = statsState.startDate;
    const endDate = statsState.endDate;

    if (!isAllTime && (!startDate || !endDate)) return;

    try {
        // Fetch raw data in parallel for speed
        const [activities, timeEntries] = await Promise.all([
            isAllTime ? fetchAllActivities() : fetchRangeActivities(startDate, endDate),
            isAllTime ? fetchAllTimeEntries() : fetchRangeTimeEntries(startDate, endDate)
        ]);

        // 1. Process Activities & Calculate Metrics
        let totalCapturedMs = 0;
        const appsGroup = {};
        const sitesGroup = {};

        for (const act of activities) {
            const duration = (act.end || Date.now()) - act.start;
            if (duration <= 0) continue;

            totalCapturedMs += duration;

            // Group by app
            if (!appsGroup[act.app]) {
                appsGroup[act.app] = 0;
            }
            appsGroup[act.app] += duration;

            // Group by browser domain if app is browser
            const isBrowser = act.app.toLowerCase().includes('chrome') ||
                              act.app.toLowerCase().includes('brave') ||
                              act.app.toLowerCase().includes('safari') ||
                              act.app.toLowerCase().includes('edge') ||
                              act.app.toLowerCase().includes('arc') ||
                              act.app.toLowerCase().includes('firefox');

            const domain = extractDomain(act.url, act.title);
            if (isBrowser && domain) {
                if (!sitesGroup[domain]) {
                    sitesGroup[domain] = 0;
                }
                sitesGroup[domain] += duration;
            }
        }

        // 2. Process Logged Entries & Earnings
        let totalLoggedMs = 0;
        let billableEarnings = 0;
        let billableMs = 0;
        const currencySymbols = {};

        // Find standard currency defaults across projects
        state.projects.forEach(p => {
            if (p.currency) currencySymbols[p.id] = p.currency;
        });

        // Group time entries by project ID to perform prorating calculations
        const entriesByProject = {};
        for (const entry of timeEntries) {
            const duration = getReportingTimeEntryDurationMs(entry);
            if (duration <= 0) continue;
            totalLoggedMs += duration;

            if (!entriesByProject[entry.projectId]) {
                entriesByProject[entry.projectId] = 0;
            }
            entriesByProject[entry.projectId] += duration;
        }

        // Fetch total historical logs for projects (needed for accurate fixed rate prorating)
        const allEntries = isAllTime ? timeEntries : await fetchAllTimeEntries();
        const totalHistoricalHrs = {};
        for (const entry of allEntries) {
            const duration = getReportingTimeEntryDurationMs(entry);
            if (duration > 0) {
                if (!totalHistoricalHrs[entry.projectId]) {
                    totalHistoricalHrs[entry.projectId] = 0;
                }
                totalHistoricalHrs[entry.projectId] += duration / (3600 * 1000);
            }
        }

        let dominantCurrency = '$';

        for (const projId in entriesByProject) {
            const periodMs = entriesByProject[projId];
            const proj = state.projects.find(p => p.id === projId);
            if (!proj) continue;

            const currency = proj.currency || '$';
            dominantCurrency = currency; // Track latest currency for display

            if (proj.billable) {
                billableMs += periodMs;
            }

            const periodHrs = periodMs / (3600 * 1000);

            if (proj.rateType === 'hourly') {
                billableEarnings += periodHrs * (proj.hourlyRate || 0);
            } else if (proj.rateType === 'fixed') {
                // Prorate the fixed flat rate: (hours in period / total hours ever) * fixedRate
                const totalProjHrs = totalHistoricalHrs[projId] || periodHrs;
                if (totalProjHrs > 0) {
                    const ratio = periodHrs / totalProjHrs;
                    billableEarnings += ratio * (proj.fixedRate || 0);
                } else {
                    billableEarnings += proj.fixedRate || 0;
                }
            }
        }

        // 3. Render Metric Cards
        document.getElementById('stat-card-captured').innerText = formatStatsDuration(totalCapturedMs);
        document.getElementById('stat-card-logged').innerText = formatStatsDuration(totalLoggedMs);
        document.getElementById('stat-card-earnings').innerText = `${dominantCurrency}${billableEarnings.toFixed(2)}`;
        
        const billableHrs = (billableMs / (3600 * 1000)).toFixed(1);
        document.getElementById('stat-card-billable-hours').innerText = `${billableHrs}h of billable work`;

        // Conversion efficiency bar (logged / captured)
        const conversionPercent = totalCapturedMs > 0 
            ? Math.min(100, Math.round((totalLoggedMs / totalCapturedMs) * 100)) 
            : 0;
        document.getElementById('stat-card-conversion-percent').innerText = `${conversionPercent}%`;
        document.getElementById('stat-card-conversion-bar').style.width = `${conversionPercent}%`;

        // 4. Draw Top Applications Donut
        const sortedApps = Object.entries(appsGroup)
            .map(([name, duration]) => ({ name, duration }))
            .sort((a, b) => b.duration - a.duration);
        
        drawDonutChart('canvas-programs', 'lbl-programs-count', 'list-programs-legend', sortedApps, totalCapturedMs, 'app');

        // 5. Draw Top Websites Donut
        const totalBrowserMs = Object.values(sitesGroup).reduce((acc, d) => acc + d, 0);
        const sortedSites = Object.entries(sitesGroup)
            .map(([name, duration]) => ({ name, duration }))
            .sort((a, b) => b.duration - a.duration);
        
        drawDonutChart('canvas-websites', 'lbl-websites-count', 'list-websites-legend', sortedSites, totalBrowserMs, 'globe');

    } catch (err) {
        console.error('Error refreshing statistics dashboard:', err);
    }
}

/**
 * Custom 2D Canvas Donut Chart rendering & legends
 */
function drawDonutChart(canvasId, countLabelId, legendId, dataList, totalMs, defaultIcon) {
    const canvas = document.getElementById(canvasId);
    const legendEl = document.getElementById(legendId);
    if (!canvas || !legendEl) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 70;
    const innerRadius = 52;

    // Reset center label count
    const labelEl = document.getElementById(countLabelId);
    if (labelEl) {
        labelEl.innerText = `${dataList.length} items`;
    }

    if (totalMs <= 0 || dataList.length === 0) {
        // Draw placeholder gray ring for empty state
        ctx.beginPath();
        ctx.arc(centerX, centerY, (radius + innerRadius) / 2, 0, 2 * Math.PI);
        ctx.strokeStyle = '#232429';
        ctx.lineWidth = radius - innerRadius;
        ctx.stroke();

        legendEl.innerHTML = `
            <div class="empty-state empty-state--compact w-full">
                No active tracking data captured for this period.
            </div>
        `;
        return;
    }

    // Process top slices, group rest into "Other"
    const maxSlices = 5;
    let slicedData = [];
    if (dataList.length <= maxSlices) {
        slicedData = [...dataList];
    } else {
        slicedData = dataList.slice(0, maxSlices - 1);
        const otherSum = dataList.slice(maxSlices - 1).reduce((acc, d) => acc + d.duration, 0);
        slicedData.push({ name: 'Other Applications', duration: otherSum });
    }

    // Draw slices
    let startAngle = -0.5 * Math.PI; // Start at 12 o'clock

    slicedData.forEach((slice, idx) => {
        const sliceAngle = (slice.duration / totalMs) * 2 * Math.PI;
        const endAngle = startAngle + sliceAngle;
        const color = STATS_COLORS[idx % STATS_COLORS.length];

        ctx.beginPath();
        ctx.arc(centerX, centerY, (radius + innerRadius) / 2, startAngle, endAngle);
        ctx.strokeStyle = color;
        ctx.lineWidth = radius - innerRadius;
        ctx.stroke();

        startAngle = endAngle;
    });

    // Render compact legend rows using the shared surface treatment.
    legendEl.innerHTML = slicedData.map((slice, idx) => {
        const color = STATS_COLORS[idx % STATS_COLORS.length];
        const percent = Math.round((slice.duration / totalMs) * 100);
        const durationStr = formatStatsDuration(slice.duration);
        const iconHTML = getActivityIconHTML(slice.name, defaultIcon === 'globe' ? `http://${slice.name}` : '', slice.name);

        return `
            <div class="report-row flex items-center justify-between text-[11px]">
                <div class="flex items-center gap-2 truncate max-w-[70%]">
                    <span class="project-marker" style="background-color: ${color}"></span>
                    <div class="w-5 h-5 flex items-center justify-center shrink-0 text-gray-400">
                        ${iconHTML}
                    </div>
                    <span class="text-gray-200 font-semibold truncate" title="${slice.name}">${slice.name}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <span class="duration-pill">${durationStr}</span>
                    <span class="text-white font-semibold text-[10px] w-6 text-right">${percent}%</span>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Backend range fetching helper for activities
 */
async function fetchRangeActivities(startDate, endDate) {
    const url = `${API_BASE}/activities?startDate=${startDate}&endDate=${endDate}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch range activities');
    return await res.json();
}

async function fetchAllActivities() {
    const url = `${API_BASE}/activities?date=all`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch all activities');
    return await res.json();
}

/**
 * Backend range fetching helper for time entries
 */
async function fetchRangeTimeEntries(startDate, endDate) {
    const url = `${API_BASE}/time-entries?startDate=${startDate}&endDate=${endDate}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch range time entries');
    return await res.json();
}

/**
 * Fetches all historical entries to support accurate fixed rate calculations
 */
async function fetchAllTimeEntries() {
    const url = `${API_BASE}/time-entries?date=all`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch all time entries');
    return await res.json();
}

// Bind to window for global access
window.initReporting = initReporting;
window.refreshStatsView = refreshStatsView;
window.fetchAllActivities = fetchAllActivities;
