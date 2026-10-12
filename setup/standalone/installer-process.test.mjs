import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInstaller } from './installer-process.mjs';

test('installer completing after an earlier short deadline can finish within the new budget', async () => {
  await runInstaller(process.execPath, ['-e', 'setTimeout(() => { console.log("installed"); }, 500)'], {
    timeoutMs: 5000, pollMs: 100, report() {},
  });
});

test('stalled installer is terminated and its last stage is included in the timeout', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-process-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const progressFile = path.join(dir, 'progress.jsonl');
  const script = 'require("node:fs").writeFileSync(process.env.TEST_PROGRESS, JSON.stringify({stage:"copying runtime"})+"\\n"); setInterval(() => {}, 1000);';
  const reports = [];
  await assert.rejects(runInstaller(process.execPath, ['-e', script], {
    env: { ...process.env, TEST_PROGRESS: progressFile }, progressFile,
    timeoutMs: 2000, pollMs: 100, report: text => reports.push(text),
  }), error => error.code === 'ETIMEDOUT' && error.message.includes('copying runtime'));
  assert.ok(reports.some(text => text.includes('copying runtime')));
});

test('installer failures preserve stage and stderr instead of passing on a longer deadline', async () => {
  await assert.rejects(runInstaller(process.execPath, ['-e', 'console.error("payload checksum mismatch"); process.exit(1);'], {
    timeoutMs: 5000, report() {},
  }), error => error.code === 'INSTALLER_FAILED' && error.message.includes('payload checksum mismatch'));
});
