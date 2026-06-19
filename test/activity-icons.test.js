import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

function loadUtils() {
  const source = fs.readFileSync(new URL('../web/js/utils.js', import.meta.url), 'utf8');
  const context = {
    window: {},
    URL,
    URLSearchParams,
    browserPatterns: [],
    state: { settings: { logoDevIconsEnabled: false } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window;
}

function loadNativeUtils() {
  const source = fs.readFileSync(new URL('../web/js/utils.js', import.meta.url), 'utf8');
  const context = {
    window: { OrielData: { isNative: true } },
    URL,
    URLSearchParams,
    browserPatterns: [],
    state: { settings: { logoDevIconsEnabled: false } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window;
}

test('uses native macOS app icons when an activity has no URL', () => {
  const utils = loadUtils();

  const html = utils.getActivityIconHTML('Figma', '', 'Design System Figma Kit', '/Applications/Figma.app', 'com.figma.Desktop');

  assert.match(html, /src="\/api\/icons\/Figma\?v=native-icons-v6/);
  assert.match(html, /appPath=%2FApplications%2FFigma\.app/);
  assert.match(html, /bundleId=com\.figma\.Desktop/);
  assert.doesNotMatch(html, /google\.com\/s2\/favicons/);
});

test('uses local browser icons for website activities unless brand icons are enabled', () => {
  const utils = loadUtils();

  const html = utils.getActivityIconHTML('Brave Browser', 'https://app.ynab.com/accounts', 'Plan | Personal | YNAB');

  assert.doesNotMatch(html, /img\.logo\.dev/);
  assert.match(html, /website-icon-fallback/);
  assert.match(html, /aria-label="app\.ynab\.com"/);
});

test('native browser activities use local domain badges without historic app paths', () => {
  const utils = loadNativeUtils();

  const html = utils.getActivityIconHTML('Brave Browser', 'https://chatgpt.com/c/123', 'Conversation');

  assert.match(html, /website-icon-fallback/);
  assert.match(html, /aria-label="chatgpt\.com"/);
  assert.doesNotMatch(html, /img\.logo\.dev/);
});

test('browser development falls back to local domain badges when brand icons are enabled without native Keychain', () => {
  const utils = loadUtils();
  utils.setBrandIconPreferenceForTesting(true);

  const html = utils.getActivityIconHTML('Brave Browser', 'https://app.ynab.com/accounts', 'Plan | Personal | YNAB');

  assert.doesNotMatch(html, /img\.logo\.dev/);
  assert.doesNotMatch(html, /token=/);
  assert.match(html, /website-icon-fallback/);
  assert.match(html, /aria-label="app\.ynab\.com"/);
});

test('uses native Logo.dev icon scheme only after user enables brand icons', () => {
  const utils = loadNativeUtils();
  utils.setBrandIconPreferenceForTesting(true);

  const html = utils.getActivityIconHTML('Brave Browser', 'https://app.ynab.com/accounts', 'Plan | Personal | YNAB');

  assert.match(html, /oriel-icon:\/\/website\/icon\?domain=app\.ynab\.com/);
  assert.doesNotMatch(html, /token=/);
  assert.match(html, /referrerpolicy="origin"/);
  assert.match(html, /this\.src='oriel-icon:\/\/app\/icon\?/);
  assert.doesNotMatch(html, /google\.com\/s2\/favicons/);
});

test('activity icons render inside a consistent fixed-size frame', () => {
  const utils = loadUtils();
  const css = fs.readFileSync('web/css/index.css', 'utf8');

  const nativeHtml = utils.getActivityIconHTML('Codex', '', 'Codex');
  const websiteHtml = utils.getActivityIconHTML('Brave Browser', 'https://www.youtube.com/watch?v=123', 'Video');
  const fallbackHtml = utils.getActivityIconHTML('', '', '');
  const nativeUtils = loadNativeUtils();
  nativeUtils.setBrandIconPreferenceForTesting(true);
  const brandHtml = nativeUtils.getActivityIconHTML('Brave Browser', 'https://soundcloud.com/song', 'Song');

  for (const html of [nativeHtml, websiteHtml, brandHtml]) {
    assert.match(html, /activity-icon-frame/);
  }
  assert.match(nativeHtml, /activity-icon-frame--native/);
  assert.match(websiteHtml, /activity-icon-frame--website/);
  assert.match(brandHtml, /activity-icon-frame--brand/);
  assert.match(brandHtml, /activity-icon-frame--image/);
  assert.match(fallbackHtml, /activity-icon-frame--fallback/);
  assert.match(css, /\.activity-icon-frame\s*\{[\s\S]*width:\s*20px/s);
  assert.match(css, /\.activity-icon-frame\s*\{[\s\S]*height:\s*20px/s);
  assert.match(css, /\.activity-icon-frame--native\s+\.activity-icon-img\s*\{[\s\S]*width:\s*20px/s);
  assert.match(css, /\.activity-icon-frame--brand\s+\.activity-icon-img\s*\{[\s\S]*width:\s*16px/s);
  assert.match(css, /\.activity-icon-frame--website\s+\.website-icon-fallback\s*\{[\s\S]*width:\s*16px/s);
});
