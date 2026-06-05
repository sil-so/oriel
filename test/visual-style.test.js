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
  assert.match(css, /\.settings-modal-body\s*>\s*:last-child\s*\{[^}]*margin-bottom:\s*22px/s);
  assert.match(css, /#proj-details-entries-list::after\s*\{[^}]*content:\s*"";[^}]*flex:\s*0 0 22px/s);
  assert.doesNotMatch(html.match(/id="confirm-modal"[\s\S]*?<div class="([^"]*modal-panel[^"]*)"/)?.[1] || '', /\bmodal-panel--scroll\b/);
  assert.doesNotMatch(html.match(/id="time-entry-modal"[\s\S]*?<div class="([^"]*modal-panel[^"]*)"/)?.[1] || '', /\bmodal-panel--scroll\b/);
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
  assert.match(css, /\.activity-block\.selected\s*\{[\s\S]*background:\s*color-mix\(in oklch, var\(--accent-wash\) 54%, var\(--surface-raised\) 46%\)/);
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
  assert.match(css, /\.ai-settings-panel\s*\{[\s\S]*border-radius:\s*0;/s);
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
