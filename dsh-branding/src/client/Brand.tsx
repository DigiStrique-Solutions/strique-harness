import { useLayoutEffect, useRef, type Ref } from 'react'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  SidebarBrandMarkOwnerProps,
} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  createStriqueHeroHeadlineSelector,
  presentStriqueHeroHeadline,
} from './HeroHeadline.js'

type StriqueBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

function BrandMarkImage({ size, className, imageRef }: StriqueBrandMarkProps & {
  imageRef?: Ref<HTMLImageElement>
}) {
  return (
    <img
      ref={imageRef}
      alt=""
      aria-hidden="true"
      className={className}
      data-strique-brand-mark=""
      height={size}
      src="/strique-branding/mark.svg"
      style={{ animation: 'none', objectFit: 'contain' }}
      width={size * 48 / 78}
    />
  )
}

export function StriqueBrandMark(props: StriqueBrandMarkProps) {
  return <BrandMarkImage {...props} />
}

export function createStriqueHeroBrandMark() {
  const selectHeadline = createStriqueHeroHeadlineSelector()

  return function StriqueHeroBrandMark(props: HeroBrandMarkOwnerProps) {
    const imageRef = useRef<HTMLImageElement>(null)

    useLayoutEffect(
      () => presentStriqueHeroHeadline(imageRef.current!, selectHeadline),
      [selectHeadline],
    )

    return <BrandMarkImage {...props} imageRef={imageRef} />
  }
}

// The Harness owns separate mark/name slots. Frame only the lettering from
// the official lockup, retaining its paths and the supplied theme colors.
export function StriqueBrandName() {
  return (
    <span data-strique-brand-name="" role="img" aria-label="Strique" style={{ display: 'inline-flex', flexShrink: 0 }}>
      <style>{`
        [data-strique-wordmark="light"] { display: block; }
        [data-strique-wordmark="dark"] { display: none; }
        [data-ds-dark-theme] [data-strique-wordmark="light"] { display: none; }
        [data-ds-dark-theme] [data-strique-wordmark="dark"] { display: block; }
      `}</style>
      {(['light', 'dark'] as const).map(theme => (
        <svg key={theme} data-strique-wordmark={theme} width={218 * 24 / 70} height={24}
          viewBox="74 13 218 70" aria-hidden="true" focusable="false">
          <image href={`/strique-branding/logo-${theme}.svg`} width={290} height={81} />
        </svg>
      ))}
    </span>
  )
}
