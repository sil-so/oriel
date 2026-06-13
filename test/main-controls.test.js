import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

class FakeClassList {
  constructor() {
    this.classes = new Set();
  }

  add(...classes) {
    classes.forEach(className => this.classes.add(className));
  }

  remove(...classes) {
    classes.forEach(className => this.classes.delete(className));
  }

  toggle(className, force) {
    if (force === undefined) {
      if (this.classes.has(className)) {
        this.classes.delete(className);
      } else {
        this.classes.add(className);
      }
    } else if (force) {
      this.classes.add(className);
    } else {
      this.classes.delete(className);
    }
  }

  contains(className) {
    return this.classes.has(className);
  }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.tagName = String(id || '').toUpperCase();
    this.classList = new FakeClassList();
    this.listeners = {};
    this.className = '';
    this.value = '';
    this.checked = false;
    this._textContent = '';
    this._innerText = '';
    this.style = {};
    this.attributes = {};
    this.dataset = {};
    this.children = [];
    this.disabled = false;
    this.hidden = false;
    this.focused = false;
  }

  get textContent() {
    const childText = (this.children || []).map(child => child.textContent || '').join('');
    return `${this._textContent || ''}${childText}`;
  }

  set textContent(value) {
    this._textContent = String(value || '');
  }

  get innerText() {
    return this.textContent || this._innerText || '';
  }

  set innerText(value) {
    this._innerText = String(value || '');
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, listener) {
    this.listeners[type] ||= [];
    this.listeners[type].push(listener);
  }

  async click() {
    if (typeof this.onclick === 'function') {
      await this.onclick({ target: this, stopPropagation() {} });
    }
    for (const listener of this.listeners.click || []) {
      await listener({ target: this, stopPropagation() {} });
    }
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] || []) {
      listener({ target: this, stopPropagation() {}, ...event });
    }
  }

  querySelectorAll() {
    return [];
  }

  appendChild(child) {
    this.child = child;
    this.children.push(child);
  }

  append(...children) {
    children.forEach(child => this.appendChild(child));
  }

  replaceChildren(...children) {
    this.child = children.at(-1) || null;
    this.children = children;
  }

  closest() {
    return null;
  }

  focus() {
    this.focused = true;
  }

  getBoundingClientRect() {
    return { top: 0 };
  }
}

test('today navigation refreshes current date before jumping to current time', async () => {
  const calls = [];
  const RealDate = Date;

  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [2026, 4, 23, 11, 56, 0, 0]));
    }

    static now() {
      return new RealDate(2026, 4, 23, 11, 56, 0, 0).getTime();
    }
  }

  const context = {
    window: {},
    Date: FixedDate,
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById(id) {
        if (id !== 'date-picker-popover') return null;
        return {
          classList: {
            add(className) {
              if (className === 'hidden') calls.push('close');
            }
          }
        };
      }
    },
    state: {
      currentDate: new RealDate(2026, 4, 21, 9, 0, 0, 0),
      selectedActivities: new Set([12])
    },
    setupDateDisplay() {
      calls.push('display');
    },
    async refreshData() {
      calls.push('refresh');
    },
    jumpToCurrentTime() {
      calls.push('jump');
    },
    setTimeout() {},
    setInterval() {},
    console
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/main.js', 'utf8'), context);

  await context.goToToday({ closePicker: true });

  assert.equal(context.state.currentDate.getFullYear(), 2026);
  assert.equal(context.state.currentDate.getMonth(), 4);
  assert.equal(context.state.currentDate.getDate(), 23);
  assert.equal(context.state.selectedActivities.size, 0);
  assert.deepEqual(calls, ['display', 'refresh', 'jump', 'close']);
});

test('top workspace navigation includes AI Insights tab and workspace', () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const aiInsightsMarkup = markup.slice(
    markup.indexOf('id="ai-insights-workspace"'),
    markup.indexOf('<!-- MODAL: Create/Edit Time Entry -->')
  );

  assert.match(markup, /id="tab-ai-insights"[\s\S]*AI Insights/);
  assert.match(markup, /id="ai-insights-workspace"/);
  assert.match(markup, /id="ai-insights-card-grid"/);
  assert.doesNotMatch(markup, /id="ai-insights-range-filter"/);
  assert.doesNotMatch(markup, /id="ai-insights-status-filter"/);
  assert.doesNotMatch(markup, /id="ai-insights-summary-date-trigger"/);
  assert.doesNotMatch(aiInsightsMarkup, />Jump to date<|>Range<|>Status</);
  assert.doesNotMatch(markup, /<input[^>]*class="field"[^>]*id="ai-insights-summary-date"/);
  assert.doesNotMatch(markup, /id="ai-insights-generate-button"/);
  assert.doesNotMatch(markup, /id="ai-insights-summary-content"/);
  assert.match(markup, /id="ai-insights-detail-modal"/);
});

function loadMainControlsContext({ fetchJson, nativeResponses = null, confirmResult = true } = {}) {
  const elements = new Map();
  const hoverCalls = [];
  const fetchCalls = [];
  const nativeRequests = [];
  const windowListeners = {};
  const stored = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  const dom = {
    elTabTimeline: element('tab-timeline'),
    elTabProjects: element('tab-projects'),
    elTabStats: element('tab-stats'),
    elTabAiInsights: element('tab-ai-insights'),
    elTimelineModeSwitch: element('timeline-mode-switch'),
    elTimelineModeDay: element('timeline-mode-day'),
    elTimelineModeWeek: element('timeline-mode-week'),
    elSchedulerWorkspace: element('scheduler-workspace'),
    elWeekTimelineWorkspace: element('week-timeline-workspace'),
    elProjectsWorkspace: element('projects-workspace'),
    elStatsWorkspace: element('stats-workspace'),
    elAiInsightsWorkspace: element('ai-insights-workspace'),
    elPopupCloseBtn: element('popup-close'),
    elDateDisplay: element('date-display'),
    elDatePickerInput: element('date-picker-input'),
    elModalStart: element('modal-start'),
    elModalEnd: element('modal-end'),
    elModalDescription: element('modal-description'),
    elModalProjectSelect: element('modal-project-select'),
    elModalTaskSelect: element('modal-task-select'),
    elModalBillable: element('modal-billable'),
    elModalBtnSave: element('modal-save'),
    elModalBtnDelete: element('modal-delete'),
    elModalBtnCancel: element('modal-cancel'),
    elItemsTimeEntries: element('time-entry-items'),
    elGridMemoryAid: element('memory-grid'),
    elProjModal: element('project-modal'),
    elProjBtnCancel: element('project-cancel'),
    elSelectedCount: element('selected-count'),
    elBtnClearSelection: element('clear-selection'),
    elBtnAssignSelected: element('assign-selection'),
    elItemsMemoryAid: element('memory-items')
  };
  element('date-picker-popover').classList.remove('hidden');
  [
    'confirm-modal',
    'project-details-modal',
    'ai-insights-detail-modal',
    'settings-modal',
    'rules-modal',
    'project-modal',
    'time-entry-modal'
  ].forEach(id => element(id).classList.add('hidden'));

  const context = {
    window: {
      addEventListener(type, listener) {
        windowListeners[type] ||= [];
        windowListeners[type].push(listener);
      }
    },
    document: {
      readyState: 'loading',
      documentElement: { dataset: {} },
      body: element('body'),
      addEventListener(type, listener) {
        windowListeners[`document:${type}`] ||= [];
        windowListeners[`document:${type}`].push(listener);
      },
      getElementById: element,
      createElement(tag) {
        return new FakeElement(tag);
      }
    },
    localStorage: {
      getItem(key) {
        return stored.get(key) || null;
      },
      setItem(key, value) {
        stored.set(key, String(value));
      }
    },
    DOM: dom,
    API_BASE: 'http://localhost:3000/api',
    state: {
      currentView: 'timeline',
      currentDate: new Date(2026, 4, 21),
      zoom: 5,
      projects: [],
      trackingExclusions: [],
      selectedActivities: new Set(),
      settings: { theme: 'graphite', logoDevIconsEnabled: false, minActivityThreshold: 60 }
    },
    resizeState: { isResizing: false },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      return { ok: true, json: async () => (fetchJson ? fetchJson(url, options) : {}) };
    },
    OrielData: nativeResponses ? {
      isNative: true,
      async request(operation, payload = {}) {
        nativeRequests.push({ operation, payload });
        const response = nativeResponses[operation];
        return typeof response === 'function' ? response(payload) : (response || {});
      }
    } : undefined,
    URL,
    cleanTitle: title => title,
    getFormattedDate(date) {
      const offset = date.getTimezoneOffset();
      const localDate = new Date(date.getTime() - (offset * 60 * 1000));
      return localDate.toISOString().split('T')[0];
    },
    getActivityIconHTML: () => '',
    alert(message) {
      context.lastAlert = message;
    },
    confirm(message) {
      context.lastConfirm = message;
      return confirmResult;
    },
    parseInputTimeToMs(time) {
      const [hours, minutes] = time.split(':').map(Number);
      const date = new Date(context.state.currentDate);
      date.setHours(hours, minutes, 0, 0);
      return date.getTime();
    },
    getSelectedModalActivities() {
      return context.state.currentModalActivities || [];
    },
    getActivityBlockData(block) {
      return {
        app: block.dataset.app || '',
        title: block.dataset.title || '',
        url: block.dataset.url || '',
        appPath: block.dataset.appPath || '',
        bundleId: block.dataset.bundleId || ''
      };
    },
    getActivitySimilarityKey(activity) {
      const app = String(activity.app || '').trim().toLowerCase();
      const host = activity.url ? new URL(activity.url).hostname.toLowerCase() : '';
      return host ? `${app}|||${host}` : app;
    },
    getActivitySummaryKey(activity) {
      const app = String(activity.app || '').trim().toLowerCase();
      const title = String(activity.title || '').trim().toLowerCase();
      const host = activity.url ? new URL(activity.url).hostname.toLowerCase() : '';
      const nativeIdentity = String(activity.bundleId || activity.appPath || '').trim().toLowerCase();
      return `${app}|||${title}|||${host || nativeIdentity}`;
    },
    renderProjectsPage() {},
    toggleProjectRateFields() {},
    dismissActivityDetailsPopup() {},
    closeTimeEntryModal() {
      element('time-entry-modal').classList.add('hidden');
    },
    renderRulesList() {},
    fetchTrackingExclusions: async () => {},
    updateMultiSelectBar() {},
    renderPresetColorGrid() {},
    refreshData: async () => {},
    renderWeekTimelineGrids() {},
    renderWeekTimeline() {},
    setupDateDisplay() {},
    applyTheme(theme) {
      context.state.settings.theme = theme;
      context.document.documentElement.dataset.theme = theme;
    },
    normalizeMinActivityThreshold(value) {
      const threshold = Number.parseInt(value, 10);
      return [10, 30, 60].includes(threshold) ? threshold : 60;
    },
    showTimeEntryHoverPreview(cellIndex) {
      hoverCalls.push(`show:${cellIndex}`);
    },
    hideTimeEntryHoverPreview() {
      hoverCalls.push('hide');
    },
    setTimeout() {},
    setInterval() {},
    console
  };
  context.window = { ...context.window, ...context };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/timeline.js', 'utf8'), context);
  context.showTimeEntryHoverPreview = cellIndex => {
    hoverCalls.push(`show:${cellIndex}`);
  };
  context.hideTimeEntryHoverPreview = () => {
    hoverCalls.push('hide');
  };
  context.window.showTimeEntryHoverPreview = context.showTimeEntryHoverPreview;
  context.window.hideTimeEntryHoverPreview = context.hideTimeEntryHoverPreview;
  vm.runInContext(fs.readFileSync('js/main.js', 'utf8'), context);
  context.setupMainEventListeners();

  return {
    context,
    dom,
    element,
    hoverCalls,
    fetchCalls,
    nativeRequests,
    stored,
    windowListeners,
    async dispatchDocument(type, event = {}) {
      for (const listener of windowListeners[`document:${type}`] || []) {
        await listener(event);
      }
    },
    async dispatchWindow(type, event = {}) {
      for (const listener of windowListeners[type] || []) {
        await listener(event);
      }
    }
  };
}

function findChild(root, predicate) {
  const stack = [...(root?.children || [])];
  while (stack.length) {
    const child = stack.shift();
    if (predicate(child)) return child;
    stack.push(...(child.children || []));
  }
  return null;
}

test('opening Projects hides timeline date navigation and closes its open picker', () => {
  const { dom, element } = loadMainControlsContext();

  dom.elTabProjects.click();

  assert.equal(element('date-navigation').classList.contains('hidden'), true);
  assert.equal(element('date-picker-popover').classList.contains('hidden'), true);
});

test('header settings control stays outside hidden date navigation', () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const dateNavigation = markup.slice(
    markup.indexOf('id="date-navigation"'),
    markup.indexOf('id="header-actions"')
  );
  const headerActions = markup.slice(
    markup.indexOf('id="header-actions"'),
    markup.indexOf('</div>\n    </div>\n\n    <!-- Main Content Workspace -->')
  );

  assert.doesNotMatch(dateNavigation, /id="btn-settings"/);
  assert.match(headerActions, /id="btn-settings"/);
});

test('day navigation clears selected activity blocks before loading another day', async () => {
  const { element, context } = loadMainControlsContext();
  context.state.selectedActivities.add(18);

  await element('btn-prev-day').click();

  assert.equal(context.state.selectedActivities.size, 0);
});

test('timeline mode switch changes navigation cadence and workspace visibility', async () => {
  const { element, context, dom } = loadMainControlsContext();

  await element('timeline-mode-week').click();

  assert.equal(context.state.timelineMode, 'week');
  assert.equal(dom.elTimelineModeWeek.classList.contains('timeline-mode-option--active'), true);
  assert.equal(dom.elTimelineModeWeek.classList.contains('app-tab--active'), true);
  assert.equal(dom.elTimelineModeDay.classList.contains('timeline-mode-option--active'), false);
  assert.equal(dom.elTimelineModeDay.classList.contains('app-tab--active'), false);
  assert.equal(dom.elSchedulerWorkspace.classList.contains('timeline-mode-week'), true);
  assert.equal(dom.elWeekTimelineWorkspace.classList.contains('hidden'), false);

  await element('btn-prev-day').click();
  assert.equal(context.state.currentDate.getFullYear(), 2026);
  assert.equal(context.state.currentDate.getMonth(), 4);
  assert.equal(context.state.currentDate.getDate(), 14);

  await element('timeline-mode-day').click();
  await element('btn-next-day').click();
  assert.equal(context.state.timelineMode, 'day');
  assert.equal(dom.elTimelineModeDay.classList.contains('app-tab--active'), true);
  assert.equal(dom.elTimelineModeWeek.classList.contains('app-tab--active'), false);
  assert.equal(context.state.currentDate.getDate(), 15);
});

test('workspace tabs expose semantic selected state rather than rewritten utility palettes', () => {
  const { dom } = loadMainControlsContext();

  dom.elTabProjects.click();

  assert.equal(dom.elTabProjects.classList.contains('app-tab--active'), true);
  assert.equal(dom.elTabTimeline.classList.contains('app-tab--active'), false);
  assert.equal(dom.elTabProjects.attributes['aria-selected'], 'true');
  assert.equal(dom.elTabTimeline.attributes['aria-selected'], 'false');
});

test('sidebar collapse control is only visible on the Timeline workspace', async () => {
  const { dom, element } = loadMainControlsContext({
    nativeResponses: {
      'dailyAISummaries.list': []
    }
  });
  const toggle = element('btn-toggle-work-times');
  const settings = element('btn-settings');

  assert.equal(toggle.classList.contains('hidden'), false);
  assert.equal(toggle.hidden, false);
  assert.equal(settings.classList.contains('hidden'), false);

  await dom.elTabProjects.click();
  assert.equal(toggle.classList.contains('hidden'), true);
  assert.equal(toggle.hidden, true);
  assert.equal(settings.classList.contains('hidden'), false);

  await dom.elTabStats.click();
  assert.equal(toggle.classList.contains('hidden'), true);
  assert.equal(toggle.hidden, true);
  assert.equal(settings.classList.contains('hidden'), false);

  await dom.elTabAiInsights.click();
  assert.equal(toggle.classList.contains('hidden'), true);
  assert.equal(toggle.hidden, true);
  assert.equal(settings.classList.contains('hidden'), false);

  await dom.elTabTimeline.click();
  assert.equal(toggle.classList.contains('hidden'), false);
  assert.equal(toggle.hidden, false);
  assert.equal(settings.classList.contains('hidden'), false);
});

test('AI Insights tab switches to the AI insights workspace and loads summary cards', async () => {
  const { dom, context, element, nativeRequests } = loadMainControlsContext({
    nativeResponses: {
      'dailyAISummaries.list': []
    }
  });

  await dom.elTabAiInsights.click();

  assert.equal(context.state.currentView, 'aiInsights');
  assert.equal(dom.elSchedulerWorkspace.classList.contains('hidden'), true);
  assert.equal(dom.elProjectsWorkspace.classList.contains('hidden'), true);
  assert.equal(dom.elStatsWorkspace.classList.contains('hidden'), true);
  assert.equal(dom.elAiInsightsWorkspace.classList.contains('hidden'), false);
  assert.equal(dom.elTabAiInsights.classList.contains('app-tab--active'), true);
  assert.equal(element('date-navigation').classList.contains('hidden'), true);
  assert.deepEqual(nativeRequests.map(request => request.operation), ['dailyAISummaries.list']);
  assert.deepEqual({ ...nativeRequests[0].payload }, {
    startDate: '2025-05-21',
    endDate: '2026-05-21',
    includeEmpty: false
  });
});

test('AI Insights renders generated, ready, and failed summary cards without uncertainty text', async () => {
  const { dom, element } = loadMainControlsContext({
    nativeResponses: {
      'dailyAISummaries.list': [
        {
          date: '2026-06-07',
          status: 'succeeded',
          sourceSummaryCount: 3,
          summary: {
            text: 'Focused implementation work in Oriel.',
            highlights: ['Improved AI Insights'],
            uncertainties: ['metadata mismatch']
          }
        },
        {
          date: '2026-06-08',
          status: 'ready',
          sourceSummaryCount: 7
        },
        {
          date: '2026-06-06',
          status: 'failed',
          sourceSummaryCount: 2,
          errorMessage: 'Provider unavailable.'
        }
      ]
    }
  });

  await dom.elTabAiInsights.click();
  const grid = element('ai-insights-card-grid');
  assert.equal(grid.children.length, 3);
  assert.match(String(grid.children[0].className), /\bai-insights-card\b/);
  assert.ok(findChild(grid.children[0], child => String(child.className || '').includes('card-title')));
  assert.ok(findChild(grid.children[0], child => String(child.className || '').includes('ai-insights-card-metadata')));
  assert.ok(findChild(grid.children[0], child => String(child.className || '').includes('card-actions')));
  for (const card of grid.children) {
    assert.doesNotMatch(String(card.className || ''), /text-\[(?:10|11|12|13)px\]|text-gray-|text-white|border-\[#2d2f34\]/);
  }
  assert.match(grid.textContent, /Sunday, 7 June 2026/);
  assert.doesNotMatch(grid.textContent, /Sun, 7 Jun 2026/);
  assert.match(grid.textContent, /Focused implementation work in Oriel/);
  assert.doesNotMatch(grid.textContent, /Improved AI Insights/);
  assert.match(grid.textContent, /Generate daily summary/);
  assert.match(grid.textContent, /Try again/);
  assert.doesNotMatch(grid.textContent, /Based on \d+ screenshot activity summar/);
  assert.doesNotMatch(grid.textContent, /Uncertainties|metadata mismatch/);
});

test('AI Insights ready card generation uses the card date and refreshes the grid', async () => {
  let generated = false;
  const { dom, element, nativeRequests } = loadMainControlsContext({
    nativeResponses: {
      'dailyAISummaries.list': () => generated ? [
        {
          date: '2026-06-08',
          status: 'succeeded',
          sourceSummaryCount: 7,
          summary: { text: 'Generated recap.', highlights: [] }
        }
      ] : [
        {
          date: '2026-06-08',
          status: 'ready',
          sourceSummaryCount: 7
        }
      ],
      'dailyAISummaries.generate': payload => {
        generated = true;
        return {
          date: payload.date,
          status: 'succeeded',
          sourceSummaryCount: 7,
          summary: { text: 'Generated recap.', highlights: [] }
        };
      }
    }
  });

  await dom.elTabAiInsights.click();
  const readyCard = element('ai-insights-card-grid').children[0];
  const generateButton = findChild(readyCard, child => child.dataset?.action === 'generate');
  assert.ok(generateButton);

  await generateButton.click();
  assert.deepEqual(nativeRequests.map(request => request.operation), [
    'dailyAISummaries.list',
    'dailyAISummaries.generate',
    'dailyAISummaries.list'
  ]);
  assert.equal(nativeRequests[1].payload.date, '2026-06-08');
  assert.match(element('ai-insights-card-grid').textContent, /Generated recap/);
});

test('AI Insights generated card Open button shows a full summary modal', async () => {
  const { dom, element } = loadMainControlsContext({
    nativeResponses: {
      'dailyAISummaries.list': [
        {
          date: '2026-06-07',
          status: 'succeeded',
          sourceSummaryCount: 3,
          summary: {
            text: 'Generated recap.\n\nHighlights:\n- One\n- Two',
            highlights: ['One', 'Two', 'Three', 'Four', 'Five']
          }
        }
      ]
    }
  });

  await dom.elTabAiInsights.click();
  const card = element('ai-insights-card-grid').children[0];
  const openButton = findChild(card, child => child.textContent === 'Open');
  assert.ok(openButton);
  assert.equal(element('ai-insights-detail-modal').classList.contains('hidden'), true);

  await openButton.click();
  assert.equal(element('ai-insights-detail-modal').classList.contains('hidden'), false);
  assert.equal(element('ai-insights-detail-title').textContent, 'Sunday, 7 June 2026');
  assert.match(element('ai-insights-detail-body').textContent, /Generated recap/);
  const markdownList = findChild(element('ai-insights-detail-body'), child => child.tagName === 'UL' && String(child.className || '').includes('ai-insights-card-markdown-list'));
  assert.ok(markdownList);
  assert.equal(markdownList.children.length, 2);
  assert.equal(openButton.textContent, 'Open');
});

test('AI Insights generated cards use a text-only preview and render markdown lists in the detail modal', async () => {
  const { dom, element } = loadMainControlsContext({
    nativeResponses: {
      'dailyAISummaries.list': [
        {
          date: '2026-06-07',
          status: 'succeeded',
          sourceSummaryCount: 3,
          summary: {
            text: 'Focused implementation work.\n\nHighlights:\n- Improved card interactions\n- Rendered recap bullets\n\nAdditional details stayed readable.',
            highlights: []
          }
        }
      ]
    }
  });

  await dom.elTabAiInsights.click();
  const card = element('ai-insights-card-grid').children[0];
  assert.match(card.textContent, /Focused implementation work/);
  assert.doesNotMatch(card.textContent, /Improved card interactions|Rendered recap bullets|Additional details/);
  assert.equal(findChild(card, child => child.tagName === 'UL'), null);

  await findChild(card, child => child.textContent === 'Open').click();
  const markdownList = findChild(element('ai-insights-detail-body'), child => child.tagName === 'UL' && String(child.className || '').includes('ai-insights-card-markdown-list'));
  assert.ok(markdownList);
  assert.equal(markdownList.children.length, 2);
  assert.match(markdownList.textContent, /Improved card interactions/);
  assert.match(markdownList.textContent, /Rendered recap bullets/);
  assert.match(element('ai-insights-detail-body').textContent, /Additional details stayed readable/);
});

test('AI Insights generation buttons show loading state while a request is pending', async () => {
  let resolveGenerate;
  let generated = false;
  const { dom, element, nativeRequests } = loadMainControlsContext({
    nativeResponses: {
      'dailyAISummaries.list': () => generated ? [
        {
          date: '2026-06-08',
          status: 'succeeded',
          sourceSummaryCount: 7,
          summary: { text: 'Generated recap.', highlights: [] }
        }
      ] : [
        { date: '2026-06-08', status: 'ready', sourceSummaryCount: 7 }
      ],
      'dailyAISummaries.generate': payload => new Promise(resolve => {
        resolveGenerate = () => {
          generated = true;
          resolve({
            date: payload.date,
            status: 'succeeded',
            sourceSummaryCount: 7,
            summary: { text: 'Generated recap.', highlights: [] }
          });
        };
      })
    }
  });

  await dom.elTabAiInsights.click();
  const readyCard = element('ai-insights-card-grid').children[0];
  const generateButton = findChild(readyCard, child => child.dataset?.action === 'generate');
  assert.ok(generateButton);

  const clickPromise = generateButton.click();
  await Promise.resolve();

  const pendingButton = findChild(element('ai-insights-card-grid').children[0], child => child.dataset?.action === 'generate');
  assert.equal(pendingButton.disabled, true);
  assert.equal(pendingButton.textContent, 'Generating...');
  assert.equal(nativeRequests[1].payload.date, '2026-06-08');

  resolveGenerate();
  await clickPromise;
  assert.match(element('ai-insights-card-grid').textContent, /Generated recap/);
});

test('AI Insights refreshes when header date navigation changes while active', async () => {
  const { dom, element, nativeRequests } = loadMainControlsContext({
    nativeResponses: {
      'dailyAISummaries.list': payload => []
    }
  });

  await dom.elTabAiInsights.click();
  nativeRequests.length = 0;

  await element('btn-prev-day').click();

  assert.deepEqual(nativeRequests.map(request => request.operation), ['dailyAISummaries.list']);
  assert.deepEqual({ ...nativeRequests[0].payload }, {
    startDate: '2025-05-20',
    endDate: '2026-05-20',
    includeEmpty: false
  });
});

test('settings modal reopens with current theme and brand icon preference', async () => {
  const { element } = loadMainControlsContext();
  const themeSelect = element('settings-theme-select');
  const logoToggle = element('settings-logo-dev-icons');
  const settingsModal = element('settings-modal');
  const settingsButton = element('btn-settings');

  themeSelect.value = 'graphite';
  logoToggle.checked = false;
  themeSelect.dispatch('change', { target: { value: 'light' } });
  logoToggle.dispatch('change', { target: { checked: true } });
  await settingsButton.click();

  assert.equal(themeSelect.value, 'light');
  assert.equal(logoToggle.checked, true);
  assert.equal(settingsModal.classList.contains('hidden'), false);
});

test('settings modal exposes section tabs and can open directly to AI settings', async () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const script = fs.readFileSync('js/main.js', 'utf8');
  const aiSettingsScript = fs.readFileSync('js/ai-settings.js', 'utf8');

  assert.match(markup, /id="settings-modal"[\s\S]*class="[^"]*(?:^|\s)modal-size--lg(?:\s|")[^"]*"/);
  assert.match(markup, /id="project-details-modal"[\s\S]*class="[^"]*(?:^|\s)modal-size--lg(?:\s|")[^"]*"/);
  assert.match(markup, /data-settings-section-button="general"[\s\S]*General/);
  assert.match(markup, /data-settings-section-button="capture"[\s\S]*Capture &amp; Privacy/);
  assert.match(markup, /data-settings-section-button="ai"[\s\S]*AI/);
  assert.match(markup, /data-settings-section-button="data"[\s\S]*Data/);
  assert.match(markup, /data-settings-section-panel="ai"[\s\S]*Provider/);
  assert.match(markup, /data-settings-section-panel="ai"[\s\S]*Screenshot Summaries/);
  assert.match(script, /window\.openSettingsModal = openSettingsModal/);
  assert.match(script, /openSettingsModal\(\{ section = 'general' \} = \{\}\)/);
  assert.match(script, /setSettingsSection\(section\);[\s\S]*bindSettingsTooltips\(\)/);
  assert.match(script, /hideSettingsTooltip\(\);[\s\S]*setSettingsSection/);
  assert.match(script, /document\.addEventListener\('pointerover'[\s\S]*showSettingsTooltip/);
  assert.match(script, /document\.addEventListener\('focusin'[\s\S]*showSettingsTooltip/);
  assert.doesNotMatch(script, /_settingsTooltipBound/);
  assert.match(aiSettingsScript, /window\.refreshAiSettingsStatus = refreshAiSettingsStatus/);
  assert.match(aiSettingsScript, /window\.getSelectedAiProviderAndModel = getSelectedAiProviderAndModel/);
});

test('AI settings section includes OpenRouter and screenshot summary controls', () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const styles = fs.readFileSync('css/index.css', 'utf8');
  const state = fs.readFileSync('js/state.js', 'utf8');
  const aiSettingsScript = fs.readFileSync('js/ai-settings.js', 'utf8');

  assert.match(markup, /Provider &amp; Key/);
  assert.match(markup, /Ask AI &amp; AI Insights/);
  assert.match(markup, /Used for chat in the Ask AI sidebar and generating daily summaries\./);
  assert.match(markup, /id="settings-ai-ask-provider"/);
  assert.match(markup, /data-settings-ai-provider="openrouter"[\s\S]*OpenRouter/);
  assert.match(markup, /id="settings-ai-provider-openrouter-key-state"/);
  assert.doesNotMatch(markup, /Use Ask AI provider/);
  assert.match(markup, /id="settings-ai-screenshot-frequency"[\s\S]*value="low"[\s\S]*Low/);
  assert.match(markup, /id="settings-ai-screenshot-frequency"[\s\S]*value="balanced"[\s\S]*Balanced/);
  assert.match(markup, /id="settings-ai-screenshot-frequency"[\s\S]*value="high"[\s\S]*High/);
  assert.match(markup, /id="settings-ai-screenshot-daily-cap"[^>]+value="100"/);
  assert.match(markup, /id="settings-ai-screenshot-timeout"[^>]+value="20"/);
  assert.match(markup, /id="settings-ai-screenshot-model-picker-button"/);
  assert.match(markup, /id="settings-ai-screenshot-model-search-input"/);
  assert.match(markup, /id="settings-ai-screenshot-model-refresh-button"/);
  assert.doesNotMatch(markup, /id="settings-ai-screenshot-model-mode"/);
  assert.doesNotMatch(markup, /id="settings-ai-screenshot-model-input"/);
  assert.match(state, /aiOpenRouterModel:\s*localStorage\.getItem\('aiOpenRouterModel'\)/);
  assert.match(state, /aiScreenshotProvider:\s*localStorage\.getItem\('aiScreenshotProvider'\) \|\| ''/);
  assert.match(state, /aiScreenshotSummariesEnabled:\s*parseStoredBooleanSetting\('aiScreenshotSummariesEnabled', false\)/);
  assert.match(state, /aiScreenshotFrequencyPreset:\s*localStorage\.getItem\('aiScreenshotFrequencyPreset'\) \|\| 'balanced'/);
  assert.match(aiSettingsScript, /DEFAULT_OPENROUTER_MODEL/);
  assert.match(aiSettingsScript, /aiScreenshotFrequencyPreset/);
  assert.match(aiSettingsScript, /settings-ai-screenshot-test-button/);
  assert.match(styles, /\.ai-settings-grid--modal\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('Activity Stream empty-row toggle persists and rerenders Day timelines', async () => {
  const { element, context, nativeRequests, stored } = loadMainControlsContext({
    nativeResponses: {
      'settings.update': payload => payload
    }
  });
  const renderCalls = [];
  const centerCalls = [];
  const preservedCenterMs = new Date(2026, 4, 21, 9, 45).getTime();
  const memoryScroll = element('memory-aid-container');
  const timeEntriesScroll = element('time-entries-container');
  context.state.settings.hideEmptyActivityRows = false;
  context.DOM.elMemAidScroll = memoryScroll;
  context.DOM.elTimeEntriesScroll = timeEntriesScroll;
  memoryScroll.scrollTop = 80;
  memoryScroll.clientHeight = 40;
  timeEntriesScroll.scrollTop = 0;
  timeEntriesScroll.clientHeight = 40;
  context.renderTimelineGrids = () => renderCalls.push('grid');
  context.renderMemoryAidActivities = () => renderCalls.push('activity');
  context.renderLoggedTimeEntries = () => renderCalls.push('entries');
  context.window.renderTimelineGrids = context.renderTimelineGrids;
  context.window.renderMemoryAidActivities = context.renderMemoryAidActivities;
  context.window.renderLoggedTimeEntries = context.renderLoggedTimeEntries;
  context.window.getTimelineTimeForDisplayTop = displayTop => {
    centerCalls.push({ phase: 'read', hidden: context.state.settings.hideEmptyActivityRows, displayTop });
    return preservedCenterMs;
  };
  context.window.getTimelineDisplayTopForTime = timeMs => {
    centerCalls.push({ phase: 'write', hidden: context.state.settings.hideEmptyActivityRows, timeMs });
    return 240;
  };

  await element('btn-toggle-empty-activity-rows').click();

  assert.equal(context.state.settings.hideEmptyActivityRows, true);
  assert.equal(stored.get('hideEmptyActivityRows'), 'true');
  assert.equal(element('btn-toggle-empty-activity-rows').attributes['aria-pressed'], 'true');
  assert.equal(element('btn-toggle-empty-activity-rows').classList.contains('is-active'), true);
  assert.deepEqual(renderCalls, ['grid', 'activity', 'entries']);
  assert.deepEqual(centerCalls, [
    { phase: 'read', hidden: false, displayTop: 100 },
    { phase: 'write', hidden: true, timeMs: preservedCenterMs }
  ]);
  assert.equal(memoryScroll.scrollTop, 220);
  assert.equal(timeEntriesScroll.scrollTop, 220);
  assert.deepEqual(
    JSON.parse(JSON.stringify(nativeRequests
      .filter(request => request.operation === 'settings.update')
      .map(request => request.payload))),
    [{ hideEmptyActivityRows: true }]
  );
});

test('settings title cleanup rules add valid regex rules and block invalid regex', async () => {
  const { element, nativeRequests, stored } = loadMainControlsContext({
    nativeResponses: {
      'settings.get': {
        theme: 'graphite',
        logoDevIconsEnabled: false,
        minActivityThreshold: 60,
        titleCleanupRules: []
      },
      'settings.update': payload => payload,
      'logoDev.key.status': { saved: false }
    }
  });

  await element('btn-settings').click();

  element('settings-title-cleanup-name').value = 'Strip Draft';
  element('settings-title-cleanup-pattern').value = '\\s+-\\s*Draft$';
  element('settings-title-cleanup-app').value = 'Brave';
  element('settings-title-cleanup-url').value = '';
  await element('settings-title-cleanup-add').click();

  const updateRequest = nativeRequests.find(request => (
    request.operation === 'settings.update'
    && Array.isArray(request.payload.titleCleanupRules)
  ));
  assert.ok(updateRequest);
  assert.equal(updateRequest.payload.titleCleanupRules.length, 1);
  assert.equal(updateRequest.payload.titleCleanupRules[0].name, 'Strip Draft');
  assert.equal(updateRequest.payload.titleCleanupRules[0].pattern, '\\s+-\\s*Draft$');
  assert.equal(updateRequest.payload.titleCleanupRules[0].appContains, 'Brave');
  assert.equal(stored.get('titleCleanupRules'), JSON.stringify(updateRequest.payload.titleCleanupRules));

  const requestCount = nativeRequests.length;
  element('settings-title-cleanup-name').value = 'Invalid Rule';
  element('settings-title-cleanup-pattern').value = '[';
  await element('settings-title-cleanup-add').click();

  assert.equal(nativeRequests.length, requestCount);
  assert.equal(element('settings-title-cleanup-status').textContent, 'Enter a valid JavaScript regular expression.');
  assert.equal(element('settings-title-cleanup-status').classList.contains('hidden'), false);
});

test('settings Logo.dev key controls lock saved keys and require explicit edit or confirmed removal', async () => {
  let logoDevStatus = { saved: true };
  const { element, nativeRequests } = loadMainControlsContext({
    nativeResponses: {
      'settings.get': {
        theme: 'graphite',
        logoDevIconsEnabled: true,
        minActivityThreshold: 60
      },
      'logoDev.key.status': () => logoDevStatus,
      'logoDev.key.save': payload => {
        logoDevStatus = { saved: Boolean(payload.apiKey) };
        return logoDevStatus;
      },
      'logoDev.key.delete': () => {
        logoDevStatus = { saved: false };
        return logoDevStatus;
      }
    }
  });

  await element('btn-settings').click();

  assert.equal(element('settings-logo-dev-api-key-input').disabled, true);
  assert.equal(element('settings-logo-dev-api-key-input').value, '********');
  assert.equal(element('settings-logo-dev-key-edit-button').classList.contains('hidden'), false);
  assert.equal(element('settings-logo-dev-key-save-button').classList.contains('hidden'), true);
  assert.equal(element('settings-logo-dev-key-delete-button').classList.contains('hidden'), false);

  await element('settings-logo-dev-key-edit-button').click();

  assert.equal(element('settings-logo-dev-api-key-input').disabled, false);
  assert.equal(element('settings-logo-dev-api-key-input').value, '');
  assert.equal(element('settings-logo-dev-api-key-input').focused, true);
  assert.equal(element('settings-logo-dev-key-save-label').textContent, 'Save new key');
  assert.equal(element('settings-logo-dev-key-cancel-button').classList.contains('hidden'), false);
  assert.equal(element('settings-logo-dev-key-delete-button').classList.contains('hidden'), true);

  await element('settings-logo-dev-key-cancel-button').click();

  assert.equal(element('settings-logo-dev-api-key-input').disabled, true);
  assert.equal(element('settings-logo-dev-api-key-input').value, '********');

  await element('settings-logo-dev-key-edit-button').click();
  element('settings-logo-dev-api-key-input').value = 'pk_test_replacement';
  await element('settings-logo-dev-key-save-button').click();

  assert.deepEqual(
    JSON.parse(JSON.stringify(nativeRequests
      .filter(request => request.operation === 'logoDev.key.save')
      .map(request => request.payload))),
    [{ apiKey: 'pk_test_replacement' }]
  );
  assert.equal(element('settings-logo-dev-api-key-input').disabled, true);
  assert.equal(element('settings-logo-dev-api-key-input').value, '********');

  await element('settings-logo-dev-key-delete-button').click();

  assert.equal(nativeRequests.filter(request => request.operation === 'logoDev.key.delete').length, 1);
  assert.equal(element('settings-logo-dev-api-key-input').disabled, false);
  assert.equal(element('settings-logo-dev-api-key-input').value, '');
  assert.equal(element('settings-logo-dev-key-edit-button').classList.contains('hidden'), true);
  assert.equal(element('settings-logo-dev-key-delete-button').classList.contains('hidden'), true);
});

test('settings Logo.dev key removal requires confirmation', async () => {
  const { element, nativeRequests, context } = loadMainControlsContext({
    confirmResult: false,
    nativeResponses: {
      'settings.get': {
        theme: 'graphite',
        logoDevIconsEnabled: true,
        minActivityThreshold: 60
      },
      'logoDev.key.status': { saved: true },
      'logoDev.key.delete': { saved: false }
    }
  });

  await element('btn-settings').click();
  await element('settings-logo-dev-key-delete-button').click();

  assert.match(context.lastConfirm, /Remove the saved Logo\.dev API key/);
  assert.equal(nativeRequests.filter(request => request.operation === 'logoDev.key.delete').length, 0);
});

test('settings Logo.dev key UI asks for the publishable key, not the secret key', () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const script = fs.readFileSync('js/main.js', 'utf8');

  assert.match(markup, /Use your Logo\.dev <strong>publishable<\/strong> key \(`pk_/);
  assert.match(markup, /placeholder="Paste publishable key"/);
  assert.match(script, /Logo\.dev publishable key/);
});

test('minimum summary duration selector is no longer wired', () => {
  const { element, context, stored } = loadMainControlsContext();
  const thresholdSelect = element('settings-threshold-select');

  assert.equal(thresholdSelect.listeners.change, undefined);
  thresholdSelect.dispatch('change', { target: { value: '30' } });

  assert.equal(context.state.settings.minActivityThreshold, 60);
  assert.equal(stored.get('minActivityThreshold'), undefined);
});

test('tracking exclusion history cleanup is one-shot and reports removed history', async () => {
  const { element, fetchCalls } = loadMainControlsContext({
    fetchJson: url => url.endsWith('/exclusions') ? { removedHistoryCount: 2 } : {}
  });
  const patternInput = element('settings-exclusion-pattern');
  const applyHistoryToggle = element('settings-exclusion-apply-history');
  const status = element('settings-exclusion-status');

  assert.equal(status.classList.contains('hidden'), true);

  element('settings-exclusion-field').value = 'app';
  element('settings-exclusion-match').value = 'contains';
  patternInput.value = 'Passwords';
  applyHistoryToggle.checked = true;

  await element('settings-exclusion-add').click();

  const createCall = fetchCalls.find(call => call.url === 'http://localhost:3000/api/exclusions');
  assert.equal(createCall.body.applyToHistory, true);
  assert.equal(patternInput.value, '');
  assert.equal(applyHistoryToggle.checked, false);
  assert.equal(status.textContent, 'Cleaned 2 existing activities.');
  assert.equal(status.classList.contains('hidden'), false);
});

test('modal overlays close from Escape and outside click', () => {
  const { element, dispatchWindow, context } = loadMainControlsContext();

  const settingsModal = element('settings-modal');
  settingsModal.classList.remove('hidden');
  dispatchWindow('keydown', { key: 'Escape' });
  assert.equal(settingsModal.classList.contains('hidden'), true);

  const timeEntryModal = element('time-entry-modal');
  timeEntryModal.classList.remove('hidden');
  timeEntryModal.dispatch('click', { target: timeEntryModal });
  assert.equal(timeEntryModal.classList.contains('hidden'), true);

  const projectModal = element('project-modal');
  context.window.editingProjectId = 'project-1';
  projectModal.classList.remove('hidden');
  projectModal.dispatch('click', { target: projectModal });
  assert.equal(projectModal.classList.contains('hidden'), true);
  assert.equal(context.window.editingProjectId, null);

  const confirmModal = element('confirm-modal');
  confirmModal.classList.remove('hidden');
  confirmModal.dispatch('click', { target: confirmModal });
  assert.equal(confirmModal.classList.contains('hidden'), true);
});

test('actual activity capture removes passive review UI affordances', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const api = fs.readFileSync('js/api.js', 'utf8');
  const modals = fs.readFileSync('js/modals.js', 'utf8');
  const css = fs.readFileSync('css/index.css', 'utf8');

  assert.doesNotMatch(html, /passive-review/);
  assert.doesNotMatch(api, /updatePassiveReviewInbox|showPassiveReviewPrompt|pendingPassiveReviews/);
  assert.doesNotMatch(modals, /renderPassiveReviewRow|groupPassiveReviews|Keep Audible|Discard Silent|Keep Time/);
  assert.doesNotMatch(css, /passive-review-trigger/);
  assert.match(css, /\.button-primary:disabled,[\s\S]*\.button-secondary:disabled/);
});

test('time entry pointer hover previews empty rows and active drag retains labeled duration feedback', () => {
  const { dom, hoverCalls, dispatchWindow } = loadMainControlsContext();

  dom.elItemsTimeEntries.dispatch('mousemove', { clientY: 85 });
  assert.deepEqual(hoverCalls, ['show:2']);

  dom.elItemsTimeEntries.dispatch('mouseleave');
  assert.deepEqual(hoverCalls, ['show:2', 'hide']);

  dom.elItemsTimeEntries.dispatch('mousedown', { button: 0, clientY: 85 });
  assert.equal(hoverCalls.at(-1), 'hide');
  assert.equal(dom.elItemsTimeEntries.child.style.top, '82px');
  assert.equal(dom.elItemsTimeEntries.child.style.height, '37px');
  assert.match(dom.elItemsTimeEntries.child.innerHTML, /New time entry/);
  assert.match(dom.elItemsTimeEntries.child.innerHTML, /5 min/);

  dispatchWindow('mousemove', { clientY: 165 });
  assert.equal(dom.elItemsTimeEntries.child.style.top, '82px');
  assert.equal(dom.elItemsTimeEntries.child.style.height, '117px');
  assert.match(dom.elItemsTimeEntries.child.innerHTML, /15 min/);
  assert.match(dom.elItemsTimeEntries.child.innerHTML, /Click & drag to log/);
});

test('compressed Time Entries mousemove skips hover preview and row-layout work', () => {
  const { context, dom, hoverCalls } = loadMainControlsContext();
  let layoutCalls = 0;

  context.state.settings.hideEmptyActivityRows = true;
  context.window.buildDayTimelineRowLayout = () => {
    layoutCalls += 1;
    return { hideEmptyRows: true, displayRowCount: 0 };
  };

  dom.elItemsTimeEntries.dispatch('mousemove', { clientY: 85 });

  assert.equal(layoutCalls, 0);
  assert.deepEqual(hoverCalls, []);
});

test('compressed Time Entries disables drag-created entries from empty space', async () => {
  const { context, dom, dispatchWindow } = loadMainControlsContext();
  let modalArgs = null;

  context.state.settings.hideEmptyActivityRows = true;
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;

  dom.elItemsTimeEntries.dispatch('mousedown', { button: 0, clientY: 85 });
  await dispatchWindow('mousemove', { clientY: 165 });
  await dispatchWindow('mouseup');

  assert.equal(dom.elItemsTimeEntries.child, undefined);
  assert.equal(modalArgs, null);
});

test('time entry create cue can run over an existing logged entry row', () => {
  const { dom, hoverCalls, dispatchWindow } = loadMainControlsContext();
  const entryTarget = {
    closest(selector) {
      if (selector === '.time-entry-block') return { dataset: { id: 'entry-1' } };
      return null;
    }
  };

  dom.elItemsTimeEntries.dispatch('mousemove', { clientY: 125, target: entryTarget });
  assert.deepEqual(hoverCalls, ['show:3']);

  dom.elItemsTimeEntries.dispatch('mousedown', {
    button: 0,
    clientY: 125,
    target: entryTarget,
    preventDefault() {}
  });
  dispatchWindow('mousemove', { clientY: 165 });

  assert.equal(dom.elItemsTimeEntries.child.className, 'drag-box-visual');
  assert.equal(dom.elItemsTimeEntries.child.style.top, '122px');
  assert.equal(dom.elItemsTimeEntries.child.style.height, '77px');
});

test('column splitter drag prevents text selection until release', () => {
  const { element, dispatchWindow } = loadMainControlsContext();
  const resizeHandle = element('resize-handle');
  let prevented = false;

  resizeHandle.dispatch('mousedown', {
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.equal(element('body').classList.contains('is-column-resizing'), true);
  assert.equal(element('body').style.cursor, 'col-resize');

  dispatchWindow('mouseup');

  assert.equal(element('body').classList.contains('is-column-resizing'), false);
  assert.equal(element('body').style.cursor, 'default');
});

test('resizing auto-rule entry over multiple recorded activities opens edit modal for selection', async () => {
  const { context, dispatchWindow, fetchCalls } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hours, minutes) => dateStart + (hours * 60 + minutes) * 60 * 1000;
  const rangeStart = at(21, 40);
  const rangeEnd = at(22, 10);
  const figma = {
    app: 'Figma',
    title: 'macOS Big Sur icon template',
    bundleId: 'com.figma.Desktop',
    appPath: '/Applications/Figma.app',
    start: at(21, 50),
    end: at(22, 4),
    duration: 14 * 60 * 1000
  };
  const codex = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    appPath: '/Applications/Codex.app',
    start: at(22, 4),
    end: at(22, 5),
    duration: 60 * 1000
  };
  const entryEl = {
    dataset: { id: 'entry-1' },
    style: {
      top: `${((21 * 60 + 40) / 10) * 40}px`,
      height: `${3 * 40 - 1}px`
    },
    getBoundingClientRect() {
      return { top: (22 * 60 / 10) * 40, height: 40 };
    }
  };
  let modalArgs = null;

  context.state.zoom = 10;
  context.state.activities = [figma, codex];
  context.state.timeEntries = [{
    id: 'entry-1',
    start: at(22, 0),
    end: rangeEnd,
    projectId: 'project-1',
    taskId: '',
    description: '',
    billable: false,
    createdBy: 'auto-rule',
    autoRuleId: 'rule-1',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      bundleId: 'com.openai.codex',
      appPath: '/Applications/Codex.app',
      start: at(22, 0),
      end: rangeEnd,
      duration: 10 * 60 * 1000,
      assignedDurationMs: 10 * 60 * 1000,
      assignmentStart: at(22, 0),
      assignmentEnd: rangeEnd,
      assignmentSource: 'activity-stream',
      assignmentModel: 'auto-assigned-capture',
      autoAssigned: true,
      autoAssignmentRuleId: 'rule-1'
    }]
  }];
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;

  context.startResizingEntry(entryEl, 'top', 0);
  await dispatchWindow('mouseup');

  assert.equal(fetchCalls.length, 0);
  assert.equal(context.window.editingTimeEntryId, 'entry-1');
  assert.equal(modalArgs[0], rangeStart);
  assert.equal(modalArgs[1], rangeEnd);
  assert.equal(modalArgs[3], 'project-1');
  assert.equal(modalArgs[5], false);
  assert.deepEqual(Array.from(modalArgs[6], activity => activity.app), ['Figma', 'Codex']);
  assert.deepEqual(Array.from(modalArgs[6], activity => activity.duration), [14 * 60 * 1000, 60 * 1000]);
});

test('bulk activity assignment saves separate entries at each selected activity time', async () => {
  const { dom, context, fetchCalls } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const first = {
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + (9 * 60 + 15) * 60 * 1000,
    duration: 15 * 60 * 1000,
    app: 'Brave Browser',
    title: 'Issue Tracker',
    url: 'https://github.com/example'
  };
  const second = {
    start: dateStart + 13 * 60 * 60 * 1000,
    end: dateStart + (13 * 60 + 20) * 60 * 1000,
    duration: 20 * 60 * 1000,
    app: 'Brave Browser',
    title: 'Issue Tracker',
    url: 'https://github.com/example'
  };

  context.window.isBulkAllocation = true;
  dom.elModalStart.value = '09:00';
  dom.elModalEnd.value = '13:20';
  dom.elModalDescription.value = 'Implementation';
  dom.elModalProjectSelect.value = 'project-1';
  dom.elModalTaskSelect.value = 'task-1';
  dom.elModalBillable.checked = true;
  context.state.currentModalActivities = [first, second];

  await dom.elModalBtnSave.click();

  assert.equal(fetchCalls.length, 2);
  assert.deepEqual(fetchCalls.map(call => call.url), [
    'http://localhost:3000/api/time-entries',
    'http://localhost:3000/api/time-entries'
  ]);
  assert.deepEqual(fetchCalls.map(call => [call.body.start, call.body.end]), [
    [first.start, first.end],
    [second.start, second.end]
  ]);
  assert.deepEqual(fetchCalls.map(call => call.body.activities), [[first], [second]]);
  assert.equal(context.state.selectedActivities.size, 0);
});

test('bulk activity assignment saves summary-model rows with selected block bounds and displayed duration', async () => {
  const { dom, context, fetchCalls } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const assignmentStart = dateStart + 13 * 60 * 60 * 1000;
  const assignmentEnd = dateStart + (13 * 60 + 21) * 60 * 1000;
  const first = {
    start: assignmentStart,
    end: dateStart + (13 * 60 + 2) * 60 * 1000,
    duration: 2 * 60 * 1000,
    app: 'Codex',
    title: 'Codex'
  };
  const second = {
    start: dateStart + (13 * 60 + 15) * 60 * 1000,
    end: dateStart + (13 * 60 + 21) * 60 * 1000,
    duration: 6 * 60 * 1000,
    app: 'Codex',
    title: 'Codex'
  };
  const summarized = {
    start: first.start,
    end: second.end,
    duration: first.duration + second.duration,
    app: 'Codex',
    title: 'Codex',
    assignmentStart,
    assignmentEnd,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayZoom: 5,
    sources: [first, second]
  };

  context.window.isBulkAllocation = true;
  dom.elModalStart.value = '13:00';
  dom.elModalEnd.value = '13:21';
  dom.elModalDescription.value = '';
  dom.elModalProjectSelect.value = 'project-1';
  dom.elModalTaskSelect.value = '';
  dom.elModalBillable.checked = false;
  context.state.currentModalActivities = [summarized];

  await dom.elModalBtnSave.click();

  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(fetchCalls.map(call => [call.body.start, call.body.end]), [
    [assignmentStart, assignmentEnd]
  ]);
  assert.equal(fetchCalls[0].body.activities.length, 1);
  assert.equal(fetchCalls[0].body.activities[0].app, 'Codex');
  assert.equal(fetchCalls[0].body.activities[0].sources, undefined);
  assert.equal(fetchCalls[0].body.activities[0].duration, first.duration + second.duration);
  assert.equal(fetchCalls[0].body.activities[0].assignedDurationMs, first.duration + second.duration);
  assert.equal(fetchCalls[0].body.activities[0].assignmentStart, assignmentStart);
  assert.equal(fetchCalls[0].body.activities[0].assignmentEnd, assignmentEnd);
  assert.equal(fetchCalls[0].body.activities[0].assignmentSource, 'activity-stream');
  assert.equal(fetchCalls[0].body.activities[0].assignmentModel, 'activity-stream-summary');
  assert.equal(fetchCalls[0].body.activities[0].assignmentDisplayZoom, 5);
});

test('saving an edited assigned activity group consolidates grouped entries into one row', async () => {
  const { dom, context, fetchCalls } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);

  context.window.editingTimeEntryId = 'entry-1';
  context.window.editingTimeEntryGroupIds = ['entry-1', 'entry-2'];
  context.state.currentModalActivities = [{
    app: 'Codex',
    title: 'Codex',
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + (9 * 60 + 20) * 60 * 1000,
    duration: 12 * 60 * 1000,
    assignedDurationMs: 12 * 60 * 1000,
    assignmentSource: 'activity-stream'
  }];
  dom.elModalStart.value = '09:00';
  dom.elModalEnd.value = '09:20';
  dom.elModalDescription.value = '';
  dom.elModalProjectSelect.value = 'project-1';
  dom.elModalTaskSelect.value = 'task-1';
  dom.elModalBillable.checked = false;

  await dom.elModalBtnSave.click();

  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].url, 'http://localhost:3000/api/time-entries/entry-1');
  assert.equal(fetchCalls[0].options.method, 'PUT');
  assert.equal(fetchCalls[0].body.start, dateStart + 9 * 60 * 60 * 1000);
  assert.equal(fetchCalls[0].body.end, dateStart + (9 * 60 + 20) * 60 * 1000);
  assert.equal(fetchCalls[0].body.activities[0].assignedDurationMs, 12 * 60 * 1000);
  assert.equal(fetchCalls[1].url, 'http://localhost:3000/api/time-entries/entry-2');
  assert.equal(fetchCalls[1].options.method, 'DELETE');
});

test('standard activity assignment modal saves selected summary rows without re-deriving durations', async () => {
  const { dom, context, fetchCalls } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const assignmentStart = dateStart + (7 * 60 + 30) * 60 * 1000;
  const assignmentEnd = dateStart + 8 * 60 * 60 * 1000;

  context.window.isBulkAllocation = false;
  dom.elModalStart.value = '07:30';
  dom.elModalEnd.value = '08:00';
  dom.elModalDescription.value = '';
  dom.elModalProjectSelect.value = 'project-1';
  dom.elModalTaskSelect.value = '';
  dom.elModalBillable.checked = false;
  context.state.currentModalActivities = [
    {
      app: 'Brave Browser',
      title: 'Oriel Local Time Tracker',
      start: assignmentStart,
      end: assignmentEnd,
      duration: 2 * 60 * 1000,
      assignedDurationMs: 2 * 60 * 1000,
      assignmentStart,
      assignmentEnd,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 10
    },
    {
      app: 'Codex',
      title: 'Codex',
      start: assignmentStart,
      end: assignmentEnd,
      duration: 18 * 60 * 1000,
      assignedDurationMs: 18 * 60 * 1000,
      assignmentStart,
      assignmentEnd,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 10
    }
  ];

  await dom.elModalBtnSave.click();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.start, assignmentStart);
  assert.equal(fetchCalls[0].body.end, assignmentEnd);
  assert.equal(fetchCalls[0].body.activities.length, 2);
  assert.equal(fetchCalls[0].body.activities.reduce((total, activity) => total + activity.assignedDurationMs, 0), 20 * 60 * 1000);
  assert.equal(fetchCalls[0].body.activities.find(activity => activity.app === 'Codex').assignedDurationMs, 18 * 60 * 1000);
  assert.deepEqual(fetchCalls[0].body.activities.map(activity => activity.assignmentModel), [
    'activity-stream-summary',
    'activity-stream-summary'
  ]);
});

test('saving edited auto-assigned activity candidates strips auto-rule metadata', async () => {
  const { dom, context, fetchCalls } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const rangeStart = dateStart + (21 * 60 + 40) * 60 * 1000;
  const rangeEnd = dateStart + (22 * 60 + 10) * 60 * 1000;

  context.window.isBulkAllocation = false;
  context.window.editingTimeEntryId = 'entry-1';
  context.state.currentModalDurationMode = 'selected-activities';
  dom.elModalStart.value = '21:40';
  dom.elModalEnd.value = '22:10';
  dom.elModalDescription.value = '';
  dom.elModalProjectSelect.value = 'project-1';
  dom.elModalTaskSelect.value = '';
  dom.elModalBillable.checked = false;
  context.state.currentModalActivities = [
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template',
      bundleId: 'com.figma.Desktop',
      appPath: '/Applications/Figma.app',
      start: rangeStart,
      end: rangeEnd,
      duration: 14 * 60 * 1000,
      assignedDurationMs: 14 * 60 * 1000,
      assignmentStart: rangeStart,
      assignmentEnd: rangeEnd,
      assignmentSource: 'activity-stream',
      assignmentModel: 'auto-assigned-capture',
      autoAssigned: true,
      autoAssignmentRuleId: 'rule-1'
    },
    {
      app: 'Codex',
      title: 'Codex',
      bundleId: 'com.openai.codex',
      appPath: '/Applications/Codex.app',
      start: rangeStart,
      end: rangeEnd,
      duration: 60 * 1000,
      assignedDurationMs: 60 * 1000,
      assignmentStart: rangeStart,
      assignmentEnd: rangeEnd,
      assignmentSource: 'activity-stream',
      assignmentModel: 'auto-assigned-capture',
      autoAssigned: true,
      autoAssignmentRuleId: 'rule-1'
    }
  ];

  await dom.elModalBtnSave.click();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'http://localhost:3000/api/time-entries/entry-1');
  assert.deepEqual(fetchCalls[0].body.activities.map(activity => activity.assignedDurationMs), [
    14 * 60 * 1000,
    60 * 1000
  ]);
  assert.deepEqual(fetchCalls[0].body.activities.map(activity => activity.assignmentModel), [
    'activity-stream-summary',
    'activity-stream-summary'
  ]);
  assert.deepEqual(fetchCalls[0].body.activities.map(activity => activity.autoAssigned), [undefined, undefined]);
  assert.deepEqual(fetchCalls[0].body.activities.map(activity => activity.autoAssignmentRuleId), [undefined, undefined]);
});

test('activity-backed drag-created entry saves selected normal activity durations', async () => {
  const { dom, context, fetchCalls } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + (11 * 60 + 30) * 60 * 1000;
  const end = dateStart + 14 * 60 * 60 * 1000;
  const youtube = {
    app: 'Brave Browser',
    title: 'youtube.com',
    url: 'https://youtube.com/',
    start,
    end: start + 10 * 60 * 1000,
    duration: 10 * 60 * 1000
  };
  const news = {
    app: 'Brave Browser',
    title: 'nu.nl',
    url: 'https://nu.nl/',
    start: start + 30 * 60 * 1000,
    end: start + 32 * 60 * 1000,
    duration: 2 * 60 * 1000
  };

  context.window.isBulkAllocation = false;
  context.state.currentModalDurationMode = 'selected-activities';
  dom.elModalStart.value = '11:30';
  dom.elModalEnd.value = '14:00';
  dom.elModalDescription.value = '';
  dom.elModalProjectSelect.value = 'project-1';
  dom.elModalTaskSelect.value = '';
  dom.elModalBillable.checked = false;
  context.state.currentModalActivities = [youtube, news];

  await dom.elModalBtnSave.click();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.start, start);
  assert.equal(fetchCalls[0].body.end, end);
  assert.deepEqual(fetchCalls[0].body.activities.map(activity => activity.title), ['youtube.com', 'nu.nl']);
  assert.deepEqual(fetchCalls[0].body.activities.map(activity => activity.assignedDurationMs), [
    10 * 60 * 1000,
    2 * 60 * 1000
  ]);
});

test('manual drag-created entry without visible activities saves the selected range unchanged', async () => {
  const { dom, context, fetchCalls } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + (11 * 60 + 30) * 60 * 1000;
  const end = dateStart + 14 * 60 * 60 * 1000;

  context.window.isBulkAllocation = false;
  context.state.currentModalDurationMode = 'range';
  dom.elModalStart.value = '11:30';
  dom.elModalEnd.value = '14:00';
  dom.elModalDescription.value = '';
  dom.elModalProjectSelect.value = 'project-1';
  dom.elModalTaskSelect.value = '';
  dom.elModalBillable.checked = false;
  context.state.currentModalActivities = [];

  await dom.elModalBtnSave.click();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.start, start);
  assert.equal(fetchCalls[0].body.end, end);
  assert.deepEqual(fetchCalls[0].body.activities, []);
});

test('activity-backed drag-created entry with no selected activities does not save a range fallback', async () => {
  const { dom, context, fetchCalls } = loadMainControlsContext();

  context.window.isBulkAllocation = false;
  context.state.currentModalDurationMode = 'selected-activities';
  dom.elModalStart.value = '11:30';
  dom.elModalEnd.value = '14:00';
  dom.elModalDescription.value = '';
  dom.elModalProjectSelect.value = 'project-1';
  dom.elModalTaskSelect.value = '';
  dom.elModalBillable.checked = false;
  context.state.currentModalActivities = [];

  await dom.elModalBtnSave.click();

  assert.equal(fetchCalls.length, 0);
  assert.equal(context.lastAlert, 'Select at least one recorded activity to save this entry.');
});

test('selected activity assignment only passes overlaps matching the selected block identity', async () => {
  const { dom, context } = loadMainControlsContext();
  const codexSummary = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    duration: 2 * 60 * 1000,
    start: 1000,
    end: 121000
  };
  const shottrSummary = {
    app: 'Shottr',
    title: 'Shottr',
    bundleId: 'cc.ffitch.shottr',
    duration: 60 * 1000,
    start: 121000,
    end: 181000
  };
  const selectedBlock = {
    dataset: {
      startCell: '10',
      span: '2',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      overlaps: encodeURIComponent(JSON.stringify([codexSummary, shottrSummary]))
    }
  };
  let modalArgs = null;

  dom.elItemsMemoryAid.querySelectorAll = selector => (
    selector === '.activity-block.selected' ? [selectedBlock] : []
  );
  context.getActivityBlockData = block => ({
    app: block.dataset.app,
    title: block.dataset.title,
    url: block.dataset.url,
    appPath: block.dataset.appPath,
    bundleId: block.dataset.bundleId
  });
  context.getActivitySimilarityKey = activity => `${activity.app || ''}|${activity.bundleId || ''}`;
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };

  await dom.elBtnAssignSelected.click();

  assert.equal(modalArgs[5], true);
  assert.deepEqual(Array.from(modalArgs[6], activity => activity.app), ['Codex']);
});

test('selected similar mixed-row assignment saves only the matched secondary activity', async () => {
  const { dom, context } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hours, minutes) => dateStart + (hours * 60 + minutes) * 60 * 1000;
  const braveSummary = {
    app: 'Brave Browser',
    title: 'Brave Browser',
    bundleId: 'com.brave.Browser',
    appPath: '/Applications/Brave Browser.app',
    start: at(18, 30),
    end: at(18, 46),
    duration: 16 * 60 * 1000
  };
  const codexSummary = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    appPath: '/Applications/Codex.app',
    start: at(18, 30),
    end: at(18, 32),
    duration: 2 * 60 * 1000
  };
  const selectedBlock = {
    dataset: {
      startCell: String(18 * 2 + 1),
      span: '1',
      app: 'Brave Browser',
      title: 'Brave Browser',
      url: '',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      selectedSimilarityKeys: encodeURIComponent(JSON.stringify(['codex'])),
      overlaps: encodeURIComponent(JSON.stringify([braveSummary, codexSummary]))
    }
  };
  let modalArgs = null;

  context.state.zoom = 30;
  dom.elItemsMemoryAid.querySelectorAll = selector => (
    selector === '.activity-block.selected' ? [selectedBlock] : []
  );
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };

  await dom.elBtnAssignSelected.click();

  assert.equal(modalArgs[5], true);
  assert.equal(modalArgs[6].length, 1);
  assert.equal(modalArgs[6][0].app, 'Codex');
  assert.equal(modalArgs[6][0].start, at(18, 30));
  assert.equal(modalArgs[6][0].end, at(19, 0));
  assert.equal(modalArgs[6][0].assignmentStart, at(18, 30));
  assert.equal(modalArgs[6][0].assignmentEnd, at(19, 0));
  assert.equal(modalArgs[6][0].assignedDurationMs, 2 * 60 * 1000);
  assert.equal(modalArgs[6][0].assignmentModel, 'activity-stream-summary');
});

test('selected activity assignment excludes secondary summaries from the same similar app block', async () => {
  const { dom, context } = loadMainControlsContext();
  const primaryCodex = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    appPath: '/Applications/Codex.app',
    duration: 45 * 60 * 1000,
    start: 1000,
    end: 46 * 60 * 1000
  };
  const secondaryCodex = {
    app: 'Codex',
    title: 'Codex',
    duration: 60 * 1000,
    start: 13 * 60 * 1000,
    end: 14 * 60 * 1000
  };
  const selectedBlock = {
    dataset: {
      startCell: '10',
      span: '9',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      overlaps: encodeURIComponent(JSON.stringify([primaryCodex, secondaryCodex]))
    }
  };
  let modalArgs = null;

  dom.elItemsMemoryAid.querySelectorAll = selector => (
    selector === '.activity-block.selected' ? [selectedBlock] : []
  );
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };

  await dom.elBtnAssignSelected.click();

  assert.equal(modalArgs[5], true);
  assert.equal(modalArgs[6].length, 1);
  assert.equal(modalArgs[6][0].bundleId, 'com.openai.codex');
});

test('selected activity assignment uses selected Activity Stream row bounds when timeline state is unavailable', async () => {
  const { dom, context } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hours, minutes, seconds = 0) => dateStart + ((hours * 60 + minutes) * 60 + seconds) * 1000;
  const codexSummary = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    appPath: '/Applications/Codex.app',
    start: at(13, 30, 30),
    end: at(13, 41, 0),
    duration: 7 * 60 * 1000,
    sources: [
      { app: 'Codex', title: 'Codex', bundleId: 'com.openai.codex', appPath: '/Applications/Codex.app', start: at(13, 30, 30), end: at(13, 30, 45), duration: 15 * 1000 },
      { app: 'Codex', title: 'Codex', bundleId: 'com.openai.codex', appPath: '/Applications/Codex.app', start: at(13, 32, 0), end: at(13, 36, 0), duration: 4 * 60 * 1000 },
      { app: 'Codex', title: 'Codex', bundleId: 'com.openai.codex', appPath: '/Applications/Codex.app', start: at(13, 39, 0), end: at(13, 41, 0), duration: 2 * 60 * 1000 }
    ]
  };
  const orielSummary = {
    app: 'Brave Browser',
    title: 'Oriel Local Time Tracker',
    url: 'http://localhost:3000/',
    start: at(13, 30, 0),
    end: at(13, 32, 0),
    duration: 2 * 60 * 1000,
    sources: [
      { app: 'Brave Browser', title: 'Oriel Local Time Tracker', url: 'http://localhost:3000/', start: at(13, 30, 0), end: at(13, 32, 0), duration: 2 * 60 * 1000 }
    ]
  };
  const selectedBlock = {
    dataset: {
      startCell: String(13 * 12 + 6),
      span: '3',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      overlaps: encodeURIComponent(JSON.stringify([codexSummary, orielSummary]))
    }
  };
  let modalArgs = null;

  context.state.zoom = 5;
  dom.elItemsMemoryAid.querySelectorAll = selector => (
    selector === '.activity-block.selected' ? [selectedBlock] : []
  );
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };

  await dom.elBtnAssignSelected.click();

  assert.equal(modalArgs[6].length, 1);
  assert.equal(modalArgs[6][0].start, at(13, 30));
  assert.equal(modalArgs[6][0].end, at(13, 45));
  assert.equal(modalArgs[6][0].assignmentStart, at(13, 30));
  assert.equal(modalArgs[6][0].assignmentEnd, at(13, 45));
  assert.equal(modalArgs[6][0].assignedDurationMs, 7 * 60 * 1000);
  assert.equal(modalArgs[6][0].assignmentSource, 'activity-stream');
  assert.equal(modalArgs[6][0].assignmentModel, 'activity-stream-summary');
  assert.equal(modalArgs[6][0].assignmentDisplayZoom, 5);
});

test('selected activity assignment keeps coarse selected blocks as one stable summary assignment', async () => {
  const { dom, context } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hours, minutes) => dateStart + (hours * 60 + minutes) * 60 * 1000;
  const firstRun = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    appPath: '/Applications/Codex.app',
    start: at(17, 8),
    end: at(17, 9),
    duration: 60 * 1000
  };
  const secondRun = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    appPath: '/Applications/Codex.app',
    start: at(17, 15),
    end: at(17, 17),
    duration: 2 * 60 * 1000
  };
  const selectedSummary = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    appPath: '/Applications/Codex.app',
    start: firstRun.start,
    end: secondRun.end,
    duration: firstRun.duration + secondRun.duration,
    sources: [firstRun, secondRun]
  };
  const selectedBlock = {
    dataset: {
      startCell: String(17 * 4),
      span: '2',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      overlaps: encodeURIComponent(JSON.stringify([selectedSummary]))
    }
  };
  let modalArgs = null;

  context.state.zoom = 15;
  context.state.activities = [firstRun, secondRun];
  context.state.timelineActivities = [firstRun, secondRun];
  dom.elItemsMemoryAid.querySelectorAll = selector => (
    selector === '.activity-block.selected' ? [selectedBlock] : []
  );
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };

  await dom.elBtnAssignSelected.click();

  assert.equal(modalArgs[5], true);
  assert.equal(modalArgs[6].length, 1);
  assert.equal(modalArgs[6][0].start, at(17, 0));
  assert.equal(modalArgs[6][0].end, at(17, 30));
  assert.equal(modalArgs[6][0].assignedDurationMs, 3 * 60 * 1000);
  assert.equal(modalArgs[6][0].assignmentModel, 'activity-stream-summary');
  assert.equal(modalArgs[6][0].assignmentDisplayZoom, 15);
});

test('selected activity assignment stores the selected summary duration without source-run fanout', async () => {
  const { dom, context } = loadMainControlsContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hours, minutes, seconds = 0) => dateStart + ((hours * 60 + minutes) * 60 + seconds) * 1000;
  const visibleEarly = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    appPath: '/Applications/Codex.app',
    start: at(13, 32, 13),
    end: at(13, 36, 8)
  };
  const hiddenOnly = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    appPath: '/Applications/Codex.app',
    start: at(13, 37, 58),
    end: at(13, 38, 43)
  };
  const visibleLate = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    appPath: '/Applications/Codex.app',
    start: at(13, 39, 31),
    end: at(13, 53, 42)
  };
  const selectedSummary = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    appPath: '/Applications/Codex.app',
    start: at(13, 32, 13),
    end: at(13, 53, 42),
    duration: (visibleEarly.end - visibleEarly.start) + (hiddenOnly.end - hiddenOnly.start) + (visibleLate.end - visibleLate.start),
    sources: [
      { ...visibleEarly, duration: visibleEarly.end - visibleEarly.start },
      { ...hiddenOnly, duration: hiddenOnly.end - hiddenOnly.start },
      { ...visibleLate, duration: visibleLate.end - visibleLate.start }
    ]
  };
  const selectedBlock = {
    dataset: {
      startCell: String(13 * 12 + 6),
      span: '5',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      overlaps: encodeURIComponent(JSON.stringify([selectedSummary]))
    }
  };
  let modalArgs = null;

  context.state.zoom = 5;
  context.state.timelineActivities = [visibleEarly, hiddenOnly, visibleLate];
  context.state.activities = [visibleEarly, visibleLate];
  dom.elItemsMemoryAid.querySelectorAll = selector => (
    selector === '.activity-block.selected' ? [selectedBlock] : []
  );
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };

  await dom.elBtnAssignSelected.click();

  assert.equal(modalArgs[6].length, 1);
  assert.equal(modalArgs[6][0].start, at(13, 30));
  assert.equal(modalArgs[6][0].end, at(13, 55));
  assert.equal(modalArgs[6][0].assignedDurationMs, selectedSummary.duration);
  assert.equal(modalArgs[6][0].assignmentSource, 'activity-stream');
  assert.equal(modalArgs[6][0].assignmentModel, 'activity-stream-summary');
});
