import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('multi-select toolbar overlays both timeline panes without entering Work Times', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const overlayStart = html.indexOf('id="timeline-selection-overlay"');
  const toolbarStart = html.indexOf('id="multi-select-bar"');
  const workTimesStart = html.indexOf('Work Summary Statistics');

  assert.ok(overlayStart > -1, 'expected a timeline selection overlay');
  assert.ok(toolbarStart > overlayStart, 'expected the toolbar inside the timeline overlay');
  assert.ok(workTimesStart > toolbarStart, 'expected Work Times after the toolbar overlay');
  assert.match(
    html,
    /id="timeline-selection-overlay" class="[^"]*absolute[^"]*right-\[340px\][^"]*pointer-events-none/
  );
  assert.match(html, /id="multi-select-bar" class="[^"]*pointer-events-auto/);
  assert.match(
    html,
    /id="multi-select-bar" class="[^"]*left-1\/2[^"]*-translate-x-1\/2[^"]*w-max[^"]*gap-8/
  );
  assert.doesNotMatch(html, /id="multi-select-bar" class="[^"]*right-6/);
  assert.match(
    html,
    /id="lbl-selected-count" class="[^"]*inline-block[^"]*w-\[4ch\][^"]*text-right[^"]*tabular-nums/
  );
});

test('timeline controls use one visible scrollbar and compact stable controls', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.match(
    html,
    /class="[^"]*timeline-container--scrollbar-hidden[^"]*" id="memory-aid-container"/
  );
  assert.match(css, /\.timeline-container--scrollbar-hidden\s*\{[^}]*scrollbar-width:\s*none/s);
  assert.match(css, /\.timeline-container--scrollbar-hidden::-webkit-scrollbar\s*\{[^}]*display:\s*none/s);

  assert.match(html, /class="date-picker-with-actions"[^>]*>[\s\S]*id="date-picker-trigger"[\s\S]*class="date-navigation-actions"[^>]*>[\s\S]*id="btn-today"[\s\S]*class="date-step-control"[^>]*>[\s\S]*id="btn-prev-day"[\s\S]*id="btn-next-day"/);
  assert.match(css, /\.date-step-button/);
  assert.match(css, /#date-navigation\s*\{[\s\S]*justify-content:\s*flex-end/s);
  assert.match(css, /\.date-picker-with-actions\s*\{[\s\S]*display:\s*inline-flex/s);
  assert.match(css, /\.date-navigation-actions\s*\{[\s\S]*display:\s*inline-flex/s);
  assert.match(css, /#date-picker-trigger\s*\{[\s\S]*width:\s*auto/s);
  assert.doesNotMatch(css, /#date-picker-trigger\s*\{[\s\S]*width:\s*264px/s);
  assert.match(css, /#date-display\s*\{[\s\S]*overflow:\s*hidden/s);
  assert.match(css, /#date-display\s*\{[\s\S]*text-overflow:\s*ellipsis/s);

  const assignButton = html.match(/<button class="button-primary" id="btn-assign-selected">([\s\S]*?)<\/button>/);
  assert.ok(assignButton);
  assert.doesNotMatch(assignButton[1], /<i /);
  assert.match(html, /id="btn-select-similar"/);
  assert.doesNotMatch(html, /id="modal-bulk-merge"/);
  assert.doesNotMatch(css, /\.bulk-options/);
});

test('timeline exposes Day and Week switch between zoom and workspace tabs', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');

  const zoomStart = html.indexOf('id="zoom-dropdown-container"');
  const modeStart = html.indexOf('id="timeline-mode-switch"');
  const tabsStart = html.indexOf('id="tab-timeline"');
  const workspaceTabs = html.match(/<div class="([^"]*)" role="tablist" aria-label="Workspaces">/);

  assert.ok(zoomStart > -1, 'expected zoom dropdown');
  assert.ok(modeStart > zoomStart, 'expected timeline mode switch after zoom');
  assert.ok(tabsStart > modeStart, 'expected workspace tabs after timeline mode switch');
  assert.match(html, /id="timeline-mode-switch"[^>]*role="radiogroup"[^>]*aria-label="Timeline view"/);
  assert.match(html, /id="timeline-mode-switch" class="[^"]*\bapp-tab-group\b/);
  assert.match(html, /id="timeline-mode-day" class="[^"]*\bapp-tab\b[^"]*\bapp-tab--active\b/);
  assert.match(html, /id="timeline-mode-week" class="[^"]*\bapp-tab\b/);
  assert.ok(workspaceTabs);
  assert.doesNotMatch(workspaceTabs[1], /\bml-2\b/);
  assert.match(html, /id="timeline-mode-day"[^>]*data-timeline-mode="day"[^>]*aria-checked="true"[\s\S]*>\s*Day\s*</);
  assert.match(html, /id="timeline-mode-week"[^>]*data-timeline-mode="week"[^>]*aria-checked="false"[\s\S]*>\s*Week\s*</);
  assert.doesNotMatch(css, /\.timeline-mode-option--active\s*\{/);
  assert.match(html, /id="week-timeline-workspace" class="[^"]*\bhidden\b[^"]*"/);
  assert.match(html, /<script src="\/js\/week-view\.js"><\/script>[\s\S]*<script src="\/js\/main\.js"><\/script>/);
});

test('week timeline keeps sticky headers above scrolling time entries', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');

  const headerRule = css.match(/\.week-time-corner,\s*\.week-day-header\s*\{([\s\S]*?)\}/);
  const cornerRule = css.match(/\.week-time-corner\s*\{([\s\S]*?)\}/);
  const gutterFillRule = css.match(/\.week-timeline-grid::before\s*\{([\s\S]*?)\}/);
  const weekEntryRule = css.match(/\.week-time-entry-block\s*\{([\s\S]*?)\}/);
  const weekCreateCueRule = css.match(/\.week-hover-preview,\s*\.week-drag-box\s*\{([\s\S]*?)\}/);
  const rowLinesRule = css.match(/\.week-row-lines\s*\{([\s\S]*?)\}/);
  const rowLineRule = css.match(/\.week-row-line\s*\{([\s\S]*?)\}/);
  const labelsRule = css.match(/\.week-time-labels\s*\{([\s\S]*?)\}/);
  const labelRule = css.match(/\.week-time-label\s*\{([\s\S]*?)\}/);
  const dayColumnRule = css.match(/\.week-day-column\s*\{([\s\S]*?)\}/);

  assert.ok(headerRule);
  assert.ok(cornerRule);
  assert.ok(gutterFillRule);
  assert.ok(weekEntryRule);
  assert.ok(weekCreateCueRule);
  assert.ok(rowLinesRule);
  assert.ok(rowLineRule);
  assert.ok(labelsRule);
  assert.ok(labelRule);
  assert.ok(dayColumnRule);
  assert.doesNotMatch(css, /\.week-timeline-grid::after\s*\{/);
  assert.doesNotMatch(css, /\.time-entry-block\.week-time-entry-block\s*\{/);
  assert.doesNotMatch(css, /\.week-time-entry-block \.resize-handle-top/);
  assert.doesNotMatch(css, /\.week-time-entry-block \.resize-handle-bottom/);
  assert.match(weekEntryRule[1], /left:\s*12px/);
  assert.match(weekEntryRule[1], /right:\s*12px/);
  assert.doesNotMatch(weekEntryRule[1], /padding/);
  assert.match(weekCreateCueRule[1], /left:\s*0/);
  assert.match(weekCreateCueRule[1], /right:\s*0/);
  assert.match(headerRule[1], /z-index:\s*30/);
  assert.match(headerRule[1], /border-bottom:\s*1px solid var\(--grid-line\)/);
  assert.match(cornerRule[1], /z-index:\s*32/);
  assert.match(cornerRule[1], /border-right:\s*1px solid var\(--grid-line\)/);
  assert.match(gutterFillRule[1], /grid-column:\s*1/);
  assert.match(gutterFillRule[1], /position:\s*sticky/);
  assert.match(gutterFillRule[1], /border-right:\s*1px solid var\(--grid-line\)/);
  assert.doesNotMatch(labelsRule[1], /repeating-linear-gradient/);
  assert.doesNotMatch(dayColumnRule[1], /repeating-linear-gradient/);
  assert.match(rowLinesRule[1], /position:\s*absolute/);
  assert.match(rowLinesRule[1], /inset:\s*0/);
  assert.match(rowLinesRule[1], /z-index:\s*0/);
  assert.doesNotMatch(rowLinesRule[1], /repeating-linear-gradient/);
  assert.match(rowLineRule[1], /box-sizing:\s*border-box/);
  assert.match(rowLineRule[1], /height:\s*var\(--row-height\)/);
  assert.match(rowLineRule[1], /border-top:\s*1px solid var\(--grid-line\)/);
  assert.match(labelRule[1], /box-sizing:\s*border-box/);
  assert.match(labelRule[1], /border-top:\s*1px solid var\(--grid-line\)/);
});

test('week current-time button reuses the Day icon-button treatment', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const weekView = fs.readFileSync('js/week-view.js', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');

  const dayButton = html.match(/id="btn-jump-current"[\s\S]*?<i class="([^"]+)"/);
  const weekButton = weekView.match(/id="btn-week-jump-current"[\s\S]*?class="([^"]+)"[\s\S]*?<i class="([^"]+)"/);

  assert.ok(dayButton);
  assert.ok(weekButton);
  assert.match(weekButton[1], /\bicon-button\b/);
  assert.equal(weekButton[2], dayButton[1]);
  assert.doesNotMatch(css, /\.week-current-time-button:hover/);
});

test('top chrome and zoom dropdown stack above Week sticky headers', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');

  const chromeRule = css.match(/\.app-chrome\s*\{([\s\S]*?)\}/);
  const headerRule = css.match(/\.week-time-corner,\s*\.week-day-header\s*\{([\s\S]*?)\}/);

  assert.ok(chromeRule);
  assert.ok(headerRule);
  assert.match(chromeRule[1], /position:\s*relative/);
  assert.match(chromeRule[1], /z-index:\s*70/);
  assert.match(headerRule[1], /z-index:\s*30/);
  assert.match(html, /class="[^"]*\bz-50\b[^"]*" id="zoom-dropdown-menu"/);
});

test('zoom dropdown rerenders Week mode instead of Day panes', () => {
  const main = fs.readFileSync('js/main.js', 'utf8');

  assert.match(
    main,
    /state\.timelineMode\s*===\s*'week'[\s\S]*renderWeekTimelineGrids\(\)[\s\S]*renderWeekTimeline\(\)/
  );
});

test('Phosphor bold icons use valid family and icon classes', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  assert.doesNotMatch(html, /ph-(?:plus|check)-bold/);
  assert.match(html, /class="ph-bold ph-plus"/);
  assert.match(html, /class="ph-bold ph-check"/);
});

test('tracking exclusion status is hidden while empty', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  assert.match(
    html,
    /id="settings-exclusion-status"[^>]*class="[^"]*\bhidden\b[^"]*"/
  );
  assert.doesNotMatch(
    html,
    /id="settings-exclusion-status"[^>]*class="[^"]*\bmin-h-\[14px\]\b/
  );
});

test('theme-aware scrollbars use app tokens and stable content gutters', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const main = fs.readFileSync('js/main.js', 'utf8');

  assert.match(css, /--scrollbar-size:\s*8px/);
  assert.match(css, /--scrollbar-track:/);
  assert.match(css, /--scrollbar-thumb:/);
  assert.match(css, /--scrollbar-thumb-hover:/);
  assert.match(css, /:root\[data-theme="light"\][\s\S]*--scrollbar-thumb:/);
  assert.match(css, /:root\[data-theme="reference"\][\s\S]*--scrollbar-thumb:/);
  assert.match(css, /scrollbar-color:\s*var\(--scrollbar-thumb\)\s+var\(--scrollbar-track\)/);
  assert.match(css, /\*\s*\{[\s\S]*scrollbar-width:\s*thin/s);
  assert.match(css, /::-webkit-scrollbar-thumb\s*\{[\s\S]*background:\s*var\(--scrollbar-thumb\)/);
  assert.match(css, /\.app-scrollbar-safe\s*\{[\s\S]*scrollbar-gutter:\s*stable/s);
  assert.match(css, /\.timeline-container\s*\{[\s\S]*scrollbar-gutter:\s*stable/s);
  const hasElementClass = (id, className) => {
    const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>|<[^>]+\\bclass="[^"]*"[^>]*\\bid="${id}"[^>]*>`))?.[0] || '';
    return new RegExp(`\\b${className}\\b`).test(tag);
  };

  assert.equal(hasElementClass('settings-modal-body', 'app-scrollbar-safe'), true);
  assert.equal(hasElementClass('settings-ai-model-option-list', 'app-scrollbar-safe'), true);
  assert.match(css, /\.settings-section-panel\s*\{[^}]*padding-bottom:\s*22px/s);
  assert.doesNotMatch(css, /\.settings-section-panel::after\s*\{/);
  assert.doesNotMatch(css, /\.settings-modal-body\s*>\s*:last-child\s*\{/);
  assert.match(main, /custom-select-menu app-scrollbar-safe popover hidden/);

  const unsafeStaticScrollables = [...html.matchAll(/<[^>]+>/g)]
    .map(([tag]) => tag)
    .filter(tag => /\boverflow-y-auto\b/.test(tag))
    .filter(tag => /\bid=/.test(tag))
    .filter(tag => !/\bapp-scrollbar-safe\b/.test(tag))
    .map(tag => `${tag.match(/\bid="([^"]+)"/)?.[1] || 'unknown'}: ${tag}`);
  assert.deepEqual(unsafeStaticScrollables, []);
});

test('timeline scroll panes suppress boundary overscroll bounce', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.match(css, /\.timeline-container\s*\{[\s\S]*overscroll-behavior-y:\s*none/s);
  assert.match(css, /\.timeline-container\s*\{[\s\S]*scroll-behavior:\s*auto/s);
});

test('Activity Stream blocks fit inside timeline row borders', () => {
  const timeline = fs.readFileSync('js/timeline.js', 'utf8');

  assert.match(timeline, /top:\s*calc\(var\(--row-height\) \* \$\{displayStartRow\} \+ 2px\)/);
  assert.match(timeline, /height:\s*calc\(var\(--row-height\) \* \$\{displayRowSpan\} - 3px\)/);
  assert.doesNotMatch(timeline, /var\(--row-height\) \* \$\{displayRowSpan\} - 1px/);
});

test('Time Entries hover and drag hit area includes the time label gutter', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');

  const itemsRule = css.match(/#time-entries-items\s*\{([\s\S]*?)\}/);
  const blockRule = css.match(/#time-entries-items \.time-entry-block\s*\{([\s\S]*?)\}/);
  const createCueRule = css.match(/#time-entries-items \.time-entry-hover-preview,\s*#time-entries-items \.drag-box-visual\s*\{([\s\S]*?)\}/);

  assert.ok(itemsRule);
  assert.ok(blockRule);
  assert.ok(createCueRule);
  assert.match(itemsRule[1], /left:\s*0/);
  assert.match(blockRule[1], /left:\s*64px/);
  assert.match(createCueRule[1], /left:\s*0/);
  assert.match(createCueRule[1], /padding-left:\s*72px/);
});

test('Activity Stream header exposes a compact hide-empty-rows toggle', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');

  const activityHeader = html.slice(
    html.indexOf('<h2>Activity Stream</h2>'),
    html.indexOf('id="btn-jump-current"') + 140
  );

  assert.match(activityHeader, /id="btn-toggle-empty-activity-rows"/);
  assert.match(activityHeader, /aria-pressed="false"/);
  assert.match(activityHeader, /title="Hide Empty Rows"/);
  assert.match(activityHeader, /class="[^"]*\bicon-button\b[^"]*"/);
  assert.match(activityHeader, /class="[^"]*\bph-rows\b/);
  assert.match(css, /\.icon-button\.is-active\s*\{/);
});

test('settings and Work Times panels keep controls aligned and collapsible', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const main = fs.readFileSync('js/main.js', 'utf8');
  const topHeader = html.slice(
    html.indexOf('id="date-navigation"'),
    html.indexOf('<!-- Main Content Workspace -->')
  );
  const sidebarHeader = html.slice(
    html.indexOf('aria-label="Sidebar panels"') - 200,
    html.indexOf('aria-label="Sidebar panels"') + 500
  );
  const timeEntriesHeader = html.slice(
    html.indexOf('<h2>Time Entries</h2>') - 200,
    html.indexOf('<h2>Time Entries</h2>') + 500
  );

  assert.match(html, /id="settings-modal-body" class="[^"]*\bsettings-modal-body\b/);
  assert.match(css, /\.settings-modal-body\s*\{[\s\S]*scrollbar-gutter:\s*auto/s);
  assert.match(css, /\.settings-modal-body\s*\{[\s\S]*padding-right:\s*0/s);
  assert.match(topHeader, /id="btn-settings"/);
  assert.doesNotMatch(timeEntriesHeader, /id="btn-settings"/);

  assert.match(topHeader, /id="btn-toggle-work-times"/);
  assert.ok(topHeader.indexOf('id="btn-settings"') < topHeader.indexOf('id="btn-toggle-work-times"'));
  assert.doesNotMatch(sidebarHeader, /id="btn-toggle-work-times"/);
  assert.match(html, /class="[^"]*\bwork-breakdown-row\b[^"]*"/);
  assert.match(css, /\.work-breakdown-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/s);
  assert.match(css, /\.side-summary\.is-collapsed\s*\{[\s\S]*display:\s*none/s);
  assert.match(css, /#scheduler-workspace\.is-work-times-collapsed #timeline-selection-overlay\s*\{[\s\S]*right:\s*0/s);
  assert.match(main, /function setWorkTimesCollapsed\(collapsed\)/);
});

test('time entry blocks keep pointer drag interactions out of text selection mode', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const timeline = fs.readFileSync('js/timeline.js', 'utf8');

  assert.match(css, /\.time-entry-block\s*\{[\s\S]*user-select:\s*none/s);
  assert.match(css, /\.time-entry-block \*\s*\{[\s\S]*cursor:\s*inherit/s);
  assert.match(timeline, /b\.addEventListener\('mousedown', \(e\) => \{[\s\S]*e\.preventDefault\(\);/);
});
