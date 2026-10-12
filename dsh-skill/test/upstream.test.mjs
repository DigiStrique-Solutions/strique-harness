import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { Context } from '@deepseek-ai/cordis'

test('the plugin installs with official Harness packages and no private core extensions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const runtime = JSON.parse(await readFile(new URL('../node_modules/@deepseek-ai/dsh-skill/package.json', import.meta.url), 'utf8'))
  for (const [name, version] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, runtime.version, name)
  }
  for (const group of [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies, manifest.pnpm?.overrides]) {
    for (const [name, version] of Object.entries(group ?? {})) if (name.startsWith('@deepseek-ai/dsh-')) assert.doesNotMatch(version, /file:|link:|git|vendor|repair/)
  }
  const ctx = new Context()
  try {
    await ctx.plugin(SkillRegistry)
    assert.equal(typeof ctx.skills.inspect, 'undefined')
    assert.equal(typeof ctx.skills.registerPolicy, 'undefined')
  } finally { await ctx.fiber.dispose() }
})
