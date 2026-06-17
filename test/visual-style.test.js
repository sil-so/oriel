import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

test('Oriel theme compatibility keeps graphite as the design target', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const designSystem = fs.readFileSync('docs/design-system.md', 'utf8');
  const audit = fs.readFileSync('docs/ui-consistency-audit.md', 'utf8');

  assert.match(html, /\/assets\/vendor\/inter\/400\.css/);
  assert.match(html, /\/assets\/vendor\/inter\/500\.css/);
  assert.match(html, /\/assets\/vendor\/inter\/600\.css/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  assert.doesNotMatch(html, /Outfit/);
  assert.match(css, /--surface-canvas:\s*oklch\(0\.17 0\.006 260\)/);
  assert.match(css, /--surface-panel:\s*oklch\(0\.195 0\.007 260\)/);
  assert.match(css, /--border:\s*oklch\(0\.285 0\.009 260 \/ 0\.58\)/);
  assert.match(css, /--separator:\s*color-mix\(in oklch, var\(--border\) 54%, transparent\)/);
  assert.match(css, /--grid-line:\s*oklch\(0\.235 0\.007 260 \/ 0\.34\)/);
  assert.match(css, /--control-surface:\s*var\(--surface-recessed\)/);
  assert.match(css, /--accent:\s*oklch\(0\.70 0\.065 255\)/);
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /:root\[data-theme="light"\][\s\S]*--surface-canvas:\s*oklch\(0\.915/);
  assert.match(css, /:root\[data-theme="light"\][\s\S]*--grid-line:\s*oklch\(0\.78 0\.009 260 \/ 0\.40\)/);
  assert.match(css, /:root\[data-theme="reference"\]/);
  assert.match(css, /:root\[data-theme="reference"\][\s\S]*--surface-canvas:\s*#212121/);
  assert.match(css, /:root\[data-theme="reference"\][\s\S]*--surface-panel:\s*#262626/);
  assert.match(css, /:root\[data-theme="reference"\][\s\S]*--surface-raised:\s*#383838/);
  assert.match(css, /:root\[data-theme="reference"\][\s\S]*--border:\s*rgb\(255 255 255 \/ 0\.13\)/);
  assert.match(css, /:root\[data-theme="reference"\][\s\S]*--separator:\s*rgb\(255 255 255 \/ 0\.08\)/);
  assert.match(css, /:root\[data-theme="reference"\][\s\S]*--control-surface:\s*#303030/);
  assert.match(css, /:root\[data-theme="reference"\][\s\S]*--modal-surface:\s*#3a3a3a/);
  assert.match(css, /:root\[data-theme="reference"\][\s\S]*--accent:\s*#3b82f6/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(html, /id="settings-theme-select"/);
  assert.match(html, /value="graphite">Dark</);
  assert.match(html, /value="light">Light</);
  assert.match(html, /value="reference">Neutral</);
  assert.match(designSystem, /`graphite` theme is the only design target/);
  assert.match(designSystem, /`light` and `reference` remain selectable compatibility themes/);
  assert.match(audit, /Theme compatibility cleanup keeps the selector while treating `light` and\s+`reference` as compatibility themes/);
  assert.doesNotMatch(html, />Variant Grey</);
  assert.doesNotMatch(html, />Graphite</);
  assert.doesNotMatch(html, />Soft Light</);
  assert.doesNotMatch(html, />Reference Grey</);
});

test('settings remove minimum summary duration control', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  assert.doesNotMatch(html, /id="settings-threshold-select"/);
  assert.doesNotMatch(html, /Min Summary Activity Duration/);
  assert.doesNotMatch(html, /id="settings-threshold-slider"/);
});

test('settings keep context switching note without threshold copy', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.doesNotMatch(html, /id="settings-threshold-display"/);
  assert.match(html, /How Oriel handles short switches/);
  assert.match(html, /Oriel records short app switches so your activity stays accurate and auditable/);
  assert.match(html, /very brief foreground changes are hidden after 60 seconds/);
  assert.match(html, /keeping logged time aligned with recorded activity/);
  assert.doesNotMatch(html, /Setting a 60s threshold/);
  assert.ok(html.indexOf('How Oriel handles short switches') < html.indexOf('Branded Website Icons'));
  assert.match(css, /\.custom-select-button-label\s*\{[\s\S]*white-space:\s*nowrap/s);
  assert.match(css, /\.custom-select-option-label\s*\{[\s\S]*white-space:\s*nowrap/s);
});

test('settings and project details modals rely on header close buttons instead of footer close buttons', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const main = fs.readFileSync('js/main.js', 'utf8');
  const projects = fs.readFileSync('js/projects.js', 'utf8');

  assert.match(html, /id="settings-modal-btn-close"/);
  assert.match(html, /id="proj-details-btn-close"/);
  assert.doesNotMatch(html, /id="settings-modal-btn-save"/);
  assert.doesNotMatch(html, />\s*Done\s*</);
  assert.doesNotMatch(html, /id="proj-details-btn-done"/);
  assert.doesNotMatch(html, />\s*Close Details\s*</);
  assert.doesNotMatch(main, /settingsModalBtnSave/);
  assert.doesNotMatch(main, /settings-modal-btn-save/);
  assert.doesNotMatch(projects, /proj-details-btn-done/);
});

test('scroll-heavy settings and project details modals put bottom spacing on their innermost content', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const scrollContentRule = css.match(/\.modal-scroll-content\s*\{[^}]*\}/)?.[0] || '';

  assert.match(html, /id="settings-modal"[\s\S]*?class="[^"]*\bmodal-panel--scroll\b[^"]*"/);
  assert.match(html, /id="project-details-modal"[\s\S]*?class="[^"]*\bmodal-panel--scroll\b[^"]*"/);
  assert.match(html, /id="settings-modal-body"[^>]*class="[^"]*\bmodal-scroll-content\b[^"]*"/);
  assert.match(html, /id="project-details-modal"[\s\S]*?<div class="[^"]*\bmodal-scroll-content\b[^"]*"/);
  assert.match(css, /\.modal-panel--scroll\s*\{[\s\S]*padding-bottom:\s*0/);
  assert.doesNotMatch(scrollContentRule, /padding-bottom:/);
  assert.doesNotMatch(css, /\.modal-scroll-content\s*>\s*:last-child\s*\{/);
  assert.match(css, /\.settings-section-panel\s*\{[^}]*padding-bottom:\s*22px/s);
  assert.doesNotMatch(css, /\.settings-section-panel::after\s*\{/);
  assert.match(css, /#proj-details-entries-list::after\s*\{[^}]*content:\s*"";[^}]*flex:\s*0 0 22px/s);
  assert.doesNotMatch(html.match(/id="confirm-modal"[\s\S]*?<div class="([^"]*modal-panel[^"]*)"/)?.[1] || '', /\bmodal-panel--scroll\b/);
  assert.doesNotMatch(html.match(/id="time-entry-modal"[\s\S]*?<div class="([^"]*modal-panel[^"]*)"/)?.[1] || '', /\bmodal-panel--scroll\b/);
});

test('modal overlays keep dialogs top aligned below the app header', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const overlayRule = css.match(/\.modal-overlay\s*\{[^}]*\}/)?.[0] || '';

  assert.match(overlayRule, /align-items:\s*flex-start/);
  assert.match(overlayRule, /justify-content:\s*center/);
  assert.match(overlayRule, /padding:\s*calc\(54px \+ 8px\) 16px 16px/);
  assert.match(overlayRule, /overflow-y:\s*auto/);
});

test('modal shells use shared headers, footers, and named size classes', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const modals = html.match(/<!-- MODAL: AI Insights Daily Summary -->[\s\S]*?<!-- Modular Script Imports -->/)?.[0] || '';

  for (const selector of [
    '.modal-size--sm',
    '.modal-size--md',
    '.modal-size--lg',
    '.modal-size--xl',
    '.modal-size--split',
    '.modal-size--confirm',
    '.modal-header',
    '.modal-header-title',
    '.modal-body',
    '.modal-footer'
  ]) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const [id, sizeClass] of [
    ['ai-insights-detail-modal', 'modal-size--lg'],
    ['time-entry-modal', 'modal-size--md'],
    ['project-modal', 'modal-size--sm'],
    ['rules-modal', 'modal-size--xl'],
    ['settings-modal', 'modal-size--lg'],
    ['confirm-modal', 'modal-size--confirm'],
    ['project-details-modal', 'modal-size--lg']
  ]) {
    const panelClass = html.match(new RegExp(`id="${id}"[\\s\\S]*?<div class="([^"]*\\bmodal-panel\\b[^"]*)"`))?.[1] || '';
    assert.match(panelClass, new RegExp(`\\b${sizeClass}\\b`), `expected ${id} to use ${sizeClass}`);
    assert.doesNotMatch(panelClass, /\bw-\[(?:360|380|420|650|750|800)px\]\b/);
  }

  for (const id of [
    'ai-insights-detail-modal',
    'time-entry-modal',
    'project-modal',
    'rules-modal',
    'settings-modal',
    'confirm-modal',
    'project-details-modal'
  ]) {
    const modalMarkup = html.match(new RegExp(`id="${id}"[\\s\\S]*?(?=<!-- MODAL:|<!-- Confirmation modal -->|<!-- Modular Script Imports -->)`))?.[0] || '';
    assert.match(modalMarkup, /\bmodal-header\b/, `expected ${id} to use modal-header`);
  }

  assert.match(modals, /id="time-entry-modal"[\s\S]*?\bmodal-footer\b/);
  assert.match(modals, /id="project-modal"[\s\S]*?\bmodal-footer\b/);
  assert.match(modals, /id="confirm-modal"[\s\S]*?\bmodal-footer\b/);
});

test('confirmation modal keeps compact centered overlay treatment', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const centeredRule = css.match(/\.modal-overlay--centered\s*\{[^}]*\}/)?.[0] || '';
  const confirmOverlay = html.match(/<div class="[^"]*" id="confirm-modal">/)?.[0] || '';
  const confirmMarkup = html.match(/id="confirm-modal"[\s\S]*?<\/div>\s*<\/div>\s*<!-- MODAL: Project Details Viewer -->/)?.[0] || '';

  assert.match(centeredRule, /align-items:\s*center/);
  assert.match(centeredRule, /padding:\s*16px/);
  assert.match(confirmOverlay, /class="[^"]*\bmodal-overlay--centered\b[^"]*"/);
  assert.doesNotMatch(confirmMarkup, /\bz-\[100\]\b/);
});

test('settings tabs reuse the app tab active treatment', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const activeRule = css.match(/\.app-tab--active,\s*\n\.range-pill--active\s*\{[^}]*\}/)?.[0] || '';

  assert.match(html, /<div class="[^"]*\bapp-tab-group\b[^"]*\bsettings-section-tabs\b[^"]*"[^>]*role="tablist" aria-label="Settings sections"/);
  assert.match(html, /class="[^"]*\bapp-tab\b[^"]*\bsettings-section-tab\b[^"]*\bapp-tab--active\b[^"]*\bis-active\b[^"]*" data-settings-section-button="general"/);
  assert.match(html, /class="[^"]*\bapp-tab\b[^"]*\bsettings-section-tab\b[^"]*" data-settings-section-button="capture"/);
  assert.match(activeRule, /background:\s*var\(--surface-raised\)/);
  assert.match(activeRule, /box-shadow:\s*var\(--selected-shadow\)/);
  assert.doesNotMatch(activeRule, /var\(--accent-wash\)/);
  assert.doesNotMatch(css, /\.settings-section-tab\.is-active\s*\{/);
});

test('control primitives expose complete tokenized states', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');

  for (const selector of [
    '.button-primary:active',
    '.button-secondary:active',
    '.button-danger:active',
    '.icon-button:active',
    '.app-tab:active',
    '.range-pill:active',
    '.calendar-day:active'
  ]) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(css, /\.button-primary\.is-loading,\s*\n\.button-primary\[aria-busy="true"\]/);
  assert.match(css, /\.button-secondary\.is-loading,\s*\n\.button-secondary\[aria-busy="true"\]/);
  assert.match(css, /\.button-danger\.is-loading,\s*\n\.button-danger\[aria-busy="true"\]/);
  assert.match(css, /\.field::placeholder,\s*\n\.custom-select::placeholder/);
  assert.match(css, /\.field:disabled,\s*\n\.custom-select:disabled,\s*\n\.custom-select-button:disabled,\s*\n\.custom-select-button\.is-disabled/);
  assert.match(css, /\.field:disabled:hover,\s*\n\.custom-select:disabled:hover,\s*\n\.custom-select-button:disabled:hover,\s*\n\.custom-select-button\.is-disabled:hover/);
});

test('fields and native selects avoid one-off visual utility classes', () => {
  const sources = [
    fs.readFileSync('index.html', 'utf8'),
    fs.readFileSync('js/main.js', 'utf8'),
    fs.readFileSync('js/projects.js', 'utf8')
  ].join('\n');
  const primitiveClassStrings = Array.from(sources.matchAll(/(?:class|className)\s*=\s*(["'`])([^"'`]*)(?:\1)/g))
    .map(match => match[2])
    .filter(className => {
      const tokens = className.split(/\s+/);
      return tokens.includes('field') || tokens.includes('custom-select');
    });

  assert.ok(primitiveClassStrings.length > 0);
  for (const className of primitiveClassStrings) {
    assert.doesNotMatch(className, /\b(?:px-\d|px-\[|text-\[|text-xs|bg-\[|border)\b/);
  }
});

test('app-rendered menu options share primitive option classes', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const main = fs.readFileSync('js/main.js', 'utf8');
  const zoomMenu = html.match(/<div class="[^"]*" id="zoom-dropdown-menu">[\s\S]*?<\/div>\s*<\/div>\s*<div id="timeline-mode-switch"/)?.[0] || '';

  assert.match(css, /\.menu-option,\s*\n\.custom-select-option\s*\{/);
  assert.match(css, /\.menu-option\.is-selected,\s*\n\.custom-select-option\.is-selected\s*\{/);
  assert.match(zoomMenu, /class="menu-option" data-value="1"/);
  assert.match(zoomMenu, /class="menu-option is-selected" data-value="5"/);
  assert.match(zoomMenu, /class="ph ph-check menu-option-check is-visible"/);
  assert.doesNotMatch(zoomMenu, /w-full flex items-center justify-between px-3 py-1\.5 rounded-lg text-left text-xs focus:outline-none/);
  assert.match(main, /emptyOption\.className = 'menu-option custom-select-option'/);
  assert.match(main, /menuOption\.className = `menu-option custom-select-option/);
  assert.match(main, /check\.className = `ph ph-check menu-option-check custom-select-option-check/);
  assert.doesNotMatch(main, /text-blue-400 text-xs shrink-0/);
});

test('app context menu uses shared popover and menu option primitives', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const main = fs.readFileSync('js/main.js', 'utf8');

  assert.match(css, /\.app-context-menu\s*\{/);
  assert.match(css, /\.app-context-menu\s+\.menu-option\s*\{/);
  assert.match(main, /className = 'app-context-menu popover hidden'/);
  assert.match(main, /className = 'menu-option app-context-menu__item'/);
});

test('settings callouts and danger actions use shared modal vocabulary', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const settingsMarkup = html.match(/id="settings-modal"[\s\S]*?<\/div>\s*<\/div>\s*<!-- Confirmation modal -->/)?.[0] || '';

  for (const selector of [
    '.settings-card',
    '.settings-row',
    '.settings-helper',
    '.info-callout',
    '.info-callout__icon',
    '.info-callout__title',
    '.danger-zone',
    '.danger-zone__card'
  ]) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.equal((settingsMarkup.match(/\binfo-callout\b/g) || []).length, 3);
  assert.match(settingsMarkup, /\bdanger-zone\b/);
  assert.match(settingsMarkup, /\bdanger-zone__card\b/);
  assert.doesNotMatch(settingsMarkup, /\b(?:bg|border|text)-(?:blue|red)-/);
});

test('modal and settings chrome avoids old hardcoded utility colors and panel widths', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const modals = html.match(/<!-- MODAL: AI Insights Daily Summary -->[\s\S]*?<!-- Modular Script Imports -->/)?.[0] || '';
  const modalPanelClasses = Array.from(modals.matchAll(/class="([^"]*\bmodal-panel\b[^"]*)"/g))
    .map(match => match[1]);

  assert.ok(modalPanelClasses.length > 0);
  for (const className of modalPanelClasses) {
    assert.doesNotMatch(className, /\bw-\[(?:360|380|420|650|750|800)px\]\b/);
    assert.doesNotMatch(className, /\bmax-w-\[calc\(100vw-32px\)\]|\bmax-h-\[88vh\]/);
  }

  assert.doesNotMatch(modals, /border-\[#2d2f34\]|bg-\[#0d0e10\]|bg-\[#141416\]|bg-blue-|border-blue-|bg-red-|border-red-|focus:border-blue/);
});

test('time entry modal width switching uses named modal size classes', () => {
  const modals = fs.readFileSync('js/modals.js', 'utf8');

  assert.match(modals, /modal-size--split/);
  assert.match(modals, /modal-size--md/);
  assert.doesNotMatch(modals, /w-\[420px\]|w-\[800px\]/);
});

test('modal field helpers preserve hidden state', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const hiddenFieldRule = css.match(/\.modal-field-group\.hidden\s*\{[^}]*\}/)?.[0] || '';

  assert.match(hiddenFieldRule, /display:\s*none/);
});

test('header and modal icon controls use the icon-button primitive', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  for (const id of [
    'date-picker-prev-month',
    'date-picker-next-month',
    'popup-close-btn',
    'ai-insights-detail-refresh',
    'ai-insights-detail-close',
    'rules-modal-btn-close',
    'settings-modal-btn-close',
    'proj-details-btn-close'
  ]) {
    const button = html.match(new RegExp(`<button(?=[^>]*id="${id}")[^>]*>`))?.[0] || '';
    assert.ok(button, `expected ${id} button`);
    assert.match(button, /class="[^"]*\bicon-button\b[^"]*"/);
    assert.doesNotMatch(button, /text-gray-400|hover:text-white|focus:outline-none|focus:ring/);
  }
});

test('empty states use shared density variants instead of ad hoc utilities', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const sources = [
    fs.readFileSync('index.html', 'utf8'),
    fs.readFileSync('js/main.js', 'utf8'),
    fs.readFileSync('js/projects.js', 'utf8'),
    fs.readFileSync('js/reporting.js', 'utf8'),
    fs.readFileSync('js/timeline.js', 'utf8')
  ].join('\n');

  assert.match(css, /\.empty-state--compact\s*\{/);
  assert.match(css, /\.empty-state--spacious\s*\{/);
  assert.doesNotMatch(sources, /empty-state[^"'`]*(?:\bp-\d|\bpy-\d|\btext-\[|\btext-xs|\btext-gray-)/);
});

test('AI Insights header omits archive controls and workspace separator', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const insightsHeader = html.match(/id="ai-insights-workspace"[\s\S]*?id="ai-insights-card-grid"/)?.[0] || '';

  assert.doesNotMatch(insightsHeader, /ai-insights-summary-date-trigger|ai-insights-range-filter|ai-insights-status-filter/);
  assert.doesNotMatch(insightsHeader, /Jump to date|Range|Status/);
  assert.doesNotMatch(insightsHeader, /justify-between[^"]*border-b/);
  assert.match(insightsHeader, /id="ai-insights-year-tabs"[^>]*class="[^"]*\bapp-tab-group\b[^"]*\bai-insights-year-tabs\b/);
  assert.match(insightsHeader, /role="tablist"[^>]*aria-label="AI Insights year"/);
});

test('AI Insights detail modal puts bottom spacing inside the scroll content', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const modalPanelClass = html.match(/id="ai-insights-detail-modal"[\s\S]*?<div class="([^"]*\bmodal-panel\b[^"]*)"/)?.[1] || '';

  assert.match(modalPanelClass, /\bmodal-panel--scroll\b/);
  assert.match(html, /id="ai-insights-detail-refresh"[\s\S]*?id="ai-insights-detail-close"/);
  assert.match(html, /<button(?=[^>]*id="ai-insights-detail-refresh")(?=[^>]*class="[^"]*\bicon-button\b[^"]*\bhidden\b)[^>]*>/);
  assert.match(html, /id="ai-insights-detail-refresh"[\s\S]*?ph ph-arrows-clockwise/);
  assert.match(html, /id="ai-insights-detail-body"[^>]*class="[^"]*\bmodal-scroll-content\b[^"]*"/);
  assert.match(css, /\.ai-insights-detail-body::after\s*\{[^}]*content:\s*"";[^}]*flex:\s*0 0 6px/s);
  assert.doesNotMatch(css.match(/\.ai-insights-detail-body\s*\{[^}]*\}/)?.[0] || '', /padding-bottom:/);
});

test('AI Insights generated card preview fade shows five visible content lines', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const cardRule = css.match(/\.ai-insights-card\s*\{[^}]*\}/)?.[0] || '';
  const previewRule = css.match(/\.ai-insights-card-preview--fade\s*\{[^}]*\}/)?.[0] || '';
  const fadeRule = css.match(/\.ai-insights-card-preview--fade::after\s*\{[^}]*\}/)?.[0] || '';
  const legacySummaryFadeRule = css.match(/\.ai-insights-card-summary--fade\s*\{[^}]*\}/)?.[0] || '';
  const previewBaseRule = css.match(/\.ai-insights-card-preview\s*\{[^}]*\}/)?.[0] || '';
  const previewLineRules = css.match(/\.ai-insights-card-preview \.ai-insights-card-summary,[\s\S]*?line-height:\s*var\(--ai-insights-preview-line-height\);[\s\S]*?\}/)?.[0] || '';

  assert.match(cardRule, /--ai-insights-card-fade-surface:\s*var\(--surface-panel\)/);
  assert.match(previewBaseRule, /--ai-insights-preview-line-height:\s*18px/);
  assert.match(previewBaseRule, /gap:\s*0/);
  assert.match(previewRule, /height:\s*calc\(var\(--ai-insights-preview-line-height\) \* 5\)/);
  assert.match(previewRule, /max-height:\s*calc\(var\(--ai-insights-preview-line-height\) \* 5\)/);
  assert.match(fadeRule, /top:\s*calc\(var\(--ai-insights-preview-line-height\) \* 1\)/);
  assert.match(fadeRule, /height:\s*calc\(var\(--ai-insights-preview-line-height\) \* 4\)/);
  assert.match(fadeRule, /var\(--ai-insights-card-fade-surface\)/);
  assert.doesNotMatch(fadeRule, /var\(--surface-panel\)/);
  assert.match(previewLineRules, /ai-insights-tldr-list li/);
  assert.equal(legacySummaryFadeRule, '');
});

test('AI Insights card TLDR bullets are single-line while detail bullets wrap', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const cardRule = css.match(/\.ai-insights-card \.ai-insights-tldr-list li\s*\{[^}]*\}/)?.[0] || '';
  const cardListRule = css.match(/\.ai-insights-card \.ai-insights-tldr-list\s*\{[^}]*\}/)?.[0] || '';
  const detailRule = css.match(/\.ai-insights-detail-tldr \.ai-insights-tldr-list li\s*\{[^}]*\}/)?.[0] || '';

  assert.match(cardListRule, /list-style-position:\s*inside/);
  assert.match(cardRule, /white-space:\s*nowrap/);
  assert.match(cardRule, /overflow:\s*hidden/);
  assert.match(cardRule, /text-overflow:\s*ellipsis/);
  assert.match(detailRule, /white-space:\s*normal/);
  assert.match(detailRule, /overflow:\s*visible/);
});

test('AI Insights does not render structured metrics as a visible visual component', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const script = fs.readFileSync('js/main.js', 'utf8');

  assert.doesNotMatch(css, /ai-insights-metrics/);
  assert.doesNotMatch(script, /renderAiInsightsMetrics/);
  assert.doesNotMatch(script, /ai-insights-card-metrics/);
  assert.doesNotMatch(script, /ai-insights-detail-metrics/);
});

test('settings tooltip is not nested inside the hideable scheduler workspace', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const schedulerIndex = html.indexOf('id="scheduler-workspace"');
  const tooltipIndex = html.indexOf('id="settings-floating-tooltip"');

  assert.ok(tooltipIndex !== -1);
  assert.ok(schedulerIndex !== -1);
  assert.ok(tooltipIndex < schedulerIndex);
});

test('header sidebar toggle uses real hidden-state styling', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.match(css, /#btn-toggle-work-times\[hidden\][\s\S]*display:\s*none\s*!important/);
});

test('Statistics workspace header does not draw a separator line', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const statsHeader = html.match(/id="stats-workspace"[\s\S]*?id="stats-presets-container"/)?.[0] || '';

  assert.doesNotMatch(statsHeader, /justify-between[^"]*border-b/);
});

test('native app chrome leaves only a compact gap after macOS traffic lights', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.match(css, /\.is-native-shell \.app-chrome\s*\{\s*padding-left:\s*100px;/);
});

test('header Oriel mark uses the same theme text color as pane titles', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.match(css, /\.pane-header h2,\s*\n\.pane-header-title\s*\{[\s\S]*color:\s*var\(--text-primary\)/);
  assert.match(css, /\.brand-mark\s*\{[\s\S]*background:\s*var\(--text-primary\)/);
  assert.match(css, /\.brand-mark\s*\{[\s\S]*mask:\s*url\(['"]?\/assets\/brand\/oriel-logo\.svg['"]?\) center \/ contain no-repeat/);
});

test('Oriel Dark removes decorative glass, glow, and side-stripe treatments', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const timeline = fs.readFileSync('js/timeline.js', 'utf8');
  const styles = `${html}\n${css}\n${timeline}`;

  assert.doesNotMatch(styles, /glow-effect/);
  assert.doesNotMatch(styles, /backdrop-blur/);
  assert.doesNotMatch(css, /border-left:\s*[2-9][^;]*solid/);
  assert.doesNotMatch(css, /\.time-entry-block--assigned\s*\{[\s\S]*border-left:\s*[2-9][^;]*dashed/);
  assert.doesNotMatch(timeline, /background-color:\s*\$\{project\.color\}15;\s*border-color:\s*\$\{project\.color\}/);
  assert.match(timeline, /project-marker/);
});

test('Quiet Chrome keeps dense timeline states calm but explicit', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.match(css, /\.workspace-panel\s*\{[\s\S]*border-color:\s*var\(--separator\)/);
  assert.match(css, /\.activity-block\s*\{[\s\S]*border:\s*1px solid color-mix\(in oklch, var\(--border\) 34%, transparent\)/);
  assert.match(css, /\.activity-block\s*\{[\s\S]*box-sizing:\s*border-box/);
  assert.match(css, /\.activity-block\.selected\s*\{[\s\S]*background:\s*var\(--selected-surface\)/);
  assert.match(css, /\.time-entry-block\s*\{[\s\S]*background:\s*color-mix\(in oklch, var\(--accent-wash\) 48%, var\(--surface-raised\) 52%\)/);
  assert.doesNotMatch(css, /time-entry-block--partial-assignment/);
  assert.match(css, /\.side-summary \.surface-panel\s*\{[\s\S]*border-color:\s*var\(--separator-soft\)/);
});

test('timeline and sidebar chrome use semantic design-system classes', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const timelineStart = html.indexOf('id="scheduler-workspace"');
  const projectsStart = html.indexOf('id="projects-workspace"');
  const timelineMarkup = html.slice(timelineStart, projectsStart);

  for (const className of [
    'activity-details-popup',
    'activity-details-popup__header',
    'activity-details-popup__meta-grid',
    'timeline-selection-bar',
    'timeline-selection-bar__summary',
    'side-summary-content',
    'work-times-stats-stack',
    'work-times-stat-card',
    'project-summary-panel',
    'project-summary-panel__header',
    'project-summary-panel__title'
  ]) {
    assert.match(timelineMarkup, new RegExp(`\\b${className}\\b`), `expected timeline markup to use ${className}`);
    assert.match(css, new RegExp(`\\.${className}\\b`), `expected CSS contract for ${className}`);
  }

  assert.doesNotMatch(timelineMarkup, /sidebar-stat-card|Recorded Active Time|Project Logged Time/);
  assert.doesNotMatch(timelineMarkup, /id="unlogged-work-review"|Unlogged Work/);
  assert.ok(
    timelineMarkup.indexOf('id="work-times-stats"') < timelineMarkup.indexOf('project-summary-panel'),
    'expected Work Times metric stack before Logged Projects'
  );
  assert.match(timelineMarkup, /class="metric-label project-summary-panel__title">Logged Projects<\/h3>/);
  assert.doesNotMatch(timelineMarkup, /stat-project-total|project-summary-total|Total Project Time/);
  assert.doesNotMatch(timelineMarkup, /border-\[#2d2f34\]|bg-\[#0d0e10\]|text-\[(?:10|11|12)px\]|text-gray-|text-white|bg-emerald-|text-emerald-/);
  assert.match(css, /\.activity-details-popup__details\.hidden\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /\.activity-details-popup__field\.hidden,\s*\.activity-details-popup__meta-item\.hidden\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /\.sidebar-panel--work-times\.hidden\s*\{[\s\S]*?display:\s*none/);
});

test('activity details popup reserves a fixed square close button column', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const headerRule = css.match(/\.activity-details-popup__header\s*\{[^}]*\}/)?.[0] || '';
  const closeRule = css.match(/#popup-close-btn\s*\{[^}]*\}/)?.[0] || '';

  assert.match(headerRule, /display:\s*grid/);
  assert.match(headerRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+30px/);
  assert.match(closeRule, /width:\s*30px/);
  assert.match(closeRule, /height:\s*30px/);
  assert.match(closeRule, /min-height:\s*30px/);
});

test('timeline-rendered rows use semantic classes instead of one-off utilities', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const timeline = fs.readFileSync('js/timeline.js', 'utf8');
  const activityTemplate = timeline.match(/function createActivityBlockHTML[\s\S]*?function attachMemoryAidInteractions/)?.[0] || '';
  const timeEntryTemplate = timeline.match(/function renderLoggedTimeEntries[\s\S]*?function updateTimeEntryHoverPreview/)?.[0] || '';
  const popupTemplate = timeline.match(/function showActivityDetailsPopup[\s\S]*?function dismissActivityDetailsPopup/)?.[0] || '';

  for (const className of [
    'activity-block__checkbox',
    'activity-block__icon',
    'activity-block__content',
    'activity-block__title',
    'activity-block__subtitle',
    'activity-block__actions',
    'activity-block__secondary-icons',
    'activity-quick-add',
    'time-entry-project-summary',
    'time-entry-project',
    'time-entry-description',
    'popup-activity-row',
    'popup-activity-child-row',
    'popup-activity-select',
    'popup-activity-expand',
    'popup-activity-external-link',
    'popup-activity-secondary',
    'popup-activity-duration'
  ]) {
    assert.match(timeline, new RegExp(`\\b${className}\\b`), `expected timeline templates to use ${className}`);
    assert.match(css, new RegExp(`\\.${className}\\b`), `expected CSS contract for ${className}`);
  }

  assert.doesNotMatch(activityTemplate, /text-white|text-gray-|text-\[(?:10|11|12)px\]|w-5 h-5|w-7 h-7|bg-transparent/);
  assert.doesNotMatch(timeEntryTemplate, /text-white|text-white\/80|text-\[(?:10|11|12)px\]|font-bold mt-1|uppercase tracking-wider/);
  assert.doesNotMatch(popupTemplate, /border-\[#2d2f34\]|text-blue-|text-gray-|text-\[(?:10|11|13)px\]|w-[4567] h-[4567]|bg-transparent/);
});

test('activity stream checkboxes use the shared circular hover affordance', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const checkboxRule = css.match(/\.activity-checkbox\s*\{[^}]*\}/)?.[0] || '';
  const blockCheckboxRule = css.match(/\.activity-block__checkbox\s*\{[^}]*\}/)?.[0] || '';
  const blockControlsRule = css.match(/\.activity-block \.activity-checkbox,\s*\.activity-block \.activity-quick-add\s*\{[^}]*\}/)?.[0] || '';
  const hoverRule = css.match(/\.activity-checkbox:hover,\s*\.activity-checkbox:focus-visible\s*\{[^}]*\}/)?.[0] || '';
  const timelineHoverRule = css.match(/\.activity-block \.activity-checkbox:hover,\s*\.activity-block \.activity-checkbox:focus-visible\s*\{[^}]*\}/)?.[0] || '';

  assert.match(checkboxRule, /width:\s*28px/);
  assert.match(checkboxRule, /height:\s*28px/);
  assert.match(checkboxRule, /border-radius:\s*var\(--radius-pill\)/);
  assert.match(blockCheckboxRule, /margin-left:\s*-6px/);
  assert.match(blockCheckboxRule, /margin-right:\s*2px/);
  assert.match(blockControlsRule, /background\s+150ms\s+var\(--ease-out\)/);
  assert.match(hoverRule, /background:\s*var\(--control-surface-hover\)/);
  assert.match(hoverRule, /outline:\s*none/);
  assert.match(css, /--activity-checkbox-hover-surface:/);
  assert.match(css, /--activity-checkbox-hover-surface:\s*color-mix\(in oklch,\s*var\(--surface-hover\)\s+86\.6667%,\s*black\s+13\.3333%\)/);
  assert.match(css, /:root\[data-theme="light"\][\s\S]*--activity-checkbox-hover-surface:\s*color-mix\(in oklch,\s*var\(--surface-hover\)\s+96\.9136%,\s*black\s+3\.0864%\)/);
  assert.match(css, /:root\[data-theme="reference"\][\s\S]*--activity-checkbox-hover-surface:\s*color-mix\(in srgb,\s*var\(--surface-hover\)\s+89\.6552%,\s*black\s+10\.3448%\)/);
  assert.doesNotMatch(css, /--activity-checkbox-hover-surface:[^;]*surface-recessed/);
  assert.match(timelineHoverRule, /background:\s*var\(--activity-checkbox-hover-surface\)/);
});

test('projects statistics and AI insights use semantic design-system classes', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const projects = fs.readFileSync('js/projects.js', 'utf8');
  const reporting = fs.readFileSync('js/reporting.js', 'utf8');
  const main = fs.readFileSync('js/main.js', 'utf8');
  const sources = `${html}\n${projects}\n${reporting}\n${main}`;

  for (const className of [
    'workspace-heading',
    'workspace-title',
    'workspace-helper',
    'metric-label',
    'metric-helper',
    'card-title',
    'chart-card-header',
    'chart-center-label',
    'chart-center-value',
    'progress-track',
    'progress-fill',
    'project-breakdown-card',
    'project-detail-stat',
    'project-task-row',
    'project-entry-row',
    'report-row-title',
    'report-row-percent',
    'ai-insights-card-metadata'
  ]) {
    assert.match(sources, new RegExp(`\\b${className}\\b`), `expected SIL-32 sources to use ${className}`);
    assert.match(css, new RegExp(`\\.${className}\\b`), `expected CSS contract for ${className}`);
  }

  const sil32Markup = [
    html.match(/id="projects-workspace"[\s\S]*?<!-- Reporting workspace -->/)?.[0] || '',
    html.match(/id="stats-workspace"[\s\S]*?<!-- AI Insights workspace -->/)?.[0] || '',
    html.match(/id="ai-insights-workspace"[\s\S]*?<!-- MODAL: AI Insights Daily Summary -->/)?.[0] || '',
    html.match(/id="project-details-modal"[\s\S]*?<!-- Modular Script Imports -->/)?.[0] || ''
  ].join('\n');

  assert.doesNotMatch(sil32Markup, /text-xl|text-white|text-gray-|text-\[(?:9|10|11|12|13|14)px\]|border-\[#2d2f34\]|bg-gray-|text-blue-|text-emerald-|rounded-full h-2/);

  for (const source of [projects, reporting]) {
    assert.doesNotMatch(source, /text-\[(?:9|10|11|12|13)px\]|text-gray-|text-white|text-blue-|text-emerald-|bg-\[#0d0e10\]|border-\[#2d2f34\]/);
  }
});

test('project and chart identity colors remain explicit data exceptions', () => {
  const projects = fs.readFileSync('js/projects.js', 'utf8');
  const reporting = fs.readFileSync('js/reporting.js', 'utf8');

  assert.match(projects, /style="background-color: \$\{proj\.color\}/);
  assert.match(projects, /style="background-color: \$\{proj\.color\}; width: \$\{pct\}%"/);
  assert.match(reporting, /const STATS_COLORS = \[/);
  assert.match(reporting, /style="background-color: \$\{color\}"/);
});

test('modal controls use theme surfaces instead of hardcoded near-black fills', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.match(css, /\.field,\s*\n\.custom-select\s*\{[\s\S]*background:\s*var\(--control-surface\)/);
  assert.match(css, /\.custom-select-button\s*\{[\s\S]*background:\s*var\(--control-surface\)/);
  assert.match(css, /\.modal-panel\s*\{[\s\S]*background:\s*var\(--modal-surface\)/);
  assert.match(css, /\.app-shell \.bg-\\\[\\#0d0e10\\\],[\s\S]*background-color:\s*var\(--control-surface\)/);
  assert.match(css, /\.app-shell \.border-\\\[\\#2d2f34\\\]\s*\{[\s\S]*border-color:\s*var\(--separator\)/);
});

test('visible checkbox controls use the Oriel toggle treatment', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.match(css, /\.oriel-toggle\s*\{/);
  assert.match(css, /\.oriel-toggle-input:checked \+ \.oriel-toggle-track\s*\{/);

  for (const id of ['project-billable-toggle', 'settings-logo-dev-icons']) {
    assert.match(
      html,
      new RegExp(`<label class="[^"]*\\boriel-toggle\\b[^"]*"[^>]*>[\\s\\S]*?id="${id}"[\\s\\S]*?<span class="oriel-toggle-track`)
    );
  }

  assert.doesNotMatch(html, /id="settings-logo-dev-icons" class="shrink-0 mt-1"/);
});

test('settings expose editable activity title cleanup rules with regex guidance', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  assert.match(html, /Activity Title Cleanup/);
  assert.match(html, /id="settings-title-cleanup-list"/);
  assert.match(html, /id="settings-title-cleanup-add"/);
  assert.match(html, /id="settings-title-cleanup-reset-defaults"/);
  assert.match(html, /id="settings-title-cleanup-pattern"/);
  assert.match(html, /MDN JavaScript regular expressions guide/);
  assert.match(html, /https:\/\/developer\.mozilla\.org\/en-US\/docs\/Web\/JavaScript\/Guide\/Regular_expressions/);
  assert.ok(
    html.indexOf('Tracking Exclusions') < html.indexOf('Activity Title Cleanup'),
    'expected Activity Title Cleanup to render below Tracking Exclusions'
  );
});

test('project guidance requires Linear issue hygiene for implementation work', () => {
  const agents = fs.readFileSync('AGENTS.md', 'utf8');

  assert.match(agents, /Always create or use a Linear issue for new and existing implementation\s+work/);
  assert.match(agents, /keep that issue updated as the work moves through active\s+development, review, completion, or blockage/);
});

test('time entry modal removes AI-coded snapshot icon and uses uniform section spacing', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const modalMarkup = html.match(/id="time-entry-modal"[\s\S]*?<!-- MODAL: Create Project -->/)?.[0] || '';
  const projectGridClass = modalMarkup.match(/id="modal-project-grid"[^>]*class="([^"]*)"/)?.[1] || '';

  assert.doesNotMatch(modalMarkup, /ph ph-sparkle[\s\S]{0,160}Recorded Activity Snapshot/);
  assert.doesNotMatch(modalMarkup, /Recorded Activity Snapshot[\s\S]{0,160}ph ph-sparkle/);
  assert.doesNotMatch(projectGridClass, /\bmt-1\b/);
  assert.match(css, /\.time-entry-form\s*\{[\s\S]*gap:\s*16px/);
  assert.match(css, /\.modal-field-group\s*\{[\s\S]*gap:\s*6px/);
});

test('activity title cleanup saved rules use a quiet editable list layout', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const main = fs.readFileSync('js/main.js', 'utf8');
  const cleanupRenderer = main.match(/function renderTitleCleanupRules\(\)[\s\S]*?setTitleCleanupStatus\(''\);/)?.[0] || '';

  assert.match(html, /<div(?=[^>]*id="settings-title-cleanup-list")(?=[^>]*class="[^"]*\btitle-cleanup-list\b)[^>]*>/);
  assert.match(css, /\.title-cleanup-list\b/);
  for (const className of [
    'title-cleanup-rule',
    'title-cleanup-rule__header',
    'title-cleanup-rule__summary',
    'title-cleanup-rule__chips',
    'title-cleanup-rule__editor',
    'title-cleanup-rule__actions',
    'title-cleanup-rule__field',
    'title-cleanup-rule__label'
  ]) {
    assert.match(css, new RegExp(`\\.${className}\\b`), `expected CSS contract for ${className}`);
    assert.match(cleanupRenderer, new RegExp(`\\b${className}\\b`), `expected rendered rule markup to use ${className}`);
  }
  assert.match(cleanupRenderer, /removeButton\.className = 'icon-button icon-button--danger/);
  assert.doesNotMatch(cleanupRenderer, /surface-panel flex flex-col gap-2 px-3 py-2/);
  assert.doesNotMatch(cleanupRenderer, /text-gray-500 hover:text-red-400/);
});

test('similar activity selection uses a modal with explicit match modes', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const main = fs.readFileSync('js/main.js', 'utf8');
  const timeline = fs.readFileSync('js/timeline.js', 'utf8');

  assert.match(html, /id="similar-modal"/);
  assert.match(html, /id="similar-mode-host"/);
  assert.match(html, /id="similar-mode-url"/);
  assert.match(html, /id="similar-mode-app"/);
  assert.match(html, /id="similar-mode-app-title"/);
  assert.match(css, /\.similar-options\b/);
  assert.match(css, /\.similar-option\b/);
  assert.match(css, /\.similar-option\.is-disabled\b/);
  assert.match(main, /openSimilarSelectionModal\(\)/);
  assert.match(timeline, /function openSimilarSelectionModal\(/);
  assert.match(timeline, /function isBrowserLikeActivity\(/);
  assert.match(timeline, /function updateSimilarModeAvailability\(/);
  assert.match(timeline, /function getActivitySimilarityKeyForMode\(/);
});

test('AI Insights uses weekly four-column grids instead of the shared workspace grid', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const projectsMarkup = html.match(/id="projects-workspace"[\s\S]*?<!-- Reporting workspace -->/)?.[0] || '';
  const aiMarkup = html.match(/id="ai-insights-workspace"[\s\S]*?<!-- MODAL: AI Insights Daily Summary -->/)?.[0] || '';
  const sharedGridRule = css.match(/\.workspace-card-grid\s*\{[^}]*\}/)?.[0] || '';
  const projectsGridRule = css.match(/#projects-page-grid\s*\{[^}]*\}/)?.[0] || '';
  const aiGridRule = css.match(/\.ai-insights-card-grid\s*\{[^}]*\}/)?.[0] || '';
  const cardRule = css.match(/\.ai-insights-card\s*\{[^}]*\}/)?.[0] || '';
  const actionsRule = css.match(/\.ai-insights-card-actions\s*\{[^}]*\}/)?.[0] || '';
  const openButtonRule = css.match(/\.ai-insights-card-open\s*\{[^}]*\}/)?.[0] || '';
  const weekGridRule = css.match(/\.ai-insights-week-grid\s*\{[^}]*\}/)?.[0] || '';
  const placeholderRule = css.match(/\.ai-insights-card--placeholder\s*\{[^}]*\}/)?.[0] || '';
  const weeklyCardRule = css.match(/\.ai-insights-card--weekly\s*\{[^}]*\}/)?.[0] || '';

  assert.match(projectsMarkup, /class="[^"]*\bworkspace-card-grid\b[^"]*\bprojects-card-grid\b[^"]*"[^>]*id="projects-page-grid"/);
  assert.match(aiMarkup, /class="[^"]*\bai-insights-card-grid\b[^"]*"[^>]*id="ai-insights-card-grid"/);
  assert.doesNotMatch(aiMarkup, /class="[^"]*\bworkspace-card-grid\b[^"]*\bai-insights-card-grid\b/);
  assert.match(sharedGridRule, /display:\s*grid/);
  assert.match(sharedGridRule, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(sharedGridRule, /gap:\s*24px/);
  assert.match(sharedGridRule, /min-width:\s*0/);
  assert.match(aiGridRule, /display:\s*flex/);
  assert.match(cardRule, /min-height:\s*var\(--ai-insights-card-min-height\)/);
  assert.match(cardRule, /--ai-insights-card-min-height:\s*180px/);
  assert.match(actionsRule, /margin-top:\s*auto/);
  assert.match(openButtonRule, /background:\s*var\(--surface-raised\)/);
  assert.match(openButtonRule, /border-color:\s*var\(--border\)/);
  assert.match(weekGridRule, /display:\s*grid/);
  assert.match(weekGridRule, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(weekGridRule, /grid-auto-rows:\s*minmax\(var\(--ai-insights-card-min-height\),\s*1fr\)/);
  assert.match(placeholderRule, /var\(--surface-panel\)|var\(--surface-recessed\)|var\(--separator/);
  assert.match(weeklyCardRule, /var\(--surface-raised\)|var\(--surface-recessed\)|var\(--separator/);
  assert.doesNotMatch(css, /\.ai-insights-status-pill\b/);
  assert.doesNotMatch(html, /grid-cols-1\s+md:grid-cols-2\s+lg:grid-cols-3/);
  assert.doesNotMatch(projectsGridRule, /gap:/);
  assert.doesNotMatch(projectsGridRule, /grid-template-columns:/);
  assert.doesNotMatch(aiGridRule, /grid-template-columns:/);
  assert.doesNotMatch(aiGridRule, /auto-fit/);
});

test('project cards avoid full-card hover and click affordances', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const projects = fs.readFileSync('js/projects.js', 'utf8');
  const projectCardTag = projects.match(/<div class="project-card[^>]*>/)?.[0] || '';

  assert.doesNotMatch(css, /\.project-card:hover\b/);
  assert.doesNotMatch(projectCardTag, /\bcursor-pointer\b/);
  assert.doesNotMatch(projectCardTag, /onclick=/);
  assert.match(projects, /<button class="button-secondary"[\s\S]*onclick="openProjectDetails\('\$\{proj\.id\}'\)"/);
});

test('AI and data settings sections share heading treatment without extra danger divider', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const aiSettingsMarkup = html.match(/data-settings-section-panel="ai"[\s\S]*?data-settings-section-panel="data"/)?.[0] || '';
  const dangerZoneRule = css.match(/\.danger-zone\s*\{[^}]*\}/)?.[0] || '';

  assert.match(aiSettingsMarkup, /class="settings-card-title">Provider &amp; Key<\/span>\s*<span class="settings-helper">Choose a provider key/);
  assert.match(aiSettingsMarkup, /class="settings-card-title">Ask AI &amp; AI Insights<\/span>\s*<span class="settings-helper">Used for chat/);
  assert.doesNotMatch(html, /\bai-settings-heading\b/);
  assert.doesNotMatch(css, /\.ai-settings-heading\b/);
  assert.doesNotMatch(dangerZoneRule, /border-top/);
  assert.doesNotMatch(dangerZoneRule, /padding-top/);
});

test('project details manual date uses the shared custom calendar popover pattern', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const main = fs.readFileSync('js/main.js', 'utf8');

  assert.doesNotMatch(html, /<input(?=[^>]*id="proj-details-manual-date")(?=[^>]*type="date")[^>]*>/);
  assert.match(html, /<input(?=[^>]*id="proj-details-manual-date")(?=[^>]*type="hidden")[^>]*>/);
  assert.match(html, /<button(?=[^>]*id="proj-details-manual-date-trigger")(?=[^>]*class="[^"]*\bproject-manual-date-trigger\b)[^>]*>/);
  assert.match(html, /<div(?=[^>]*id="proj-details-manual-date-picker-popover")(?=[^>]*class="[^"]*\bpopover\b)[^>]*>/);
  assert.match(html, /<div(?=[^>]*id="proj-details-manual-date-picker-days")(?=[^>]*class="[^"]*\bgrid\b[^"]*\bgrid-cols-7\b)[^>]*>/);
  assert.match(css, /\.project-manual-date-picker\s*\{/);
  assert.match(css, /\.project-manual-date-trigger\s*\{/);
  assert.match(main, /setupDatePicker\('projectManual'\)/);
  assert.match(main, /proj-details-manual-date-label/);
});

test('activity popup child rows remove favicon gutters and expose alignment contracts', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const timeline = fs.readFileSync('js/timeline.js', 'utf8');
  const childRenderer = timeline.match(/const renderPopupActivityChildRow[\s\S]*?const renderPopupActivityBreakdownRow/)?.[0] || '';
  const expandRule = css.match(/\.popup-activity-expand\s*\{[^}]*\}/)?.[0] || '';
  const multiChildrenRule = css.match(/\.popup-activity-children--multi\s*\{[^}]*\}/)?.[0] || '';
  const childRowRule = css.match(/\.popup-activity-child-row\s*\{[^}]*\}/)?.[0] || '';

  assert.doesNotMatch(childRenderer, /popup-activity-row__icon/);
  assert.match(childRenderer, /popup-activity-row__main popup-activity-row__main--child/);
  assert.match(timeline, /popup-activity-children--multi/);
  assert.doesNotMatch(timeline, /popup-activity-children--single/);
  assert.match(css, /\.popup-activity-children--multi\s*\{/);
  assert.match(css, /\.popup-activity-row__main--child\s*\{/);
  assert.match(expandRule, /width:\s*24px/);
  assert.match(expandRule, /margin-right:\s*0/);
  assert.match(multiChildrenRule, /margin-left:\s*0/);
  assert.match(childRowRule, /padding-left:\s*0/);
  assert.match(css, /\.activity-mix-tooltip\s*\{[\s\S]*z-index:\s*var\(--z-tooltip\)/);
});

test('work times sidebar uses compact shared panel surfaces', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.match(css, /\.side-summary-content\s*\{[\s\S]*letter-spacing:\s*0/);
  assert.match(css, /\.sidebar-panel--work-times\s*\{[\s\S]*gap:\s*20px/);
  assert.match(css, /\.sidebar-panel--work-times\s*\{[\s\S]*letter-spacing:\s*0/);
  assert.doesNotMatch(html, /sidebar-stat-card|Recorded Active Time|Project Logged Time|Unlogged Work|unlogged-work-review/);
  assert.match(html, /id="work-times-stats"/);
  assert.match(html, /id="work-stat-captured"/);
  assert.match(html, /id="work-stat-logged"/);
  assert.match(html, /id="work-stat-earnings"/);
  assert.match(html, /id="work-stat-conversion-percent"/);
  assert.match(css, /\.work-times-stats-stack\s*\{[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.work-times-stat-card\s*\{[\s\S]*border-right:\s*0/);
  assert.match(css, /\.project-summary-panel\s*\{[\s\S]*padding:\s*16px/);
  assert.match(css, /\.project-summary-panel__header\s*\{[\s\S]*align-items:\s*center/);
  assert.match(css, /\.project-summary-panel__title\s*\{[\s\S]*margin:\s*0/);
  assert.match(html, /class="metric-label project-summary-panel__title">Logged Projects<\/h3>/);
  assert.doesNotMatch(html, /stat-project-total|project-summary-total|Total Project Time/);
  assert.match(css, /\.project-breakdown-card\s*\{[\s\S]*background:\s*color-mix\(in oklch, var\(--surface-raised\)/);
  assert.doesNotMatch(css, /\.project-breakdown-footer\b/);
});

test('web dropdowns use app-rendered menus instead of native select popups', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const main = fs.readFileSync('js/main.js', 'utf8');
  const selectTags = [...html.matchAll(/<select\b([^>]*)>/g)];

  assert.ok(selectTags.length > 0, 'expected dropdowns in app markup');
  for (const [, attributes] of selectTags) {
    assert.match(attributes, /class="[^"]*\bcustom-select\b/);
  }

  assert.match(main, /function setupCustomSelects\(\)/);
  assert.match(main, /className = 'custom-select-button'/);
  assert.match(css, /\.custom-select--native/);
  assert.match(css, /\.custom-select-menu/);
  assert.match(css, /\.custom-select-menu\s*\{[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column[\s\S]*gap:\s*3px/s);
  assert.match(css, /\.custom-select-menu\s*\{[\s\S]*\}\s*\.custom-select-menu\.hidden\s*\{[\s\S]*display:\s*none/s);
  assert.match(css, /\.custom-select-option\.is-selected/);
  assert.match(css, /\.ai-model-option-list\s*\{[\s\S]*gap:\s*3px/s);
  assert.doesNotMatch(css, /\.ai-settings-panel\s*\{/);
  assert.match(html, /class="[^"]*\bai-model-picker-menu\b[^"]*\bpopover\b[^"]*"[^>]*id="settings-ai-model-picker-menu"/);
});

test('time entry task selector uses the app-rendered dropdown treatment', () => {
  const index = fs.readFileSync('index.html', 'utf8');
  const taskSelectorMatch = index.match(/<div class="([^"]*custom-select-wrapper[^"]*)"[^>]*>\s*<select class="([^"]*\bcustom-select\b[^"]*)" id="modal-task-select"/s);

  assert.ok(taskSelectorMatch, 'expected the task selector to be wrapped for custom select enhancement');
});

test('theme preference initializes safely and persists explicit changes', () => {
  const stored = new Map([['theme', 'reference']]);
  const context = {
    window: {},
    document: { documentElement: { dataset: {} } },
    localStorage: {
      getItem(key) {
        return stored.get(key) || null;
      },
      setItem(key, value) {
        stored.set(key, value);
      }
    },
    Set,
    Date
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/state.js', 'utf8'), context);

  assert.equal(context.state.settings.theme, 'reference');
  assert.equal(context.document.documentElement.dataset.theme, 'reference');
  assert.equal(context.normalizeTheme('light'), 'light');
  assert.equal(context.normalizeTheme('reference'), 'reference');
  assert.equal(context.normalizeTheme('variant'), 'reference');
  assert.equal(context.normalizeTheme('unknown'), 'graphite');

  context.applyTheme('variant', { persist: true });
  assert.equal(context.document.documentElement.dataset.theme, 'reference');
  assert.equal(stored.get('theme'), 'reference');

  context.applyTheme('graphite', { persist: true });
  assert.equal(context.document.documentElement.dataset.theme, 'graphite');
  assert.equal(stored.get('theme'), 'graphite');
});

test('theme preload script normalizes before first paint', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const preloadScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1] || '';

  function preloadTheme(storedTheme, { throws = false } = {}) {
    const context = {
      document: { documentElement: { dataset: {} } },
      localStorage: {
        getItem(key) {
          assert.equal(key, 'theme');
          if (throws) throw new Error('storage unavailable');
          return storedTheme;
        }
      },
      Set
    };
    vm.createContext(context);
    vm.runInContext(preloadScript, context);
    return context.document.documentElement.dataset.theme;
  }

  assert.equal(preloadTheme('light'), 'light');
  assert.equal(preloadTheme('reference'), 'reference');
  assert.equal(preloadTheme('variant'), 'reference');
  assert.equal(preloadTheme('blueprint'), 'graphite');
  assert.equal(preloadTheme(null), 'graphite');
  assert.equal(preloadTheme('light', { throws: true }), 'graphite');
});

test('deprecated minActivityThreshold compatibility normalizes unsupported values', () => {
  const stored = new Map([['minActivityThreshold', '95']]);
  const context = {
    window: {},
    document: { documentElement: { dataset: {} } },
    localStorage: {
      getItem(key) {
        return stored.get(key) || null;
      },
      setItem(key, value) {
        stored.set(key, value);
      }
    },
    Set,
    Date
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/state.js', 'utf8'), context);

  assert.equal(context.state.settings.minActivityThreshold, 60);
  assert.equal(context.normalizeMinActivityThreshold('10'), 10);
  assert.equal(context.normalizeMinActivityThreshold('30'), 30);
  assert.equal(context.normalizeMinActivityThreshold('60'), 60);
  assert.equal(context.normalizeMinActivityThreshold('45'), 60);
});

test('legacy variant theme storage migrates to reference theme', () => {
  const stored = new Map([['theme', 'variant']]);
  const context = {
    window: {},
    document: { documentElement: { dataset: {} } },
    localStorage: {
      getItem(key) {
        return stored.get(key) || null;
      },
      setItem(key, value) {
        stored.set(key, value);
      }
    },
    Set,
    Date
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/state.js', 'utf8'), context);

  assert.equal(context.state.settings.theme, 'reference');
  assert.equal(context.document.documentElement.dataset.theme, 'reference');
});
