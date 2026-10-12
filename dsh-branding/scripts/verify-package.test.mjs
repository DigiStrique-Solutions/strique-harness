import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))

function verifyFixture(lineEnding, corruptPatch = false) {
  const parent = path.join(root, 'tmp')
  mkdirSync(parent, { recursive: true })
  const fixture = mkdtempSync(path.join(parent, 'verify-package-'))
  try {
    for (const entry of ['scripts', 'assets', 'lib', 'prompts', 'package.json', 'cordis.patch.yml']) {
      cpSync(path.join(root, entry), path.join(fixture, entry), { recursive: true })
    }
    for (const entry of ['cordis.patch.yml', 'prompts/strique.md']) {
      const file = path.join(fixture, entry)
      let content = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
      if (corruptPatch && entry === 'cordis.patch.yml') content = content.replace('strique-persona', 'wrong-persona')
      writeFileSync(file, content.replace(/\n/g, lineEnding))
    }
    return spawnSync(process.execPath, [path.join(fixture, 'scripts/verify-package.mjs')], { encoding: 'utf8' })
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

for (const [name, ending] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test(`package verifier accepts ${name} patch and persona text`, () => {
    const result = verifyFixture(ending)
    assert.equal(result.status, 0, result.stderr)
  })
}

test('package verifier still rejects changed persona rows with CRLF', () => {
  const result = verifyFixture('\r\n', true)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /bundle patch must contain the stable branding and persona rows/)
})
