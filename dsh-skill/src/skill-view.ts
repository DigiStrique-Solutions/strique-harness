import type { SkillSummary, SkillDefinition } from '@deepseek-ai/dsh-skill'

export interface SourceIdentity { origin: string; location?: string; version?: string }
export type ObservedSkill = SkillSummary & { sourceIdentity?: SourceIdentity }
export type ObservedDefinition = SkillDefinition & { sourceIdentity?: SourceIdentity }

/** Metadata belongs to this plugin, not to the upstream registry's public types. */
export function observeSkill<T extends SkillSummary>(skill: T): T & { sourceIdentity?: SourceIdentity } {
  return { ...skill, sourceIdentity: { origin: JSON.stringify(skill.resourceBase ?? [skill.provider, skill.source]), ...(skill.path ? { location: skill.path } : {}) } }
}

/** Identity and policy declarations must agree across discovery and loading. */
export function definitionKey(skill: SkillSummary): string {
  return JSON.stringify([skill.name, skill.description, skill.whenToUse, skill.source, skill.provider, skill.path, skill.resourceBase, skill.invocation])
}
