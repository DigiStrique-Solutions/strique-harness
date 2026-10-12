import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as plugin from '../lib/index.js'

const until = async predicate => {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('Lifecycle condition did not settle')
}

test('Cordis dependency arrival, withdrawal, restoration, repeated disposal and registry refresh', async t => {
  const root = await mkdtemp(join(tmpdir(), 'skills-lifecycle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  const registry = ctx.plugin(SkillRegistry)
  await registry.await()
  const routes = new Map()
  const connection = ctx.provide('connection', { requestRejection: () => undefined })
  const workspace = ctx.provide('workspaceRegistry', { list: () => [] })
  const server = { register(route) { assert.equal(routes.has(route.path), false); routes.set(route.path, route); return () => routes.delete(route.path) } }
  let provideServer
  const storageDir = join(root, 'storage')
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'SKILL.md'), '---\nname: alpha\ndescription: Lifecycle fixture\n---\nRead this fixture.\n')
  const external = new plugin.SkillManager({ workspaceRegistry: { list: () => [] } }, { storageDir })
  await external.install(source)
  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      const fiber = ctx.plugin(plugin, { storageDir })
      await new Promise(resolve => setTimeout(resolve, 20))
      assert.equal(routes.size, 0, 'Missing webServer must leave plugin pending')
      provideServer = ctx.provide('webServer', server)
      await fiber.await()
      assert.equal(routes.size, 1)
      await external.setEnabled('alpha', 'global', undefined, true)
      await until(async () => (await ctx.skills.list()).some(skill => skill.name === 'alpha'))
      assert.match((await ctx.skills.get('alpha')).content, /Read this fixture/)
      await external.setModelInvocable('alpha', false)
      await until(async () => (await ctx.skills.list()).find(skill => skill.name === 'alpha')?.invocation.modelInvocable === false)
      await provideServer()
      await until(() => routes.size === 0)
      assert.deepEqual(await ctx.skills.list(), [])
      provideServer = ctx.provide('webServer', server)
      await fiber.await()
      await until(() => routes.size === 1)
      await fiber.dispose()
      assert.equal(routes.size, 0)
      assert.deepEqual(await ctx.skills.list(), [])
      await provideServer()
      provideServer = undefined
      await external.setModelInvocable('alpha', true)
      await external.setEnabled('alpha', 'global', undefined, false)
    }
  } finally {
    await external.dispose()
    if (provideServer) await provideServer()
    await workspace(); await connection(); await registry.dispose()
  }
})
