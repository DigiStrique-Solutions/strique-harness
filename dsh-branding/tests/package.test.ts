import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'

const root = new URL('../', import.meta.url)

describe('package contract', () => {
  it('is admitted by the Harness runtime used for verification without an exemption', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
    expect(evaluatePluginCompatibility(manifest)).toBeUndefined()
  })

  it('declares one web Client and stable branding and persona Loader rows', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
    expect(manifest.name).toBe('@strique/dsh-branding')
    expect(manifest.version).toBe('0.1.12')
    expect(manifest.engines.node).toBe('^22.19.0 || >=24.0.0')
    expect(manifest.packageManager).toBe('pnpm@11.7.0')
    expect(manifest.dsh).toEqual({
      bundle: { patch: './cordis.patch.yml' },
      client: {
        inject: [
          '@deepseek-ai/dsh-client-ui-renderer',
          '@deepseek-ai/dsh-client-ui-conversation',
          '@deepseek-ai/dsh-client-ui-sidebar',
        ],
        platform: 'web',
      },
    })
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.exports).toHaveProperty('./package.json')
    expect(manifest.peerDependenciesMeta).toEqual({
      '@deepseek-ai/cordis': { optional: true },
      '@deepseek-ai/dsh-client-ui-renderer': { optional: true },
      '@deepseek-ai/dsh-client-ui-conversation': { optional: true },
      '@deepseek-ai/dsh-client-ui-sidebar': { optional: true },
      '@deepseek-ai/dsh-host-webserver': { optional: true },
      '@deepseek-ai/dsh-system-prompt': { optional: true },
      '@deepseek-ai/dsh-agent': { optional: true },
      react: { optional: true },
      'react-dom': { optional: true },
    })

    expect(await readFile(new URL('cordis.patch.yml', root), 'utf8')).toBe([
      '- insert:',
      '    - id: strique-branding',
      '      name: "@strique/dsh-branding"',
      '    - id: strique-persona',
      '      name: "@strique/dsh-branding/persona"',
      '',
    ].join('\n'))
  })

  it('vendors distinct official vector ink variants without raster artwork', async () => {
    const light = await readFile(new URL('../assets/strique-logo-light.svg', import.meta.url))
    expect(createHash('sha256').update(light).digest('hex')).toBe('995d9bb394b86ff0d0fd10c79758bed7c406282adcbf893d3e2134f4f838522d')
    const dark = await readFile(new URL('../assets/strique-logo-dark.svg', import.meta.url))
    expect(createHash('sha256').update(dark).digest('hex')).toBe('d03ca5dc28abd73b9270df27d502cfe4270d9f2608f5570b71bb5741c865a0af')
    expect(light.toString()).toContain('fill="#111111"')
    expect(dark.toString()).toContain('fill="white"')
    expect(light.toString() + dark.toString()).not.toMatch(/<image|filter|base64/iu)
  })

  it('vendors the exact existing Strique icon artwork', async () => {
    const vendored = await readFile(new URL('assets/strique-icon.svg', root))
    expect(createHash('sha256').update(vendored).digest('hex'))
      .toBe('34d90b60ab0146c62fbb9339a17e64d063c31480321d03cc204352077924571c')
    expect(vendored.toString()).toContain('viewBox="0 0 48 78"')
    expect(vendored.toString().match(/<path /gu)).toHaveLength(4)
    expect(vendored.toString()).not.toMatch(/filter|style|currentColor/iu)

    const provenance = await readFile(new URL('assets/PROVENANCE.md', root), 'utf8')
    expect(provenance).toContain('Strique Brand Stuff/logos-variation/svg/favicon.svg')
    expect(provenance).not.toContain('/Users/')
    expect(provenance).toContain('34d90b60ab0146c62fbb9339a17e64d063c31480321d03cc204352077924571c')
    expect(provenance).toContain('Strique Brand Stuff/DESIGN-v2.md`, lines 380-386')
  })
})
