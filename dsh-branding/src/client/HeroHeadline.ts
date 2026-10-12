const HERO_BRAND_SLOT = '[data-slot="conversation.hero.brand.mark"]'
const UPSTREAM_HERO_HEADLINE = 'Into the Unknown'
const STRIQUE_HEADLINE_ATTRIBUTE = 'data-strique-hero-headline'

export const STRIQUE_HERO_HEADLINES = [
  'What would you like to improve today?',
  'Ask and create ads for your brand',
  'Find your next growth opportunity',
  'Analyze, create, and optimize your marketing',
  'From marketing insight to execution',
  'Make every campaign perform better',
  'See what to fix, create, and scale next',
  'What should we work on next?',
  'Plan campaigns. Create ads. Improve performance.',
  'Ask Strique to find your next best move',
] as const

export type SelectHeroHeadline = (headline: HTMLElement) => string

/** Choose a random headline for each mounted hero and keep it stable while mounted. */
export function createStriqueHeroHeadlineSelector(random: () => number = Math.random): SelectHeroHeadline {
  const selections = new WeakMap<HTMLElement, string>()

  return (headline) => {
    const selected = selections.get(headline)
    if (selected !== undefined) return selected
    const next = STRIQUE_HERO_HEADLINES[Math.floor(random() * STRIQUE_HERO_HEADLINES.length)]!
    selections.set(headline, next)
    return next
  }
}

function adjacentHeroCopy(mark: HTMLImageElement): {
  headline: HTMLElement
  previewBadge: HTMLElement | undefined
} | undefined {
  const candidate = mark.closest(HERO_BRAND_SLOT)?.parentElement?.nextElementSibling
  if (!(candidate instanceof HTMLElement)) return undefined
  const nestedHeadline = candidate.firstElementChild
  if (!(nestedHeadline instanceof HTMLElement)) return { headline: candidate, previewBadge: undefined }
  const previewBadge = nestedHeadline.nextElementSibling
  return {
    headline: nestedHeadline,
    previewBadge: previewBadge instanceof HTMLElement ? previewBadge : undefined,
  }
}

/**
 * Replace the exact English Harness hero headline adjacent to the branded mark.
 * The pinned Harness release exposes no Slot or locale override for this text.
 */
export function presentStriqueHeroHeadline(
  mark: HTMLImageElement,
  selectHeadline: SelectHeroHeadline,
): (() => void) | undefined {
  const heroCopy = adjacentHeroCopy(mark)
  if (heroCopy === undefined) return undefined
  const { headline, previewBadge } = heroCopy
  const previewWasHidden = previewBadge?.hidden
  if (previewBadge !== undefined) previewBadge.hidden = true
  let projected: string | undefined

  const reconcile = () => {
    const current = headline.textContent
    if (current === projected) return
    if (current !== UPSTREAM_HERO_HEADLINE) {
      projected = undefined
      headline.removeAttribute(STRIQUE_HEADLINE_ATTRIBUTE)
      return
    }
    projected = selectHeadline(headline)
    headline.setAttribute(STRIQUE_HEADLINE_ATTRIBUTE, '')
    headline.textContent = projected
  }

  reconcile()
  const observer = new MutationObserver(reconcile)
  observer.observe(headline, { childList: true, characterData: true, subtree: true })

  return () => {
    observer.disconnect()
    if (projected !== undefined && headline.textContent === projected) {
      headline.textContent = UPSTREAM_HERO_HEADLINE
    }
    if (previewBadge !== undefined && previewWasHidden !== undefined) {
      previewBadge.hidden = previewWasHidden
    }
    headline.removeAttribute(STRIQUE_HEADLINE_ATTRIBUTE)
  }
}
