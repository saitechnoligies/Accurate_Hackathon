import type { Item } from './types'

export const rupee = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export const MODE_ICON: Record<string, string> = {
  walk: '🚶',
  bus: '🚌',
  auto: '🛺',
  express_auto: '⚡',
  cab: '🚕',
  metro: '🚇',
}

export const TYPE_ICON: Record<string, string> = {
  home: '🏠',
  arrive_home: '🏠',
  buffer: '🛂',
  train: '🚆',
  checkin: '🛎️',
  checkout: '🧳',
  cloakroom: '🎒',
  collect_bags: '🧳',
  hotel: '🏨',
  free: '☕',
  visit: '📍',
  meal: '🍛',
}

export function itemIcon(it: Item): string {
  if (it.type === 'transfer') return MODE_ICON[it.mode ?? 'cab'] ?? '🚕'
  return TYPE_ICON[it.type] ?? '•'
}

export const STATUS_LABEL: Record<string, string> = {
  delayed: 'Delayed',
  moved: 'Moved',
  rescued: 'Rescued',
  upgraded: 'Upgraded',
}

export function minsLabel(m: number): string {
  const h = Math.floor(m / 60)
  const r = Math.round(m % 60)
  if (!h) return `${r} min`
  return r ? `${h}h ${r}m` : `${h}h`
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function storage(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key)
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
  return null
}
