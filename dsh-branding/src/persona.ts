import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'

export const name = 'strique-persona'
export const inject = ['systemPrompt']

const PERSONA = readFileSync(new URL('../prompts/strique.md', import.meta.url), 'utf8').trim()
const WEB_CONTEXT = 'The user is interacting with Strique through a web application. References to this app mean the current Strique interface unless the user identifies another target. The conversation alone does not provide a view of the page.'

export function apply(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const header = context.agent?.session.header
    // An unscoped preview cannot establish whether this is a user-facing agent.
    // Fork lineage alone does not make an ordinary conversation a delegate.
    if (header === undefined || header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) {
      return assembly
    }
    // Product identity replaces Harness development orientation for root chats.
    // Tool contracts, permissions, working context, and complete overrides remain.
    return {
      ...assembly,
      sections: assembly.sections
        .filter(section => section.name !== 'harness:identity' && section.name !== 'harness:source')
        .map(section => {
          if (section.name === PERSONA_PREFIX_SECTION) return { ...section, text: PERSONA }
          if (section.name === 'app:web-surface') return { ...section, text: WEB_CONTEXT }
          return section
        }),
    }
  })
}
