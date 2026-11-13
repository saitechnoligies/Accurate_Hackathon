/* Provider hand-offs: deep links that open the real booking / ride / map apps prefilled.
   The app never claims live inventory; it sends the traveller to the provider with the details filled in. */
import type { Item, Trip } from './types'

type Pt = { lat: number; lng: number; name?: string }

export const maps = (to: Pt, from?: Pt, mode: 'driving' | 'walking' | 'transit' = 'driving') => {
  const q = new URLSearchParams({ api: '1', destination: `${to.lat},${to.lng}`, travelmode: mode })
  if (from) q.set('origin', `${from.lat},${from.lng}`)
  return `https://www.google.com/maps/dir/?${q}`
}

export const uber = (to: Pt) => {
  const q = new URLSearchParams({ action: 'setPickup', pickup: 'my_location', 'dropoff[latitude]': String(to.lat),
    'dropoff[longitude]': String(to.lng), 'dropoff[nickname]': to.name ?? 'Destination' })
  return `https://m.uber.com/ul/?${q}`
}

export const IRCTC = 'https://www.irctc.co.in/nget/train-search'
// NTES has no stable deep link per train; open its search page (the train number is shown next to the link)
export const NTES = (train: string) => `https://enquiry.indianrail.gov.in/mntes/#${encodeURIComponent(train)}`
export const REDBUS = 'https://www.redbus.in/bus-tickets/delhi-to-jaipur'
export const OLA = 'https://www.olacabs.com/'
export const RAPIDO = 'https://rapido.bike/'

export function bookingCom(trip: Trip, stayName: string) {
  const first = trip.days[0].date
  const last = trip.days[trip.days.length - 1].date
  const q = new URLSearchParams({ ss: `${stayName}, Jaipur`, checkin: first, checkout: last, group_adults: String(trip.profile.travelers),
    no_rooms: String(Math.max(1, Math.ceil(trip.profile.travelers / 4))) })
  return `https://www.booking.com/searchresults.html?${q}`
}

/** Links that make sense for one timeline step. */
export function stepLinks(it: Item): { label: string; url: string }[] {
  if (it.type === 'transfer' && !it.intercity && it.to?.lat !== undefined && it.to?.lng !== undefined) {
    const to = { lat: it.to.lat, lng: it.to.lng, name: it.to.name }
    const from = it.frm?.lat !== undefined && it.frm?.lng !== undefined ? { lat: it.frm.lat, lng: it.frm.lng } : undefined
    const out = [{ label: 'Directions', url: maps(to, from, it.mode === 'walk' ? 'walking' : 'driving') }]
    if (it.mode === 'cab') out.push({ label: 'Uber', url: uber(to) })
    if (it.mode === 'auto' || it.mode === 'express_auto') out.push({ label: 'Rapido', url: RAPIDO })
    return out
  }
  if (it.type === 'train') {
    const no = it.title.split(' ')[0]
    return [{ label: 'Running status', url: NTES(no) }, { label: 'IRCTC', url: IRCTC }]
  }
  return []
}

export const PROVIDERS = [
  { name: 'IRCTC', icon: '🚆', what: 'Train timetables, fares and seats', url: IRCTC },
  { name: 'NTES', icon: '⏱️', what: 'Live train running status', url: 'https://enquiry.indianrail.gov.in/mntes/' },
  { name: 'redBus', icon: '🚌', what: 'Delhi ↔ Jaipur buses as a backup', url: REDBUS },
  { name: 'Uber', icon: '🚕', what: 'Cabs in Jaipur', url: 'https://m.uber.com/' },
  { name: 'Ola', icon: '🚖', what: 'Cabs and autos', url: OLA },
  { name: 'Rapido', icon: '🛺', what: 'Autos and bike taxis', url: RAPIDO },
]

export const HELPLINES = [
  { label: 'Emergency (police, fire, ambulance)', number: '112' },
  { label: 'Ambulance', number: '108' },
  { label: 'Tourist helpline (Incredible India, 24×7)', number: '1800111363' },
  { label: 'Railway helpline', number: '139' },
  { label: 'Women helpline', number: '1091' },
]
