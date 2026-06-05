// Cache last reported tab to avoid redundant messages.
let lastReported = {
  url: '',
  title: '',
  active: false,
  audible: false
};
let nativePort = null;

function getNativePort() {
  if (nativePort) return nativePort;
  nativePort = chrome.runtime.connectNative('so.sil.oriel.browser');
  nativePort.onDisconnect.addListener(() => {
    nativePort = null;
  });
  return nativePort;
}

// Check if browser is Brave or Chrome
async function getBrowserName() {
  if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
    const isBrave = await navigator.brave.isBrave();
    if (isBrave) return 'Brave Browser';
  }
  return 'Google Chrome';
}

// Fetch active tab state and submit it to the local Oriel native host.
async function reportActivity() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.url) return;

    // Check if the current browser window is focused
    const window = await chrome.windows.getLastFocused();
    const active = window ? window.focused : false;
    const audible = tab.audible === true;

    // Ignore noise URLs (like chrome:// settings, brave://, newtab)
    if (
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('brave://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('about:')
    ) {
      return;
    }

    // Only submit if state actually changed.
    if (
      lastReported.url === tab.url &&
      lastReported.title === tab.title &&
      lastReported.active === active &&
      lastReported.audible === audible
    ) {
      return;
    }

    lastReported.url = tab.url;
    lastReported.title = tab.title;
    lastReported.active = active;
    lastReported.audible = audible;

    const browser = await getBrowserName();

    getNativePort().postMessage({
      type: 'browserActivity',
      title: tab.title || 'New Tab',
      url: tab.url,
      browser,
      active,
      audible,
      timestamp: Date.now()
    });
  } catch (err) {
    // Fail silently when Oriel or its native host is unavailable.
    console.debug('Failed to report browser activity:', err.message);
  }
}

// Monitor tab activations
chrome.tabs.onActivated.addListener(() => {
  reportActivity();
});

// Monitor tab updates (like navigation, title shifts)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Only update if URL, title, or audible playback state changed.
  if (changeInfo.url || changeInfo.title || changeInfo.audible !== undefined) {
    reportActivity();
  }
});

// Monitor browser window focus changes (switching to other macOS apps)
chrome.windows.onFocusChanged.addListener(() => {
  reportActivity();
});
