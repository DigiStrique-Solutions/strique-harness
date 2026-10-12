import type { SkillCatalogEntry } from '../types.js'

export const projectPopoverEnabledCount = (entries: readonly Pick<SkillCatalogEntry, 'effectiveEnabled'>[]) => entries.filter(entry => entry.effectiveEnabled).length

export const projectPopoverRow = (
  entry: Pick<SkillCatalogEntry, 'globalEnabled' | 'effectiveEnabled'>,
  busy = false,
) => ({
  checked: entry.effectiveEnabled,
  disabled: busy || entry.globalEnabled,
  badge: entry.globalEnabled ? 'Global' : null,
  checkboxTitle: entry.globalEnabled ? 'Globally enabled. Disable in Settings > Skills' : 'Enable for workspace',
})
