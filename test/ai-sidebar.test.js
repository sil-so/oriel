import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function loadAiSidebarContext() {
  const context = {
    window: {},
    state: {
      currentDate: new Date(2026, 4, 25),
      projects: [
        {
          id: 'project-client',
          name: 'Client',
          billable: true,
          tasks: [{ id: 'task-build', name: 'Build', archived: false }]
        },
        { id: 'project-admin', name: 'Admin', billable: false, tasks: [] }
      ],
      timelineActivities: [
        {
          start: new Date(2026, 4, 25, 9, 0).getTime(),
          end: new Date(2026, 4, 25, 9, 30).getTime(),
          app: 'Brave Browser',
          title: 'Client Portal - Brave Browser',
          url: 'https://client.example.com/projects/secret?token=abc123',
          bundleId: 'com.brave.Browser',
          appPath: '/Applications/Brave Browser.app'
        },
        {
          start: new Date(2026, 4, 25, 10, 0).getTime(),
          end: new Date(2026, 4, 25, 10, 20).getTime(),
          app: 'Xcode',
          title: 'OrielApp.swift',
          url: '',
          bundleId: 'com.apple.dt.Xcode',
          appPath: '/Applications/Xcode.app'
        }
      ],
      activities: [],
      timeEntries: [
        {
          id: 'entry-1',
          start: new Date(2026, 4, 25, 10, 0).getTime(),
          end: new Date(2026, 4, 25, 10, 15).getTime(),
          projectId: 'project-client',
          taskId: 'task-build',
          description: 'Implementation',
          billable: true,
          activities: [{ duration: 15 * 60 * 1000 }]
        }
      ],
      settings: {
        aiProvider: '',
        aiOpenAIModel: 'gpt-5.2',
        aiGoogleModel: 'gemini-3.5-flash',
        aiAnthropicModel: 'claude-sonnet-4-20250514',
        aiOpenRouterModel: 'google/gemini-3.1-flash-lite',
      aiScreenshotProvider: '',
      aiScreenshotSummariesEnabled: false,
      aiScreenshotFrequencyPreset: 'balanced',
      aiScreenshotDailyCap: 100,
      aiScreenshotTimeoutSeconds: 20,
      aiScreenshotModelMode: 'askAI',
      aiScreenshotSensitiveApps: [
        '1password',
        'bitwarden',
        'dashlane',
        'keychain access',
        'lastpass',
        'proton pass',
        'keeper password',
        'authenticator'
      ]
      }
    },
    localStorage: {
      values: new Map(),
      getItem(key) {
        return this.values.get(key) || null;
      },
      setItem(key, value) {
        this.values.set(key, String(value));
      }
    },
    getFormattedDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    },
    cleanTitle(title) {
      return String(title || '').replace(/\s+-\s+Brave Browser$/, '');
    },
    setTimeout,
    clearTimeout,
    console: {
      log: console.log,
      warn: console.warn,
      error: console.error
    },
    URL,
    URLSearchParams
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/utils.js', 'utf8'), context);
  context.cleanTitle = title => String(title || '').replace(/\s+-\s+Brave Browser$/, '');
  vm.runInContext(fs.readFileSync('js/ai-settings.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/ai-sidebar.js', 'utf8'), context);
  return context;
}

function fakeElement(options = {}) {
  const classes = new Set();
  const attributes = {};
  if (options.className) {
    String(options.className).split(/\s+/).filter(Boolean).forEach(name => classes.add(name));
  }
  const listeners = new Map();
  const element = {
    id: options.id || '',
    dataset: { ...(options.dataset || {}) },
    value: options.value || '',
    placeholder: options.placeholder || '',
    disabled: false,
    focused: false,
    _innerHTML: '',
    classList: {
      add(value) {
        classes.add(value);
      },
      remove(value) {
        classes.delete(value);
      },
      toggle(value, force) {
        if (force === undefined ? !classes.has(value) : force) {
          classes.add(value);
          return true;
        }
        classes.delete(value);
        return false;
      },
      contains(value) {
        return classes.has(value);
      }
    },
    textContent: '',
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    click(event = {}) {
      return listeners.get('click')?.({
        target: element,
        stopPropagation() {},
        preventDefault() {},
        ...event
      });
    },
    dispatch(type, event = {}) {
      return listeners.get(type)?.({
        target: element,
        stopPropagation() {},
        preventDefault() {},
        ...event
      });
    },
    focus() {
      element.focused = true;
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete attributes[name];
    },
    getAttribute(name) {
      return attributes[name] || null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector !== '[data-ai-model]') return [];
      return Array.from(element._innerHTML.matchAll(/data-ai-model="([^"]+)"/g), match => (
        fakeElement({ dataset: { aiModel: match[1] } })
      ));
    },
    closest() {
      return null;
    }
  };
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return element._innerHTML;
    },
    set(value) {
      element._innerHTML = String(value);
    }
  });
  return element;
}

function createAiSettingsDom({
  keyStatus = { openai: true, google: false, anthropic: false, openrouter: false },
  modelListResult = null,
  screenshotTestResult = null,
  confirmResult = true,
  customConfirm = null,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  const context = loadAiSidebarContext();
  context.state.settings.aiProvider = 'openai';
  context.setTimeout = setTimeoutImpl;
  context.clearTimeout = clearTimeoutImpl;

  const elements = {};
  const make = (id, options = {}) => {
    elements[id] = fakeElement({ id, ...options });
    return elements[id];
  };

  [
    'sidebar-tab-work-times',
    'sidebar-tab-ai',
    'work-times-panel',
    'ai-sidebar-panel',
    'ai-settings-button',
    'ai-unconfigured-status',
    'ai-new-chat-button',
    'ai-chat-messages',
    'settings-ai-key-status',
    'settings-ai-feedback',
    'settings-ai-api-key-input',
    'settings-ai-key-edit-button',
    'settings-ai-key-save-button',
    'settings-ai-key-save-label',
    'settings-ai-key-cancel-button',
    'settings-ai-key-delete-button',
    'settings-ai-ask-provider',
    'settings-ai-model-picker-button',
    'settings-ai-model-picker-label',
    'settings-ai-model-picker-menu',
    'settings-ai-model-search-input',
    'settings-ai-model-option-list',
    'settings-ai-model-refresh-button',
    'settings-ai-model-refresh-label',
    'settings-ai-model-refresh-confirm',
    'settings-ai-model-refresh-confirm-text',
    'settings-ai-model-refresh-confirm-button',
    'settings-ai-model-refresh-cancel-button',
    'settings-ai-model-refresh-meta',
    'settings-ai-screenshot-enabled',
    'settings-ai-screenshot-provider',
    'settings-ai-screenshot-frequency',
    'settings-ai-screenshot-daily-cap',
    'settings-ai-screenshot-timeout',
    'settings-ai-screenshot-model-mode',
    'settings-ai-screenshot-model-override',
    'settings-ai-screenshot-model-input',
    'settings-ai-screenshot-model-picker-button',
    'settings-ai-screenshot-model-picker-label',
    'settings-ai-screenshot-model-picker-menu',
    'settings-ai-screenshot-model-search-input',
    'settings-ai-screenshot-model-option-list',
    'settings-ai-screenshot-model-refresh-button',
    'settings-ai-screenshot-model-refresh-label',
    'settings-ai-screenshot-model-refresh-confirm',
    'settings-ai-screenshot-model-refresh-confirm-text',
    'settings-ai-screenshot-model-refresh-confirm-button',
    'settings-ai-screenshot-model-refresh-cancel-button',
    'settings-ai-screenshot-model-refresh-meta',
    'settings-ai-screenshot-sensitive-input',
    'settings-ai-screenshot-sensitive-add-button',
    'settings-ai-screenshot-sensitive-list',
    'settings-ai-screenshot-test-button',
    'settings-ai-screenshot-test-feedback',
    'settings-ai-screenshot-open-screen-recording-button',
    'ai-loading-spinner',
    'ai-chat-input',
    'ai-send-button',
    'ai-status'
  ].forEach(id => make(id));

  const aliases = {
    'ai-settings-key-status': 'settings-ai-key-status',
    'ai-settings-feedback': 'settings-ai-feedback',
    'ai-api-key-input': 'settings-ai-api-key-input',
    'ai-key-edit-button': 'settings-ai-key-edit-button',
    'ai-key-save-button': 'settings-ai-key-save-button',
    'ai-key-save-label': 'settings-ai-key-save-label',
    'ai-key-cancel-button': 'settings-ai-key-cancel-button',
    'ai-key-delete-button': 'settings-ai-key-delete-button',
    'ai-model-picker-button': 'settings-ai-model-picker-button',
    'ai-model-picker-label': 'settings-ai-model-picker-label',
    'ai-model-picker-menu': 'settings-ai-model-picker-menu',
    'ai-model-search-input': 'settings-ai-model-search-input',
    'ai-model-option-list': 'settings-ai-model-option-list',
    'ai-model-refresh-button': 'settings-ai-model-refresh-button',
    'ai-model-refresh-label': 'settings-ai-model-refresh-label',
    'ai-model-refresh-confirm': 'settings-ai-model-refresh-confirm',
    'ai-model-refresh-confirm-text': 'settings-ai-model-refresh-confirm-text',
    'ai-model-refresh-confirm-button': 'settings-ai-model-refresh-confirm-button',
    'ai-model-refresh-cancel-button': 'settings-ai-model-refresh-cancel-button',
    'ai-model-refresh-meta': 'settings-ai-model-refresh-meta'
  };
  Object.entries(aliases).forEach(([oldId, newId]) => {
    elements[oldId] = elements[newId];
  });

  elements['settings-ai-model-picker-menu'].classList.add('hidden');
  elements['settings-ai-model-refresh-confirm'].classList.add('hidden');
  elements['settings-ai-screenshot-model-picker-menu'].classList.add('hidden');
  elements['settings-ai-screenshot-model-refresh-confirm'].classList.add('hidden');
  elements['settings-ai-screenshot-open-screen-recording-button'].classList.add('hidden');
  elements['ai-loading-spinner'].classList.add('hidden');
  const saveLabel = elements['settings-ai-key-save-label'];
  elements['settings-ai-key-save-button'].querySelector = selector => (selector === 'span' ? saveLabel : null);
  const refreshIcon = fakeElement();
  elements['settings-ai-model-refresh-button'].querySelector = selector => {
    if (selector === 'i') return refreshIcon;
    if (selector === 'span') return elements['settings-ai-model-refresh-label'];
    return null;
  };
  elements['settings-ai-model-refresh-button']._icon = refreshIcon;
  const screenshotRefreshIcon = fakeElement();
  elements['settings-ai-screenshot-model-refresh-button'].querySelector = selector => {
    if (selector === 'i') return screenshotRefreshIcon;
    if (selector === 'span') return elements['settings-ai-screenshot-model-refresh-label'];
    return null;
  };
  elements['settings-ai-screenshot-model-refresh-button']._icon = screenshotRefreshIcon;
  const sendLabel = fakeElement();
  elements['ai-send-button'].querySelector = selector => (selector === 'span' ? sendLabel : null);

  const providerCards = {};
  ['openai', 'google', 'anthropic', 'openrouter'].forEach(provider => {
    providerCards[provider] = fakeElement({ dataset: { settingsAiProvider: provider } });
    const keyState = make(`settings-ai-provider-${provider}-key-state`);
    elements[`ai-provider-${provider}-key-state`] = keyState;
  });

  const requests = [];
  context.confirm = () => confirmResult;
  if (customConfirm) context.showCustomConfirm = customConfirm;
  context.document = {
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector(selector) {
      const providerMatch = selector.match(/^\[data-settings-ai-provider="([^"]+)"\]$/);
      if (providerMatch) return providerCards[providerMatch[1]] || null;
      if (selector === '.ai-composer') return fakeElement();
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-settings-ai-provider]') return Object.values(providerCards);
      if (selector === '[data-ai-prompt]') return [];
      return [];
    },
    addEventListener() {}
  };
  context.OrielData = {
    isNative: true,
    async request(operation, payload) {
      requests.push({ operation, payload });
      if (operation === 'ai.keys.status') return keyStatus;
      if (operation === 'ai.settings.update') {
        Object.assign(context.state.settings, payload);
        return context.state.settings;
      }
      if (operation === 'ai.models.list') {
        return typeof modelListResult === 'function' ? modelListResult(payload) : modelListResult;
      }
      if (operation === 'ai.keys.delete') {
        keyStatus[payload.provider] = false;
        return { ...keyStatus };
      }
      if (operation === 'ai.keys.save') {
        keyStatus[payload.provider] = true;
        return { ...keyStatus };
      }
      if (operation === 'ai.screenshotSummary.test') {
        if (typeof screenshotTestResult === 'function') return screenshotTestResult(payload);
        if (screenshotTestResult instanceof Error) throw screenshotTestResult;
        return screenshotTestResult || { tested: true };
      }
      if (operation === 'system.openScreenRecordingSettings') {
        return { opened: true };
      }
      return {};
    }
  };

  return { context, elements, providerCards, requests };
}

test('AI chat state is scoped by day and resets to one fresh chat', () => {
  const context = loadAiSidebarContext();
  const chats = context.createAiChatState({ maxPromptMessages: 4 });

  const first = chats.ensureChatForDate('2026-05-25');
  chats.appendMessage('2026-05-25', first.id, { role: 'user', content: 'What did I do?' });
  chats.appendMessage('2026-05-25', first.id, { role: 'assistant', content: 'You worked on Client.' });

  const secondDay = chats.ensureChatForDate('2026-05-26');
  assert.notEqual(secondDay.id, first.id);
  assert.equal(chats.getChatsForDate('2026-05-26').length, 1);
  assert.equal(chats.getChatsForDate('2026-05-25')[0].messages.length, 2);

  const fresh = chats.resetChatForDate('2026-05-25');
  assert.notEqual(fresh.id, first.id);
  assert.equal(chats.getActiveChat('2026-05-25').id, fresh.id);
  assert.equal(chats.getChatsForDate('2026-05-25').length, 1);
  assert.equal(chats.getChatsForDate('2026-05-25')[0].messages.length, 0);
  assert.equal(chats.getChatsForDate('2026-05-26').length, 1);

  chats.appendMessage('2026-05-25', fresh.id, { role: 'user', content: 'Start over' });
  const aliasFresh = chats.startNewChat('2026-05-25');
  assert.notEqual(aliasFresh.id, fresh.id);
  assert.equal(chats.getChatsForDate('2026-05-25').length, 1);
  assert.equal(chats.getChatsForDate('2026-05-25')[0].messages.length, 0);
});

test('AI chat payload only sends bounded recent messages', () => {
  const context = loadAiSidebarContext();
  const chats = context.createAiChatState({ maxPromptMessages: 3 });
  const chat = chats.ensureChatForDate('2026-05-25');

  ['one', 'two', 'three', 'four', 'five'].forEach(content => {
    chats.appendMessage('2026-05-25', chat.id, { role: 'user', content });
  });

  assert.deepEqual(
    Array.from(chats.getPromptMessages('2026-05-25', chat.id).map(message => message.content)),
    ['three', 'four', 'five']
  );
  assert.equal(chats.getChatsForDate('2026-05-25')[0].messages.length, 5);
});

test('Ask AI renders safe Markdown in assistant responses', async () => {
  const { context, elements } = createAiSettingsDom();
  const originalRequest = context.OrielData.request.bind(context.OrielData);
  context.OrielData.request = async (operation, payload) => {
    if (operation === 'ai.chat') {
      return {
        text: [
      'Based on the day:',
      '',
      '1. **Client Work**',
      '   - Review `github.com` activity',
      '',
      'Visit [Project](https://example.com) and *triage* it.'
        ].join('\n'),
        suggestions: []
      };
    }
    return originalRequest(operation, payload);
  };

  await context.initAiSidebar();
  elements['ai-chat-input'].value = 'Summarize this as markdown';
  await elements['ai-send-button'].click();

  const markup = elements['ai-chat-messages'].innerHTML;
  assert.match(markup, /<ol>/);
  assert.match(markup, /<strong>Client Work<\/strong>/);
  assert.match(markup, /<ul>/);
  assert.match(markup, /<code>github\.com<\/code>/);
  assert.match(markup, /<a href="https:\/\/example\.com"/);
  assert.match(markup, /<em>triage<\/em>/);
  assert.doesNotMatch(markup, /\*\*Client Work\*\*/);
  assert.doesNotMatch(markup, /javascript:/);
});

test('AI day context strips raw URLs, query strings, bundle IDs, and local paths', () => {
  const context = loadAiSidebarContext();
  const dayContext = context.buildAiDayContext('2026-05-25');

  assert.equal(dayContext.date, '2026-05-25');
  assert.equal(dayContext.activities[0].domain, 'client.example.com');
  assert.equal(dayContext.activities[0].title, 'Client Portal');
  assert.equal(dayContext.loggedEntries[0].projectName, 'Client');
  assert.equal(dayContext.loggedEntries[0].taskName, 'Build');

  const serialized = JSON.stringify(dayContext);
  assert.doesNotMatch(serialized, /token=abc123|\/projects\/secret|appPath|bundleId|Applications/);
});

test('AI day context totals use the full day even when detail arrays are bounded', () => {
  const context = loadAiSidebarContext();
  const base = new Date(2026, 4, 25, 0, 0).getTime();
  context.state.timelineActivities = Array.from({ length: 70 }, (_, index) => ({
    start: base + index * 2 * 60 * 1000,
    end: base + index * 2 * 60 * 1000 + 60 * 1000,
    app: 'Codex',
    title: `Codex work ${index}`,
    url: ''
  }));
  context.state.timeEntries = [];

  const dayContext = context.buildAiDayContext('2026-05-25');

  assert.equal(dayContext.totals.recordedMs, 70 * 60 * 1000);
  assert.equal(dayContext.totals.unloggedMs, 70 * 60 * 1000);
  assert.equal(dayContext.activities.length, 60);
  assert.equal(dayContext.metadata.activityCount, 70);
  assert.equal(dayContext.metadata.activitiesOmitted, 10);
  assert.equal(dayContext.metadata.unloggedRangesOmitted, 10);
});

test('AI day context unlogged total includes short fragments excluded from detail ranges', () => {
  const context = loadAiSidebarContext();
  const base = new Date(2026, 4, 25, 0, 0).getTime();
  context.state.timelineActivities = [
    {
      start: base,
      end: base + 30 * 1000,
      app: 'Codex',
      title: 'Codex',
      url: ''
    },
    {
      start: base + 60 * 1000,
      end: base + 105 * 1000,
      app: 'Oriel',
      title: 'Oriel',
      url: ''
    }
  ];
  context.state.timeEntries = [];

  const dayContext = context.buildAiDayContext('2026-05-25');

  assert.equal(dayContext.totals.recordedMs, 75 * 1000);
  assert.equal(dayContext.totals.unloggedMs, 75 * 1000);
  assert.equal(dayContext.totals.actionableUnloggedMs, 0);
  assert.equal(dayContext.totals.shortUnloggedMs, 75 * 1000);
  assert.equal(dayContext.unloggedRanges.length, 0);
  assert.equal(dayContext.metadata.unloggedFragmentCount, 2);
  assert.equal(dayContext.metadata.actionableUnloggedRangeCount, 0);
  assert.equal(dayContext.metadata.unloggedRangeDetailMinimumMs, 60 * 1000);
});

test('AI day context includes short auto-rule entries for logged ranges', () => {
  const context = loadAiSidebarContext();
  const base = new Date(2026, 4, 25, 9, 0).getTime();
  context.state.timelineActivities = [{
    start: base,
    end: base + 45 * 1000,
    app: 'Codex',
    title: 'Codex',
    url: ''
  }];
  context.state.timeEntries = [{
    id: 'entry-hidden-auto',
    start: base,
    end: base + 45 * 1000,
    projectId: 'project-client',
    createdBy: 'auto-rule',
    autoRuleId: 'rule-1',
    billable: false,
    activities: [{ assignedDurationMs: 45 * 1000, autoAssigned: true }]
  }];

  const dayContext = context.buildAiDayContext('2026-05-25');

  assert.equal(dayContext.totals.loggedMs, 45 * 1000);
  assert.equal(dayContext.loggedEntries.length, 1);
  assert.equal(dayContext.totals.unloggedMs, 0);
});

test('AI day context exposes sanitized local draft candidates', () => {
  const context = loadAiSidebarContext();
  const base = new Date(2026, 4, 25, 9, 0).getTime();
  context.state.timelineActivities = [
    {
      start: base,
      end: base + 10 * 60 * 1000,
      app: 'Codex',
      title: 'Codex',
      url: '',
      bundleId: 'com.openai.codex',
      appPath: '/Applications/Codex.app'
    },
    {
      start: base + 20 * 60 * 1000,
      end: base + 24 * 60 * 1000,
      app: 'Oriel',
      title: 'Oriel',
      url: ''
    },
    {
      start: base + 30 * 60 * 1000,
      end: base + 30 * 60 * 1000 + 30 * 1000,
      app: 'Music',
      title: 'Music',
      url: ''
    }
  ];
  context.state.timeEntries = [{
    id: 'entry-1',
    start: base + 3 * 60 * 1000,
    end: base + 5 * 60 * 1000,
    projectId: 'project-client',
    description: 'Already logged',
    billable: true
  }];

  const dayContext = context.buildAiDayContext('2026-05-25');

  assert.equal(dayContext.totals.unloggedMs, (12 * 60 * 1000) + 30 * 1000);
  assert.equal(dayContext.draftCandidates.length, 3);
  assert.deepEqual(Array.from(dayContext.draftCandidates, candidate => candidate.durationMs), [
    3 * 60 * 1000,
    5 * 60 * 1000,
    4 * 60 * 1000
  ]);
  assert.equal(dayContext.metadata.draftCandidateCount, 3);
  assert.equal(dayContext.metadata.draftCandidatesIncluded, 3);
  const serialized = JSON.stringify(dayContext.draftCandidates);
  assert.doesNotMatch(serialized, /Applications|bundleId|appPath|com\.openai\.codex/);
});

test('AI local draft candidates exclude obvious media and social distractions', () => {
  const context = loadAiSidebarContext();
  const base = new Date(2026, 4, 25, 9, 0).getTime();
  context.state.timelineActivities = [
    {
      start: base,
      end: base + 5 * 60 * 1000,
      app: 'Codex',
      title: 'Codex',
      url: ''
    },
    {
      start: base + 6 * 60 * 1000,
      end: base + 10 * 60 * 1000,
      app: 'Brave Browser',
      title: 'Client Portal - Brave Browser',
      url: 'https://client.example.com/work'
    },
    {
      start: base + 11 * 60 * 1000,
      end: base + 14 * 60 * 1000,
      app: 'Music',
      title: 'Music',
      url: ''
    },
    {
      start: base + 15 * 60 * 1000,
      end: base + 18 * 60 * 1000,
      app: 'Brave Browser',
      title: 'Maybe we were wrong - YouTube - Brave Browser',
      url: 'https://www.youtube.com/watch?v=abc123'
    },
    {
      start: base + 19 * 60 * 1000,
      end: base + 21 * 60 * 1000,
      app: 'Brave Browser',
      title: 'Facebook - Brave - Base',
      url: 'https://www.facebook.com/'
    }
  ];
  context.state.timeEntries = [];

  const dayContext = context.buildAiDayContext('2026-05-25');
  const activitySet = context.buildAiDraftActivitySet('2026-05-25');

  assert.equal(dayContext.totals.unloggedMs, 17 * 60 * 1000);
  assert.deepEqual(Array.from(dayContext.draftCandidates, candidate => candidate.description), [
    'Codex',
    'Client Portal'
  ]);
  assert.deepEqual(Array.from(activitySet.activities, activity => context.cleanTitle(activity.title)), [
    'Codex',
    'Client Portal'
  ]);
});

test('AI draft activity set keeps local snapshots for bulk modal review', () => {
  const context = loadAiSidebarContext();
  const base = new Date(2026, 4, 25, 9, 0).getTime();
  context.state.timelineActivities = [
    {
      start: base,
      end: base + 10 * 60 * 1000,
      app: 'Codex',
      title: 'Codex',
      url: '',
      bundleId: 'com.openai.codex',
      appPath: '/Applications/Codex.app'
    },
    {
      start: base + 20 * 60 * 1000,
      end: base + 24 * 60 * 1000,
      app: 'Oriel',
      title: 'Oriel',
      url: ''
    }
  ];
  context.state.timeEntries = [{
    id: 'entry-1',
    start: base + 3 * 60 * 1000,
    end: base + 5 * 60 * 1000,
    projectId: 'project-client',
    description: 'Already logged',
    billable: true
  }];

  const activitySet = context.buildAiDraftActivitySet('2026-05-25');

  assert.equal(activitySet.type, 'draftActivitySet');
  assert.equal(activitySet.activityCount, 3);
  assert.equal(activitySet.durationMs, 12 * 60 * 1000);
  assert.deepEqual(Array.from(activitySet.activities, activity => [activity.app, activity.start, activity.end]), [
    ['Codex', base, base + 3 * 60 * 1000],
    ['Codex', base + 5 * 60 * 1000, base + 10 * 60 * 1000],
    ['Oriel', base + 20 * 60 * 1000, base + 24 * 60 * 1000]
  ]);
  assert.equal(activitySet.activities[0].appPath, '/Applications/Codex.app');
  assert.equal(activitySet.activities[0].assignmentSource, 'activity-stream');
  assert.equal(activitySet.activities[0].assignmentModel, 'activity-stream-summary');
  assert.equal(activitySet.activities[0].assignedDurationMs, 3 * 60 * 1000);
  assert.equal(activitySet.activities[0].assignmentStart, base);
  assert.equal(activitySet.activities[0].assignmentEnd, base + 3 * 60 * 1000);
});

test('AI prompt intent classification gates action suggestions', () => {
  const context = loadAiSidebarContext();

  const summary = context.classifyAiPromptIntent('What did I do today?');
  assert.equal(summary.kind, 'summary');
  assert.equal(summary.allowDraftSuggestions, false);
  assert.equal(summary.allowUpdateAssignmentSuggestions, false);

  const loggingReview = context.classifyAiPromptIntent('What still needs logging?');
  assert.equal(loggingReview.kind, 'loggingReview');
  assert.equal(loggingReview.allowDraftSuggestions, false);
  assert.equal(loggingReview.allowUpdateAssignmentSuggestions, false);

  const entryDraft = context.classifyAiPromptIntent('Suggest entries');
  assert.equal(entryDraft.kind, 'entryDraft');
  assert.equal(entryDraft.allowDraftSuggestions, true);
  assert.equal(entryDraft.allowUpdateAssignmentSuggestions, false);
  assert.equal(entryDraft.draftMode, 'activitySet');

  const specificDraft = context.classifyAiPromptIntent('Draft an entry from 09:00 to 09:30');
  assert.equal(specificDraft.kind, 'entryDraft');
  assert.equal(specificDraft.allowDraftSuggestions, true);
  assert.equal(specificDraft.draftMode, 'singleRange');
});

test('AI response validation keeps safe suggestions and rejects malformed ones', () => {
  const context = loadAiSidebarContext();
  const response = context.normalizeAiResponse({
    text: 'You have unlogged browser work.',
    suggestions: [
      {
        type: 'draftEntry',
        start: new Date(2026, 4, 25, 9, 0).getTime(),
        end: new Date(2026, 4, 25, 9, 30).getTime(),
        description: 'Client portal review',
        projectId: 'project-client',
        taskId: 'task-build',
        billable: true
      },
      {
        type: 'draftEntry',
        start: new Date(2026, 4, 25, 11, 0).getTime(),
        end: new Date(2026, 4, 25, 10, 30).getTime(),
        description: ''
      },
      {
        type: 'updateAssignment',
        entryId: 'entry-1',
        projectId: 'project-admin'
      }
    ]
  });

  assert.equal(response.text, 'You have unlogged browser work.');
  assert.deepEqual(response.suggestions.map(suggestion => suggestion.type), ['draftEntry', 'updateAssignment']);
});

test('AI response validation drops draft suggestions unless intent explicitly allows them', () => {
  const context = loadAiSidebarContext();
  const dayContext = context.buildAiDayContext('2026-05-25');
  const rawResponse = {
    text: 'You recorded 30m today.',
    suggestions: [
      {
        type: 'draftEntry',
        start: new Date(2026, 4, 25, 9, 0).getTime(),
        end: new Date(2026, 4, 25, 9, 30).getTime(),
        description: 'Work in Codex and Oriel for Oriel Time Tracker',
        projectId: 'project-client',
        taskId: 'task-build',
        billable: true
      }
    ]
  };

  const summary = context.normalizeAiResponse(rawResponse, {
    intent: context.classifyAiPromptIntent('What did I do today?'),
    dayContext
  });
  assert.equal(summary.suggestions.length, 0);

  const loggingReview = context.normalizeAiResponse(rawResponse, {
    intent: context.classifyAiPromptIntent('What still needs logging?'),
    dayContext
  });
  assert.equal(loggingReview.suggestions.length, 0);

  const draft = context.normalizeAiResponse(rawResponse, {
    intent: context.classifyAiPromptIntent('Draft an entry from 09:00 to 09:30'),
    dayContext
  });
  assert.equal(draft.suggestions.length, 1);
  assert.equal(draft.suggestions[0].description, 'Client Portal');
});

test('AI response validation uses local activity set for generic entry suggestions', () => {
  const context = loadAiSidebarContext();
  const dayContext = context.buildAiDayContext('2026-05-25');
  const draftActivitySet = context.buildAiDraftActivitySet('2026-05-25');
  const response = context.normalizeAiResponse({
    text: 'You could log the captured unlogged activity.',
    suggestions: [
      {
        type: 'draftEntry',
        start: new Date(2026, 4, 25, 9, 0).getTime(),
        end: new Date(2026, 4, 25, 9, 30).getTime(),
        description: 'Provider-picked single draft',
        projectId: 'project-client'
      }
    ]
  }, {
    intent: context.classifyAiPromptIntent('Suggest entries'),
    dayContext,
    draftActivitySet
  });

  assert.equal(response.suggestions.length, 1);
  assert.equal(response.suggestions[0].type, 'draftActivitySet');
  assert.equal(response.suggestions[0].activityCount, 2);
  assert.equal(response.suggestions[0].activities[0].title, 'Client Portal - Brave Browser');
});

test('AI response validation rejects draft ranges outside selected unlogged time', () => {
  const context = loadAiSidebarContext();
  const dayContext = context.buildAiDayContext('2026-05-25');
  const response = context.normalizeAiResponse({
    text: 'Drafts',
    suggestions: [
      {
        type: 'draftEntry',
        start: new Date(2026, 4, 25, 10, 0).getTime(),
        end: new Date(2026, 4, 25, 10, 10).getTime(),
        description: 'Provider text',
        projectId: 'project-client',
        taskId: 'task-build',
        billable: true
      },
      {
        type: 'draftEntry',
        start: new Date(2026, 4, 25, 9, 0).getTime(),
        end: new Date(2026, 4, 25, 9, 0, 30).getTime(),
        description: 'Too short'
      }
    ]
  }, {
    intent: context.classifyAiPromptIntent('Suggest entries'),
    dayContext
  });

  assert.equal(response.suggestions.length, 0);
});

test('AI suggestion labels include draft purpose and fallback context', () => {
  const context = loadAiSidebarContext();
  const start = new Date(2026, 4, 25, 9, 0).getTime();
  const end = new Date(2026, 4, 25, 9, 30).getTime();

  const describedDraft = context.describeAiSuggestion({
    type: 'draftEntry',
    start,
    end,
    description: 'Client portal review',
    projectId: 'project-client',
    taskId: 'task-build'
  });
  assert.equal(describedDraft.title, 'Draft: Client portal review, 09:00-09:30');
  assert.equal(describedDraft.detail, 'Client / Build');

  const describedAppFallback = context.describeAiSuggestion({
    type: 'draftEntry',
    start,
    end
  });
  assert.equal(describedAppFallback.title, 'Draft: Brave Browser, 09:00-09:30');
  assert.equal(describedAppFallback.detail, '');

  const describedPlainFallback = context.describeAiSuggestion({
    type: 'draftEntry',
    start: new Date(2026, 4, 25, 13, 0).getTime(),
    end: new Date(2026, 4, 25, 13, 30).getTime()
  });
  assert.equal(describedPlainFallback.title, 'Draft entry, 13:00-13:30');
  assert.equal(describedPlainFallback.detail, '');

  const describedSet = context.describeAiSuggestion({
    type: 'draftActivitySet',
    activityCount: 3,
    duration: '12m'
  });
  assert.equal(describedSet.title, 'Review 3 proposed activities');
  assert.equal(describedSet.detail, '12m captured activity');
});

test('AI draft activity set opens the bulk review modal with proposed activities', () => {
  const context = loadAiSidebarContext();
  const start = new Date(2026, 4, 25, 9, 0).getTime();
  const activities = [
    {
      start,
      end: start + 5 * 60 * 1000,
      duration: 5 * 60 * 1000,
      app: 'Codex',
      title: 'Codex',
      assignmentSource: 'activity-stream'
    },
    {
      start: start + 10 * 60 * 1000,
      end: start + 15 * 60 * 1000,
      duration: 5 * 60 * 1000,
      app: 'Oriel',
      title: 'Oriel',
      assignmentSource: 'activity-stream'
    }
  ];
  let modalArgs = null;
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };

  context.applyAiSuggestion({
    type: 'draftActivitySet',
    activities
  });

  assert.ok(modalArgs);
  assert.equal(modalArgs[0], activities[0].start);
  assert.equal(modalArgs[1], activities[1].end);
  assert.equal(modalArgs[5], true);
  assert.deepEqual(Array.from(modalArgs[6], activity => [activity.app, activity.start, activity.end]), [
    ['Codex', activities[0].start, activities[0].end],
    ['Oriel', activities[1].start, activities[1].end]
  ]);
});

test('Ask AI markup uses Preferences configuration and explicit loading affordance', () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const styles = fs.readFileSync('css/index.css', 'utf8');
  const script = fs.readFileSync('js/ai-sidebar.js', 'utf8');
  const aiPanelBlock = styles.match(/\.sidebar-panel--ai\s*\{(?<body>[\s\S]*?)\n\}/)?.groups.body || '';

  assert.match(markup, /id="ai-settings-button"/);
  assert.doesNotMatch(markup, /id="ai-configure-button"/);
  assert.match(markup, /id="ai-unconfigured-status"[\s\S]*No AI provider configured/);
  assert.doesNotMatch(markup, /id="ai-provider-status"/);
  assert.doesNotMatch(markup, /id="ai-model-status"/);
  assert.doesNotMatch(markup, /id="ai-settings-panel"/);
  assert.match(markup, /id="ai-loading-spinner"/);
  assert.match(markup, /aria-busy="false"/);
  assert.match(styles, /\.ai-unconfigured-status/);
  assert.doesNotMatch(styles, /\.ai-status-card/);
  assert.match(aiPanelBlock, /position:\s*relative/);
  assert.match(styles, /\.ai-chat-input[\s\S]*padding:/);
  assert.match(styles, /@keyframes ai-spin/);
  assert.match(script, /setAiLoadingState/);
  assert.match(script, /openSettingsModal\(\{ section: 'ai' \}\)/);
});

test('Ask AI UI keeps provider status in settings and exposes prompt chips', () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const styles = fs.readFileSync('css/index.css', 'utf8');
  const script = fs.readFileSync('js/ai-sidebar.js', 'utf8');
  const aiSettingsScript = fs.readFileSync('js/ai-settings.js', 'utf8');
  const promptChipMatches = markup.match(/class="ai-prompt-chip"/g) || [];
  const tabGroupBlock = styles.match(/\.sidebar-tab-group\s*\{(?<body>[\s\S]*?)\n\}/)?.groups.body || '';
  const composerBlock = styles.match(/\.ai-composer\s*\{(?<body>[\s\S]*?)\n\}/)?.groups.body || '';
  const unconfiguredHiddenBlock = styles.match(/\.ai-unconfigured-status\.hidden\s*\{(?<body>[\s\S]*?)\n\}/)?.groups.body || '';

  assert.doesNotMatch(markup, /id="ai-key-status"/);
  assert.doesNotMatch(markup, /id="ai-settings-panel"/);
  assert.doesNotMatch(markup, /aria-controls="ai-settings-panel"/);
  assert.doesNotMatch(script, /function saveAiKey/);
  assert.match(aiSettingsScript, /function saveAiKey/);
  assert.doesNotMatch(markup, /Google AI/);
  assert.doesNotMatch(markup, /Model refresh only runs when you ask/);
  assert.doesNotMatch(script, /Curated models are available offline/);
  assert.doesNotMatch(script, /Google AI/);
  assert.match(markup, /data-settings-section-button="ai"/);
  assert.doesNotMatch(markup, /id="settings-ai-key-status"/);
  assert.match(markup, /id="settings-ai-feedback"/);
  assert.match(markup, /Keys stay in macOS Keychain\./);
  assert.match(markup, /data-settings-ai-provider="openai"[\s\S]*OpenAI/);
  assert.match(markup, /data-settings-ai-provider="google"[\s\S]*Gemini/);
  assert.match(markup, /data-settings-ai-provider="anthropic"[\s\S]*Claude/);
  assert.match(markup, /data-settings-ai-provider="openrouter"[\s\S]*OpenRouter/);
  assert.match(markup, /id="settings-ai-ask-provider"/);
  assert.match(markup, /id="settings-ai-model-picker-button"/);
  assert.match(markup, /id="settings-ai-model-search-input"/);
  assert.match(markup, /id="settings-ai-model-refresh-button"/);
  assert.match(markup, /id="settings-ai-model-refresh-label"/);
  assert.match(markup, /id="settings-ai-model-refresh-confirm"/);
  assert.match(markup, /id="settings-ai-model-refresh-confirm-button"/);
  assert.match(markup, /id="settings-ai-key-edit-button"/);
  assert.match(markup, /class="button-secondary ai-key-cancel-button hidden" id="settings-ai-key-cancel-button"/);
  assert.match(markup, /id="settings-ai-screenshot-enabled"/);
  assert.match(markup, /id="settings-ai-screenshot-provider"/);
  assert.doesNotMatch(markup, /Use Ask AI provider/);
  assert.match(markup, /id="settings-ai-screenshot-frequency"/);
  assert.match(markup, /id="settings-ai-screenshot-daily-cap"/);
  assert.match(markup, /id="settings-ai-screenshot-model-picker-button"/);
  assert.doesNotMatch(markup, /id="settings-ai-screenshot-model-mode"/);
  assert.doesNotMatch(markup, /id="settings-ai-screenshot-model-input"/);
  assert.match(markup, /id="settings-ai-screenshot-test-button"/);
  assert.match(markup, /id="settings-ai-screenshot-test-feedback"/);
  assert.match(markup, /id="settings-ai-screenshot-open-screen-recording-button"/);
  assert.match(markup, /compressed screenshots and activity metadata/);
  assert.match(styles, /\.ai-model-picker-menu\.hidden\s*\{[\s\S]*display:\s*none/);
  assert.match(styles, /\.ai-model-refresh-confirm\.hidden\s*\{[\s\S]*display:\s*none/);
  assert.match(styles, /\.ai-model-refresh-button\.is-loading i[\s\S]*animation:\s*ai-spin/);
  assert.match(markup, /class="ai-prompt-chip"[\s\S]*data-ai-prompt="What did I do today\?"/);
  assert.match(markup, /class="ai-prompt-chip"[\s\S]*data-ai-prompt="Suggest entries"/);
  assert.doesNotMatch(markup, /data-ai-prompt="What still needs logging\?"/);
  assert.doesNotMatch(markup, /data-ai-prompt="Show project totals"/);
  assert.equal(promptChipMatches.length, 2);
  assert.doesNotMatch(markup, /id="ai-chat-select"/);
  assert.doesNotMatch(markup, /id="ai-provider-select"/);
  assert.doesNotMatch(markup, /ai-day-summary/);
  assert.doesNotMatch(markup, /ai-day-label/);
  assert.doesNotMatch(styles, /\.ai-day-summary/);
  assert.doesNotMatch(styles, /\.ai-day-value/);
  assert.match(markup, /id="ai-new-chat-button"[\s\S]*<span>New<\/span>/);
  assert.doesNotMatch(markup, /id="ai-configure-button"/);
  assert.match(markup, /id="ai-unconfigured-status"[\s\S]*No AI provider configured/);
  assert.match(styles, /\.ai-topbar-actions\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/);
  assert.match(styles, /\.ai-unconfigured-status\.hidden\s*\{[\s\S]*visibility:\s*hidden/);
  assert.doesNotMatch(unconfiguredHiddenBlock, /display:\s*none/);
  assert.doesNotMatch(tabGroupBlock, /border:/);
  assert.doesNotMatch(tabGroupBlock, /background:/);
  assert.doesNotMatch(tabGroupBlock, /padding:/);
  assert.doesNotMatch(composerBlock, /border-top:/);
  assert.match(markup, /id="ai-status"><\/span>/);
  assert.match(markup, /class="ai-chat-input-shell"/);
  assert.match(styles, /\.ai-chat-input[\s\S]*resize:\s*none/);
  assert.match(styles, /\.ai-chat-input-shell:focus-within[\s\S]*box-shadow:/);
  assert.match(styles, /\.ai-settings-button i[\s\S]*font-size:/);
  assert.match(script, /openSettingsModal\(\{ section: 'ai' \}\)/);
  assert.match(script, /addEventListener\('click', \(\) => sendAiMessage\(\)\)/);
  assert.match(script, /sendAiMessage\(button\.dataset\.aiPrompt/);
  assert.doesNotMatch(script, /renderChatPicker/);
  assert.doesNotMatch(script, /ai-chat-select/);
  assert.match(script, /const intent = classifyAiPromptIntent\(content\)/);
  assert.match(script, /normalizeAiResponse\(response, \{ intent, dayContext, draftActivitySet \}\)/);
});

test('AI screenshot test feedback stays next to the test action', async () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const aiPanel = markup.slice(markup.indexOf('data-settings-section-panel="ai"'), markup.indexOf('data-settings-section-panel="data"'));
  const testButtonIndex = aiPanel.indexOf('id="settings-ai-screenshot-test-button"');
  const testFeedbackIndex = aiPanel.indexOf('id="settings-ai-screenshot-test-feedback"');
  const screenSettingsIndex = aiPanel.indexOf('id="settings-ai-screenshot-open-screen-recording-button"');
  const providerFeedbackIndex = aiPanel.indexOf('id="settings-ai-feedback"');

  assert.ok(testButtonIndex > -1);
  assert.ok(testFeedbackIndex > testButtonIndex);
  assert.ok(screenSettingsIndex > testButtonIndex);
  assert.ok(providerFeedbackIndex > -1 && providerFeedbackIndex < testButtonIndex);

  const screenRecordingError = new Error('Screen Recording permission is required for screenshot summaries.');
  const { context, elements, requests } = createAiSettingsDom({ screenshotTestResult: screenRecordingError });

  await context.initAiSidebar();
  await elements['settings-ai-screenshot-test-button'].click();

  assert.equal(elements['settings-ai-feedback'].textContent, '');
  assert.match(elements['settings-ai-screenshot-test-feedback'].textContent, /Screen Recording permission/);
  assert.equal(elements['settings-ai-screenshot-test-feedback'].dataset.tone, 'error');
  assert.equal(elements['settings-ai-screenshot-open-screen-recording-button'].classList.contains('hidden'), false);

  await elements['settings-ai-screenshot-open-screen-recording-button'].click();

  assert.deepEqual(JSON.parse(JSON.stringify(requests.map(request => request.operation))), [
    'ai.keys.status',
    'ai.screenshotSummary.test',
    'system.openScreenRecordingSettings'
  ]);
});

test('AI screenshot test handles missing key and native fallback in screenshot feedback', async () => {
  const missingKey = createAiSettingsDom({
    keyStatus: { openai: false, google: false, anthropic: false, openrouter: false }
  });
  await missingKey.context.initAiSidebar();
  await missingKey.elements['settings-ai-screenshot-test-button'].click();

  assert.equal(missingKey.elements['settings-ai-feedback'].textContent, '');
  assert.equal(missingKey.elements['settings-ai-screenshot-test-feedback'].textContent, 'Save a key for this provider first.');
  assert.equal(missingKey.elements['settings-ai-screenshot-open-screen-recording-button'].classList.contains('hidden'), true);

  const nonNative = createAiSettingsDom();
  nonNative.context.OrielData.isNative = false;
  await nonNative.context.initAiSidebar();
  await nonNative.elements['settings-ai-screenshot-test-button'].click();

  assert.equal(nonNative.elements['settings-ai-feedback'].textContent, '');
  assert.match(nonNative.elements['settings-ai-screenshot-test-feedback'].textContent, /requires Oriel\.app/);
});

test('AI settings labels and screenshot frequency help copy are clear', () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const styles = fs.readFileSync('css/index.css', 'utf8');
  const aiPanel = markup.slice(markup.indexOf('data-settings-section-panel="ai"'), markup.indexOf('data-settings-section-panel="data"'));
  const modalBody = markup.slice(markup.indexOf('id="settings-modal-body"'), markup.indexOf('</div>\n\n        </div>\n    </div>\n\n    <!-- MODAL: Create/Edit Time Entry -->'));

  assert.match(aiPanel, /<span>Provider<\/span>[\s\S]*id="settings-ai-ask-provider"/);
  assert.match(aiPanel, /<span>Provider<\/span>[\s\S]*id="settings-ai-screenshot-provider"/);
  assert.match(aiPanel, /<span>Model<\/span>[\s\S]*id="settings-ai-screenshot-model-picker-button"/);
  assert.doesNotMatch(aiPanel, /Ask AI Provider|Screenshot Provider|Screenshot Model/);
  assert.match(aiPanel, /id="settings-ai-screenshot-frequency-help"/);
  assert.match(aiPanel, /data-settings-tooltip-title="Frequency presets"/);
  assert.match(aiPanel, /data-settings-tooltip-list="Low\|120s dwell \/ 30m same-context cooldown&#10;Balanced\|60s dwell \/ 10m same-context cooldown&#10;High\|45s dwell \/ 5m same-context cooldown"/);
  assert.match(aiPanel, /data-settings-tooltip-note="Frequency only changes dwell and same-context cooldown. Daily cap and timeout stay independent."/);
  assert.match(aiPanel, /data-settings-tooltip="Daily cap limits how many screenshot summaries can be sent per day\."/);
  assert.match(aiPanel, /data-settings-tooltip="Timeout limits how long Oriel waits for one provider request\."/);
  assert.match(markup, /id="settings-floating-tooltip"/);
  assert.doesNotMatch(modalBody, /class="settings-tooltip"/);
  assert.match(styles, /\.settings-info-button/);
  assert.match(styles, /\.settings-floating-tooltip/);
  assert.match(styles, /\.settings-tooltip-title/);
  assert.match(styles, /\.settings-tooltip-list/);
  assert.match(styles, /\.settings-tooltip-row/);
  assert.match(styles, /\.settings-tooltip-term/);
  assert.match(styles, /\.settings-tooltip-detail/);
  assert.match(styles, /\.settings-tooltip-note/);
  assert.match(fs.readFileSync('js/main.js', 'utf8'), /settingsTooltipList/);
  assert.match(styles, /\.settings-modal-body\s*\{[\s\S]*overflow-x:\s*hidden/s);
  assert.match(styles, /\.settings-section-panel\s*\{[\s\S]*min-width:\s*0/s);
  assert.match(styles, /\.ai-screenshot-controls-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
});

test('AI provider selection auto-selects exactly one configured provider', async () => {
  const context = loadAiSidebarContext();
  const updates = [];
  context.OrielData = {
    isNative: true,
    async request(operation, payload) {
      updates.push({ operation, payload });
      if (operation === 'ai.settings.update') {
        Object.assign(context.state.settings, payload);
        return context.state.settings;
      }
      return {};
    }
  };
  context.state.settings.aiProvider = '';

  await context.resolveAiProviderSelection({ openai: false, google: true, anthropic: false });

  assert.equal(context.state.settings.aiProvider, 'google');
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), [
    { operation: 'ai.settings.update', payload: { aiProvider: 'google' } }
  ]);

  updates.length = 0;
  context.state.settings.aiProvider = '';
  await context.resolveAiProviderSelection({ openai: true, google: true, anthropic: false });

  assert.equal(context.state.settings.aiProvider, '');
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), []);
});

test('AI key provider cards do not change the Ask AI provider setting', async () => {
  const { context, providerCards, elements } = createAiSettingsDom({
    keyStatus: { openai: true, google: false, anthropic: false, openrouter: false }
  });

  await context.initAiSidebar();
  await providerCards.google.click();

  assert.equal(context.state.settings.aiProvider, 'openai');
  assert.equal(elements['ai-api-key-input'].disabled, false);
  assert.equal(elements['ai-api-key-input'].value, '');
});

test('Ask AI provider dropdown persists the chat provider', async () => {
  const { context, elements, requests } = createAiSettingsDom();

  await context.initAiSidebar();
  elements['settings-ai-ask-provider'].value = 'openrouter';
  await elements['settings-ai-ask-provider'].dispatch('change', { target: elements['settings-ai-ask-provider'] });

  assert.equal(context.state.settings.aiProvider, 'openrouter');
  assert.equal(context.localStorage.getItem('aiProvider'), 'openrouter');
  assert.deepEqual(JSON.parse(JSON.stringify(requests.filter(request => request.operation === 'ai.settings.update').at(-1).payload)), {
    aiProvider: 'openrouter'
  });
});

test('AI model refresh is explicit and confirmation gated', () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const script = fs.readFileSync('js/ai-settings.js', 'utf8');
  const initBlock = script.match(/function initAiSettings\(\) \{(?<body>[\s\S]*?)\n    \}/)?.groups.body || '';
  const refreshBlock = script.match(/async function refreshAiModelsForPicker\(picker = 'ask'\) \{(?<body>[\s\S]*?)\n    \}/)?.groups.body || '';

  assert.doesNotMatch(initBlock, /ai\.models\.list/);
  assert.match(markup, /id="settings-ai-model-refresh-confirm-button"[\s\S]*Refresh now/);
  assert.match(script, /requestAiModelRefreshConfirmation/);
  assert.doesNotMatch(refreshBlock, /global\.confirm|window\.confirm/);
  assert.match(refreshBlock, /ai\.models\.list/);
});

test('AI key controls lock saved keys and require explicit edit or confirmed removal', async () => {
  const { context, elements, providerCards, requests } = createAiSettingsDom();

  await context.initAiSidebar();

  assert.equal(elements['ai-api-key-input'].disabled, true);
  assert.equal(elements['ai-api-key-input'].value, '********');
  assert.equal(elements['ai-key-edit-button'].classList.contains('hidden'), false);
  assert.equal(elements['ai-key-save-button'].classList.contains('hidden'), true);
  assert.equal(elements['ai-key-delete-button'].classList.contains('hidden'), false);

  await elements['ai-key-edit-button'].click();

  assert.equal(elements['ai-api-key-input'].disabled, false);
  assert.equal(elements['ai-api-key-input'].value, '');
  assert.equal(elements['ai-api-key-input'].focused, true);
  assert.equal(elements['ai-key-save-label'].textContent, 'Save new key');
  assert.equal(elements['ai-key-cancel-button'].classList.contains('hidden'), false);
  assert.equal(elements['ai-key-delete-button'].classList.contains('hidden'), true);

  await elements['ai-key-cancel-button'].click();

  assert.equal(elements['ai-api-key-input'].disabled, true);
  assert.equal(elements['ai-api-key-input'].value, '********');
  assert.equal(elements['ai-key-cancel-button'].classList.contains('hidden'), true);

  await providerCards.google.click();

  assert.equal(context.state.settings.aiProvider, 'openai');
  assert.equal(elements['ai-api-key-input'].disabled, false);
  assert.equal(elements['ai-api-key-input'].value, '');
  assert.equal(elements['ai-key-save-label'].textContent, 'Save key');
  assert.equal(elements['ai-key-edit-button'].classList.contains('hidden'), true);

  const cancelled = createAiSettingsDom({ confirmResult: false });
  await cancelled.context.initAiSidebar();
  await cancelled.elements['ai-key-delete-button'].click();
  assert.equal(cancelled.requests.filter(request => request.operation === 'ai.keys.delete').length, 0);
});

test('AI provider key block relies on provider row key states without duplicate status pill', () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const styles = fs.readFileSync('css/index.css', 'utf8');
  const keyActionsBlock = styles.match(/\.ai-key-actions\s*\{(?<body>[\s\S]*?)\n\}/)?.groups.body || '';
  const keyActionButtonBlock = styles.match(/\.ai-key-actions \.button-primary,\n\.ai-key-actions \.button-secondary\s*\{(?<body>[\s\S]*?)\n\}/)?.groups.body || '';
  const aiPanel = markup.slice(markup.indexOf('data-settings-section-panel="ai"'), markup.indexOf('data-settings-section-panel="data"'));

  assert.doesNotMatch(markup, /id="settings-ai-key-status"/);
  assert.match(markup, /id="settings-ai-provider-openai-key-state"/);
  assert.match(markup, /id="settings-ai-provider-openrouter-key-state"/);
  assert.match(markup, /id="settings-ai-feedback"/);
  assert.ok(aiPanel.indexOf('id="settings-ai-key-delete-button"') < aiPanel.indexOf('id="settings-ai-feedback"'));
  assert.match(styles, /\.ai-settings-feedback:empty\s*\{[\s\S]*display:\s*none/);
  assert.match(keyActionsBlock, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(keyActionButtonBlock, /width:\s*100%/);
});

test('AI provider cards show saved keys with a check icon instead of text', async () => {
  const { context, elements } = createAiSettingsDom();

  await context.initAiSidebar();

  assert.equal(elements['ai-provider-openai-key-state'].textContent, '');
  assert.match(elements['ai-provider-openai-key-state'].innerHTML, /ph-check/);
  assert.equal(elements['ai-provider-openai-key-state'].getAttribute('aria-label'), 'Key saved');
  assert.doesNotMatch(elements['ai-provider-openai-key-state'].innerHTML, /Key saved/);

  assert.equal(elements['ai-provider-google-key-state'].textContent, 'No key');
  assert.equal(elements['ai-provider-google-key-state'].innerHTML, '');
  assert.equal(elements['ai-provider-google-key-state'].getAttribute('aria-label'), null);
});

test('AI key removal calls Keychain delete only after confirmation', async () => {
  let confirmOptions;
  const { context, elements, requests } = createAiSettingsDom({
    customConfirm: options => {
      confirmOptions = options;
      return options.onConfirm();
    }
  });

  await context.initAiSidebar();
  await elements['ai-key-delete-button'].click();

  assert.match(confirmOptions.title, /Remove OpenAI API key/);
  assert.match(confirmOptions.message, /Keychain/);
  assert.deepEqual(JSON.parse(JSON.stringify(requests.filter(request => request.operation === 'ai.keys.delete').map(request => request.payload))), [
    { provider: 'openai' }
  ]);
  assert.equal(elements['ai-api-key-input'].disabled, false);
  assert.equal(elements['ai-api-key-input'].value, '');
  assert.equal(elements['ai-key-delete-button'].classList.contains('hidden'), true);
});

test('AI model refresh shows loading state and renders fetched models in the open picker', async () => {
  let resolveModels;
  const timers = [];
  const { context, elements, requests } = createAiSettingsDom({
    modelListResult: () => new Promise(resolve => {
      resolveModels = resolve;
    }),
    setTimeoutImpl: (handler, delay) => {
      timers.push({ handler, delay });
      return timers.length;
    },
    clearTimeoutImpl: () => {}
  });

  await context.initAiSidebar();
  elements['ai-model-picker-menu'].classList.remove('hidden');

  await elements['ai-model-refresh-button'].click();

  assert.equal(requests.filter(request => request.operation === 'ai.models.list').length, 0);
  assert.equal(elements['ai-model-refresh-confirm'].classList.contains('hidden'), false);
  assert.match(elements['ai-model-refresh-confirm-text'].textContent, /Refresh OpenAI models now/);

  const refreshPromise = elements['ai-model-refresh-confirm-button'].click();
  await Promise.resolve();

  assert.equal(requests.filter(request => request.operation === 'ai.models.list').length, 1);
  assert.equal(elements['ai-model-refresh-confirm'].classList.contains('hidden'), true);
  assert.equal(elements['ai-model-refresh-button'].disabled, true);
  assert.equal(elements['ai-model-refresh-button'].classList.contains('is-loading'), true);
  assert.equal(elements['ai-model-refresh-button']._icon.classList.contains('is-loading'), true);
  assert.equal(elements['ai-model-refresh-label'].textContent, 'Refreshing...');
  assert.equal(elements['ai-model-refresh-meta'].textContent, 'Refreshing models...');

  resolveModels({
    provider: 'openai',
    models: ['gpt-5.2', 'gpt-fetched-plan'],
    refreshedAt: '2026-05-31T17:14:00.000Z'
  });
  await refreshPromise;

  assert.equal(elements['ai-model-refresh-button'].disabled, false);
  assert.equal(elements['ai-model-refresh-button'].classList.contains('is-loading'), false);
  assert.equal(elements['ai-model-picker-menu'].classList.contains('hidden'), false);
  assert.equal(elements['ai-model-refresh-meta'].textContent, '');
  assert.equal(elements['ai-model-refresh-label'].textContent, 'Models refreshed');
  assert.equal(elements['ai-model-refresh-button']._icon.className, 'ph ph-check');
  assert.equal(timers.at(-1).delay, 2600);
  assert.match(elements['ai-model-option-list'].innerHTML, /gpt-fetched-plan/);
  assert.match(elements['ai-model-option-list'].innerHTML, /Fetched/);
  assert.match(context.localStorage.getItem('oriel.aiModelCache.v1'), /gpt-fetched-plan/);

  timers.at(-1).handler();

  assert.equal(elements['ai-model-refresh-label'].textContent, 'Refresh from provider...');
  assert.equal(elements['ai-model-refresh-button']._icon.className, 'ph ph-arrows-clockwise');
  assert.equal(elements['ai-model-refresh-meta'].textContent, '');
});

test('AI model refresh reports empty and failed provider responses inline', async () => {
  const empty = createAiSettingsDom({
    modelListResult: { provider: 'openai', models: [], refreshedAt: '2026-05-31T17:14:00.000Z' }
  });
  await empty.context.initAiSidebar();
  await empty.elements['ai-model-refresh-button'].click();
  await empty.elements['ai-model-refresh-confirm-button'].click();
  assert.equal(empty.elements['ai-model-refresh-meta'].textContent, 'No compatible models returned.');

  const failed = createAiSettingsDom({
    modelListResult: async () => {
      throw new Error('Provider says no.');
    }
  });
  failed.context.console.error = () => {};
  await failed.context.initAiSidebar();
  await failed.elements['ai-model-refresh-button'].click();
  await failed.elements['ai-model-refresh-confirm-button'].click();
  assert.equal(failed.elements['ai-model-refresh-meta'].textContent, 'Provider says no.');
});

test('AI model refresh missing-key error stays inside the open picker and clears after saving key', async () => {
  const { context, elements, requests } = createAiSettingsDom({
    keyStatus: { openai: false, google: false, anthropic: false, openrouter: false }
  });

  await context.initAiSidebar();
  await elements['ai-model-picker-button'].click();
  await elements['ai-model-refresh-button'].click();

  assert.equal(elements['ai-model-picker-menu'].classList.contains('hidden'), false);
  assert.equal(elements['ai-model-refresh-meta'].textContent, 'Save a key for this provider first.');
  assert.equal(elements['ai-model-refresh-meta'].dataset.tone, 'error');
  assert.equal(elements['ai-model-refresh-meta'].classList.contains('hidden'), false);
  assert.equal(requests.filter(request => request.operation === 'ai.models.list').length, 0);

  elements['ai-api-key-input'].value = 'sk-test';
  await elements['ai-key-save-button'].click();

  assert.equal(elements['ai-model-refresh-meta'].textContent, '');
  assert.equal(elements['ai-model-refresh-meta'].dataset.tone, 'muted');
  assert.equal(elements['ai-model-refresh-meta'].classList.contains('hidden'), true);
});

test('AI screenshot provider is concrete and can be configured separately from Ask AI provider', async () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const { context, elements, requests } = createAiSettingsDom();

  assert.doesNotMatch(markup, /<option value="">Use Ask AI provider<\/option>/);

  await context.initAiSidebar();
  elements['settings-ai-screenshot-provider'].value = 'openrouter';
  await elements['settings-ai-screenshot-provider'].dispatch('change', { target: elements['settings-ai-screenshot-provider'] });

  assert.equal(context.state.settings.aiProvider, 'openai');
  assert.equal(context.state.settings.aiScreenshotProvider, 'openrouter');
  assert.equal(context.localStorage.getItem('aiScreenshotProvider'), 'openrouter');
  assert.deepEqual(JSON.parse(JSON.stringify(requests.filter(request => request.operation === 'ai.settings.update').at(-1).payload)), {
    aiScreenshotProvider: 'openrouter'
  });
});

test('AI screenshot sensitive exclusions render and persist as screenshot-only settings', async () => {
  const markup = fs.readFileSync('index.html', 'utf8');
  const { context, elements, requests } = createAiSettingsDom();

  assert.match(markup, /Sensitive Screenshot Exclusions/);
  assert.match(markup, /id="settings-ai-screenshot-sensitive-input"/);
  assert.match(markup, /id="settings-ai-screenshot-sensitive-list"/);

  await context.initAiSidebar();
  assert.match(elements['settings-ai-screenshot-sensitive-list'].innerHTML, /1password/);

  elements['settings-ai-screenshot-sensitive-input'].value = 'Banking App';
  await elements['settings-ai-screenshot-sensitive-add-button'].click();

  assert.deepEqual(JSON.parse(JSON.stringify(context.state.settings.aiScreenshotSensitiveApps)).at(-1), 'Banking App');
  assert.deepEqual(JSON.parse(JSON.stringify(requests.filter(request => request.operation === 'ai.settings.update').at(-1).payload)), {
    aiScreenshotSensitiveApps: JSON.parse(JSON.stringify(context.state.settings.aiScreenshotSensitiveApps))
  });
});

test('AI fetched models are shared by Ask AI and Screenshot model pickers for the same provider', async () => {
  const { context, elements } = createAiSettingsDom({
    modelListResult: { provider: 'openai', models: ['gpt-fetched-shared'], refreshedAt: '2026-05-31T17:14:00.000Z' }
  });

  await context.initAiSidebar();
  await elements['ai-model-picker-button'].click();
  await elements['ai-model-refresh-button'].click();
  await elements['ai-model-refresh-confirm-button'].click();
  await elements['settings-ai-screenshot-model-picker-button'].click();

  assert.match(elements['settings-ai-screenshot-model-option-list'].innerHTML, /gpt-fetched-shared/);
  assert.match(elements['settings-ai-screenshot-model-option-list'].innerHTML, /Fetched/);
});

test('AI screenshot model picker saves screenshot-specific model for its provider', async () => {
  const { context, elements, requests } = createAiSettingsDom();

  await context.initAiSidebar();
  elements['settings-ai-screenshot-provider'].value = 'openrouter';
  await elements['settings-ai-screenshot-provider'].dispatch('change', { target: elements['settings-ai-screenshot-provider'] });
  await elements['settings-ai-screenshot-model-picker-button'].click();
  elements['settings-ai-screenshot-model-search-input'].value = 'openrouter/custom-vision';
  await elements['settings-ai-screenshot-model-search-input'].dispatch('keydown', {
    target: elements['settings-ai-screenshot-model-search-input'],
    key: 'Enter'
  });

  assert.equal(context.state.settings.aiScreenshotOpenRouterModel, 'openrouter/custom-vision');
  assert.deepEqual(JSON.parse(JSON.stringify(requests.filter(request => request.operation === 'ai.settings.update').at(-1).payload)), {
    aiScreenshotOpenRouterModel: 'openrouter/custom-vision'
  });
});

test('AI loading state shows spinner and disables composer controls', () => {
  const context = loadAiSidebarContext();
  const composer = fakeElement();
  const spinner = fakeElement();
  const input = fakeElement();
  const sendButton = fakeElement();
  const sendLabel = fakeElement();
  spinner.classList.add('hidden');
  sendButton.querySelector = selector => (selector === 'span' ? sendLabel : null);
  const elements = {
    'ai-loading-spinner': spinner,
    'ai-chat-input': input,
    'ai-send-button': sendButton
  };

  context.document = {
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector(selector) {
      return selector === '.ai-composer' ? composer : null;
    }
  };

  context.setAiLoadingState(true);
  assert.equal(composer.getAttribute('aria-busy'), 'true');
  assert.equal(spinner.classList.contains('hidden'), false);
  assert.equal(input.disabled, true);
  assert.equal(sendButton.disabled, true);
  assert.equal(sendLabel.textContent, 'Asking');

  context.setAiLoadingState(false);
  assert.equal(composer.getAttribute('aria-busy'), 'false');
  assert.equal(spinner.classList.contains('hidden'), true);
  assert.equal(input.disabled, false);
  assert.equal(sendButton.disabled, false);
  assert.equal(sendLabel.textContent, 'Send');
});
