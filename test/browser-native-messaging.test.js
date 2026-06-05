import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('browser companion submits tab activity through Native Messaging rather than localhost', () => {
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  const background = fs.readFileSync('extension/background.js', 'utf8');

  assert.ok(manifest.permissions.includes('nativeMessaging'));
  assert.deepEqual(manifest.icons, {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png'
  });
  for (const iconPath of Object.values(manifest.icons)) {
    assert.ok(fs.existsSync(`extension/${iconPath}`), `${iconPath} exists`);
  }
  assert.equal(manifest.host_permissions, undefined);
  assert.match(background, /connectNative\(['"]so\.sil\.oriel\.browser['"]\)/);
  assert.match(background, /type:\s*['"]browserActivity['"]/);
  assert.match(background, /audible/);
  assert.match(background, /changeInfo\.audible/);
  assert.doesNotMatch(background, /localhost:3000|fetch\(/);
});

test('native app bundles and registers a restricted browser bridge host', () => {
  const packageManifest = fs.readFileSync('Package.swift', 'utf8');
  const registrar = fs.readFileSync('Sources/OrielApp/Services/BrowserCompanionService.swift', 'utf8');
  const bridge = fs.readFileSync('Sources/OrielBrowserBridge/main.swift', 'utf8');

  assert.match(packageManifest, /OrielBrowserBridge/);
  assert.match(registrar, /allowed_origins/);
  assert.match(registrar, /Chrome\/NativeMessagingHosts/);
  assert.match(registrar, /BraveSoftware\/Brave-Browser\/NativeMessagingHosts/);
  assert.match(bridge, /browserActivity/);
  assert.match(bridge, /let audible: Bool\?/);
  assert.match(bridge, /BrowserEvents\.jsonl/);
  assert.match(bridge, /BrowserReceiver\.ready/);
  assert.match(bridge, /0o600/);
  assert.match(registrar, /lastSeenAt/);
  assert.match(registrar, /let audible: Bool\?/);
});
