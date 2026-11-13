import type { Profile } from '../types'
import { HOMES, type Catalog } from './data'

export type ProfileOverrides = Partial<{
  travelers: number; budget: number; days: number; interests: string[]; pace: string; stay_id: string
  train_class: string; outbound: string; return: string; start_date: string; home_label: string
}>

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function makeProfile(catalog: Catalog, personaId: string, overrides: ProfileOverrides = {}): Profile {
  const persona = catalog.personas.find((p) => p.id === personaId)
  if (!persona) throw new Error(`Unknown persona ${personaId}`)
  const o = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && v !== null)) as ProfileOverrides
  const stay = catalog.stays.find((s) => s.type === persona.stay_type) ?? catalog.stays[0]
  const start = new Date()
  start.setDate(start.getDate() + 7)
  const profile: Profile = {
    persona_id: personaId,
    persona_label: persona.label,
    travelers: persona.travelers,
    budget: persona.budget,
    days: persona.days,
    interests: [...persona.interests],
    pace: persona.pace,
    stay_id: stay.id,
    modes: [...persona.modes],
    train_class: persona.train_class,
    outbound: persona.outbound,
    return: persona.return,
    day_start: persona.day_start,
    day_end: persona.day_end,
    home: { ...HOMES[personaId] },
    start_date: isoDate(start),
  }
  const keys = ['travelers', 'budget', 'days', 'interests', 'pace', 'stay_id', 'train_class', 'outbound', 'return',
    'start_date'] as const
  for (const k of keys) if (o[k] !== undefined) (profile as Record<string, unknown>)[k] = o[k]
  if (o.home_label) profile.home.label = o.home_label
  profile.days = Math.max(2, Math.min(3, Math.trunc(Number(profile.days))))
  profile.travelers = Math.max(1, Math.min(8, Math.trunc(Number(profile.travelers))))
  profile.budget = Math.max(1000, Math.trunc(Number(profile.budget)))
  return profile
}
