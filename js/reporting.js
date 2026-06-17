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

        // Fetch total historical logs for projects (needed for accurate fixed rate prorating)
        const allEntries = isAllTime ? timeEntries : await fetchAllTimeEntries();
        const metrics = calculateSelectedPeriodMetrics({
            activities,
            timeEntries,
            projects: state.projects,
            allTimeEntries: allEntries
        });

        // 3. Render Metric Cards
        document.getElementById('stat-card-captured').innerText = formatStatsDuration(metrics.totalCapturedMs);
        document.getElementById('stat-card-logged').innerText = formatStatsDuration(metrics.totalLoggedMs);
        document.getElementById('stat-card-earnings').innerText = `${metrics.dominantCurrency}${metrics.billableEarnings.toFixed(2)}`;
        
        const billableHrs = (metrics.billableMs / (3600 * 1000)).toFixed(1);
        document.getElementById('stat-card-billable-hours').innerText = `${billableHrs}h of billable work`;

        document.getElementById('stat-card-conversion-percent').innerText = `${metrics.conversionPercent}%`;
        document.getElementById('stat-card-conversion-bar').style.width = `${metrics.conversionPercent}%`;

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
            <div class="report-row">
                <div class="report-row-main">
                    <span class="project-marker" style="background-color: ${color}"></span>
                    <div class="report-row-icon">
                        ${iconHTML}
                    </div>
                    <span class="report-row-title" title="${slice.name}">${slice.name}</span>
                </div>
                <div class="report-row-meta">
                    <span class="duration-pill">${durationStr}</span>
                    <span class="report-row-percent">${percent}%</span>
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
