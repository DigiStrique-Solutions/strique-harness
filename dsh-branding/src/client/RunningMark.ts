/** Replace the Harness running decoration while preserving its clock and announcements. */
export function presentStriqueRunningMark(): () => void {
  const style = document.createElement('style')
  style.setAttribute('data-strique-running-mark', '')
  // The running status exposes a stable data attribute but no icon Slot.
  const icon = '[data-chat-running] > span:last-child > span[aria-hidden="true"]:first-child'
  style.textContent = `
    ${icon} > * { visibility: hidden; }
    ${icon}::before {
      content: '';
      position: absolute;
      inset: 0;
      background: url('/strique-branding/mark.svg') center / contain no-repeat;
    }
    @keyframes strique-running-pulse {
      50% { opacity: 0.45; }
    }
    @media (prefers-reduced-motion: no-preference) {
      ${icon}::before { animation: strique-running-pulse 1.6s ease-in-out infinite; }
    }
    @media (forced-colors: active) {
      ${icon}::before {
        background: currentColor;
        mask: url('/strique-branding/mark.svg') center / contain no-repeat;
      }
    }
  `
  document.head.append(style)
  return () => { style.remove() }
}
