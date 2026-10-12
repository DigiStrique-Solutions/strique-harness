import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { apply, inject, WEB_MANIFEST } from '../src/index.js'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

async function request(port: number, path: string, method = 'GET') {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, { method })
  return {
    allow: response.headers.get('allow'),
    body: await response.text(),
    status: response.status,
    type: response.headers.get('content-type'),
  }
}

async function bench() {
  context = new Context()
  await context.plugin(WebServer, { host: '127.0.0.1', port: 0 }).await()
  const fiber = context.plugin({ name: 'strique-branding-test', inject: [...inject], apply })
  await fiber.await()
  return { context, fiber, port: context.webServer.port }
}

describe('Strique branding Host routes', () => {
  it('serves the exact Strique SVG and Strique install manifest from exact paths', async () => {
    const subject = await bench()

    for (const [path, asset] of [['/favicon.svg', 'strique-favicon.svg'], ['/favicon-dark.svg', 'strique-favicon.svg'], ['/strique-branding/mark.svg', 'strique-icon.svg'], ['/strique-branding/logo-light.svg', 'strique-logo-light.svg'], ['/strique-branding/logo-dark.svg', 'strique-logo-dark.svg']] as const) {
      expect(await request(subject.port, path)).toEqual({
        allow: null,
        body: await readFile(new URL(`../assets/${asset}`, import.meta.url), 'utf8'),
        status: 200,
        type: 'image/svg+xml',
      })
    }

    const manifest = await request(subject.port, '/manifest.webmanifest')
    expect(manifest).toMatchObject({
      allow: null,
      status: 200,
      type: 'application/manifest+json',
    })
    expect(JSON.parse(manifest.body)).toEqual(WEB_MANIFEST)
    expect(WEB_MANIFEST).toEqual({
      id: '/',
      name: 'Strique',
      short_name: 'Strique',
      start_url: '/',
      scope: '/',
      display: 'fullscreen',
      icons: [{
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      }],
    })
  })

  it('supports HEAD, rejects mutations, and removes all routes on disposal', async () => {
    const subject = await bench()
    const paths = [
      ['/favicon.svg', 'image/svg+xml'],
      ['/favicon-dark.svg', 'image/svg+xml'],
      ['/strique-branding/mark.svg', 'image/svg+xml'],
      ['/strique-branding/logo-light.svg', 'image/svg+xml'],
      ['/strique-branding/logo-dark.svg', 'image/svg+xml'],
      ['/manifest.webmanifest', 'application/manifest+json'],
    ] as const

    for (const [path, type] of paths) {
      expect(await request(subject.port, path, 'HEAD')).toEqual({
        allow: null,
        body: '',
        status: 200,
        type,
      })
      expect(await request(subject.port, path, 'POST')).toEqual({
        allow: 'GET, HEAD',
        body: '',
        status: 405,
        type: null,
      })
    }

    await subject.fiber.dispose()
    for (const [path] of paths) {
      expect(await request(subject.port, path)).toEqual({
        allow: null,
        body: '',
        status: 404,
        type: null,
      })
    }
  })

  it('brands the initial document title and withdraws the transform on disposal', async () => {
    const subject = await bench()
    const upstream = '<html><head><title>Custom Harness</title></head><body></body></html>'

    expect(subject.context.webServer.renderIndex(upstream))
      .toContain('<title data-strique-upstream-title="Custom Harness">Strique</title>')

    const escaped = '<title>Custom "Harness" &amp; Tools</title>'
    expect(subject.context.webServer.renderIndex(escaped))
      .toContain('<title data-strique-upstream-title="Custom &quot;Harness&quot; &amp; Tools">Strique</title>')

    await subject.fiber.dispose()
    expect(subject.context.webServer.renderIndex(upstream)).toContain('<title>Custom Harness</title>')
    expect(subject.context.webServer.renderIndex(upstream)).not.toContain('data-strique-upstream-title')
  })
})
