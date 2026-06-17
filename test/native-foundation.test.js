import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('native app package targets macOS 14 and stages a standalone Oriel.app', () => {
  const packageManifest = read('Package.swift');
  const buildScript = read('script/build_and_run.sh');

  assert.match(packageManifest, /\.macOS\(\.v14\)/);
  assert.match(packageManifest, /name:\s*"OrielApp"/);
  assert.match(packageManifest, /name:\s*"CSQLite"/);
  assert.match(packageManifest, /\.linkedFramework\("Security"\)/);
  assert.match(buildScript, /Oriel\.app/);
  assert.match(buildScript, /CONTENTS_DIR=.*Contents/);
  assert.match(buildScript, /WEB_DIR=.*Resources\/Web/);
  assert.match(buildScript, /mkdir -p "\$\(dirname "\$APP_DIR"\)"/);
  assert.match(buildScript, /index\.html/);
  assert.match(buildScript, /css/);
  assert.match(buildScript, /js/);
  assert.match(buildScript, /assets/);
});

test('native host provides WKWebView reply bridge and desktop lifecycle controls', () => {
  const app = read('Sources/OrielApp/App/OrielApp.swift');
  const webView = read('Sources/OrielApp/Views/OrielWebViewController.swift');
  const bridge = read('Sources/OrielApp/Services/OrielBridge.swift');
  const store = read('Sources/OrielApp/Stores/SQLiteStore.swift');
  const aiService = read('Sources/OrielApp/Services/AIService.swift');
  const keychain = read('Sources/OrielApp/Services/KeychainStore.swift');

  assert.match(app, /NSStatusItem/);
  assert.match(app, /NSWindowDelegate/);
  assert.match(app, /NSMenu\(title:\s*"Edit"\)/);
  for (const selector of ['undo:', 'redo:']) {
    assert.match(app, new RegExp(`Selector\\(\\("${selector}"\\)\\)`));
  }
  for (const command of ['cut', 'copy', 'paste', 'selectAll']) {
    assert.match(app, new RegExp(`#selector\\(NSText\\.${command}\\(_:\\)\\)`));
  }
  assert.match(app, /editMenu\.addItem/);
  assert.match(app, /keyEquivalent:\s*"a"/);
  assert.match(app, /keyEquivalent:\s*"c"/);
  assert.match(app, /\.fullSizeContentView/);
  assert.match(app, /titleVisibility = \.hidden/);
  assert.match(app, /titlebarAppearsTransparent = true/);
  assert.match(app, /positionTrafficLightButtons\(in:/);
  assert.match(app, /trafficLightLeading:\s*CGFloat\s*=\s*17\.5/);
  assert.match(app, /trafficLightTopOffset:\s*CGFloat\s*=\s*19\.5/);
  assert.match(app, /trafficLightSpacing:\s*CGFloat\s*=\s*20/);
  assert.match(app, /contentView\.addSubview\(button, positioned: \.above/);
  assert.match(app, /repositionMainWindowChrome\(\)/);
  assert.match(app, /windowDidUpdate/);
  assert.match(app, /fitMainWindowToScreenEdges\(\)/);
  assert.match(app, /screenFrameForMainWindow\(\)/);
  assert.match(app, /NSScreen\.main\?\.frame/);
  assert.match(app, /mainWindow\.setFrame\(screenFrame, display: true\)/);
  assert.doesNotMatch(app, /mainWindow\.center\(\)/);
  assert.match(app, /contentView\.isFlipped/);
  assert.match(app, /trafficLightButtonY\(in: contentView/);
  assert.match(app, /systemSymbolName: "clock"/);
  assert.match(app, /image\.size = NSSize\(width: 15, height: 15\)/);
  assert.match(app, /Pause Tracking/);
  assert.doesNotMatch(app, /Start Oriel at Login/);
  assert.match(webView, /WKWebView/);
  assert.match(webView, /final class ContextMenuDisabledWebView:\s*WKWebView/);
  assert.match(webView, /override func menu\(for event:\s*NSEvent\)\s*->\s*NSMenu\?\s*\{\s*nil\s*\}/);
  assert.match(webView, /webView = ContextMenuDisabledWebView\(frame: \.zero, configuration: configuration\)/);
  assert.match(webView, /WKNavigationDelegate/);
  assert.match(bridge, /WKScriptMessageHandlerWithReply/);
  assert.match(bridge, /store\.request\(operation:/);
  assert.match(bridge, /ai\.chat/);
  assert.match(bridge, /ai\.keys\.save/);
  assert.match(bridge, /ai\.keys\.delete/);
  assert.match(bridge, /ai\.keys\.status/);
  assert.match(bridge, /system\.openScreenRecordingSettings/);
  assert.match(bridge, /Privacy_ScreenCapture/);
  assert.match(bridge, /NSWorkspace\.shared\.open/);
  assert.match(bridge, /logoDev\.key\.status/);
  assert.match(bridge, /logoDev\.key\.save/);
  assert.match(bridge, /logoDev\.key\.delete/);
  assert.match(app, /AIService/);
  assert.match(store, /activities\.list/);
  assert.match(store, /settings\.update/);
  assert.match(aiService, /api\.openai\.com\/v1\/responses/);
  assert.match(aiService, /generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.match(keychain, /SecItemAdd/);
  assert.match(keychain, /SecItemCopyMatching/);
  assert.match(keychain, /SecItemDelete/);
});

test('native persistence owns a versioned SQLite schema under Application Support', () => {
  const store = read('Sources/OrielApp/Stores/SQLiteStore.swift');

  assert.match(store, /applicationSupportDirectory/);
  assert.match(store, /Oriel\.sqlite/);
  for (const table of [
    'schema_metadata',
    'activities',
    'projects',
    'time_entries',
    'time_entry_activities',
    'assignment_rules',
    'capture_exclusions',
    'passive_reviews',
    'settings'
  ]) {
    assert.match(store, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test('native capture handles accessibility, idle detection, and exclusions in process', () => {
  const capture = read('Sources/OrielApp/Services/TrackingController.swift');
  const store = read('Sources/OrielApp/Stores/SQLiteStore.swift');
  const bridge = read('Sources/OrielApp/Services/OrielBridge.swift');

  assert.match(capture, /NSWorkspace/);
  assert.match(capture, /AXUIElement/);
  assert.match(capture, /CGEventSource/);
  assert.match(capture, /InteractionState/);
  assert.match(capture, /handsOn/);
  assert.match(capture, /handsOff/);
  assert.match(capture, /idleThresholdSeconds:\s*TimeInterval\s*=\s*30/);
  assert.match(capture, /NSWorkspace\.screensDidSleepNotification/);
  assert.match(capture, /NSWorkspace\.screensDidWakeNotification/);
  assert.doesNotMatch(capture, /passiveReviewCapSeconds/);
  assert.doesNotMatch(capture, /activePassiveReview/);
  assert.doesNotMatch(capture, /pendingPassiveReviews/);
  assert.doesNotMatch(capture, /shouldPersistPassiveReview/);
  assert.match(capture, /resolvePassiveReview/);
  assert.match(bridge, /passiveReview\.resolve/);
  assert.doesNotMatch(capture, /ioreg|osascript|AppleScript/);
  assert.match(store, /isCaptureExcluded/);
  assert.match(store, /interaction_state/);
});

test('native icon handler gates Logo.dev behind saved opt-in and local cache', () => {
  const handler = read('Sources/OrielApp/Services/IconSchemeHandler.swift');
  const keychain = read('Sources/OrielApp/Services/KeychainStore.swift');
  assert.match(handler, /logoDevIconsEnabled/);
  assert.match(handler, /logoDevKeyStore/);
  assert.match(handler, /logoDevAPIKey/);
  assert.match(handler, /img\.logo\.dev/);
  assert.doesNotMatch(handler, /pk_[A-Za-z0-9_]+/);
  assert.match(handler, /BrandIcons/);
  assert.match(handler, /clearBrandCache/);
  assert.match(handler, /resolvedApplicationPath/);
  assert.match(handler, /appIconCacheFingerprint/);
  assert.match(handler, /NSImage\(contentsOf:/);
  assert.match(handler, /query\["v"\]/);
  assert.match(handler, /urlForApplication\(withBundleIdentifier:/);
  assert.match(keychain, /saveLogoDevAPIKey/);
  assert.match(keychain, /deleteLogoDevAPIKey/);
});
