// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import type { SlotRegistry as PublishedSlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'

import type { ComponentType } from 'react'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { apply, inject } from '../src/client/index.js'
import { StriqueBrandMark, StriqueBrandName } from '../src/client/Brand.js'
import { createStriqueHeroHeadlineSelector } from '../src/client/HeroHeadline.js'

const require = createRequire(import.meta.url)
const { SlotRegistry } = runInNewContext(
  readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8'),
  { window: { __ModuleLoader__: { load: ({ factory }: { factory: (require: NodeRequire) => unknown }) => factory(require) } } },
) as { SlotRegistry: typeof PublishedSlotRegistry }
type SlotRegistry = PublishedSlotRegistry

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

const STRIQUE_HERO_HEADLINES = [
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

const contexts: Context[] = []

afterEach(async () => {
  cleanup()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  document.querySelectorAll('[data-strique-test-headline-fixture]').forEach(node => node.remove())
  document.title = ''
  document.querySelector('title')?.removeAttribute('data-strique-upstream-title')
})

async function flushTitleMutations(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function bench(declare = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as unknown as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

function fallbackApply(ctx: Context): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: 0 }, () => 'fallback mark')
        yield ctx.slots.register({ name: 'sidebar.brand.name', priority: 0 }, () => 'fallback name')
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: 0 }, () => 'fallback hero')
      })))
}

async function mountBranding(ctx: Context) {
  const fiber = ctx.plugin({ name: 'strique-branding-client-test', inject: [...inject], apply })
  await fiber.await()
  return fiber
}

function renderHeroHeadline(HeroMark: ComponentType<HeroBrandMarkOwnerProps>, upstream = 'Into the Unknown') {
  const fixture = document.createElement('div')
  fixture.setAttribute('data-strique-test-headline-fixture', '')
  const markOwner = document.createElement('span')
  const markSlot = document.createElement('div')
  markSlot.setAttribute('data-slot', 'conversation.hero.brand.mark')
  markOwner.append(markSlot)
  const titleGroup = document.createElement('span')
  const headline = document.createElement('span')
  headline.textContent = upstream
  const previewBadge = document.createElement('span')
  previewBadge.textContent = 'Preview'
  titleGroup.append(headline, previewBadge)
  fixture.append(markOwner, titleGroup)
  document.body.append(fixture)
  const view = render(<HeroMark size={34} />, { container: markSlot })
  return { fixture, headline, previewBadge, view }
}

describe('Strique branding Client occupants', () => {
  it('declares only the Slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('owns the running-mark style for exactly its activation lifetime', async () => {
    const subject = await bench()
    const fiber = await mountBranding(subject.ctx)
    const styles = document.querySelectorAll('[data-strique-running-mark]')
    expect(styles).toHaveLength(1)
    expect(styles[0]?.textContent).toContain('[data-chat-running]')
    expect(styles[0]?.textContent).toContain('/strique-branding/mark.svg')
    expect(styles[0]?.textContent).toContain('prefers-reduced-motion: no-preference')
    await fiber.dispose()
    expect(document.querySelectorAll('[data-strique-running-mark]')).toHaveLength(0)
    const remounted = await mountBranding(subject.ctx)
    expect(document.querySelectorAll('[data-strique-running-mark]')).toHaveLength(1)
    await remounted.dispose()
  })

  it('activates whether declarations arrive before or after the plugin and tears down cleanly', async () => {
    const before = await bench()
    const beforeFiber = await mountBranding(before.ctx)
    for (const hole of HOLES) {
      expect(before.slots.entries(hole)).toHaveLength(1)
      expect(before.slots.entries(hole)[0]?.options.priority).toBe(-10)
    }

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)
    await beforeFiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    const afterFiber = await mountBranding(after.ctx)
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
    await afterFiber.dispose()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
  })

  it('shadows priority-zero branding while mounted and restores it after disposal', async () => {
    const subject = await bench()
    const fallbackFiber = subject.ctx.plugin({ name: 'official-fallback-test', inject: ['slots'], apply: fallbackApply })
    await fallbackFiber.await()
    const fallbackWinners = Object.fromEntries(HOLES.map(hole => [hole, subject.slots.entriesOfSlot(hole)[0]?.component]))

    const brandingFiber = await mountBranding(subject.ctx)
    for (const hole of HOLES) {
      expect(subject.slots.entries(hole).map(entry => entry.options.priority)).toEqual([-10, 0])
      expect(subject.slots.entriesOfSlot(hole)).toHaveLength(1)
      expect(subject.slots.entriesOfSlot(hole)[0]?.component).not.toBe(fallbackWinners[hole])
    }

    await brandingFiber.dispose()
    for (const hole of HOLES) {
      expect(subject.slots.entries(hole).map(entry => entry.options.priority)).toEqual([0])
      expect(subject.slots.entriesOfSlot(hole)[0]?.component).toBe(fallbackWinners[hole])
    }
  })

  it('replaces the blank-session headline and restores the Harness copy on unmount', async () => {
    const subject = await bench()
    const brandingFiber = await mountBranding(subject.ctx)
    const HeroMark = subject.slots.entriesOfSlot('conversation.hero.brand.mark')[0]
      ?.component as ComponentType<HeroBrandMarkOwnerProps>
    const fixture = renderHeroHeadline(HeroMark)

    expect(STRIQUE_HERO_HEADLINES).toContain(fixture.headline.textContent)
    expect(fixture.headline.getAttribute('data-strique-hero-headline')).toBe('')
    expect(fixture.previewBadge.hidden).toBe(true)

    fixture.view.unmount()
    expect(fixture.headline.textContent).toBe('Into the Unknown')
    expect(fixture.headline.hasAttribute('data-strique-hero-headline')).toBe(false)
    expect(fixture.previewBadge.hidden).toBe(false)
    fixture.fixture.remove()
    await brandingFiber.dispose()
  })

  it('keeps the headline projection stable when the hero mark rerenders', async () => {
    const subject = await bench()
    const brandingFiber = await mountBranding(subject.ctx)
    const HeroMark = subject.slots.entriesOfSlot('conversation.hero.brand.mark')[0]
      ?.component as ComponentType<HeroBrandMarkOwnerProps>
    const fixture = renderHeroHeadline(HeroMark)
    const selected = fixture.headline.textContent
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver(records => mutations.push(...records))
    observer.observe(fixture.headline, { childList: true, characterData: true, subtree: true })

    fixture.view.rerender(<HeroMark size={34} className="rerendered" />)
    await flushTitleMutations()

    expect(fixture.headline.textContent).toBe(selected)
    expect(mutations).toHaveLength(0)

    observer.disconnect()
    fixture.view.unmount()
    fixture.fixture.remove()
    await brandingFiber.dispose()
  })

  it('randomly selects once for each blank-hero mount', () => {
    const samples = STRIQUE_HERO_HEADLINES.map((_, index) =>
      (index + 0.5) / STRIQUE_HERO_HEADLINES.length)
    let cursor = 0
    const selectHeadline = createStriqueHeroHeadlineSelector(() => samples[cursor++]!)

    for (const expected of STRIQUE_HERO_HEADLINES) {
      const headline = document.createElement('span')
      expect(selectHeadline(headline)).toBe(expected)
      expect(selectHeadline(headline)).toBe(expected)
    }

    expect(cursor).toBe(STRIQUE_HERO_HEADLINES.length)
  })

  it('reprojects the English Harness headline without taking ownership of other copy', async () => {
    const subject = await bench()
    const brandingFiber = await mountBranding(subject.ctx)
    const HeroMark = subject.slots.entriesOfSlot('conversation.hero.brand.mark')[0]
      ?.component as ComponentType<HeroBrandMarkOwnerProps>
    const fixture = renderHeroHeadline(HeroMark)
    const selected = fixture.headline.textContent

    fixture.headline.textContent = '探索未至之境'
    await flushTitleMutations()
    expect(fixture.headline.textContent).toBe('探索未至之境')
    expect(fixture.headline.hasAttribute('data-strique-hero-headline')).toBe(false)

    fixture.headline.textContent = 'Into the Unknown'
    await flushTitleMutations()
    expect(fixture.headline.textContent).toBe(selected)
    expect(fixture.headline.getAttribute('data-strique-hero-headline')).toBe('')

    fixture.headline.textContent = 'Newer headline owner'
    await flushTitleMutations()
    fixture.view.unmount()
    expect(fixture.headline.textContent).toBe('Newer headline owner')
    expect(fixture.headline.hasAttribute('data-strique-hero-headline')).toBe(false)
    fixture.fixture.remove()
    await brandingFiber.dispose()
  })

  it('leaves localized or unrelated text untouched when the expected hero seam is absent', async () => {
    const subject = await bench()
    const brandingFiber = await mountBranding(subject.ctx)
    const HeroMark = subject.slots.entriesOfSlot('conversation.hero.brand.mark')[0]
      ?.component as ComponentType<HeroBrandMarkOwnerProps>
    const localized = renderHeroHeadline(HeroMark, '探索未至之境')

    expect(localized.headline.textContent).toBe('探索未至之境')
    expect(localized.headline.hasAttribute('data-strique-hero-headline')).toBe(false)
    localized.view.rerender(<HeroMark size={34} className="rerendered" />)
    expect(localized.headline.textContent).toBe('探索未至之境')
    localized.view.unmount()
    localized.fixture.remove()

    const unrelated = document.createElement('span')
    unrelated.textContent = 'Into the Unknown'
    document.body.append(unrelated)
    const detached = render(<HeroMark size={34} />)
    expect(unrelated.textContent).toBe('Into the Unknown')
    detached.unmount()
    unrelated.remove()
    await brandingFiber.dispose()
  })

  it('brands product and session titles, then restores the upstream suffix on disposal', async () => {
    document.title = 'DSH Local Build'
    const subject = await bench()
    const brandingFiber = await mountBranding(subject.ctx)
    expect(document.title).toBe('Strique')

    document.title = 'Quarterly review — DSH Local Build'
    await flushTitleMutations()
    expect(document.title).toBe('Quarterly review — Strique')

    await brandingFiber.dispose()
    expect(document.title).toBe('Quarterly review — DSH Local Build')

    document.title = 'After disposal — DSH Local Build'
    await flushTitleMutations()
    expect(document.title).toBe('After disposal — DSH Local Build')

    const remountedFiber = await mountBranding(subject.ctx)
    expect(document.title).toBe('After disposal — Strique')
    await remountedFiber.dispose()
    expect(document.title).toBe('After disposal — DSH Local Build')
  })

  it('does not overwrite a newer title owner during disposal', async () => {
    document.title = 'DSH Local Build'
    const subject = await bench()
    const brandingFiber = await mountBranding(subject.ctx)
    expect(document.title).toBe('Strique')

    document.title = 'External title owner'
    await brandingFiber.dispose()
    expect(document.title).toBe('External title owner')
  })

  it('adopts the Host-branded initial title without a redundant document write', async () => {
    document.title = 'Strique'
    document.querySelector('title')?.setAttribute('data-strique-upstream-title', 'DSH Local Build')
    const subject = await bench()
    const brandingFiber = await mountBranding(subject.ctx)
    expect(document.title).toBe('Strique')

    await brandingFiber.dispose()
    expect(document.title).toBe('DSH Local Build')
    expect(document.querySelector('title')?.hasAttribute('data-strique-upstream-title')).toBe(false)
  })

  it('uses the build title recorded by the Host instead of assuming the local default', async () => {
    document.title = 'Strique'
    document.querySelector('title')?.setAttribute('data-strique-upstream-title', 'Custom Harness')
    const subject = await bench()
    const brandingFiber = await mountBranding(subject.ctx)

    document.title = 'Custom session — Custom Harness'
    await flushTitleMutations()
    expect(document.title).toBe('Custom session — Strique')

    await brandingFiber.dispose()
    expect(document.title).toBe('Custom session — Custom Harness')
    expect(document.querySelector('title')?.hasAttribute('data-strique-upstream-title')).toBe(false)
  })

  it('loads the unmodified namespaced artwork into a proportional contained footprint', () => {
    const mark = render(<StriqueBrandMark size={34} className="hero-mark" />)
    const image = mark.container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/strique-branding/mark.svg')
    expect(image?.getAttribute('width')).toBe(String(34 * 48 / 78))
    expect(image?.getAttribute('height')).toBe('34')
    expect(image?.getAttribute('class')).toBe('hero-mark')
    expect(image?.getAttribute('data-strique-brand-mark')).toBe('')
    expect(image?.getAttribute('aria-hidden')).toBe('true')
    expect(image?.getAttribute('alt')).toBe('')
    expect(image?.style.animation).toBe('none')
    expect(image?.style.objectFit).toBe('contain')
    expect(image?.style.filter).toBe('')

    mark.rerender(<StriqueBrandMark size={24} />)
    expect(mark.container.querySelector('img')?.getAttribute('width')).toBe(String(24 * 48 / 78))
    expect(mark.container.querySelector('img')?.getAttribute('height')).toBe('24')
    mark.unmount()

    const name = render(<StriqueBrandName />)
    expect([...name.container.querySelectorAll('image')].map(image => image.getAttribute('href')))
      .toEqual(['/strique-branding/logo-light.svg', '/strique-branding/logo-dark.svg'])
    expect(name.container.querySelector('svg')?.getAttribute('viewBox')).toBe('74 13 218 70')
    expect(name.container.querySelector('svg')?.getAttribute('height')).toBe('24')
    expect(name.getByRole('img', { name: 'Strique' }).tagName).toBe('SPAN')
    expect(name.getByRole('img', { name: 'Strique' }).getAttribute('data-strique-brand-name')).toBe('')
  })
})
