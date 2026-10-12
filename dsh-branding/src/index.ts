import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'strique-branding'
export const inject = ['webServer']

export const WEB_MANIFEST = {
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
} as const

const FAVICON = readFileSync(new URL('../assets/strique-icon.svg', import.meta.url), 'utf8')
const FAVICON_SQUARE = readFileSync(new URL('../assets/strique-favicon.svg', import.meta.url), 'utf8')
const LOGO_LIGHT = readFileSync(new URL('../assets/strique-logo-light.svg', import.meta.url), 'utf8')
const LOGO_DARK = readFileSync(new URL('../assets/strique-logo-dark.svg', import.meta.url), 'utf8')
const MANIFEST = `${JSON.stringify(WEB_MANIFEST, null, 2)}\n`
const TITLE_TAG = /<title\b[^>]*>([\s\S]*?)<\/title>/iu

function brandIndexTitle(html: string): string {
  return html.replace(TITLE_TAG, (_title, upstreamTitle: string) => {
    const attributeTitle = upstreamTitle.replace(/"/gu, '&quot;')
    return `<title data-strique-upstream-title="${attributeTitle}">Strique</title>`
  })
}

interface StaticResponse {
  body: string
  contentType: string
}

function serveStatic(req: IncomingMessage, res: ServerResponse, response: StaticResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  res.writeHead(200, {
    'content-length': Buffer.byteLength(response.body),
    'content-type': response.contentType,
  })
  res.end(req.method === 'HEAD' ? undefined : response.body)
}

export function apply(ctx: Context): void {
  ctx.effect(function* () {
    yield ctx.webServer.tapIndex(brandIndexTitle)
    // Harness selects a separate URL when the browser prefers dark mode.
    for (const path of ['/favicon.svg', '/favicon-dark.svg']) {
      yield ctx.webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => { serveStatic(req, res, { body: FAVICON_SQUARE, contentType: 'image/svg+xml' }) },
      })
    }
    yield ctx.webServer.register({
      kind: 'exact',
      path: '/strique-branding/mark.svg',
      handler: (req, res) => { serveStatic(req, res, { body: FAVICON, contentType: 'image/svg+xml' }) },
    })
    for (const [path, body] of [
      ['/strique-branding/logo-light.svg', LOGO_LIGHT],
      ['/strique-branding/logo-dark.svg', LOGO_DARK],
    ] as const) {
      yield ctx.webServer.register({
        kind: 'exact',
        path,
        handler: (req, res) => { serveStatic(req, res, { body, contentType: 'image/svg+xml' }) },
      })
    }
    yield ctx.webServer.register({
      kind: 'exact',
      path: '/manifest.webmanifest',
      handler: (req, res) => { serveStatic(req, res, { body: MANIFEST, contentType: 'application/manifest+json' }) },
    })
  }, 'strique-branding: web metadata and title')
}
