const STRIQUE_PRODUCT_TITLE = 'Strique'
const TITLE_SEPARATOR = ' — '
const UPSTREAM_TITLE_ATTRIBUTE = 'data-strique-upstream-title'

function replaceProductTitle(title: string, from: string, to: string): string {
  if (title === from) return to
  const suffix = `${TITLE_SEPARATOR}${from}`
  if (!title.endsWith(suffix)) return title
  return `${title.slice(0, -suffix.length)}${TITLE_SEPARATOR}${to}`
}

/**
 * Keep the renderer-owned session title while replacing its product suffix.
 * Harness 0.1.2-rc.1 has no title Slot and rewrites document.title after boot.
 */
export function presentStriqueDocumentTitle(): () => void {
  const titleElement = document.querySelector('title')
  const separatorAt = document.title.lastIndexOf(TITLE_SEPARATOR)
  const inferredProductTitle = separatorAt === -1
    ? document.title
    : document.title.slice(separatorAt + TITLE_SEPARATOR.length)
  const upstreamProductTitle = titleElement?.getAttribute(UPSTREAM_TITLE_ATTRIBUTE)
    ?? inferredProductTitle
  let upstreamTitle = replaceProductTitle(
    document.title,
    STRIQUE_PRODUCT_TITLE,
    upstreamProductTitle,
  )
  let projectedTitle: string | undefined

  const reconcile = () => {
    const current = document.title
    if (current === projectedTitle) return
    const next = replaceProductTitle(current, upstreamProductTitle, STRIQUE_PRODUCT_TITLE)
    const restored = replaceProductTitle(current, STRIQUE_PRODUCT_TITLE, upstreamProductTitle)
    if (next === current && restored === current) return
    upstreamTitle = restored
    projectedTitle = next
    if (current !== next) document.title = next
  }

  reconcile()
  const observer = new MutationObserver(reconcile)
  observer.observe(document.head, { childList: true, characterData: true, subtree: true })

  return () => {
    observer.disconnect()
    if (document.title === projectedTitle) document.title = upstreamTitle
    const currentTitleElement = document.querySelector('title')
    if (currentTitleElement?.getAttribute(UPSTREAM_TITLE_ATTRIBUTE) === upstreamProductTitle) {
      currentTitleElement.removeAttribute(UPSTREAM_TITLE_ATTRIBUTE)
    }
  }
}
