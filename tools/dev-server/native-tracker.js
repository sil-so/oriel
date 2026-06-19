import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

export function shouldBuildNativeTracker(sourcePath, binaryPath, fsImpl = fs) {
  if (!fsImpl.existsSync(binaryPath)) return true;

  const sourceStat = fsImpl.statSync(sourcePath);
  const binaryStat = fsImpl.statSync(binaryPath);
  return sourceStat.mtimeMs > binaryStat.mtimeMs;
}

export function resolveNativeTrackerCommand({
  sourcePath,
  binaryPath,
  fsImpl = fs,
  spawnSyncImpl = spawnSync,
  logger = console
}) {
  if (shouldBuildNativeTracker(sourcePath, binaryPath, fsImpl)) {
    fsImpl.mkdirSync(path.dirname(binaryPath), { recursive: true });

    const build = spawnSyncImpl('swiftc', [sourcePath, '-o', binaryPath], {
      encoding: 'utf8'
    });

    if (build.status !== 0) {
      const detail = (build.stderr || build.stdout || 'unknown compiler error').trim();
      logger.warn(`[Native Tracker] Failed to compile tracker helper; falling back to interpreted Swift. ${detail}`);

      return {
        command: 'swift',
        args: [sourcePath],
        mode: 'interpreted'
      };
    }
  }

  return {
    command: binaryPath,
    args: [],
    mode: 'compiled'
  };
}
