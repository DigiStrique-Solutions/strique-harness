import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import WebServer from '@deepseek-ai/dsh-host-webserver'

const root = fileURLToPath(new URL('../', import.meta.url))
const workspaceRequire = createRequire(import.meta.url)
const evalHome = process.env.STRIQUE_EVAL_HOME
if (!evalHome) throw new Error('Set STRIQUE_EVAL_HOME to the temporary DSH_HOME used for CLI installation')
const profile = resolve(evalHome, 'profiles/eval')
const { default: ClientModules } = await import('@deepseek-ai/dsh-client-modules')
const { default: Loader } = await import('@deepseek-ai/cordis-plugin-loader')
const { parse } = await import('yaml')
const fixtureRequire = createRequire(resolve(profile, 'package.json'))
// Supply the runtime's built optional peer, independently of the plugin checkout.
await mkdir(resolve(profile, 'node_modules/@deepseek-ai'), { recursive: true })
try { await symlink(resolve(workspaceRequire.resolve('@deepseek-ai/dsh-system-prompt/package.json'), '..'), resolve(profile, 'node_modules/@deepseek-ai/dsh-system-prompt'), 'dir') } catch (error) { if (error.code !== 'EEXIST') throw error }
const manifest = JSON.parse(await readFile(resolve(profile, 'package.json'), 'utf8'))
assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@strique/dsh-branding'])
const installed = fixtureRequire.resolve('@strique/dsh-branding/package.json')
assert(!installed.startsWith(root), 'Must test the extracted tarball, not the plugin workspace')
const installedRoot = resolve(installed, '..')
const installedManifest = JSON.parse(await readFile(installed, 'utf8'))
assert.equal(installedManifest.version, '0.1.12')
assert.equal(await readFile(resolve(installedRoot, 'prompts/strique.md'), 'utf8'), await readFile(resolve(root, 'prompts/strique.md'), 'utf8'))
const rows = parse(await readFile(resolve(installedRoot, 'cordis.patch.yml'), 'utf8'))[0].insert
await writeFile(resolve(profile, 'cordis.yml'), JSON.stringify(rows, null, 2))
const ctx = new Context()
try {
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: 'Original coding persona' } })
  const driver = await mountAgentLoopTestHarness(ctx)
  const agent = await driver.create(SessionId('packed-persona'))
  const before = await ctx.systemPrompt.assemble(assembleContextFor(agent))
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  ctx.baseUrl = pathToFileURL(resolve(profile, 'cordis.yml')).href
  await ctx.plugin(Loader)
  ctx.loader.internal = { version: 'v2', import: async name => import(pathToFileURL(fixtureRequire.resolve(name)).href) }
  for (let cycle = 0; cycle < 2; cycle++) {
    await ctx.loader.root.update(parse(await readFile(resolve(profile, 'cordis.yml'), 'utf8')))
    await ctx.loader.await()
    const states = [...ctx.loader.entries()].map(entry => ({ id: entry.options.id, state: entry.fiber?.state }))
    assert.deepEqual(states, [{ id: 'strique-branding', state: 2 }, { id: 'strique-persona', state: 2 }])
    class FixtureClientModules extends ClientModules { static inject = ['loader', 'webServer'] }
    const clientFiber = await ctx.plugin(FixtureClientModules)
    assert.deepEqual(ctx.clientModules.graph().entries.map(entry => entry.id), ['@strique/dsh-branding'])
    await clientFiber.dispose()
    const after = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    assert(renderPrompt(after).startsWith((await readFile(resolve(installedRoot, 'prompts/strique.md'), 'utf8')).trim()))
    assert(!after.sections.some(section => section.name === 'harness:identity' || section.name === 'harness:source'))
    assert(!renderPrompt(after).includes('Original coding persona'))
    assert.deepEqual(after.tools, before.tools)
    const favicon = await fetch(`http://127.0.0.1:${ctx.webServer.port}/favicon.svg`)
    assert.equal(favicon.status, 200)
    assert.equal(await favicon.text(), await readFile(resolve(installedRoot, 'assets/strique-favicon.svg'), 'utf8'))
    await ctx.loader.root.update([])
    await ctx.loader.await()
    assert.equal([...ctx.loader.entries()].length, 0)
    assert.deepEqual(await ctx.systemPrompt.assemble(assembleContextFor(agent)), before)
    assert.equal((await fetch(`http://127.0.0.1:${ctx.webServer.port}/favicon.svg`)).status, 404)
  }
  console.log('Packed Host exports and prompt asset loaded through real Loader; both rows ACTIVE; 2 removal/reload cycles restored the original prompt and routes.')
} finally { await ctx.fiber.dispose() }
