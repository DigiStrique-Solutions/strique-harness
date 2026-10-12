import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createStriqueHeroBrandMark, StriqueBrandMark, StriqueBrandName } from './Brand.js'
import { presentStriqueDocumentTitle } from './DocumentTitle.js'
import { presentStriqueRunningMark } from './RunningMark.js'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  const StriqueHeroBrandMark = createStriqueHeroBrandMark()
  ctx.effect(presentStriqueDocumentTitle, 'strique-branding: document title')
  ctx.effect(presentStriqueRunningMark, 'strique-branding: running mark')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: -10 }, StriqueBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name', priority: -10 }, StriqueBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -10 }, StriqueHeroBrandMark)
      })))
}
