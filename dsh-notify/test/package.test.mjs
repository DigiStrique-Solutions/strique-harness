import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';

test('the notification bundle is admitted by the tested Harness runtime without an exemption', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(evaluatePluginCompatibility(manifest), undefined);
});
