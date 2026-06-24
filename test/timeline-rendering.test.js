import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.classes = new Set((element.className || '').split(/\s+/).filter(Boolean));
  }

  add(...classes) {
    classes.forEach(className => this.classes.add(className));
    this.element.className = Array.from(this.classes).join(' ');
  }

  remove(...classes) {
    classes.forEach(className => this.classes.delete(className));
    this.element.className = Array.from(this.classes).join(' ');
  }

  contains(className) {
    return this.classes.has(className);
  }

  toggle(className, force) {
    const shouldAdd = typeof force === 'boolean' ? force : !this.classes.has(className);
    if (shouldAdd) {
      this.add(className);
    } else {
      this.remove(className);
    }
    return shouldAdd;
  }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.innerHTML = '';
    this.innerText = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.style = {};
    this.listeners = {};
    this.attributes = {};
  }

  addEventListener(type, listener) {
    this.listeners[type] ||= [];
    this.listeners[type].push(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners[event.type] || []) {
      listener(event);
    }
  }

  querySelectorAll() {
    return [];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  closest() {
    return null;
  }

  focus() {
    this.focusCalls = (this.focusCalls || 0) + 1;
  }

  appendChild(child) {
    this.child = child;
  }

  remove() {
    this.removed = true;
  }
}

function loadTimelineContext() {
  const context = {
    window: {},
    state: {
      currentDate: new Date(2026, 4, 21),
      zoom: 5,
      activities: [],
      timeEntries: [],
      projects: [],
      selectedActivities: new Set(),
      settings: {
        minActivityThreshold: 60
      }
    },
    DOM: {},
    resizeState: {},
    document: {},
    URL,
    cleanTitle: title => title,
    getActivityIconHTML: () => '',
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/js/timeline.js', 'utf8'), context);
  return context;
}

function createSimilarActivityBlock({
  startCell,
  app,
  title = app,
  url = '',
  domain = '',
  appPath = '',
  bundleId = '',
  selected = false,
  span = 1,
  overlaps = [],
  selectedSimilarityKeys = []
}) {
  const classes = new Set(selected ? ['activity-block', 'selected'] : ['activity-block']);
  const checkboxClasses = new Set(selected ? ['activity-checkbox', 'is-selected'] : ['activity-checkbox']);
  const icon = { className: selected ? 'ph-fill ph-check-square text-base' : 'ph ph-square text-base' };
  const checkbox = {
    classList: {
      add: className => checkboxClasses.add(className),
      remove: className => checkboxClasses.delete(className),
      contains: className => checkboxClasses.has(className)
    }
  };

  return {
    dataset: {
      startCell: String(startCell),
      span: String(span),
      app,
      title,
      url,
      domain,
      appPath,
      bundleId,
      overlaps: encodeURIComponent(JSON.stringify(overlaps)),
      ...(selectedSimilarityKeys.length > 0
        ? { selectedSimilarityKeys: encodeURIComponent(JSON.stringify(selectedSimilarityKeys)) }
        : {})
    },
    classList: {
      add: className => classes.add(className),
      remove: className => classes.delete(className),
      contains: className => classes.has(className)
    },
    querySelector(selector) {
      if (selector === '.activity-checkbox') return checkbox;
      if (selector === '.activity-checkbox i') return icon;
      return null;
    }
  };
}

function attachSimilarModalDom(context) {
  function createRadio(id, value) {
    const radio = new FakeElement(id);
    const option = new FakeElement(`${id}-option`);
    option.className = 'similar-option';
    option.classList = new FakeClassList(option);
    radio.value = value;
    radio.closest = selector => selector === '.similar-option' ? option : null;
    return { radio, option };
  }

  const host = createRadio('similar-mode-host', 'host');
  const url = createRadio('similar-mode-url', 'url');
  const app = createRadio('similar-mode-app', 'app');
  const appTitle = createRadio('similar-mode-app-title', 'app-title');
  const modal = new FakeElement('similar-modal');
  modal.className = 'hidden';
  modal.classList = new FakeClassList(modal);

  context.DOM.elSimilarModal = modal;
  context.DOM.elSimilarModeHost = host.radio;
  context.DOM.elSimilarModeUrl = url.radio;
  context.DOM.elSimilarModeApp = app.radio;
  context.DOM.elSimilarModeAppTitle = appTitle.radio;
  context.DOM.elSimilarModalBtnClose = new FakeElement('similar-modal-btn-close');
  context.DOM.elSimilarModalBtnCancel = new FakeElement('similar-modal-btn-cancel');
  context.DOM.elSimilarModalBtnApply = new FakeElement('similar-modal-btn-apply');

  return { modal, host, url, app, appTitle };
}

function loadTitleCleaningContext() {
  const context = {
    window: {},
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    document: {
      documentElement: { dataset: {} },
      getElementById() {
        return null;
      }
    },
    URL,
    URLSearchParams
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/js/state.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('web/js/utils.js', 'utf8'), context);
  return context.window;
}

function loadScrollContext() {
  const RealDate = Date;
  const animationFrames = [];
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [2026, 4, 23, 10, 30, 0, 0]));
    }

    static now() {
      return new RealDate(2026, 4, 23, 10, 30, 0, 0).getTime();
    }
  }

  function createScrollElement() {
    const listeners = {};
    let scrollTopValue = 0;
    const element = {
      clientHeight: 400,
      scrollWrites: 0,
      scrollTo(arg) {
        this.scrollToArg = arg;
        this.scrollTop = arg.top;
      },
      addEventListener(type, listener) {
        listeners[type] ||= [];
        listeners[type].push(listener);
      },
      dispatch(type) {
        for (const listener of listeners[type] || []) {
          listener();
        }
      }
    };
    Object.defineProperty(element, 'scrollTop', {
      get() {
        return scrollTopValue;
      },
      set(value) {
        if (scrollTopValue !== value) {
          element.scrollWrites += 1;
        }
        scrollTopValue = value;
      }
    });
    return element;
  }

  const memScroll = createScrollElement();
  const timeScroll = createScrollElement();

  const context = {
    window: {},
    Date: FixedDate,
    state: { zoom: 30 },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    DOM: {
      get elMemAidScroll() {
        return memScroll;
      },
      get elTimeEntriesScroll() {
        return timeScroll;
      }
    },
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/js/scroll.js', 'utf8'), context);
  return {
    context,
    memScroll,
    timeScroll,
    flushAnimationFrame() {
      const callback = animationFrames.shift();
      if (callback) callback();
    },
    pendingAnimationFrameCount() {
      return animationFrames.length;
    }
  };
}

function loadModalsContext() {
  const elements = new Map();
  for (const id of [
    'time-entry-modal',
    'modal-title',
    'modal-start-time',
    'modal-end-time',
    'modal-duration-lbl',
    'modal-description-input',
    'modal-project-select',
    'modal-project-grid',
    'modal-task-container',
    'modal-task-select',
    'modal-billable-toggle',
    'modal-btn-delete',
    'modal-btn-save',
    'time-entry-modal-content',
    'modal-left-panel',
    'modal-memory-aid-list'
  ]) {
    elements.set(id, new FakeElement(id));
  }
  elements.get('time-entry-modal-content').className = 'w-[420px]';
  elements.get('modal-left-panel').className = 'hidden';

  const context = {
    window: {},
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      }
    },
    state: {
      projects: [
        {
          id: 'project-1',
          name: 'Project One',
          color: '#3b82f6',
          billable: true,
          tasks: [
            { id: 'task-1', name: 'Planning', archived: false },
            { id: 'task-2', name: 'Archived Task', archived: true }
          ]
        }
      ],
      activities: [],
      rules: [],
      currentModalActivities: []
    },
    DOM: {
      get elModal() { return elements.get('time-entry-modal'); },
      get elModalTitle() { return elements.get('modal-title'); },
      get elModalStart() { return elements.get('modal-start-time'); },
      get elModalEnd() { return elements.get('modal-end-time'); },
      get elModalDuration() { return elements.get('modal-duration-lbl'); },
      get elModalDescription() { return elements.get('modal-description-input'); },
      get elModalProjectSelect() { return elements.get('modal-project-select'); },
      get elModalProjectGrid() { return elements.get('modal-project-grid'); },
      get elModalTaskContainer() { return elements.get('modal-task-container'); },
      get elModalTaskSelect() { return elements.get('modal-task-select'); },
      get elModalBillable() { return elements.get('modal-billable-toggle'); },
      get elModalBtnDelete() { return elements.get('modal-btn-delete'); },
      get elModalBtnSave() { return elements.get('modal-btn-save'); },
      get elModalContent() { return elements.get('time-entry-modal-content'); },
      get elModalLeftPanel() { return elements.get('modal-left-panel'); },
      get elModalMemoryAidList() { return elements.get('modal-memory-aid-list'); }
    },
    cleanTitle: title => title,
    getActivityIconHTML: () => '',
    summarizeActivityOverlaps: overlaps => overlaps,
    URL,
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/js/modals.js', 'utf8'), context);
  return { context, elements };
}

function loadTimeEntrySaveContext() {
  const context = {
    window: {},
    document: {
      readyState: 'loading',
      addEventListener() {}
    },
    state: {
      zoom: 5
    },
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/js/main.js', 'utf8'), context);
  return context;
}

function renderMemoryAidHtml({
  activities,
  timelineActivities,
  zoom,
  hideEmptyActivityRows = false,
  timeEntries = [],
  projects = [],
  currentDate = null
}) {
  const context = loadTimelineContext();
  let renderedHtml = '';

  if (currentDate) {
    context.state.currentDate = new Date(currentDate);
  }
  context.state.zoom = zoom;
  context.state.activities = activities;
  context.state.timeEntries = timeEntries;
  context.state.projects = projects;
  context.state.settings.hideEmptyActivityRows = hideEmptyActivityRows;
  if (timelineActivities) {
    context.state.timelineActivities = timelineActivities;
  }
  context.DOM.elItemsMemoryAid = {
    set innerHTML(value) {
      renderedHtml = value;
    },
    get innerHTML() {
      return renderedHtml;
    },
    querySelectorAll() {
      return [];
    }
  };

  context.renderMemoryAidActivities();
  renderMemoryAidHtml.lastContext = context;
  return renderedHtml;
}

function extractActivityStyles(html) {
  return [...html.matchAll(/<div class="([^"]*\bactivity-block\b[^"]*)"[\s\S]*?style="([^"]+)"[\s\S]*?data-start-cell="([^"]+)"[\s\S]*?data-span="([^"]+)"/g)]
    .map(match => {
      const topPxMatch = match[2].match(/top:\s*([0-9.]+)px/);
      const heightPxMatch = match[2].match(/height:\s*([0-9.]+)px/);
      const topCalcMatch = match[2].match(/top:\s*calc\(var\(--row-height\) \* ([0-9.]+) \+ 2px\)/);
      const heightCalcMatch = match[2].match(/height:\s*calc\(var\(--row-height\) \* ([0-9.]+) - 3px\)/);
      const leftMatch = match[2].match(/left:\s*([^;]+);/);
      const widthMatch = match[2].match(/width:\s*([^;]+);/);
      const rightMatch = match[2].match(/right:\s*([^;]+);/);
      return {
        className: match[1],
        style: match[2],
        top: topPxMatch ? Number(topPxMatch[1]) : (topCalcMatch ? Number(topCalcMatch[1]) * 40 + 2 : null),
        height: heightPxMatch ? Number(heightPxMatch[1]) : (heightCalcMatch ? Number(heightCalcMatch[1]) * 40 - 3 : null),
        left: leftMatch ? leftMatch[1].trim() : null,
        width: widthMatch ? widthMatch[1].trim() : null,
        right: rightMatch ? rightMatch[1].trim() : null,
        startCell: Number(match[3]),
        span: Number(match[4])
      };
    });
}

function extractActivityBlocks(html) {
  return html.split(/<div class="activity-block /).slice(1).map(chunk => {
    const app = (chunk.match(/data-app="([^"]*)"/) || [])[1] || '';
    const startMs = Number((chunk.match(/data-start-ms="([^"]*)"/) || [])[1]);
    const endMs = Number((chunk.match(/data-end-ms="([^"]*)"/) || [])[1]);
    const title = (chunk.match(/class="activity-block__title">([^<]*)</) || [])[1] || '';
    const pill = [...chunk.matchAll(/duration-pill[^"]*"[^>]*>\s*([^<]*?)\s*</g)]
      .map(match => match[1].trim())
      .find(value => value && !value.startsWith('+')) || '';
    return { app, startMs, endMs, title, pill };
  });
}

async function refreshActivities({ rawActivities, thresholdSeconds }) {
  const context = {
    window: {},
    API_BASE: 'http://localhost:3000/api',
    state: {
      currentDate: new Date(2026, 4, 21),
      settings: {
        minActivityThreshold: thresholdSeconds
      },
      currentView: 'timeline'
    },
    DOM: {
      elActivityCount: { innerText: '' }
    },
    getFormattedDate: () => '2026-05-21',
    populateProjectDropdowns() {},
    fetch: async url => ({
      json: async () => url.includes('/activities') ? rawActivities : []
    }),
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/js/api.js', 'utf8'), context);

  await context.refreshData();
  return context.state;
}

function renderLoggedTimeEntriesWithContext({
  timeEntries,
  projects,
  zoom,
  activities = [],
  timelineActivities,
  hideEmptyActivityRows = false,
  currentDate = null
}) {
  const context = loadTimelineContext();
  let renderedHtml = '';

  if (currentDate) {
    context.state.currentDate = new Date(currentDate);
  }
  context.state.zoom = zoom;
  context.state.projects = projects;
  context.state.timeEntries = timeEntries;
  context.state.activities = activities;
  context.state.settings.hideEmptyActivityRows = hideEmptyActivityRows;
  if (timelineActivities) {
    context.state.timelineActivities = timelineActivities;
  }
  context.DOM.elItemsTimeEntries = {
    set innerHTML(value) {
      renderedHtml = value;
    },
    get innerHTML() {
      return renderedHtml;
    },
    querySelectorAll() {
      return [];
    }
  };

  context.renderLoggedTimeEntries();
  return { context, html: renderedHtml };
}

function renderLoggedTimeEntriesHtml(options) {
  return renderLoggedTimeEntriesWithContext(options).html;
}

function codexActivity(start, end) {
  return {
    app: 'Codex',
    title: 'Codex',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex',
    start,
    end,
    duration: end - start
  };
}

function orielActivity(start, end) {
  return {
    app: 'Oriel',
    title: 'Oriel',
    appPath: '/Applications/Oriel.app',
    bundleId: 'so.sil.oriel',
    start,
    end,
    duration: end - start
  };
}

function makeAutoRuleEntry({ id, start, end, projectId = 'project-1', ruleId = 'rule-1' }) {
  return {
    id,
    start,
    end,
    projectId,
    createdBy: 'auto-rule',
    autoRuleId: ruleId,
    description: '',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start,
      end,
      duration: end - start,
      assignedDurationMs: end - start,
      assignmentStart: start,
      assignmentEnd: end,
      assignmentSource: 'activity-stream',
      assignmentModel: 'auto-assigned-capture',
      assignmentDisplayZoom: 1,
      autoAssigned: true,
      autoAssignmentRuleId: ruleId
    }]
  };
}

function extractEntryStyles(html) {
  return [...html.matchAll(/class="([^"]*time-entry-block[^"]*)"[\s\S]*?style="([^"]+)"/g)]
    .map(match => {
      const topMatch = match[2].match(/top:\s*([0-9.]+)px/);
      const heightMatch = match[2].match(/height:\s*([0-9.]+)px/);
      const leftMatch = match[2].match(/left:\s*([^;]+);/);
      const widthMatch = match[2].match(/width:\s*([^;]+);/);
      const rightMatch = match[2].match(/right:\s*([^;]+);/);
      assert.ok(topMatch, `Expected pixel top in style: ${match[2]}`);
      assert.ok(heightMatch, `Expected pixel height in style: ${match[2]}`);
      return {
        className: match[1],
        style: match[2],
        top: Number(topMatch[1]),
        height: Number(heightMatch[1]),
        left: leftMatch ? leftMatch[1].trim() : null,
        width: widthMatch ? widthMatch[1].trim() : null,
        right: rightMatch ? rightMatch[1].trim() : null
      };
    });
}

function extractTimeEntryDurationLabels(html) {
  return [...html.matchAll(/<span class="duration-pill time-entry-duration shrink-0">([^<]+)<\/span>/g)]
    .map(match => match[1]);
}

function sumDurationLabelMinutes(labels) {
  return labels.reduce((total, label) => total + Number(label.match(/\d+/)?.[0] || 0), 0);
}

function expectedRowGeometry({ dateStart, start, end, zoom }) {
  const rowDurationMs = zoom * 60 * 1000;
  const startRow = Math.max(0, Math.floor((start - dateStart) / rowDurationMs));
  const endRow = Math.max(startRow + 1, Math.ceil((end - dateStart) / rowDurationMs));

  return {
    top: startRow * 40 + 2,
    height: (endRow - startRow) * 40 - 3
  };
}

function assertStyleMatchesRowGeometry(style, expected, message = '') {
  assert.equal(style.top, expected.top, message ? `${message} top` : undefined);
  assert.equal(style.height, expected.height, message ? `${message} height` : undefined);
  assert.equal((style.top - 2) % 40, 0, message ? `${message} top is row aligned` : undefined);
  assert.equal((style.height + 3) % 40, 0, message ? `${message} height is row aligned` : undefined);
}

test('blank native app Activity Stream rows use popup-visible source title fallback', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const html = renderMemoryAidHtml({
    zoom: 5,
    currentDate: new Date(2026, 5, 16),
    activities: [
      {
        app: 'Affinity',
        title: '',
        url: '',
        appPath: '/Applications/Affinity Photo 2.app',
        bundleId: 'com.seriflabs.affinityphoto2',
        start: dateStart + (11 * 60 + 50) * 60 * 1000,
        end: dateStart + (11 * 60 + 52) * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Affinity',
        title: 'Affinity - Foto Amber.jpeg @ 134%',
        url: '/Users/example/Foto Amber.jpeg',
        appPath: '/Applications/Affinity Photo 2.app',
        bundleId: 'com.seriflabs.affinityphoto2',
        start: dateStart + (11 * 60 + 52) * 60 * 1000,
        end: dateStart + (11 * 60 + 53) * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.match(html, /class="activity-block__title">Affinity - Foto Amber\.jpeg @ 134%<\/span>/);
});

test('blank native app Activity Stream rows fall back to app name when no source title is meaningful', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const html = renderMemoryAidHtml({
    zoom: 5,
    currentDate: new Date(2026, 5, 16),
    activities: [
      {
        app: 'mymind',
        title: '',
        url: '',
        appPath: '/Applications/mymind.app',
        bundleId: 'com.mymind.app',
        start: dateStart + (13 * 60 + 15) * 60 * 1000,
        end: dateStart + (13 * 60 + 16) * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.match(html, /class="activity-block__title">mymind<\/span>/);
});

test('mixed coarse Activity Stream rows hide top-level selection while single-identity rows remain selectable', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hour, minute) => dateStart + (hour * 60 + minute) * 60 * 1000;
  const mixedHtml = renderActivityBlockChromeHtml({
    zoom: 5,
    currentDate: new Date(2026, 4, 21),
    startCell: 120,
    span: 1,
    app: 'Multiple Activities',
    title: 'Multiple Activities',
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'Planning notes',
        url: 'https://example.com/planning',
        start: at(10, 0),
        end: at(10, 3),
        duration: 3 * 60 * 1000
      },
      {
        app: 'Obsidian',
        title: 'Planning.md',
        start: at(10, 3),
        end: at(10, 5),
        duration: 2 * 60 * 1000
      }
    ]
  });
  const singleIdentityHtml = renderActivityBlockChromeHtml({
    zoom: 5,
    currentDate: new Date(2026, 4, 21),
    startCell: 126,
    span: 2,
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/planning',
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'Planning notes',
        url: 'https://example.com/planning',
        start: at(10, 30),
        end: at(10, 33),
        duration: 3 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Planning notes',
        url: 'https://example.com/planning',
        start: at(10, 36),
        end: at(10, 39),
        duration: 3 * 60 * 1000
      }
    ]
  });

  assert.match(mixedHtml, /data-mixed-coarse-row="true"/);
  assert.doesNotMatch(mixedHtml, /activity-block__checkbox/);
  assert.doesNotMatch(mixedHtml, /ph-square/);
  assert.doesNotMatch(singleIdentityHtml, /data-mixed-coarse-row="true"/);
  assert.match(singleIdentityHtml, /activity-block__checkbox/);
});

test('modifier clicking a mixed coarse Activity Stream row opens breakdown instead of toggling selection', () => {
  const context = loadTimelineContext();
  const listeners = {};
  let openedBreakdown = false;
  let stopped = false;
  const mixedBlock = {
    dataset: {
      mixedCoarseRow: 'true',
      startCell: '120',
      span: '1'
    },
    classList: {
      add() {},
      remove() {},
      contains() {
        return false;
      }
    },
    querySelector() {
      return null;
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    }
  };

  context.showActivityDetailsPopup = block => {
    openedBreakdown = block === mixedBlock;
  };
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      return selector === '.activity-block' ? [mixedBlock] : [];
    }
  };

  context.attachMemoryAidInteractions();
  listeners.click({
    target: {
      closest() {
        return null;
      }
    },
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    stopPropagation() {
      stopped = true;
    }
  });

  assert.equal(openedBreakdown, true);
  assert.equal(stopped, true);
  assert.equal(context.state.selectedActivities.size, 0);
});

test('mixed coarse Activity Stream quick add opens Activities popup first', () => {
  const context = loadTimelineContext();
  const listeners = {};
  let openedBreakdown = false;
  let modalArgs = null;
  const quickAdd = {
    addEventListener(type, listener) {
      listeners.quickAdd = listener;
    }
  };
  const mixedBlock = {
    dataset: {
      mixedCoarseRow: 'true',
      startCell: '120',
      span: '1'
    },
    querySelector(selector) {
      return selector === '.activity-quick-add' ? quickAdd : null;
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    }
  };

  context.showActivityDetailsPopup = block => {
    openedBreakdown = block === mixedBlock;
  };
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      return selector === '.activity-block' ? [mixedBlock] : [];
    }
  };

  context.attachMemoryAidInteractions();
  listeners.quickAdd({
    stopPropagation() {}
  });

  assert.equal(openedBreakdown, true);
  assert.equal(modalArgs, null);
});

function expectedExactGeometry({ dateStart, start, end, zoom }) {
  const rowDurationMs = zoom * 60 * 1000;
  const startRow = Math.max(0, (start - dateStart) / rowDurationMs);
  const endRow = Math.max(startRow, (end - dateStart) / rowDurationMs);

  return {
    top: startRow * 40 + 2,
    height: Math.max(1, (endRow - startRow) * 40 - 3)
  };
}

function assertStyleNearlyMatchesGeometry(style, expected, message = '') {
  const prefix = message ? `${message} ` : '';
  assert.ok(Math.abs(style.top - expected.top) < 0.01, `${prefix}top expected ${expected.top}, got ${style.top}`);
  assert.ok(Math.abs(style.height - expected.height) < 0.01, `${prefix}height expected ${expected.height}, got ${style.height}`);
}

function assertNoOverlappingBlockGeometry(styles, message = '') {
  const sortedStyles = [...styles].sort((left, right) => left.top - right.top || left.height - right.height);

  for (let index = 1; index < sortedStyles.length; index++) {
    const previous = sortedStyles[index - 1];
    const current = sortedStyles[index];
    assert.ok(
      previous.top + previous.height <= current.top,
      `${message ? `${message}: ` : ''}block at ${current.top}px overlaps previous block ending at ${previous.top + previous.height}px`
    );
  }
}

function extractGroupedEntryBounds(html) {
  const match = html.match(/data-group-start="([^"]+)"[\s\S]*?data-group-end="([^"]+)"/);
  assert.ok(match, 'Expected grouped entry bounds in rendered HTML');
  return {
    start: Number(match[1]),
    end: Number(match[2])
  };
}

function extractGroupedEntryIds(html) {
  const match = html.match(/data-group-ids="([^"]+)"/);
  assert.ok(match, 'Expected grouped entry IDs in rendered HTML');
  return JSON.parse(decodeURIComponent(match[1]));
}

function extractFirstTimeEntryBlockHtml(html) {
  const blockStart = html.indexOf('<div class="time-entry-block');
  assert.notEqual(blockStart, -1, 'Expected time entry block');
  const nextBlockStart = html.indexOf('<div class="time-entry-block', blockStart + 1);
  return html.slice(blockStart, nextBlockStart === -1 ? html.length : nextBlockStart);
}

function extractTimeEntryBlockDatasets(html) {
  return [...html.matchAll(/<div class="[^"]*time-entry-block[^"]*"([\s\S]*?)>/g)]
    .map(match => {
      const dataset = {};
      for (const attrMatch of match[1].matchAll(/\sdata-([a-z-]+)="([^"]*)"/g)) {
        const key = attrMatch[1].replace(/-([a-z])/g, (_full, letter) => letter.toUpperCase());
        dataset[key] = attrMatch[2];
      }
      return dataset;
    });
}

function makeActivityStreamTimeEntry({
  id,
  dateStart,
  startMinute,
  endMinute,
  projectId = 'project-1',
  taskId = 'task-1',
  app = 'Codex',
  assignedMinutes,
  assignmentModel = 'activity-stream-summary',
  assignmentDisplayZoom = 1
}) {
  return {
    id,
    start: dateStart + startMinute * 60 * 1000,
    end: dateStart + endMinute * 60 * 1000,
    projectId,
    taskId,
    description: '',
    activities: [{
      app,
      title: app,
      start: dateStart + startMinute * 60 * 1000,
      end: dateStart + endMinute * 60 * 1000,
      duration: assignedMinutes * 60 * 1000,
      assignedDurationMs: assignedMinutes * 60 * 1000,
      assignmentStart: dateStart + startMinute * 60 * 1000,
      assignmentEnd: dateStart + endMinute * 60 * 1000,
      assignmentSource: 'activity-stream',
      assignmentModel,
      assignmentDisplayZoom
    }]
  };
}

test('compressed day row layout keeps visible activity and logged time rows at every zoom level', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const context = loadTimelineContext();
    const atRow = row => dateStart + row * zoom * 60 * 1000;
    const activityRows = [
      codexActivity(atRow(2), atRow(3)),
      {
        app: 'Brave Browser',
        title: 'Reference',
        url: 'https://example.com/reference',
        start: atRow(8),
        end: atRow(9),
        duration: atRow(9) - atRow(8)
      }
    ];
    const manualEntry = {
      id: `manual-${zoom}`,
      start: atRow(12),
      end: atRow(13),
      projectId: 'project-1',
      taskId: '',
      description: 'Manual row',
      billable: false,
      activities: []
    };

    context.state.zoom = zoom;
    context.state.settings.hideEmptyActivityRows = true;
    context.state.activities = activityRows;
    context.state.timelineActivities = activityRows;
    context.state.timeEntries = [manualEntry];

    const activityCells = context.buildVisibleActivityCells({
      dateStartOfDay: dateStart,
      zoom,
      ownershipActivities: activityRows,
      visibleActivities: activityRows
    });
    const timeEntryRenderItems = context.buildLoggedTimeEntryRenderItems([manualEntry], zoom, dateStart);
    const layout = context.buildDayTimelineRowLayout({
      dateStartOfDay: dateStart,
      zoom,
      activityCells,
      timeEntryRenderItems
    });

    assert.deepEqual(Array.from(layout.sourceRows), [2, 8, 12], `source rows at zoom ${zoom}`);
    assert.equal(context.getDisplayRowForSourceRow(layout, 8), 1, `source-to-display at zoom ${zoom}`);
    assert.equal(context.getSourceRowForDisplayRow(layout, 2), 12, `display-to-source at zoom ${zoom}`);
    assert.equal(context.getTimelineDisplayTopForTime(atRow(8), layout), 40, `display top at zoom ${zoom}`);
  }
});

test('compressed Activity Stream skips empty gaps without merging repeated activity blocks', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atRow = row => dateStart + row * 5 * 60 * 1000;
  const first = codexActivity(atRow(2), atRow(3));
  const second = codexActivity(atRow(8), atRow(9));
  const html = renderMemoryAidHtml({
    zoom: 5,
    activities: [first, second],
    timelineActivities: [first, second],
    hideEmptyActivityRows: true
  });
  const styles = extractActivityStyles(html);

  assert.equal(styles.length, 2);
  assert.deepEqual(styles.map(style => style.startCell), [2, 8]);
  assert.deepEqual(styles.map(style => style.span), [1, 1]);
  assert.deepEqual(styles.map(style => style.top), [2, 42]);
  assert.deepEqual(styles.map(style => style.height), [37, 37]);
});

test('coarse Activity Stream membership follows the exact visible display row', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hour, minute) => dateStart + (hour * 60 + minute) * 60 * 1000;
  const searchTitle = 'shop.example.test/?q=laptop';
  const checkoutTitle = 'Checkout details';
  const activities = [
    {
      app: 'Brave Browser',
      title: searchTitle,
      url: 'https://shop.example.test/?q=laptop',
      start: at(11, 25),
      end: at(11, 28),
      duration: 3 * 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: checkoutTitle,
      url: 'https://shop.example.test/checkout/details',
      start: at(11, 28),
      end: at(11, 29),
      duration: 60 * 1000
    }
  ];

  assert.ok(activities[0].duration > activities[1].duration);

  context.state.currentDate = new Date(2026, 4, 21);
  context.state.zoom = 1;
  const [exactSession] = context.buildActivityStreamSessions({
    dateStartOfDay: dateStart,
    activities,
    detailActivities: activities
  });
  const exactHtml = context.createActivityBlockHTML(
    exactSession,
    context.buildFullDayTimelineRowLayout(dateStart, 1)
  );

  assert.match(exactHtml, />Checkout details<\/span>/);

  [5, 10, 15, 30, 60].forEach(zoom => {
    const coarseCells = context.buildVisibleActivityCells({
      dateStartOfDay: dateStart,
      zoom,
      ownershipActivities: activities,
      visibleActivities: activities,
      timeEntries: [],
      canonicalMembership: true
    });
    const representedCells = coarseCells.filter(cell => {
      return cell && (cell.overlaps || []).some(activity => activity.title === checkoutTitle);
    });

    assert.equal(representedCells.length, 1, `${zoom} min represented cell count`);
    assert.equal(representedCells[0].title, checkoutTitle, `${zoom} min display title`);
    assert.deepEqual(
      Array.from(representedCells[0].overlaps, activity => activity.title),
      [checkoutTitle],
      `${zoom} min canonical overlaps`
    );
  });
});

test('aggregated browser session with a short display page stays represented across coarse zooms', () => {
  // Regression for issue #63: a browser host session is visible at 1 min
  // because its TOTAL active duration crossed the threshold, not because any
  // single page did. Coarse zoom must keep it represented; it must not be
  // dropped just because its resolved display page is under the visible
  // threshold. Two such short-display browser sessions plus one dominant native
  // session share the same 60-min cell, so the browser sessions are also tested
  // as non-dominant grouped rows.
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hour, minute, second = 0) => dateStart + (hour * 60 + minute) * 60 * 1000 + second * 1000;
  const browserPage = (title, path, start, end) => ({
    app: 'Brave Browser',
    title,
    url: `https://shop.example.test${path}`,
    start,
    end,
    duration: end - start
  });
  // Session A: shop.example visit, 75s total, every page well under 60s.
  const sessionA = [
    browserPage('Widget Pro 1TB SSD', '/widget-pro', at(11, 17, 0), at(11, 17, 15)),
    browserPage('Shopping cart', '/cart', at(11, 17, 15), at(11, 17, 55)),
    browserPage('Newsletter signup', '/newsletter', at(11, 17, 55), at(11, 18, 15))
  ];
  // Dominant native session in the same coarse cell.
  const editor = [{
    app: 'Project Editor',
    title: 'Project Editor — notes',
    appPath: '/Applications/ProjectEditor.app',
    bundleId: 'com.example.editor',
    start: at(11, 19, 0),
    end: at(11, 21, 0),
    duration: 2 * 60 * 1000
  }];
  // Session C: another short-display shop.example visit, 65s total.
  const sessionC = [
    browserPage('My account', '/account', at(11, 34, 0), at(11, 34, 30)),
    browserPage('Order history', '/orders', at(11, 34, 30), at(11, 35, 5))
  ];
  const activities = [...sessionA, ...editor, ...sessionC];

  // Each shop.example page is shorter than the visible threshold; only the
  // aggregated session crosses it.
  [...sessionA, ...sessionC].forEach(page => {
    assert.ok(page.duration < 60 * 1000, `page ${page.title} should be sub-threshold`);
  });

  context.state.currentDate = new Date(2026, 4, 21);
  context.state.zoom = 1;
  context.state.activities = activities;
  context.state.timelineActivities = activities;

  const sessions = context.buildActivityStreamSessions({
    dateStartOfDay: dateStart,
    activities,
    detailActivities: activities
  });
  // Three visible canonical row units at 1 min: shop visit, editor, account visit.
  assert.equal(sessions.length, 3, '1-min visible session count');
  const sessionStarts = Array.from(sessions, session => session.start).sort((a, b) => a - b);

  [5, 10, 15, 30, 60].forEach(zoom => {
    const cells = context.buildVisibleActivityCells({
      dateStartOfDay: dateStart,
      zoom,
      ownershipActivities: activities,
      visibleActivities: activities,
      timeEntries: [],
      canonicalMembership: true
    });
    const representedStarts = new Set();
    cells.forEach(cell => {
      if (!cell) return;
      (cell.overlaps || []).forEach(row => representedStarts.add(row.start));
    });
    // Every 1-min session is still represented; nothing dropped, nothing extra.
    assert.deepEqual(
      Array.from(representedStarts).sort((a, b) => a - b),
      sessionStarts,
      `${zoom} min represents every canonical session`
    );
  });

  // At 60 min all three sessions land in one grouped cell; opening it reveals
  // each canonical unit in timeline order with no host-only parent row.
  const coarseCells = context.buildVisibleActivityCells({
    dateStartOfDay: dateStart,
    zoom: 60,
    ownershipActivities: activities,
    visibleActivities: activities,
    timeEntries: [],
    canonicalMembership: true
  }).filter(Boolean);
  assert.equal(coarseCells.length, 1, '60 min grouped cell count');
  const popup = context.buildActivityPopupDisplayModel({
    overlaps: coarseCells[0].overlaps,
    rangeStart: coarseCells[0].start,
    rangeEnd: coarseCells[0].end,
    primaryActivity: { app: coarseCells[0].app, title: coarseCells[0].title, url: coarseCells[0].url },
    activeDurationMs: coarseCells[0].duration,
    zoom: 60
  });
  assert.equal(popup.isMultiple, true, '60 min popup is a grouped breakdown');
  assert.equal(popup.visibleRows.length, 3, '60 min popup reveals each canonical unit');
  const popupStarts = Array.from(popup.visibleRows, row => row.start);
  assert.deepEqual(popupStarts, Array.from(popupStarts).sort((a, b) => a - b), 'popup rows in timeline order');
  popup.visibleRows.forEach(row => {
    const title = String(row.title || '').trim().toLowerCase();
    assert.notEqual(title, 'shop.example.test', 'no host-only parent row');
  });
});

test('coarse Activity Stream popup clips a cell-spanning session to the block span', () => {
  // Regression for issue #1: a canonical session that spans two coarse blocks
  // carries its WHOLE-session assignedDurationMs/duration in each block's
  // overlaps. The popup breakdown must show only the portion inside THAT block,
  // so the same 15-min run is not reported as 15 + 15 (read as 2x). The clipped
  // portions sum back to the session total, and each in-block portion still
  // clears the visible threshold so the session stays represented (issue #63).
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hour, minute) => dateStart + (hour * 60 + minute) * 60 * 1000;
  const jazzStart = at(10, 23);
  const jazzEnd = at(10, 38); // 15-min session crossing the 10:25 boundary
  const jazzRow = {
    app: 'Brave Browser',
    title: 'quiet house jazz for deep concentration',
    url: 'https://youtube.com/watch?v=jazz',
    start: jazzStart,
    end: jazzEnd,
    duration: jazzEnd - jazzStart,
    assignedDurationMs: jazzEnd - jazzStart
  };
  const sumVisibleRowDurations = popup => popup.visibleRows.reduce(
    (total, row) => total + (Number(row.duration) || 0), 0
  );

  const popupA = context.buildActivityPopupDisplayModel({
    overlaps: [jazzRow], rangeStart: at(10, 20), rangeEnd: at(10, 25),
    primaryActivity: jazzRow, zoom: 5
  });
  const popupB = context.buildActivityPopupDisplayModel({
    overlaps: [jazzRow], rangeStart: at(10, 25), rangeEnd: at(10, 40),
    primaryActivity: jazzRow, zoom: 5
  });

  // 10:23-10:25 = 2 min in block A; 10:25-10:38 = 13 min in block B.
  assert.equal(Math.round(sumVisibleRowDurations(popupA) / 60000), 2);
  assert.equal(Math.round(sumVisibleRowDurations(popupB) / 60000), 13);
  // The two clipped portions sum to the session total (15), not 2x15.
  assert.equal(
    Math.round((sumVisibleRowDurations(popupA) + sumVisibleRowDurations(popupB)) / 60000),
    15
  );
});

test('coarse Activity Stream popup preserves repeated canonical row units in timeline order', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hour, minute) => dateStart + (hour * 60 + minute) * 60 * 1000;
  const activities = [
    {
      app: 'Brave Browser',
      title: 'Task draft',
      url: 'https://docs.example.test/task',
      start: at(11, 0),
      end: at(11, 1),
      duration: 60 * 1000
    },
    {
      app: 'Calendar',
      title: 'Planning break',
      appPath: '/Applications/Calendar.app',
      bundleId: 'com.apple.iCal',
      start: at(11, 1),
      end: at(11, 2),
      duration: 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Task draft',
      url: 'https://docs.example.test/task',
      start: at(11, 2),
      end: at(11, 3),
      duration: 60 * 1000
    }
  ];
  const html = renderMemoryAidHtml({
    activities,
    zoom: 5,
    currentDate: new Date(dateStart)
  });
  const overlaps = extractActivityOverlaps(html, 'Task draft');

  assert.deepEqual(
    overlaps.map(activity => activity.title),
    ['Task draft', 'Planning break', 'Task draft']
  );

  const popup = renderMultipleActivitiesPopup({
    overlaps,
    app: 'Brave Browser',
    title: 'Task draft',
    url: 'https://docs.example.test/task',
    startCell: 132,
    span: 1,
    zoom: 5
  });
  const popupTitles = Array.from(
    popup.renderedMultiList.matchAll(/<span class="popup-activity-title"[^>]*>([^<]+)<\/span>/g),
    match => match[1]
  );

  assert.deepEqual(popupTitles, ['Task draft', 'Planning break', 'Task draft']);
});

test('canonical Activity Stream cell cache includes time entry state', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hour, minute) => dateStart + (hour * 60 + minute) * 60 * 1000;
  const activities = [{
    app: 'Notes',
    title: 'Planning notes',
    appPath: '/Applications/Notes.app',
    bundleId: 'com.apple.Notes',
    start: at(10, 0),
    end: at(10, 3),
    duration: 3 * 60 * 1000
  }];
  const baseOptions = {
    dateStartOfDay: dateStart,
    zoom: 5,
    ownershipActivities: activities,
    visibleActivities: activities,
    canonicalMembership: true
  };

  const emptyEntryCells = context.buildVisibleActivityCells({
    ...baseOptions,
    timeEntries: []
  });
  const loggedEntryCells = context.buildVisibleActivityCells({
    ...baseOptions,
    timeEntries: [{
      id: 'entry-planning',
      start: at(10, 0),
      end: at(10, 3),
      projectId: 'project-1',
      activities: []
    }]
  });

  assert.notStrictEqual(loggedEntryCells, emptyEntryCells);
});

test('auto-rule coarse aggregation cache uses scoped render entries', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + 10 * 60 * 60 * 1000;
  const firstEnd = firstStart + 2 * 60 * 1000;
  const secondStart = firstEnd;
  const secondEnd = secondStart + 2 * 60 * 1000;
  const activities = [
    codexActivity(firstStart, firstEnd),
    codexActivity(secondStart, secondEnd)
  ];

  context.state.activities = activities;
  context.state.timelineActivities = activities;
  context.state.timeEntries = [];
  context.__orielTimelineDiagnostics = { activitySessionBuilds: 0 };

  context.buildLoggedTimeEntryRenderItems([
    makeAutoRuleEntry({ id: 'entry-cache-first', start: firstStart, end: firstEnd })
  ], 5, dateStart);
  context.buildLoggedTimeEntryRenderItems([
    makeAutoRuleEntry({ id: 'entry-cache-second', start: secondStart, end: secondEnd })
  ], 5, dateStart);

  assert.equal(context.__orielTimelineDiagnostics.activitySessionBuilds, 2);
});

test('compressed timeline grid keeps unassigned activity rows and manual time entry rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atRow = row => dateStart + row * 5 * 60 * 1000;
  const context = loadTimelineContext();
  let timeGridHtml = '';
  let timeItemsHeight = '';

  context.state.zoom = 5;
  context.state.settings.hideEmptyActivityRows = true;
  context.state.currentDate = new Date(2026, 4, 21);
  context.state.projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  context.state.activities = [
    codexActivity(atRow(2), atRow(3)),
    {
      app: 'Brave Browser',
      title: 'Unassigned Reference',
      url: 'https://example.com/reference',
      start: atRow(8),
      end: atRow(9),
      duration: atRow(9) - atRow(8)
    }
  ];
  context.state.timelineActivities = context.state.activities;
  context.state.timeEntries = [{
    id: 'manual-row',
    start: atRow(12),
    end: atRow(13),
    projectId: 'project-1',
    taskId: '',
    description: 'Manual row',
    billable: false,
    activities: []
  }];
  context.DOM.elGridMemoryAid = { set innerHTML(_value) {} };
  context.DOM.elGridTimeEntries = {
    set innerHTML(value) {
      timeGridHtml = value;
    }
  };
  context.DOM.elItemsMemoryAid = { style: {} };
  context.DOM.elItemsTimeEntries = {
    style: {
      set height(value) {
        timeItemsHeight = value;
      }
    }
  };

  context.renderTimelineGrids();
  const loggedHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: context.state.projects,
    activities: context.state.activities,
    timelineActivities: context.state.timelineActivities,
    timeEntries: context.state.timeEntries,
    hideEmptyActivityRows: true
  });
  const [manualStyle] = extractEntryStyles(loggedHtml);

  assert.match(timeGridHtml, />00:10</);
  assert.match(timeGridHtml, />00:40</);
  assert.match(timeGridHtml, />01:00</);
  assert.doesNotMatch(timeGridHtml, />00:15</);
  assert.equal(timeItemsHeight, '120px');
  assert.equal(manualStyle.top, 82);
  assert.equal(manualStyle.height, 37);
});

test('compressed Time Entries keep entry clicks but omit resize handles', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    hideEmptyActivityRows: true,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [],
    timeEntries: [{
      id: 'manual-row',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + 9 * 60 * 60 * 1000 + 30 * 60 * 1000,
      projectId: 'project-1',
      taskId: '',
      description: 'Manual row',
      billable: false,
      activities: []
    }]
  });

  assert.match(html, /class="time-entry-block/);
  assert.match(html, /data-id="manual-row"/);
  assert.doesNotMatch(html, /resize-handle-top/);
  assert.doesNotMatch(html, /resize-handle-bottom/);
});

test('jump to current time scrolls both timeline panes to the same current-time position', () => {
  const { context, memScroll, timeScroll } = loadScrollContext();

  context.jumpToCurrentTime();

  const expectedTop = ((10 * 60 + 30) / 30) * 40 - 200;
  assert.equal(memScroll.scrollTop, expectedTop);
  assert.equal(timeScroll.scrollTop, expectedTop);
  assert.equal(memScroll.scrollTop, timeScroll.scrollTop);
});

test('jump to current time applies the target immediately without waiting for smooth scrolling', () => {
  const { context, memScroll, timeScroll } = loadScrollContext();

  memScroll.scrollTo = function scrollTo(arg) {
    this.scrollToArg = arg;
  };
  timeScroll.scrollTo = function scrollTo(arg) {
    this.scrollToArg = arg;
  };

  context.jumpToCurrentTime();

  const expectedTop = ((10 * 60 + 30) / 30) * 40 - 200;
  assert.equal(memScroll.scrollTop, expectedTop);
  assert.equal(timeScroll.scrollTop, expectedTop);
});

test('timeline scroll sync does not ignore the next user scroll when programmatic events are skipped', () => {
  const { context, memScroll, timeScroll, flushAnimationFrame } = loadScrollContext();
  context.setupScrollSync();

  memScroll.scrollTop = 120;
  memScroll.dispatch('scroll');
  flushAnimationFrame();
  assert.equal(timeScroll.scrollTop, 120);

  timeScroll.scrollTop = 240;
  timeScroll.dispatch('scroll');
  flushAnimationFrame();
  assert.equal(memScroll.scrollTop, 240);
});

test('timeline scroll sync coalesces repeated scroll events into one frame write', () => {
  const { context, memScroll, timeScroll, flushAnimationFrame, pendingAnimationFrameCount } = loadScrollContext();
  context.setupScrollSync();

  memScroll.scrollTop = 120;
  memScroll.dispatch('scroll');
  memScroll.scrollTop = 180;
  memScroll.dispatch('scroll');
  memScroll.scrollTop = 220;
  memScroll.dispatch('scroll');

  assert.equal(pendingAnimationFrameCount(), 1);
  assert.equal(timeScroll.scrollTop, 0);
  assert.equal(timeScroll.scrollWrites, 0);

  flushAnimationFrame();

  assert.equal(timeScroll.scrollTop, 220);
  assert.equal(timeScroll.scrollWrites, 1);
});

function extractActivityDuration(html, title) {
  const blockHtml = extractActivityBlockHtml(html, title);
  const durationMatches = [...blockHtml.matchAll(/class="[^"]*\bduration-pill\b[^"]*"[^>]*>\s*([^<]+?)\s*<\/div>/g)];
  assert.ok(durationMatches.length > 0, `Expected duration badge for ${title}`);
  return durationMatches.at(-1)[1];
}

function extractActivityBlockHtml(html, title) {
  const titleIndex = html.indexOf(`data-title="${title}"`);
  assert.notEqual(titleIndex, -1, `Expected rendered activity block for ${title}`);

  const blockStart = html.lastIndexOf('<div class="activity-block', titleIndex);
  const blockEnd = html.indexOf('<button class="activity-quick-add', titleIndex);
  assert.notEqual(blockStart, -1, `Expected activity block start for ${title}`);
  assert.notEqual(blockEnd, -1, `Expected activity block end for ${title}`);
  return html.slice(blockStart, blockEnd);
}

function extractActivitySpan(html, title) {
  const titleIndex = html.indexOf(`data-title="${title}"`);
  assert.notEqual(titleIndex, -1, `Expected rendered activity block for ${title}`);

  const blockStart = html.lastIndexOf('<div class="activity-block', titleIndex);
  const spanMatch = html.slice(blockStart, titleIndex).match(/data-span="(\d+)"/);
  assert.ok(spanMatch, `Expected span for ${title}`);
  return Number(spanMatch[1]);
}

function extractActivityOverlaps(html, title) {
  const titleIndex = html.indexOf(`data-title="${title}"`);
  assert.notEqual(titleIndex, -1, `Expected rendered activity block for ${title}`);

  const blockStart = html.lastIndexOf('<div class="activity-block', titleIndex);
  const blockEnd = html.indexOf('<button class="activity-quick-add', titleIndex);
  const blockHtml = html.slice(blockStart, blockEnd);
  const overlapsMatch = blockHtml.match(/data-overlaps="([^"]+)"/);
  if (overlapsMatch) {
    return JSON.parse(decodeURIComponent(overlapsMatch[1]));
  }

  const overlapKeyMatch = blockHtml.match(/data-overlap-key="([^"]+)"/);
  assert.ok(overlapKeyMatch, `Expected overlaps for ${title}`);
  return renderMemoryAidHtml.lastContext.getActivityBlockDetailOverlaps({
    dataset: { overlapKey: overlapKeyMatch[1] }
  });
}

function countActivityIcon(html, app) {
  return [...html.matchAll(new RegExp(`data-icon="${app}"`, 'g'))].length;
}

function renderActivityBlockChromeHtml({
  app = 'Codex',
  title = 'Codex',
  url = '',
  overlaps,
  startCell = 153,
  span = 3,
  cleanTitle = title => title,
  zoom = 5,
  blockOverrides = {},
  currentDate = null,
  iconFactory = null
}) {
  const context = loadTimelineContext();
  if (currentDate) {
    context.state.currentDate = new Date(currentDate);
  }
  context.state.zoom = zoom;
  context.cleanTitle = cleanTitle;
  context.getActivityIconHTML = iconFactory || ((iconApp) => `<span class="fake-icon" data-icon="${iconApp}"></span>`);
  return context.createActivityBlockHTML({
    startCell,
    span,
    app,
    title,
    url,
    appPath: '',
    bundleId: '',
    duration: span * zoom * 60 * 1000,
    overlaps,
    ...blockOverrides
  });
}

function renderMultipleActivitiesPopup({
  overlaps,
  app = 'Brave Browser',
  title = 'Brave Browser',
  url = '',
  startCell = 118,
  span = 3,
  cleanTitle = title => title,
  zoom = 5,
  datasetOverrides = {},
  selected = false
}) {
  const context = loadTimelineContext();
  context.state.zoom = zoom;
  let renderedMultiList = '';
  let renderedSingleChildren = '';
  let modalArgs = null;
  const popupRows = [];
  const createClassList = (initialClasses = []) => {
    const classes = new Set(initialClasses);
    return {
      add: (...classNames) => classNames.forEach(className => classes.add(className)),
      remove: (...classNames) => classNames.forEach(className => classes.delete(className)),
      contains: className => classes.has(className),
      toggle(className, force) {
        const shouldAdd = typeof force === 'boolean' ? force : !classes.has(className);
        if (shouldAdd) {
          classes.add(className);
        } else {
          classes.delete(className);
        }
        return shouldAdd;
      }
    };
  };
  const createButton = initialClasses => {
    const listeners = {};
    const icon = { className: '' };
    return {
      classList: createClassList(initialClasses),
      addEventListener(type, listener) {
        listeners[type] = listener;
      },
      querySelector(selector) {
        return selector === 'i' ? icon : null;
      },
      setAttribute() {},
      click() {
        listeners.click?.({ stopPropagation() {}, preventDefault() {} });
      }
    };
  };

  context.DOM.elPopupDuration = { innerText: '', title: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupTitle = { innerText: '' };
  context.cleanTitle = cleanTitle;
  context.DOM.elPopupSingleDetails = { classList: createClassList(), querySelector: () => null };
  context.DOM.elPopupSingleChildrenContainer = {
    dataset: {},
    classList: createClassList(['hidden']),
    set innerHTML(value) {
      renderedSingleChildren = value;
      popupRows.length = 0;
      for (const match of value.matchAll(/data-popup-overlap-index="(\d+)"(?:[^>]*data-popup-child-index="(\d+)")?/g)) {
        const nextRowIndex = value.indexOf('data-popup-overlap-index="', match.index + 1);
        const rowHtml = value.slice(match.index, nextRowIndex === -1 ? value.length : nextRowIndex);
        const rowStart = value.lastIndexOf('<div', match.index);
        const openingTag = value.slice(rowStart, value.indexOf('>', match.index) + 1);
        const selectButton = rowHtml.includes('popup-activity-select')
          ? createButton(['popup-activity-select', 'activity-checkbox'])
          : null;
        const quickAddButton = rowHtml.includes('popup-activity-quick-add')
          ? createButton(['popup-activity-quick-add', 'activity-quick-add'])
          : null;
        popupRows.push({
          dataset: {
            popupOverlapIndex: match[1],
            ...(match[2] === undefined ? {} : { popupChildIndex: match[2] }),
            ...(openingTag.match(/data-popup-similarity-key="([^"]*)"/)?.[1]
              ? { popupSimilarityKey: openingTag.match(/data-popup-similarity-key="([^"]*)"/)?.[1] }
              : {})
          },
          classList: createClassList(['popup-activity-row', ...(openingTag.includes('is-selected') ? ['is-selected'] : [])]),
          querySelector(selector) {
            if (selector === '.popup-activity-select') return selectButton;
            if (selector === '.popup-activity-quick-add') return quickAddButton;
            return null;
          }
        });
      }
    },
    get innerHTML() {
      return renderedSingleChildren;
    },
    querySelectorAll(selector) {
      return selector === '[data-popup-overlap-index]' ? popupRows : [];
    }
  };
  context.DOM.elPopupMultiDetails = { classList: createClassList() };
  context.DOM.elPopupUrlContainer = { classList: createClassList() };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = {
    dataset: {},
    set innerHTML(value) {
      renderedMultiList = value;
      popupRows.length = 0;
      for (const match of value.matchAll(/data-popup-overlap-index="(\d+)"(?:[^>]*data-popup-child-index="(\d+)")?/g)) {
        const nextRowIndex = value.indexOf('data-popup-overlap-index="', match.index + 1);
        const rowHtml = value.slice(match.index, nextRowIndex === -1 ? value.length : nextRowIndex);
        const rowStart = value.lastIndexOf('<div', match.index);
        const openingTag = value.slice(rowStart, value.indexOf('>', match.index) + 1);
        const selectButton = rowHtml.includes('popup-activity-select')
          ? createButton(['popup-activity-select', 'activity-checkbox'])
          : null;
        const quickAddButton = rowHtml.includes('popup-activity-quick-add')
          ? createButton(['popup-activity-quick-add', 'activity-quick-add'])
          : null;
        const expandButton = rowHtml.includes('popup-activity-expand')
          ? createButton(['popup-activity-expand'])
          : null;
        popupRows.push({
          dataset: {
            popupOverlapIndex: match[1],
            ...(match[2] === undefined ? {} : { popupChildIndex: match[2] }),
            ...(openingTag.match(/data-popup-similarity-key="([^"]*)"/)?.[1]
              ? { popupSimilarityKey: openingTag.match(/data-popup-similarity-key="([^"]*)"/)?.[1] }
              : {})
          },
          classList: createClassList(['popup-activity-row', ...(openingTag.includes('is-selected') ? ['is-selected'] : [])]),
          querySelector(selector) {
            if (selector === '.popup-activity-select') return selectButton;
            if (selector === '.popup-activity-quick-add') return quickAddButton;
            if (selector === '.popup-activity-expand') return expandButton;
            return null;
          }
        });
      }
    },
    get innerHTML() {
      return renderedMultiList;
    },
    querySelectorAll(selector) {
      return selector === '[data-popup-overlap-index]' ? popupRows : [];
    }
  };
  context.DOM.elPopupActivityMixContainer = { classList: createClassList(), setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupActivityMixLabel = { innerText: '' };
  context.DOM.elPopupActivityMixInfo = { setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = { style: {}, classList: createClassList() };
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;
  if (selected) {
    context.state.selectedActivities.add(startCell);
  }

  const blockEl = {
    dataset: {
      startCell: String(startCell),
      span: String(span),
      app,
      title,
      url,
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify(overlaps)),
      ...datasetOverrides
    }
  };
  context.showActivityDetailsPopup(blockEl);

  return {
    context,
    blockEl,
    get renderedMultiList() {
      return renderedMultiList;
    },
    get renderedSingleChildren() {
      return renderedSingleChildren;
    },
    get modalArgs() {
      return modalArgs;
    },
    get popupRows() {
      return popupRows;
    }
  };
}

test('cleanTitle strips Brave Base profile suffixes', () => {
  const context = loadTitleCleaningContext();

  assert.equal(context.cleanTitle('Facebook - Brave - Base'), 'Facebook');
  assert.equal(context.cleanTitle('facebook - brave - base'), 'facebook');
});

test('frontend API base is relative for native bridge and private audit servers', () => {
  const context = loadTitleCleaningContext();

  assert.equal(context.API_BASE, '/api');
});

test('cleanTitle applies default editable cleanup rules with app and URL scopes', () => {
  const context = loadTitleCleaningContext();

  assert.equal(
    context.cleanTitle('PewDiePie did it again - YouTube - Audio playing - Brave - Base', {
      app: 'Brave Browser',
      url: 'https://www.youtube.com/watch?v=ygscsZ09zPE'
    }),
    'PewDiePie did it again'
  );
  assert.equal(
    context.cleanTitle('Smoke City - Underwater Love - YouTube - Audio playing - High memory usage - 969 MB - Brave - Base', {
      app: 'Brave Browser',
      url: 'https://www.youtube.com/watch?v=abc'
    }),
    'Smoke City - Underwater Love'
  );
  assert.equal(
    context.cleanTitle('(1) IQOS Iluma Review - YouTube', {
      app: 'Brave Browser',
      url: 'https://www.youtube.com/watch?v=L5tCTMAZiGs'
    }),
    'IQOS Iluma Review'
  );
  assert.equal(
    context.cleanTitle('hiken - sil-so - Obsidian 1.12.7', {
      app: 'Obsidian',
      url: ''
    }),
    'hiken - sil-so'
  );
  assert.equal(
    context.cleanTitle('Research - YouTube', {
      app: 'Obsidian',
      url: ''
    }),
    'Research - YouTube'
  );
});

test('cleanTitle respects edited cleanup rule state and ignores invalid regex', () => {
  const context = loadTitleCleaningContext();
  context.state.settings.titleCleanupRules = [
    {
      id: 'strip-ticket',
      name: 'Strip Ticket',
      enabled: true,
      pattern: '\\s+\\[TICKET-\\d+\\]$',
      appContains: '',
      urlContains: ''
    },
    {
      id: 'disabled-audio',
      name: 'Disabled Audio',
      enabled: false,
      pattern: '\\s+-\\s*Audio playing',
      appContains: '',
      urlContains: ''
    },
    {
      id: 'invalid',
      name: 'Invalid',
      enabled: true,
      pattern: '[',
      appContains: '',
      urlContains: ''
    }
  ];

  assert.equal(context.cleanTitle('Client Portal [TICKET-123]'), 'Client Portal');
  assert.equal(context.cleanTitle('Video - Audio playing'), 'Video - Audio playing');
});

test('logged time entries are rendered without relative positioning', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  let renderedHtml = '';

  context.state.projects = [
    { id: 'project-1', name: 'Project One', color: '#3b82f6' },
    { id: 'project-2', name: 'Project Two', color: '#10b981' }
  ];
  context.state.timeEntries = [
    {
      id: 'entry-1',
      start: dateStart + (9 * 60 + 10) * 60 * 1000,
      end: dateStart + (9 * 60 + 25) * 60 * 1000,
      projectId: 'project-1',
      description: 'First entry'
    },
    {
      id: 'entry-2',
      start: dateStart + (9 * 60 + 25) * 60 * 1000,
      end: dateStart + (9 * 60 + 45) * 60 * 1000,
      projectId: 'project-2',
      description: 'Second entry'
    }
  ];
  context.DOM.elItemsTimeEntries = {
    set innerHTML(value) {
      renderedHtml = value;
    },
    get innerHTML() {
      return renderedHtml;
    },
    querySelectorAll() {
      return [];
    }
  };

  context.renderLoggedTimeEntries();

  const blockClassMatches = [...renderedHtml.matchAll(/class="([^"]*time-entry-block[^"]*)"/g)];
  assert.equal(blockClassMatches.length, 2);
  for (const match of blockClassMatches) {
    assert.equal(match[1].split(/\s+/).includes('relative'), false);
  }
});

test('logged time entries use row-aligned display geometry at every zoom level', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [
    { id: 'project-1', name: 'Project One', color: '#3b82f6' },
    { id: 'project-2', name: 'Project Two', color: '#10b981' }
  ];
  const timeEntries = [
    {
      id: 'entry-1',
      start: dateStart + (9 * 60 + 4) * 60 * 1000 + 15 * 1000,
      end: dateStart + (9 * 60 + 6) * 60 * 1000 + 10 * 1000,
      projectId: 'project-1',
      description: 'First entry'
    },
    {
      id: 'entry-2',
      start: dateStart + (9 * 60 + 20) * 60 * 1000,
      end: dateStart + (9 * 60 + 35) * 60 * 1000,
      projectId: 'project-2',
      description: 'Second entry'
    }
  ];

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({ timeEntries, projects, zoom });
    const styles = extractEntryStyles(html);
    assert.equal(styles.length, 2);

    assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
      dateStart,
      start: timeEntries[0].start,
      end: timeEntries[0].end,
      zoom
    }), `first entry at zoom ${zoom}`);
    assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
      dateStart,
      start: timeEntries[1].start,
      end: timeEntries[1].end,
      zoom
    }), `second entry at zoom ${zoom}`);
    assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min', '15 min']);
  }
});

test('source-backed popup row assignments do not lane-split within the same visible row across zooms', () => {
  const dateStart = new Date(2026, 5, 15).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute) => dateStart + (hour * 60 + minute) * 60 * 1000;
  const displayStart = at(12, 0);
  const displayEnd = at(12, 15);
  const source = (title, url, start, end) => ({
    app: 'Brave Browser',
    title,
    url,
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start,
    end,
    duration: end - start,
    assignedDurationMs: end - start,
    assignmentStart: start,
    assignmentEnd: end,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayStart: displayStart,
    assignmentDisplayEnd: displayEnd,
    assignmentDisplayZoom: 15
  });
  const sources = [
    source('bol | Bestellen', 'https://www.bol.com/nl/nl/checkout/', at(12, 0), at(12, 10)),
    source('Gaslang Vergelijking Amazon Buurs', 'https://www.buurs.nl/gaslang', at(12, 10), at(12, 12)),
    source('amazon.nl', 'https://www.amazon.nl/', at(12, 12), at(12, 14))
  ];
  const timeEntry = {
    id: 'entry-shopping',
    start: displayStart,
    end: displayEnd,
    projectId: project.id,
    taskId: 'shopping',
    createdBy: 'manual',
    description: '',
    activities: sources.map((activity, index) => ({
      ...activity,
      assignmentStart: displayStart,
      assignmentEnd: displayEnd,
      assignmentDisplayGroupKey: `shopping-row-source-${index + 1}`,
      sources: [activity]
    }))
  };

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({
      zoom,
      projects: [project],
      activities: sources,
      timeEntries: [timeEntry],
      currentDate: new Date(dateStart)
    });
    const styles = extractEntryStyles(html);

    assert.ok(styles.length > 0, `${zoom} min renders source-backed assignment`);
    styles.forEach(style => {
      assert.equal(style.left, null, `${zoom} min block should not be lane-split`);
      assert.equal(style.width, null, `${zoom} min block should not be lane-split`);
      assert.equal(style.right, null, `${zoom} min block should not be lane-split`);
    });
    assert.equal(
      new Set(styles.map(style => `${style.top}:${style.height}`)).size,
      styles.length,
      `${zoom} min should not repeat block geometry for one display row`
    );

    if (zoom === 1) {
      assert.equal(styles.length, 3, '1 min keeps exact source sessions separate');
      assert.deepEqual(extractTimeEntryDurationLabels(html), ['10 min', '2 min', '2 min']);
    } else {
      assert.equal(styles.length, 1, `${zoom} min uses one continuous visual block`);
      const expectedEndByZoom = new Map([
        [5, at(12, 15)],
        [10, at(12, 20)],
        [15, at(12, 15)],
        [30, at(12, 30)],
        [60, at(13, 0)]
      ]);
      assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
        dateStart,
        start: displayStart,
        end: expectedEndByZoom.get(zoom),
        zoom
      }), `${zoom} min popup assignment geometry`);
      assert.deepEqual(extractTimeEntryDurationLabels(html), ['14 min']);
    }
  }
});

test('source-backed popup row assignments keep saved duration and scoped exact edit payloads', () => {
  const dateStart = new Date(2026, 5, 15).setHours(0, 0, 0, 0);
  const project = {
    id: 'project-personal',
    name: 'Personal',
    color: '#ef4444',
    tasks: [{ id: 'shopping', name: 'Shopping' }]
  };
  const at = (hour, minute) => dateStart + (hour * 60 + minute) * 60 * 1000;
  const displayStart = at(12, 0);
  const displayEnd = at(12, 15);
  const source = (title, url, start, end, duration = end - start) => ({
    app: 'Brave Browser',
    title,
    url,
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start,
    end,
    duration,
    assignedDurationMs: duration,
    assignmentStart: start,
    assignmentEnd: end,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayStart: displayStart,
    assignmentDisplayEnd: displayEnd,
    assignmentDisplayZoom: 15
  });
  const shopSources = [
    source('Shop basket', 'https://shop.example/basket', at(12, 0), at(12, 3)),
    source('Shop shipping', 'https://shop.example/shipping', at(12, 4), at(12, 6)),
    source('Shop checkout', 'https://shop.example/checkout', at(12, 8), at(12, 12))
  ];
  const shopSavedSources = [
    ...shopSources,
    source('Shop basket', 'https://shop.example/basket', at(12, 1), at(12, 3), 2 * 60 * 1000),
    source('Shop checkout', 'https://shop.example/checkout', at(12, 9), at(12, 12), 3 * 60 * 1000)
  ];
  const supplierSource = source('Supplier comparison', 'https://supplier.example', at(12, 10), at(12, 12), 2 * 60 * 1000);
  const marketplaceSource = source('Marketplace order', 'https://market.example', at(12, 13), at(12, 15), 2 * 60 * 1000);
  const savedActivities = [
    {
      ...source('Shop checkout summary', 'https://shop.example', displayStart, at(12, 12), 10 * 60 * 1000),
      assignmentStart: displayStart,
      assignmentEnd: displayEnd,
      assignmentDisplayGroupKey: 'shopping-row-shop',
      sources: shopSavedSources
    },
    {
      ...supplierSource,
      assignmentStart: displayStart,
      assignmentEnd: displayEnd,
      assignmentDisplayGroupKey: 'shopping-row-supplier',
      sources: [supplierSource]
    },
    {
      ...marketplaceSource,
      assignmentStart: displayStart,
      assignmentEnd: displayEnd,
      assignmentDisplayGroupKey: 'shopping-row-marketplace',
      sources: [marketplaceSource]
    }
  ];
  const timeEntry = {
    id: 'entry-shopping',
    start: displayStart,
    end: displayEnd,
    projectId: project.id,
    taskId: 'shopping',
    createdBy: 'manual',
    description: '',
    activities: savedActivities
  };
  const currentVisibleActivities = [
    ...shopSources,
    source('Supplier comparison later', 'https://supplier.example', at(12, 15), at(12, 19), 4 * 60 * 1000),
    source('Marketplace order later', 'https://market.example', at(12, 20), at(12, 24), 4 * 60 * 1000)
  ];

  const fiveMinuteHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [project],
    activities: currentVisibleActivities,
    timeEntries: [timeEntry],
    currentDate: new Date(dateStart)
  });
  const fiveMinuteStyles = extractEntryStyles(fiveMinuteHtml);

  assert.equal(fiveMinuteStyles.length, 1, '5 min keeps one visual block');
  assert.deepEqual(extractTimeEntryDurationLabels(fiveMinuteHtml), ['14 min']);

  const { context, html: oneMinuteHtml } = renderLoggedTimeEntriesWithContext({
    zoom: 1,
    projects: [project],
    activities: currentVisibleActivities,
    timeEntries: [timeEntry],
    currentDate: new Date(dateStart)
  });
  const oneMinuteLabels = extractTimeEntryDurationLabels(oneMinuteHtml);
  const oneMinuteStyles = extractEntryStyles(oneMinuteHtml);
  assert.ok(oneMinuteLabels.length > 1, '1 min keeps exact source projections');
  assert.equal(sumDurationLabelMinutes(oneMinuteLabels), 14);
  oneMinuteStyles.forEach(style => {
    assert.equal(style.left, null, '1 min exact source projections should not lane-split');
    assert.equal(style.width, null, '1 min exact source projections should not lane-split');
    assert.equal(style.right, null, '1 min exact source projections should not lane-split');
  });
  assert.equal(
    new Set(oneMinuteStyles.map(style => `${style.top}:${style.height}`)).size,
    oneMinuteStyles.length,
    '1 min should not repeat geometry for overlapping saved source children'
  );

  let modalArgs = null;
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;
  const [firstBlockDataset] = extractTimeEntryBlockDatasets(oneMinuteHtml);
  assert.ok(firstBlockDataset, 'Expected a clickable 1 min time entry projection');

  assert.equal(context.openTimeEntryBlockEditor({ dataset: firstBlockDataset }), true);
  assert.equal(context.window.editingTimeEntryId, 'entry-shopping');
  assert.equal(modalArgs[6].length, 1);
  assert.equal(modalArgs[6][0].title, 'Shop basket');
  assert.notDeepEqual(
    modalArgs[6].map(activity => activity.title),
    savedActivities.map(activity => activity.title)
  );
});

test('logged time entries render at least one full row high for short entries', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 30,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (9 * 60) * 60 * 1000,
        end: dateStart + (9 * 60 + 20) * 60 * 1000,
        projectId: 'project-1',
        description: 'Short entry'
      },
      {
        id: 'entry-2',
        start: dateStart + (10 * 60) * 60 * 1000,
        end: dateStart + (10 * 60 + 5) * 60 * 1000,
        projectId: 'project-1',
        description: 'Tiny entry'
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles[0].height, 37);
  assert.equal(styles[1].height, 37);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (9 * 60) * 60 * 1000,
    end: dateStart + (9 * 60 + 20) * 60 * 1000,
    zoom: 30
  }));
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: dateStart + (10 * 60) * 60 * 1000,
    end: dateStart + (10 * 60 + 5) * 60 * 1000,
    zoom: 30
  }));
});

test('assigned activity entries use saved run bounds for row placement and assigned duration for label', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (13 * 60 + 32) * 60 * 1000,
        end: dateStart + (13 * 60 + 37) * 60 * 1000,
        projectId: 'project-1',
        description: '',
        activities: [{ app: 'Codex', assignedDurationMs: 235 * 1000 }]
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles[0].top, (13 * 60 + 32) * 40 + 2);
  assert.equal(styles[0].height, 5 * 40 - 3);
  assert.match(html, /<span class="duration-pill time-entry-duration shrink-0">4 min<\/span>/);
});

test('legacy activity-stream assignment envelopes render from recorded activity runs', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const codexRunStart = dateStart + (13 * 60 + 3) * 60 * 1000;
  const codexRunEnd = dateStart + (13 * 60 + 4) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [
      {
        app: 'Brave Browser',
        title: 'Oriel Local Time Tracker',
        url: 'http://localhost',
        start: dateStart + (13 * 60) * 60 * 1000,
        end: dateStart + (13 * 60 + 2) * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: codexRunStart,
        end: codexRunEnd,
        duration: 60 * 1000
      }
    ],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (13 * 60) * 60 * 1000,
        end: dateStart + (13 * 60 + 5) * 60 * 1000,
        projectId: 'project-1',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: dateStart + (13 * 60) * 60 * 1000,
          end: dateStart + (13 * 60 + 5) * 60 * 1000,
          assignedDurationMs: 2 * 60 * 1000,
          assignmentSource: 'activity-stream'
        }]
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assert.equal(styles[0].top, (13 * 60 + 3) * 40 + 2);
  assert.equal(styles[0].height, 40 - 3);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('legacy activity-stream assignment envelopes split across recorded activity gaps', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (13 * 60 + 16) * 60 * 1000;
  const firstEnd = dateStart + (13 * 60 + 21) * 60 * 1000;
  const secondStart = dateStart + (13 * 60 + 24) * 60 * 1000;
  const secondEnd = dateStart + (13 * 60 + 25) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: firstStart,
        end: firstEnd,
        duration: 5 * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: secondStart,
        end: secondEnd,
        duration: 60 * 1000
      }
    ],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (13 * 60 + 15) * 60 * 1000,
        end: dateStart + (13 * 60 + 25) * 60 * 1000,
        projectId: 'project-1',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: dateStart + (13 * 60 + 15) * 60 * 1000,
          end: dateStart + (13 * 60 + 25) * 60 * 1000,
          assignedDurationMs: 7 * 60 * 1000,
          assignmentSource: 'activity-stream'
        }]
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assert.equal(styles[0].top, (13 * 60 + 16) * 40 + 2);
  assert.equal(styles[0].height, 5 * 40 - 3);
  assert.equal(styles[1].top, (13 * 60 + 24) * 40 + 2);
  assert.equal(styles[1].height, 40 - 3);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['6 min', '1 min']);
});

test('touching activity-stream assignment entries with same project group into one visual block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (9 * 60) * 60 * 1000;
  const secondEnd = dateStart + (9 * 60 + 10) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, assignedMinutes: 4 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 5, endMinute: 9 * 60 + 10, assignedMinutes: 5 })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: secondEnd,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['9 min']);
});

test('activity-stream assignment entries use row-aligned geometry while keeping exact duration badges', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + (9 * 60 + 4) * 60 * 1000;
  const end = dateStart + (9 * 60 + 6) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 9 * 60 + 4,
        endMinute: 9 * 60 + 6,
        assignedMinutes: 1
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start,
    end,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min']);
});

test('resolved activity-stream assignment entries stay row-aligned at all zoom levels', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 9 * 60 + 4,
      endMinute: 9 * 60 + 6,
      assignedMinutes: 1
    })
  ];

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({
      zoom,
      projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
      timeEntries
    });
    const styles = extractEntryStyles(html);

    assert.equal(styles.length, 1, `Expected one assigned block at zoom ${zoom}`);
    assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
      dateStart,
      start: timeEntries[0].start,
      end: timeEntries[0].end,
      zoom
    }), `assigned entry at zoom ${zoom}`);
    assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min']);
  }
});

test('cross-zoom activity-stream assignments merge adjacent row projections while showing visible durations', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (7 * 60 + 35) * 60 * 1000,
      end: dateStart + (7 * 60 + 55) * 60 * 1000,
      duration: 20 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (8 * 60 + 10) * 60 * 1000,
      end: dateStart + (8 * 60 + 50) * 60 * 1000,
      duration: 40 * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 7 * 60 + 35,
      endMinute: 7 * 60 + 55,
      assignedMinutes: 18,
      assignmentDisplayZoom: 5
    }),
    makeActivityStreamTimeEntry({
      id: 'entry-2',
      dateStart,
      startMinute: 8 * 60 + 10,
      endMinute: 8 * 60 + 50,
      assignedMinutes: 28,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 15, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (7 * 60 + 35) * 60 * 1000,
    end: dateStart + (8 * 60 + 50) * 60 * 1000,
    zoom: 15
  }));
  assert.doesNotMatch(styles[0].className, /\btime-entry-block--partial-assignment\b/);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['46 min']);
});

test('cross-zoom projected rows expand to visible Activity Stream blocks and show visible durations', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (16 * 60 + 45) * 60 * 1000,
      end: dateStart + 17 * 60 * 60 * 1000,
      duration: 8.3 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (17 * 60 + 5) * 60 * 1000,
      end: dateStart + (17 * 60 + 20) * 60 * 1000,
      duration: 7.1 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (17 * 60 + 20) * 60 * 1000,
      end: dateStart + (17 * 60 + 30) * 60 * 1000,
      duration: 3 * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 16 * 60 + 45,
      endMinute: 17 * 60,
      assignedMinutes: 8.3,
      assignmentDisplayZoom: 5
    }),
    makeActivityStreamTimeEntry({
      id: 'entry-2',
      dateStart,
      startMinute: 17 * 60 + 5,
      endMinute: 17 * 60 + 20,
      assignedMinutes: 7.1,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 15, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (16 * 60 + 45) * 60 * 1000,
    end: dateStart + (17 * 60 + 30) * 60 * 1000,
    zoom: 15
  }));
  assert.doesNotMatch(styles[0].className, /\btime-entry-block--partial-assignment\b/);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['15 min']);
});

test('coarse Activity Stream rows expand overlapping finer-zoom saved assignments for display', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + (9 * 60 + 30) * 60 * 1000,
      duration: 21 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (9 * 60 + 30) * 60 * 1000,
      end: dateStart + 10 * 60 * 60 * 1000,
      duration: 2 * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 9 * 60,
      endMinute: 9 * 60 + 30,
      assignedMinutes: 21,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 30, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + 10 * 60 * 60 * 1000,
    zoom: 30
  }));
  assert.doesNotMatch(styles[0].className, /\btime-entry-block--partial-assignment\b/);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['21 min']);
});

test('activity-stream assignments project onto current zoom rows with matching secondary activity', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const codexIdentity = {
    app: 'Codex',
    title: 'Codex',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex'
  };
  const activities = [
    {
      ...codexIdentity,
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + (9 * 60 + 21) * 60 * 1000
    },
    {
      app: 'Obsidian',
      title: 'Obsidian',
      appPath: '/Applications/Obsidian.app',
      bundleId: 'md.obsidian',
      start: dateStart + (9 * 60 + 30) * 60 * 1000,
      end: dateStart + (9 * 60 + 47) * 60 * 1000
    },
    {
      ...codexIdentity,
      start: dateStart + (9 * 60 + 30) * 60 * 1000,
      end: dateStart + (9 * 60 + 32) * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 9 * 60,
      endMinute: 10 * 60,
      assignedMinutes: 23,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 30, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + 10 * 60 * 60 * 1000,
    zoom: 30
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['23 min']);
});

test('auto-assigned captures use exact assignment duration at one-minute zoom', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const orielStart = dateStart + (22 * 60 + 30) * 60 * 1000;
  const orielEnd = dateStart + (22 * 60 + 55) * 60 * 1000;
  const codexStart = orielStart + 28 * 1000;
  const codexEnd = codexStart + 61 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects,
    activities: [
      {
        app: 'Oriel',
        title: 'Oriel',
        appPath: '/Applications/Oriel.app',
        bundleId: 'so.sil.oriel',
        start: orielStart,
        end: orielEnd,
        duration: orielEnd - orielStart
      },
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: codexStart,
        end: codexEnd,
        duration: codexEnd - codexStart
      }
    ],
    timeEntries: [makeAutoRuleEntry({ id: 'entry-1', start: codexStart, end: codexEnd })]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleNearlyMatchesGeometry(styles[0], expectedExactGeometry({
    dateStart,
    start: codexStart,
    end: codexEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min']);
});

test('short auto-assigned captures are hidden from the logged timeline', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const codexStart = dateStart + (23 * 60 + 28) * 60 * 1000 + 28 * 1000;
  const codexEnd = codexStart + 45 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }],
    timeEntries: [{
      id: 'entry-short-auto',
      start: codexStart,
      end: codexEnd,
      projectId: 'project-1',
      createdBy: 'auto-rule',
      autoRuleId: 'rule-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        start: codexStart,
        end: codexEnd,
        duration: codexEnd - codexStart,
        assignedDurationMs: codexEnd - codexStart,
        assignmentStart: codexStart,
        assignmentEnd: codexEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'auto-assigned-capture',
        assignmentDisplayZoom: 1,
        autoAssigned: true,
        autoAssignmentRuleId: 'rule-1'
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 0);
  assert.doesNotMatch(html, />0 min</);
});

test('same project auto-rule entries merge across adjacent display rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const firstStart = dateStart + (22 * 60 + 51) * 60 * 1000;
  const firstEnd = firstStart + 60 * 1000;
  const secondStart = firstEnd;
  const secondEnd = secondStart + 60 * 1000;

  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects,
    activities: [
      codexActivity(firstStart, firstEnd),
      codexActivity(secondStart, secondEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-1', start: firstStart, end: firstEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-2', start: secondStart, end: secondEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: secondEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('coarse auto-rule merge excludes sub-minute runs so totals match across zooms', () => {
  // Mirrors the real "App Name contains Codex" auto-rule case: a continuous run
  // (gaps < 15s) totalling 7 min, a separate >=60s entry (1 min), and several
  // isolated sub-minute blips. 1-min zoom already hides the blips; coarse zoom
  // and Work Times must do the same so every surface shows the same logged
  // total (8 min), not the noise-inflated 10 min.
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const at = (hour, minute, second = 0) => dateStart + ((hour * 60 + minute) * 60 + second) * 1000;
  const ranges = [
    [at(10, 0, 0), at(10, 0, 30)], // isolated 30s blip -> dropped
    [at(10, 1, 0), at(10, 4, 0)], // run A part 1 (180s)
    [at(10, 4, 10), at(10, 6, 10)], // run A part 2 (120s, 10s gap)
    [at(10, 6, 20), at(10, 8, 20)], // run A part 3 (120s, 10s gap) -> run total 420s
    [at(10, 9, 0), at(10, 9, 40)], // isolated 40s blip -> dropped
    [at(10, 10, 30), at(10, 11, 30)], // isolated 60s entry -> kept (1 min)
    [at(10, 12, 0), at(10, 12, 35)] // isolated 35s blip -> dropped
  ];
  const timeEntries = ranges.map(([start, end], index) => (
    makeAutoRuleEntry({ id: `entry-auto-${index + 1}`, start, end })
  ));
  const activities = ranges.map(([start, end]) => codexActivity(start, end));

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({
      zoom,
      projects,
      activities,
      timeEntries,
      currentDate: new Date(dateStart)
    });
    // Run A (7 min) + the isolated 60s entry (1 min) = 8 min. The three
    // sub-minute blips never count.
    assert.equal(
      sumDurationLabelMinutes(extractTimeEntryDurationLabels(html)),
      8,
      `${zoom} min logged total`
    );
  }
});

test('auto-rule capture fragments at five-minute zoom render as a row summary', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const baseStart = dateStart + (10 * 60 + 45) * 60 * 1000 + 43 * 1000;
  const ranges = [
    [baseStart, baseStart + 121400],
    [baseStart + 144400, baseStart + 368600],
    [baseStart + 385600, baseStart + 486700],
    [baseStart + 508600, baseStart + 704900]
  ];
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: ranges.map(([start, end]) => codexActivity(start, end)),
    timeEntries: ranges.map(([start, end], index) => makeAutoRuleEntry({ id: `entry-auto-${index + 1}`, start, end }))
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: ranges[0][0],
    end: ranges.at(-1)[1],
    zoom: 5
  }), 'auto-rule five-minute summary');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['11 min']);
});

test('auto-rule coarse summaries do not bridge through hidden canonical row gaps', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const firstStart = dateStart + (13 * 60 + 20) * 60 * 1000;
  const firstEnd = dateStart + (13 * 60 + 33) * 60 * 1000;
  const hiddenBoundaryStart = dateStart + (13 * 60 + 35) * 60 * 1000 + 40 * 1000;
  const hiddenBoundaryEnd = hiddenBoundaryStart + 10 * 1000;
  const hiddenBoundarySecondStart = dateStart + (13 * 60 + 36) * 60 * 1000 + 10 * 1000;
  const hiddenBoundarySecondEnd = hiddenBoundarySecondStart + 30 * 1000;
  const laterSameRowStart = dateStart + (13 * 60 + 39) * 60 * 1000 + 20 * 1000;
  const laterSameRowEnd = dateStart + (13 * 60 + 41) * 60 * 1000 + 20 * 1000;
  const orielStart = dateStart + (13 * 60 + 35) * 60 * 1000;
  const orielEnd = dateStart + (13 * 60 + 39) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      codexActivity(firstStart, firstEnd),
      {
        app: 'Oriel',
        title: 'Oriel',
        appPath: '/Applications/Oriel.app',
        bundleId: 'so.sil.oriel',
        start: orielStart,
        end: orielEnd,
        duration: orielEnd - orielStart
      },
      codexActivity(hiddenBoundaryStart, hiddenBoundaryEnd),
      codexActivity(hiddenBoundarySecondStart, hiddenBoundarySecondEnd),
      codexActivity(laterSameRowStart, laterSameRowEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-before-boundary', start: firstStart, end: firstEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-hidden-boundary-1', start: hiddenBoundaryStart, end: hiddenBoundaryEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-hidden-boundary-2', start: hiddenBoundarySecondStart, end: hiddenBoundarySecondEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-later-same-row', start: laterSameRowStart, end: laterSameRowEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 2);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: firstEnd,
    zoom: 5
  }), 'first canonical auto-rule summary');
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: dateStart + (13 * 60 + 40) * 60 * 1000,
    end: dateStart + (13 * 60 + 45) * 60 * 1000,
    zoom: 5
  }), 'later canonical auto-rule summary');
  // The later entry is logged 13:39:20–13:41:20 (2 min). Its block geometry is
  // clipped to the visible 13:40–13:45 cell (the 13:35–13:40 cell is Oriel-owned),
  // but the pill shows the full logged duration, not the clipped span (issue #60).
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['13 min', '2 min']);
});

test('auto-rule projection skips one-minute rows without matching breakdown activity', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const firstStart = dateStart + (14 * 60 + 31) * 60 * 1000;
  const firstEnd = dateStart + (14 * 60 + 32) * 60 * 1000;
  const secondStart = dateStart + (14 * 60 + 33) * 60 * 1000;
  const secondEnd = dateStart + (14 * 60 + 35) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects,
    activities: [
      codexActivity(firstStart, firstEnd),
      {
        app: 'Brave Browser',
        title: 'Brave Browser',
        appPath: '/Applications/Brave Browser.app',
        bundleId: 'com.brave.Browser',
        start: firstEnd,
        end: secondStart,
        duration: secondStart - firstEnd
      },
      codexActivity(secondStart, secondEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-1', start: firstStart, end: firstEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-2', start: secondStart, end: secondEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 2);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: firstStart + 60 * 1000,
    zoom: 1
  }));
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: secondStart,
    end: secondEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min', '2 min']);
});

test('auto-rule exact fragments stay split across non-short gaps', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const firstHiddenStart = dateStart + (22 * 60 + 36) * 60 * 1000 + 45 * 1000;
  const firstOwnerEnd = dateStart + (22 * 60 + 37) * 60 * 1000 + 55 * 1000;
  const bridgeHiddenStart = dateStart + (22 * 60 + 38) * 60 * 1000 + 40 * 1000;
  const visibleOwnerEnd = dateStart + (22 * 60 + 44) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects,
    activities: [
      {
        app: 'Oriel',
        title: 'Oriel',
        appPath: '/Applications/Oriel.app',
        bundleId: 'so.sil.oriel',
        start: dateStart + (22 * 60 + 36) * 60 * 1000,
        end: dateStart + (22 * 60 + 36) * 60 * 1000 + 25 * 1000,
        duration: 25 * 1000
      },
      codexActivity(firstHiddenStart, firstOwnerEnd),
      {
        app: 'Shottr',
        title: 'Shottr',
        appPath: '/Applications/Shottr.app',
        bundleId: 'cc.ffitch.shottr',
        start: dateStart + (22 * 60 + 38) * 60 * 1000,
        end: dateStart + (22 * 60 + 38) * 60 * 1000 + 35 * 1000,
        duration: 35 * 1000
      },
      codexActivity(bridgeHiddenStart, visibleOwnerEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-hidden-before', start: firstHiddenStart, end: firstOwnerEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-visible-after', start: bridgeHiddenStart, end: visibleOwnerEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 2);
  assertStyleNearlyMatchesGeometry(styles[0], expectedExactGeometry({
    dateStart,
    start: firstHiddenStart,
    end: firstOwnerEnd,
    zoom: 1
  }), 'first auto-rule fragment');
  assertStyleNearlyMatchesGeometry(styles[1], expectedExactGeometry({
    dateStart,
    start: bridgeHiddenStart,
    end: visibleOwnerEnd,
    zoom: 1
  }), 'second auto-rule fragment');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min', '5 min']);
});

test('auto-rule projection does not merge a tiny later secondary row into a visible group', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const codexStart = dateStart + (14 * 60 + 31) * 60 * 1000;
  const codexEnd = dateStart + (14 * 60 + 35) * 60 * 1000 + 10 * 1000;
  const tinyCodexStart = dateStart + (14 * 60 + 42) * 60 * 1000 + 5 * 1000;
  const tinyCodexEnd = tinyCodexStart + 4 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      codexActivity(codexStart, codexEnd),
      {
        app: 'Oriel',
        title: 'Oriel',
        appPath: '/Applications/Oriel.app',
        bundleId: 'so.sil.oriel',
        start: dateStart + (14 * 60 + 35) * 60 * 1000 + 10 * 1000,
        end: dateStart + (14 * 60 + 45) * 60 * 1000,
        duration: 590 * 1000
      },
      codexActivity(tinyCodexStart, tinyCodexEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-main', start: codexStart, end: codexEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-tiny', start: tinyCodexStart, end: tinyCodexEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: codexStart,
    end: dateStart + (14 * 60 + 35) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['4 min']);
});

test('auto-rule secondary projection starts at the matching cell instead of the merged owner block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const orielStart = dateStart + (21 * 60 + 55) * 60 * 1000;
  const orielEnd = dateStart + (22 * 60 + 5) * 60 * 1000;
  const codexStart = dateStart + (22 * 60 + 2) * 60 * 1000;
  const codexEnd = dateStart + (22 * 60 + 4) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      {
        app: 'Oriel',
        title: 'Oriel',
        appPath: '/Applications/Oriel.app',
        bundleId: 'so.sil.oriel',
        start: orielStart,
        end: orielEnd,
        duration: orielEnd - orielStart
      },
      codexActivity(codexStart, codexEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-secondary', start: codexStart, end: codexEnd })
    ]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: codexStart,
    end: codexEnd,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('auto-rule projected fragments stay hidden until their visible group reaches one minute', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const shortStart = dateStart + (16 * 60 + 10) * 60 * 1000;
  const shortEnd = shortStart + 59 * 1000;
  const visibleStart = dateStart + (16 * 60 + 20) * 60 * 1000;
  const visibleFirstEnd = visibleStart + 30 * 1000;
  const visibleSecondStart = visibleFirstEnd + 10 * 1000;
  const visibleSecondEnd = visibleSecondStart + 31 * 1000;
  const shortHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [codexActivity(shortStart, shortEnd)],
    timeEntries: [makeAutoRuleEntry({ id: 'entry-auto-short', start: shortStart, end: shortEnd })]
  });
  const visibleHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      codexActivity(visibleStart, visibleFirstEnd),
      codexActivity(visibleSecondStart, visibleSecondEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-visible-1', start: visibleStart, end: visibleFirstEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-visible-2', start: visibleSecondStart, end: visibleSecondEnd })
    ]
  });

  assert.equal(extractEntryStyles(shortHtml).length, 0);
  const visibleStyles = extractEntryStyles(visibleHtml);
  assert.equal(visibleStyles.length, 1);
  assertStyleMatchesRowGeometry(visibleStyles[0], expectedRowGeometry({
    dateStart,
    start: visibleStart,
    end: visibleSecondEnd,
    zoom: 5
  }), 'visible auto-rule summary');
  assert.deepEqual(extractTimeEntryDurationLabels(visibleHtml), ['1 min']);
});

test('auto-rule secondary snippets stay hidden until their row group reaches one minute', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }];
  const hiddenRowStart = dateStart + (17 * 60 + 10) * 60 * 1000;
  const visibleRowStart = dateStart + (17 * 60 + 20) * 60 * 1000;
  const orielBlock = (start) => ({
    app: 'Oriel',
    title: 'Oriel',
    appPath: '/Applications/Oriel.app',
    bundleId: 'so.sil.oriel',
    start,
    end: start + 5 * 60 * 1000,
    duration: 5 * 60 * 1000
  });
  const hiddenStart = hiddenRowStart + 60 * 1000;
  const hiddenEnd = hiddenStart + 59 * 1000;
  const visibleFirstStart = visibleRowStart + 60 * 1000;
  const visibleFirstEnd = visibleFirstStart + 30 * 1000;
  const visibleSecondStart = visibleFirstEnd + 10 * 1000;
  const visibleSecondEnd = visibleSecondStart + 31 * 1000;
  const hiddenHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      orielBlock(hiddenRowStart),
      codexActivity(hiddenStart, hiddenEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-hidden-secondary', start: hiddenStart, end: hiddenEnd })
    ]
  });
  const visibleHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects,
    activities: [
      orielBlock(visibleRowStart),
      codexActivity(visibleFirstStart, visibleFirstEnd),
      codexActivity(visibleSecondStart, visibleSecondEnd)
    ],
    timeEntries: [
      makeAutoRuleEntry({ id: 'entry-auto-visible-secondary-1', start: visibleFirstStart, end: visibleFirstEnd }),
      makeAutoRuleEntry({ id: 'entry-auto-visible-secondary-2', start: visibleSecondStart, end: visibleSecondEnd })
    ]
  });

  assert.equal(extractEntryStyles(hiddenHtml).length, 0);
  const visibleStyles = extractEntryStyles(visibleHtml);
  assert.equal(visibleStyles.length, 1);
  assertStyleMatchesRowGeometry(visibleStyles[0], expectedRowGeometry({
    dateStart,
    start: visibleFirstStart,
    end: visibleSecondEnd,
    zoom: 5
  }), 'visible secondary auto-rule summary');
  assert.deepEqual(extractTimeEntryDurationLabels(visibleHtml), ['1 min']);
});

test('auto-rule secondary row drops separated sub-minute snippets below the run threshold', () => {
  // Scattered auto-rule captures that never form a continuous run reaching the
  // minimum render duration are noise: 1 min zoom already hides them, and coarse
  // zoom must do the same so totals stay consistent across zooms. None of these
  // snippets is within 15s of another, so each is its own sub-minute run and all
  // are dropped at every zoom.
  const dateStart = new Date(2026, 5, 15).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const rowStart = dateStart + (5 * 60 + 15) * 60 * 1000;
  const rowEnd = rowStart + 15 * 60 * 1000;
  const ranges = [
    [rowStart + 44 * 1000, rowStart + 57 * 1000],
    [rowStart + 2 * 60 * 1000 + 19 * 1000, rowStart + 2 * 60 * 1000 + 27 * 1000],
    [rowStart + 3 * 60 * 1000 + 41 * 1000, rowStart + 3 * 60 * 1000 + 51 * 1000],
    [rowStart + 4 * 60 * 1000 + 15 * 1000, rowStart + 4 * 60 * 1000 + 19 * 1000],
    [rowStart + 5 * 60 * 1000, rowStart + 5 * 60 * 1000 + 34 * 1000]
  ];
  const activities = [
    orielActivity(rowStart, rowEnd),
    ...ranges.map(([start, end]) => codexActivity(start, end))
  ];
  const timeEntries = ranges.map(([start, end], index) => makeAutoRuleEntry({
    id: `entry-secondary-separated-${index}`,
    start,
    end,
    projectId: project.id
  }));

  for (const zoom of [1, 5, 10, 15]) {
    const entryHtml = renderLoggedTimeEntriesHtml({
      zoom,
      projects: [project],
      activities,
      timeEntries,
      currentDate: new Date(dateStart)
    });
    assert.equal(extractEntryStyles(entryHtml).length, 0, `${zoom} min should render no auto-rule block`);
    assert.deepEqual(extractTimeEntryDurationLabels(entryHtml), [], `${zoom} min duration labels`);
  }
});

test('auto-rule row below visible threshold stays hidden and does not preserve compressed rows', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 5, 15).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const firstRowStart = dateStart + (5 * 60 + 15) * 60 * 1000;
  const secondRowStart = firstRowStart + 15 * 60 * 1000;
  const ranges = [
    [firstRowStart + 60 * 1000, firstRowStart + 80 * 1000],
    [firstRowStart + 4 * 60 * 1000, firstRowStart + 4 * 60 * 1000 + 20 * 1000],
    [firstRowStart + 8 * 60 * 1000, firstRowStart + 8 * 60 * 1000 + 19 * 1000],
    [secondRowStart + 60 * 1000, secondRowStart + 2 * 60 * 1000 + 31 * 1000]
  ];
  const activities = ranges.map(([start, end]) => codexActivity(start, end));
  const timeEntries = ranges.map(([start, end], index) => makeAutoRuleEntry({
    id: `entry-secondary-threshold-${index}`,
    start,
    end,
    projectId: project.id
  }));

  context.state.currentDate = new Date(dateStart);
  context.state.zoom = 15;
  context.state.projects = [project];
  context.state.activities = activities;
  context.state.timelineActivities = activities;
  context.state.timeEntries = timeEntries;
  context.state.settings.hideEmptyActivityRows = true;

  const model = context.getDayTimelineRenderModel({ dateStartOfDay: dateStart, zoom: 15 });
  const html = renderLoggedTimeEntriesHtml({
    zoom: 15,
    projects: [project],
    activities,
    timeEntries,
    hideEmptyActivityRows: true,
    currentDate: new Date(dateStart)
  });
  const [style] = extractEntryStyles(html);

  assert.deepEqual(Array.from(model.rowLayout.sourceRows), [22]);
  assert.equal(style.top, 2);
  assert.equal(style.height, 37);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('adjacent visible secondary auto-rule rows merge after row-level aggregation', () => {
  const dateStart = new Date(2026, 5, 15).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const firstRowStart = dateStart + (6 * 60) * 60 * 1000;
  const secondRowStart = firstRowStart + 15 * 60 * 1000;
  const secondRowEnd = secondRowStart + 15 * 60 * 1000;
  // Each row carries one continuous >=60s auto-rule run so it survives the run
  // threshold; the two adjacent secondary rows then merge into one block.
  const ranges = [
    [firstRowStart + 60 * 1000, firstRowStart + 120 * 1000],
    [secondRowStart + 60 * 1000, secondRowStart + 120 * 1000]
  ];
  const activities = [
    orielActivity(firstRowStart, secondRowStart),
    orielActivity(secondRowStart, secondRowEnd),
    ...ranges.map(([start, end]) => codexActivity(start, end))
  ];
  const timeEntries = ranges.map(([start, end], index) => makeAutoRuleEntry({
    id: `entry-secondary-touch-${index}`,
    start,
    end,
    projectId: project.id
  }));

  const html = renderLoggedTimeEntriesHtml({
    zoom: 15,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstRowStart,
    end: secondRowEnd,
    zoom: 15
  }), 'merged secondary rows');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('secondary visible auto-rule rows align with Activity Stream row geometry', () => {
  const dateStart = new Date(2026, 5, 15).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const rowStart = dateStart + (7 * 60 + 15) * 60 * 1000;
  const rowEnd = rowStart + 15 * 60 * 1000;
  // One continuous >=60s run so the secondary row survives the run threshold.
  const ranges = [
    [rowStart + 2 * 60 * 1000, rowStart + 2 * 60 * 1000 + 60 * 1000]
  ];
  const activities = [
    orielActivity(rowStart, rowEnd),
    ...ranges.map(([start, end]) => codexActivity(start, end))
  ];
  const timeEntries = ranges.map(([start, end], index) => makeAutoRuleEntry({
    id: `entry-secondary-align-${index}`,
    start,
    end,
    projectId: project.id
  }));

  const activityHtml = renderMemoryAidHtml({
    zoom: 15,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const entryHtml = renderLoggedTimeEntriesHtml({
    zoom: 15,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const [activityStyle] = extractActivityStyles(activityHtml);
  const [entryStyle] = extractEntryStyles(entryHtml);

  assertStyleMatchesRowGeometry(activityStyle, expectedRowGeometry({
    dateStart,
    start: rowStart,
    end: rowEnd,
    zoom: 15
  }), 'Activity Stream secondary row');
  assertStyleMatchesRowGeometry(entryStyle, {
    top: activityStyle.top,
    height: activityStyle.height
  }, 'secondary Time Entry row');
  assert.deepEqual(extractTimeEntryDurationLabels(entryHtml), ['1 min']);
});

test('activity-stream assignments include earlier current zoom rows when the assigned app is secondary', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const codexIdentity = {
    app: 'Codex',
    title: 'Codex',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex'
  };
  const activities = [
    {
      app: 'Brave Browser',
      title: 'Brave Browser',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: dateStart + (18 * 60 + 30) * 60 * 1000,
      end: dateStart + (18 * 60 + 46) * 60 * 1000
    },
    {
      ...codexIdentity,
      start: dateStart + (18 * 60 + 30) * 60 * 1000,
      end: dateStart + (18 * 60 + 32) * 60 * 1000
    },
    {
      ...codexIdentity,
      start: dateStart + 19 * 60 * 60 * 1000,
      end: dateStart + (19 * 60 + 13) * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 18 * 60 + 30,
      endMinute: 19 * 60 + 30,
      assignedMinutes: 15,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 30, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (18 * 60 + 30) * 60 * 1000,
    end: dateStart + (19 * 60 + 30) * 60 * 1000,
    zoom: 30
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['15 min']);
});

test('source-backed assignments project through popup-visible canonical rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const primaryStart = dateStart + 10 * 60 * 60 * 1000;
  const primaryEnd = primaryStart + 15 * 60 * 1000;
  const secondaryStart = primaryStart + 2 * 60 * 1000;
  const secondaryEnd = secondaryStart + 2 * 60 * 1000;
  const primaryActivity = {
    app: 'Design Tool',
    title: 'Design review',
    appPath: '/Applications/Design Tool.app',
    bundleId: 'test.design-tool',
    start: primaryStart,
    end: primaryEnd,
    duration: primaryEnd - primaryStart
  };
  const secondaryActivity = codexActivity(secondaryStart, secondaryEnd);
  const timeEntries = [{
    id: 'entry-secondary-source-backed',
    start: secondaryStart,
    end: secondaryEnd,
    projectId: 'project-1',
    createdBy: 'manual',
    description: '',
    activities: [{
      ...secondaryActivity,
      assignedDurationMs: secondaryEnd - secondaryStart,
      assignmentStart: secondaryStart,
      assignmentEnd: secondaryEnd,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 1,
      sources: [secondaryActivity]
    }]
  }];

  const html = renderLoggedTimeEntriesHtml({
    zoom: 15,
    projects,
    activities: [primaryActivity, secondaryActivity],
    timelineActivities: [primaryActivity],
    timeEntries
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: primaryStart,
    end: primaryEnd,
    zoom: 15
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('source-backed projection cache uses scoped render entries', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const primaryStart = dateStart + 10 * 60 * 60 * 1000;
  const primaryEnd = primaryStart + 15 * 60 * 1000;
  const sourceStart = primaryStart + 2 * 60 * 1000;
  const sourceEnd = sourceStart + 2 * 60 * 1000;
  const primaryActivity = {
    app: 'Design Tool',
    title: 'Design review',
    appPath: '/Applications/Design Tool.app',
    bundleId: 'test.design-tool',
    start: primaryStart,
    end: primaryEnd,
    duration: primaryEnd - primaryStart
  };
  const sourceActivity = codexActivity(sourceStart, sourceEnd);
  const sourceBackedEntry = id => ({
    id,
    start: sourceStart,
    end: sourceEnd,
    projectId: 'project-1',
    createdBy: 'manual',
    description: '',
    activities: [{
      ...sourceActivity,
      assignedDurationMs: sourceEnd - sourceStart,
      assignmentStart: sourceStart,
      assignmentEnd: sourceEnd,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 1,
      sources: [sourceActivity]
    }]
  });

  context.state.activities = [primaryActivity, sourceActivity];
  context.state.timelineActivities = [primaryActivity];
  context.state.timeEntries = [];
  context.__orielTimelineDiagnostics = { activitySessionBuilds: 0 };

  context.buildLoggedTimeEntryRenderItems([sourceBackedEntry('entry-source-first')], 15, dateStart);
  context.buildLoggedTimeEntryRenderItems([sourceBackedEntry('entry-source-second')], 15, dateStart);

  assert.equal(context.__orielTimelineDiagnostics.activitySessionBuilds, 2);
});

test('activity-stream assignments still skip current zoom rows without matching breakdown activity', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + (9 * 60 + 20) * 60 * 1000
    },
    {
      app: 'Obsidian',
      title: 'Obsidian',
      appPath: '/Applications/Obsidian.app',
      bundleId: 'md.obsidian',
      start: dateStart + (9 * 60 + 30) * 60 * 1000,
      end: dateStart + (9 * 60 + 50) * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 9 * 60,
      endMinute: 10 * 60,
      assignedMinutes: 20,
      assignmentDisplayZoom: 5
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 30, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + (9 * 60 + 30) * 60 * 1000,
    zoom: 30
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['20 min']);
});

test('coarse saved assignments project only onto matching current zoom Activity Stream rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (7 * 60 + 30) * 60 * 1000,
      end: dateStart + (7 * 60 + 45) * 60 * 1000,
      duration: 20 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (8 * 60 + 15) * 60 * 1000,
      end: dateStart + (8 * 60 + 45) * 60 * 1000,
      duration: 27 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + (9 * 60 + 15) * 60 * 1000,
      duration: 8 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (9 * 60 + 15) * 60 * 1000,
      end: dateStart + (9 * 60 + 30) * 60 * 1000,
      duration: 12 * 60 * 1000
    },
    {
      app: 'Obsidian',
      title: 'Obsidian',
      appPath: '/Applications/Obsidian.app',
      bundleId: 'md.obsidian',
      start: dateStart + (9 * 60 + 30) * 60 * 1000,
      end: dateStart + (9 * 60 + 45) * 60 * 1000,
      duration: 20 * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 7 * 60 + 30,
      endMinute: 9 * 60 + 45,
      assignedMinutes: 67,
      assignmentDisplayZoom: 30
    })
  ];

  const html = renderLoggedTimeEntriesHtml({ zoom: 15, projects, activities, timeEntries });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 3);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (7 * 60 + 30) * 60 * 1000,
    end: dateStart + (7 * 60 + 45) * 60 * 1000,
    zoom: 15
  }));
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: dateStart + (8 * 60 + 15) * 60 * 1000,
    end: dateStart + (8 * 60 + 45) * 60 * 1000,
    zoom: 15
  }));
  assertStyleMatchesRowGeometry(styles[2], expectedRowGeometry({
    dateStart,
    start: dateStart + 9 * 60 * 60 * 1000,
    end: dateStart + (9 * 60 + 30) * 60 * 1000,
    zoom: 15
  }));
  assertNoOverlappingBlockGeometry(styles);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['13 min', '27 min', '27 min']);
  assert.equal(sumDurationLabelMinutes(extractTimeEntryDurationLabels(html)), 67);
});

test('summary assignments fall back to saved row-aligned range when Activity Stream data is unavailable', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 15,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 7 * 60 + 30,
        endMinute: 9 * 60 + 45,
        assignedMinutes: 67,
        assignmentDisplayZoom: 30
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (7 * 60 + 30) * 60 * 1000,
    end: dateStart + (9 * 60 + 45) * 60 * 1000,
    zoom: 15
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['67 min']);
});

test('summary assignment display expands to the overlapping visible Activity Stream block boundary', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const visibleStart = dateStart + (8 * 60 + 9) * 60 * 1000;
  const visibleEnd = dateStart + (8 * 60 + 12) * 60 * 1000;
  const savedStart = dateStart + (8 * 60 + 10) * 60 * 1000;
  const savedEnd = dateStart + (8 * 60 + 50) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: visibleStart,
      end: visibleEnd,
      duration: visibleEnd - visibleStart
    }],
    timeEntries: [{
      id: 'entry-1',
      start: savedStart,
      end: savedEnd,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: savedStart,
        end: savedEnd,
        duration: 27 * 60 * 1000,
        assignedDurationMs: 27 * 60 * 1000,
        assignmentStart: savedStart,
        assignmentEnd: savedEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 5
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: visibleStart,
    end: visibleEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['27 min']);
});

test('summary assignment timeline badge uses visible projected duration instead of saved accounting duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + (19 * 60 + 20) * 60 * 1000;
  const blockEnd = dateStart + (19 * 60 + 22) * 60 * 1000;
  const savedEnd = dateStart + (19 * 60 + 25) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: blockStart,
      end: blockEnd,
      duration: blockEnd - blockStart
    }],
    timeEntries: [{
      id: 'entry-1',
      start: blockStart,
      end: savedEnd,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: blockStart,
        end: savedEnd,
        duration: 140.9 * 1000,
        assignedDurationMs: 140.9 * 1000,
        assignmentStart: blockStart,
        assignmentEnd: savedEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 5
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: blockStart,
    end: blockEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('summary assignment split fragments use visible Activity Stream durations without saved normalization', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (17 * 60 + 8) * 60 * 1000;
  const firstEnd = dateStart + (17 * 60 + 10) * 60 * 1000;
  const secondStart = dateStart + (17 * 60 + 15) * 60 * 1000;
  const secondEnd = dateStart + (17 * 60 + 17) * 60 * 1000;
  const savedStart = dateStart + (17 * 60 + 5) * 60 * 1000;
  const savedEnd = dateStart + (17 * 60 + 20) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: firstStart,
        end: firstEnd,
        duration: firstEnd - firstStart
      },
      {
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: secondStart,
        end: secondEnd,
        duration: secondEnd - secondStart
      }
    ],
    timeEntries: [{
      id: 'entry-1',
      start: savedStart,
      end: savedEnd,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: savedStart,
        end: savedEnd,
        duration: 422.9 * 1000,
        assignedDurationMs: 422.9 * 1000,
        assignmentStart: savedStart,
        assignmentEnd: savedEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 5
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: firstEnd,
    zoom: 1
  }));
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: secondStart,
    end: secondEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['4 min', '3 min']);
});

test('merged summary assignment blocks de-dupe shared visible Activity Stream duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const visibleStart = dateStart + (16 * 60 + 44) * 60 * 1000;
  const visibleEnd = dateStart + (16 * 60 + 51) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: visibleStart,
      end: visibleEnd,
      duration: visibleEnd - visibleStart
    }],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (16 * 60 + 30) * 60 * 1000,
        end: dateStart + (16 * 60 + 45) * 60 * 1000,
        projectId: 'project-1',
        description: '',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: dateStart + (16 * 60 + 30) * 60 * 1000,
          end: dateStart + (16 * 60 + 45) * 60 * 1000,
          duration: 51.7 * 1000,
          assignedDurationMs: 51.7 * 1000,
          assignmentStart: dateStart + (16 * 60 + 30) * 60 * 1000,
          assignmentEnd: dateStart + (16 * 60 + 45) * 60 * 1000,
          assignmentSource: 'activity-stream',
          assignmentModel: 'activity-stream-summary',
          assignmentDisplayZoom: 5
        }]
      },
      {
        id: 'entry-2',
        start: dateStart + (16 * 60 + 45) * 60 * 1000,
        end: dateStart + 17 * 60 * 60 * 1000,
        projectId: 'project-1',
        description: '',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: dateStart + (16 * 60 + 45) * 60 * 1000,
          end: dateStart + 17 * 60 * 60 * 1000,
          duration: 500.5 * 1000,
          assignedDurationMs: 500.5 * 1000,
          assignmentStart: dateStart + (16 * 60 + 45) * 60 * 1000,
          assignmentEnd: dateStart + 17 * 60 * 60 * 1000,
          assignmentSource: 'activity-stream',
          assignmentModel: 'activity-stream-summary',
          assignmentDisplayZoom: 5
        }]
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: visibleStart,
    end: visibleEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['9 min']);
});

test('summary assignment projection hides standalone short matching activity rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + 9 * 60 * 60 * 1000;
  const end = start + 45 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start,
      end,
      duration: 45 * 1000
    }],
    timeEntries: [{
      id: 'entry-1',
      start,
      end,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start,
        end,
        duration: 45 * 1000,
        assignedDurationMs: 45 * 1000,
        assignmentStart: start,
        assignmentEnd: end,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 1
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 0);
  assert.doesNotMatch(html, />0 min</);
});

test('strong native summary assignments prefer exact document titles over weak same-app buckets', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const rangeStart = dateStart + (21 * 60 + 40) * 60 * 1000;
  const rangeEnd = dateStart + (22 * 60 + 10) * 60 * 1000;
  const assignment = {
    app: 'Figma',
    title: 'macOS Big Sur icon template (Community)',
    appPath: '/Applications/Figma.app',
    bundleId: 'com.figma.Desktop',
    start: rangeStart,
    end: rangeEnd,
    duration: 15 * 60 * 1000,
    assignedDurationMs: 15 * 60 * 1000,
    assignmentStart: rangeStart,
    assignmentEnd: rangeEnd,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayZoom: 10
  };
  const overlaps = [
    {
      app: 'Figma',
      title: 'Figma',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: rangeStart + 5 * 60 * 1000,
      end: rangeStart + 5 * 60 * 1000 + 16 * 1000,
      duration: 16 * 1000
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: rangeStart + 7 * 60 * 1000,
      end: rangeStart + 21 * 60 * 1000,
      duration: 14 * 60 * 1000
    }
  ];

  const summary = context.getActivitySummaryForAssignmentWithinRange(
    overlaps,
    assignment,
    context.getActivitySummaryKey(assignment),
    rangeStart,
    rangeEnd
  );

  assert.equal(summary.title, 'macOS Big Sur icon template (Community)');
  assert.equal(summary.duration, 14 * 60 * 1000);
});

test('weak native summary assignments project to dominant same-app document rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const rangeStart = dateStart + (21 * 60 + 40) * 60 * 1000;
  const rangeEnd = dateStart + (22 * 60 + 10) * 60 * 1000;
  const weakFigmaStart = rangeStart + 5 * 60 * 1000;
  const weakFigmaEnd = weakFigmaStart + 16 * 1000;
  const documentStart = rangeStart + 7 * 60 * 1000;
  const documentEnd = documentStart + 14 * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 10,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [
      {
        app: 'Figma',
        title: 'Figma',
        appPath: '/Applications/Figma.app',
        bundleId: 'com.figma.Desktop',
        start: weakFigmaStart,
        end: weakFigmaEnd,
        duration: weakFigmaEnd - weakFigmaStart
      },
      {
        app: 'Figma',
        title: 'macOS Big Sur icon template (Community)',
        appPath: '/Applications/Figma.app',
        bundleId: 'com.figma.Desktop',
        start: documentStart,
        end: documentEnd,
        duration: documentEnd - documentStart
      }
    ],
    timeEntries: [{
      id: 'entry-figma',
      start: rangeStart,
      end: rangeEnd,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Figma',
        title: 'Figma',
        appPath: '/Applications/Figma.app',
        bundleId: 'com.figma.Desktop',
        start: rangeStart,
        end: rangeEnd,
        duration: documentEnd - documentStart,
        assignedDurationMs: documentEnd - documentStart,
        assignmentStart: rangeStart,
        assignmentEnd: rangeEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 10
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: rangeStart,
    end: rangeEnd,
    zoom: 10
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['14 min']);
});

test('native popup summary assignments render the saved logged duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atMs = (hours, minutes, seconds = 0, ms = 0) => (
    dateStart + (((hours * 60 + minutes) * 60 + seconds) * 1000) + ms
  );
  const rangeStart = atMs(21, 40);
  const rangeEnd = atMs(22, 10);
  const activities = [
    {
      app: 'Figma',
      title: 'Figma',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 45, 53, 688),
      end: atMs(21, 45, 55, 972),
      duration: 2284
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 46, 27, 186),
      end: atMs(21, 46, 28, 431),
      duration: 1245
    },
    {
      app: 'Figma',
      title: '',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 46, 28, 427),
      end: atMs(21, 46, 30, 428),
      duration: 2001
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 46, 30, 427),
      end: atMs(21, 46, 38, 49),
      duration: 7622
    },
    {
      app: 'Finder',
      title: 'Downloads',
      appPath: '/System/Library/CoreServices/Finder.app',
      bundleId: 'com.apple.finder',
      start: atMs(21, 46, 40, 427),
      end: atMs(21, 46, 47, 730),
      duration: 7303
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 46, 47, 727),
      end: atMs(21, 47, 43, 616),
      duration: 55889
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 47, 44, 207),
      end: atMs(21, 50, 37, 671),
      duration: 173464
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 52, 33, 671),
      end: atMs(21, 52, 35, 322),
      duration: 1651
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 52, 35, 766),
      end: atMs(21, 58, 48, 425),
      duration: 372659
    },
    {
      app: 'Figma',
      title: 'Home',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 58, 48, 424),
      end: atMs(21, 58, 50, 516),
      duration: 2092
    },
    {
      app: 'Figma',
      title: 'Stars, Icon, Shapes, Symbols, v2 (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 58, 50, 516),
      end: atMs(21, 59, 28, 424),
      duration: 37908
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(21, 59, 28, 423),
      end: atMs(22, 2, 59, 37),
      duration: 210614
    },
    {
      app: 'Figma',
      title: 'Figma',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(22, 2, 58, 422),
      end: atMs(22, 3, 8, 422),
      duration: 10000
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(22, 3, 8, 421),
      end: atMs(22, 3, 9, 787),
      duration: 1366
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(22, 3, 23, 198),
      end: atMs(22, 3, 36, 425),
      duration: 13227
    },
    {
      app: 'Figma',
      title: 'Figma',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(22, 3, 36, 422),
      end: atMs(22, 3, 40, 612),
      duration: 4190
    },
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template (Community)',
      appPath: '/Applications/Figma.app',
      bundleId: 'com.figma.Desktop',
      start: atMs(22, 3, 40, 422),
      end: atMs(22, 3, 41, 884),
      duration: 1462
    }
  ];
  const html = renderLoggedTimeEntriesHtml({
    zoom: 10,
    projects: [{ id: 'project-1', name: 'Oriel Demo Project', color: '#3b82f6' }],
    activities,
    timeEntries: [{
      id: 'entry-figma',
      start: rangeStart,
      end: rangeEnd,
      projectId: 'project-1',
      description: '',
      createdBy: 'manual',
      activities: [{
        app: 'Figma',
        title: 'macOS Big Sur icon template (Community)',
        appPath: '/Applications/Figma.app',
        bundleId: 'com.figma.Desktop',
        url: '',
        start: rangeStart,
        end: rangeEnd,
        duration: 897674,
        assignedDurationMs: 897674,
        assignmentStart: rangeStart,
        assignmentEnd: rangeEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 10
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: rangeStart,
    end: rangeEnd,
    zoom: 10
  }));
  // Logged duration (assignedDurationMs 897674 -> 15 min), not the 30 min span.
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['15 min']);
});

test('cross-zoom assignment blocks use standard styling and never overlap at any zoom level', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const projects = [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 13 * 60 * 60 * 1000,
      end: dateStart + (13 * 60 + 53) * 60 * 1000,
      duration: 53 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 14 * 60 * 60 * 1000,
      end: dateStart + (14 * 60 + 30) * 60 * 1000,
      duration: 30 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + 16 * 60 * 60 * 1000,
      end: dateStart + (16 * 60 + 16) * 60 * 1000,
      duration: 16 * 60 * 1000
    }
  ];
  const timeEntries = [
    makeActivityStreamTimeEntry({
      id: 'entry-1',
      dateStart,
      startMinute: 13 * 60,
      endMinute: 13 * 60 + 53,
      assignedMinutes: 53,
      assignmentDisplayZoom: 5
    }),
    makeActivityStreamTimeEntry({
      id: 'entry-2',
      dateStart,
      startMinute: 14 * 60,
      endMinute: 14 * 60 + 30,
      assignedMinutes: 30,
      assignmentDisplayZoom: 5
    }),
    makeActivityStreamTimeEntry({
      id: 'entry-3',
      dateStart,
      startMinute: 16 * 60,
      endMinute: 16 * 60 + 16,
      assignedMinutes: 16,
      assignmentDisplayZoom: 5
    })
  ];

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({ zoom, projects, activities, timeEntries });
    const styles = extractEntryStyles(html);
    const expectedBlockCount = zoom >= 10 ? 2 : 3;
    const expectedLabels = zoom === 15
      ? ['83 min', '16 min']
      : zoom >= 10
        ? ['83 min', '16 min']
        : ['53 min', '30 min', '16 min'];

    assert.equal(styles.length, expectedBlockCount, `Expected adjacent rendered blocks to merge at zoom ${zoom}`);
    styles.forEach(style => {
      assert.doesNotMatch(style.className, /\btime-entry-block--partial-assignment\b/);
      assertStyleMatchesRowGeometry(style, {
        top: style.top,
        height: style.height
      }, `assignment block at zoom ${zoom}`);
    });
    assertNoOverlappingBlockGeometry(styles, `assignment blocks at zoom ${zoom}`);
    assert.deepEqual(extractTimeEntryDurationLabels(html), expectedLabels);
  }
});

test('saved activity-stream assignment runs show the current visible Activity Stream duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + (9 * 60 + 12) * 60 * 1000;
  const end = dateStart + (9 * 60 + 14) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (9 * 60 + 10) * 60 * 1000,
      end: dateStart + (9 * 60 + 20) * 60 * 1000,
      duration: 10 * 60 * 1000
    }],
    timeEntries: [{
      id: 'entry-1',
      start,
      end,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start,
        end,
        duration: 75 * 1000,
        assignedDurationMs: 75 * 1000,
        assignmentStart: start,
        assignmentEnd: end,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 1
      }]
    }]
  });

  assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min']);
});

test('legacy activity-stream assignment repairs visible badge and range from current Activity Stream block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const visibleStart = dateStart + (9 * 60 + 19) * 60 * 1000;
  const savedStart = dateStart + (9 * 60 + 20) * 60 * 1000;
  const savedEnd = dateStart + (9 * 60 + 33) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: visibleStart,
      end: savedEnd,
      duration: 13.72 * 60 * 1000
    }],
    timeEntries: [{
      id: 'entry-1',
      start: savedStart,
      end: savedEnd,
      projectId: 'project-1',
      description: '',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: savedStart,
        end: savedEnd,
        duration: 12.73 * 60 * 1000,
        assignedDurationMs: 12.73 * 60 * 1000,
        assignmentStart: savedStart,
        assignmentEnd: savedEnd,
        assignmentSource: 'activity-stream'
      }]
    }]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: visibleStart,
    end: savedEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['13 min']);
});

test('legacy activity-stream repair deduplicates multiple saved fragments inside one visible block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const visibleStart = dateStart + (9 * 60 + 5) * 60 * 1000;
  const visibleEnd = dateStart + (9 * 60 + 20) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [
      {
        app: 'Codex',
        title: 'Codex',
        start: dateStart + (9 * 60 + 6) * 60 * 1000,
        end: dateStart + (9 * 60 + 14) * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        start: dateStart + (9 * 60 + 16) * 60 * 1000,
        end: dateStart + (9 * 60 + 19) * 60 * 1000
      }
    ],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 9 * 60 + 8,
        endMinute: 9 * 60 + 13,
        assignedMinutes: 5,
        assignmentModel: null
      }),
      makeActivityStreamTimeEntry({
        id: 'entry-2',
        dateStart,
        startMinute: 9 * 60 + 16,
        endMinute: 9 * 60 + 19,
        assignedMinutes: 3,
        assignmentModel: null
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: visibleStart,
    end: visibleEnd,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['8 min']);
});

test('legacy activity-stream assignment without matching activity data falls back to saved duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + (9 * 60 + 20) * 60 * 1000;
  const end = dateStart + (9 * 60 + 33) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 9 * 60 + 20,
        endMinute: 9 * 60 + 33,
        assignedMinutes: 13,
        assignmentModel: null
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start,
    end,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['13 min']);
});

test('grouped saved activity-stream summary assignments de-dupe visible projected duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (9 * 60 + 4) * 60 * 1000;
  const firstEnd = dateStart + (9 * 60 + 6) * 60 * 1000;
  const secondStart = dateStart + (9 * 60 + 6) * 60 * 1000;
  const secondEnd = dateStart + (9 * 60 + 8) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (9 * 60) * 60 * 1000,
      end: dateStart + (9 * 60 + 30) * 60 * 1000,
      duration: 30 * 60 * 1000
    }],
    timeEntries: [
      {
        id: 'entry-1',
        start: firstStart,
        end: firstEnd,
        projectId: 'project-1',
        description: '',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: firstStart,
          end: firstEnd,
          duration: 75 * 1000,
          assignedDurationMs: 75 * 1000,
          assignmentStart: firstStart,
          assignmentEnd: firstEnd,
          assignmentSource: 'activity-stream',
          assignmentModel: 'activity-stream-summary',
          assignmentDisplayZoom: 5
        }]
      },
      {
        id: 'entry-2',
        start: secondStart,
        end: secondEnd,
        projectId: 'project-1',
        description: '',
        activities: [{
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          bundleId: 'com.openai.codex',
          start: secondStart,
          end: secondEnd,
          duration: 45 * 1000,
          assignedDurationMs: 45 * 1000,
          assignmentStart: secondStart,
          assignmentEnd: secondEnd,
          assignmentSource: 'activity-stream',
          assignmentModel: 'activity-stream-summary',
          assignmentDisplayZoom: 5
        }]
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (9 * 60) * 60 * 1000,
    end: dateStart + (9 * 60 + 30) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('activity-stream assignment entries group across exact gaps hidden by adjacent display rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, assignedMinutes: 4 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 5, endMinute: 9 * 60 + 10, assignedMinutes: 5 }),
      makeActivityStreamTimeEntry({ id: 'entry-3', dateStart, startMinute: 9 * 60 + 12, endMinute: 9 * 60 + 18, assignedMinutes: 6 }),
      makeActivityStreamTimeEntry({ id: 'entry-4', dateStart, startMinute: 9 * 60 + 19, endMinute: 9 * 60 + 25, assignedMinutes: 5 })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (9 * 60) * 60 * 1000,
    end: dateStart + (9 * 60 + 25) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['20 min']);
});

test('screenshot-shaped adjacent assignment rows merge at 30 minute zoom', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 30,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 18 * 60 + 30,
        endMinute: 19 * 60,
        assignedMinutes: 14,
        assignmentDisplayZoom: 30
      }),
      makeActivityStreamTimeEntry({
        id: 'entry-2',
        dateStart,
        startMinute: 19 * 60,
        endMinute: 19 * 60 + 30,
        assignedMinutes: 2,
        assignmentDisplayZoom: 30
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (18 * 60 + 30) * 60 * 1000,
    end: dateStart + (19 * 60 + 30) * 60 * 1000,
    zoom: 30
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['16 min']);
});

test('screenshot-shaped adjacent assignment rows merge at 60 minute zoom', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 60,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 13 * 60,
        endMinute: 14 * 60,
        assignedMinutes: 51,
        assignmentDisplayZoom: 30
      }),
      makeActivityStreamTimeEntry({
        id: 'entry-2',
        dateStart,
        startMinute: 14 * 60,
        endMinute: 16 * 60,
        assignedMinutes: 29,
        assignmentDisplayZoom: 30
      })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + 13 * 60 * 60 * 1000,
    end: dateStart + 16 * 60 * 60 * 1000,
    zoom: 60
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['80 min']);
});

test('activity-stream assignment entries with gaps larger than zoom do not merge', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, assignedMinutes: 5 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 11, endMinute: 9 * 60 + 16, assignedMinutes: 5 })
    ]
  });

  assert.equal(extractEntryStyles(html).length, 2);
});

test('manual entries merge with activity-stream assignment entries for the same project and task', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, assignedMinutes: 5 }),
      {
        id: 'entry-2',
        start: dateStart + (9 * 60 + 5) * 60 * 1000,
        end: dateStart + (9 * 60 + 10) * 60 * 1000,
        projectId: 'project-1',
        taskId: 'task-1',
        description: 'Manual follow-up',
        activities: [{ app: 'Codex', assignedDurationMs: 5 * 60 * 1000 }]
      }
    ]
  });

  assert.equal(extractEntryStyles(html).length, 1);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['10 min']);
});

test('activity-stream assignment entries from different projects do not group', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [
      { id: 'project-1', name: 'Project One', color: '#3b82f6' },
      { id: 'project-2', name: 'Project Two', color: '#10b981' }
    ],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, projectId: 'project-1', taskId: '', assignedMinutes: 5 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 5, endMinute: 9 * 60 + 10, projectId: 'project-2', taskId: '', assignedMinutes: 5 })
    ]
  });

  assert.equal(extractEntryStyles(html).length, 2);
});

test('grouped activity-stream assignment block uses summed assigned duration for badge', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 25, assignedMinutes: 15 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 25, endMinute: 9 * 60 + 50, assignedMinutes: 20 })
    ]
  });

  assert.equal(extractEntryStyles(html).length, 1);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['35 min']);
});

test('grouped activity-stream assignment block has assignment CSS class', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 5, assignedMinutes: 5 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 5, endMinute: 9 * 60 + 10, assignedMinutes: 5 })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assert.match(styles[0].className, /time-entry-block--assigned/);
});

test('minimum height applies to grouped activity-stream assignment block instead of individual entries', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 30,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 1, assignedMinutes: 1 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 1, endMinute: 9 * 60 + 2, assignedMinutes: 1 }),
      makeActivityStreamTimeEntry({ id: 'entry-3', dateStart, startMinute: 9 * 60 + 2, endMinute: 9 * 60 + 3, assignedMinutes: 1 })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assert.equal(styles[0].height, 37);
});

test('cross-project time entries sharing a visual row render in separate horizontal lanes', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [
      { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' },
      { id: 'project-2', name: 'Test Project', color: '#f59e0b' }
    ],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (9 * 60 + 35) * 60 * 1000,
        end: dateStart + (9 * 60 + 52) * 60 * 1000,
        projectId: 'project-1',
        description: ''
      },
      {
        id: 'entry-2',
        start: dateStart + (9 * 60 + 50) * 60 * 1000,
        end: dateStart + (9 * 60 + 52) * 60 * 1000,
        projectId: 'project-2',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assert.equal(styles[0].left, '64px');
  assert.equal(styles[0].width, 'calc(50% - 40px)');
  assert.equal(styles[0].right, 'auto');
  assert.equal(styles[1].left, 'calc(50% + 28px)');
  assert.equal(styles[1].width, 'calc(50% - 40px)');
  assert.equal(styles[1].right, 'auto');
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (9 * 60 + 35) * 60 * 1000,
    end: dateStart + (9 * 60 + 52) * 60 * 1000,
    zoom: 5
  }));
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: dateStart + (9 * 60 + 50) * 60 * 1000,
    end: dateStart + (9 * 60 + 52) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['17 min', '2 min']);
});

test('same project and task overlapping entries merge into one full-width visual block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Oriel Time Tracker',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Implementation', archived: false }]
    }],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (11 * 60 + 5) * 60 * 1000,
        end: dateStart + (11 * 60 + 7) * 60 * 1000,
        projectId: 'project-1',
        taskId: 'task-1',
        description: ''
      },
      {
        id: 'entry-2',
        start: dateStart + (11 * 60 + 6) * 60 * 1000,
        end: dateStart + (11 * 60 + 10) * 60 * 1000,
        projectId: 'project-1',
        taskId: 'task-1',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assert.equal(styles[0].left, null);
  assert.equal(styles[0].width, null);
  assert.equal(styles[0].right, null);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: dateStart + (11 * 60 + 5) * 60 * 1000,
    end: dateStart + (11 * 60 + 10) * 60 * 1000,
    zoom: 5
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['6 min']);
});

test('same project with different tasks can share horizontal lanes', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Oriel Time Tracker',
      color: '#3b82f6',
      tasks: [
        { id: 'task-1', name: 'Implementation', archived: false },
        { id: 'task-2', name: 'Review', archived: false }
      ]
    }],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (11 * 60 + 5) * 60 * 1000,
        end: dateStart + (11 * 60 + 10) * 60 * 1000,
        projectId: 'project-1',
        taskId: 'task-1',
        description: ''
      },
      {
        id: 'entry-2',
        start: dateStart + (11 * 60 + 6) * 60 * 1000,
        end: dateStart + (11 * 60 + 10) * 60 * 1000,
        projectId: 'project-1',
        taskId: 'task-2',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assert.equal(styles[0].left, '64px');
  assert.equal(styles[1].left, 'calc(50% + 28px)');
  assert.deepEqual(styles.map(style => style.width), ['calc(50% - 40px)', 'calc(50% - 40px)']);
});

test('three simultaneous time entries split into three horizontal lanes', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 15,
    projects: [
      { id: 'project-1', name: 'Project One', color: '#3b82f6' },
      { id: 'project-2', name: 'Project Two', color: '#f59e0b' },
      { id: 'project-3', name: 'Project Three', color: '#10b981' }
    ],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + 9 * 60 * 60 * 1000,
        end: dateStart + (9 * 60 + 45) * 60 * 1000,
        projectId: 'project-1',
        description: ''
      },
      {
        id: 'entry-2',
        start: dateStart + (9 * 60 + 10) * 60 * 1000,
        end: dateStart + (9 * 60 + 35) * 60 * 1000,
        projectId: 'project-2',
        description: ''
      },
      {
        id: 'entry-3',
        start: dateStart + (9 * 60 + 15) * 60 * 1000,
        end: dateStart + (9 * 60 + 30) * 60 * 1000,
        projectId: 'project-3',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 3);
  assert.deepEqual(styles.map(style => style.left), ['64px', 'calc(33.333333% + 40px)', 'calc(66.666667% + 16px)']);
  assert.deepEqual(styles.map(style => style.width), [
    'calc(33.333333% - 28px)',
    'calc(33.333333% - 28px)',
    'calc(33.333333% - 28px)'
  ]);
  assert.deepEqual(styles.map(style => style.right), ['auto', 'auto', 'auto']);
});

test('standalone sub-minute logged entries are hidden from the Time Entries timeline', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }],
    timeEntries: [{
      id: 'entry-short',
      start: dateStart + (11 * 60 + 17) * 60 * 1000,
      end: dateStart + (11 * 60 + 17) * 60 * 1000 + 45 * 1000,
      projectId: 'project-1',
      description: ''
    }]
  });

  assert.equal(extractEntryStyles(html).length, 0);
  assert.doesNotMatch(html, />0 min</);
});

test('merged sub-minute entries render when grouped duration reaches one minute', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (11 * 60 + 56) * 60 * 1000;
  const secondStart = dateStart + (11 * 60 + 57) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [{ id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' }],
    timeEntries: [
      {
        id: 'entry-short-1',
        start: firstStart,
        end: firstStart + 45 * 1000,
        projectId: 'project-1',
        description: ''
      },
      {
        id: 'entry-short-2',
        start: secondStart,
        end: secondStart + 45 * 1000,
        projectId: 'project-1',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: secondStart + 45 * 1000,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('row-adjacent time entries keep full width when visual rows do not overlap', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [
      { id: 'project-1', name: 'Project One', color: '#3b82f6' },
      { id: 'project-2', name: 'Project Two', color: '#f59e0b' }
    ],
    timeEntries: [
      {
        id: 'entry-1',
        start: dateStart + (9 * 60 + 35) * 60 * 1000,
        end: dateStart + (9 * 60 + 50) * 60 * 1000,
        projectId: 'project-1',
        description: ''
      },
      {
        id: 'entry-2',
        start: dateStart + (9 * 60 + 50) * 60 * 1000,
        end: dateStart + (9 * 60 + 55) * 60 * 1000,
        projectId: 'project-2',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assert.deepEqual(styles.map(style => style.left), [null, null]);
  assert.deepEqual(styles.map(style => style.width), [null, null]);
  assert.deepEqual(styles.map(style => style.right), [null, null]);
});

test('saved Activity Stream row units keep full width across millisecond boundary overlap', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const boundary = dateStart + (9 * 60 + 50) * 60 * 1000;
  const project = { id: 'project-1', name: 'Personal', color: '#ef4444' };
  const rowUnitEntry = (id, start, end, title) => ({
    id,
    start,
    end,
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: [{
      app: 'Affinity',
      title,
      start,
      end,
      duration: end - start,
      assignedDurationMs: end - start,
      assignmentStart: start,
      assignmentEnd: end,
      assignmentDisplayStart: start,
      assignmentDisplayEnd: end,
      assignmentDisplayGroupKey: `${id}-display`,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 1,
      sources: [{
        app: 'Affinity',
        title,
        start,
        end,
        duration: end - start,
        assignedDurationMs: end - start
      }]
    }]
  });
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    timeEntries: [
      rowUnitEntry('entry-1', boundary - 82_666, boundary + 1, 'Affinity'),
      rowUnitEntry('entry-2', boundary, boundary + 166_004, 'Affinity - photo')
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assert.deepEqual(styles.map(style => style.left), [null, null]);
  assert.deepEqual(styles.map(style => style.width), [null, null]);
  assert.deepEqual(styles.map(style => style.right), [null, null]);
});

test('manual entries lane next to assignment groups without changing labels or group edit metadata', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [
      {
        id: 'project-1',
        name: 'Project One',
        color: '#3b82f6',
        tasks: [{ id: 'task-1', name: 'Development', archived: false }]
      },
      { id: 'project-2', name: 'Project Two', color: '#f59e0b' }
    ],
    timeEntries: [
      makeActivityStreamTimeEntry({
        id: 'entry-1',
        dateStart,
        startMinute: 9 * 60 + 35,
        endMinute: 9 * 60 + 45,
        assignedMinutes: 10
      }),
      makeActivityStreamTimeEntry({
        id: 'entry-2',
        dateStart,
        startMinute: 9 * 60 + 45,
        endMinute: 9 * 60 + 55,
        assignedMinutes: 10
      }),
      {
        id: 'entry-3',
        start: dateStart + (9 * 60 + 50) * 60 * 1000,
        end: dateStart + (9 * 60 + 52) * 60 * 1000,
        projectId: 'project-2',
        description: ''
      }
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 2);
  assert.match(styles[0].className, /time-entry-block--assigned/);
  assert.equal(styles[0].left, '64px');
  assert.equal(styles[0].width, 'calc(50% - 40px)');
  assert.equal(styles[1].left, 'calc(50% + 28px)');
  assert.equal(styles[1].width, 'calc(50% - 40px)');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['20 min', '2 min']);
  assert.deepEqual(extractGroupedEntryBounds(html), {
    start: dateStart + (9 * 60 + 35) * 60 * 1000,
    end: dateStart + (9 * 60 + 55) * 60 * 1000
  });
});

test('grouped activity-stream assignment block uses display rows but keeps exact edit bounds', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (9 * 60 + 2) * 60 * 1000;
  const secondEnd = dateStart + (9 * 60 + 4) * 60 * 1000;
  const html = renderLoggedTimeEntriesHtml({
    zoom: 10,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60 + 2, endMinute: 9 * 60 + 3, assignedMinutes: 1 }),
      makeActivityStreamTimeEntry({ id: 'entry-2', dateStart, startMinute: 9 * 60 + 3, endMinute: 9 * 60 + 4, assignedMinutes: 1 })
    ]
  });

  const styles = extractEntryStyles(html);
  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: secondEnd,
    zoom: 10
  }));
  assert.deepEqual(extractGroupedEntryBounds(html), {
    start: firstStart,
    end: secondEnd
  });
});

test('legacy activity-stream assignment envelopes render on display rows at every zoom level', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (13 * 60 + 16) * 60 * 1000;
  const firstEnd = dateStart + (13 * 60 + 21) * 60 * 1000;
  const secondStart = dateStart + (13 * 60 + 24) * 60 * 1000;
  const secondEnd = dateStart + (13 * 60 + 25) * 60 * 1000;
  const projects = [{
    id: 'project-1',
    name: 'Project One',
    color: '#3b82f6',
    tasks: [{ id: 'task-1', name: 'Development', archived: false }]
  }];
  const activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: firstStart,
      end: firstEnd,
      duration: firstEnd - firstStart
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: secondStart,
      end: secondEnd,
      duration: secondEnd - secondStart
    }
  ];
  const timeEntries = [{
    id: 'entry-1',
    start: dateStart + (13 * 60 + 15) * 60 * 1000,
    end: dateStart + (13 * 60 + 30) * 60 * 1000,
    projectId: 'project-1',
    taskId: 'task-1',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (13 * 60 + 15) * 60 * 1000,
      end: dateStart + (13 * 60 + 30) * 60 * 1000,
      assignedDurationMs: 15 * 60 * 1000,
      assignmentSource: 'activity-stream'
    }]
  }];

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({ zoom, projects, activities, timeEntries });
    const styles = extractEntryStyles(html);
    assert.equal(sumDurationLabelMinutes(extractTimeEntryDurationLabels(html)), 15, `Expected run duration sum at zoom ${zoom}`);

    for (const style of styles) {
      assert.equal((style.top - 2) % 40, 0, `Expected row-aligned top at zoom ${zoom}`);
      assert.equal((style.height + 3) % 40, 0, `Expected row-aligned height at zoom ${zoom}`);
    }

    if (zoom === 1) {
      assert.equal(styles.length, 2, `Expected separate assigned blocks at zoom ${zoom}`);
      assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
        dateStart,
        start: firstStart,
        end: firstEnd,
        zoom
      }), `first run at zoom ${zoom}`);
      assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
        dateStart,
        start: secondStart,
        end: secondEnd,
        zoom
      }), `second run at zoom ${zoom}`);
    } else {
      assert.equal(styles.length, 1, `Expected display-row grouping at zoom ${zoom}`);
      assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
        dateStart,
        start: firstStart,
        end: secondEnd,
        zoom
      }), `grouped runs at zoom ${zoom}`);
    }
  }
});

test('manual summary assignments with stale auto-rule flags render saved logged duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hours, minutes) => dateStart + (hours * 60 + minutes) * 60 * 1000;
  const rangeStart = at(21, 40);
  const rangeEnd = at(22, 10);
  const projects = [{ id: 'project-1', name: 'Oriel Demo Project', color: '#3b82f6' }];
  const activities = [
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template',
      bundleId: 'com.figma.Desktop',
      appPath: '/Applications/Figma.app',
      start: at(21, 50),
      end: at(22, 4),
      duration: 14 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      bundleId: 'com.openai.codex',
      appPath: '/Applications/Codex.app',
      start: at(22, 4),
      end: at(22, 5),
      duration: 60 * 1000
    }
  ];
  const timeEntries = [{
    id: 'entry-1',
    start: rangeStart,
    end: rangeEnd,
    projectId: 'project-1',
    taskId: '',
    description: '',
    createdBy: 'manual',
    activities: [
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
        assignmentModel: 'activity-stream-summary',
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
        assignmentModel: 'activity-stream-summary',
        autoAssigned: true,
        autoAssignmentRuleId: 'rule-1'
      }
    ]
  }];

  const html = renderLoggedTimeEntriesHtml({ timeEntries, projects, zoom: 10, activities });

  // Logged duration (14 min + 1 min assigned -> 15 min), not the 30 min span.
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['15 min']);
});

test('activity-stream assignment block without description renders project on the primary row', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 10,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [
      makeActivityStreamTimeEntry({ id: 'entry-1', dateStart, startMinute: 9 * 60, endMinute: 9 * 60 + 10, assignedMinutes: 10 })
    ]
  });
  const blockHtml = extractFirstTimeEntryBlockHtml(html);

  assert.match(blockHtml, /<div class="time-entry-main[^"]*">[\s\S]*project-marker[\s\S]*Project One[\s\S]*time-entry-duration/);
  assert.doesNotMatch(blockHtml, /class="time-entry-project\s/);
});

test('logged time entries without descriptions do not render redundant fallback labels', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [{
      id: 'entry-1',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + 10 * 60 * 60 * 1000,
      projectId: 'project-1',
      description: ''
    }]
  });

  assert.doesNotMatch(html, /Logged Entry/);
  assert.match(html, /Project One/);
  assert.match(html, /<span class="duration-pill time-entry-duration shrink-0">60 min<\/span>/);
});

test('logged time entries display their assigned task when present', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [{
      id: 'project-1',
      name: 'Project One',
      color: '#3b82f6',
      tasks: [{ id: 'task-1', name: 'Development', archived: false }]
    }],
    timeEntries: [{
      id: 'entry-1',
      projectId: 'project-1',
      taskId: 'task-1',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + 10 * 60 * 60 * 1000,
      description: 'Implementation'
    }]
  });

  assert.match(html, /Development/);
  assert.match(html, /time-entry-task/);
});

test('time entry hover preview snaps to one zoom row without initial duration', () => {
  const context = loadTimelineContext();
  const items = new FakeElement('time-entry-items');
  items.querySelector = selector => selector === '.time-entry-hover-preview' ? items.child || null : null;
  context.DOM.elItemsTimeEntries = items;
  context.document.createElement = () => new FakeElement('hover-preview');
  context.state.zoom = 15;

  context.showTimeEntryHoverPreview(12);

  assert.equal(items.child.className, 'time-entry-hover-preview');
  assert.equal(items.child.style.top, '482px');
  assert.equal(items.child.style.height, '37px');
  assert.match(items.child.innerHTML, /Click &amp; drag to log/);
  assert.doesNotMatch(items.child.innerHTML, /time-entry-hover-duration/);
  assert.doesNotMatch(items.child.innerHTML, /15 min/);

  context.hideTimeEntryHoverPreview();
  assert.equal(items.child.removed, true);
});

test('similar selection can match browser activities by base URL on the visible day', () => {
  const context = loadTimelineContext();

  function fakeBlock({ startCell, app, url = '', bundleId = '', selected = false }) {
    const classes = new Set(selected ? ['activity-block', 'selected'] : ['activity-block']);
    const checkboxClasses = new Set(selected ? ['activity-checkbox', 'is-selected'] : ['activity-checkbox']);
    const icon = { className: selected ? 'ph-fill ph-check-square text-base' : 'ph ph-square text-base' };
    const checkbox = {
      classList: {
        add: className => checkboxClasses.add(className),
        remove: className => checkboxClasses.delete(className),
        contains: className => checkboxClasses.has(className)
      }
    };

    return {
      dataset: { startCell: String(startCell), app, title: app, url, appPath: '', bundleId },
      classList: {
        add: className => classes.add(className),
        remove: className => classes.delete(className),
        contains: className => classes.has(className)
      },
      querySelector(selector) {
        if (selector === '.activity-checkbox') return checkbox;
        if (selector === '.activity-checkbox i') return icon;
        return null;
      }
    };
  }

  const blocks = [
    fakeBlock({ startCell: 1, app: 'Google Chrome', url: 'https://github.com/example', selected: true }),
    fakeBlock({ startCell: 8, app: 'Google Chrome', url: 'https://github.com/other' }),
    fakeBlock({ startCell: 12, app: 'Google Chrome', url: 'https://x.com/home' }),
    fakeBlock({ startCell: 20, app: 'Oriel', bundleId: 'so.sil.oriel' })
  ];

  context.state.selectedActivities.add(1);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [1, 8]);
  assert.equal(blocks[1].classList.contains('selected'), true);
  assert.equal(blocks[2].classList.contains('selected'), false);
  assert.equal(blocks[3].classList.contains('selected'), false);
});

test('similar selection keeps logged matches and summarizes selected logged state', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const loggedStart = dateStart + 10 * 60 * 1000;
  const unloggedStart = dateStart + 25 * 60 * 1000;
  const loggedActivity = {
    app: 'Google Chrome',
    title: 'Issue Tracker',
    url: 'https://github.com/example',
    start: loggedStart,
    end: loggedStart + 5 * 60 * 1000,
    duration: 5 * 60 * 1000
  };
  const unloggedActivity = {
    app: 'Google Chrome',
    title: 'Issue Tracker',
    url: 'https://github.com/other',
    start: unloggedStart,
    end: unloggedStart + 5 * 60 * 1000,
    duration: 5 * 60 * 1000
  };
  const blocks = [
    createSimilarActivityBlock({
      startCell: 10,
      app: 'Google Chrome',
      title: 'Issue Tracker',
      url: loggedActivity.url,
      selected: true,
      overlaps: [loggedActivity]
    }),
    createSimilarActivityBlock({
      startCell: 25,
      app: 'Google Chrome',
      title: 'Issue Tracker',
      url: unloggedActivity.url,
      overlaps: [unloggedActivity]
    })
  ];

  context.state.currentDate = new Date(dateStart);
  context.state.selectedActivities.add(10);
  context.state.timeEntries = [{
    id: 'entry-logged',
    start: loggedActivity.start,
    end: loggedActivity.end,
    projectId: 'project-1',
    activities: [{
      ...loggedActivity,
      assignedDurationMs: loggedActivity.duration,
      assignmentStart: loggedActivity.start,
      assignmentEnd: loggedActivity.end,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary'
    }]
  }];
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };
  context.DOM.elSelectedState = { innerText: '' };
  context.DOM.elBtnAssignSelected = new FakeElement('btn-assign-selected');

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [10, 25]);
  assert.equal(context.DOM.elSelectedCount.innerText, 2);
  assert.equal(context.DOM.elSelectedState.innerText, ' · 1 unlogged · 1 already logged');
  assert.equal(context.DOM.elBtnAssignSelected.disabled, false);
});

test('similar selection treats native activities with the same app name as similar even when metadata differs', () => {
  const context = loadTimelineContext();

  function fakeBlock({ startCell, app, appPath = '', bundleId = '', selected = false }) {
    const classes = new Set(selected ? ['activity-block', 'selected'] : ['activity-block']);
    const checkbox = { classList: { add() {}, remove() {} } };
    const icon = { className: '' };

    return {
      dataset: { startCell: String(startCell), app, title: app, url: '', appPath, bundleId },
      classList: {
        add: className => classes.add(className),
        remove: className => classes.delete(className),
        contains: className => classes.has(className)
      },
      querySelector(selector) {
        if (selector === '.activity-checkbox') return checkbox;
        if (selector === '.activity-checkbox i') return icon;
        return null;
      }
    };
  }

  const blocks = [
    fakeBlock({ startCell: 5, app: 'Codex', bundleId: 'com.openai.codex', selected: true }),
    fakeBlock({ startCell: 12, app: 'Codex' }),
    fakeBlock({ startCell: 20, app: 'Shottr', bundleId: 'cc.ffitch.shottr' })
  ];

  context.state.selectedActivities.add(5);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'app' }), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [5, 12]);
  assert.equal(blocks[1].classList.contains('selected'), true);
  assert.equal(blocks[2].classList.contains('selected'), false);
});

test('similar selection by exact URL does not select other pages on the same site', () => {
  const context = loadTimelineContext();

  function fakeBlock({ startCell, app, title = app, url = '', selected = false }) {
    const classes = new Set(selected ? ['activity-block', 'selected'] : ['activity-block']);
    const checkbox = { classList: { add() {}, remove() {} } };
    const icon = { className: '' };

    return {
      dataset: { startCell: String(startCell), app, title, url, appPath: '', bundleId: '' },
      classList: {
        add: className => classes.add(className),
        remove: className => classes.delete(className),
        contains: className => classes.has(className)
      },
      querySelector(selector) {
        if (selector === '.activity-checkbox') return checkbox;
        if (selector === '.activity-checkbox i') return icon;
        return null;
      }
    };
  }

  const blocks = [
    fakeBlock({
      startCell: 1,
      app: 'Brave Browser',
      title: 'AI bubble',
      url: 'https://www.youtube.com/watch?v=one',
      selected: true
    }),
    fakeBlock({
      startCell: 8,
      app: 'Brave Browser',
      title: 'Another video',
      url: 'https://www.youtube.com/watch?v=two'
    }),
    fakeBlock({
      startCell: 12,
      app: 'Brave Browser',
      title: 'AI bubble',
      url: 'https://www.youtube.com/watch?v=one'
    })
  ];

  context.state.selectedActivities.add(1);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'url' }), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [1, 12]);
  assert.equal(blocks[1].classList.contains('selected'), false);
  assert.equal(blocks[2].classList.contains('selected'), true);
});

test('similar base URL includes URL-unavailable browser rows with a known host', () => {
  const context = loadTimelineContext();
  const blocks = [
    createSimilarActivityBlock({
      startCell: 10,
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: '',
      domain: 'example.com',
      selected: true
    }),
    createSimilarActivityBlock({
      startCell: 18,
      app: 'Brave Browser',
      title: 'Example docs',
      url: '',
      domain: 'www.example.com'
    }),
    createSimilarActivityBlock({
      startCell: 24,
      app: 'Brave Browser',
      title: 'Example settings',
      url: 'https://example.com/settings'
    }),
    createSimilarActivityBlock({
      startCell: 32,
      app: 'Brave Browser',
      title: 'Private Window',
      url: ''
    })
  ];

  context.state.selectedActivities.add(10);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 3);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [10, 18, 24]);
  assert.equal(context.DOM.elSelectedCount.innerText, 3);
  assert.equal(blocks[1].classList.contains('selected'), true);
  assert.equal(blocks[2].classList.contains('selected'), true);
  assert.equal(blocks[3].classList.contains('selected'), false);
});

test('similar exact URL excludes URL-unavailable rows that only share a known host', () => {
  const context = loadTimelineContext();
  const blocks = [
    createSimilarActivityBlock({
      startCell: 10,
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: 'https://example.com/dashboard',
      selected: true
    }),
    createSimilarActivityBlock({
      startCell: 18,
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: '',
      domain: 'example.com'
    }),
    createSimilarActivityBlock({
      startCell: 24,
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: 'https://example.com/dashboard'
    })
  ];

  context.state.selectedActivities.add(10);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'url' }), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [10, 24]);
  assert.equal(blocks[1].classList.contains('selected'), false);
  assert.equal(blocks[2].classList.contains('selected'), true);
});

test('similar exact URL excludes grouped session host fallback rows', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atCell = cell => dateStart + cell * 5 * 60 * 1000;
  const groupedRows = [
    {
      app: 'Brave Browser',
      title: 'example.com/a',
      url: 'https://example.com/a',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: atCell(18),
      end: atCell(18) + 60 * 1000,
      duration: 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'example.com/b',
      url: 'https://example.com/b',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: atCell(18) + 2 * 60 * 1000,
      end: atCell(18) + 3 * 60 * 1000,
      duration: 60 * 1000
    }
  ];
  const blocks = [
    createSimilarActivityBlock({
      startCell: 10,
      app: 'Brave Browser',
      title: 'Example host root',
      url: 'https://example.com/',
      selected: true
    }),
    createSimilarActivityBlock({
      startCell: 18,
      app: 'Brave Browser',
      title: '',
      url: '',
      overlaps: groupedRows
    })
  ];

  context.state.selectedActivities.add(10);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'url' }), 1);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [10]);
  assert.equal(blocks[1].classList.contains('selected'), false);
});

test('rendered mixed rows expose the primary canonical URL for exact similarity', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atCell = cell => dateStart + cell * 5 * 60 * 1000;
  const groupedRows = [
    {
      app: 'Brave Browser',
      title: 'example.com/a',
      url: 'https://example.com/a',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: atCell(18),
      end: atCell(18) + 60 * 1000,
      duration: 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'example.com/b',
      url: 'https://example.com/b',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: atCell(18) + 2 * 60 * 1000,
      end: atCell(18) + 3 * 60 * 1000,
      duration: 60 * 1000
    }
  ];

  context.state.currentDate = new Date(2026, 4, 21);
  context.state.zoom = 5;

  const html = context.createActivityBlockHTML({
    startCell: 18,
    span: 1,
    app: 'Brave Browser',
    title: 'example.com',
    url: 'https://example.com/a',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    overlaps: groupedRows
  });

  assert.match(html, /data-url="https:\/\/example\.com\/a"/);
  assert.match(html, /data-similarity-url="https:\/\/example\.com\/a"/);
  assert.doesNotMatch(html, /data-url="https:\/\/example\.com"/);
});

test('similar base URL from a grouped review seed broadens exact activity identity to host', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atCell = cell => dateStart + cell * 5 * 60 * 1000;
  const sourceKey = activity => [
    activity.app,
    activity.title,
    activity.url,
    activity.appPath,
    activity.bundleId,
    activity.start,
    activity.end
  ].join('|||');
  const selectedSource = {
    app: 'Brave Browser',
    title: 'Example dashboard',
    url: 'https://example.com/dashboard',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start: atCell(10),
    end: atCell(11),
    duration: 5 * 60 * 1000
  };
  const blocks = [
    createSimilarActivityBlock({
      startCell: 10,
      app: 'Brave Browser',
      title: 'Selected Activities group',
      url: 'https://example.com/dashboard',
      selected: true,
      selectedSimilarityKeys: [sourceKey(selectedSource)],
      overlaps: [selectedSource]
    }),
    createSimilarActivityBlock({
      startCell: 18,
      app: 'Brave Browser',
      title: 'Example docs',
      url: 'https://example.com/docs'
    }),
    createSimilarActivityBlock({
      startCell: 24,
      app: 'Brave Browser',
      title: 'Other site',
      url: 'https://other.example.net/'
    })
  ];

  context.state.zoom = 5;
  context.state.selectedActivities.add(10);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [10, 18]);
  assert.equal(blocks[1].classList.contains('selected'), true);
  assert.equal(blocks[2].classList.contains('selected'), false);
});

test('similar base URL selection seeds from selected row identity instead of mixed detail overlaps', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const zoom = 5;
  const atCell = cell => dateStart + cell * zoom * 60 * 1000;
  const sourceAt = (cell, source, durationMs = zoom * 60 * 1000) => ({
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    ...source,
    start: atCell(cell),
    end: atCell(cell) + durationMs,
    duration: durationMs
  });
  const amazonSearch = {
    app: 'Brave Browser',
    title: 'Amazon search results for adapter',
    url: 'https://www.amazon.nl/s?k=adapter&ref=nb_sb_noss'
  };
  const chatgptSource = {
    app: 'Brave Browser',
    title: 'Research comparison',
    url: 'https://chatgpt.com/c/research-comparison'
  };
  const bolSource = {
    app: 'Brave Browser',
    title: 'Example shop checkout',
    url: 'https://www.bol.com/nl/nl/checkout/'
  };
  const githubSource = {
    app: 'Brave Browser',
    title: 'Repository pull request',
    url: 'https://github.com/example/project/pull/25'
  };
  const blocks = [
    createSimilarActivityBlock({
      startCell: 148,
      span: 1,
      selected: true,
      ...amazonSearch,
      overlaps: [
        sourceAt(148, amazonSearch),
        sourceAt(148, chatgptSource),
        sourceAt(148, bolSource),
        sourceAt(148, githubSource)
      ]
    }),
    createSimilarActivityBlock({
      startCell: 150,
      span: 1,
      app: 'Brave Browser',
      title: 'Amazon.nl - winkelwagen',
      url: 'https://www.amazon.nl/gp/cart/view.html',
      overlaps: [sourceAt(150, {
        app: 'Brave Browser',
        title: 'Amazon.nl - winkelwagen',
        url: 'https://www.amazon.nl/gp/cart/view.html'
      })]
    }),
    createSimilarActivityBlock({
      startCell: 147,
      span: 1,
      app: 'Brave Browser',
      title: 'Research comparison',
      url: 'https://chatgpt.com/c/research-comparison',
      overlaps: [
        sourceAt(147, amazonSearch, 20 * 1000),
        sourceAt(147, chatgptSource)
      ]
    }),
    createSimilarActivityBlock({
      startCell: 12,
      span: 1,
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      overlaps: [sourceAt(12, chatgptSource)]
    }),
    createSimilarActivityBlock({
      startCell: 144,
      span: 1,
      app: 'Brave Browser',
      title: 'Example shop checkout',
      url: 'https://www.bol.com/nl/nl/checkout/',
      overlaps: [sourceAt(144, bolSource)]
    }),
    createSimilarActivityBlock({
      startCell: 9,
      span: 1,
      app: 'Brave Browser',
      title: 'Repository pull request',
      url: 'https://github.com/example/project/pull/25',
      overlaps: [sourceAt(9, githubSource)]
    })
  ];

  context.state.zoom = zoom;
  context.state.selectedActivities.add(148);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [148, 150]);
  assert.equal(blocks[1].classList.contains('selected'), true);
  assert.equal(blocks[2].classList.contains('selected'), false);
  assert.equal(blocks[3].classList.contains('selected'), false);
  assert.equal(blocks[4].classList.contains('selected'), false);
  assert.equal(blocks[5].classList.contains('selected'), false);
  const selectedKeys = JSON.parse(decodeURIComponent(blocks[0].dataset.selectedSimilarityKeys));
  const expectedAmazonSourceKey = [
    amazonSearch.app,
    amazonSearch.title,
    amazonSearch.url,
    '/Applications/Brave Browser.app',
    'com.brave.Browser',
    atCell(148),
    atCell(149)
  ].join('|||');
  assert.equal(selectedKeys.includes('brave browser|||amazon.nl'), false);
  assert.equal(selectedKeys.includes(expectedAmazonSourceKey), true);
});

test('similar base URL selection clears stale nonmatching selected activity state', () => {
  const context = loadTimelineContext();
  const blocks = [
    createSimilarActivityBlock({
      startCell: 147,
      app: 'Brave Browser',
      title: 'Research comparison',
      url: 'https://chatgpt.com/c/research-comparison'
    }),
    createSimilarActivityBlock({
      startCell: 148,
      app: 'Brave Browser',
      title: 'Amazon search results for adapter',
      url: 'https://www.amazon.nl/s?k=adapter&ref=nb_sb_noss',
      selected: true
    }),
    createSimilarActivityBlock({
      startCell: 150,
      app: 'Brave Browser',
      title: 'Repository stars',
      url: 'https://github.com/example/project/stargazers'
    })
  ];

  context.state.selectedActivities.add(147);
  context.state.selectedActivities.add(148);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 1);
  assert.deepEqual([...context.state.selectedActivities], [148]);
  assert.equal(blocks[0].classList.contains('selected'), false);
  assert.equal(blocks[2].classList.contains('selected'), false);
});

test('similar base URL selection honors stored selected source keys for mixed rows', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atCell = cell => dateStart + cell * 5 * 60 * 1000;
  const amazonSource = {
    app: 'Brave Browser',
    title: 'Amazon.nl - winkelwagen',
    url: 'https://www.amazon.nl/cart',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start: atCell(144),
    end: atCell(145)
  };
  const chatgptSource = {
    app: 'Brave Browser',
    title: 'Research comparison',
    url: 'https://chatgpt.com/c/research-comparison',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start: atCell(144),
    end: atCell(145)
  };
  const blocks = [
    createSimilarActivityBlock({
      startCell: 144,
      app: 'Brave Browser',
      title: 'Research comparison',
      url: 'https://chatgpt.com/c/research-comparison',
      selected: true,
      selectedSimilarityKeys: ['brave browser|||amazon.nl'],
      overlaps: [amazonSource, chatgptSource]
    }),
    createSimilarActivityBlock({
      startCell: 160,
      app: 'Brave Browser',
      title: 'Other shopping activity',
      url: '',
      overlaps: [{
        ...amazonSource,
        title: 'Amazon.nl product',
        url: 'https://www.amazon.nl/product/example',
        start: atCell(160),
        end: atCell(161)
      }]
    }),
    createSimilarActivityBlock({
      startCell: 172,
      app: 'Brave Browser',
      title: 'Other ChatGPT activity',
      url: 'https://chatgpt.com/c/other',
      overlaps: [{
        ...chatgptSource,
        title: 'Other ChatGPT activity',
        url: 'https://chatgpt.com/c/other',
        start: atCell(172),
        end: atCell(173)
      }]
    })
  ];

  context.state.selectedActivities.add(144);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [144, 160]);
  assert.equal(blocks[1].classList.contains('selected'), true);
  assert.equal(blocks[2].classList.contains('selected'), false);
});

test('similar base URL selection includes popup-visible matching rows inside multiple activity blocks', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atCell = cell => dateStart + cell * 5 * 60 * 1000;
  const sourceAt = (cell, source, durationCells = 1) => ({
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    ...source,
    start: atCell(cell),
    end: atCell(cell + durationCells),
    duration: durationCells * 5 * 60 * 1000
  });
  const amazonSource = {
    app: 'Brave Browser',
    title: 'Amazon product page',
    url: 'https://www.amazon.nl/product/example'
  };
  const chatgptSource = {
    app: 'Brave Browser',
    title: 'Research comparison',
    url: 'https://chatgpt.com/c/research-comparison'
  };
  const mediaSource = {
    app: 'Music',
    title: 'Music',
    appPath: '/System/Applications/Music.app',
    bundleId: 'com.apple.Music',
    url: ''
  };
  const selectedAmazon = sourceAt(144, {
    app: 'Brave Browser',
    title: 'Amazon search results',
    url: 'https://www.amazon.nl/s?k=adapter'
  });
  const popupAmazon = sourceAt(150, amazonSource);
  const hiddenAmazon = {
    ...sourceAt(156, {
      ...amazonSource,
      title: 'Hidden Amazon scratch',
      url: 'https://www.amazon.nl/hidden'
    }),
    duration: 20 * 1000,
    end: atCell(156) + 20 * 1000
  };
  const blocks = [
    createSimilarActivityBlock({
      startCell: 144,
      span: 1,
      selected: true,
      app: selectedAmazon.app,
      title: selectedAmazon.title,
      url: selectedAmazon.url,
      appPath: selectedAmazon.appPath,
      bundleId: selectedAmazon.bundleId,
      overlaps: [selectedAmazon]
    }),
    createSimilarActivityBlock({
      startCell: 150,
      span: 1,
      app: 'Brave Browser',
      title: 'Research comparison',
      url: 'https://chatgpt.com/c/research-comparison',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      overlaps: [
        sourceAt(150, chatgptSource),
        popupAmazon,
        sourceAt(150, mediaSource)
      ]
    }),
    createSimilarActivityBlock({
      startCell: 156,
      span: 1,
      app: 'Music',
      title: 'Multiple Activities',
      appPath: '/System/Applications/Music.app',
      bundleId: 'com.apple.Music',
      overlaps: [
        hiddenAmazon,
        sourceAt(156, mediaSource)
      ]
    }),
    createSimilarActivityBlock({
      startCell: 162,
      span: 1,
      app: 'Brave Browser',
      title: 'Example shop checkout',
      url: 'https://www.bol.com/nl/nl/checkout/',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      overlaps: [sourceAt(162, {
        app: 'Brave Browser',
        title: 'Example shop checkout',
        url: 'https://www.bol.com/nl/nl/checkout/'
      })]
    })
  ];

  context.state.zoom = 5;
  context.state.selectedActivities.add(144);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 2);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [144, 150]);
  assert.equal(blocks[1].classList.contains('selected'), true);
  assert.equal(blocks[2].classList.contains('selected'), false);
  assert.equal(blocks[3].classList.contains('selected'), false);

  const selectedKeys = JSON.parse(decodeURIComponent(blocks[1].dataset.selectedSimilarityKeys));
  const expectedAmazonSourceKey = [
    popupAmazon.app,
    popupAmazon.title,
    popupAmazon.url,
    popupAmazon.appPath,
    popupAmazon.bundleId,
    popupAmazon.start,
    popupAmazon.end
  ].join('|||');
  assert.equal(selectedKeys.includes(expectedAmazonSourceKey), true);
  assert.equal(selectedKeys.some(key => key.includes('chatgpt.com')), false);
  assert.equal(selectedKeys.some(key => key.includes('com.apple.Music')), false);
});

test('similar selection scope survives activity stream re-render', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atCell = cell => dateStart + cell * 5 * 60 * 1000;
  const checkoutSource = {
    app: 'Brave Browser',
    title: 'bol | Bestellen',
    url: 'https://www.bol.com/nl/nl/checkout/',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start: atCell(144),
    end: atCell(145)
  };
  const basketSource = {
    ...checkoutSource,
    title: 'bol | Winkelwagen',
    url: 'https://www.bol.com/nl/nl/basket/',
    start: atCell(145),
    end: atCell(146)
  };
  const blocks = [
    createSimilarActivityBlock({
      startCell: 144,
      app: 'Brave Browser',
      title: 'bol | Bestellen',
      url: 'https://www.bol.com/nl/nl/checkout/',
      selected: true,
      overlaps: [checkoutSource]
    }),
    createSimilarActivityBlock({
      startCell: 145,
      app: 'Brave Browser',
      title: 'bol | Winkelwagen',
      url: 'https://www.bol.com/nl/nl/basket/',
      overlaps: [basketSource]
    })
  ];

  context.state.currentDate = new Date(2026, 4, 21);
  context.state.zoom = 5;
  context.state.selectedActivities.add(144);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 2);

  const checkoutHtml = context.createActivityBlockHTML({
    startCell: 144,
    span: 1,
    app: 'Brave Browser',
    title: 'bol | Bestellen',
    url: 'https://www.bol.com/nl/nl/checkout/',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    overlaps: [checkoutSource]
  });
  const basketHtml = context.createActivityBlockHTML({
    startCell: 145,
    span: 1,
    app: 'Brave Browser',
    title: 'bol | Winkelwagen',
    url: 'https://www.bol.com/nl/nl/basket/',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    overlaps: [basketSource]
  });

  assert.match(checkoutHtml, /data-selected-similarity-mode="host"/);
  assert.match(basketHtml, /data-selected-similarity-mode="host"/);
  assert.match(checkoutHtml, /data-selected-similarity-keys="/);
  assert.match(basketHtml, /data-selected-similarity-keys="/);
  assert.match(checkoutHtml, /bol%20%7C%20Bestellen/);
  assert.match(basketHtml, /bol%20%7C%20Winkelwagen/);
});

test('similar selection matches visible browser source activity by base URL at every zoom level', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const context = loadTimelineContext();
    context.state.zoom = zoom;
    const amazonSource = {
      app: 'Brave Browser',
      title: 'Amazon.nl - winkelwagen',
      url: 'https://www.amazon.nl/cart',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: dateStart + 12 * 60 * 60 * 1000,
      end: dateStart + (12 * 60 + zoom) * 60 * 1000
    };
    const otherAmazonSource = {
      ...amazonSource,
      title: 'Amazon.nl product',
      url: 'https://www.amazon.nl/product/example',
      start: dateStart + 13 * 60 * 60 * 1000,
      end: dateStart + (13 * 60 + zoom) * 60 * 1000
    };
    const blocks = [
      createSimilarActivityBlock({
        startCell: 12,
        app: 'Brave Browser',
        title: 'Amazon.nl - winkelwagen',
        url: 'https://www.amazon.nl/cart',
        selected: true,
        span: zoom,
        overlaps: [amazonSource]
      }),
      createSimilarActivityBlock({
        startCell: 72,
        app: 'Brave Browser',
        title: 'Amazon.nl product',
        url: 'https://www.amazon.nl/product/example',
        span: zoom,
        overlaps: [otherAmazonSource]
      }),
      createSimilarActivityBlock({
        startCell: 96,
        app: 'Brave Browser',
        title: 'Bol checkout',
        url: 'https://www.bol.com/nl/nl/checkout/',
        span: zoom,
        overlaps: [{
          ...amazonSource,
          title: 'Bol checkout',
          url: 'https://www.bol.com/nl/nl/checkout/'
        }]
      })
    ];

    context.state.selectedActivities.add(12);
    context.DOM.elItemsMemoryAid = {
      querySelectorAll(selector) {
        if (selector === '.activity-block.selected') {
          return blocks.filter(block => block.classList.contains('selected'));
        }
        if (selector === '.activity-block') return blocks;
        return [];
      }
    };
    context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
    context.DOM.elSelectedCount = { innerText: '' };

    assert.equal(context.selectSimilarActivities({ mode: 'host' }), 2, `zoom ${zoom}`);
    assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [12, 72], `zoom ${zoom}`);
    assert.equal(blocks[1].classList.contains('selected'), true, `zoom ${zoom}`);
    assert.equal(blocks[2].classList.contains('selected'), false, `zoom ${zoom}`);
  }
});

test('similar modal defaults native app selections to App Name and disables URL modes', () => {
  const context = loadTimelineContext();
  const modalDom = attachSimilarModalDom(context);
  const blocks = [
    createSimilarActivityBlock({
      startCell: 16,
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      selected: true
    })
  ];

  context.state.selectedActivities.add(16);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') return blocks.filter(block => block.classList.contains('selected'));
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };

  assert.equal(context.openSimilarSelectionModal(), true);
  assert.equal(modalDom.modal.classList.contains('hidden'), false);
  assert.equal(modalDom.host.radio.disabled, true);
  assert.equal(modalDom.url.radio.disabled, true);
  assert.equal(modalDom.host.option.classList.contains('is-disabled'), true);
  assert.equal(modalDom.url.option.classList.contains('is-disabled'), true);
  assert.equal(modalDom.host.option.getAttribute('aria-disabled'), 'true');
  assert.equal(modalDom.url.option.getAttribute('aria-disabled'), 'true');
  assert.equal(modalDom.app.radio.disabled, false);
  assert.equal(modalDom.appTitle.radio.disabled, false);
  assert.equal(modalDom.app.radio.checked, true);
  assert.equal(modalDom.host.radio.checked, false);
});

test('similar modal keeps URL modes enabled for browser activity with a usable URL', () => {
  const context = loadTimelineContext();
  const modalDom = attachSimilarModalDom(context);
  const activity = {
    app: 'Firefox Developer Edition',
    title: 'Docs',
    url: 'https://developer.mozilla.org/en-US/',
    appPath: '/Applications/Firefox Developer Edition.app',
    bundleId: 'org.mozilla.firefoxdeveloperedition'
  };
  const blocks = [
    createSimilarActivityBlock({ startCell: 22, ...activity, selected: true })
  ];

  context.state.selectedActivities.add(22);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') return blocks.filter(block => block.classList.contains('selected'));
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };

  assert.equal(context.isBrowserLikeActivity(activity), true);
  modalDom.app.radio.checked = true;
  modalDom.host.radio.checked = false;
  assert.equal(context.openSimilarSelectionModal(), true);
  assert.equal(modalDom.host.radio.disabled, false);
  assert.equal(modalDom.url.radio.disabled, false);
  assert.equal(modalDom.host.option.classList.contains('is-disabled'), false);
  assert.equal(modalDom.url.option.classList.contains('is-disabled'), false);
  assert.equal(modalDom.host.radio.checked, true);
  assert.equal(modalDom.app.radio.checked, false);
});

test('similar modal detects common browser variants for Base URL defaults', () => {
  const context = loadTimelineContext();
  const browsers = [
    { app: 'Google Chrome Beta', bundleId: 'com.google.Chrome.beta' },
    { app: 'Google Chrome Dev', bundleId: 'com.google.Chrome.dev' },
    { app: 'Firefox Nightly', bundleId: 'org.mozilla.nightly' },
    { app: 'Brave Browser Nightly', bundleId: 'com.brave.Browser.nightly' },
    { app: 'Microsoft Edge Dev', bundleId: 'com.microsoft.Edge.Dev' },
    { app: 'Arc', bundleId: 'company.thebrowser.Browser' },
    { app: 'Zen Browser', bundleId: 'app.zen-browser.zen' },
    { app: 'Mullvad Browser', bundleId: 'net.mullvad.MullvadBrowser' },
    { app: 'Opera GX', bundleId: 'com.operasoftware.OperaGX' },
    { app: 'Vivaldi Snapshot', bundleId: 'com.vivaldi.Vivaldi.snapshot' }
  ];

  for (const browser of browsers) {
    const activity = {
      ...browser,
      title: 'Example',
      url: 'https://example.com/'
    };
    assert.equal(context.isBrowserLikeActivity(activity), true, browser.app);
    assert.equal(context.getSimilarModeAvailability(activity).defaultMode, 'host', browser.app);
  }
});

test('similar modal defaults browser apps without usable URLs to App Name', () => {
  const context = loadTimelineContext();
  const modalDom = attachSimilarModalDom(context);
  const activity = {
    app: 'Safari',
    title: 'Private Window',
    url: '',
    appPath: '/Applications/Safari.app',
    bundleId: 'com.apple.Safari'
  };
  const blocks = [
    createSimilarActivityBlock({ startCell: 28, ...activity, selected: true })
  ];

  context.state.selectedActivities.add(28);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') return blocks.filter(block => block.classList.contains('selected'));
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };

  assert.equal(context.isBrowserLikeActivity(activity), true);
  assert.equal(context.openSimilarSelectionModal(), true);
  assert.equal(modalDom.host.radio.disabled, true);
  assert.equal(modalDom.url.radio.disabled, true);
  assert.equal(modalDom.app.radio.checked, true);
});

test('similar modal defaults browser rows with a known host to Base URL without enabling Exact URL', () => {
  const context = loadTimelineContext();
  const modalDom = attachSimilarModalDom(context);
  const activity = {
    app: 'Safari',
    title: 'Example workspace',
    url: '',
    domain: 'example.com',
    appPath: '/Applications/Safari.app',
    bundleId: 'com.apple.Safari'
  };
  const blocks = [
    createSimilarActivityBlock({ startCell: 28, ...activity, selected: true })
  ];

  context.state.selectedActivities.add(28);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') return blocks.filter(block => block.classList.contains('selected'));
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };

  assert.equal(context.isBrowserLikeActivity(activity), true);
  assert.equal(context.openSimilarSelectionModal(), true);
  assert.equal(modalDom.host.radio.disabled, false);
  assert.equal(modalDom.url.radio.disabled, true);
  assert.equal(modalDom.host.radio.checked, true);
  assert.equal(modalDom.app.radio.checked, false);
});

test('similar modal does not enable Exact URL from a display URL fallback', () => {
  const context = loadTimelineContext();
  const modalDom = attachSimilarModalDom(context);
  const blocks = [
    createSimilarActivityBlock({
      startCell: 28,
      app: 'Safari',
      title: 'Example workspace',
      url: 'https://example.com/display',
      domain: 'example.com',
      appPath: '/Applications/Safari.app',
      bundleId: 'com.apple.Safari',
      selected: true
    })
  ];
  blocks[0].dataset.similarityUrl = '';

  context.state.selectedActivities.add(28);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') return blocks.filter(block => block.classList.contains('selected'));
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };

  assert.equal(context.openSimilarSelectionModal(), true);
  assert.equal(modalDom.host.radio.disabled, false);
  assert.equal(modalDom.url.radio.disabled, true);
  assert.equal(modalDom.host.radio.checked, true);
});

test('similar toolbar action is available only for one selected activity', () => {
  const context = loadTimelineContext();
  const bar = new FakeElement('multi-select-bar');
  const similarButton = new FakeElement('btn-select-similar');
  const modal = new FakeElement('similar-modal');
  context.DOM.elMultiSelectBar = bar;
  context.DOM.elSelectedCount = { innerText: '' };
  context.DOM.elBtnSelectSimilar = similarButton;
  context.DOM.elSimilarModal = modal;

  context.state.selectedActivities.add(10);
  context.updateMultiSelectBar();
  assert.equal(bar.classList.contains('hidden'), false);
  assert.equal(similarButton.classList.contains('hidden'), false);
  assert.equal(similarButton.disabled, false);

  context.state.selectedActivities.add(20);
  context.updateMultiSelectBar();
  assert.equal(bar.classList.contains('hidden'), false);
  assert.equal(similarButton.classList.contains('hidden'), true);
  assert.equal(similarButton.disabled, true);
  assert.equal(modal.classList.contains('hidden'), true);

  context.state.selectedActivities.clear();
  context.updateMultiSelectBar();
  assert.equal(bar.classList.contains('hidden'), true);
  assert.equal(similarButton.classList.contains('hidden'), true);
  assert.equal(similarButton.disabled, true);
});

test('similar selection count uses canonical row units from grouped review rows', () => {
  const context = loadTimelineContext();
  const bar = new FakeElement('multi-select-bar');
  const similarButton = new FakeElement('btn-select-similar');
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atCell = cell => dateStart + cell * 5 * 60 * 1000;
  const groupedActivity = (startCell, title, url) => [
    {
      app: 'Brave Browser',
      title: `${title} page one`,
      url: `${url}?unit=1`,
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: atCell(startCell),
      end: atCell(startCell) + 60 * 1000,
      duration: 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: `${title} page two`,
      url: `${url}?unit=2`,
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: atCell(startCell) + 2 * 60 * 1000,
      end: atCell(startCell) + 4 * 60 * 1000,
      duration: 2 * 60 * 1000
    }
  ];
  const blocks = [
    createSimilarActivityBlock({
      startCell: 40,
      app: 'Brave Browser',
      title: 'Selected Activities group',
      url: 'https://example.com/dashboard',
      selected: true,
      overlaps: groupedActivity(40, 'Selected Activities group', 'https://example.com/dashboard')
    }),
    createSimilarActivityBlock({
      startCell: 44,
      app: 'Brave Browser',
      title: 'Selected Activities group',
      url: 'https://example.com/docs',
      overlaps: groupedActivity(44, 'Selected Activities group', 'https://example.com/docs')
    })
  ];

  context.state.selectedActivities.add(40);
  context.DOM.elMultiSelectBar = bar;
  context.DOM.elSelectedCount = { innerText: '' };
  context.DOM.elBtnSelectSimilar = similarButton;
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 2);

  assert.equal(context.DOM.elSelectedCount.innerText, 4);
  assert.equal(blocks[0].dataset.selectedCanonicalCount, '2');
  assert.equal(blocks[1].dataset.selectedCanonicalCount, '2');
  assert.equal(similarButton.classList.contains('hidden'), true);
  assert.equal(similarButton.disabled, true);
});

test('similar selection count keeps repeated same-identity grouped row units separate', () => {
  const context = loadTimelineContext();
  const bar = new FakeElement('multi-select-bar');
  const similarButton = new FakeElement('btn-select-similar');
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atCell = cell => dateStart + cell * 5 * 60 * 1000;
  const repeatedActivity = (firstCell, secondCell) => [
    {
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: 'https://example.com/dashboard',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: atCell(firstCell),
      end: atCell(firstCell) + 60 * 1000,
      duration: 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: 'https://example.com/dashboard',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: atCell(secondCell),
      end: atCell(secondCell) + 60 * 1000,
      duration: 60 * 1000
    }
  ];
  const blocks = [
    createSimilarActivityBlock({
      startCell: 40,
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: 'https://example.com/dashboard',
      selected: true,
      overlaps: repeatedActivity(40, 42)
    }),
    createSimilarActivityBlock({
      startCell: 44,
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: 'https://example.com/dashboard',
      overlaps: repeatedActivity(44, 46)
    })
  ];

  context.state.selectedActivities.add(40);
  context.DOM.elMultiSelectBar = bar;
  context.DOM.elSelectedCount = { innerText: '' };
  context.DOM.elBtnSelectSimilar = similarButton;
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 2);

  assert.equal(context.DOM.elSelectedCount.innerText, 4);
  assert.equal(blocks[0].dataset.selectedCanonicalCount, '2');
  assert.equal(blocks[1].dataset.selectedCanonicalCount, '2');
  assert.equal(similarButton.classList.contains('hidden'), true);
  assert.equal(similarButton.disabled, true);
});

test('similar selection count merges same-identity source fragments across session gap', () => {
  const context = loadTimelineContext();
  const bar = new FakeElement('multi-select-bar');
  const similarButton = new FakeElement('btn-select-similar');
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const atCell = cell => dateStart + cell * 5 * 60 * 1000;
  const fragmentedActivity = startCell => [
    {
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: 'https://example.com/dashboard',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: atCell(startCell),
      end: atCell(startCell) + 60 * 1000,
      duration: 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: 'https://example.com/dashboard',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start: atCell(startCell) + 70 * 1000,
      end: atCell(startCell) + 2 * 60 * 1000 + 10 * 1000,
      duration: 60 * 1000
    }
  ];
  const blocks = [
    createSimilarActivityBlock({
      startCell: 40,
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: 'https://example.com/dashboard',
      selected: true,
      overlaps: fragmentedActivity(40)
    }),
    createSimilarActivityBlock({
      startCell: 44,
      app: 'Brave Browser',
      title: 'Example dashboard',
      url: 'https://example.com/dashboard',
      overlaps: fragmentedActivity(44)
    })
  ];

  context.state.selectedActivities.add(40);
  context.DOM.elMultiSelectBar = bar;
  context.DOM.elSelectedCount = { innerText: '' };
  context.DOM.elBtnSelectSimilar = similarButton;
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 2);

  assert.equal(context.DOM.elSelectedCount.innerText, 2);
  assert.equal(blocks[0].dataset.selectedCanonicalCount, '1');
  assert.equal(blocks[1].dataset.selectedCanonicalCount, '1');
  assert.equal(similarButton.classList.contains('hidden'), true);
  assert.equal(similarButton.disabled, true);
});

test('similar selection ignores unrelated secondary overlaps for a selected visible activity', () => {
  const context = loadTimelineContext();

  function fakeBlock({
    startCell,
    app,
    title = app,
    url = '',
    appPath = '',
    bundleId = '',
    selected = false,
    overlaps = []
  }) {
    const classes = new Set(selected ? ['activity-block', 'selected'] : ['activity-block']);
    const checkbox = { classList: { add() {}, remove() {} } };
    const icon = { className: '' };

    return {
      dataset: {
        startCell: String(startCell),
        span: '1',
        app,
        title,
        url,
        appPath,
        bundleId,
        overlaps: encodeURIComponent(JSON.stringify(overlaps))
      },
      classList: {
        add: className => classes.add(className),
        remove: className => classes.delete(className),
        contains: className => classes.has(className)
      },
      querySelector(selector) {
        if (selector === '.activity-checkbox') return checkbox;
        if (selector === '.activity-checkbox i') return icon;
        return null;
      }
    };
  }

  const youtubeOverlap = {
    app: 'Brave Browser',
    title: 'AI bubble',
    url: 'https://www.youtube.com/watch?v=one',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start: 0,
    end: 12 * 60 * 1000
  };
  const codexOverlap = {
    app: 'Codex',
    title: 'Codex',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex',
    start: 0,
    end: 2 * 60 * 1000
  };
  const blocks = [
    fakeBlock({
      startCell: 18,
      app: 'Brave Browser',
      title: 'AI bubble',
      url: 'https://www.youtube.com/watch?v=one',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      selected: true,
      overlaps: [youtubeOverlap, codexOverlap]
    }),
    fakeBlock({
      startCell: 37,
      app: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      overlaps: [codexOverlap]
    }),
    fakeBlock({
      startCell: 48,
      app: 'Obsidian',
      appPath: '/Applications/Obsidian.app',
      bundleId: 'md.obsidian',
      overlaps: [{
        app: 'Obsidian',
        title: 'Obsidian',
        appPath: '/Applications/Obsidian.app',
        bundleId: 'md.obsidian',
        start: 0,
        end: 10 * 60 * 1000
      }]
    })
  ];

  context.state.selectedActivities.add(18);
  context.DOM.elItemsMemoryAid = {
    querySelectorAll(selector) {
      if (selector === '.activity-block.selected') {
        return blocks.filter(block => block.classList.contains('selected'));
      }
      if (selector === '.activity-block') return blocks;
      return [];
    }
  };
  context.DOM.elMultiSelectBar = { classList: { add() {}, remove() {} } };
  context.DOM.elSelectedCount = { innerText: '' };

  assert.equal(context.selectSimilarActivities({ mode: 'host' }), 1);
  assert.deepEqual([...context.state.selectedActivities].sort((a, b) => a - b), [18]);
  assert.equal(blocks[1].classList.contains('selected'), false);
  assert.equal(blocks[2].classList.contains('selected'), false);
});

test('recorded activity duration preserves canonical row-unit duration across zooms', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const title = 'Product setup walkthrough';
  const activities = [
    {
      start: dateStart + (14 * 60 + 25) * 60 * 1000,
      end: dateStart + (14 * 60 + 28) * 60 * 1000 + 43000,
      app: 'Preview',
      title: 'Reference Image',
      url: ''
    },
    {
      start: dateStart + (14 * 60 + 29) * 60 * 1000 + 4428,
      end: dateStart + (14 * 60 + 32) * 60 * 1000 + 21025,
      app: 'Brave Browser',
      title,
      url: 'https://video.example.test/watch/product-setup'
    }
  ];

  const oneMinuteHtml = renderMemoryAidHtml({ activities, zoom: 1 });
  const fiveMinuteHtml = renderMemoryAidHtml({ activities, zoom: 5 });

  assert.equal(extractActivityDuration(oneMinuteHtml, title), '3 min');
  assert.equal(extractActivityDuration(fiveMinuteHtml, title), '3 min');
});

test('activity stream uses exact geometry only at one-minute zoom', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + (18 * 60 + 30) * 60 * 1000 + 33 * 1000;
  const end = start + 90 * 1000;
  const activity = codexActivity(start, end);

  const oneMinuteHtml = renderMemoryAidHtml({
    zoom: 1,
    activities: [activity],
    timelineActivities: [activity]
  });
  const fiveMinuteHtml = renderMemoryAidHtml({
    zoom: 5,
    activities: [activity],
    timelineActivities: [activity]
  });
  const tenMinuteHtml = renderMemoryAidHtml({
    zoom: 10,
    activities: [activity],
    timelineActivities: [activity]
  });
  const oneMinuteStyles = extractActivityStyles(oneMinuteHtml);
  const fiveMinuteStyles = extractActivityStyles(fiveMinuteHtml);
  const tenMinuteStyles = extractActivityStyles(tenMinuteHtml);

  assert.equal(oneMinuteStyles.length, 1);
  assert.equal(fiveMinuteStyles.length, 1);
  assert.equal(tenMinuteStyles.length, 1);
  assertStyleNearlyMatchesGeometry(oneMinuteStyles[0], expectedExactGeometry({
    dateStart,
    start,
    end,
    zoom: 1
  }), 'one-minute foreground run');
  assertStyleMatchesRowGeometry(fiveMinuteStyles[0], expectedRowGeometry({
    dateStart,
    start,
    end,
    zoom: 5
  }), 'five-minute foreground run');
  assert.doesNotMatch(fiveMinuteStyles[0].className, /activity-block--tick/);
  assertStyleMatchesRowGeometry(tenMinuteStyles[0], expectedRowGeometry({
    dateStart,
    start,
    end,
    zoom: 10
  }), 'ten-minute foreground run');
  assert.doesNotMatch(tenMinuteStyles[0].className, /activity-block--tick/);
});

test('same-app fragments interrupted by short foreground switches render one readable exact session', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + 10 * 60 * 60 * 1000;
  const firstEnd = firstStart + 65 * 1000;
  const firstInterruptionEnd = firstEnd + 10 * 1000;
  const secondEnd = firstInterruptionEnd + 70 * 1000;
  const secondInterruptionEnd = secondEnd + 10 * 1000;
  const activities = [
    codexActivity(firstStart, firstEnd),
    {
      app: 'Oriel',
      title: 'Oriel',
      appPath: '/Applications/Oriel.app',
      bundleId: 'so.sil.oriel',
      start: firstEnd,
      end: firstInterruptionEnd,
      duration: 10 * 1000
    },
    codexActivity(firstInterruptionEnd, secondEnd),
    {
      app: 'Oriel',
      title: 'Oriel',
      appPath: '/Applications/Oriel.app',
      bundleId: 'so.sil.oriel',
      start: secondEnd,
      end: secondInterruptionEnd,
      duration: 10 * 1000
    },
    codexActivity(secondInterruptionEnd, secondInterruptionEnd + 25 * 1000)
  ];
  const html = renderMemoryAidHtml({
    zoom: 1,
    activities,
    timelineActivities: activities
  });
  const styles = extractActivityStyles(html);
  const codexStyles = styles.filter(style => style.className.includes('activity-block'));
  const thirdEnd = secondInterruptionEnd + 25 * 1000;

  assert.equal(styles.length, 1);
  assertNoOverlappingBlockGeometry(styles, 'foreground activity blocks');
  assertStyleNearlyMatchesGeometry(codexStyles[0], expectedExactGeometry({
    dateStart,
    start: firstStart,
    end: thirdEnd,
    zoom: 1
  }), 'Codex session');
  assert.equal([...html.matchAll(/data-title="Codex"/g)].length, 1);
  assert.match(html, /data-active-duration-ms="160000"/);
});

test('alternating sub-minute foreground fragments do not render titleless Activity Stream lanes', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const base = dateStart + (11 * 60 + 18) * 60 * 1000;
  const activities = [
    {
      app: 'Oriel',
      title: 'Oriel',
      appPath: '/Applications/Oriel.app',
      bundleId: 'so.sil.oriel',
      start: base + 32 * 1000,
      end: base + 77 * 1000,
      duration: 45 * 1000
    },
    codexActivity(base + 77 * 1000, base + 84 * 1000),
    {
      app: 'Oriel',
      title: 'Oriel',
      appPath: '/Applications/Oriel.app',
      bundleId: 'so.sil.oriel',
      start: base + 84 * 1000,
      end: base + 99 * 1000,
      duration: 15 * 1000
    },
    codexActivity(base + 99 * 1000, base + 153 * 1000)
  ];

  const html = renderMemoryAidHtml({
    zoom: 1,
    activities,
    timelineActivities: activities
  });
  const styles = extractActivityStyles(html);

  assert.equal(styles.length, 0);
  assertNoOverlappingBlockGeometry(styles, 'alternating foreground activity');
  for (const style of styles) {
    assert.equal(style.left, null);
    assert.equal(style.width, null);
    assert.equal(style.right, null);
  }
});

test('short standalone activity fragments stay hidden instead of rendering titleless strips', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + 11 * 60 * 60 * 1000;
  const activities = [
    {
      start,
      end: start + 59 * 1000,
      app: 'Short App',
      title: 'Short App',
      url: ''
    },
    codexActivity(start + 2 * 60 * 1000, start + 2 * 60 * 1000 + 30 * 1000),
    codexActivity(start + 2 * 60 * 1000 + 40 * 1000, start + 2 * 60 * 1000 + 71 * 1000),
    codexActivity(start + 2 * 60 * 1000 + 80 * 1000, start + 2 * 60 * 1000 + 105 * 1000)
  ];

  const html = renderMemoryAidHtml({
    zoom: 1,
    activities,
    timelineActivities: activities
  });

  assert.equal(extractActivityStyles(html).length, 1);
  assert.doesNotMatch(html, /data-title="Short App"/);
  assert.match(html, /data-title="Codex"/);
});

test('dense sub-minute Activity Stream fragments summarize at coarse zoom instead of rendering tick bars', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const base = dateStart + 13 * 60 * 60 * 1000;
  const activities = [];

  for (let index = 0; index < 24; index++) {
    const fragmentStart = base + index * 30 * 1000;
    activities.push(codexActivity(fragmentStart, fragmentStart + 20 * 1000));
    activities.push({
      app: 'Oriel',
      title: 'Oriel',
      appPath: '/Applications/Oriel.app',
      bundleId: 'so.sil.oriel',
      start: fragmentStart + 20 * 1000,
      end: fragmentStart + 30 * 1000,
      duration: 10 * 1000
    });
  }

  const html = renderMemoryAidHtml({
    zoom: 15,
    activities,
    timelineActivities: activities
  });
  const styles = extractActivityStyles(html);

  assert.equal(styles.length, 1);
  assert.doesNotMatch(html, /activity-block--tick/);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: base,
    end: base + 15 * 60 * 1000,
    zoom: 15
  }));
});

test('coarse Activity Stream same-app rows split when source activity is not continuous', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + 13 * 60 * 60 * 1000;
  const firstEnd = firstStart + 20 * 60 * 1000;
  const secondStart = dateStart + (14 * 60 + 35) * 60 * 1000;
  const secondEnd = secondStart + 20 * 60 * 1000;
  const activities = [
    codexActivity(firstStart, firstEnd),
    codexActivity(secondStart, secondEnd)
  ];
  const html = renderMemoryAidHtml({
    zoom: 60,
    activities,
    timelineActivities: activities
  });
  const styles = extractActivityStyles(html);

  assert.equal(styles.length, 2);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: firstEnd,
    zoom: 60
  }), 'first coarse activity row');
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: secondStart,
    end: secondEnd,
    zoom: 60
  }), 'second coarse activity row');
  assert.deepEqual(
    [...html.matchAll(/data-active-duration-ms="([^"]+)"/g)].map(match => Number(match[1])),
    [20 * 60 * 1000, 20 * 60 * 1000]
  );
});

test('coarse Activity Stream merges a contiguous same-app run across a sub-row gap into one block', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hour, minute) => dateStart + (hour * 60 + minute) * 60 * 1000;
  // One continuous Codex work run, internally split by a 60s gap (longer than
  // the 15s session-merge gap, shorter than a 5-min row) and spanning four
  // 5-min cells. The user assigns it as one block at coarse zoom.
  const activities = [
    codexActivity(at(13, 0), at(13, 10)),
    codexActivity(at(13, 11), at(13, 20))
  ];
  const html = renderMemoryAidHtml({
    zoom: 5,
    currentDate: new Date(2026, 4, 21),
    activities,
    timelineActivities: activities
  });
  const codexBlocks = extractActivityBlocks(html).filter(block => block.app === 'Codex');

  assert.equal(codexBlocks.length, 1, 'contiguous Codex run renders as one merged block');
  assert.equal(codexBlocks[0].pill, '19 min', 'merged pill is the deduped run total (10 + 9 min)');
});

test('coarse Activity Stream block keeps its own app label and duration when a longer-titled app shares its cells', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const at = (hour, minute) => dateStart + (hour * 60 + minute) * 60 * 1000;
  const braveTab = (start, end) => ({
    app: 'Brave Browser',
    title: 'extended deep focus playlist for long coding sessions',
    url: 'https://www.youtube.com/watch?v=focusmix',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start,
    end,
    duration: end - start
  });
  // Codex (bare app-name title) runs first, then a longer-titled Brave tab whose
  // whole session overlaps the boundary cell. The Codex block must keep its own
  // label and its own duration — not borrow the Brave title nor sum Brave's time.
  const activities = [
    codexActivity(at(13, 0), at(13, 13)),
    braveTab(at(13, 13), at(13, 30))
  ];
  const html = renderMemoryAidHtml({
    zoom: 5,
    currentDate: new Date(2026, 4, 21),
    activities,
    timelineActivities: activities
  });
  const blocks = extractActivityBlocks(html);
  const codexBlock = blocks.find(block => block.app === 'Codex');
  const braveBlock = blocks.find(block => block.app === 'Brave Browser');

  assert.ok(codexBlock, 'a Codex-labeled block exists');
  assert.equal(codexBlock.title, 'Codex', 'Codex block keeps its own label');
  assert.equal(codexBlock.pill, '13 min', 'Codex pill is its own duration, not inflated by the concurrent Brave tab');
  assert.ok(braveBlock, 'the Brave tab is still represented as its own block');
});

test('activity popup assigns exact foreground source duration instead of elapsed interruption envelope', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (18 * 60 + 33) * 60 * 1000 + 10 * 1000;
  const firstEnd = firstStart + 90 * 1000;
  const interruptionEnd = firstEnd + 15 * 1000;
  const secondEnd = interruptionEnd + 90 * 1000;
  const activeDurationMs = 180 * 1000;
  const elapsedDurationMs = secondEnd - firstStart;
  const popup = renderMultipleActivitiesPopup({
    app: 'Codex',
    title: 'Codex',
    startCell: 1113,
    span: 4,
    overlaps: [
      codexActivity(firstStart, firstEnd),
      {
        app: 'Brave Browser',
        title: 'Reference interruption',
        url: 'https://example.com/reference',
        start: firstEnd,
        end: interruptionEnd,
        duration: interruptionEnd - firstEnd
      },
      codexActivity(interruptionEnd, secondEnd)
    ],
    datasetOverrides: {
      startMs: String(firstStart),
      endMs: String(secondEnd),
      activeDurationMs: String(activeDurationMs),
      elapsedDurationMs: String(elapsedDurationMs),
      interruptionCount: '1'
    }
  });

  assert.equal(popup.context.DOM.elPopupDuration.innerText, '3 min');
  assert.equal(popup.context.DOM.elPopupDuration.title, 'Active 3 min · elapsed 3 min · 1 interruption');
  assert.equal(popup.context.DOM.elPopupRange.innerText, '18:33 – 18:36');

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Activities');
  assert.equal(popup.popupRows.length, 2);
  popup.popupRows[0].querySelector('.popup-activity-select').click();
  popup.popupRows[1].querySelector('.popup-activity-select').click();
  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[0], firstStart);
  assert.equal(popup.modalArgs[1], secondEnd);
  assert.equal(popup.modalArgs[6].length, 2);
  assert.equal(popup.modalArgs[6].map(activity => activity.app).join(','), 'Codex,Codex');
  assert.equal(
    popup.modalArgs[6].reduce((total, activity) => total + activity.assignedDurationMs, 0),
    activeDurationMs
  );
  assert.ok(popup.modalArgs[6].every(activity => activity.duration !== elapsedDurationMs));
});

test('auto-rule time entries aggregate short-gap exact fragments without counting interruptions', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const firstStart = dateStart + (18 * 60 + 33) * 60 * 1000 + 10 * 1000;
  const firstEnd = firstStart + 70 * 1000;
  const secondStart = firstEnd + 10 * 1000;
  const secondEnd = secondStart + 65 * 1000;
  const activities = [
    codexActivity(firstStart, firstEnd),
    {
      app: 'Oriel',
      title: 'Oriel',
      appPath: '/Applications/Oriel.app',
      bundleId: 'so.sil.oriel',
      start: firstEnd,
      end: secondStart,
      duration: secondStart - firstEnd
    },
    codexActivity(secondStart, secondEnd)
  ];
  const timeEntries = [
    makeAutoRuleEntry({ id: 'entry-auto-1', start: firstStart, end: firstEnd }),
    makeAutoRuleEntry({ id: 'entry-auto-2', start: secondStart, end: secondEnd })
  ];

  context.state.activities = activities;
  context.state.timeEntries = timeEntries;
  context.state.projects = [project];
  const renderItems = context.buildLoggedTimeEntryRenderItems(timeEntries, 1, dateStart);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const styles = extractEntryStyles(html);

  assert.equal(renderItems.length, 1);
  assert.equal(renderItems[0].start, firstStart);
  assert.equal(renderItems[0].end, secondEnd);
  assert.equal(renderItems[0].durationMs, 135 * 1000);
  assert.equal(styles.length, 1);
  assertNoOverlappingBlockGeometry(styles, 'auto-rule session');
  assertStyleNearlyMatchesGeometry(styles[0], expectedExactGeometry({
    dateStart,
    start: firstStart,
    end: secondEnd,
    zoom: 1
  }), 'auto-rule session');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('one-minute auto-rule entries merge near-continuous same-source capture fragments', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const firstStart = dateStart + (10 * 60 + 12) * 60 * 1000 + 5 * 1000;
  const firstEnd = firstStart + 45 * 1000;
  const secondStart = firstEnd + 1000;
  const secondEnd = secondStart + 45 * 1000;
  const activities = [
    codexActivity(firstStart, firstEnd),
    codexActivity(secondStart, secondEnd)
  ];
  const timeEntries = [
    makeAutoRuleEntry({ id: 'entry-auto-near-1', start: firstStart, end: firstEnd }),
    makeAutoRuleEntry({ id: 'entry-auto-near-2', start: secondStart, end: secondEnd })
  ];

  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleNearlyMatchesGeometry(styles[0], expectedExactGeometry({
    dateStart,
    start: firstStart,
    end: secondEnd,
    zoom: 1
  }), 'near-continuous auto-rule capture');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('auto-rule time entries render sub-minute exact fragments when session total reaches one minute', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const firstStart = dateStart + (15 * 60 + 5) * 60 * 1000;
  const firstEnd = firstStart + 20 * 1000;
  const secondStart = firstEnd + 10 * 1000;
  const secondEnd = secondStart + 59 * 1000;
  const thirdStart = secondEnd + 10 * 1000;
  const thirdEnd = thirdStart + 60 * 1000;
  const activities = [
    codexActivity(firstStart, firstEnd),
    {
      app: 'Oriel',
      title: 'Oriel',
      appPath: '/Applications/Oriel.app',
      bundleId: 'so.sil.oriel',
      start: firstEnd,
      end: secondStart,
      duration: secondStart - firstEnd
    },
    codexActivity(secondStart, secondEnd),
    {
      app: 'Oriel',
      title: 'Oriel',
      appPath: '/Applications/Oriel.app',
      bundleId: 'so.sil.oriel',
      start: secondEnd,
      end: thirdStart,
      duration: thirdStart - secondEnd
    },
    codexActivity(thirdStart, thirdEnd)
  ];
  const timeEntries = [
    makeAutoRuleEntry({ id: 'entry-auto-hidden-1', start: firstStart, end: firstEnd }),
    makeAutoRuleEntry({ id: 'entry-auto-hidden-2', start: secondStart, end: secondEnd }),
    makeAutoRuleEntry({ id: 'entry-auto-visible', start: thirdStart, end: thirdEnd })
  ];

  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    activities,
    timeEntries
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleNearlyMatchesGeometry(styles[0], expectedExactGeometry({
    dateStart,
    start: firstStart,
    end: thirdEnd,
    zoom: 1
  }), 'readable auto-rule session');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min']);
});

test('source-backed Time Entries align with matching Activity Stream geometry at active zoom levels', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const scenarios = [
    {
      zoom: 1,
      activityStart: dateStart + (10 * 60 + 12) * 60 * 1000 + 5 * 1000,
      activityEnd: dateStart + (10 * 60 + 14) * 60 * 1000 + 5 * 1000,
      fragments: [
        [dateStart + (10 * 60 + 12) * 60 * 1000 + 5 * 1000, dateStart + (10 * 60 + 14) * 60 * 1000 + 5 * 1000]
      ]
    },
    {
      zoom: 10,
      activityStart: dateStart + (20 * 60 + 30) * 60 * 1000,
      activityEnd: dateStart + (21 * 60 + 10) * 60 * 1000,
      fragments: [
        [dateStart + (20 * 60 + 31) * 60 * 1000, dateStart + (20 * 60 + 36) * 60 * 1000],
        [dateStart + (20 * 60 + 42) * 60 * 1000, dateStart + (20 * 60 + 46) * 60 * 1000],
        [dateStart + (20 * 60 + 52) * 60 * 1000, dateStart + (20 * 60 + 55) * 60 * 1000],
        [dateStart + (21 * 60 + 2) * 60 * 1000, dateStart + (21 * 60 + 4) * 60 * 1000]
      ]
    },
    {
      zoom: 15,
      activityStart: dateStart + (18 * 60 + 30) * 60 * 1000,
      activityEnd: dateStart + (19 * 60 + 15) * 60 * 1000,
      fragments: [
        [dateStart + (18 * 60 + 34) * 60 * 1000, dateStart + (18 * 60 + 39) * 60 * 1000],
        [dateStart + (18 * 60 + 49) * 60 * 1000, dateStart + (18 * 60 + 54) * 60 * 1000],
        [dateStart + (19 * 60 + 4) * 60 * 1000, dateStart + (19 * 60 + 7) * 60 * 1000]
      ]
    }
  ];

  for (const scenario of scenarios) {
    const activities = [codexActivity(scenario.activityStart, scenario.activityEnd)];
    const timeEntries = scenario.fragments.map(([start, end], index) => makeAutoRuleEntry({
      id: `entry-align-${scenario.zoom}-${index}`,
      start,
      end,
      projectId: project.id
    }));
    const activityHtml = renderMemoryAidHtml({
      zoom: scenario.zoom,
      activities,
      timelineActivities: activities
    });
    const entryHtml = renderLoggedTimeEntriesHtml({
      zoom: scenario.zoom,
      projects: [project],
      activities,
      timeEntries
    });
    const [activityStyle] = extractActivityStyles(activityHtml);
    const [entryStyle] = extractEntryStyles(entryHtml);

    assert.equal(extractActivityStyles(activityHtml).length, 1, `activity blocks at zoom ${scenario.zoom}`);
    assert.equal(extractEntryStyles(entryHtml).length, 1, `time entry blocks at zoom ${scenario.zoom}`);
    assert.ok(Math.abs(entryStyle.top - activityStyle.top) < 0.01, `top at zoom ${scenario.zoom}`);
    assert.ok(Math.abs(entryStyle.height - activityStyle.height) < 0.01, `height at zoom ${scenario.zoom}`);
    if (timeEntries.length > 1) {
      assert.deepEqual(extractGroupedEntryIds(entryHtml), timeEntries.map(entry => entry.id));
    }
  }
});

test('same-project auto-rule entries merge when visible rows touch despite exact source gaps', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const activityStart = dateStart + (20 * 60 + 30) * 60 * 1000;
  const activityEnd = dateStart + (21 * 60 + 10) * 60 * 1000;
  const fragments = [
    [dateStart + (20 * 60 + 31) * 60 * 1000, dateStart + (20 * 60 + 36) * 60 * 1000],
    [dateStart + (20 * 60 + 42) * 60 * 1000, dateStart + (20 * 60 + 46) * 60 * 1000],
    [dateStart + (20 * 60 + 52) * 60 * 1000, dateStart + (20 * 60 + 55) * 60 * 1000],
    [dateStart + (21 * 60 + 2) * 60 * 1000, dateStart + (21 * 60 + 4) * 60 * 1000]
  ];
  const activities = [codexActivity(activityStart, activityEnd)];
  const timeEntries = fragments.map(([start, end], index) => makeAutoRuleEntry({
    id: `entry-touch-${index}`,
    start,
    end,
    projectId: project.id
  }));

  const html = renderLoggedTimeEntriesHtml({
    zoom: 10,
    projects: [project],
    activities,
    timeEntries
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: activityStart,
    end: activityEnd,
    zoom: 10
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['14 min']);
  assert.deepEqual(extractGroupedEntryIds(html), timeEntries.map(entry => entry.id));
});

test('same-project source-backed entries do not merge across a visible empty row', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const firstStart = dateStart + 9 * 60 * 60 * 1000;
  const firstEnd = firstStart + 5 * 60 * 1000;
  const secondStart = dateStart + (9 * 60 + 35) * 60 * 1000;
  const secondEnd = secondStart + 5 * 60 * 1000;
  const activities = [
    codexActivity(firstStart, firstEnd),
    {
      app: 'Brave Browser',
      title: 'Reference',
      url: 'https://example.com/reference',
      start: firstEnd,
      end: secondStart,
      duration: secondStart - firstEnd
    },
    codexActivity(secondStart, secondEnd)
  ];
  const timeEntries = [
    makeAutoRuleEntry({ id: 'entry-auto-row-1', start: firstStart, end: firstEnd }),
    makeAutoRuleEntry({ id: 'entry-auto-row-2', start: secondStart, end: secondEnd })
  ];

  const html = renderLoggedTimeEntriesHtml({
    zoom: 15,
    projects: [project],
    activities,
    timeEntries
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 2);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstStart,
    end: firstEnd,
    zoom: 15
  }), 'first coarse source row');
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: secondStart,
    end: secondEnd,
    zoom: 15
  }), 'second coarse source row');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['5 min', '5 min']);
});

test('source-backed manual Similar entries do not bridge through hidden subthreshold source rows', () => {
  const dateStart = new Date(2026, 5, 15).setHours(0, 0, 0, 0);
  const project = {
    id: 'project-personal',
    name: 'Personal',
    color: '#ef4444',
    tasks: [{ id: 'task-shopping', name: 'Shopping' }]
  };
  const at = (hour, minute, second = 0) => dateStart + ((hour * 60 + minute) * 60 + second) * 1000;
  const bol = (title, start, end) => ({
    app: 'Brave Browser',
    title,
    url: 'https://www.bol.com/nl/nl/basket/',
    start,
    end,
    duration: end - start
  });
  const sourceBackedEntry = (id, source) => ({
    id,
    start: source.start,
    end: source.end,
    projectId: project.id,
    taskId: 'task-shopping',
    createdBy: 'manual',
    description: '',
    activities: [{
      ...source,
      assignedDurationMs: source.duration,
      assignmentStart: source.start,
      assignmentEnd: source.end,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 1
    }]
  });
  const firstBol = bol('bol | Winkelwagen', at(12, 0), at(12, 5));
  const hiddenBol = bol('bol.com/nl/nl/p/hidden-source', at(12, 5, 10), at(12, 5, 11));
  const secondBol = bol('bol.com/nl/nl/checkout/', at(12, 6), at(12, 10));
  const activities = [
    firstBol,
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: at(12, 5),
      end: at(12, 6),
      duration: 60 * 1000
    },
    hiddenBol,
    secondBol
  ];
  const timeEntries = [
    sourceBackedEntry('entry-bol-first', firstBol),
    sourceBackedEntry('entry-bol-hidden', hiddenBol),
    sourceBackedEntry('entry-bol-second', secondBol)
  ];

  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 2);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: firstBol.start,
    end: firstBol.end,
    zoom: 1
  }), 'first bol run');
  assertStyleMatchesRowGeometry(styles[1], expectedRowGeometry({
    dateStart,
    start: secondBol.start,
    end: secondBol.end,
    zoom: 1
  }), 'second bol run');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['5 min', '4 min']);
});

test('user-created Activity Stream assignment renders on saved visible display bounds', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0) => dateStart + ((hour * 60 + minute) * 60 + second) * 1000;
  const chatbox = (start, end) => ({
    app: 'Chatbox',
    title: 'Chatbox',
    appPath: '/Applications/Chatbox.app',
    bundleId: 'xyz.chatboxapp.app',
    start,
    end,
    duration: end - start
  });
  const displayStart = at(11, 42, 12);
  const displayEnd = at(11, 48, 24);
  const timeEntries = [{
    id: 'entry-chatbox',
    start: at(11, 45),
    end: at(11, 46),
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: [{
      ...chatbox(at(11, 45), at(11, 46)),
      assignedDurationMs: 60 * 1000,
      assignmentStart: at(11, 45),
      assignmentEnd: at(11, 46),
      assignmentDisplayStart: displayStart,
      assignmentDisplayEnd: displayEnd,
      assignmentDisplayGroupKey: 'chatbox-row-11-42',
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 1
    }]
  }];
  const activities = [
    chatbox(at(11, 43), at(11, 44)),
    chatbox(at(11, 45), at(11, 46)),
    chatbox(at(11, 47), at(11, 48))
  ];

  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleNearlyMatchesGeometry(styles[0], expectedExactGeometry({
    dateStart,
    start: displayStart,
    end: displayEnd,
    zoom: 1
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min']);
});

test('separately selected Activity Stream rows do not merge by app alone', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0) => dateStart + ((hour * 60 + minute) * 60 + second) * 1000;
  const chatbox = (start, end) => ({
    app: 'Chatbox',
    title: 'Chatbox',
    appPath: '/Applications/Chatbox.app',
    bundleId: 'xyz.chatboxapp.app',
    start,
    end,
    duration: end - start
  });
  const entryForRow = (id, sourceStart, sourceEnd, displayStart, displayEnd) => ({
    id,
    start: sourceStart,
    end: sourceEnd,
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: [{
      ...chatbox(sourceStart, sourceEnd),
      assignedDurationMs: sourceEnd - sourceStart,
      assignmentStart: sourceStart,
      assignmentEnd: sourceEnd,
      assignmentDisplayStart: displayStart,
      assignmentDisplayEnd: displayEnd,
      assignmentDisplayGroupKey: `${id}-display`,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 1
    }]
  });
  const timeEntries = [
    entryForRow('entry-chatbox-first', at(11, 40, 8), at(11, 41, 56), at(11, 40, 8), at(11, 41, 56)),
    entryForRow('entry-chatbox-second', at(11, 45, 14), at(11, 47, 51), at(11, 42, 19), at(11, 48, 37))
  ];
  const activities = [
    chatbox(at(11, 40), at(11, 42)),
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: at(11, 42),
      end: at(11, 45),
      duration: 3 * 60 * 1000
    },
    chatbox(at(11, 45), at(11, 48))
  ];

  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 2);
  assertStyleNearlyMatchesGeometry(styles[0], expectedExactGeometry({
    dateStart,
    start: at(11, 40, 8),
    end: at(11, 41, 56),
    zoom: 1
  }), 'first Chatbox row');
  assertStyleNearlyMatchesGeometry(styles[1], expectedExactGeometry({
    dateStart,
    start: at(11, 42, 19),
    end: at(11, 48, 37),
    zoom: 1
  }), 'second Chatbox row');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['2 min', '3 min']);
});

test('user-created Activity Stream assignments reproject saved row bounds to the active zoom', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0) => dateStart + ((hour * 60 + minute) * 60 + second) * 1000;
  const chatbox = (start, end) => ({
    app: 'Chatbox',
    title: 'Chatbox',
    appPath: '/Applications/Chatbox.app',
    bundleId: 'xyz.chatboxapp.app',
    start,
    end,
    duration: end - start
  });
  const entryForRow = (id, sourceStart, sourceEnd, displayStart, displayEnd) => ({
    id,
    start: sourceStart,
    end: sourceEnd,
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: [{
      ...chatbox(sourceStart, sourceEnd),
      assignedDurationMs: sourceEnd - sourceStart,
      assignmentStart: sourceStart,
      assignmentEnd: sourceEnd,
      assignmentDisplayStart: displayStart,
      assignmentDisplayEnd: displayEnd,
      assignmentDisplayGroupKey: `${id}-display`,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 1,
      selectedSimilarityMode: 'app',
      selectedSimilarityMatchKey: 'chatbox'
    }]
  });
  const activities = [
    chatbox(at(11, 40, 8), at(11, 41, 56)),
    chatbox(at(11, 45, 14), at(11, 47, 51))
  ];
  const timeEntries = [
    entryForRow('entry-chatbox-first', at(11, 40, 8), at(11, 41, 56), at(11, 40, 8), at(11, 41, 56)),
    entryForRow('entry-chatbox-second', at(11, 45, 14), at(11, 47, 51), at(11, 42, 19), at(11, 48, 37))
  ];

  const oneMinuteHtml = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const oneMinuteStyles = extractEntryStyles(oneMinuteHtml);

  assert.equal(oneMinuteStyles.length, 2, '1 min zoom keeps original visible rows separate');
  assertStyleNearlyMatchesGeometry(oneMinuteStyles[0], expectedExactGeometry({
    dateStart,
    start: at(11, 40, 8),
    end: at(11, 41, 56),
    zoom: 1
  }), 'first saved 1 min row');
  assertStyleNearlyMatchesGeometry(oneMinuteStyles[1], expectedExactGeometry({
    dateStart,
    start: at(11, 42, 19),
    end: at(11, 48, 37),
    zoom: 1
  }), 'second saved 1 min row');
  assert.deepEqual(extractTimeEntryDurationLabels(oneMinuteHtml), ['2 min', '3 min']);

  for (const zoom of [5, 10, 15, 30, 60]) {
    const activityHtml = renderMemoryAidHtml({
      zoom,
      activities,
      timeEntries,
      projects: [project],
      currentDate: new Date(dateStart)
    });
    const activityStyles = extractActivityStyles(activityHtml);
    const html = renderLoggedTimeEntriesHtml({
      zoom,
      projects: [project],
      activities,
      timeEntries,
      currentDate: new Date(dateStart)
    });
    const styles = extractEntryStyles(html);

    assert.equal(styles.length, activityStyles.length, `${zoom} min zoom follows visible Activity Stream rows`);
    styles.forEach((style, index) => {
      assert.equal(style.top, activityStyles[index].top, `${zoom} min zoom row ${index} top`);
      assert.equal(style.height, activityStyles[index].height, `${zoom} min zoom row ${index} height`);
    });
    if (styles.length > 0) {
      assert.ok(sumDurationLabelMinutes(extractTimeEntryDurationLabels(html)) > 0, `${zoom} min zoom duration`);
    }
  }
});

test('saved Affinity Activity Stream row units render vertically and reproject without fragment lanes', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0) => dateStart + ((hour * 60 + minute) * 60 + second) * 1000;
  const affinity = (title, start, end) => ({
    app: 'Affinity',
    title,
    appPath: '/Applications/Affinity Photo 2.app',
    bundleId: 'com.seriflabs.affinityphoto2',
    start,
    end,
    duration: end - start
  });
  const firstRowSources = [
    affinity('Affinity', at(11, 52, 0), at(11, 52, 8)),
    affinity('Affinity', at(11, 52, 8), at(11, 52, 10)),
    affinity('Affinity', at(11, 52, 10), at(11, 53, 0))
  ];
  const secondRowSources = [
    affinity('Affinity - leon.afphoto @ 30% [Loading 32%]', at(11, 53, 19), at(11, 53, 31)),
    affinity('Affinity - leon.afphoto @ 30%', at(11, 53, 42), at(11, 54, 14)),
    affinity('Affinity - Foto Amber.jpeg @ 134%', at(11, 54, 18), at(11, 55, 30))
  ];
  const rowUnitEntry = (id, title, displayStart, displayEnd, sources) => {
    const assignedDurationMs = sources.reduce((total, source) => total + source.duration, 0);
    return {
      id,
      start: displayStart,
      end: displayEnd,
      projectId: project.id,
      createdBy: 'manual',
      description: '',
      activities: [{
        app: 'Affinity',
        title,
        appPath: '/Applications/Affinity Photo 2.app',
        bundleId: 'com.seriflabs.affinityphoto2',
        start: displayStart,
        end: displayEnd,
        duration: assignedDurationMs,
        assignedDurationMs,
        assignmentStart: displayStart,
        assignmentEnd: displayEnd,
        assignmentDisplayStart: displayStart,
        assignmentDisplayEnd: displayEnd,
        assignmentDisplayGroupKey: `${id}-display`,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 1,
        selectedSimilarityMode: 'app',
        selectedSimilarityMatchKey: 'affinity',
        sources
      }]
    };
  };
  const timeEntries = [
    rowUnitEntry('entry-affinity-1152', 'Affinity', at(11, 52), at(11, 53), firstRowSources),
    rowUnitEntry('entry-affinity-1153', 'Affinity - leon.afphoto @ 30% [Loading 32%]', at(11, 53), at(11, 56), secondRowSources)
  ];
  const activities = [...firstRowSources, ...secondRowSources];

  const oneMinuteHtml = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const oneMinuteStyles = extractEntryStyles(oneMinuteHtml);

  assert.equal(oneMinuteStyles.length, 2);
  assertStyleNearlyMatchesGeometry(oneMinuteStyles[0], expectedExactGeometry({
    dateStart,
    start: at(11, 52),
    end: at(11, 53),
    zoom: 1
  }), 'first Affinity row');
  assertStyleNearlyMatchesGeometry(oneMinuteStyles[1], expectedExactGeometry({
    dateStart,
    start: at(11, 53),
    end: at(11, 56),
    zoom: 1
  }), 'second Affinity row');
  assert.deepEqual(oneMinuteStyles.map(style => style.left), [null, null]);
  assert.deepEqual(oneMinuteStyles.map(style => style.width), [null, null]);
  assert.deepEqual(extractTimeEntryDurationLabels(oneMinuteHtml), ['1 min', '2 min']);

  const activityHtml = renderMemoryAidHtml({
    zoom: 5,
    activities,
    timeEntries,
    projects: [project],
    currentDate: new Date(dateStart)
  });
  const activityStyles = extractActivityStyles(activityHtml);
  const fiveMinuteHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const fiveMinuteStyles = extractEntryStyles(fiveMinuteHtml);

  assert.equal(fiveMinuteStyles.length, activityStyles.length);
  fiveMinuteStyles.forEach((style, index) => {
    assert.equal(style.left, null, `5 min row ${index} left`);
    assert.equal(style.width, null, `5 min row ${index} width`);
    assert.equal(style.top, activityStyles[index].top, `5 min row ${index} top`);
    assert.equal(style.height, activityStyles[index].height, `5 min row ${index} height`);
  });
  assert.equal(sumDurationLabelMinutes(extractTimeEntryDurationLabels(fiveMinuteHtml)), 3);
});

test('saved summary assignment with no source fragments shows logged duration, not span, across zooms', () => {
  // Mirrors real saved data: activity-stream-summary activities persist with
  // assignedDurationMs and NO sources[] array. When logged duration is less
  // than the visual span, every zoom must show the logged duration, never the
  // elapsed span. Captured activities are intentionally empty so this exercises
  // the saved-range render path in isolation.
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0) => dateStart + ((hour * 60 + minute) * 60 + second) * 1000;
  const loggedMs = 17 * 60 * 1000 + 32 * 1000; // 17m32s logged -> rounds to 18 min
  const activity = {
    app: 'Brave Browser',
    title: 'Order review',
    url: 'https://shop.example.test/order',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start: at(11, 40),
    end: at(12, 0), // 20 min visual span
    duration: loggedMs,
    assignedDurationMs: loggedMs,
    assignmentStart: at(11, 40),
    assignmentEnd: at(12, 0),
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayZoom: 5
  };
  const timeEntries = [{
    id: 'entry-no-source-fragments',
    start: at(11, 40),
    end: at(12, 0),
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: [activity]
  }];

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({
      zoom,
      projects: [project],
      activities: [],
      timeEntries,
      currentDate: new Date(dateStart)
    });
    assert.deepEqual(extractTimeEntryDurationLabels(html), ['18 min'], `${zoom} min logged duration`);
  }
});

test('saved multi-row summary assignment with no source fragments totals logged duration across zooms', () => {
  // Two adjacent canonical rows in one entry, each logged less than its span,
  // and again with NO sources[]. The combined logged duration is 7 min and must
  // hold at every zoom for the duration pill and the assigned-duration total.
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0) => dateStart + ((hour * 60 + minute) * 60 + second) * 1000;
  const row = (start, end, loggedMs) => ({
    app: 'Brave Browser',
    title: 'Order review',
    url: 'https://shop.example.test/order',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start,
    end,
    duration: loggedMs,
    assignedDurationMs: loggedMs,
    assignmentStart: start,
    assignmentEnd: end,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayZoom: 5
  });
  const activities = [
    row(at(11, 40), at(11, 45), 3 * 60 * 1000 + 18 * 1000), // 3m18s logged, 5 min span
    row(at(11, 46), at(11, 52), 3 * 60 * 1000 + 13 * 1000) // 3m13s logged, 6 min span
  ]; // total logged 6m31s -> rounds to 7 min
  const timeEntries = [{
    id: 'entry-multi-no-source-fragments',
    start: at(11, 40),
    end: at(11, 52),
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities
  }];

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({
      zoom,
      projects: [project],
      activities: [],
      timeEntries,
      currentDate: new Date(dateStart)
    });
    assert.equal(sumDurationLabelMinutes(extractTimeEntryDurationLabels(html)), 7, `${zoom} min logged total`);
  }

  const context = loadTimelineContext();
  context.state.zoom = 60;
  context.state.projects = [project];
  context.state.activities = [];
  context.state.timeEntries = timeEntries;
  const renderEntries = context.buildActivityStreamRenderEntries(
    timeEntries[0],
    dateStart,
    60,
    timeEntries
  );
  const totalMs = context.getActivityStreamAssignedDurationMs(renderEntries);
  assert.equal(Math.round(totalMs / (60 * 1000)), 7, 'assigned-duration total');
});

test('saved Activity Stream row units use the primary visible row duration at coarse zoom', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0) => dateStart + ((hour * 60 + minute) * 60 + second) * 1000;
  const source = (title, start, end, url = '') => ({
    app: 'Affinity',
    title,
    url,
    appPath: '/Applications/Affinity Photo 2.app',
    bundleId: 'com.seriflabs.affinityphoto2',
    start,
    end,
    duration: end - start
  });
  const rowUnitEntry = (id, title, displayStart, displayEnd, sources) => ({
    id,
    start: displayStart,
    end: displayEnd,
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: [{
      app: 'Affinity',
      title,
      appPath: '/Applications/Affinity Photo 2.app',
      bundleId: 'com.seriflabs.affinityphoto2',
      start: displayStart,
      end: displayEnd,
      duration: sources.reduce((total, item) => total + item.duration, 0),
      assignedDurationMs: sources.reduce((total, item) => total + item.duration, 0),
      assignmentStart: displayStart,
      assignmentEnd: displayEnd,
      assignmentDisplayStart: displayStart,
      assignmentDisplayEnd: displayEnd,
      assignmentDisplayGroupKey: `${id}-display`,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 1,
      selectedSimilarityMode: 'app',
      selectedSimilarityMatchKey: 'affinity',
      sources
    }]
  });
  const savedRowSources = [
    source('Affinity', at(11, 52), at(11, 54))
  ];
  const adjacentDocumentSources = [
    source(
      'users',
      at(11, 54),
      at(11, 55),
      'https://design.example.test/documents/mockup.afphoto'
    )
  ];
  const activities = [...savedRowSources, ...adjacentDocumentSources];
  const timeEntries = [
    rowUnitEntry('entry-affinity-1152', 'Affinity', at(11, 52), at(11, 54), savedRowSources)
  ];

  [
    { zoom: 5, rowStart: at(11, 50), rowEnd: at(11, 55), labels: ['2 min'] },
    { zoom: 10, rowStart: at(11, 50), rowEnd: at(12, 0), labels: ['2 min'] },
    { zoom: 15, rowStart: at(11, 45), rowEnd: at(12, 0), labels: ['2 min'] },
    { zoom: 30, rowStart: at(11, 30), rowEnd: at(12, 0), labels: ['2 min'] },
    { zoom: 60, rowStart: at(11, 0), rowEnd: at(12, 0), labels: ['2 min'] }
  ].forEach(({ zoom, rowStart, rowEnd, labels }) => {
    const html = renderLoggedTimeEntriesHtml({
      zoom,
      projects: [project],
      activities,
      timeEntries,
      currentDate: new Date(dateStart)
    });
    const styles = extractEntryStyles(html);

    assert.equal(styles.length, 1, `${zoom} min block count`);
    assert.equal(styles[0].left, null, `${zoom} min left`);
    assert.equal(styles[0].width, null, `${zoom} min width`);
    assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
      dateStart,
      start: rowStart,
      end: rowEnd,
      zoom
    }), `${zoom} min geometry`);
    assert.deepEqual(extractTimeEntryDurationLabels(html), labels, `${zoom} min duration`);
  });
});

test('merged source-backed row units sum stable row labels at coarser zoom', () => {
  const context = loadTimelineContext();
  const total = context.getActivityStreamAssignedDurationMs([
    {
      renderDisplayRepairKey: 'affinity-row',
      renderSourceBackedAssignment: true,
      renderDurationMs: 71291
    },
    {
      renderDisplayRepairKey: 'affinity-document-row',
      renderSourceBackedAssignment: true,
      renderDurationMs: 142014
    }
  ]);

  assert.equal(total, 3 * 60 * 1000);
});

test('source-backed row units keep stable rounded labels when merged at 10 minute zoom', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0, millisecond = 0) => (
    dateStart + ((hour * 60 + minute) * 60 + second) * 1000 + millisecond
  );
  const source = (title, start, end, url = '', duration = end - start) => ({
    app: 'Affinity',
    title,
    url,
    appPath: '/Applications/Affinity.app',
    bundleId: 'com.canva.affinity',
    start,
    end,
    duration
  });
  const rowUnitEntry = (id, title, start, end, url = '', duration = end - start) => {
    const activitySource = source(title, start, end, url, duration);
    const displayGroupKey = `activity-stream-row|||affinity|||${title.toLowerCase()}|||${start}|||${end}`;
    return {
      id,
      start,
      end,
      projectId: project.id,
      createdBy: 'manual',
      description: '',
      activities: [{
        ...activitySource,
        assignedDurationMs: activitySource.duration,
        assignmentStart: start,
        assignmentEnd: end,
        assignmentDisplayStart: start,
        assignmentDisplayEnd: end,
        assignmentDisplayGroupKey: displayGroupKey,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 1,
        sources: [{
          ...activitySource,
          assignedDurationMs: activitySource.duration,
          assignmentStart: start,
          assignmentEnd: end,
          assignmentDisplayStart: start,
          assignmentDisplayEnd: end,
          assignmentDisplayGroupKey: displayGroupKey,
          assignmentSource: 'activity-stream',
          assignmentModel: 'activity-stream-summary',
          assignmentDisplayZoom: 1
        }]
      }]
    };
  };

  const firstStart = at(11, 52, 3, 485);
  const firstEnd = at(11, 53, 26, 151);
  const secondStart = at(11, 53, 14, 775);
  const secondEnd = at(11, 56, 0, 779);
  const documentUrl = 'https://design.example.test/documents/mockup.afphoto';
  const timeEntries = [
    rowUnitEntry('entry-affinity', 'Affinity', firstStart, firstEnd, '', 71291),
    rowUnitEntry(
      'entry-affinity-document',
      'Affinity - leon.afphoto @ 30% [Loading 32%]',
      secondStart,
      secondEnd,
      documentUrl,
      142014
    )
  ];
  const activities = [
    source('Affinity', firstStart, firstEnd, '', 71291),
    source('Affinity - leon.afphoto @ 30% [Loading 32%]', secondStart, secondEnd, documentUrl, 142014),
    source('Affinity - Foto Amber.jpeg @ 134%', at(11, 55, 40), at(11, 57, 30), documentUrl)
  ];

  const html = renderLoggedTimeEntriesHtml({
    zoom: 10,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });

  assert.equal(extractEntryStyles(html).length, 1);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['4 min']);
});

test('coarse merged source-backed Time Entry opens edit collapsed to one non-expandable row', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0) => (
    dateStart + ((hour * 60 + minute) * 60 + second) * 1000
  );
  const page = (start, end, duration = end - start) => ({
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/work-plan',
    start,
    end,
    duration,
    assignedDurationMs: duration,
    assignmentStart: start,
    assignmentEnd: end,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary'
  });
  const rowUnitEntry = (id, start, end, sources) => ({
    id,
    start,
    end,
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: [{
      ...page(start, end, sources.reduce((total, source) => total + source.duration, 0)),
      assignmentDisplayStart: start,
      assignmentDisplayEnd: end,
      assignmentDisplayGroupKey: `${id}-display`,
      assignmentDisplayZoom: 1,
      sources
    }]
  });
  const firstSources = [
    page(at(11, 52), at(11, 52, 20)),
    page(at(11, 52, 20), at(11, 53))
  ].map(source => ({ ...source, assignmentDisplayGroupKey: 'entry-planning-first-display' }));
  const secondSources = [
    page(at(11, 54), at(11, 56))
  ].map(source => ({ ...source, assignmentDisplayGroupKey: 'entry-planning-second-display' }));
  const timeEntries = [
    rowUnitEntry('entry-planning-first', at(11, 52), at(11, 53), firstSources),
    rowUnitEntry('entry-planning-second', at(11, 54), at(11, 56), secondSources)
  ];
  const activities = [...firstSources, ...secondSources];
  const { context, html } = renderLoggedTimeEntriesWithContext({
    zoom: 5,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const [dataset] = extractTimeEntryBlockDatasets(html);
  let modalArgs = null;

  assert.equal(extractEntryStyles(html).length, 1);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['3 min']);
  assert.ok(dataset.detailKey, 'expected merged source-backed block to register scoped edit detail');

  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;

  assert.equal(context.openTimeEntryBlockEditor({ dataset }), true);

  assert.deepEqual(Array.from(context.window.editingTimeEntryGroupIds), [
    'entry-planning-first',
    'entry-planning-second'
  ]);
  assert.equal(context.window.editingTimeEntryPersistedActivities, null);
  assert.equal(modalArgs[0], at(11, 52));
  assert.equal(modalArgs[1], at(11, 56));
  assert.equal(modalArgs[5], false);
  assert.equal(modalArgs[6].length, 2);
  assert.deepEqual(Array.from(modalArgs[6], activity => activity.sources?.[0]?.assignmentDisplayGroupKey), [
    'entry-planning-first-display',
    'entry-planning-second-display'
  ]);
  modalArgs[6][0].sources[0].title = 'Checkout step one';
  modalArgs[6][0].sources[1].title = 'Checkout step two';

  const { context: modalContext, elements } = loadModalsContext();
  modalContext.window.editingTimeEntryId = 'entry-planning-first';
  modalContext.window.editingTimeEntryUsesSelectedActivityReview = true;
  modalContext.openTimeEntryModal(
    modalArgs[0],
    modalArgs[1],
    modalArgs[2],
    modalArgs[3],
    modalArgs[4],
    modalArgs[5],
    modalArgs[6],
    modalArgs[7]
  );

  // Saved logged entries collapse to one non-expandable row per identity at the
  // logged duration — no capture-fragment drill-down (issue #1).
  const listHtml = elements.get('modal-memory-aid-list').innerHTML;
  assert.equal((listHtml.match(/data-modal-activity-index/g) || []).length, 1);
  assert.equal((listHtml.match(/data-modal-source-index/g) || []).length, 0);
  assert.doesNotMatch(listHtml, /\d+ visits/);
  assert.doesNotMatch(listHtml, /Source details/);
  assert.doesNotMatch(listHtml, /Checkout step one|Checkout step two|20s|40s/);
  assert.equal((listHtml.match(/modal-source-fragment-row/g) || []).length, 0);
  const collapsedActivities = modalContext.getSelectedModalActivities();
  assert.equal(collapsedActivities.length, 1);
  assert.equal(collapsedActivities[0].modalSourceActivities, undefined);
  assert.equal(collapsedActivities[0].assignedDurationMs, 3 * 60 * 1000);
  assert.equal(elements.get('modal-duration-lbl').innerText, '3 min');
});

test('source-backed Canonical Activity Row Units preserve selected seven-minute duration across zooms and edit', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0) => (
    dateStart + ((hour * 60 + minute) * 60 + second) * 1000
  );
  const source = (start, end) => ({
    app: 'Brave Browser',
    title: 'Order review',
    url: 'https://shop.example.test/order',
    start,
    end,
    duration: end - start
  });
  const rowUnit = (key, start, end, durationMs, sources) => ({
    ...source(start, end),
    duration: durationMs,
    assignedDurationMs: durationMs,
    assignmentStart: start,
    assignmentEnd: end,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayStart: start,
    assignmentDisplayEnd: end,
    assignmentDisplayGroupKey: key,
    assignmentDisplayZoom: 1,
    sources
  });
  const firstActivity = rowUnit('order-review-first-row', at(11, 52), at(11, 55), 3 * 60 * 1000, [
    source(at(11, 52), at(11, 54, 20))
  ]);
  const secondActivity = rowUnit('order-review-second-row', at(11, 56), at(12, 0), 4 * 60 * 1000, [
    source(at(11, 56), at(11, 58, 20))
  ]);
  const { context: assignContext, elements: assignElements } = loadModalsContext();
  assignContext.openTimeEntryModal(
    firstActivity.start,
    secondActivity.end,
    '',
    null,
    null,
    true,
    [firstActivity, secondActivity]
  );

  assert.equal(assignElements.get('modal-duration-lbl').innerText, '7 min');
  assert.equal(assignContext.getSelectedModalActivities().reduce((total, activity) => (
    total + activity.assignedDurationMs
  ), 0), 7 * 60 * 1000);

  const saveContext = loadTimeEntrySaveContext();
  const payloads = saveContext.buildBulkTimeEntryPayloads({
    start: firstActivity.start,
    end: secondActivity.end,
    description: '',
    projectId: project.id,
    taskId: '',
    billable: true,
    activities: assignContext.getSelectedModalActivities()
  });
  const timeEntries = payloads.map((payload, index) => ({
    ...payload,
    id: `entry-seven-minutes-${index + 1}`,
    createdBy: 'manual'
  }));
  const savedActivities = timeEntries.flatMap(entry => entry.activities || []);
  const activities = savedActivities.flatMap(activity => activity.sources || []);

  assert.equal(payloads.length, 2);
  assert.equal(savedActivities.reduce((total, activity) => total + activity.assignedDurationMs, 0), 7 * 60 * 1000);
  assert.ok(savedActivities.reduce((total, activity) => (
    total + (activity.sources || []).reduce((sourceTotal, source) => sourceTotal + source.assignedDurationMs, 0)
  ), 0) < 7 * 60 * 1000);

  const savedTimeEntry = {
    id: 'entry-seven-minutes-saved',
    start: firstActivity.start,
    end: secondActivity.end,
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: savedActivities
  };

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const html = renderLoggedTimeEntriesHtml({
      zoom,
      projects: [project],
      activities,
      timeEntries,
      currentDate: new Date(dateStart)
    });

    assert.equal(sumDurationLabelMinutes(extractTimeEntryDurationLabels(html)), 7, `${zoom} min zoom`);
  }

  const { context, html } = renderLoggedTimeEntriesWithContext({
    zoom: 60,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const [dataset] = extractTimeEntryBlockDatasets(html);
  let modalArgs = null;
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;

  assert.equal(context.openTimeEntryBlockEditor({ dataset }), true);
  assert.equal(modalArgs[6].reduce((total, activity) => total + activity.assignedDurationMs, 0), 7 * 60 * 1000);

  const { context: modalContext, elements } = loadModalsContext();
  modalContext.window.editingTimeEntryId = timeEntries[0].id;
  modalContext.window.editingTimeEntryUsesSelectedActivityReview = true;
  modalContext.openTimeEntryModal(
    modalArgs[0],
    modalArgs[1],
    modalArgs[2],
    modalArgs[3],
    modalArgs[4],
    modalArgs[5],
    modalArgs[6],
    modalArgs[7]
  );

  assert.equal(elements.get('modal-duration-lbl').innerText, '7 min');
  assert.match(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">7 min<\/span>/);
  assert.equal(modalContext.getSelectedModalActivities().reduce((total, activity) => (
    total + activity.assignedDurationMs
  ), 0), 7 * 60 * 1000);

  for (const zoom of [1, 5, 10, 15, 30, 60]) {
    const savedHtml = renderLoggedTimeEntriesHtml({
      zoom,
      projects: [project],
      activities,
      timeEntries: [savedTimeEntry],
      currentDate: new Date(dateStart)
    });

    const labels = extractTimeEntryDurationLabels(savedHtml);
    if (zoom === 1) {
      assert.equal(sumDurationLabelMinutes(labels), 7, `saved entry at ${zoom} min zoom`);
    } else {
      assert.deepEqual(labels, ['7 min'], `saved entry at ${zoom} min zoom`);
    }
  }
});

test('split source-backed Canonical Activity Row Unit opens edit with saved duration once', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0) => (
    dateStart + ((hour * 60 + minute) * 60 + second) * 1000
  );
  const source = (start, end) => ({
    app: 'Brave Browser',
    title: 'Checkout review',
    url: 'https://shop.example.test/checkout',
    start,
    end,
    duration: end - start,
    assignedDurationMs: end - start
  });
  const savedActivity = {
    ...source(at(11, 58), at(12, 5)),
    duration: 7 * 60 * 1000,
    assignedDurationMs: 7 * 60 * 1000,
    assignmentStart: at(11, 58),
    assignmentEnd: at(12, 5),
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayStart: at(11, 58),
    assignmentDisplayEnd: at(12, 5),
    assignmentDisplayGroupKey: 'checkout-boundary-row',
    assignmentDisplayZoom: 1,
    sources: [
      source(at(11, 58), at(12, 0)),
      source(at(12, 0), at(12, 2))
    ]
  };
  const timeEntries = [{
    id: 'entry-seven-minute-boundary',
    start: savedActivity.start,
    end: savedActivity.end,
    projectId: project.id,
    createdBy: 'manual',
    activities: [savedActivity]
  }];
  const activities = savedActivity.sources;
  const { context, html } = renderLoggedTimeEntriesWithContext({
    zoom: 60,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const labels = extractTimeEntryDurationLabels(html);
  const [dataset] = extractTimeEntryBlockDatasets(html);
  let modalArgs = null;
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;

  assert.equal(sumDurationLabelMinutes(labels), 7);
  assert.equal(context.openTimeEntryBlockEditor({ dataset }), true);
  assert.equal(modalArgs[6].reduce((total, activity) => total + activity.assignedDurationMs, 0), 7 * 60 * 1000);

  const { context: modalContext, elements } = loadModalsContext();
  modalContext.window.editingTimeEntryId = timeEntries[0].id;
  modalContext.window.editingTimeEntryUsesSelectedActivityReview = true;
  modalContext.openTimeEntryModal(
    modalArgs[0],
    modalArgs[1],
    modalArgs[2],
    modalArgs[3],
    modalArgs[4],
    modalArgs[5],
    modalArgs[6],
    modalArgs[7]
  );

  assert.equal(elements.get('modal-duration-lbl').innerText, '7 min');
});

test('source-backed row units saved at coarse zoom render exact visible rows at 1 minute zoom', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const project = { id: 'project-personal', name: 'Personal', color: '#ef4444' };
  const at = (hour, minute, second = 0, millisecond = 0) => (
    dateStart + ((hour * 60 + minute) * 60 + second) * 1000 + millisecond
  );
  const source = (title, start, end, url = '', duration = end - start) => ({
    app: 'Affinity',
    title,
    url,
    appPath: '/Applications/Affinity.app',
    bundleId: 'com.canva.affinity',
    start,
    end,
    duration
  });
  const coarseRowEntry = (id, title, displayStart, displayEnd, duration, url = '') => ({
    id,
    start: displayStart,
    end: displayEnd,
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: [{
      ...source(title, displayStart, displayEnd, url, duration),
      assignedDurationMs: duration,
      assignmentStart: displayStart,
      assignmentEnd: displayEnd,
      assignmentDisplayStart: displayStart,
      assignmentDisplayEnd: displayEnd,
      assignmentDisplayGroupKey: `activity-stream-row|||affinity|||${title.toLowerCase()}|||${displayStart}|||${displayEnd}`,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 5,
      selectedSimilarityMode: 'app',
      selectedSimilarityMatchKey: 'affinity',
      sources: [{
        ...source(title, displayStart, displayEnd, url, duration),
        assignedDurationMs: duration,
        assignmentStart: displayStart,
        assignmentEnd: displayEnd,
        assignmentDisplayStart: displayStart,
        assignmentDisplayEnd: displayEnd,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayZoom: 5
      }]
    }]
  });

  const firstStart = at(11, 52, 3, 485);
  const firstEnd = at(11, 53, 26, 151);
  const secondStart = at(11, 53, 42, 347);
  const secondEnd = at(11, 56, 12, 154);
  const documentUrl = 'https://design.example.test/documents/mockup.afphoto';
  const activities = [
    source('Affinity', firstStart, firstEnd),
    source('Affinity - leon.afphoto @ 30%', secondStart, secondEnd, documentUrl, 142014)
  ];
  const timeEntries = [
    coarseRowEntry('entry-affinity-1150', 'Affinity', at(11, 50), at(11, 55), 147789),
    coarseRowEntry('entry-affinity-1155', 'users', at(11, 55), at(12, 0), 66209, documentUrl)
  ];

  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 2);
  assert.deepEqual(styles.map(style => style.left), [null, null]);
  assert.deepEqual(styles.map(style => style.width), [null, null]);
  assertStyleNearlyMatchesGeometry(styles[0], expectedExactGeometry({
    dateStart,
    start: firstStart,
    end: firstEnd,
    zoom: 1
  }), 'first Affinity row');
  assertStyleNearlyMatchesGeometry(styles[1], expectedExactGeometry({
    dateStart,
    start: secondStart,
    end: secondEnd,
    zoom: 1
  }), 'second Affinity row');
  assertNoOverlappingBlockGeometry(styles, 'coarse saved row units at 1 minute zoom');
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['1 min', '2 min']);
});

test('auto-rule coarse block stops before a hidden boundary row', () => {
  const dateStart = new Date(2026, 5, 15).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const ranges = [
    [dateStart + (15 * 60 + 38) * 60 * 1000 + 26 * 1000, dateStart + (15 * 60 + 40) * 60 * 1000 + 57 * 1000],
    [dateStart + (15 * 60 + 43) * 60 * 1000 + 23 * 1000, dateStart + (15 * 60 + 46) * 60 * 1000 + 6 * 1000],
    [dateStart + (15 * 60 + 46) * 60 * 1000 + 12 * 1000, dateStart + (15 * 60 + 50) * 60 * 1000 + 13 * 1000]
  ];
  const activities = ranges.map(([start, end]) => codexActivity(start, end));
  const timeEntries = ranges.map(([start, end], index) => makeAutoRuleEntry({
    id: `entry-boundary-${index}`,
    start,
    end,
    projectId: project.id
  }));

  const activityHtml = renderMemoryAidHtml({
    zoom: 5,
    activities,
    timelineActivities: activities,
    currentDate: new Date(dateStart)
  });
  const entryHtml = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [project],
    activities,
    timelineActivities: activities,
    timeEntries,
    currentDate: new Date(dateStart)
  });
  const [activityStyle] = extractActivityStyles(activityHtml);
  const [entryStyle] = extractEntryStyles(entryHtml);

  assert.equal(extractActivityStyles(activityHtml).length, 1);
  assert.equal(extractEntryStyles(entryHtml).length, 1);
  assertStyleMatchesRowGeometry(activityStyle, expectedRowGeometry({
    dateStart,
    start: dateStart + (15 * 60 + 35) * 60 * 1000,
    end: dateStart + (15 * 60 + 50) * 60 * 1000,
    zoom: 5
  }), 'Activity Stream visible rows');
  assertStyleMatchesRowGeometry(entryStyle, expectedRowGeometry({
    dateStart,
    start: dateStart + (15 * 60 + 35) * 60 * 1000,
    end: dateStart + (15 * 60 + 50) * 60 * 1000,
    zoom: 5
  }), 'auto-rule boundary-trimmed rows');
  assert.deepEqual(extractTimeEntryDurationLabels(entryHtml), ['9 min']);
});

test('hide-empty rows exclude auto-rule hidden boundary spillover rows', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 5, 15).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const ranges = [
    [dateStart + (15 * 60 + 38) * 60 * 1000 + 26 * 1000, dateStart + (15 * 60 + 40) * 60 * 1000 + 57 * 1000],
    [dateStart + (15 * 60 + 43) * 60 * 1000 + 23 * 1000, dateStart + (15 * 60 + 46) * 60 * 1000 + 6 * 1000],
    [dateStart + (15 * 60 + 46) * 60 * 1000 + 12 * 1000, dateStart + (15 * 60 + 50) * 60 * 1000 + 13 * 1000]
  ];
  const activities = ranges.map(([start, end]) => codexActivity(start, end));
  const timeEntries = ranges.map(([start, end], index) => makeAutoRuleEntry({
    id: `entry-compressed-boundary-${index}`,
    start,
    end,
    projectId: project.id
  }));

  context.state.currentDate = new Date(2026, 5, 15);
  context.state.zoom = 5;
  context.state.projects = [project];
  context.state.activities = activities;
  context.state.timelineActivities = activities;
  context.state.timeEntries = timeEntries;
  context.state.settings.hideEmptyActivityRows = true;

  const model = context.getDayTimelineRenderModel({ dateStartOfDay: dateStart, zoom: 5 });
  const html = renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [project],
    activities,
    timelineActivities: activities,
    timeEntries,
    hideEmptyActivityRows: true,
    currentDate: new Date(dateStart)
  });
  const [style] = extractEntryStyles(html);

  assert.deepEqual(Array.from(model.rowLayout.sourceRows), [187, 188, 189]);
  assert.equal(extractEntryStyles(html).length, 1);
  assert.equal(style.top, 2);
  assert.equal(style.height, 117);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['9 min']);
});

test('dense sub-minute auto-rule fragments summarize at coarse zoom instead of rendering tiny bars', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const base = dateStart + 13 * 60 * 60 * 1000;
  const activities = [];
  const timeEntries = [];

  for (let index = 0; index < 24; index++) {
    const fragmentStart = base + index * 30 * 1000;
    const fragmentEnd = fragmentStart + 20 * 1000;
    activities.push(codexActivity(fragmentStart, fragmentEnd));
    activities.push({
      app: 'Oriel',
      title: 'Oriel',
      appPath: '/Applications/Oriel.app',
      bundleId: 'so.sil.oriel',
      start: fragmentEnd,
      end: fragmentStart + 30 * 1000,
      duration: fragmentStart + 30 * 1000 - fragmentEnd
    });
    timeEntries.push(makeAutoRuleEntry({
      id: `entry-auto-dense-${index}`,
      start: fragmentStart,
      end: fragmentEnd,
      projectId: project.id
    }));
  }

  const html = renderLoggedTimeEntriesHtml({
    zoom: 15,
    projects: [project],
    activities,
    timeEntries
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assert.doesNotMatch(styles[0].className, /time-entry-block--tiny/);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start: base,
    end: base + 15 * 60 * 1000,
    zoom: 15
  }));
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['8 min']);
});

test('manual Activity Stream assignment renders at its saved range geometry with logged duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const start = dateStart + (14 * 60 + 35) * 60 * 1000;
  const end = dateStart + (14 * 60 + 50) * 60 * 1000;
  const activities = [
    {
      app: 'Brave Browser',
      title: 'Daily AI Recap Prompt',
      appPath: '/Applications/Brave Browser.app',
      bundleId: 'com.brave.Browser',
      start,
      end,
      duration: end - start,
      url: 'https://chatgpt.com/'
    }
  ];
  const timeEntry = {
    id: 'entry-manual-summary',
    start,
    end,
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: [{
      ...activities[0],
      assignedDurationMs: 789 * 1000,
      assignmentStart: start,
      assignmentEnd: end,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary',
      assignmentDisplayZoom: 5
    }]
  };

  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    activities,
    timeEntries: [timeEntry]
  });
  const styles = extractEntryStyles(html);

  assert.equal(styles.length, 1);
  assertStyleMatchesRowGeometry(styles[0], expectedRowGeometry({
    dateStart,
    start,
    end,
    zoom: 1
  }));
  // Block keeps its saved-range geometry, but the pill shows logged duration
  // (assignedDurationMs 789000 -> 13 min), not the 15 min span.
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['13 min']);
});

test('drag-created manual entry pill shows summed logged duration, not the drag span', () => {
  // Regression for issue #3 (#60 violation): a drag/Log-created manual entry
  // persists its selected activity with assignedDurationMs but WITHOUT an
  // activity-stream assignment tag. Its pill must show the summed logged duration
  // (matching Work Times and the Edit modal), not the elapsed drag span.
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const start = dateStart + (10 * 60 + 10) * 60 * 1000;
  const end = dateStart + (10 * 60 + 45) * 60 * 1000; // 35-min drag span
  const codex = {
    app: 'Codex',
    title: 'Codex',
    bundleId: 'com.openai.codex',
    start,
    end: start + 17 * 60 * 1000,
    duration: 17 * 60 * 1000
  };
  const timeEntry = {
    id: 'entry-drag-manual',
    start,
    end,
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: [{ ...codex, assignedDurationMs: 17 * 60 * 1000 }]
  };

  [5, 10, 15, 30, 60].forEach(zoom => {
    const labels = extractTimeEntryDurationLabels(renderLoggedTimeEntriesHtml({
      zoom,
      projects: [project],
      activities: [codex],
      timeEntries: [timeEntry]
    }));
    assert.deepEqual(labels, ['17 min'], `zoom ${zoom} pill = logged duration, not span`);
  });
});

test('manual entry with no assigned activity durations still uses its span', () => {
  // Boundary for issue #3: a plain manual block (no assignedDurationMs on its
  // activities) keeps span-based duration.
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const start = dateStart + (9 * 60) * 60 * 1000;
  const end = start + 20 * 60 * 1000;
  const timeEntry = {
    id: 'entry-plain-manual',
    start,
    end,
    projectId: project.id,
    createdBy: 'manual',
    description: 'Planning',
    activities: []
  };
  const labels = extractTimeEntryDurationLabels(renderLoggedTimeEntriesHtml({
    zoom: 5,
    projects: [project],
    activities: [],
    timeEntries: [timeEntry]
  }));
  assert.deepEqual(labels, ['20 min']);
});

test('manual and auto-rule entries for the same project merge visually while preserving grouped metadata', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const manualStart = dateStart + (14 * 60 + 35) * 60 * 1000;
  const manualEnd = dateStart + (14 * 60 + 50) * 60 * 1000;
  const autoStart = dateStart + (14 * 60 + 49) * 60 * 1000 + 56 * 1000;
  const autoEnd = dateStart + (14 * 60 + 51) * 60 * 1000 + 58 * 1000;
  const manualEntry = {
    id: 'entry-manual',
    start: manualStart,
    end: manualEnd,
    projectId: project.id,
    createdBy: 'manual',
    description: '',
    activities: []
  };
  const autoEntry = makeAutoRuleEntry({
    id: 'entry-auto-overlap',
    start: autoStart,
    end: autoEnd,
    projectId: project.id
  });
  const html = renderLoggedTimeEntriesHtml({
    zoom: 1,
    projects: [project],
    activities: [codexActivity(autoStart, autoEnd)],
    timeEntries: [manualEntry, autoEntry]
  });
  const styles = extractEntryStyles(html);
  const groupedBounds = extractGroupedEntryBounds(html);

  assert.equal(styles.length, 1);
  assert.equal(styles[0].left, null);
  assert.equal(styles[0].width, null);
  assert.deepEqual(extractTimeEntryDurationLabels(html), ['17 min']);
  assert.match(html, /data-group-ids=/);
  assert.equal(groupedBounds.start, manualStart);
  assert.equal(groupedBounds.end, autoEnd);
});

test('long time entry blocks render one floating label without repeated title rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const html = renderLoggedTimeEntriesHtml({
    zoom: 60,
    projects: [{ id: 'project-1', name: 'Project One', color: '#3b82f6' }],
    timeEntries: [{
      id: 'entry-long',
      start: dateStart + 9 * 60 * 60 * 1000,
      end: dateStart + 17 * 60 * 60 * 1000,
      projectId: 'project-1',
      description: ''
    }]
  });
  const blockHtml = extractFirstTimeEntryBlockHtml(html);

  assert.match(blockHtml, /time-entry-main--floating/);
  assert.doesNotMatch(blockHtml, /time-entry-main--repeat/);
  assert.doesNotMatch(blockHtml, /aria-hidden="true"/);
  assert.equal(extractTimeEntryDurationLabels(blockHtml).length, 1);
  assert.match(blockHtml, /480 min/);
});

test('floating time entry label offset tracks the visible scroll position inside a long block', () => {
  const context = loadTimelineContext();
  const block = new FakeElement('entry-long');
  const label = new FakeElement('entry-label');
  const scrollPane = {
    scrollTop: 320,
    clientHeight: 360,
    addEventListener() {}
  };

  block.className = 'time-entry-block';
  block.dataset = {};
  block.offsetTop = 200;
  block.offsetHeight = 480;
  label.className = 'time-entry-main time-entry-main--floating';
  label.offsetHeight = 24;
  block.querySelector = selector => selector === '.time-entry-main--floating' ? label : null;
  context.DOM.elTimeEntriesScroll = scrollPane;
  context.DOM.elItemsTimeEntries = {
    querySelectorAll(selector) {
      return selector === '.time-entry-block' ? [block] : [];
    }
  };

  context.updateFloatingTimeEntryLabels();

  assert.equal(block.style['--time-entry-label-offset'], '126px');
});

test('unlogged recorded work groups Codex activity without saved source snapshots', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const codexStart = dateStart + 10 * 60 * 60 * 1000;
  const braveStart = dateStart + 11 * 60 * 60 * 1000;
  const codex = codexActivity(codexStart, codexStart + 20 * 60 * 1000);
  const brave = {
    app: 'Brave Browser',
    title: 'Reference',
    url: 'https://example.com/reference',
    start: braveStart,
    end: braveStart + 15 * 60 * 1000,
    duration: 15 * 60 * 1000
  };
  const timeEntries = [{
    id: 'entry-brave',
    start: brave.start,
    end: brave.end,
    projectId: 'project-1',
    activities: [{
      ...brave,
      assignedDurationMs: brave.duration,
      assignmentStart: brave.start,
      assignmentEnd: brave.end,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary'
    }]
  }];

  const groups = context.buildUnloggedActivityGroups({
    activities: [codex, brave],
    timeEntries,
    dateStartOfDay: dateStart
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].app, 'Codex');
  assert.equal(groups[0].durationMs, 20 * 60 * 1000);
});

test('unlogged backfill preview skips already logged fragments and preserves selected source snapshots', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + 13 * 60 * 60 * 1000;
  const activity = codexActivity(start, start + 30 * 60 * 1000);
  const timeEntries = [{
    id: 'entry-codex-partial',
    start,
    end: start + 10 * 60 * 1000,
    projectId: 'project-1',
    activities: [{
      ...activity,
      end: start + 10 * 60 * 1000,
      duration: 10 * 60 * 1000,
      assignedDurationMs: 10 * 60 * 1000,
      assignmentStart: start,
      assignmentEnd: start + 10 * 60 * 1000,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary'
    }]
  }];
  const groups = context.buildUnloggedActivityGroups({
    activities: [activity],
    timeEntries,
    dateStartOfDay: dateStart
  });
  const payloadActivities = context.buildUnloggedBackfillActivities(groups, [groups[0].fragments[0].id]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].durationMs, 20 * 60 * 1000);
  assert.equal(payloadActivities.length, 1);
  assert.equal(payloadActivities[0].start, start + 10 * 60 * 1000);
  assert.equal(payloadActivities[0].end, start + 30 * 60 * 1000);
  assert.equal(payloadActivities[0].assignedDurationMs, 20 * 60 * 1000);
  assert.equal(payloadActivities[0].assignmentSource, 'activity-stream');
  assert.equal(payloadActivities[0].assignmentModel, 'activity-stream-summary');
});

test('unlogged work review renders all groups with compact non-wrapping total text', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const durationsMinutes = [60, 50, 45, 40, 35, 34, 34];
  const activities = durationsMinutes.map((minutes, index) => {
    const start = dateStart + (8 * 60 + index * 45) * 60 * 1000;
    return {
      app: `App ${index + 1}`,
      title: `Unlogged Work ${index + 1}`,
      url: '',
      start,
      end: start + minutes * 60 * 1000,
      duration: minutes * 60 * 1000
    };
  });
  const container = new FakeElement('unlogged-work-review-list');
  const total = new FakeElement('unlogged-work-review-total');
  const panel = new FakeElement('unlogged-work-review');

  context.state.currentDate = new Date(2026, 4, 21);
  context.state.activities = activities;
  context.state.timelineActivities = activities;
  context.state.timeEntries = [];
  context.document = {
    getElementById(id) {
      return {
        'unlogged-work-review': panel,
        'unlogged-work-review-list': container,
        'unlogged-work-review-total': total
      }[id] || null;
    }
  };

  context.renderUnloggedRecordedWorkReview();

  assert.equal(total.innerText, '4h 58m');
  assert.equal((container.innerHTML.match(/class="unlogged-work-row"/g) || []).length, 7);
});

test('unlogged work review hides zero-second and sub-minute groups while keeping cumulative short work actionable', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const actionableStart = dateStart + 9 * 60 * 60 * 1000;
  const cumulativeStart = dateStart + 10 * 60 * 60 * 1000;
  const hiddenShortStart = dateStart + 11 * 60 * 60 * 1000;
  const tinyStart = dateStart + 12 * 60 * 60 * 1000;
  const activities = [
    {
      app: 'Codex',
      title: 'Long Reviewable Work',
      url: '',
      start: actionableStart,
      end: actionableStart + 2 * 60 * 1000,
      duration: 2 * 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Cumulative Short Work',
      url: 'https://example.com/cumulative',
      start: cumulativeStart,
      end: cumulativeStart + 40 * 1000,
      duration: 40 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Cumulative Short Work',
      url: 'https://example.com/cumulative',
      start: cumulativeStart + 45 * 1000,
      end: cumulativeStart + 85 * 1000,
      duration: 40 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Single Short Work',
      url: 'https://example.com/short',
      start: hiddenShortStart,
      end: hiddenShortStart + 45 * 1000,
      duration: 45 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Half Second Work',
      url: 'https://example.com/tiny',
      start: tinyStart,
      end: tinyStart + 500,
      duration: 500
    }
  ];
  const container = new FakeElement('unlogged-work-review-list');
  const total = new FakeElement('unlogged-work-review-total');
  const panel = new FakeElement('unlogged-work-review');

  context.state.currentDate = new Date(2026, 4, 21);
  context.state.activities = activities;
  context.state.timelineActivities = activities;
  context.state.timeEntries = [];
  context.document = {
    getElementById(id) {
      return {
        'unlogged-work-review': panel,
        'unlogged-work-review-list': container,
        'unlogged-work-review-total': total
      }[id] || null;
    }
  };

  const rawGroups = context.buildUnloggedActivityGroups({
    activities,
    timeEntries: [],
    dateStartOfDay: dateStart
  });
  context.renderUnloggedRecordedWorkReview();
  const payloadActivities = context.buildUnloggedBackfillActivities(context.state.unloggedActivityGroups);

  assert.equal(rawGroups.length, 4);
  assert.equal((container.innerHTML.match(/class="unlogged-work-row"/g) || []).length, 2);
  assert.match(container.innerHTML, /Long Reviewable Work/);
  assert.match(container.innerHTML, /Cumulative Short Work/);
  assert.doesNotMatch(container.innerHTML, /Single Short Work/);
  assert.doesNotMatch(container.innerHTML, /Half Second Work/);
  assert.doesNotMatch(container.innerHTML, />0s</);
  assert.match(container.innerHTML, /2 short fragments hidden/);
  assert.equal(total.innerText, '3m');
  assert.equal(context.state.unloggedActivityGroups.length, 2);
  assert.equal(payloadActivities.length, 3);
  assert.equal(payloadActivities.reduce((sum, activity) => sum + activity.duration, 0), 200 * 1000);
  assert.equal(payloadActivities.some(activity => activity.title === 'Single Short Work'), false);
  assert.equal(payloadActivities.some(activity => activity.title === 'Half Second Work'), false);
});

test('unlogged work review toggles bottom fade while overflowed list has more rows below', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const activities = Array.from({ length: 8 }, (_value, index) => {
    const start = dateStart + (9 * 60 + index * 20) * 60 * 1000;
    return {
      app: `Review App ${index + 1}`,
      title: `Review Row ${index + 1}`,
      url: '',
      start,
      end: start + 10 * 60 * 1000,
      duration: 10 * 60 * 1000
    };
  });
  const container = new FakeElement('unlogged-work-review-list');
  const total = new FakeElement('unlogged-work-review-total');
  const panel = new FakeElement('unlogged-work-review');

  container.clientHeight = 180;
  container.scrollHeight = 420;
  container.scrollTop = 0;
  context.state.currentDate = new Date(2026, 4, 21);
  context.state.activities = activities;
  context.state.timelineActivities = activities;
  context.state.timeEntries = [];
  context.document = {
    getElementById(id) {
      return {
        'unlogged-work-review': panel,
        'unlogged-work-review-list': container,
        'unlogged-work-review-total': total
      }[id] || null;
    }
  };

  context.renderUnloggedRecordedWorkReview();
  assert.equal(panel.classList.contains('unlogged-work-review--has-more'), true);

  container.scrollTop = 240;
  container.dispatchEvent({ type: 'scroll' });
  assert.equal(panel.classList.contains('unlogged-work-review--has-more'), false);
});

test('day timeline render model reuses exact Activity Stream sessions across renderers', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const activities = [
    codexActivity(dateStart + 9 * 60 * 60 * 1000, dateStart + (9 * 60 + 12) * 60 * 1000),
    {
      app: 'Brave Browser',
      title: 'Reference',
      url: 'https://example.com/reference',
      start: dateStart + (9 * 60 + 13) * 60 * 1000,
      end: dateStart + (9 * 60 + 17) * 60 * 1000,
      duration: 4 * 60 * 1000
    },
    codexActivity(dateStart + (9 * 60 + 18) * 60 * 1000, dateStart + (9 * 60 + 31) * 60 * 1000)
  ];
  const timeEntries = [
    makeAutoRuleEntry({
      id: 'entry-model-1',
      start: activities[0].start,
      end: activities[0].end,
      projectId: project.id
    }),
    makeAutoRuleEntry({
      id: 'entry-model-2',
      start: activities[2].start,
      end: activities[2].end,
      projectId: project.id
    })
  ];
  let gridHtml = '';
  let activityHtml = '';
  let entryHtml = '';

  context.__orielTimelineDiagnostics = { activitySessionBuilds: 0 };
  context.state.currentDate = new Date(2026, 4, 21);
  context.state.zoom = 1;
  context.state.activities = activities;
  context.state.timelineActivities = activities;
  context.state.timeEntries = timeEntries;
  context.state.projects = [project];
  context.state.settings.hideEmptyActivityRows = true;
  context.DOM.elGridMemoryAid = { set innerHTML(value) { gridHtml = value; }, get innerHTML() { return gridHtml; } };
  context.DOM.elGridTimeEntries = { set innerHTML(value) { gridHtml = value; }, get innerHTML() { return gridHtml; } };
  context.DOM.elItemsMemoryAid = {
    style: {},
    set innerHTML(value) { activityHtml = value; },
    get innerHTML() { return activityHtml; },
    querySelectorAll() { return []; }
  };
  context.DOM.elItemsTimeEntries = {
    style: {},
    set innerHTML(value) { entryHtml = value; },
    get innerHTML() { return entryHtml; },
    querySelectorAll() { return []; }
  };

  context.renderTimelineGrids();
  context.renderMemoryAidActivities();
  context.renderLoggedTimeEntries();
  const firstModel = context.getDayTimelineRenderModel({ dateStartOfDay: dateStart, zoom: 1 });
  const secondModel = context.getDayTimelineRenderModel({ dateStartOfDay: dateStart, zoom: 1 });

  assert.strictEqual(firstModel, secondModel);
  assert.equal(context.__orielTimelineDiagnostics.activitySessionBuilds, 1);
  assert.ok(activityHtml.includes('activity-block'));
  assert.ok(entryHtml.includes('time-entry-block'));

  context.state.zoom = 5;
  const changedZoomModel = context.getDayTimelineRenderModel({ dateStartOfDay: dateStart, zoom: 5 });
  assert.notStrictEqual(changedZoomModel, firstModel);
});

test('exact Activity Stream blocks keep popup detail overlaps out of DOM payloads', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const ownershipActivity = codexActivity(dateStart + 10 * 60 * 60 * 1000, dateStart + (10 * 60 + 2) * 60 * 1000);
  const visibleActivities = [
    codexActivity(ownershipActivity.start, ownershipActivity.start + 45 * 1000),
    {
      app: 'Brave Browser',
      title: 'Short interruption',
      url: 'https://example.com/interrupt',
      start: ownershipActivity.start + 45 * 1000,
      end: ownershipActivity.start + 75 * 1000,
      duration: 30 * 1000
    },
    codexActivity(ownershipActivity.start + 75 * 1000, ownershipActivity.end)
  ];
  let renderedHtml = '';

  context.state.currentDate = new Date(2026, 4, 21);
  context.state.zoom = 1;
  context.state.activities = visibleActivities;
  context.state.timelineActivities = [ownershipActivity];
  context.state.timeEntries = [];
  context.state.projects = [];
  context.state.settings.hideEmptyActivityRows = false;
  context.DOM.elItemsMemoryAid = {
    style: {},
    set innerHTML(value) { renderedHtml = value; },
    get innerHTML() { return renderedHtml; },
    querySelectorAll() { return []; }
  };

  context.renderMemoryAidActivities();
  const keyMatch = renderedHtml.match(/data-overlap-key="([^"]+)"/);

  assert.ok(keyMatch, 'expected exact block detail key');
  assert.doesNotMatch(renderedHtml, /data-overlaps="/);
  const overlaps = context.getActivityBlockDetailOverlaps({
    dataset: {
      overlapKey: keyMatch[1],
      startMs: String(ownershipActivity.start),
      endMs: String(ownershipActivity.end),
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex'
    }
  });

  assert.equal(overlaps.length, 2);
  assert.ok(overlaps.some(overlap => overlap.app === 'Brave Browser'));
});

test('unlogged work coverage indexes logged source ranges by activity key', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const codexStart = dateStart + 10 * 60 * 60 * 1000;
  const codex = codexActivity(codexStart, codexStart + 10 * 60 * 1000);
  const loggedEntries = Array.from({ length: 80 }, (_value, index) => {
    const start = dateStart + (11 * 60 + index) * 60 * 1000;
    const app = `Other App ${index}`;
    return {
      id: `entry-other-${index}`,
      start,
      end: start + 60 * 1000,
      projectId: 'project-1',
      activities: [{
        app,
        title: app,
        start,
        end: start + 60 * 1000,
        duration: 60 * 1000,
        assignedDurationMs: 60 * 1000,
        assignmentStart: start,
        assignmentEnd: start + 60 * 1000,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary'
      }]
    };
  });

  loggedEntries.push({
    id: 'entry-codex-partial',
    start: codex.start,
    end: codex.start + 5 * 60 * 1000,
    projectId: 'project-1',
    activities: [{
      ...codex,
      end: codex.start + 5 * 60 * 1000,
      duration: 5 * 60 * 1000,
      assignedDurationMs: 5 * 60 * 1000,
      assignmentStart: codex.start,
      assignmentEnd: codex.start + 5 * 60 * 1000,
      assignmentSource: 'activity-stream',
      assignmentModel: 'activity-stream-summary'
    }]
  });

  context.__orielTimelineDiagnostics = { unloggedCandidateRangeChecks: 0 };
  const groups = context.buildUnloggedActivityGroups({
    activities: [codex],
    timeEntries: loggedEntries,
    dateStartOfDay: dateStart
  });
  const payloadActivities = context.buildUnloggedBackfillActivities(groups);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].durationMs, 5 * 60 * 1000);
  assert.equal(payloadActivities.length, 1);
  assert.equal(context.__orielTimelineDiagnostics.unloggedCandidateRangeChecks, 1);
});

test('floating Time Entry label updates coalesce repeated scroll events into one frame', () => {
  const context = loadTimelineContext();
  const listeners = {};
  const animationFrames = [];
  const block = new FakeElement('entry-long');
  const label = new FakeElement('entry-label');
  const scrollPane = {
    scrollTop: 0,
    clientHeight: 360,
    addEventListener(type, listener) {
      listeners[type] ||= [];
      listeners[type].push(listener);
    }
  };

  block.className = 'time-entry-block';
  block.dataset = {};
  block.offsetTop = 100;
  block.offsetHeight = 480;
  label.className = 'time-entry-main time-entry-main--floating';
  label.offsetHeight = 24;
  block.querySelector = selector => selector === '.time-entry-main--floating' ? label : null;
  context.window.requestAnimationFrame = callback => {
    animationFrames.push(callback);
    return animationFrames.length;
  };
  context.DOM.elTimeEntriesScroll = scrollPane;
  context.DOM.elItemsTimeEntries = {
    querySelectorAll(selector) {
      return selector === '.time-entry-block' ? [block] : [];
    }
  };

  context.bindFloatingTimeEntryLabelUpdates();
  assert.equal(listeners.scroll.length, 1);
  scrollPane.scrollTop = 180;
  listeners.scroll[0]();
  scrollPane.scrollTop = 260;
  listeners.scroll[0]();
  scrollPane.scrollTop = 320;
  listeners.scroll[0]();

  assert.equal(animationFrames.length, 1);
  assert.equal(block.style['--time-entry-label-offset'], undefined);
  animationFrames.shift()();
  assert.equal(block.style['--time-entry-label-offset'], '226px');
});

test('sub-minute dominant interruptions stay hidden in Activity Stream while one-minute rows render', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const longActivity = {
    start: dateStart + (14 * 60 + 8) * 60 * 1000,
    end: dateStart + (14 * 60 + 10) * 60 * 1000,
    app: 'Reference App',
    title: 'Reference App',
    url: ''
  };
  const shortActivity = {
    start: dateStart + (14 * 60 + 10) * 60 * 1000,
    end: dateStart + (14 * 60 + 10) * 60 * 1000 + 59 * 1000,
    app: 'Brave Browser',
    title: 'Short Oriel Local Time Tracker',
    url: 'http://localhost:3000/'
  };
  const exactMinuteActivity = {
    start: dateStart + (14 * 60 + 12) * 60 * 1000,
    end: dateStart + (14 * 60 + 13) * 60 * 1000,
    app: 'Brave Browser',
    title: 'One Minute Oriel Local Time Tracker',
    url: 'http://localhost:3000/'
  };

  const html = renderMemoryAidHtml({
    zoom: 1,
    activities: [longActivity, shortActivity, exactMinuteActivity],
    timelineActivities: [longActivity, shortActivity, exactMinuteActivity]
  });

  assert.equal(extractActivitySpan(html, 'Reference App'), 2);
  assert.doesNotMatch(html, /data-title="Short Oriel Local Time Tracker"/);
  assert.equal(extractActivitySpan(html, 'One Minute Oriel Local Time Tracker'), 1);
});

test('one-minute Activity Stream sessions aggregate same-app fragments across short gaps', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const start = dateStart + (12 * 60 + 2) * 60 * 1000;
  const firstCodex = codexActivity(start, start + 20 * 1000);
  const firstOriel = {
    app: 'Oriel',
    title: 'Oriel',
    start: firstCodex.end,
    end: firstCodex.end + 3 * 1000,
    duration: 3 * 1000
  };
  const secondCodex = codexActivity(firstOriel.end, firstOriel.end + 25 * 1000);
  const secondOriel = {
    app: 'Oriel',
    title: 'Oriel',
    start: secondCodex.end,
    end: secondCodex.end + 4 * 1000,
    duration: 4 * 1000
  };
  const thirdCodex = codexActivity(secondOriel.end, secondOriel.end + 30 * 1000);
  const shortScrap = {
    app: 'Short App',
    title: 'Short App',
    start: thirdCodex.end + 5 * 60 * 1000,
    end: thirdCodex.end + 5 * 60 * 1000 + 20 * 1000,
    duration: 20 * 1000
  };
  const activities = [firstCodex, firstOriel, secondCodex, secondOriel, thirdCodex, shortScrap];
  const sessions = context.buildActivityStreamSessions({
    dateStartOfDay: dateStart,
    activities,
    detailActivities: activities
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].app, 'Codex');
  assert.equal(sessions[0].start, firstCodex.start);
  assert.equal(sessions[0].end, thirdCodex.end);
  assert.equal(sessions[0].activeDurationMs, 75 * 1000);
  assert.equal(sessions[0].duration, 75 * 1000);
  assert.equal(sessions[0].interruptionCount, 2);
  assert.equal(sessions[0].sources.length, 3);
});

test('one-minute Activity Stream keeps assigned sessions through competing short visible interruptions', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 5, 11).setHours(0, 0, 0, 0);
  const at = (hour, minute, second) => dateStart + ((hour * 60 + minute) * 60 + second) * 1000;
  const orielActivity = (start, end) => ({
    app: 'Oriel',
    title: 'Oriel',
    start,
    end,
    duration: end - start
  });

  const codexFragments = [
    codexActivity(at(13, 45, 54), at(13, 46, 18)),
    codexActivity(at(13, 46, 45), at(13, 46, 55)),
    codexActivity(at(13, 46, 55.5), at(13, 47, 4)),
    codexActivity(at(13, 47, 6), at(13, 47, 8)),
    codexActivity(at(13, 47, 16), at(13, 47, 20)),
    codexActivity(at(13, 47, 27), at(13, 47, 29)),
    codexActivity(at(13, 47, 30), at(13, 47, 34)),
    codexActivity(at(13, 47, 35), at(13, 47, 37)),
    codexActivity(at(13, 47, 37.5), at(13, 47, 41)),
    codexActivity(at(13, 47, 44), at(13, 47, 51)),
    codexActivity(at(13, 47, 58), at(13, 48, 4)),
    codexActivity(at(13, 48, 4.5), at(13, 48, 14)),
    codexActivity(at(13, 48, 20), at(13, 48, 58))
  ];
  const interruptions = [
    orielActivity(at(13, 44, 23), at(13, 45, 42)),
    {
      app: 'Shottr',
      title: 'Shottr',
      start: at(13, 45, 42),
      end: at(13, 45, 51),
      duration: at(13, 45, 51) - at(13, 45, 42)
    },
    orielActivity(at(13, 45, 51), at(13, 45, 54)),
    orielActivity(at(13, 46, 18), at(13, 46, 45)),
    orielActivity(at(13, 46, 55), at(13, 46, 55.5)),
    orielActivity(at(13, 47, 4), at(13, 47, 6)),
    orielActivity(at(13, 47, 8), at(13, 47, 16)),
    orielActivity(at(13, 47, 20), at(13, 47, 27)),
    orielActivity(at(13, 47, 29), at(13, 47, 30)),
    orielActivity(at(13, 47, 34), at(13, 47, 35)),
    orielActivity(at(13, 47, 37), at(13, 47, 37.5)),
    orielActivity(at(13, 47, 41), at(13, 47, 44)),
    orielActivity(at(13, 47, 51), at(13, 47, 58)),
    orielActivity(at(13, 48, 4), at(13, 48, 4.5)),
    orielActivity(at(13, 48, 14), at(13, 48, 20)),
    orielActivity(at(13, 48, 58), at(13, 49, 57))
  ];
  const activities = [...codexFragments, ...interruptions]
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const entry = {
    id: 'entry-codex-assigned-fragments',
    start: codexFragments[0].start,
    end: codexFragments.at(-1).end,
    projectId: 'project-1',
    createdBy: 'auto-rule',
    autoRuleId: 'rule-codex',
    activities: codexFragments.map(fragment => ({
      ...fragment,
      assignedDurationMs: fragment.duration,
      assignmentStart: fragment.start,
      assignmentEnd: fragment.end,
      assignmentSource: 'activity-stream',
      assignmentModel: 'auto-assigned-capture',
      assignmentDisplayZoom: 1,
      autoAssigned: true,
      autoAssignmentRuleId: 'rule-codex'
    }))
  };

  const sessions = context.buildActivityStreamSessions({
    dateStartOfDay: dateStart,
    activities,
    detailActivities: activities,
    timeEntries: [entry]
  });

  const visibleCodexFragments = codexFragments.slice(1);
  const codexSession = sessions.find(session => session.app === 'Codex'
    && session.start === visibleCodexFragments[0].start
    && session.end === codexFragments.at(-1).end);

  assert.ok(codexSession);
  assert.ok(codexSession.activeDurationMs >= 94 * 1000);
  assert.equal(codexSession.duration, codexSession.activeDurationMs);
  assert.equal(codexSession.sources.length, visibleCodexFragments.length);
  assert.ok(codexSession.interruptionCount >= 10);
});

test('auto-rule time entries render the same aggregated exact session as Activity Stream', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const project = { id: 'project-1', name: 'Oriel Time Tracker', color: '#3b82f6' };
  const start = dateStart + (12 * 60 + 2) * 60 * 1000;
  const firstCodex = codexActivity(start, start + 20 * 1000);
  const firstOriel = {
    app: 'Oriel',
    title: 'Oriel',
    start: firstCodex.end,
    end: firstCodex.end + 3 * 1000,
    duration: 3 * 1000
  };
  const secondCodex = codexActivity(firstOriel.end, firstOriel.end + 25 * 1000);
  const secondOriel = {
    app: 'Oriel',
    title: 'Oriel',
    start: secondCodex.end,
    end: secondCodex.end + 4 * 1000,
    duration: 4 * 1000
  };
  const thirdCodex = codexActivity(secondOriel.end, secondOriel.end + 30 * 1000);
  const codexFragments = [firstCodex, secondCodex, thirdCodex];
  const entry = {
    id: 'entry-codex-fragments',
    start: firstCodex.start,
    end: thirdCodex.end,
    projectId: project.id,
    createdBy: 'auto-rule',
    autoRuleId: 'rule-codex',
    description: '',
    activities: codexFragments.map(fragment => ({
      ...fragment,
      assignedDurationMs: fragment.duration,
      assignmentStart: fragment.start,
      assignmentEnd: fragment.end,
      assignmentSource: 'activity-stream',
      assignmentModel: 'auto-assigned-capture',
      assignmentDisplayZoom: 1,
      autoAssigned: true,
      autoAssignmentRuleId: 'rule-codex'
    }))
  };
  const activities = [firstCodex, firstOriel, secondCodex, secondOriel, thirdCodex];

  context.state.currentDate = new Date(2026, 4, 21);
  context.state.zoom = 1;
  context.state.activities = activities;
  context.state.timelineActivities = activities;
  context.state.projects = [project];

  const sessions = context.buildActivityStreamSessions({
    dateStartOfDay: dateStart,
    activities,
    detailActivities: activities
  });
  const entryItems = context.buildLoggedTimeEntryRenderItems([entry], 1, dateStart);

  assert.equal(sessions.length, 1);
  assert.equal(entryItems.length, 1);
  assert.equal(entryItems[0].start, sessions[0].start);
  assert.equal(entryItems[0].end, sessions[0].end);
  assert.equal(entryItems[0].displayStart, sessions[0].start);
  assert.equal(entryItems[0].displayEnd, sessions[0].end);
  assert.equal(entryItems[0].durationMs, sessions[0].duration);
  assert.equal(entryItems[0].durationMs, 75 * 1000);
});

test('recorded activity session details exclude fragments outside the exact session range', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const precedingOriel = {
    start: dateStart + (14 * 60 + 4) * 60 * 1000 + 52 * 1000,
    end: dateStart + (14 * 60 + 5) * 60 * 1000 + 8 * 1000,
    app: 'Brave Browser',
    title: 'Oriel Local Time Tracker',
    url: 'http://localhost:3000/'
  };
  const referenceApp = {
    start: precedingOriel.end,
    end: dateStart + (14 * 60 + 10) * 60 * 1000 + 29000,
    app: 'Reference App',
    title: 'Reference App',
    url: ''
  };
  const subsequentOriel = {
    start: referenceApp.end,
    end: dateStart + (14 * 60 + 11) * 60 * 1000 + 5000,
    app: 'Brave Browser',
    title: 'Oriel Local Time Tracker',
    url: 'http://localhost:3000/'
  };

  const html = renderMemoryAidHtml({
    zoom: 1,
    activities: [precedingOriel, referenceApp],
    timelineActivities: [precedingOriel, referenceApp, subsequentOriel]
  });
  const overlaps = extractActivityOverlaps(html, 'Reference App');
  const orielOverlap = overlaps.find(activity => activity.title === 'Oriel Local Time Tracker');
  const styles = extractActivityStyles(html);

  assert.equal(extractActivitySpan(html, 'Reference App'), 6);
  assert.equal(extractActivityDuration(html, 'Reference App'), '5 min');
  assert.equal(orielOverlap, undefined);
  assertStyleNearlyMatchesGeometry(styles.find(style => style.span === 6), expectedExactGeometry({
    dateStart,
    start: referenceApp.start,
    end: referenceApp.end,
    zoom: 1
  }));
});

test('refresh keeps short activities in state while Activity Stream rendering hides them', async () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const longActivity = {
    start: dateStart,
    end: dateStart + 2 * 60 * 1000,
    app: 'Reference App',
    title: 'Reference App',
    url: ''
  };
  const shortActivity = {
    start: dateStart + 2 * 60 * 1000,
    end: dateStart + 2 * 60 * 1000 + 35000,
    app: 'Brave Browser',
    title: 'Oriel Local Time Tracker',
    url: 'http://localhost:3000/'
  };

  const refreshedState = await refreshActivities({
    rawActivities: [longActivity, shortActivity],
    thresholdSeconds: 60
  });

  assert.deepEqual(Array.from(refreshedState.activities, activity => activity.title), ['Reference App', 'Oriel Local Time Tracker']);
  assert.deepEqual(
    Array.from(refreshedState.timelineActivities || [], activity => activity.title),
    ['Reference App', 'Oriel Local Time Tracker']
  );

  const html = renderMemoryAidHtml({
    zoom: 1,
    activities: refreshedState.activities,
    timelineActivities: refreshedState.timelineActivities
  });

  assert.equal(extractActivitySpan(html, 'Reference App'), 2);
  assert.doesNotMatch(html, /data-title="Oriel Local Time Tracker"/);
});

test('refresh merges same activity rows while preserving activity mix and source segments', async () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const refreshedState = await refreshActivities({
    rawActivities: [
      {
        start: dateStart,
        end: dateStart + 2 * 60 * 1000,
        app: 'SoundCloud',
        title: 'SoundCloud',
        url: '',
        interactionState: 'handsOn'
      },
      {
        start: dateStart + 2 * 60 * 1000,
        end: dateStart + 10 * 60 * 1000,
        app: 'SoundCloud',
        title: 'SoundCloud',
        url: '',
        interactionState: 'handsOff'
      }
    ],
    thresholdSeconds: 60
  });
  const activity = refreshedState.timelineActivities[0];

  assert.equal(refreshedState.timelineActivities.length, 1);
  assert.equal(activity.end - activity.start, 10 * 60 * 1000);
  assert.equal(activity.activityMix.handsOnMs, 2 * 60 * 1000);
  assert.equal(activity.activityMix.handsOffMs, 8 * 60 * 1000);
  assert.equal(activity.sourceSegments.length, 2);
  assert.deepEqual(Array.from(activity.sourceSegments, segment => segment.interactionState), ['handsOn', 'handsOff']);
});

test('refresh excludes loginwindow from visible and ownership activity streams', async () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const refreshedState = await refreshActivities({
    rawActivities: [
      {
        start: dateStart,
        end: dateStart + 2 * 60 * 1000,
        app: 'loginwindow',
        title: 'Login Window',
        url: ''
      },
      {
        start: dateStart + 2 * 60 * 1000,
        end: dateStart + 4 * 60 * 1000,
        app: 'Codex',
        title: 'Codex',
        url: ''
      }
    ],
    thresholdSeconds: 60
  });

  assert.deepEqual(Array.from(refreshedState.activities, activity => activity.app), ['Codex']);
  assert.deepEqual(Array.from(refreshedState.timelineActivities || [], activity => activity.app), ['Codex']);
});

test('activity stream hides Activity Mix UI for hands-on and hands-off blocks', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const soundCloud = {
    start: dateStart,
    end: dateStart + 10 * 60 * 1000,
    app: 'SoundCloud',
    title: 'SoundCloud',
    url: '',
    interactionState: 'handsOn',
    activityMix: {
      handsOnMs: 2 * 60 * 1000,
      handsOffMs: 8 * 60 * 1000
    },
    sourceSegments: [
      { start: dateStart, end: dateStart + 2 * 60 * 1000, interactionState: 'handsOn' },
      { start: dateStart + 2 * 60 * 1000, end: dateStart + 10 * 60 * 1000, interactionState: 'handsOff' }
    ]
  };

  const html = renderMemoryAidHtml({
    zoom: 5,
    activities: [soundCloud],
    timelineActivities: [soundCloud]
  });
  const blockHtml = extractActivityBlockHtml(html, 'SoundCloud');

  assert.match(blockHtml, /duration-pill shrink-0/);
  assert.doesNotMatch(blockHtml, /activity-mix|Activity Mix|Hands-on|Hands-off|data-activity-mix-tooltip|aria-label="Activity Mix/);
  assert.doesNotMatch(blockHtml, /--activity-mix-hands-on/);
  assert.equal(extractActivityDuration(html, 'SoundCloud'), '10 min');
});

test('activity stream hides Activity Mix UI for one-state recorded blocks', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const codex = {
    start: dateStart,
    end: dateStart + 4 * 60 * 1000,
    app: 'Codex',
    title: 'Codex',
    url: '',
    interactionState: 'handsOn',
    activityMix: {
      handsOnMs: 4 * 60 * 1000,
      handsOffMs: 0
    }
  };

  const html = renderMemoryAidHtml({
    zoom: 5,
    activities: [codex],
    timelineActivities: [codex]
  });
  const blockHtml = extractActivityBlockHtml(html, 'Codex');

  assert.match(blockHtml, /duration-pill shrink-0/);
  assert.doesNotMatch(blockHtml, /activity-mix|Activity Mix|Hands-on|Hands-off|data-activity-mix-tooltip|aria-label="Activity Mix/);
  assert.doesNotMatch(blockHtml, /--activity-mix-hands-on/);
});

test('Activity Mix range calculation preserves non-zero hands-off source segments', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const mix = context.getActivityMixInRange({
    start: dateStart,
    end: dateStart + 10 * 60 * 1000,
    app: 'Oriel',
    title: 'Oriel',
    interactionState: 'handsOn',
    sourceSegments: [
      {
        start: dateStart,
        end: dateStart + 2 * 60 * 1000,
        interactionState: 'handsOn'
      },
      {
        start: dateStart + 2 * 60 * 1000,
        end: dateStart + 10 * 60 * 1000,
        interactionState: 'handsOff'
      }
    ]
  }, dateStart, dateStart + 10 * 60 * 1000);

  assert.equal(mix.handsOnMs, 2 * 60 * 1000);
  assert.equal(mix.handsOffMs, 8 * 60 * 1000);
});

test('Activity Mix controls are absent from normal UI markup', () => {
  const html = fs.readFileSync('web/index.html', 'utf8');

  assert.doesNotMatch(html, /activity-mix-summary|popup-activity-mix|Activity Mix/);
});

test('Activity Mix tooltip renders scannable rows instead of one paragraph', () => {
  const context = loadTimelineContext();
  const tooltip = new FakeElement('activity-mix-tooltip');
  tooltip.getBoundingClientRect = () => ({ width: 260, height: 120 });
  context.DOM.elActivityMixTooltip = tooltip;
  context.window.innerWidth = 1000;

  context.showActivityMixTooltip({
    dataset: {
      activityMixTooltip: 'Activity Mix. Hands-on 2 min · Hands-off 8 min. Hands-on: recent keyboard, mouse, click, or scroll input within 30 seconds. Hands-off: foreground time without input within 30 seconds, such as reading, watching, or listening.',
      activityMixHandsOnDuration: '2 min',
      activityMixHandsOffDuration: '8 min'
    },
    getBoundingClientRect: () => ({ left: 100, width: 40, bottom: 200 })
  });

  assert.equal(tooltip.classList.contains('hidden'), false);
  assert.match(tooltip.innerHTML, /activity-mix-tooltip__title">Activity Mix/);
  assert.match(tooltip.innerHTML, /activity-mix-tooltip__row[\s\S]*Hands-on[\s\S]*2 min/);
  assert.match(tooltip.innerHTML, /activity-mix-tooltip__row[\s\S]*Hands-off[\s\S]*8 min/);
  assert.match(tooltip.innerHTML, /Recent keyboard, mouse, click, or scroll input within 30 seconds\./);
  assert.match(tooltip.innerHTML, /Foreground time without recent input, such as reading, watching, or listening\./);
});

test('Activity Mix info icon explains the concept without a repeated heading or durations', () => {
  const context = loadTimelineContext();
  const tooltip = new FakeElement('activity-mix-tooltip');
  tooltip.getBoundingClientRect = () => ({ width: 260, height: 90 });
  context.DOM.elActivityMixTooltip = tooltip;
  context.window.innerWidth = 1000;

  context.showActivityMixTooltip({
    dataset: {
      activityMixTooltip: 'Shows how much of this recorded foreground time included recent keyboard, mouse, click, or scroll input within 30 seconds. Hands-off still counts when the app stayed in front while you read, watched, or listened.',
      activityMixTooltipVariant: 'summary'
    },
    getBoundingClientRect: () => ({ left: 100, width: 20, bottom: 200 })
  });

  assert.equal(tooltip.classList.contains('hidden'), false);
  assert.doesNotMatch(tooltip.innerHTML, /activity-mix-tooltip__title/);
  assert.match(tooltip.innerHTML, /Shows how much of this recorded foreground time included recent keyboard, mouse, click, or scroll input within 30 seconds/);
  assert.match(tooltip.innerHTML, /Hands-off still counts when the app stayed in front while you read, watched, or listened/);
  assert.doesNotMatch(tooltip.innerHTML, /activity-mix-tooltip__row/);
  assert.doesNotMatch(tooltip.innerHTML, /2 min|8 min/);
});

test('Activities popup renders browser rows directly without host session children', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'chatgpt.com',
        url: 'https://chatgpt.com/',
        start: blockStart,
        end: blockStart + 60 * 1000,
        duration: 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Context Switching Simplification',
        url: 'https://chatgpt.com/c/123',
        start: blockStart + 60 * 1000,
        end: blockStart + 4 * 60 * 1000,
        duration: 3 * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart + 4 * 60 * 1000,
        end: blockStart + 5 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Activities');
  assert.match(popup.renderedMultiList, /class="popup-activity-title"[^>]*>Context Switching Simplification<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /popup-activity-expand|popup-activity-children|popup-activity-child-row|data-popup-child-index/);
  assert.match(popup.renderedMultiList, /title="Brave Browser">Brave Browser<\/span>/);
  assert.match(popup.renderedMultiList, /<span class="popup-activity-title" title="Context Switching Simplification">Context Switching Simplification<\/span>\s*<a href="https:\/\/chatgpt\.com\/c\/123"[^>]*class="popup-activity-external-link[^"]*"[^>]*>/);
  assert.match(popup.renderedMultiList, /<i class="ph ph-arrow-square-out/);
  assert.equal((popup.renderedMultiList.match(/data-popup-overlap-index/g) || []).length, 3);
});

test('Activities popup shows canonical rows in timeline order without source children', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 14 * 60 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    startCell: 14 * 12,
    span: 2,
    app: 'Brave Browser',
    title: 'Activities',
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'Planning notes',
        url: 'https://example.com/work-plan',
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Checkout step',
        url: 'https://example.com/cart',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 2 * 60 * 1000 + 29 * 1000,
        duration: 29 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart + 3 * 60 * 1000,
        end: blockStart + 4 * 60 * 1000,
        duration: 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Planning notes',
        url: 'https://example.com/work-plan',
        start: blockStart + 6 * 60 * 1000,
        end: blockStart + 8 * 60 * 1000,
        duration: 2 * 60 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Activities');
  assert.equal((popup.renderedMultiList.match(/data-popup-overlap-index/g) || []).length, 3);
  assert.equal((popup.renderedMultiList.match(/class="popup-activity-title"[^>]*>Planning notes<\/span>/g) || []).length, 2);
  assert.ok(popup.renderedMultiList.indexOf('Planning notes') < popup.renderedMultiList.indexOf('Codex'));
  assert.ok(popup.renderedMultiList.indexOf('Codex') < popup.renderedMultiList.lastIndexOf('Planning notes'));
  assert.doesNotMatch(popup.renderedMultiList, /popup-activity-expand|popup-activity-child-row|data-popup-child-index/);
  assert.doesNotMatch(popup.renderedMultiList, /Checkout step|29s|class="popup-activity-title"[^>]*>example\.com<\/span>/);
  assert.equal(popup.context.DOM.elPopupAssignBtn.disabled, true);
  assert.match(popup.context.DOM.elPopupAssignBtn.innerHTML, /Select Activities/);

  popup.popupRows[0].querySelector('.popup-activity-select').click();

  assert.equal(popup.context.DOM.elPopupAssignBtn.disabled, false);
  assert.match(popup.context.DOM.elPopupAssignBtn.innerHTML, /Assign 1 Activity/);

  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[6].length, 1);
  assert.equal(popup.modalArgs[6][0].title, 'Planning notes');
});

test('Activities popup renders a single website page as a canonical row', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 255 * 5 * 60 * 1000;
  const pageTitle = 'The AI question no one wants to ask';
  const pageUrl = 'https://www.youtube.com/watch?v=single-page';
  const popup = renderMultipleActivitiesPopup({
    startCell: 255,
    app: 'Brave Browser',
    title: 'Multiple Activities',
    url: '',
    overlaps: [
      {
        app: 'Brave Browser',
        title: pageTitle,
        url: pageUrl,
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Oriel',
        title: 'Oriel',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 3 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Activities');
  assert.match(popup.renderedMultiList, new RegExp(`class="popup-activity-title"[^>]*>${pageTitle}<\\/span>`));
  assert.ok(popup.renderedMultiList.includes(`href="${pageUrl}"`));
  assert.match(popup.renderedMultiList, /title="Brave Browser">Brave Browser<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /popup-activity-expand|popup-activity-child-row/);
  assert.equal((popup.renderedMultiList.match(/data-popup-child-index/g) || []).length, 0);

  popup.popupRows[0].querySelector('.popup-activity-select').click();
  popup.popupRows[1].querySelector('.popup-activity-select').click();
  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[6].length, 2);
  assert.equal(popup.modalArgs[6][0].sources.length, 1);
  assert.equal(popup.modalArgs[6][0].sources[0].title, pageTitle);
  assert.equal(popup.modalArgs[6][0].sources[0].url, pageUrl);
});

test('single host-primary browser popup promotes one unique page without child rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 21 * 60 * 60 * 1000;
  const pageTitle = 'The AI question no one wants to ask';
  const pageUrl = 'https://www.youtube.com/watch?v=single-page';
  const popup = renderMultipleActivitiesPopup({
    zoom: 5,
    startCell: 21 * 12,
    span: 1,
    app: 'Brave Browser',
    title: 'youtube.com',
    url: 'https://www.youtube.com/',
    datasetOverrides: {
      startMs: String(blockStart),
      endMs: String(blockStart + 5 * 60 * 1000),
      activeDurationMs: String(2 * 60 * 1000)
    },
    overlaps: [
      {
        app: 'Brave Browser',
        title: pageTitle,
        url: pageUrl,
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, pageTitle);
  assert.equal(popup.context.DOM.elPopupTitle.innerText, 'Brave Browser');
  assert.equal(popup.context.DOM.elPopupUrl.innerText, pageUrl);
  assert.equal(popup.context.DOM.elPopupUrl.href, pageUrl);
  assert.equal(popup.renderedMultiList, '');
  assert.equal(popup.renderedSingleChildren, '');

  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[6].length, 1);
  assert.equal(popup.modalArgs[6][0].modalAggregateGroupKey, 'brave browser|||the ai question no one wants to ask');
  assert.equal(popup.modalArgs[6][0].sources.length, 1);
  assert.equal(popup.modalArgs[6][0].sources[0].title, pageTitle);
  assert.equal(popup.modalArgs[6][0].sources[0].url, pageUrl);
});

test('browser activity popup shows canonical page rows without child rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 12 * 60 * 60 * 1000;
  const videoTitle = "AI bubble: 'It's approaching vindication hour for me' | Ed Zitron";
  const videoUrl = 'https://www.youtube.com/watch?v=VFBWfPQpGXc';
  const popup = renderMultipleActivitiesPopup({
    zoom: 1,
    startCell: 12 * 60,
    span: 20,
    app: 'Brave Browser',
    title: videoTitle,
    url: videoUrl,
    overlaps: [
      {
        app: 'Brave Browser',
        title: videoTitle,
        url: videoUrl,
        start: blockStart,
        end: blockStart + 19 * 60 * 1000,
        duration: 19 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'YouTube',
        url: 'https://www.youtube.com/',
        start: blockStart + 19 * 60 * 1000,
        end: blockStart + 20 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Activities');
  assert.match(popup.renderedMultiList, /class="popup-activity-title"[^>]*>AI bubble:/);
  assert.match(popup.renderedMultiList, /Ed Zitron<\/span>/);
  assert.match(popup.renderedMultiList, /class="popup-activity-title"[^>]*>YouTube<\/span>/);
  assert.match(popup.renderedMultiList, /href="https:\/\/www\.youtube\.com\/watch\?v=VFBWfPQpGXc"/);
  assert.doesNotMatch(popup.renderedMultiList, /popup-activity-child-row|data-popup-child-index|popup-activity-expand/);
  assert.equal(popup.renderedSingleChildren, '');

  popup.popupRows[0].querySelector('.popup-activity-select').click();
  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[6].length, 1);
  assert.equal(popup.modalArgs[6][0].title, videoTitle);
  assert.equal(popup.modalArgs[6][0].url, videoUrl);
  assert.equal(popup.modalArgs[6][0].sources.length, 1);
});

test('same-host browser popup keeps canonical Tweakers pages as top-level rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + (9 * 60 + 30) * 60 * 1000;
  const articleTitle = "Apple maakt RAW-foto's veel scherper in RAW 9 - Tweakers";
  const articleUrl = 'https://tweakers.net/nieuws/249066/apple-maakt-raw-fotos-veel-scherper-in-raw-9.html';
  const popup = renderMultipleActivitiesPopup({
    zoom: 5,
    startCell: 9 * 12 + 6,
    span: 1,
    app: 'Brave Browser',
    title: articleTitle,
    url: articleUrl,
    overlaps: [
      {
        app: 'Brave Browser',
        title: articleTitle,
        url: articleUrl,
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Tweakers: tech-community, nieuws, reviews en de Pricewatch',
        url: 'https://tweakers.net/',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 3 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Activities');
  assert.match(popup.renderedMultiList, /Apple maakt RAW-foto&#39;s veel scherper in RAW 9 - Tweakers/);
  assert.match(popup.renderedMultiList, /Tweakers: tech-community, nieuws, reviews en de Pricewatch/);
  assert.match(popup.renderedMultiList, /href="https:\/\/tweakers\.net\/nieuws\/249066\/apple-maakt-raw-fotos-veel-scherper-in-raw-9\.html"/);
  assert.doesNotMatch(popup.renderedMultiList, /popup-activity-child-row|data-popup-child-index|popup-activity-expand/);
  assert.equal(popup.renderedSingleChildren, '');
});

test('Activities popup renders same-host browser rows as assignable canonical rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const startCell = 183;
  const blockStart = dateStart + startCell * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    startCell,
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'Meal Ingredients List',
        url: 'https://chatgpt.com/c/meal',
        start: blockStart,
        end: blockStart + 2500,
        duration: 2500
      },
      {
        app: 'Brave Browser',
        title: 'User Activity Analysis',
        url: 'https://chatgpt.com/c/activity',
        start: blockStart + 20 * 1000,
        end: blockStart + 11 * 60 * 1000,
        duration: 10 * 60 * 1000 + 40 * 1000
      },
      {
        app: 'LM Studio',
        title: 'LM Studio',
        start: blockStart + 11 * 60 * 1000,
        end: blockStart + 14 * 60 * 1000,
        duration: 3 * 60 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Activities');
  assert.doesNotMatch(popup.renderedMultiList, /class="popup-activity-title"[^>]*>chatgpt\.com<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /popup-activity-expand|popup-activity-children|popup-activity-child-row|data-popup-child-index/);
  assert.match(popup.renderedMultiList, /class="popup-activity-title"[^>]*>User Activity Analysis<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /class="popup-activity-title"[^>]*>Meal Ingredients List<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /href="https:\/\/chatgpt\.com\/?"/);
  assert.doesNotMatch(popup.renderedMultiList, /href="https:\/\/chatgpt\.com\/c\/meal"/);
  assert.match(popup.renderedMultiList, /href="https:\/\/chatgpt\.com\/c\/activity"/);
  assert.equal((popup.renderedMultiList.match(/data-popup-overlap-index/g) || []).length, 2);
});

test('Multiple Activities popup falls back to host when browser titles are URL-like', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'https://app.ynab.com/5f53b33e-a5f5-46fd-a8d8-bf8885fa5c8f/budget',
        url: 'https://app.ynab.com/5f53b33e-a5f5-46fd-a8d8-bf8885fa5c8f/budget',
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'app.ynab.com/5f53b33e-a5f5-46fd-a8d8-bf8885fa5c8f/budget',
        url: 'https://app.ynab.com/5f53b33e-a5f5-46fd-a8d8-bf8885fa5c8f/budget',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 4 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Oriel',
        title: 'Oriel',
        start: blockStart + 4 * 60 * 1000,
        end: blockStart + 5 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.match(popup.renderedMultiList, /class="popup-activity-title"[^>]*>app\.ynab\.com<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /title="app\.ynab\.com\/5f53b33e|>app\.ynab\.com\/5f53b33e/);
  assert.match(popup.renderedMultiList, /href="https:\/\/app\.ynab\.com\/5f53b33e-a5f5-46fd-a8d8-bf8885fa5c8f\/budget"/);
  assert.match(popup.renderedMultiList, /title="Brave Browser">Brave Browser<\/span>/);
});

test('Activity Stream browser subtitles show only the app while preserving URL data', () => {
  const titleCleaner = loadTitleCleaningContext().cleanTitle;
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const html = renderActivityBlockChromeHtml({
    startCell: 118,
    app: 'Brave Browser',
    title: 'Facebook - Brave - Base',
    url: 'https://www.facebook.com/home',
    cleanTitle: titleCleaner,
    overlaps: [{
      app: 'Brave Browser',
      title: 'Facebook - Brave - Base',
      url: 'https://www.facebook.com/home',
      start: blockStart,
      end: blockStart + 2 * 60 * 1000,
      duration: 2 * 60 * 1000
    }]
  });

  assert.match(html, />Facebook<\/span>/);
  assert.match(html, />Brave Browser<\/span>/);
  assert.doesNotMatch(html, /Brave Browser \(facebook\.com\)/);
  assert.doesNotMatch(html, /Brave Browser \(www\.facebook\.com\)/);
  assert.match(html, /data-url="https:\/\/www\.facebook\.com\/home"/);
});

test('coarse mixed Activity Stream rows use the primary popup row for icon metadata', () => {
  const dateStart = new Date(2026, 5, 16).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 17 * 60 * 60 * 1000;
  const html = renderActivityBlockChromeHtml({
    startCell: 17 * 12,
    span: 1,
    currentDate: new Date(dateStart),
    app: 'Oriel',
    title: 'Oriel',
    url: '',
    blockOverrides: {
      appPath: '/Applications/Oriel.app',
      bundleId: 'so.sil.oriel'
    },
    overlaps: [
      {
        app: 'Oriel',
        title: 'Oriel',
        appPath: '/Applications/Oriel.app',
        bundleId: 'so.sil.oriel',
        start: blockStart,
        end: blockStart + 60 * 1000,
        duration: 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Alan Watts - What Is Reality?',
        url: 'https://www.youtube.com/watch?v=reality',
        appPath: '/Applications/Brave Browser.app',
        bundleId: 'com.brave.Browser',
        start: blockStart,
        end: blockStart + 4 * 60 * 1000,
        duration: 4 * 60 * 1000
      }
    ],
    iconFactory: (iconApp, iconUrl, iconTitle, iconAppPath, iconBundleId) => (
      `<span class="fake-icon" data-icon="${iconApp}" data-url="${iconUrl}" data-title="${iconTitle}" data-app-path="${iconAppPath}" data-bundle-id="${iconBundleId}"></span>`
    )
  });
  const primaryIcon = html.match(/<div class="activity-block__icon">\s*<span class="fake-icon" data-icon="([^"]*)" data-url="([^"]*)" data-title="([^"]*)" data-app-path="([^"]*)" data-bundle-id="([^"]*)"/);

  assert.ok(primaryIcon, 'Expected primary Activity Stream icon');
  assert.deepEqual(primaryIcon.slice(1), [
    'Brave Browser',
    'https://www.youtube.com/watch?v=reality',
    'Alan Watts - What Is Reality?',
    '/Applications/Brave Browser.app',
    'com.brave.Browser'
  ]);
  assert.match(html, />Alan Watts - What Is Reality\?<\/span>/);
  assert.match(html, />Brave Browser<\/span>/);
  assert.doesNotMatch(html, /<div class="activity-block__icon">\s*<span class="fake-icon" data-icon="Oriel"/);
});

test('same-host browser activity with different page titles renders canonical rows', () => {
  const titleCleaner = loadTitleCleaningContext().cleanTitle;
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    cleanTitle: titleCleaner,
    app: 'Brave Browser',
    title: 'Client Portal - Brave - Base',
    url: 'https://client.example.com/dashboard',
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'Client Portal - Brave - Base',
        url: 'https://client.example.com/dashboard',
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Client Portal Settings - Brave - Base',
        url: 'https://client.example.com/settings',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 4 * 60 * 1000,
        duration: 2 * 60 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Activities');
  assert.match(popup.renderedMultiList, /class="popup-activity-title"[^>]*>Client Portal<\/span>/);
  assert.match(popup.renderedMultiList, /class="popup-activity-title"[^>]*>Client Portal Settings<\/span>/);
  assert.match(popup.renderedMultiList, /href="https:\/\/client\.example\.com\/dashboard"/);
  assert.match(popup.renderedMultiList, /href="https:\/\/client\.example\.com\/settings"/);
  assert.doesNotMatch(popup.renderedMultiList, /popup-activity-child-row|data-popup-child-index|popup-activity-expand/);
  assert.equal(popup.renderedSingleChildren, '');
});

test('Activities popup host fallback strips leading www from browser labels', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'www.facebook.com/home',
        url: 'https://www.facebook.com/home',
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 3 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Activities');
  assert.match(popup.renderedMultiList, /class="popup-activity-title"[^>]*>facebook\.com<\/span>/);
  assert.match(popup.renderedMultiList, /title="Brave Browser">Brave Browser<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /title="www\.facebook\.com|>www\.facebook\.com/);
});

test('Multiple Activities popup suppresses duplicate native app secondary labels', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    app: 'Codex',
    title: 'Codex',
    overlaps: [
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart,
        end: blockStart + 2 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Oriel',
        title: 'Oriel',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 3 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  assert.match(popup.renderedMultiList, /class="popup-activity-title"[^>]*>Codex<\/span>/);
  assert.equal((popup.renderedMultiList.match(/class="popup-activity-title" title="Codex"/g) || []).length, 1);
  assert.doesNotMatch(popup.renderedMultiList, /class="popup-activity-secondary" title="Codex">Codex<\/span>/);
});

test('Activities popup display labels do not rewrite assignment payloads', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'chatgpt.com',
        url: 'https://chatgpt.com/',
        start: blockStart,
        end: blockStart + 60 * 1000,
        duration: 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Context Switching Simplification',
        url: 'https://chatgpt.com/c/123',
        start: blockStart + 60 * 1000,
        end: blockStart + 4 * 60 * 1000,
        duration: 3 * 60 * 1000
      },
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart + 4 * 60 * 1000,
        end: blockStart + 5 * 60 * 1000,
        duration: 60 * 1000
      }
    ]
  });

  popup.popupRows[1].querySelector('.popup-activity-select').click();
  popup.context.DOM.elPopupAssignBtn.onclick();

  const browserAssignment = popup.modalArgs[6].find(activity => activity.app === 'Brave Browser');
  assert.equal(browserAssignment.title, 'Context Switching Simplification');
  assert.equal(browserAssignment.url, 'https://chatgpt.com/c/123');
  assert.equal(browserAssignment.assignmentModel, 'activity-stream-summary');
  assert.ok(browserAssignment.sources.some(source => source.url === 'https://chatgpt.com/c/123'));
});

test('single Activity Stream popup assignment carries visible display bounds', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const startCell = 702;
  const span = 6;
  const zoom = 1;
  const blockStart = dateStart + startCell * zoom * 60 * 1000;
  const blockEnd = blockStart + span * zoom * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    startCell,
    span,
    zoom,
    app: 'Chatbox',
    title: 'Chatbox',
    overlaps: [{
      app: 'Chatbox',
      title: 'Chatbox',
      appPath: '/Applications/Chatbox.app',
      bundleId: 'xyz.chatboxapp.app',
      start: blockStart + 2 * 60 * 1000,
      end: blockStart + 3 * 60 * 1000,
      duration: 60 * 1000
    }]
  });

  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[6].length, 1);
  assert.equal(popup.modalArgs[6][0].app, 'Chatbox');
  assert.equal(popup.modalArgs[6][0].assignmentDisplayStart, blockStart);
  assert.equal(popup.modalArgs[6][0].assignmentDisplayEnd, blockEnd);
  assert.match(popup.modalArgs[6][0].assignmentDisplayGroupKey, /chatbox/);
  assert.equal(popup.modalArgs[6][0].sources[0].assignmentDisplayStart, blockStart);
  assert.equal(popup.modalArgs[6][0].sources[0].assignmentDisplayEnd, blockEnd);
});

test('single visible activity hides unrelated short source rows from popup detail', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  let renderedMultiList = '';
  let modalArgs = null;

  const createClassList = () => ({
    add() {},
    remove() {},
    contains() {
      return false;
    }
  });

  context.DOM.elPopupDuration = { innerText: '', title: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupTitle = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: createClassList(), querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: createClassList() };
  context.DOM.elPopupUrlContainer = { classList: createClassList() };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
    },
    get innerHTML() {
      return renderedMultiList;
    },
    querySelectorAll() {
      return [];
    }
  };
  context.DOM.elPopupActivityMixContainer = { classList: createClassList(), setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupActivityMixLabel = { innerText: '' };
  context.DOM.elPopupActivityMixInfo = { setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = { style: {}, classList: createClassList() };
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: String(10 * 12 + 45 / 5),
      span: '3',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          app: 'Codex',
          title: 'Codex',
          start: dateStart + (10 * 60 + 45) * 60 * 1000,
          end: dateStart + (10 * 60 + 56) * 60 * 1000,
          duration: 11 * 60 * 1000
        },
        {
          app: 'Oriel',
          title: 'Oriel',
          start: dateStart + (10 * 60 + 56) * 60 * 1000,
          end: dateStart + (10 * 60 + 56) * 60 * 1000 + 23 * 1000,
          duration: 23 * 1000
        },
        {
          app: 'SoundCloud',
          title: 'SoundCloud',
          start: dateStart + (10 * 60 + 57) * 60 * 1000,
          end: dateStart + (10 * 60 + 57) * 60 * 1000 + 17 * 1000,
          duration: 17 * 1000
        }
      ]))
    }
  });

  assert.equal(context.DOM.elPopupDuration.innerText, '11 min');
  assert.equal(context.DOM.elPopupAppName.innerText, 'Codex');
  assert.equal(context.DOM.elPopupTitle.innerText, 'Codex');
  assert.equal(renderedMultiList, '');
  assert.doesNotMatch(renderedMultiList, /Other activity/);
  assert.doesNotMatch(renderedMultiList, /Oriel/);
  assert.doesNotMatch(renderedMultiList, /SoundCloud/);

  context.DOM.elPopupAssignBtn.onclick();

  assert.equal(modalArgs[6].length, 1);
  assert.equal(modalArgs[6][0].app, 'Codex');
});

test('single sub-minute Activity Stream details popup still shows seconds', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);

  const createClassList = () => ({
    add() {},
    remove() {},
    contains() {
      return false;
    }
  });

  context.DOM.elPopupDuration = { innerText: '', title: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupTitle = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: createClassList(), querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: createClassList() };
  context.DOM.elPopupUrlContainer = { classList: createClassList() };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = { innerHTML: '', querySelectorAll() { return []; } };
  context.DOM.elPopupActivityMixContainer = { classList: createClassList(), setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupActivityMixLabel = { innerText: '' };
  context.DOM.elPopupActivityMixInfo = { setAttribute() {}, removeAttribute() {} };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = { style: {}, classList: createClassList() };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: '0',
      span: '1',
      app: 'Oriel',
      title: 'Oriel',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([{
        app: 'Oriel',
        title: 'Oriel',
        start: dateStart,
        end: dateStart + 23 * 1000,
        duration: 23 * 1000
      }]))
    }
  });

  assert.equal(context.DOM.elPopupDuration.innerText, '23s');
});

test('Activities popup hides positive subsecond source fragments', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const popup = renderMultipleActivitiesPopup({
    startCell: 0,
    span: 1,
    app: 'Brave Browser',
    title: 'vinted.nl',
    url: 'https://www.vinted.nl/',
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'Word lid en verkoop tweedehands kleding zonder kosten | Vinted',
        url: 'https://www.vinted.nl/member/signup/select_type',
        start: dateStart,
        end: dateStart + 60 * 1000,
        duration: 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'vinted.nl',
        url: 'https://www.vinted.nl/',
        start: dateStart + 60 * 1000,
        end: dateStart + 60 * 1000 + 400,
        duration: 400
      },
      {
        app: 'Codex',
        title: 'Codex',
        start: dateStart + 61 * 1000,
        end: dateStart + 3 * 60 * 1000,
        duration: 119 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Activities');
  assert.match(popup.renderedMultiList, /Word lid en verkoop tweedehands kleding/);
  assert.match(popup.renderedMultiList, /Codex/);
  assert.doesNotMatch(popup.renderedMultiList, />1s<\/span>|>0s<\/span>|class="popup-activity-title"[^>]*>vinted\.nl<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /popup-activity-child-row|data-popup-child-index|popup-activity-expand/);
});

test('Activities popup does not expose all-subminute generic fragments as raw rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const popup = renderMultipleActivitiesPopup({
    startCell: 0,
    span: 1,
    app: 'Brave Browser',
    title: 'Activities',
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'Fast checkout',
        url: 'https://shop.example/checkout',
        start: dateStart,
        end: dateStart + 35 * 1000,
        duration: 35 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Quick reference',
        url: 'https://docs.example/reference',
        start: dateStart + 2 * 60 * 1000,
        end: dateStart + 2 * 60 * 1000 + 45 * 1000,
        duration: 45 * 1000
      }
    ]
  });

  assert.equal(popup.renderedMultiList, '');
  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Quick reference');
  assert.doesNotMatch(popup.renderedSingleChildren, /Fast checkout|35s|45s|popup-activity-child-row|data-popup-child-index/);
});

test('Multiple Activities block duration matches popup-visible breakdown duration', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const startCell = 155;
  const blockStart = dateStart + startCell * 5 * 60 * 1000;
  const overlaps = [
    {
      app: 'Codex',
      title: 'Codex',
      start: blockStart,
      end: blockStart + 64 * 1000,
      duration: 64 * 1000
    },
    {
      app: 'Oriel',
      title: 'Oriel',
      start: blockStart + 2 * 60 * 1000,
      end: blockStart + 2 * 60 * 1000 + 45 * 1000,
      duration: 45 * 1000
    }
  ];
  const blockHtml = renderActivityBlockChromeHtml({
    startCell,
    span: 1,
    app: 'Codex',
    title: 'Codex',
    overlaps
  });
  const popup = renderMultipleActivitiesPopup({
    startCell,
    span: 1,
    app: 'Codex',
    title: 'Codex',
    overlaps
  });

  assert.equal(extractActivityDuration(blockHtml, 'Codex'), '1 min');
  assert.equal(popup.context.DOM.elPopupDuration.innerText, '1 min');
  assert.equal(extractActivityDuration(blockHtml, 'Codex'), popup.context.DOM.elPopupDuration.innerText);
});

test('Activity Stream inline badges use popup-visible secondary rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + (12 * 60 + 45) * 60 * 1000;
  const noisySwitches = Array.from({ length: 12 }, (_, index) => ({
    app: `Noise ${index}`,
    title: `Noise ${index}`,
    start: blockStart + (8 * 60 + index * 5) * 1000,
    end: blockStart + (8 * 60 + index * 5 + 3) * 1000,
    duration: 3 * 1000
  }));
  const html = renderActivityBlockChromeHtml({
    app: 'Codex',
    title: 'Coding Session',
    overlaps: [
      {
        app: 'Codex',
        title: 'Coding Session',
        start: blockStart,
        end: blockStart + 7 * 60 * 1000,
        duration: 7 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Security Problem - YouTube',
        url: 'https://www.youtube.com/watch?v=1',
        start: blockStart + 60 * 1000,
        end: blockStart + 2 * 60 * 1000,
        duration: 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Another YouTube Title',
        url: 'https://www.youtube.com/watch?v=2',
        start: blockStart + 2 * 60 * 1000,
        end: blockStart + 3 * 60 * 1000,
        duration: 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'nu.nl',
        url: 'https://www.nu.nl/',
        start: blockStart + 3 * 60 * 1000,
        end: blockStart + 5 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'x.com',
        url: 'https://x.com/home',
        start: blockStart + 5 * 60 * 1000,
        end: blockStart + 7 * 60 * 1000,
        duration: 2 * 60 * 1000
      },
      ...noisySwitches
    ]
  });

  assert.equal(countActivityIcon(html, 'Codex'), 1);
  assert.equal(countActivityIcon(html, 'Brave Browser'), 2);
  assert.match(html, />\s*\+2\s*</);
  assert.doesNotMatch(html, /\+\d{2,}/);
  for (const activity of noisySwitches) {
    assert.equal(countActivityIcon(html, activity.app), 0);
  }
});

test('Activity Stream inline badges hide when secondary rows are only sub-minute', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + (13 * 60 + 20) * 60 * 1000;
  const html = renderActivityBlockChromeHtml({
    overlaps: [
      {
        app: 'Codex',
        title: 'Codex',
        start: blockStart,
        end: blockStart + 5 * 60 * 1000,
        duration: 5 * 60 * 1000
      },
      {
        app: 'Oriel',
        title: 'Oriel',
        start: blockStart + 60 * 1000,
        end: blockStart + 80 * 1000,
        duration: 20 * 1000
      },
      {
        app: 'SoundCloud',
        title: 'SoundCloud',
        start: blockStart + 90 * 1000,
        end: blockStart + 125 * 1000,
        duration: 35 * 1000
      }
    ]
  });

  assert.equal(countActivityIcon(html, 'Codex'), 1);
  assert.equal(countActivityIcon(html, 'Oriel'), 0);
  assert.equal(countActivityIcon(html, 'SoundCloud'), 0);
  assert.doesNotMatch(html, />\s*\+\d+\s*</);
});

test('activity summaries clip hands-on and hands-off source segments to the selected range', () => {
  const context = loadTimelineContext();
  const summaries = context.summarizeActivityOverlaps([
    {
      start: 0,
      end: 10 * 60 * 1000,
      duration: 10 * 60 * 1000,
      app: 'Brave Browser',
      title: 'Long article',
      url: 'https://example.com/article',
      interactionState: 'handsOn',
      activityMix: {
        handsOnMs: 2 * 60 * 1000,
        handsOffMs: 8 * 60 * 1000
      },
      sourceSegments: [
        { start: 0, end: 2 * 60 * 1000, interactionState: 'handsOn' },
        { start: 2 * 60 * 1000, end: 10 * 60 * 1000, interactionState: 'handsOff' }
      ]
    }
  ], 60 * 1000, 5 * 60 * 1000);
  const summary = summaries[0];

  assert.equal(summary.duration, 4 * 60 * 1000);
  assert.equal(summary.activityMix.handsOnMs, 60 * 1000);
  assert.equal(summary.activityMix.handsOffMs, 3 * 60 * 1000);
  assert.equal(summary.sources[0].activityMix.handsOnMs, 60 * 1000);
  assert.equal(summary.sources[0].activityMix.handsOffMs, 3 * 60 * 1000);
});

test('activity summaries sum similar browser activities by hostname and cleaned title', () => {
  const context = loadTimelineContext();
  context.cleanTitle = title => title.replace(/\s+-\s+Brave Browser$/, '');

  const summaries = context.summarizeActivityOverlaps([
    {
      app: 'Brave Browser',
      title: 'Plan | Personal | YNAB - Brave Browser',
      url: 'https://app.ynab.com/accounts/1',
      duration: 2 * 60 * 1000,
      start: 1000,
      end: 121000
    },
    {
      app: 'Brave Browser',
      title: 'Plan | Personal | YNAB - Brave Browser',
      url: 'https://app.ynab.com/accounts/2',
      duration: 3 * 60 * 1000,
      start: 121000,
      end: 301000
    },
    {
      app: 'Brave Browser',
      title: 'Plan | Personal | YNAB - Brave Browser',
      url: 'https://support.ynab.com/',
      duration: 60 * 1000,
      start: 301000,
      end: 361000
    }
  ]);

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].title, 'Plan | Personal | YNAB');
  assert.equal(summaries[0].url, 'https://app.ynab.com/accounts/1');
  assert.equal(summaries[0].duration, 5 * 60 * 1000);
  assert.equal(summaries[1].duration, 60 * 1000);
});

test('activity summaries preserve non-contiguous source segments for assignment', () => {
  const context = loadTimelineContext();

  const firstStart = 1000;
  const firstEnd = firstStart + 2 * 60 * 1000;
  const secondStart = firstStart + 10 * 60 * 1000;
  const secondEnd = secondStart + 3 * 60 * 1000;
  const summaries = context.summarizeActivityOverlaps([
    {
      app: 'Codex',
      title: 'Codex',
      duration: firstEnd - firstStart,
      start: firstStart,
      end: firstEnd
    },
    {
      app: 'Codex',
      title: 'Codex',
      duration: secondEnd - secondStart,
      start: secondStart,
      end: secondEnd
    }
  ]);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].start, firstStart);
  assert.equal(summaries[0].end, secondEnd);
  assert.equal(summaries[0].duration, 5 * 60 * 1000);
  assert.deepEqual(Array.from(summaries[0].sources, source => [source.start, source.end]), [
    [firstStart, firstEnd],
    [secondStart, secondEnd]
  ]);
});

test('activity summaries are ordered from old to new', () => {
  const context = loadTimelineContext();

  const summaries = context.summarizeActivityOverlaps([
    {
      app: 'Codex',
      title: 'Later',
      duration: 10 * 60 * 1000,
      start: 2000,
      end: 12000
    },
    {
      app: 'Brave Browser',
      title: 'Earlier',
      duration: 60 * 1000,
      start: 1000,
      end: 2000
    }
  ]);

  assert.equal(Array.from(summaries, summary => summary.title).join(','), 'Earlier,Later');
});

test('time entry modal excludes unchecked recorded activities from the saved snapshot helper', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();
  const rangeActivities = [
    {
      app: 'Codex',
      title: 'Codex',
      url: '',
      duration: 9 * 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Reference Browser Tab',
      url: 'http://localhost:3000/',
      duration: 4 * 60 * 1000
    }
  ];

  context.openTimeEntryModal(startMs, startMs + 60 * 60 * 1000, '', null, null, false, rangeActivities);

  assert.match(elements.get('modal-memory-aid-list').innerHTML, /data-modal-activity-index="0"/);
  assert.match(elements.get('modal-memory-aid-list').innerHTML, /data-modal-activity-index="1"/);
  assert.equal(context.getSelectedModalActivities().length, 2);

  context.setModalActivityIncluded(1, false);

  assert.deepEqual(context.getSelectedModalActivities().map(activity => activity.app), ['Codex']);
  assert.deepEqual(context.state.currentModalActivities.map(activity => activity.app), ['Codex']);
});

test('drag-created time entry modal hides sub-minute activities and sums visible candidates', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 11, 30).getTime();
  const rangeActivities = [
    {
      app: 'Brave Browser',
      title: 'Quick tab',
      url: 'https://example.com/quick',
      duration: 45 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'One minute tab',
      url: 'https://example.com/one',
      duration: 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Two minute tab',
      url: 'https://example.com/two',
      duration: 2 * 60 * 1000
    }
  ];

  context.openTimeEntryModal(startMs, startMs + 2.5 * 60 * 60 * 1000, '', null, null, false, rangeActivities);

  const listHtml = elements.get('modal-memory-aid-list').innerHTML;
  assert.doesNotMatch(listHtml, /Quick tab/);
  assert.doesNotMatch(listHtml, />0 min</);
  assert.match(listHtml, /One minute tab/);
  assert.match(listHtml, /Two minute tab/);
  assert.equal(context.getSelectedModalActivities().length, 2);
  assert.equal(elements.get('modal-duration-lbl').innerText, '3 min');
});

test('drag-created time entry modal duration follows deselected visible activities', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 11, 30).getTime();
  const rangeActivities = [
    {
      app: 'Brave Browser',
      title: 'One minute tab',
      url: 'https://example.com/one',
      duration: 60 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Two minute tab',
      url: 'https://example.com/two',
      duration: 2 * 60 * 1000
    }
  ];

  context.openTimeEntryModal(startMs, startMs + 2.5 * 60 * 60 * 1000, '', null, null, false, rangeActivities);

  assert.equal(elements.get('modal-duration-lbl').innerText, '3 min');

  context.setModalActivityIncluded(1, false);
  assert.equal(elements.get('modal-duration-lbl').innerText, '1 min');

  context.setModalActivityIncluded(0, false);
  assert.equal(elements.get('modal-duration-lbl').innerText, '0 min');
});

test('edited time entry modal with explicit activity candidates sums selected activity durations', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 21, 40).getTime();
  const endMs = new Date(2026, 4, 21, 22, 10).getTime();
  const rangeActivities = [
    {
      app: 'Figma',
      title: 'macOS Big Sur icon template',
      bundleId: 'com.figma.Desktop',
      duration: 14 * 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      bundleId: 'com.openai.codex',
      duration: 60 * 1000
    }
  ];

  context.editingTimeEntryId = 'entry-1';
  context.openTimeEntryModal(startMs, endMs, '', 'project-1', true, false, rangeActivities);

  assert.equal(elements.get('modal-duration-lbl').innerText, '15 min');

  context.setModalActivityIncluded(1, false);
  assert.equal(elements.get('modal-duration-lbl').innerText, '14 min');
});

test('saved activity-stream edit collapses canonical rows to one non-expandable row per identity', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 21, 0).getTime();
  const first = {
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/work-plan',
    start: startMs,
    end: startMs + 60 * 1000,
    duration: 60 * 1000,
    assignedDurationMs: 60 * 1000,
    assignmentStart: startMs,
    assignmentEnd: startMs + 60 * 1000,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    sources: [
      {
        app: 'Brave Browser',
        title: 'Checkout step one',
        url: 'https://example.com/work-plan',
        start: startMs,
        end: startMs + 20 * 1000,
        duration: 20 * 1000
      }
    ]
  };
  const second = {
    ...first,
    start: startMs + 5 * 60 * 1000,
    end: startMs + 7 * 60 * 1000,
    duration: 2 * 60 * 1000,
    assignedDurationMs: 2 * 60 * 1000,
    assignmentStart: startMs + 5 * 60 * 1000,
    assignmentEnd: startMs + 7 * 60 * 1000,
    sources: [
      {
        app: 'Brave Browser',
        title: 'Checkout step two',
        url: 'https://example.com/work-plan',
        start: startMs + 5 * 60 * 1000,
        end: startMs + 5 * 60 * 1000 + 40 * 1000,
        duration: 40 * 1000
      }
    ]
  };
  const other = {
    ...first,
    title: 'Other planning notes',
    url: 'https://example.com/other-plan',
    start: startMs + 8 * 60 * 1000,
    end: startMs + 9 * 60 * 1000,
    duration: 60 * 1000,
    assignedDurationMs: 60 * 1000,
    assignmentStart: startMs + 8 * 60 * 1000,
    assignmentEnd: startMs + 9 * 60 * 1000,
    sources: []
  };

  context.window.editingTimeEntryId = 'entry-1';
  context.state.timeEntries = [{
    id: 'entry-1',
    start: startMs,
    end: startMs + 9 * 60 * 1000,
    projectId: 'project-1',
    billable: true,
    activities: [first, second, other]
  }];

  context.openTimeEntryModal(startMs, startMs + 9 * 60 * 1000, '', 'project-1', true, false, null);

  // first + second share one identity → collapse to a single 3-min row; `other`
  // is a second identity → its own 1-min row. No expandable "visits" (issue #1).
  const listHtml = elements.get('modal-memory-aid-list').innerHTML;
  assert.equal((listHtml.match(/data-modal-activity-index/g) || []).length, 2);
  assert.equal((listHtml.match(/data-modal-source-index/g) || []).length, 0);
  assert.doesNotMatch(listHtml, /\d+ visits/);
  assert.doesNotMatch(listHtml, /Source details|Checkout step one|Checkout step two|20s|40s/);
  const collapsedReviewActivities = context.getSelectedModalActivities();
  assert.equal(collapsedReviewActivities.length, 2);
  assert.equal(collapsedReviewActivities[0].modalSourceActivities, undefined);
  assert.equal(collapsedReviewActivities[0].assignedDurationMs, 3 * 60 * 1000);
  assert.equal(elements.get('modal-duration-lbl').innerText, '4 min');
});

test('drag-created time entry modal falls back to manual range when no visible activities remain', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 11, 30).getTime();
  const rangeActivities = [
    {
      app: 'Brave Browser',
      title: 'Quick tab',
      url: 'https://example.com/quick',
      duration: 45 * 1000
    }
  ];

  context.openTimeEntryModal(startMs, startMs + 15 * 60 * 1000, '', null, null, false, rangeActivities);

  assert.equal(elements.get('modal-memory-aid-list').innerHTML, '');
  assert.equal(elements.get('modal-left-panel').classList.contains('hidden'), true);
  assert.equal(context.getSelectedModalActivities().length, 0);
  assert.equal(elements.get('modal-duration-lbl').innerText, '15 min');
});

test('bulk time entry modal keeps separated selected activities as separate rows', () => {
  const { context } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();
  const first = {
    app: 'Brave Browser',
    title: 'Issue Tracker',
    url: 'https://github.com/example',
    start: startMs,
    end: startMs + 15 * 60 * 1000,
    duration: 15 * 60 * 1000
  };
  const second = {
    app: 'Brave Browser',
    title: 'Issue Tracker',
    url: 'https://github.com/example',
    start: startMs + 4 * 60 * 60 * 1000,
    end: startMs + (4 * 60 + 20) * 60 * 1000,
    duration: 20 * 60 * 1000
  };
  context.summarizeActivityOverlaps = activities => [{
    ...activities[0],
    start: activities[0].start,
    end: activities[1].end,
    duration: activities.reduce((total, activity) => total + activity.duration, 0)
  }];

  context.openTimeEntryModal(first.start, second.end, '', null, null, true, [first, second]);

  assert.equal(context.getSelectedModalActivities().length, 2);
  assert.deepEqual(context.getSelectedModalActivities().map(activity => [activity.start, activity.end]), [
    [first.start, first.end],
    [second.start, second.end]
  ]);
});

test('bulk time entry modal duration sums selected activity durations instead of envelope', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();
  const first = {
    app: 'Brave Browser',
    title: 'Issue Tracker',
    url: 'https://github.com/example',
    start: startMs,
    end: startMs + 15 * 60 * 1000,
    duration: 15 * 60 * 1000
  };
  const second = {
    app: 'Brave Browser',
    title: 'Issue Tracker',
    url: 'https://github.com/example',
    start: startMs + 4 * 60 * 60 * 1000,
    end: startMs + (4 * 60 + 20) * 60 * 1000,
    duration: 20 * 60 * 1000
  };

  context.openTimeEntryModal(first.start, second.end, '', null, null, true, [first, second]);

  assert.equal(elements.get('modal-duration-lbl').innerText, '35 min');
});

test('time entry modal uses assigned activity duration for activity-stream edits', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();
  const endMs = startMs + 30 * 60 * 1000;

  context.editingTimeEntryId = 'entry-1';
  context.state.timeEntries = [{
    id: 'entry-1',
    start: startMs,
    end: endMs,
    projectId: 'project-1',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      start: startMs,
      end: endMs,
      duration: 18 * 60 * 1000,
      assignedDurationMs: 18 * 60 * 1000,
      assignmentSource: 'activity-stream'
    }]
  }];

  context.openTimeEntryModal(startMs, endMs, '', 'project-1', true, false, null);

  assert.equal(elements.get('modal-duration-lbl').innerText, '18 min');
  assert.match(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">18 min<\/span>/);
  assert.doesNotMatch(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">30 min<\/span>/);
});

test('time entry modal keeps assigned duration when using the integrated activity summarizer', () => {
  const { context, elements } = loadModalsContext();
  context.URL = URL;
  vm.runInContext(fs.readFileSync('web/js/timeline.js', 'utf8'), context);

  const startMs = new Date(2026, 4, 21, 9, 0).getTime();
  const endMs = startMs + 20 * 60 * 1000;

  context.editingTimeEntryId = 'entry-1';
  context.state.timeEntries = [{
    id: 'entry-1',
    start: startMs,
    end: endMs,
    projectId: 'project-1',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      start: startMs,
      end: endMs,
      duration: 11 * 60 * 1000,
      assignedDurationMs: 11 * 60 * 1000,
      assignmentStart: startMs,
      assignmentEnd: endMs,
      assignmentSource: 'activity-stream'
    }]
  }];

  context.openTimeEntryModal(startMs, endMs, '', 'project-1', true, false, null);

  assert.equal(elements.get('modal-duration-lbl').innerText, '11 min');
  assert.match(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">11 min<\/span>/);
});

test('time entry modal derives legacy activity-stream envelope duration from recorded runs', () => {
  const { context, elements } = loadModalsContext();
  context.URL = URL;
  vm.runInContext(fs.readFileSync('web/js/timeline.js', 'utf8'), context);

  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const envelopeStart = dateStart + (13 * 60) * 60 * 1000;
  const envelopeEnd = dateStart + (13 * 60 + 5) * 60 * 1000;
  const runStart = dateStart + (13 * 60 + 3) * 60 * 1000;
  const runEnd = dateStart + (13 * 60 + 4) * 60 * 1000;

  context.editingTimeEntryId = 'entry-1';
  context.state.activities = [{
    app: 'Codex',
    title: 'Codex',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex',
    start: runStart,
    end: runEnd,
    duration: 60 * 1000
  }];
  context.state.timeEntries = [{
    id: 'entry-1',
    start: envelopeStart,
    end: envelopeEnd,
    projectId: 'project-1',
    activities: [{
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: envelopeStart,
      end: envelopeEnd,
      duration: 2 * 60 * 1000,
      assignedDurationMs: 2 * 60 * 1000,
      assignmentSource: 'activity-stream'
    }]
  }];

  context.openTimeEntryModal(envelopeStart, envelopeEnd, '', 'project-1', true, false, null);

  assert.equal(elements.get('modal-duration-lbl').innerText, '1 min');
  assert.match(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">1 min<\/span>/);
  assert.doesNotMatch(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">2 min<\/span>/);
});

test('grouped activity-stream edit activities derive legacy envelope durations from recorded runs', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstEnvelopeStart = dateStart + (13 * 60) * 60 * 1000;
  const firstEnvelopeEnd = dateStart + (13 * 60 + 5) * 60 * 1000;
  const secondEnvelopeStart = dateStart + (13 * 60 + 15) * 60 * 1000;
  const secondEnvelopeEnd = dateStart + (13 * 60 + 25) * 60 * 1000;

  context.state.activities = [
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (13 * 60 + 3) * 60 * 1000,
      end: dateStart + (13 * 60 + 4) * 60 * 1000,
      duration: 60 * 1000
    },
    {
      app: 'Codex',
      title: 'Codex',
      appPath: '/Applications/Codex.app',
      bundleId: 'com.openai.codex',
      start: dateStart + (13 * 60 + 16) * 60 * 1000,
      end: dateStart + (13 * 60 + 21) * 60 * 1000,
      duration: 5 * 60 * 1000
    }
  ];

  const grouped = context.getGroupedTimeEntryActivities([
    {
      id: 'entry-1',
      start: firstEnvelopeStart,
      end: firstEnvelopeEnd,
      projectId: 'project-1',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: firstEnvelopeStart,
        end: firstEnvelopeEnd,
        assignedDurationMs: 2 * 60 * 1000,
        assignmentSource: 'activity-stream'
      }]
    },
    {
      id: 'entry-2',
      start: secondEnvelopeStart,
      end: secondEnvelopeEnd,
      projectId: 'project-1',
      activities: [{
        app: 'Codex',
        title: 'Codex',
        appPath: '/Applications/Codex.app',
        bundleId: 'com.openai.codex',
        start: secondEnvelopeStart,
        end: secondEnvelopeEnd,
        assignedDurationMs: 7 * 60 * 1000,
        assignmentSource: 'activity-stream'
      }]
    }
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].assignedDurationMs, 6 * 60 * 1000);
  assert.equal(grouped[0].duration, 6 * 60 * 1000);
});

test('time entry modal leaves descriptions empty for recorded activity ranges', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();

  context.openTimeEntryModal(startMs, startMs + 15 * 60 * 1000, 'Work on: Brave Browser', null, null, false, [
    {
      app: 'Brave Browser',
      title: 'Project dashboard',
      url: 'http://localhost:3000/',
      duration: 15 * 60 * 1000
    }
  ]);

  assert.equal(elements.get('modal-description-input').value, '');
});

test('time entry modal offers active categories for the selected project', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();

  context.openTimeEntryModal(startMs, startMs + 15 * 60 * 1000, '', 'project-1', true, false, null, 'task-1');

  assert.equal(elements.get('modal-task-container').classList.contains('hidden'), false);
  assert.match(elements.get('modal-task-select').innerHTML, /No category/);
  assert.match(elements.get('modal-task-select').innerHTML, /Planning/);
  assert.doesNotMatch(elements.get('modal-task-select').innerHTML, /Archived Task/);
  assert.equal(elements.get('modal-task-select').value, 'task-1');
});

test('selected activity assignment modal uses clear assignment copy', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();

  context.openTimeEntryModal(startMs, startMs + 15 * 60 * 1000, '', null, null, true, [
    {
      app: 'Codex',
      title: 'Codex',
      url: '',
      duration: 15 * 60 * 1000
    }
  ]);

  assert.equal(elements.get('modal-title').innerText, 'Assign Selected Activities');
});

test('selected activity assignment modal renders positive sub-minute rows as seconds', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 9, 0).getTime();

  context.openTimeEntryModal(startMs, startMs + 10 * 1000, '', null, null, true, [
    {
      app: 'Brave Browser',
      title: 'bol.com/nl/nl/basket/',
      url: 'https://www.bol.com/nl/nl/basket/',
      duration: 10 * 1000,
      assignedDurationMs: 10 * 1000,
      assignmentSource: 'activity-stream'
    }
  ]);

  assert.equal(elements.get('modal-duration-lbl').innerText, '10s');
  assert.match(elements.get('modal-memory-aid-list').innerHTML, /<span class="duration-pill shrink-0">10s<\/span>/);
  assert.doesNotMatch(elements.get('modal-memory-aid-list').innerHTML, />0 min</);
});

test('selected similar base-url assignment renders different titles as separate rows', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 12, 0).getTime();
  const checkoutTitleKey = 'brave browser|||bol | bestellen';
  const basketTitleKey = 'brave browser|||bol.com/nl/nl/basket/';

  context.openTimeEntryModal(startMs, startMs + 10 * 60 * 1000, '', null, null, true, [
    {
      app: 'Brave Browser',
      title: 'bol | Bestellen',
      url: 'https://www.bol.com/nl/nl/checkout/',
      start: startMs,
      end: startMs + 25 * 1000,
      duration: 25 * 1000,
      assignedDurationMs: 25 * 1000,
      assignmentSource: 'activity-stream',
      modalAggregateGroupKey: checkoutTitleKey
    },
    {
      app: 'Brave Browser',
      title: 'bol.com/nl/nl/basket/',
      url: 'https://www.bol.com/nl/nl/basket/',
      start: startMs + 5 * 60 * 1000,
      end: startMs + 5 * 60 * 1000 + 50 * 1000,
      duration: 50 * 1000,
      assignedDurationMs: 50 * 1000,
      assignmentSource: 'activity-stream',
      modalAggregateGroupKey: basketTitleKey
    }
  ]);

  assert.equal(elements.get('modal-duration-lbl').innerText, '1 min');
  assert.equal((elements.get('modal-memory-aid-list').innerHTML.match(/modal-activity-row/g) || []).length, 2);
  assert.doesNotMatch(elements.get('modal-memory-aid-list').innerHTML, />0 min</);
  assert.equal(context.getSelectedModalActivities().length, 2);
  assert.equal(context.getSelectedModalActivities().reduce((total, activity) => total + activity.assignedDurationMs, 0), 75 * 1000);
});

test('selected similar app-name assignment preserves aggregate row units', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 13, 0).getTime();

  context.openTimeEntryModal(startMs, startMs + 15 * 60 * 1000, '', null, null, true, [
    {
      app: 'Obsidian',
      title: 'readme - sil-so',
      start: startMs,
      end: startMs + 3 * 60 * 1000,
      duration: 3 * 60 * 1000,
      assignedDurationMs: 3 * 60 * 1000,
      assignmentSource: 'activity-stream',
      modalAggregateGroupKey: 'obsidian|||readme - sil-so'
    },
    {
      app: 'Obsidian',
      title: 'tasks - sil-so',
      start: startMs + 5 * 60 * 1000,
      end: startMs + 8 * 60 * 1000,
      duration: 3 * 60 * 1000,
      assignedDurationMs: 3 * 60 * 1000,
      assignmentSource: 'activity-stream',
      modalAggregateGroupKey: 'obsidian|||tasks - sil-so'
    },
    {
      app: 'Obsidian',
      title: 'readme - sil-so',
      start: startMs + 10 * 60 * 1000,
      end: startMs + 12 * 60 * 1000,
      duration: 2 * 60 * 1000,
      assignedDurationMs: 2 * 60 * 1000,
      assignmentSource: 'activity-stream',
      modalAggregateGroupKey: 'obsidian|||readme - sil-so'
    }
  ]);

  const listHtml = elements.get('modal-memory-aid-list').innerHTML;
  assert.equal((listHtml.match(/data-modal-activity-index/g) || []).length, 3);
  assert.match(listHtml, /readme - sil-so/);
  assert.match(listHtml, /tasks - sil-so/);
  const selectedActivities = context.getSelectedModalActivities();
  assert.equal(selectedActivities.length, 3);
  assert.equal(selectedActivities[0].assignedDurationMs, 3 * 60 * 1000);
  assert.equal(selectedActivities[0].modalSourceActivities.length, 1);
  assert.equal(selectedActivities[1].assignedDurationMs, 3 * 60 * 1000);
  assert.equal(selectedActivities[1].modalSourceActivities.length, 1);
  assert.equal(selectedActivities[2].assignedDurationMs, 2 * 60 * 1000);
  assert.equal(selectedActivities[2].modalSourceActivities.length, 1);
  assert.equal(elements.get('modal-duration-lbl').innerText, '8 min');
});

test('selected activities collapse identical exact rows into one non-expandable row', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 13, 30).getTime();
  const first = {
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/work-plan',
    start: startMs,
    end: startMs + 60 * 1000,
    duration: 60 * 1000,
    assignedDurationMs: 60 * 1000,
    assignmentSource: 'activity-stream',
    assignmentDisplayStart: startMs,
    assignmentDisplayEnd: startMs + 60 * 1000,
    assignmentDisplayGroupKey: 'row-unit-1',
    sources: [
      {
        app: 'Brave Browser',
        title: 'Checkout step one',
        url: 'https://example.com/work-plan',
        start: startMs,
        end: startMs + 20 * 1000,
        duration: 20 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Checkout step two',
        url: 'https://example.com/work-plan',
        start: startMs + 20 * 1000,
        end: startMs + 60 * 1000,
        duration: 40 * 1000
      }
    ]
  };
  const second = {
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/work-plan',
    start: startMs + 5 * 60 * 1000,
    end: startMs + 7 * 60 * 1000,
    duration: 2 * 60 * 1000,
    assignedDurationMs: 2 * 60 * 1000,
    assignmentSource: 'activity-stream',
    assignmentDisplayStart: startMs + 5 * 60 * 1000,
    assignmentDisplayEnd: startMs + 7 * 60 * 1000,
    assignmentDisplayGroupKey: 'row-unit-2',
    sources: [
      {
        app: 'Brave Browser',
        title: 'Planning notes',
        url: 'https://example.com/work-plan',
        start: startMs + 5 * 60 * 1000,
        end: startMs + 7 * 60 * 1000,
        duration: 2 * 60 * 1000
      }
    ]
  };
  const otherUrl = {
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/other-plan',
    start: startMs + 8 * 60 * 1000,
    end: startMs + 9 * 60 * 1000,
    duration: 60 * 1000,
    assignedDurationMs: 60 * 1000,
    assignmentSource: 'activity-stream'
  };

  context.openTimeEntryModal(startMs, startMs + 9 * 60 * 1000, '', null, null, true, [first, second, otherUrl]);

  // Issue #6: identical exact rows collapse to a single, non-expandable row at the
  // summed logged duration — no per-source "N visits" drill-down. The grouping data
  // (modalSourceActivities) is still kept for the save path.
  const listHtml = elements.get('modal-memory-aid-list').innerHTML;
  assert.equal((listHtml.match(/data-modal-activity-index/g) || []).length, 2);
  assert.equal((listHtml.match(/data-modal-source-index/g) || []).length, 0);
  assert.doesNotMatch(listHtml, /\d+ visits|\d+ sessions|\d+ activities/);
  assert.doesNotMatch(listHtml, /modal-activity-group/);
  assert.doesNotMatch(listHtml, /Checkout step one|Checkout step two|20s|40s/);

  const selectedActivities = context.getSelectedModalActivities();
  assert.equal(selectedActivities.length, 2);
  assert.equal(selectedActivities[0].modalSourceActivities.length, 2);
  assert.equal(selectedActivities[0].assignedDurationMs, 3 * 60 * 1000);
  assert.equal(elements.get('modal-duration-lbl').innerText, '4 min');
});

test('selected activities collapse native and mixed groups without a drill-down', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 13, 45).getTime();
  const nativeFirst = {
    app: 'Obsidian',
    title: 'Planning.md',
    start: startMs,
    end: startMs + 60 * 1000,
    duration: 60 * 1000,
    assignedDurationMs: 60 * 1000,
    assignmentSource: 'activity-stream'
  };
  const nativeSecond = {
    app: 'Obsidian',
    title: 'Planning.md',
    start: startMs + 5 * 60 * 1000,
    end: startMs + 7 * 60 * 1000,
    duration: 2 * 60 * 1000,
    assignedDurationMs: 2 * 60 * 1000,
    assignmentSource: 'activity-stream'
  };
  const browserSource = {
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/work-plan',
    start: startMs + 8 * 60 * 1000,
    end: startMs + 9 * 60 * 1000,
    duration: 60 * 1000,
    modalAggregateGroupKey: 'mixed-review-group'
  };
  const nativeSource = {
    app: 'Obsidian',
    title: 'Planning.md',
    start: startMs + 9 * 60 * 1000,
    end: startMs + 10 * 60 * 1000,
    duration: 60 * 1000,
    modalAggregateGroupKey: 'mixed-review-group'
  };

  context.openTimeEntryModal(startMs, startMs + 10 * 60 * 1000, '', null, null, true, [
    nativeFirst,
    nativeSecond,
    browserSource,
    nativeSource
  ]);

  // Issue #6: native and mixed groups collapse to one flat row each — no
  // "N sessions" / "N activities" drill-down label or expandable group.
  const listHtml = elements.get('modal-memory-aid-list').innerHTML;
  assert.equal((listHtml.match(/data-modal-activity-index/g) || []).length, 2);
  assert.equal((listHtml.match(/data-modal-source-index/g) || []).length, 0);
  assert.doesNotMatch(listHtml, /\d+ sessions|\d+ activities|\d+ visits/);
  assert.doesNotMatch(listHtml, /modal-activity-group/);
});

test('selected activities modal marks logged rows and defaults to unlogged save state', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 13, 55).getTime();

  context.openTimeEntryModal(startMs, startMs + 10 * 60 * 1000, '', null, null, true, [
    {
      app: 'Brave Browser',
      title: 'Already logged page',
      url: 'https://example.com/logged',
      start: startMs,
      end: startMs + 5 * 60 * 1000,
      duration: 5 * 60 * 1000,
      assignedDurationMs: 5 * 60 * 1000,
      assignmentSource: 'activity-stream',
      alreadyLogged: true
    },
    {
      app: 'Brave Browser',
      title: 'Unlogged page',
      url: 'https://example.com/unlogged',
      start: startMs + 5 * 60 * 1000,
      end: startMs + 10 * 60 * 1000,
      duration: 5 * 60 * 1000,
      assignedDurationMs: 5 * 60 * 1000,
      assignmentSource: 'activity-stream',
      alreadyLogged: false
    }
  ]);

  const listHtml = elements.get('modal-memory-aid-list').innerHTML;
  assert.match(listHtml, /Already logged/);
  assert.match(listHtml, /1 unlogged · 1 already logged/);
  assert.match(listHtml, /data-modal-include-logged/);
  assert.equal(elements.get('modal-btn-save').disabled, false);
  assert.equal(context.state.modalIncludeAlreadyLoggedActivities, false);

  context.setModalIncludeAlreadyLoggedActivities(true);
  assert.equal(context.state.modalIncludeAlreadyLoggedActivities, true);
});

test('selected activities modal disables default assign when all rows are logged', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 14, 5).getTime();

  context.openTimeEntryModal(startMs, startMs + 5 * 60 * 1000, '', null, null, true, [
    {
      app: 'Brave Browser',
      title: 'Already logged page',
      url: 'https://example.com/logged',
      start: startMs,
      end: startMs + 5 * 60 * 1000,
      duration: 5 * 60 * 1000,
      assignedDurationMs: 5 * 60 * 1000,
      assignmentSource: 'activity-stream',
      alreadyLogged: true
    }
  ]);

  assert.match(elements.get('modal-memory-aid-list').innerHTML, /1 already logged/);
  assert.equal(elements.get('modal-btn-save').disabled, true);

  context.setModalIncludeAlreadyLoggedActivities(true);
  assert.equal(elements.get('modal-btn-save').disabled, false);
});

test('saving grouped selected activities preserves separate canonical row unit payloads', () => {
  const context = loadTimeEntrySaveContext();
  const startMs = new Date(2026, 4, 21, 14, 0).getTime();
  const firstSource = {
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/work-plan',
    start: startMs,
    end: startMs + 30 * 1000,
    duration: 30 * 1000,
    assignedDurationMs: 30 * 1000,
    assignmentStart: startMs,
    assignmentEnd: startMs + 30 * 1000,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayStart: startMs,
    assignmentDisplayEnd: startMs + 60 * 1000,
    assignmentDisplayGroupKey: 'row-unit-1'
  };
  const first = {
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/work-plan',
    start: startMs,
    end: startMs + 60 * 1000,
    duration: 60 * 1000,
    assignedDurationMs: 60 * 1000,
    assignmentStart: startMs,
    assignmentEnd: startMs + 60 * 1000,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayStart: startMs,
    assignmentDisplayEnd: startMs + 60 * 1000,
    assignmentDisplayGroupKey: 'row-unit-1',
    sources: [
      firstSource,
      {
        ...firstSource,
        start: startMs + 30 * 1000,
        end: startMs + 60 * 1000,
        assignmentStart: startMs + 30 * 1000,
        assignmentEnd: startMs + 60 * 1000
      }
    ]
  };
  const second = {
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/work-plan',
    start: startMs + 5 * 60 * 1000,
    end: startMs + 7 * 60 * 1000,
    duration: 2 * 60 * 1000,
    assignedDurationMs: 2 * 60 * 1000,
    assignmentStart: startMs + 5 * 60 * 1000,
    assignmentEnd: startMs + 7 * 60 * 1000,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    assignmentDisplayStart: startMs + 5 * 60 * 1000,
    assignmentDisplayEnd: startMs + 7 * 60 * 1000,
    assignmentDisplayGroupKey: 'row-unit-2',
    sources: [
      {
        app: 'Brave Browser',
        title: 'Planning notes',
        url: 'https://example.com/work-plan',
        start: startMs + 5 * 60 * 1000,
        end: startMs + 7 * 60 * 1000,
        duration: 2 * 60 * 1000,
        assignedDurationMs: 2 * 60 * 1000,
        assignmentStart: startMs + 5 * 60 * 1000,
        assignmentEnd: startMs + 7 * 60 * 1000,
        assignmentSource: 'activity-stream',
        assignmentModel: 'activity-stream-summary',
        assignmentDisplayStart: startMs + 5 * 60 * 1000,
        assignmentDisplayEnd: startMs + 7 * 60 * 1000,
        assignmentDisplayGroupKey: 'row-unit-2'
      }
    ]
  };

  const payloads = context.buildBulkTimeEntryPayloads({
    start: startMs,
    end: startMs + 7 * 60 * 1000,
    description: '',
    projectId: 'project-1',
    taskId: 'task-1',
    billable: true,
    activities: [
      {
        ...first,
        duration: 3 * 60 * 1000,
        assignedDurationMs: 3 * 60 * 1000,
        modalGroupedReviewRow: true,
        modalSourceActivities: [first, second]
      }
    ]
  });

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].activities[0].assignmentDisplayGroupKey, 'row-unit-1');
  assert.equal(payloads[0].activities[0].sources.length, 2);
  assert.equal(payloads[0].activities[0].sources[0].assignmentDisplayGroupKey, 'row-unit-1');
  assert.equal(payloads[1].activities[0].assignmentDisplayGroupKey, 'row-unit-2');
  assert.equal(payloads[1].activities[0].sources.length, 1);
  assert.equal(payloads[0].activities[0].modalGroupedReviewRow, undefined);
  assert.equal(payloads[0].activities[0].modalSourceActivities, undefined);
});

test('saving selected activities defaults to unlogged canonical payloads', () => {
  const context = loadTimeEntrySaveContext();
  const startMs = new Date(2026, 4, 21, 14, 30).getTime();
  const logged = {
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/logged',
    start: startMs,
    end: startMs + 5 * 60 * 1000,
    duration: 5 * 60 * 1000,
    assignedDurationMs: 5 * 60 * 1000,
    assignmentStart: startMs,
    assignmentEnd: startMs + 5 * 60 * 1000,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    alreadyLogged: true
  };
  const unlogged = {
    app: 'Brave Browser',
    title: 'Planning notes',
    url: 'https://example.com/unlogged',
    start: startMs + 10 * 60 * 1000,
    end: startMs + 14 * 60 * 1000,
    duration: 4 * 60 * 1000,
    assignedDurationMs: 4 * 60 * 1000,
    assignmentStart: startMs + 10 * 60 * 1000,
    assignmentEnd: startMs + 14 * 60 * 1000,
    assignmentSource: 'activity-stream',
    assignmentModel: 'activity-stream-summary',
    alreadyLogged: false
  };

  const defaultPayloads = context.buildBulkTimeEntryPayloads({
    start: startMs,
    end: startMs + 14 * 60 * 1000,
    description: '',
    projectId: 'project-1',
    taskId: '',
    billable: true,
    activities: [logged, unlogged]
  });

  assert.equal(defaultPayloads.length, 1);
  assert.equal(defaultPayloads[0].activities[0].url, 'https://example.com/unlogged');

  context.state.modalIncludeAlreadyLoggedActivities = true;
  const explicitPayloads = context.buildBulkTimeEntryPayloads({
    start: startMs,
    end: startMs + 14 * 60 * 1000,
    description: '',
    projectId: 'project-1',
    taskId: '',
    billable: true,
    activities: [logged, unlogged]
  });

  assert.equal(explicitPayloads.length, 2);
});

test('similar-scoped multiple activity popup assigns only matching popup-visible rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const startMs = dateStart + (13 * 60 + 20) * 60 * 1000;
  const sourceKey = activity => [
    activity.app || '',
    activity.title || '',
    activity.url || '',
    activity.appPath || '',
    activity.bundleId || '',
    activity.start,
    activity.end
  ].join('|||');
  const codexSource = {
    app: 'Codex',
    title: 'Codex',
    url: '',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex',
    start: startMs,
    end: startMs + 5 * 60 * 1000,
    duration: 5 * 60 * 1000
  };
  const obsidianSource = {
    app: 'Obsidian',
    title: 'readme - sil-so',
    url: '',
    appPath: '/Applications/Obsidian.app',
    bundleId: 'md.obsidian',
    start: startMs + 5 * 60 * 1000,
    end: startMs + 8 * 60 * 1000,
    duration: 3 * 60 * 1000
  };
  const popup = renderMultipleActivitiesPopup({
    selected: true,
    startCell: 80,
    span: 2,
    zoom: 10,
    app: 'Codex',
    title: 'Multiple Activities',
    overlaps: [codexSource, obsidianSource],
    datasetOverrides: {
      selectedSimilarityKeys: encodeURIComponent(JSON.stringify([sourceKey(obsidianSource)])),
      selectedSimilarityMode: 'app',
      selectedSimilarityMatchKeys: encodeURIComponent(JSON.stringify(['obsidian']))
    }
  });

  assert.equal(popup.popupRows.some(row => row.classList.contains('is-selected')), true);
  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[6].length, 1);
  assert.equal(popup.modalArgs[6][0].app, 'Obsidian');
  assert.equal(popup.modalArgs[6][0].assignedDurationMs, 3 * 60 * 1000);
  assert.equal(popup.blockEl.dataset.selectedSimilarityKeys, encodeURIComponent(JSON.stringify([sourceKey(obsidianSource)])));
});

test('similar-scoped popup assign filters a selected parent row to matching child sources', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const startMs = dateStart + (14 * 60) * 60 * 1000;
  const sourceKey = activity => [
    activity.app || '',
    activity.title || '',
    activity.url || '',
    activity.appPath || '',
    activity.bundleId || '',
    activity.start,
    activity.end
  ].join('|||');
  const chatSource = {
    app: 'Brave Browser',
    title: 'Meal planning notes',
    url: 'https://chatgpt.com/c/meal-planning',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start: startMs,
    end: startMs + 2 * 60 * 1000,
    duration: 2 * 60 * 1000
  };
  const selectedChatSource = {
    app: 'Brave Browser',
    title: 'User Activity Analysis',
    url: 'https://chatgpt.com/c/activity-analysis',
    appPath: '/Applications/Brave Browser.app',
    bundleId: 'com.brave.Browser',
    start: startMs + 2 * 60 * 1000,
    end: startMs + 5 * 60 * 1000,
    duration: 3 * 60 * 1000
  };
  const codexSource = {
    app: 'Codex',
    title: 'Codex',
    url: '',
    appPath: '/Applications/Codex.app',
    bundleId: 'com.openai.codex',
    start: startMs + 5 * 60 * 1000,
    end: startMs + 7 * 60 * 1000,
    duration: 2 * 60 * 1000
  };
  const popup = renderMultipleActivitiesPopup({
    selected: true,
    startCell: 84,
    span: 1,
    zoom: 10,
    app: 'Brave Browser',
    title: 'Multiple Activities',
    overlaps: [chatSource, selectedChatSource, codexSource],
    datasetOverrides: {
      activeDurationMs: String(7 * 60 * 1000),
      selectedSimilarityKeys: encodeURIComponent(JSON.stringify([sourceKey(selectedChatSource)])),
      selectedSimilarityMode: 'app-title',
      selectedSimilarityMatchKeys: encodeURIComponent(JSON.stringify(['brave browser|||user activity analysis']))
    }
  });

  assert.equal(popup.popupRows.filter(row => row.classList.contains('is-selected')).length, 1);
  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[6].length, 1);
  const modalSources = popup.modalArgs[6].flatMap(activity => activity.modalSourceActivities || activity.sources || [activity]);
  assert.deepEqual(Array.from(modalSources, activity => activity.title), ['User Activity Analysis']);
  assert.equal(popup.modalArgs[6][0].assignedDurationMs, 3 * 60 * 1000);
});

test('popup aggregate assignment uses active source duration instead of page envelope', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const firstStart = dateStart + (13 * 60 + 30) * 60 * 1000;
  const secondEnd = firstStart + 20 * 60 * 1000;
  const activeDurationMs = 68 * 1000;
  const envelopeDurationMs = secondEnd - firstStart;

  const assignmentActivities = context.buildPopupAssignmentActivities([
    {
      popupContextSummary: true,
      app: 'Brave Browser',
      title: 'action.com',
      url: 'https://www.action.com/nl-nl/',
      start: firstStart,
      end: secondEnd,
      duration: activeDurationMs,
      sources: [
        {
          app: 'Brave Browser',
          title: 'action.com',
          url: 'https://www.action.com/nl-nl/',
          start: firstStart,
          end: secondEnd,
          duration: activeDurationMs,
          activityMix: { handsOnMs: activeDurationMs, handsOffMs: 0 }
        }
      ]
    }
  ], firstStart, secondEnd, {
    assignmentDisplayStart: firstStart,
    assignmentDisplayEnd: secondEnd
  });

  assert.equal(assignmentActivities.length, 1);
  assert.equal(assignmentActivities[0].duration, activeDurationMs);
  assert.equal(assignmentActivities[0].assignedDurationMs, activeDurationMs);
  assert.notEqual(assignmentActivities[0].duration, envelopeDurationMs);
  assert.equal(assignmentActivities[0].modalSourceActivities[0].duration, activeDurationMs);
  assert.equal(assignmentActivities[0].modalSourceActivities[0].assignedDurationMs, activeDurationMs);
});

test('multiple activity popover aligns app names separately without dash separators', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  let renderedMultiList = '';

  context.DOM.elPopupDuration = { innerText: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
    },
    get innerHTML() {
      return renderedMultiList;
    }
  };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { remove() {} }
  };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: '118',
      span: '2',
      app: 'Brave Browser',
      title: 'Reference Browser Tab',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          app: 'Brave Browser',
          title: 'Reference Browser Tab',
          url: 'http://localhost:3000',
          duration: 4 * 60 * 1000,
          start: blockStart,
          end: blockStart + 4 * 60 * 1000
        },
        {
          app: 'Code Editor',
          title: 'Code Editor',
          url: '',
          duration: 60 * 1000,
          start: blockStart + 4 * 60 * 1000,
          end: blockStart + 5 * 60 * 1000
        }
      ]))
    }
  });

  assert.equal(renderedMultiList.includes('—'), false);
  assert.match(renderedMultiList, /<div class="popup-activity-row__label">\s*<span class="popup-activity-title" title="Reference Browser Tab">Reference Browser Tab<\/span>/);
  assert.match(renderedMultiList, /<span class="popup-activity-secondary" title="Brave Browser">Brave Browser<\/span>/);
  assert.equal((renderedMultiList.match(/popup-activity-external-link/g) || []).length, 1);
});

test('multiple activity popover hides Activity Mix footer', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  let renderedMultiList = '';

  function createClassList(initialClasses = []) {
    const classes = new Set(initialClasses);
    return {
      add: className => classes.add(className),
      remove: className => classes.delete(className),
      contains: className => classes.has(className)
    };
  }

  const mixContainerClassList = createClassList(['hidden']);
  const mixContainerAttributes = {};
  const mixInfoAttributes = {};
  context.DOM.elPopupDuration = { innerText: '', title: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} }, querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrlContainer = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
    },
    get innerHTML() {
      return renderedMultiList;
    }
  };
  context.DOM.elPopupActivityMixContainer = {
    classList: mixContainerClassList,
    title: '',
    querySelectorAll() {
      return [];
    },
    setAttribute(name, value) {
      mixContainerAttributes[name] = value;
    },
    removeAttribute(name) {
      delete mixContainerAttributes[name];
    }
  };
  context.DOM.elPopupActivityMixLabel = { innerText: '' };
  context.DOM.elPopupActivityMixInfo = {
    setAttribute(name, value) {
      mixInfoAttributes[name] = value;
    },
    removeAttribute(name) {
      delete mixInfoAttributes[name];
    }
  };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { remove() {} }
  };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: '138',
      span: '6',
      app: 'Oriel',
      title: 'Oriel',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          start: dateStart + 11 * 60 * 60 * 1000 + 30 * 60 * 1000,
          end: dateStart + 11 * 60 * 60 * 1000 + 52 * 60 * 1000,
          app: 'Oriel',
          title: 'Oriel',
          url: '',
          interactionState: 'handsOn',
          activityMix: {
            handsOnMs: 7 * 60 * 1000,
            handsOffMs: 15 * 60 * 1000
          },
          sourceSegments: [
            {
              start: dateStart + 11 * 60 * 60 * 1000 + 30 * 60 * 1000,
              end: dateStart + 11 * 60 * 60 * 1000 + 37 * 60 * 1000,
              interactionState: 'handsOn'
            },
            {
              start: dateStart + 11 * 60 * 60 * 1000 + 37 * 60 * 1000,
              end: dateStart + 11 * 60 * 60 * 1000 + 52 * 60 * 1000,
              interactionState: 'handsOff'
            }
          ]
        },
        {
          start: dateStart + 11 * 60 * 60 * 1000 + 52 * 60 * 1000,
          end: dateStart + 11 * 60 * 60 * 1000 + 54 * 60 * 1000,
          app: 'SoundCloud',
          title: 'SoundCloud',
          url: '',
          interactionState: 'handsOn'
        }
      ]))
    }
  });

  assert.equal(context.DOM.elPopupRange.innerText, '11:30 – 12:00');
  assert.equal(context.DOM.elPopupDuration.title, '');
  assert.doesNotMatch(renderedMultiList, /activity-mix|Activity Mix|Hands-on|Hands-off|--activity-mix/);
  assert.equal(mixContainerClassList.contains('hidden'), true);
  assert.equal(context.DOM.elPopupActivityMixLabel.innerText, '');
  assert.equal(mixContainerAttributes['aria-label'], undefined);
  assert.equal(mixInfoAttributes['data-activity-mix-tooltip'], undefined);
  assert.equal(mixInfoAttributes['data-activity-mix-tooltip-variant'], undefined);
});

test('activity details popup hides Activity Mix footer for one-state activity', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);

  function createClassList(initialClasses = []) {
    const classes = new Set(initialClasses);
    return {
      add: className => classes.add(className),
      remove: className => classes.delete(className),
      contains: className => classes.has(className)
    };
  }

  const mixContainerClassList = createClassList([]);
  const mixContainerAttributes = {};
  context.DOM.elPopupDuration = { innerText: '', title: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupTitle = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} }, querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrlContainer = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = { innerHTML: '' };
  context.DOM.elPopupActivityMixContainer = {
    classList: mixContainerClassList,
    title: 'stale',
    setAttribute(name, value) {
      mixContainerAttributes[name] = value;
    },
    removeAttribute(name) {
      delete mixContainerAttributes[name];
    }
  };
  context.DOM.elPopupActivityMixLabel = { innerText: 'stale' };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { add() {}, remove() {} }
  };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: '120',
      span: '2',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          start: dateStart + 10 * 60 * 60 * 1000,
          end: dateStart + 10 * 60 * 60 * 1000 + 10 * 60 * 1000,
          app: 'Codex',
          title: 'Codex',
          url: '',
          interactionState: 'handsOn'
        }
      ]))
    }
  });

  assert.equal(mixContainerClassList.contains('hidden'), true);
  assert.equal(context.DOM.elPopupActivityMixContainer.title, '');
  assert.equal(context.DOM.elPopupActivityMixLabel.innerText, '');
  assert.equal(mixContainerAttributes['aria-label'], undefined);
});

test('multiple activity popover selection stays local and assigns selected rows', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 118 * 5 * 60 * 1000;
  let renderedMultiList = '';
  let modalArgs = null;
  const popupRows = [];

  function createClassList(initialClasses = []) {
    const classes = new Set(initialClasses);
    return {
      add: className => classes.add(className),
      remove: className => classes.delete(className),
      contains: className => classes.has(className)
    };
  }

  function createButton(initialClasses = []) {
    const listeners = {};
    const icon = { className: '' };
    return {
      classList: createClassList(initialClasses),
      addEventListener(type, listener) {
        listeners[type] = listener;
      },
      querySelector(selector) {
        return selector === 'i' ? icon : null;
      },
      click() {
        listeners.click?.({ stopPropagation() {} });
      }
    };
  }

  const blockCheckbox = createButton(['activity-checkbox']);
  const blockClasses = createClassList(['activity-block']);
  const block = {
    dataset: {
      startCell: '118',
      span: '2',
      app: 'Brave Browser',
      title: 'YNAB',
      url: 'https://app.ynab.com',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          app: 'Brave Browser',
          title: 'YNAB',
          url: 'https://app.ynab.com',
          duration: 4 * 60 * 1000,
          start: blockStart,
          end: blockStart + 4 * 60 * 1000
        },
        {
          app: 'Codex',
          title: 'Codex',
          bundleId: 'com.openai.codex',
          duration: 60 * 1000,
          start: blockStart + 4 * 60 * 1000,
          end: blockStart + 5 * 60 * 1000
        }
      ]))
    },
    classList: blockClasses,
    querySelector(selector) {
      if (selector === '.activity-checkbox') return blockCheckbox;
      if (selector === '.activity-checkbox i') return blockCheckbox.querySelector('i');
      return null;
    }
  };

  context.DOM.elPopupDuration = { innerText: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} }, querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrlContainer = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
      popupRows.length = 0;
      for (const match of value.matchAll(/data-popup-overlap-index="(\d+)"(?:[^>]*data-popup-child-index="(\d+)")?/g)) {
        const nextRowIndex = value.indexOf('data-popup-overlap-index="', match.index + 1);
        const rowHtml = value.slice(match.index, nextRowIndex === -1 ? value.length : nextRowIndex);
        const selectButton = rowHtml.includes('popup-activity-select')
          ? createButton(['popup-activity-select', 'activity-checkbox'])
          : null;
        const quickAddButton = rowHtml.includes('popup-activity-quick-add')
          ? createButton(['popup-activity-quick-add', 'activity-quick-add'])
          : null;
        popupRows.push({
          dataset: {
            popupOverlapIndex: match[1],
            ...(match[2] === undefined ? {} : { popupChildIndex: match[2] })
          },
          classList: createClassList(['popup-activity-row']),
          querySelector(selector) {
            if (selector === '.popup-activity-select') return selectButton;
            if (selector === '.popup-activity-quick-add') return quickAddButton;
            return null;
          }
        });
      }
    },
    get innerHTML() {
      return renderedMultiList;
    },
    querySelectorAll(selector) {
      return selector === '[data-popup-overlap-index]' ? popupRows : [];
    }
  };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { add() {}, remove() {} }
  };
  context.DOM.elMultiSelectBar = {
    classList: createClassList(['hidden'])
  };
  context.DOM.elSelectedCount = { innerText: '' };
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;

  context.showActivityDetailsPopup(block);

  assert.match(renderedMultiList, /popup-activity-select/);
  assert.doesNotMatch(renderedMultiList, /popup-activity-quick-add/);
  const topLevelPopupRows = popupRows.filter(row => row.dataset.popupChildIndex === undefined);
  assert.equal(topLevelPopupRows.length, 2);
  assert.ok(topLevelPopupRows.every(row => !row.querySelector('.popup-activity-quick-add')));

  topLevelPopupRows[1].querySelector('.popup-activity-select').click();

  assert.equal(context.state.selectedActivities.size, 0);
  assert.equal(block.classList.contains('selected'), false);
  assert.equal(context.DOM.elMultiSelectBar.classList.contains('hidden'), true);
  assert.equal(context.DOM.elSelectedCount.innerText, '');

  context.DOM.elPopupAssignBtn.onclick();

  assert.equal(modalArgs[5], false);
  assert.equal(modalArgs[6].length, 1);
  assert.equal(modalArgs[6][0].app, 'Codex');
});

test('activity details assignment uses selected block bounds and summary durations', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  let modalArgs = null;

  context.state.zoom = 10;
  context.DOM.elPopupDuration = { innerText: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupMultiListContainer = { innerHTML: '' };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { add() {}, remove() {} }
  };
  context.openTimeEntryModal = (...args) => {
    modalArgs = args;
  };
  context.window.openTimeEntryModal = context.openTimeEntryModal;

  context.showActivityDetailsPopup({
    dataset: {
      startCell: String(7 * 6 + 3),
      span: '3',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          app: 'Brave Browser',
          title: 'Oriel Local Time Tracker',
          url: 'http://localhost:3000',
          duration: 2 * 60 * 1000,
          start: dateStart + (7 * 60 + 30) * 60 * 1000,
          end: dateStart + (7 * 60 + 32) * 60 * 1000
        },
        {
          app: 'Codex',
          title: 'Codex',
          url: '',
          duration: 18 * 60 * 1000,
          start: dateStart + (7 * 60 + 36) * 60 * 1000,
          end: dateStart + (7 * 60 + 54) * 60 * 1000
        }
      ]))
    }
  });
  context.DOM.elPopupAssignBtn.onclick();

  assert.equal(modalArgs[0], dateStart + (7 * 60 + 30) * 60 * 1000);
  assert.equal(modalArgs[1], dateStart + 8 * 60 * 60 * 1000);
  assert.equal(modalArgs[5], false);
  assert.equal(modalArgs[6].length, 2);
  assert.equal(modalArgs[6].find(activity => activity.app === 'Codex').assignedDurationMs, 18 * 60 * 1000);
  assert.equal(modalArgs[6][0].assignmentModel, 'activity-stream-summary');
  assert.equal(modalArgs[6][1].assignmentModel, 'activity-stream-summary');
});

test('recorded activity breakdown merges visually similar activities into one row', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  let renderedMultiList = '';

  context.DOM.elPopupDuration = { innerText: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} }, querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrlContainer = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
    },
    get innerHTML() {
      return renderedMultiList;
    }
  };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { remove() {} }
  };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: '0',
      span: '1',
      app: 'Codex',
      title: 'Codex',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          app: 'Codex',
          title: 'Codex',
          bundleId: 'com.openai.codex',
          duration: 2 * 60 * 1000,
          start: dateStart,
          end: dateStart + 2 * 60 * 1000
        },
        {
          app: 'Codex',
          title: 'Codex',
          appPath: '/Applications/Codex.app',
          duration: 60 * 1000,
          start: dateStart + 2 * 60 * 1000,
          end: dateStart + 3 * 60 * 1000
        },
        {
          app: 'Oriel',
          title: 'Oriel',
          bundleId: 'so.sil.oriel',
          duration: 60 * 1000,
          start: dateStart + 3 * 60 * 1000,
          end: dateStart + 4 * 60 * 1000
        }
      ]))
    }
  });

  assert.equal((renderedMultiList.match(/data-popup-overlap-index="\d+"\s*\n\s*data-popup-similarity-key/g) || []).length, 2);
  assert.match(renderedMultiList, /3 min/);
  assert.match(renderedMultiList, /Oriel/);
});

test('recorded activity popup renders different same-host page titles as canonical rows', () => {
  const context = loadTimelineContext();
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 14 * 60 * 60 * 1000;
  let renderedMultiList = '';

  context.DOM.elPopupDuration = { innerText: '', title: '' };
  context.DOM.elPopupRange = { innerText: '' };
  context.DOM.elPopupIconContainer = { innerHTML: '' };
  context.DOM.elPopupAppName = { innerText: '' };
  context.DOM.elPopupSingleDetails = { classList: { add() {}, remove() {} }, querySelector: () => null };
  context.DOM.elPopupMultiDetails = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrlContainer = { classList: { add() {}, remove() {} } };
  context.DOM.elPopupUrl = {};
  context.DOM.elPopupMultiListContainer = {
    set innerHTML(value) {
      renderedMultiList = value;
    },
    get innerHTML() {
      return renderedMultiList;
    },
    querySelectorAll() {
      return [];
    }
  };
  context.DOM.elPopupAssignBtn = {};
  context.DOM.elActivityDetailsPopup = {
    style: {},
    classList: { remove() {} }
  };

  context.showActivityDetailsPopup({
    dataset: {
      startCell: '168',
      span: '1',
      app: 'Brave Browser',
      title: 'Multiple Activities',
      url: '',
      appPath: '',
      bundleId: '',
      overlaps: encodeURIComponent(JSON.stringify([
        {
          app: 'Brave Browser',
          title: "coulou's vinyl cafe (no. 4) - rainy day selections",
          url: 'https://www.youtube.com/watch?v=rainy',
          duration: 60 * 1000,
          start: blockStart,
          end: blockStart + 60 * 1000
        },
        {
          app: 'Brave Browser',
          title: 'Apple Mac mini 1 model A2348 | Vinted',
          url: 'https://www.vinted.nl/items/apple-mac-mini',
          duration: 60 * 1000,
          start: blockStart + 60 * 1000,
          end: blockStart + 2 * 60 * 1000
        },
        {
          app: 'Brave Browser',
          title: 'Word lid en verkoop tweedehands kleding zonder kosten | Vinted',
          url: 'https://www.vinted.nl/member/signup/select_type',
          duration: 2 * 60 * 1000,
          start: blockStart + 2 * 60 * 1000,
          end: blockStart + 4 * 60 * 1000
        },
        {
          app: 'Brave Browser',
          title: 'Transient Vinted Tab | Vinted',
          url: 'https://www.vinted.nl/help/transient',
          duration: 45 * 1000,
          start: blockStart + 4 * 60 * 1000,
          end: blockStart + 4 * 60 * 1000 + 45 * 1000
        }
      ]))
    }
  });

  assert.equal(context.DOM.elPopupAppName.innerText, 'Activities');
  assert.doesNotMatch(renderedMultiList, /class="popup-activity-title"[^>]*>vinted\.nl<\/span>/);
  assert.doesNotMatch(renderedMultiList, /popup-activity-expand|popup-activity-child-row|data-popup-child-index/);
  assert.match(renderedMultiList, /coulou&#39;s vinyl cafe \(no\. 4\) - rainy day selections/);
  assert.match(renderedMultiList, /Apple Mac mini 1 model A2348 \| Vinted/);
  assert.match(renderedMultiList, /Word lid en verkoop tweedehands kleding zonder kosten \| Vinted/);
  assert.doesNotMatch(renderedMultiList, /Transient Vinted Tab/);
  assert.equal((renderedMultiList.match(/data-popup-overlap-index/g) || []).length, 3);
});

test('recorded activity popup hides sub-minute context rows', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 14 * 60 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    startCell: '168',
    span: '1',
    app: 'Brave Browser',
    title: "coulou's vinyl cafe (no. 4) - rainy day selections",
    url: 'https://www.youtube.com/watch?v=rainy',
    overlaps: [
      {
        app: 'Brave Browser',
        title: "coulou's vinyl cafe (no. 4) - rainy day selections",
        url: 'https://www.youtube.com/watch?v=rainy',
        duration: 61 * 1000,
        start: blockStart,
        end: blockStart + 61 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Word lid en verkoop tweedehands kleding zonder kosten | Vinted',
        url: 'https://www.vinted.nl/member/signup/select_type',
        duration: 12 * 1000,
        start: blockStart + 61 * 1000,
        end: blockStart + 73 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Vinted | Een app, alles tweedehands',
        url: 'https://www.vinted.nl/',
        duration: 40 * 1000,
        start: blockStart + 73 * 1000,
        end: blockStart + 113 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Artikelen | Vinted',
        url: 'https://www.vinted.nl/catalog',
        duration: 16 * 1000,
        start: blockStart + 113 * 1000,
        end: blockStart + 129 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Apple Mac mini 1 model A2348 | Vinted',
        url: 'https://www.vinted.nl/items/apple-mac-mini',
        duration: 52 * 1000,
        start: blockStart + 129 * 1000,
        end: blockStart + 181 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'vinted.nl',
        url: 'https://www.vinted.nl/member/signup/select_type?state=first',
        duration: 1000,
        start: blockStart + 181 * 1000,
        end: blockStart + 182 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'vinted.nl',
        url: 'https://www.vinted.nl/member/signup/select_type?state=second',
        duration: 2 * 1000,
        start: blockStart + 182 * 1000,
        end: blockStart + 184 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, "coulou's vinyl cafe (no. 4) - rainy day selections");
  assert.equal(popup.context.DOM.elPopupDuration.innerText, '1 min');
  assert.equal(popup.renderedMultiList, '');
  assert.doesNotMatch(popup.renderedSingleChildren, /vinted\.nl|Word lid en verkoop tweedehands kleding|Apple Mac mini 1 model A2348/);
  assert.doesNotMatch(popup.renderedMultiList, /Sub-minute fragments hidden/);
  assert.doesNotMatch(popup.renderedMultiList, /Other activity/);
  assert.doesNotMatch(popup.renderedMultiList, />3s<\/span>|data-popup-child-index|popup-activity-child-row/);

  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[6].length, 1);
  assert.equal(popup.modalArgs[6][0].title, "coulou's vinyl cafe (no. 4) - rainy day selections");
  assert.equal(popup.modalArgs[6][0].sources.length, 1);
});

test('one-minute visible browser block keeps the visible page as the single popup title', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + (14 * 60 + 2) * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    zoom: 1,
    startCell: 14 * 60 + 2,
    span: 2,
    app: 'Brave Browser',
    title: 'Word lid en verkoop tweedehands kleding zonder kosten | Vinted',
    url: 'https://www.vinted.nl/member/signup/select_type',
    datasetOverrides: {
      startMs: String(blockStart),
      endMs: String(blockStart + 2 * 60 * 1000),
      activeDurationMs: String(2 * 60 * 1000)
    },
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'Word lid en verkoop tweedehands kleding zonder kosten | Vinted',
        url: 'https://www.vinted.nl/member/signup/select_type',
        duration: 12 * 1000,
        start: blockStart,
        end: blockStart + 12 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Vinted | Een app, alles tweedehands',
        url: 'https://www.vinted.nl/',
        duration: 40 * 1000,
        start: blockStart + 12 * 1000,
        end: blockStart + 52 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Artikelen | Vinted',
        url: 'https://www.vinted.nl/catalog',
        duration: 16 * 1000,
        start: blockStart + 52 * 1000,
        end: blockStart + 68 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Apple Mac mini 1 model A2348 | Vinted',
        url: 'https://www.vinted.nl/items/apple-mac-mini',
        duration: 52 * 1000,
        start: blockStart + 68 * 1000,
        end: blockStart + 120 * 1000
      }
    ]
  });

  assert.equal(popup.context.DOM.elPopupAppName.innerText, 'Word lid en verkoop tweedehands kleding zonder kosten | Vinted');
  assert.equal(popup.context.DOM.elPopupDuration.innerText, '2 min');
  assert.equal(popup.context.DOM.elPopupUrl.innerText, 'https://www.vinted.nl/member/signup/select_type');
  assert.equal(popup.renderedMultiList, '');
  assert.equal(popup.renderedSingleChildren, '');

  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[6].length, 1);
  assert.equal(popup.modalArgs[6][0].title, 'Word lid en verkoop tweedehands kleding zonder kosten | Vinted');
  assert.equal(popup.modalArgs[6][0].duration, 2 * 60 * 1000);
  assert.equal(popup.modalArgs[6][0].sources.length, 1);
});

test('coarse block secondary badge and popup omit contextual short Vinted work', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 14 * 60 * 60 * 1000;
  const overlaps = [
    {
      app: 'Brave Browser',
      title: "coulou's vinyl cafe (no. 4) - rainy day selections",
      url: 'https://www.youtube.com/watch?v=rainy',
      duration: 61 * 1000,
      start: blockStart,
      end: blockStart + 61 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Word lid en verkoop tweedehands kleding zonder kosten | Vinted',
      url: 'https://www.vinted.nl/member/signup/select_type',
      duration: 12 * 1000,
      start: blockStart + 61 * 1000,
      end: blockStart + 73 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Vinted | Een app, alles tweedehands',
      url: 'https://www.vinted.nl/',
      duration: 40 * 1000,
      start: blockStart + 73 * 1000,
      end: blockStart + 113 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Artikelen | Vinted',
      url: 'https://www.vinted.nl/catalog',
      duration: 16 * 1000,
      start: blockStart + 113 * 1000,
      end: blockStart + 129 * 1000
    },
    {
      app: 'Brave Browser',
      title: 'Apple Mac mini 1 model A2348 | Vinted',
      url: 'https://www.vinted.nl/items/apple-mac-mini',
      duration: 52 * 1000,
      start: blockStart + 129 * 1000,
      end: blockStart + 181 * 1000
    },
    {
      app: 'Fastmail',
      title: 'Inbox',
      url: '',
      duration: 20 * 1000,
      start: blockStart + 181 * 1000,
      end: blockStart + 201 * 1000
    }
  ];
  const iconHtml = renderActivityBlockChromeHtml({
    startCell: 14 * 12,
    span: 1,
    app: 'Brave Browser',
    title: "coulou's vinyl cafe (no. 4) - rainy day selections",
    url: 'https://www.youtube.com/watch?v=rainy',
    overlaps,
    iconFactory: (iconApp, iconUrl, iconTitle) => (
      `<span class="fake-icon" data-icon="${iconApp}" data-url="${iconUrl}" data-title="${iconTitle}"></span>`
    )
  });
  const popup = renderMultipleActivitiesPopup({
    startCell: 14 * 12,
    span: 1,
    app: 'Brave Browser',
    title: "coulou's vinyl cafe (no. 4) - rainy day selections",
    url: 'https://www.youtube.com/watch?v=rainy',
    overlaps
  });

  assert.doesNotMatch(iconHtml, /<span class="fake-icon" data-icon="Brave Browser" data-url="https:\/\/vinted\.nl"/);
  assert.equal(popup.context.DOM.elPopupAppName.innerText, "coulou's vinyl cafe (no. 4) - rainy day selections");
  assert.equal(popup.context.DOM.elPopupDuration.innerText, '1 min');
  assert.equal(popup.renderedMultiList, '');
  assert.doesNotMatch(popup.renderedSingleChildren, /vinted\.nl|Apple Mac mini 1 model A2348|Word lid en verkoop tweedehands kleding/);
  assert.doesNotMatch(popup.renderedMultiList, /Other activity/);
  assert.doesNotMatch(popup.renderedMultiList, /Inbox/);
  assert.doesNotMatch(popup.renderedMultiList, /data-popup-child-index|popup-activity-child-row|popup-activity-expand/);

  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[6].length, 1);
  assert.equal(popup.modalArgs[6][0].title, "coulou's vinyl cafe (no. 4) - rainy day selections");
  assert.equal(
    popup.modalArgs[6][0].modalAggregateGroupKey,
    "brave browser|||coulou's vinyl cafe (no. 4) - rainy day selections"
  );
  assert.equal(popup.modalArgs[6][0].sources.length, 1);
});

test('Activities popup renders retail pages as canonical rows and omits short scraps', () => {
  const dateStart = new Date(2026, 4, 21).setHours(0, 0, 0, 0);
  const blockStart = dateStart + 14 * 60 * 60 * 1000;
  const popup = renderMultipleActivitiesPopup({
    startCell: 14 * 12,
    span: 2,
    app: 'Brave Browser',
    title: 'mediamarkt.nl',
    url: 'https://www.mediamarkt.nl/',
    overlaps: [
      {
        app: 'Brave Browser',
        title: 'mediamarkt.nl',
        url: 'https://www.mediamarkt.nl/',
        duration: 4 * 60 * 1000,
        start: blockStart,
        end: blockStart + 4 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'KOENIC KIP 352925 Double Induction Plate Induktionskookplaat',
        url: 'https://www.mediamarkt.nl/nl/product/_koenic-kip-352925-1.html',
        duration: 28 * 1000,
        start: blockStart + 4 * 60 * 1000,
        end: blockStart + 4 * 60 * 1000 + 28 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'KOENIC KIP 352925 Double Induction Plate Induktionskookplaat',
        url: 'https://www.mediamarkt.nl/nl/product/_koenic-kip-352925-1.html',
        duration: 32 * 1000,
        start: blockStart + 4 * 60 * 1000 + 28 * 1000,
        end: blockStart + 5 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'Zero duration page',
        url: 'https://www.mediamarkt.nl/zero',
        duration: 0,
        start: blockStart + 5 * 60 * 1000,
        end: blockStart + 5 * 60 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'New Tab',
        url: 'chrome://newtab/',
        duration: 1000,
        start: blockStart + 5 * 60 * 1000,
        end: blockStart + 5 * 60 * 1000 + 1000
      },
      {
        app: 'Brave Browser',
        title: 'duckduckgo.com',
        url: 'https://duckduckgo.com/',
        duration: 1000,
        start: blockStart + 5 * 60 * 1000 + 1000,
        end: blockStart + 5 * 60 * 1000 + 2000
      },
      {
        app: 'Brave Browser',
        title: '4049011211568 at DuckDuckGo',
        url: 'https://duckduckgo.com/?q=4049011211568',
        duration: 61 * 1000,
        start: blockStart + 5 * 60 * 1000 + 2000,
        end: blockStart + 6 * 60 * 1000 + 3000
      },
      {
        app: 'Codex',
        title: 'Codex',
        duration: 10 * 1000,
        start: blockStart + 6 * 60 * 1000 + 3000,
        end: blockStart + 6 * 60 * 1000 + 13 * 1000
      },
      {
        app: 'Brave Browser',
        title: 'ebay.de',
        url: 'https://www.ebay.de/',
        duration: 1000,
        start: blockStart + 6 * 60 * 1000 + 13 * 1000,
        end: blockStart + 6 * 60 * 1000 + 14 * 1000
      }
    ]
  });

  assert.match(popup.renderedMultiList, /class="popup-activity-title"[^>]*>mediamarkt\.nl<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /class="popup-activity-title"[^>]*>duckduckgo\.com<\/span>/);
  assert.doesNotMatch(popup.renderedMultiList, /Other activity/);
  assert.doesNotMatch(popup.renderedMultiList, /New Tab/);
  assert.doesNotMatch(popup.renderedMultiList, /Codex/);
  assert.doesNotMatch(popup.renderedMultiList, /ebay\.de/);
  assert.doesNotMatch(popup.renderedMultiList, /Zero duration page/);
  assert.match(popup.renderedMultiList, /KOENIC KIP 352925 Double Induction Plate/);
  assert.match(popup.renderedMultiList, /4049011211568 at DuckDuckGo/);
  assert.doesNotMatch(popup.renderedMultiList, /data-popup-child-index|popup-activity-child-row|popup-activity-expand/);
  assert.equal((popup.renderedMultiList.match(/data-popup-overlap-index/g) || []).length, 3);
  const renderedTitles = [...popup.renderedMultiList.matchAll(/class="popup-activity-title"[^>]*>([^<]+)<\/span>/g)]
    .map(match => match[1]);
  assert.equal(
    renderedTitles.join(' | '),
    'mediamarkt.nl | KOENIC KIP 352925 Double Induction Plate Induktionskookplaat | 4049011211568 at DuckDuckGo'
  );

  popup.popupRows.forEach(row => row.querySelector('.popup-activity-select')?.click());
  popup.context.DOM.elPopupAssignBtn.onclick();

  assert.equal(popup.modalArgs[6].length, 3);
  assert.equal(popup.modalArgs[6][0].title, 'mediamarkt.nl');
  assert.equal(popup.modalArgs[6][0].sources.length, 1);
  assert.equal(popup.modalArgs[6][1].title, 'KOENIC KIP 352925 Double Induction Plate Induktionskookplaat');
  assert.equal(popup.modalArgs[6][1].sources.length, 2);
  assert.equal(popup.modalArgs[6][2].title, '4049011211568 at DuckDuckGo');
});

test('bulk assignment modal renders aggregate rows while selected activities preserve row units', () => {
  const { context, elements } = loadModalsContext();
  const startMs = new Date(2026, 4, 21, 14, 40).getTime();
  const first = {
    app: 'Brave Browser',
    title: "coulou's cafe trumpet meditations (no. 71)",
    url: 'https://www.youtube.com/watch?v=trumpet',
    start: startMs,
    end: startMs + 20 * 1000,
    duration: 20 * 1000,
    assignedDurationMs: 20 * 1000,
    assignmentSource: 'activity-stream',
    modalAggregateGroupKey: 'brave-browser-youtube-trumpet'
  };
  const second = {
    app: 'Brave Browser',
    title: "coulou's cafe trumpet meditations (no. 71)",
    url: 'https://www.youtube.com/watch?v=trumpet',
    start: startMs + 60 * 1000,
    end: startMs + 100 * 1000,
    duration: 40 * 1000,
    assignedDurationMs: 40 * 1000,
    assignmentSource: 'activity-stream',
    modalAggregateGroupKey: 'brave-browser-youtube-trumpet'
  };
  const third = {
    app: 'Brave Browser',
    title: "coulou's cafe trumpet meditations (no. 71)",
    url: 'https://www.youtube.com/watch?v=trumpet',
    start: startMs + 2 * 60 * 1000,
    end: startMs + 3 * 60 * 1000,
    duration: 60 * 1000,
    assignedDurationMs: 60 * 1000,
    assignmentSource: 'activity-stream',
    modalAggregateGroupKey: 'brave-browser-youtube-trumpet'
  };

  context.openTimeEntryModal(startMs, startMs + 3 * 60 * 1000, '', null, null, true, [first, second, third]);

  const listHtml = elements.get('modal-memory-aid-list').innerHTML;
  assert.equal((listHtml.match(/data-modal-activity-index/g) || []).length, 1);
  assert.doesNotMatch(listHtml, />0 min</);
  assert.match(listHtml, />2 min</);
  assert.equal(context.getSelectedModalActivities().length, 1);
  assert.equal(context.getSelectedModalActivities()[0].modalSourceActivities.length, 3);
  assert.equal(elements.get('modal-duration-lbl').innerText, '2 min');

  context.setModalActivityIncluded(0, false);

  assert.equal(context.getSelectedModalActivities().length, 0);
  assert.equal(elements.get('modal-duration-lbl').innerText, '0 min');
});

// Activity Stream suppression (WS3) needs utils.js loaded alongside timeline.js so
// filterIsolatedSubMinuteRuns is in scope (the default loadTimelineContext omits it).
function loadTimelineWithUtilsContext() {
  const context = {
    window: {},
    state: {
      currentDate: new Date(2026, 4, 21),
      zoom: 5,
      activities: [],
      timeEntries: [],
      projects: [],
      selectedActivities: new Set(),
      settings: { minActivityThreshold: 60 }
    },
    DOM: {},
    resizeState: {},
    document: {},
    URL,
    cleanTitle: title => title,
    getActivityIconHTML: () => '',
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('web/js/utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('web/js/timeline.js', 'utf8'), context);
  return context;
}

test('Activity Stream drops isolated sub-minute captures but keeps continuous and aggregated host runs', () => {
  const context = loadTimelineWithUtilsContext();
  const minute = 60 * 1000;
  const activities = [
    // Continuous Codex run (two captures <15s apart) -> kept.
    { app: 'Codex', title: 'Codex', url: '', start: 0, end: minute },
    { app: 'Codex', title: 'Codex', url: '', start: minute + 5 * 1000, end: minute + 5 * 1000 + minute },
    // Browser host: two sub-minute pages within the merge gap aggregate to >60s -> kept (#63).
    { app: 'Brave Browser', title: 'A', url: 'https://example.com/a', start: 10 * minute, end: 10 * minute + 40 * 1000 },
    { app: 'Brave Browser', title: 'B', url: 'https://example.com/b', start: 10 * minute + 45 * 1000, end: 10 * minute + 45 * 1000 + 40 * 1000 },
    // Isolated sub-minute Codex blip far from anything -> dropped.
    { app: 'Codex', title: 'Codex', url: '', start: 20 * minute, end: 20 * minute + 30 * 1000 }
  ];

  const renderable = context.getActivityStreamRenderableActivities(activities);
  assert.equal(renderable.length, 4);
  assert.equal(renderable.some(a => a.start === 20 * minute), false, 'isolated sub-minute Codex blip is dropped');
  assert.equal(renderable.filter(a => a.app === 'Brave Browser').length, 2, 'aggregated host pages are kept');
  // Memoized: same source array returns the same filtered reference.
  assert.equal(context.getActivityStreamRenderableActivities(activities), renderable);
});
