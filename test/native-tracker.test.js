import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveNativeTrackerCommand } from '../tools/dev-server/native-tracker.js';

function createFsStub({ sourceMtimeMs = 2000, binaryMtimeMs = 1000, binaryExists = true } = {}) {
  return {
    existsSync(path) {
      return binaryExists && path.endsWith('tracker');
    },
    mkdirSync() {},
    statSync(path) {
      if (path.endsWith('tracker.swift')) return { mtimeMs: sourceMtimeMs };
      if (path.endsWith('tracker')) return { mtimeMs: binaryMtimeMs };
      throw new Error(`Unexpected stat path: ${path}`);
    }
  };
}

test('builds and runs the compiled native tracker when source is newer', () => {
  const compileCalls = [];
  const command = resolveNativeTrackerCommand({
    sourcePath: '/app/tracker.swift',
    binaryPath: '/app/scratch/tracker',
    fsImpl: createFsStub(),
    spawnSyncImpl: (cmd, args) => {
      compileCalls.push({ cmd, args });
      return { status: 0, stdout: '', stderr: '' };
    },
    logger: { warn() {} }
  });

  assert.deepEqual(compileCalls, [
    { cmd: 'swiftc', args: ['/app/tracker.swift', '-o', '/app/scratch/tracker'] }
  ]);
  assert.deepEqual(command, {
    command: '/app/scratch/tracker',
    args: [],
    mode: 'compiled'
  });
});

test('falls back to interpreted Swift when compiling the tracker fails', () => {
  const warnings = [];
  const command = resolveNativeTrackerCommand({
    sourcePath: '/app/tracker.swift',
    binaryPath: '/app/scratch/tracker',
    fsImpl: createFsStub(),
    spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: 'compile failed' }),
    logger: { warn(message) { warnings.push(message); } }
  });

  assert.deepEqual(command, {
    command: 'swift',
    args: ['/app/tracker.swift'],
    mode: 'interpreted'
  });
  assert.equal(warnings.length, 1);
});
