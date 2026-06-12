import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

test('Oriel themes define dark, light, and neutral visual systems', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');

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

test('header and modal icon controls use the icon-button primitive', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  for (const id of [
    'date-picker-prev-month',
    'date-picker-next-month',
    'popup-close-btn',
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
});

test('AI Insights detail modal puts bottom spacing inside the scroll content', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');
  const modalPanelClass = html.match(/id="ai-insights-detail-modal"[\s\S]*?<div class="([^"]*\bmodal-panel\b[^"]*)"/)?.[1] || '';

  assert.match(modalPanelClass, /\bmodal-panel--scroll\b/);
  assert.match(html, /id="ai-insights-detail-body"[^>]*class="[^"]*\bmodal-scroll-content\b[^"]*"/);
  assert.match(css, /\.ai-insights-detail-body::after\s*\{[^}]*content:\s*"";[^}]*flex:\s*0 0 6px/s);
  assert.doesNotMatch(css.match(/\.ai-insights-detail-body\s*\{[^}]*\}/)?.[0] || '', /padding-bottom:/);
});

test('AI Insights card previews fade after two readable lines', () => {
  const css = fs.readFileSync('css/index.css', 'utf8');
  const previewRule = css.match(/\.ai-insights-card-summary--fade\s*\{[^}]*\}/)?.[0] || '';
  const fadeRule = css.match(/\.ai-insights-card-summary--fade::after\s*\{[^}]*\}/)?.[0] || '';

  assert.match(previewRule, /height:\s*calc\(1\.55em \* 4\)/);
  assert.match(previewRule, /max-height:\s*calc\(1\.55em \* 4\)/);
  assert.match(fadeRule, /height:\s*calc\(1\.55em \* 2\)/);
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

  context.applyTheme('graphite', { persist: true });
  assert.equal(context.document.documentElement.dataset.theme, 'graphite');
  assert.equal(stored.get('theme'), 'graphite');
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
