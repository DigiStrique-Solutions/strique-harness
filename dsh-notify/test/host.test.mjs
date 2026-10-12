import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import * as plugin from '../lib/index.js';
import { readFileSync } from 'node:fs';

test('declares peers for the installed Harness runtime', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const runtime = JSON.parse(readFileSync(new URL('../node_modules/@deepseek-ai/dsh-settings/package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-settings'], runtime.version);
});

test('plugin activates without the settings service and suppresses its auto page when present', async () => {
  const ctx = new Context();
  // No settings service: the plugin must still activate (soft inject).
  const bare = ctx.plugin(plugin, {});
  await bare;
  assert.equal(bare.state, 2); // Cordis ACTIVE

  // With a settings service: the auto-generated page policy is registered once.
  const policies = [];
  const disposers = [];
  ctx.provide('settings', {
    configure: (presentation) => {
      policies.push(presentation);
      return () => disposers.push(presentation);
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(policies, [{ auto: false }]);

  await bare.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposers.length, 1);
});

test('configuration rejects invalid volume and sound presets', () => {
  for (const config of [{ volume: -1 }, { volume: 101 }, { doneSound: 'invalid' }, { questionSound: 'invalid' }]) {
    assert.throws(() => plugin.Config(config));
  }
});

test('configuration defaults match the browser store defaults', () => {
  const config = plugin.Config({});
  assert.deepEqual(config, {
    enabled: true,
    soundEnabled: true,
    volume: 60,
    doneSound: 'chime',
    questionSound: 'triple',
    onlyWhenHidden: false
  });
});
