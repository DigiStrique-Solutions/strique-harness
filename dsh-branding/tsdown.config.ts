import { defineConfig } from 'tsdown'

const PLUGIN_ID = '@strique/dsh-branding'
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-renderer/client',
  '@deepseek-ai/dsh-client-ui-slots',
])

export default defineConfig([
  {
    name: `${PLUGIN_ID}/host`,
    entry: { index: 'src/index.ts', persona: 'src/persona.ts' },
    format: 'esm',
    platform: 'node',
    target: 'es2023',
    dts: false,
    clean: true,
    outDir: 'lib',
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    sourcemap: false,
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    outDir: 'lib',
    fixedExtension: false,
    sourcemap: true,
    minify: { compress: true, mangle: false },
    hash: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.MODE': JSON.stringify('production'),
      'import.meta.env': JSON.stringify({ MODE: 'production' }),
    },
    deps: {
      neverBundle: specifier => CLIENT_EXTERNALS.has(specifier),
      alwaysBundle: specifier => !CLIENT_EXTERNALS.has(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      codeSplitting: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
