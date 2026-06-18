import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { resolveAppBundlePath } from '../tools/dev-server/app-icon-resolver.js';

function writeAppBundle(root, folderName, plist) {
  const appPath = path.join(root, `${folderName}.app`);
  const contentsPath = path.join(appPath, 'Contents');
  fs.mkdirSync(contentsPath, { recursive: true });
  fs.writeFileSync(path.join(contentsPath, 'Info.plist'), JSON.stringify(plist));
  return appPath;
}

test('resolves macOS app icons when activity name differs from app bundle folder', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timetracker-icons-'));
  const applicationsDir = path.join(homeDir, 'Applications');
  fs.mkdirSync(applicationsDir, { recursive: true });

  const dockerPath = writeAppBundle(applicationsDir, 'Docker', {
    CFBundleDisplayName: 'Docker',
    CFBundleName: 'Docker',
    CFBundleExecutable: 'com.docker.backend',
    CFBundleIdentifier: 'com.docker.docker'
  });

  const resolved = resolveAppBundlePath({
    appName: 'Docker Desktop',
    bundleId: 'com.docker.docker',
    homeDir,
    rootDirs: [applicationsDir],
    spawnSyncImpl: (_cmd, args) => ({
      status: 0,
      stdout: fs.readFileSync(args[4], 'utf8')
    })
  });

  assert.equal(resolved, dockerPath);
});

test('resolves staged development Oriel.app from its executable name', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'timetracker-staged-app-'));
  const buildDir = path.join(tempRoot, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  const orielPath = writeAppBundle(buildDir, 'Oriel', {
    CFBundleDisplayName: 'Oriel',
    CFBundleName: 'Oriel',
    CFBundleExecutable: 'OrielApp',
    CFBundleIdentifier: 'so.sil.oriel'
  });

  const originalCwd = process.cwd();
  process.chdir(tempRoot);
  try {
    const resolved = resolveAppBundlePath({
      appName: 'OrielApp',
      spawnSyncImpl: (_cmd, args) => ({
        status: fs.existsSync(args[4]) ? 0 : 1,
        stdout: fs.existsSync(args[4]) ? fs.readFileSync(args[4], 'utf8') : ''
      })
    });

    assert.equal(resolved, fs.realpathSync(orielPath));
  } finally {
    process.chdir(originalCwd);
  }
});
