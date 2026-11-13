/* Proactive suggestions: pure detectors over the trip, the live forecast and air quality.
   Each suggestion carries an action the planner can apply, so accepting one re-plans the trip
   instead of just showing a message. */
import type { Disruptions, Expense, Trip } from './types'
import { type Air, type DayForecast, type Fetched, type Weather, isRainy } from './live'
import { rupee } from './util'

export type SuggestionAction =
  | { type: 'disrupt'; patch: Partial<Disruptions> }
  | { type: 'skip'; attraction_id: string }
  | { type: 'swap'; attraction_id: string }
  | { type: 'packing'; items: string[] }
  | { type: 'tab'; tab: string }

export type Suggestion = {
  id: string // unique per situation (dismiss key)
  kind: 'weather' | 'air' | 'budget' | 'crowd' | 'safety'
  severity: 'high' | 'medium' | 'low'
  title: string
  because: string
  action?: { label: string; do: SuggestionAction }
  source?: string
}

export function detect(trip: Trip, weather: Fetched<Weather> | null, air: Fetched<Air> | null, expenses: Expense[] = []): Suggestion[] {
  const out: Suggestion[] = []
  const d = trip.disruptions
  const tag = weather?.freshness === 'simulated' ? ' (simulated forecast)' : ''

  // weather on trip days
  if (weather) {
    const byDate = new Map(weather.data.days.map((x) => [x.date, x]))
    const tripDays = trip.days.map((day) => ({ day, f: byDate.get(day.date) })).filter((x): x is { day: Trip['days'][number]; f: DayForecast } => !!x.f)
    const hot = tripDays.find((x) => x.f.max >= 40)
    const wet = tripDays.find((x) => isRainy(x.f))
    const outdoor = (day: Trip['days'][number]) => day.items.filter((i) => i.type === 'visit' && !i.indoor).map((i) => i.title)
    if (hot && d.weather !== 'heat') {
      const o = outdoor(hot.day)
      out.push({
        id: `heat-${hot.day.date}-${hot.f.max}`, kind: 'weather', severity: 'high',
        title: `${hot.f.max}°C forecast on Day ${hot.day.day}`,
        because: `The forecast for ${hot.day.date} peaks at ${hot.f.max}°C${o.length ? ` and ${o.slice(0, 3).join(', ')} ${o.length === 1 ? 'is' : 'are'} outdoors` : ''}${tag}.`,
        action: { label: 'Apply the heat plan', do: { type: 'disrupt', patch: { weather: 'heat' } } }, source: weather.source,
      })
    } else if (wet && d.weather !== 'rain') {
      const o = outdoor(wet.day)
      out.push({
        id: `rain-${wet.day.date}-${wet.f.rain}`, kind: 'weather', severity: 'medium',
        title: `Rain likely on Day ${wet.day.day} (${wet.f.rain}%)`,
        because: `The forecast for ${wet.day.date} shows ${wet.f.rain}% chance of rain${o.length ? ` and ${o.slice(0, 3).join(', ')} ${o.length === 1 ? 'is' : 'are'} outdoors` : ''}${tag}.`,
        action: { label: 'Apply the rain plan', do: { type: 'disrupt', patch: { weather: 'rain' } } }, source: weather.source,
      })
    }
  }

  // air quality
  if (air && air.data.aqi > 150) {
    out.push({
      id: `aqi-${Math.round(air.data.aqi / 25)}`, kind: 'air', severity: air.data.aqi > 200 ? 'high' : 'medium',
      title: `Air quality is unhealthy (AQI ${air.data.aqi})`,
      because: `Current US AQI in Jaipur is ${air.data.aqi} with PM2.5 at ${air.data.pm25} µg/m³. Masks help on long outdoor stretches.`,
      action: { label: 'Add masks to packing', do: { type: 'packing', items: ['N95 masks', 'Eye drops'] } }, source: air.source,
    })
  }

  // budget, including what the group has actually spent on top of the package
  const extra = expenses.filter((e) => e.category === 'extra').reduce((s, e) => s + e.amount, 0)
  const total = trip.receipt.total + extra
  const pct = Math.round((total / trip.receipt.budget) * 100)
  if (pct >= 90) {
    const optional = trip.days.flatMap((x) => x.items).filter((i) => i.type === 'visit' && !i.flagship && (i.cost ?? 0) > 0)
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))[0]
    out.push({
      id: `budget-${pct >= 100 ? 'over' : 'near'}-${Math.round(total / 500)}`, kind: 'budget', severity: pct >= 100 ? 'high' : 'medium',
      title: pct >= 100 ? `Over budget by ${rupee(total - trip.receipt.budget)}` : `${pct}% of the budget is committed`,
      because: `Package ${rupee(trip.receipt.total)}${extra ? ` + ${rupee(extra)} logged extras` : ''} of ${rupee(trip.receipt.budget)}.`,
      action: optional ? { label: `Drop ${optional.title} (saves ${rupee(optional.cost ?? 0)})`, do: { type: 'skip', attraction_id: optional.attraction_id! } }
        : { label: 'Review expenses', do: { type: 'tab', tab: 'expenses' } },
    })
  }

  // crowd peak at a must-see with a Plan B
  const peak = trip.days.flatMap((x) => x.items).find((i) => i.type === 'visit' && i.flagship && i.plan_b && i.notes.some((n) => n.startsWith('Peak hour')))
  if (peak) {
    out.push({
      id: `crowd-${peak.attraction_id}-${peak.start}`, kind: 'crowd', severity: 'low',
      title: `${peak.title} at peak hour`,
      because: `You arrive at ${peak.start}, inside its usual crowd peak (+15 min queue). ${peak.plan_b!.name} fits the same slot.`,
      action: { label: `Swap to ${peak.plan_b!.name}`, do: { type: 'swap', attraction_id: peak.attraction_id! } },
    })
  }

  // late-night arrival home
  const ride = trip.days[trip.days.length - 1].items.find((i) => i.safety)
  if (ride) {
    out.push({
      id: `safety-${ride.start}`, kind: 'safety', severity: 'low',
      title: `Late-night arrival at ${ride.start}`,
      because: 'You reach Delhi after 22:00. A verified cab is planned; share live status with family from Trip mode.',
      action: { label: 'Open the guide (helplines)', do: { type: 'tab', tab: 'guide' } },
    })
  }

  const rank = { high: 0, medium: 1, low: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

// ------------------------------------------------------------------ dismiss / mute (per browser)
const KEY = 'delayproof.proactive'
type Prefs = { dismissed: string[]; muted: string[] }
export function proactivePrefs(): Prefs {
  try {
    return { dismissed: [], muted: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as Prefs
  } catch {
    return { dismissed: [], muted: [] }
  }
}
export function saveProactivePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ dismissed: p.dismissed.slice(-100), muted: p.muted }))
  } catch {
    /* ignore */
  }
}
