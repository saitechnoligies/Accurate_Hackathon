/* Live public data used by both branches: Open-Meteo forecast + air quality, a Wikivoyage city brief and
   Wikipedia place photos. Everything is keyless, cached in the browser with its fetch time, and labelled
   Live / Cached / Simulated so the UI never passes off stale or sample data as current. */

export type Freshness = 'live' | 'cached' | 'simulated'
export type Fetched<T> = { data: T; freshness: Freshness; at: string; source: string; url: string }

const JAIPUR = { lat: 26.9124, lng: 75.7873 }
const CACHE = 'delayproof.live.'

function readCache<T>(key: string): { data: T; at: string } | null {
  try {
    const raw = localStorage.getItem(CACHE + key)
    return raw ? (JSON.parse(raw) as { data: T; at: string }) : null
  } catch {
    return null
  }
}
function writeCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(CACHE + key, JSON.stringify({ data, at: new Date().toISOString() }))
  } catch {
    /* storage full / blocked */
  }
}

/** Fresh cache → cached; otherwise fetch live; on failure fall back to any cache, else throw. */
async function cached<T>(key: string, maxAgeMin: number, source: string, url: string, load: () => Promise<T>): Promise<Fetched<T>> {
  const hit = readCache<T>(key)
  if (hit && Date.now() - new Date(hit.at).getTime() < maxAgeMin * 60_000) return { data: hit.data, freshness: 'cached', at: hit.at, source, url }
  try {
    const data = await load()
    writeCache(key, data)
    return { data, freshness: 'live', at: new Date().toISOString(), source, url }
  } catch (e) {
    if (hit) return { data: hit.data, freshness: 'cached', at: hit.at, source, url }
    throw e
  }
}

async function getJson<T>(url: string, ms = 8000): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return (await r.json()) as T
  } finally {
    clearTimeout(t)
  }
}

// ------------------------------------------------------------------ weather
export type DayForecast = { date: string; max: number; min: number; rain: number; code: number }
export type Weather = { current: { temp: number; code: number }; days: DayForecast[] }

export const WEATHER_LABEL = (code: number) =>
  code === 0 ? 'Clear' : code <= 3 ? 'Partly cloudy' : code <= 48 ? 'Fog / haze' : code <= 67 ? 'Rain' : code <= 77 ? 'Snow'
    : code <= 82 ? 'Showers' : 'Thunderstorms'
export const WEATHER_ICON = (code: number) =>
  code === 0 ? '☀️' : code <= 3 ? '⛅' : code <= 48 ? '🌫️' : code <= 67 ? '🌧️' : code <= 82 ? '🌦️' : '⛈️'
const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])
export const isRainy = (d: DayForecast) => RAIN_CODES.has(d.code) || d.rain >= 60

export function liveWeather(): Promise<Fetched<Weather>> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${JAIPUR.lat}&longitude=${JAIPUR.lng}`
    + '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&timezone=Asia%2FKolkata&forecast_days=16'
  return cached('weather', 30, 'Open-Meteo forecast model', 'https://open-meteo.com/', async () => {
    type R = { current: { temperature_2m: number; weather_code: number }
      daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] } }
    const r = await getJson<R>(url)
    return {
      current: { temp: Math.round(r.current.temperature_2m), code: r.current.weather_code },
      days: r.daily.time.map((date, i) => ({ date, code: r.daily.weather_code[i], max: Math.round(r.daily.temperature_2m_max[i]),
        min: Math.round(r.daily.temperature_2m_min[i]), rain: r.daily.precipitation_probability_max[i] ?? 0 })),
    }
  })
}

/** A labelled sample forecast for demos: a heatwave on the trip's first day. */
export function simulatedHeatwave(dates: string[]): Fetched<Weather> {
  return {
    freshness: 'simulated', at: new Date().toISOString(), source: 'Demo scenario', url: '',
    data: { current: { temp: 41, code: 0 }, days: dates.map((date, i) => ({ date, code: i === 0 ? 0 : 1, max: i === 0 ? 43 : 39, min: 29, rain: 0 })) },
  }
}

// ------------------------------------------------------------------ air quality
export type Air = { aqi: number; pm25: number }
export const AQI_LABEL = (a: number) => (a <= 50 ? 'Good' : a <= 100 ? 'Moderate' : a <= 150 ? 'Unhealthy for sensitive groups' : a <= 200 ? 'Unhealthy' : 'Very unhealthy')

export function liveAir(): Promise<Fetched<Air>> {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${JAIPUR.lat}&longitude=${JAIPUR.lng}&current=us_aqi,pm2_5`
  return cached('air', 60, 'CAMS via Open-Meteo', 'https://open-meteo.com/en/docs/air-quality-api', async () => {
    const r = await getJson<{ current: { us_aqi: number; pm2_5: number } }>(url)
    return { aqi: Math.round(r.current.us_aqi), pm25: Math.round(r.current.pm2_5) }
  })
}

// ------------------------------------------------------------------ city brief (Wikivoyage, CC BY-SA)
export type BriefSection = { title: string; text: string }
const BRIEF_SECTIONS = ['Understand', 'Get in', 'Get around', 'Eat', 'Buy', 'Stay safe', 'Respect', 'Cope']

export function cityBrief(): Promise<Fetched<BriefSection[]>> {
  const url = 'https://en.wikivoyage.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=Jaipur&format=json&origin=*'
  return cached('brief', 24 * 60, 'Wikivoyage: Jaipur (CC BY-SA 4.0)', 'https://en.wikivoyage.org/wiki/Jaipur', async () => {
    const r = await getJson<{ query: { pages: Record<string, { extract?: string }> } }>(url)
    const text = Object.values(r.query.pages)[0]?.extract ?? ''
    const parts = text.split(/\n(?===\s)/)
    const out: BriefSection[] = []
    for (const part of parts) {
      const m = part.match(/^==\s*([^=]+?)\s*==\n([\s\S]*)/)
      if (!m || !BRIEF_SECTIONS.includes(m[1])) continue
      // keep prose paragraphs (sub-section headings and short listing lines are dropped)
      const body = m[2].split('\n').map((s) => s.trim()).filter((s) => s.length > 80 && !s.startsWith('=') && !/^\d+\s/.test(s) && !s.includes('☏'))
      const excerpt = body.slice(0, 3).join(' ').slice(0, 520)
      if (excerpt) out.push({ title: m[1], text: excerpt.replace(/\s+\S*$/, '') + '…' })
      if (out.length >= 6) break
    }
    if (!out.length) throw new Error('No guide sections')
    return out
  })
}

/** Our own short notes, used when the guide can't be reached. */
export const OFFLINE_BRIEF: BriefSection[] = [
  { title: 'Get around', text: 'Autos and app cabs are everywhere; agree the fare or use the app price. The Old City lanes are slow at peak hours, so allow extra time, which the planner already adds as a learned buffer.' },
  { title: 'Stay safe', text: 'Carry water in the afternoon heat, keep valuables close in the bazaars, and use the official ticket counters at the forts. Monkeys at Galtaji grab food and bags.' },
  { title: 'Respect', text: 'Remove shoes at temples, dress modestly at religious sites and ask before photographing people.' },
]

// ------------------------------------------------------------------ place photos (Wikipedia summaries)
const WIKI_TITLE: Record<string, string> = {
  amber_fort: 'Amber_Fort', city_palace: 'City_Palace,_Jaipur', hawa_mahal: 'Hawa_Mahal', jantar_mantar: 'Jantar_Mantar,_Jaipur',
  nahargarh_fort: 'Nahargarh_Fort', jaigarh_fort: 'Jaigarh_Fort', albert_hall: 'Albert_Hall_Museum', jal_mahal: 'Jal_Mahal',
  bapu_bazaar: 'Bapu_Bazaar', patrika_gate: 'Patrika_Gate', birla_mandir: 'Birla_Mandir,_Jaipur', galtaji: 'Galtaji',
  sisodia_garden: 'Sisodia_Rani_Garden', jkk: 'Jawahar_Kala_Kendra', chokhi_dhani: 'Chokhi_Dhani',
  jaipur: 'Jaipur',
}
export type Photo = { src: string; page: string; title: string }
const pending = new Map<string, Promise<Photo | null>>()

export function hasPhoto(id: string) {
  return id in WIKI_TITLE
}

export function placePhoto(id: string): Promise<Photo | null> {
  const title = WIKI_TITLE[id]
  if (!title) return Promise.resolve(null)
  const hit = readCache<Photo | null>(`photo.${id}`)
  if (hit) return Promise.resolve(hit.data)
  if (!pending.has(id)) {
    pending.set(id, getJson<{ title: string; thumbnail?: { source: string }; content_urls?: { desktop: { page: string } } }>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`, 6000)
      .then((r) => {
        const p = r.thumbnail ? { src: r.thumbnail.source, page: r.content_urls?.desktop.page ?? `https://en.wikipedia.org/wiki/${title}`, title: r.title } : null
        writeCache(`photo.${id}`, p)
        return p
      })
      .catch(() => null))
  }
  return pending.get(id)!
}
