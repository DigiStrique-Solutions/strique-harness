import { readFile, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

const root = new URL('../', import.meta.url)
const expectedPatch = [
  '- insert:',
  '    - id: strique-branding',
  '      name: "@strique/dsh-branding"',
  '    - id: strique-persona',
  '      name: "@strique/dsh-branding/persona"',
  '',
].join('\n')
const allowedRequires = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-renderer/client',
  '@deepseek-ai/dsh-client-ui-slots',
])

function assert(condition, message) {
  if (!condition) throw new Error(`package verification failed: ${message}`)
}

const [manifestText, patch, provenance, favicon, bundle, sourceMap, files, bundleStats] = await Promise.all([
  readFile(new URL('package.json', root), 'utf8'),
  readFile(new URL('cordis.patch.yml', root), 'utf8'),
  readFile(new URL('assets/PROVENANCE.md', root), 'utf8'),
  readFile(new URL('assets/strique-icon.svg', root)),
  readFile(new URL('lib/client.js', root), 'utf8'),
  readFile(new URL('lib/client.js.map', root), 'utf8'),
  readdir(new URL('lib/', root)),
  stat(new URL('lib/client.js', root)),
])
const manifest = JSON.parse(manifestText)

assert(manifest.name === '@strique/dsh-branding', 'package name is incorrect')
assert(manifest.packageManager === 'pnpm@11.28.5', 'pnpm pin is incorrect')
assert(manifest.engines?.node === '^22.19.0 || >=24.0.0', 'Node engine range is incorrect')
assert(manifest.exports?.['./client']?.default === './lib/client.js', './client export is incorrect')
assert(manifest.exports?.['./package.json'] === './package.json', './package.json export is missing')
assert(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'bundle patch metadata is incorrect')
assert(manifest.dsh?.client?.platform === 'web', 'Client platform is not web')
for (const peer of [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-agent',
  'react',
  'react-dom',
]) {
  assert(manifest.peerDependenciesMeta?.[peer]?.optional === true, `${peer} must remain an optional peer`)
}
assert(patch.replace(/\r\n/g, '\n') === expectedPatch, 'bundle patch must contain the stable branding and persona rows')
assert(!provenance.includes('/Users/'), 'asset provenance must not disclose a machine-local home path')
assert(createHash('sha256').update(favicon).digest('hex') === '34d90b60ab0146c62fbb9339a17e64d063c31480321d03cc204352077924571c', 'favicon artwork differs from the selected Strique source asset')

const loader = /window\.__ModuleLoader__\.load\(\{\s*id:\s*(["'`])@strique\/dsh-branding\1,\s*factory:\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*\)|([A-Za-z_$][\w$]*))\s*=>\s*\{/u.exec(bundle)
assert(loader !== null, 'Client loader registration is missing or has the wrong package id')
assert(/[A-Za-z_$][\w$]*\.exports\s*\}\s*\}\);\s*(?:\/\/# sourceMappingURL=client\.js\.map)?\s*$/u.test(bundle), 'Client loader factory footer is missing')
assert(files.includes('client.d.ts'), 'Client declaration entry is missing')
assert(files.includes('index.d.ts'), 'Host declaration entry is missing')
assert(!files.some(file => file.endsWith('.js') && !['client.js', 'index.js', 'persona.js'].includes(file)), 'unexpected JavaScript chunks were emitted')

const requireName = loader?.[2] ?? loader?.[3] ?? 'require'
const escapedRequireName = requireName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const requirePattern = new RegExp(`\\b${escapedRequireName}\\((["'\`])([^"'\`]+)\\1\\)`, 'gu')
const requires = [...bundle.matchAll(requirePattern)].map(match => match[2])
const unsupported = [...new Set(requires.filter(specifier => specifier === undefined || !allowedRequires.has(specifier)))]
assert(unsupported.length === 0, `unsupported Client loader require calls: ${unsupported.join(', ')}`)

for (const forbidden of ['node:', 'child_process', 'window.require', '/Users/']) {
  assert(!bundle.includes(forbidden) && !sourceMap.includes(forbidden), `forbidden Client content found: ${forbidden}`)
}
const parsedMap = JSON.parse(sourceMap)
assert(Array.isArray(parsedMap.sources) && parsedMap.sources.length > 0, 'Client source map has no sources')
assert(Array.isArray(parsedMap.sourcesContent) && parsedMap.sourcesContent.length === parsedMap.sources.length, 'Client source map has incomplete sourcesContent')

const host = await import(new URL('lib/index.js', root))
assert(typeof host.apply === 'function', 'Host apply export is missing')
assert(JSON.stringify(host.inject) === JSON.stringify(['webServer']), 'Host inject export is incorrect')

const persona = await import(new URL('lib/persona.js', root))
assert(typeof persona.apply === 'function', 'Persona apply export is missing')
assert(JSON.stringify(persona.inject) === JSON.stringify(['systemPrompt']), 'Persona inject export is incorrect')
assert(files.includes('persona.d.ts'), 'Persona declaration entry is missing')
assert(manifest.exports?.['./persona']?.default === './lib/persona.js', './persona export is incorrect')
assert(manifest.files.includes('prompts/**'), 'Persona prompt asset is not packaged')
assert((await readFile(new URL('prompts/strique.md', root), 'utf8')).replace(/\r\n/g, '\n').startsWith('# Strique\n'), 'Persona asset is missing')

const gzipBytes = gzipSync(bundle).byteLength
assert(bundleStats.size <= 30_000, `Client bundle is ${bundleStats.size} bytes, over the 30 KB limit`)
assert(gzipBytes <= 10_000, `Client gzip bundle is ${gzipBytes} bytes, over the 10 KB limit`)
console.log(`Verified @strique/dsh-branding: ${bundleStats.size} bytes raw, ${gzipBytes} bytes gzip, requires [${[...new Set(requires)].sort().join(', ')}]`)
