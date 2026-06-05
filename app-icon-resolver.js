import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const appBundleCache = new Map();

export function safeIconFileName(appName, bundleId = '') {
  const base = bundleId || appName;
  return base.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
}

export function isValidAppBundle(appPath, fsImpl = fs) {
  return Boolean(
    appPath &&
    appPath.endsWith('.app') &&
    fsImpl.existsSync(appPath) &&
    fsImpl.statSync(appPath).isDirectory()
  );
}

function normalizeName(value = '') {
  return value.toLowerCase().replace(/\.app$/i, '').replace(/[^a-z0-9]/g, '');
}

function readBundleMetadata(appPath, spawnSyncImpl = spawnSync) {
  const infoPath = path.join(appPath, 'Contents', 'Info.plist');
  const result = spawnSyncImpl('/usr/bin/plutil', ['-convert', 'json', '-o', '-', infoPath], {
    encoding: 'utf8'
  });

  if (result.status !== 0 || !result.stdout) return null;

  try {
    const plist = JSON.parse(result.stdout);
    return {
      path: appPath,
      displayName: plist.CFBundleDisplayName || '',
      bundleName: plist.CFBundleName || '',
      executable: plist.CFBundleExecutable || '',
      bundleId: plist.CFBundleIdentifier || '',
      folderName: path.basename(appPath, '.app')
    };
  } catch {
    return null;
  }
}

function candidateAppRoots(homeDir = os.homedir(), rootDirs = null) {
  if (rootDirs) return rootDirs;

  return [
    '/Applications',
    '/Applications/Utilities',
    '/System/Applications',
    '/System/Applications/Utilities',
    path.join(homeDir, 'Applications'),
    path.join(process.cwd(), 'build'),
    path.join(process.cwd(), 'dist')
  ];
}

function listAppBundles(root, fsImpl = fs) {
  if (!fsImpl.existsSync(root)) return [];

  try {
    return fsImpl.readdirSync(root)
      .filter((entry) => entry.endsWith('.app'))
      .map((entry) => path.join(root, entry));
  } catch {
    return [];
  }
}

export function resolveAppBundlePath({
  appName,
  appPath,
  bundleId,
  fsImpl = fs,
  spawnSyncImpl = spawnSync,
  homeDir = os.homedir(),
  rootDirs = null
}) {
  if (isValidAppBundle(appPath, fsImpl)) return appPath;

  const cacheKey = `${appName || ''}|${bundleId || ''}`;
  if (appBundleCache.has(cacheKey)) return appBundleCache.get(cacheKey);

  const normalizedAppName = normalizeName(appName);
  const normalizedBundleId = (bundleId || '').toLowerCase();
  const roots = candidateAppRoots(homeDir, rootDirs);

  const exactCandidates = roots.flatMap((root) => [
    path.join(root, `${appName}.app`),
    path.join(root, `${appName?.replace(/\s+Desktop$/i, '')}.app`)
  ]);

  for (const candidate of exactCandidates) {
    if (isValidAppBundle(candidate, fsImpl)) {
      appBundleCache.set(cacheKey, candidate);
      return candidate;
    }
  }

  const bundles = roots.flatMap((root) => listAppBundles(root, fsImpl));
  let bestMatch = null;

  for (const bundlePath of bundles) {
    const metadata = readBundleMetadata(bundlePath, spawnSyncImpl);
    if (!metadata) continue;

    const names = [
      metadata.displayName,
      metadata.bundleName,
      metadata.executable,
      metadata.folderName
    ].map(normalizeName).filter(Boolean);

    if (normalizedBundleId && metadata.bundleId.toLowerCase() === normalizedBundleId) {
      appBundleCache.set(cacheKey, bundlePath);
      return bundlePath;
    }

    if (normalizedAppName && names.includes(normalizedAppName)) {
      appBundleCache.set(cacheKey, bundlePath);
      return bundlePath;
    }

    if (
      normalizedAppName &&
      names.some((name) => normalizedAppName.includes(name) || name.includes(normalizedAppName))
    ) {
      bestMatch = bestMatch || bundlePath;
    }
  }

  if (bestMatch) {
    appBundleCache.set(cacheKey, bestMatch);
    return bestMatch;
  }

  return '';
}
