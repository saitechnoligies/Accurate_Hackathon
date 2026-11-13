/* Helpers shared by both branches: things derived from the plan itself. */
import type { Item, JournalEntry, Memory, Ticket, Trip } from './types'
import { minsLabel, rupee } from './util'

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Mock PNR / booking codes, stable per trip and item. */
export function bookingCode(trip: Trip, key: string, len = 10, digits = true): string {
  let h = hash(trip.trip_id + key)
  const chars = digits ? '0123456789' : 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < len; i++) {
    out += chars[h % chars.length]
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0
  }
  return out
}

/** Tickets that come with the package: trains, stay voucher, paid entry tickets. */
export function autoTickets(trip: Trip): Ticket[] {
  const out: Ticket[] = []
  for (const d of trip.days) {
    for (const it of d.items) {
      if (it.type === 'train') {
        const late = it.delay_min ? `Running ${it.delay_min} min late` : 'On time'
        out.push({ id: `auto-${it.id}`, trip_id: trip.trip_id, kind: 'train', title: it.title, subtitle: it.subtitle,
          code: `PNR ${bookingCode(trip, it.title)}`, status: late, day: d.day, item_id: it.id, time: `${it.start} → ${it.end}`,
          auto: true })
      }
      if (it.type === 'checkin' && d.day === 1) {
        out.push({ id: `auto-stay`, trip_id: trip.trip_id, kind: 'hotel', title: it.subtitle ?? 'Hotel', code: `Booking ${bookingCode(trip, 'stay', 8, false)}`,
          subtitle: `${trip.profile.days - 1} night${trip.profile.days > 2 ? 's' : ''} · ${trip.profile.travelers} guest${trip.profile.travelers > 1 ? 's' : ''}`,
          status: it.title.startsWith('Late') ? 'Late check-in informed' : 'Confirmed', day: 1, item_id: it.id, time: `Check-in ${it.start}`, auto: true })
      }
      if (it.type === 'visit' && (it.fee ?? 0) > 0) {
        out.push({ id: `auto-${it.attraction_id}`, trip_id: trip.trip_id, kind: 'entry', title: it.title,
          subtitle: `${trip.profile.travelers} × ${rupee(it.fee!)}`, code: `ASI-${bookingCode(trip, it.attraction_id!, 6, false)}`,
          status: it.status === 'moved' ? `Moved to Day ${d.day}` : 'Valid', day: d.day, item_id: it.id, time: `${it.start}–${it.end}`, auto: true })
      }
    }
  }
  return out
}

/** Deterministic QR-like pattern (mock, for display). */
export function qrCells(seed: string, n = 21): boolean[][] {
  let h = hash(seed)
  const grid: boolean[][] = []
  for (let y = 0; y < n; y++) {
    const row: boolean[] = []
    for (let x = 0; x < n; x++) {
      h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0
      const finder = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7)
      if (finder) {
        const fx = x < 7 ? x : x - (n - 7)
        const fy = y < 7 ? y : y - (n - 7)
        row.push(fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4))
      } else row.push((h & 1) === 1)
    }
    grid.push(row)
  }
  return grid
}

// ------------------------------------------------------------------ calendar (.ics)
function icsDate(date: string, mins: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setMinutes(d.getMinutes() + mins)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

const CAL_TYPES = new Set(['home', 'train', 'checkin', 'cloakroom', 'visit', 'meal', 'checkout', 'arrive_home'])

export function buildIcs(trip: Trip): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DelayProof Trip//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc(trip.title ?? 'DelayProof trip')}`]
  for (const d of trip.days) {
    for (const it of d.items) {
      if (!CAL_TYPES.has(it.type)) continue
      const end = Math.max(it.end_min, it.start_min + (it.type === 'home' || it.type === 'arrive_home' ? 15 : 0))
      lines.push('BEGIN:VEVENT', `UID:${trip.trip_id}-${it.id}@delayproof`, `DTSTAMP:${icsDate(d.date, 0)}`,
        `DTSTART:${icsDate(d.date, it.start_min)}`, `DTEND:${icsDate(d.date, end)}`,
        `SUMMARY:${esc((it.type === 'home' ? '🏠 ' : it.type === 'train' ? '🚆 ' : '') + it.title)}`,
        `DESCRIPTION:${esc([it.subtitle, it.blurb, ...it.notes].filter(Boolean).join('\n'))}`)
      if (it.type === 'home' || it.type === 'train') {
        lines.push('BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(it.title)} in 30 min`, 'END:VALARM')
      }
      lines.push('END:VEVENT')
    }
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function download(name: string, text: string, type = 'text/calendar') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ------------------------------------------------------------------ journal draft
export function journalDraft(trip: Trip, day: number, memories: Memory[]): string {
  const d = trip.days.find((x) => x.day === day)
  if (!d) return ''
  const stops = d.items.filter((i) => i.type === 'visit').map((i) => i.title)
  const meals = d.items.filter((i) => i.type === 'meal').map((i) => i.title)
  const train = d.items.find((i) => i.type === 'train')
  const changes = trip.changes.filter((c) => c.to_day === day || c.from_day === day)
  const mem = memories.filter((m) => m.day === day)
  const parts: string[] = []
  if (day === 1 && train) {
    parts.push(train.delay_min
      ? `Left home at ${d.items[0].start}. The ${train.title.replace(/^\d+ /, '')} ran ${minsLabel(train.delay_min)} late, so we reached Jaipur at ${train.end}.`
      : `Left home at ${d.items[0].start} and reached Jaipur on time at ${train.end}.`)
    if (d.items.some((i) => i.type === 'cloakroom')) parts.push('Dropped the bags at the station cloakroom so we could head straight out.')
  }
  if (stops.length) parts.push(`Saw ${listify(stops)}.`)
  if (meals.length) parts.push(`Ate at ${listify(meals)}.`)
  for (const c of changes.slice(0, 2)) {
    if (c.kind === 'moved' && c.to_day === day) parts.push(`${c.name} moved here from Day ${c.from_day}, so we didn't miss it.`)
    if (c.kind === 'added' && c.to_day === day) parts.push(`${c.name} was a new addition after the re-plan.`)
  }
  for (const m of mem.slice(0, 3)) if (m.caption) parts.push(`At ${m.stop}: ${m.caption}`)
  if (day === trip.days.length) {
    const last = d.items[d.items.length - 1]
    parts.push(`Home by ${last.start}.`)
  }
  return parts.join(' ')
}

const listify = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

export const MOODS = ['🤩', '😊', '😌', '😴', '😤']

export function sortJournal(es: JournalEntry[]) {
  return [...es].sort((a, b) => a.day - b.day)
}

// ------------------------------------------------------------------ images
export function resizeImage(file: File, max = 900, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Not an image'))
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * scale)
        c.height = Math.round(img.height * scale)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        resolve(c.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** Current / next item for a simulated clock. */
export function nowNext(items: Item[], now: number) {
  const cur = items.find((i) => i.start_min <= now && now < Math.max(i.end_min, i.start_min + 1))
  const next = items.find((i) => i.start_min > now && i.type !== 'transfer')
  const nextRide = items.find((i) => i.start_min >= now && i.type === 'transfer')
  return { cur, next, nextRide }
}

export const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`
