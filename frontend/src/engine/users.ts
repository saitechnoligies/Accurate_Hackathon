import type { Prefs, User } from '../types'

export const DEFAULT_PREFS: Prefs = {
  interests: ['history', 'culture', 'food'],
  pace: 'balanced',
  diet: 'any',
  mobility: 'normal',
  avoid_heat: false,
  day_start: '09:00',
  day_end: '20:30',
}

/** One-click demo identities. Each browser tab can be a different person. */
export const DEMO_USERS: User[] = [
  { id: 'priya', name: 'Priya', emoji: '👩🏽', color: '#2347d8',
    prefs: { ...DEFAULT_PREFS, interests: ['history', 'culture', 'food'], diet: 'veg' } },
  { id: 'rohit', name: 'Rohit', emoji: '👨🏽', color: '#e0287d',
    prefs: { ...DEFAULT_PREFS, interests: ['photography', 'food', 'nature'], pace: 'packed', day_start: '07:30', day_end: '21:30' } },
  { id: 'ananya', name: 'Ananya', emoji: '👧🏽', color: '#15935b',
    prefs: { ...DEFAULT_PREFS, interests: ['shopping', 'culture', 'art'], pace: 'relaxed', diet: 'jain', avoid_heat: true } },
  { id: 'kabir', name: 'Kabir', emoji: '🧔🏽', color: '#c77700',
    prefs: { ...DEFAULT_PREFS, interests: ['history', 'spiritual'], pace: 'relaxed', diet: 'veg', mobility: 'limited' } },
]
