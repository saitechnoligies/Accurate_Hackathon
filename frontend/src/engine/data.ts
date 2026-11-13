/* Mock dataset for the Jaipur demo.
   Coordinates are real (approximate); timings, prices and train schedules are
   illustrative mock values for the hackathon demo. Times are "HH:MM" strings. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Rec = Record<string, any>

export const CITY = {
  id: 'jaipur',
  name: 'Jaipur',
  center: [26.9124, 75.8073] as [number, number],
  station: { id: 'JP', name: 'Jaipur Junction', lat: 26.9196, lng: 75.7878, zone: 'station' },
  cloakroom: { name: 'Jaipur Jn cloakroom', fee: 30, minutes: 15 },
}

export const ORIGIN = {
  id: 'delhi',
  name: 'New Delhi',
  station: { id: 'NDLS', name: 'New Delhi Railway Station', lat: 28.6431, lng: 77.2197 },
}

// zone -> used for hill physics, congestion and learned corridor buffers
export const ZONES: Record<string, { label: string; hill: boolean; congested: boolean }> = {
  station: { label: 'Station area', hill: false, congested: false },
  old_city: { label: 'Old City (Pink City)', hill: false, congested: true },
  amber_hill: { label: 'Amber hills', hill: true, congested: false },
  nahargarh_hill: { label: 'Nahargarh ridge', hill: true, congested: false },
  central: { label: 'Central Jaipur', hill: false, congested: false },
  south: { label: 'South Jaipur', hill: false, congested: false },
  east: { label: 'East Jaipur', hill: false, congested: false },
  outskirts: { label: 'Tonk Road outskirts', hill: false, congested: false },
}

export type AttractionData = {
  id: string; name: string; lat: number; lng: number; zone: string; open: string; close: string
  duration: number; fee: number; tags: string[]; indoor: boolean; flagship: boolean
  crowd_peak: [string, string]; kind: 'visit' | 'meal'; blurb: string
}

const A = (
  id: string, name: string, lat: number, lng: number, zone: string, open: string, close: string, duration: number,
  fee: number, tags: string[], indoor: boolean, flagship: boolean, crowd_peak: [string, string], kind: 'visit' | 'meal',
  blurb: string,
): AttractionData => ({ id, name, lat, lng, zone, open, close, duration, fee, tags, indoor, flagship, crowd_peak, kind, blurb })

// kind: visit | meal. indoor: true if shaded/indoor (heat & rain safe)
export const ATTRACTIONS: AttractionData[] = [
  A('amber_fort', 'Amber Fort', 26.9855, 75.8513, 'amber_hill', '08:00', '17:30', 120, 100, ['history', 'photography', 'culture'], false, true, ['10:00', '13:00'], 'visit', 'Hilltop Rajput fort with the Sheesh Mahal mirror palace.'),
  A('city_palace', 'City Palace', 26.9258, 75.8237, 'old_city', '09:30', '17:00', 90, 200, ['history', 'culture'], true, true, ['11:00', '14:00'], 'visit', 'Royal residence with museums and the Pritam Niwas courtyard.'),
  A('hawa_mahal', 'Hawa Mahal', 26.9239, 75.8267, 'old_city', '09:00', '17:00', 45, 50, ['history', 'photography'], false, true, ['10:00', '12:00'], 'visit', 'The 953-window Palace of Winds.'),
  A('jantar_mantar', 'Jantar Mantar', 26.9248, 75.8246, 'old_city', '09:00', '16:30', 60, 50, ['history', 'science'], false, false, ['11:00', '13:00'], 'visit', 'UNESCO astronomical observatory with a giant sundial.'),
  A('nahargarh_fort', 'Nahargarh Fort', 26.9373, 75.8155, 'nahargarh_hill', '10:00', '18:30', 90, 50, ['history', 'photography', 'nature'], false, false, ['16:30', '18:00'], 'visit', 'Ridge-top fort with the best sunset view over the city.'),
  A('jaigarh_fort', 'Jaigarh Fort', 26.9851, 75.8456, 'amber_hill', '09:00', '16:30', 75, 100, ['history'], false, false, ['11:00', '13:00'], 'visit', "Home of Jaivana, once the world's largest cannon on wheels."),
  A('albert_hall', 'Albert Hall Museum', 26.9116, 75.8195, 'central', '09:00', '22:00', 75, 40, ['history', 'culture', 'science'], true, false, ['12:00', '15:00'], 'visit', 'Indo-Saracenic museum, lit up beautifully at night.'),
  A('jal_mahal', 'Jal Mahal Viewpoint', 26.9535, 75.8462, 'amber_hill', '06:00', '21:00', 30, 0, ['photography', 'nature'], false, true, ['17:30', '19:00'], 'visit', 'Water palace floating on Man Sagar lake.'),
  A('bapu_bazaar', 'Bapu Bazaar', 26.9161, 75.8193, 'old_city', '10:30', '21:00', 60, 0, ['shopping', 'culture'], false, false, ['18:00', '20:00'], 'visit', 'Textiles, mojaris and block prints.'),
  A('patrika_gate', 'Patrika Gate', 26.8417, 75.8008, 'south', '08:00', '20:00', 40, 0, ['photography', 'culture'], false, false, ['17:00', '19:00'], 'visit', "Hand-painted gateway, a photographer's favourite."),
  A('birla_mandir', 'Birla Mandir', 26.8921, 75.8155, 'central', '08:00', '20:00', 40, 0, ['spiritual', 'culture'], true, false, ['18:00', '19:30'], 'visit', 'White marble temple at the foot of Moti Dungri.'),
  A('galtaji', 'Galtaji (Monkey Temple)', 26.9172, 75.8578, 'east', '06:00', '20:00', 60, 0, ['spiritual', 'nature', 'photography'], false, false, ['17:00', '18:30'], 'visit', 'Temple complex with natural springs in a mountain pass.'),
  A('sisodia_garden', 'Sisodia Rani Garden', 26.8915, 75.8811, 'east', '08:00', '18:00', 45, 30, ['nature', 'photography'], false, false, ['16:00', '17:30'], 'visit', 'Terraced Mughal-style garden with murals.'),
  A('jkk', 'Jawahar Kala Kendra', 26.8992, 75.8095, 'central', '10:00', '20:00', 60, 0, ['culture', 'art'], true, false, ['17:00', '19:00'], 'visit', 'Arts centre designed by Charles Correa; cool and shaded.'),
  A('chokhi_dhani', 'Chokhi Dhani Village', 26.7684, 75.8350, 'outskirts', '17:30', '23:00', 150, 900, ['culture', 'food'], false, false, ['19:30', '21:00'], 'visit', 'Rajasthani village experience with folk dance and thali dinner.'),
  // meals / chai stops
  A('lmb', 'Laxmi Misthan Bhandar (LMB)', 26.9230, 75.8270, 'old_city', '08:00', '23:00', 50, 350, ['food'], true, false, ['13:00', '14:00'], 'meal', 'Classic Rajasthani thali and ghewar since 1727.'),
  A('rawat', 'Rawat Mishthan Bhandar', 26.9205, 75.7905, 'station', '06:00', '22:00', 35, 120, ['food'], true, false, ['17:00', '19:00'], 'meal', 'Famous pyaaz kachori, a short walk from the station.'),
  A('tapri', 'Tapri Central (chai)', 26.9056, 75.8086, 'central', '08:00', '23:00', 40, 250, ['food'], true, false, ['17:00', '20:00'], 'meal', 'Rooftop chai and snacks overlooking Central Park.'),
  A('amber_cafe', 'Amber Hills Dhaba', 26.9830, 75.8520, 'amber_hill', '09:00', '18:00', 40, 220, ['food'], true, false, ['13:00', '14:00'], 'meal', 'Dal-baati-churma at the foot of Amber Fort.'),
]

export const STAYS = [
  { id: 'pink_pod_hostel', name: 'Pink Pod Backpacker Hostel', type: 'hostel', lat: 26.9165, lng: 75.8030, zone: 'central', price_per_night: 650, per: 'bed', checkin: '12:00', checkout: '10:00', for: ['student'], perks: ['Bunk bed', 'Locker', 'Rooftop cafe'] },
  { id: 'kesar_boutique', name: 'Kesar Boutique Hotel', type: 'boutique', lat: 26.9080, lng: 75.8010, zone: 'central', price_per_night: 3200, per: 'room', checkin: '12:00', checkout: '11:00', for: ['solo'], perks: ['AC room', 'Breakfast', 'Photo-walk desk'] },
  { id: 'haveli_rang', name: 'Haveli Rang Mahal (heritage)', type: 'haveli', lat: 26.9270, lng: 75.8160, zone: 'old_city', price_per_night: 6500, per: 'room', checkin: '12:00', checkout: '11:00', for: ['family'], perks: ['Family suite', 'Courtyard dinner', "Kids' puppet show"] },
]

export const TRAINS = [
  { id: '12015', name: 'Ajmer Shatabdi', from: 'NDLS', to: 'JP', dep: '06:10', arr: '10:35', classes: { CC: 865, '2S': 260 } as Record<string, number>, direction: 'outbound' },
  { id: '12985', name: 'Jaipur Double Decker', from: 'NDLS', to: 'JP', dep: '07:30', arr: '12:05', classes: { CC: 790, '2S': 240 } as Record<string, number>, direction: 'outbound' },
  { id: '12016', name: 'Ajmer Shatabdi', from: 'JP', to: 'NDLS', dep: '17:45', arr: '22:40', classes: { CC: 865, '2S': 260 } as Record<string, number>, direction: 'return' },
  { id: '12986', name: 'Jaipur Double Decker', from: 'JP', to: 'NDLS', dep: '19:00', arr: '23:35', classes: { CC: 790, '2S': 240 } as Record<string, number>, direction: 'return' },
]

export type ModeSpec = {
  label: string; speed: number; base: number; per_km: number; wait: number; capacity: number; ac: boolean
  max_km?: number; per_person?: boolean
}

// speed in km/h on flat roads, fare = base + per_km * km (per vehicle unless per_person)
export const MODES: Record<string, ModeSpec> = {
  walk: { label: 'Walk', speed: 4.5, base: 0, per_km: 0, wait: 0, capacity: 99, ac: false, max_km: 1.2 },
  bus: { label: 'City bus', speed: 14, base: 15, per_km: 0, wait: 12, capacity: 99, ac: false, per_person: true },
  auto: { label: 'Auto-rickshaw', speed: 20, base: 30, per_km: 14, wait: 5, capacity: 3, ac: false },
  express_auto: { label: 'Express auto (app, priority)', speed: 23, base: 50, per_km: 17, wait: 3, capacity: 3, ac: false },
  cab: { label: 'AC cab', speed: 22, base: 60, per_km: 18, wait: 6, capacity: 4, ac: true },
}

// Initial learned delay buffers (minutes) between zone pairs. Keys are sorted "a|b".
export const CORRIDOR_BUFFERS: Record<string, number> = {
  'old_city|station': 8,
  'amber_hill|old_city': 12,
  'amber_hill|central': 10,
  'amber_hill|station': 14,
  'nahargarh_hill|old_city': 10,
  'central|old_city': 6,
  'central|station': 5,
  'old_city|old_city': 4,
  'outskirts|central': 12,
  'outskirts|old_city': 15,
  'east|old_city': 7,
}
export const DEFAULT_BUFFER = 6

// Home addresses for the door-to-door legs (all in Delhi for the demo)
export const HOMES: Record<string, { label: string; lat: number; lng: number; to_station_km: number }> = {
  student: { label: 'PG near North Campus, Delhi', lat: 28.6880, lng: 77.2090, to_station_km: 9 },
  family: { label: 'Home in Dwarka, Delhi', lat: 28.5921, lng: 77.0460, to_station_km: 22 },
  solo: { label: 'Apartment in Saket, Delhi', lat: 28.5245, lng: 77.2066, to_station_km: 16 },
}

export const PERSONAS = [
  { id: 'student', label: 'Student Backpacker', emoji: '🎒', travelers: 1, budget: 6500, days: 2, interests: ['photography', 'food', 'history'], pace: 'packed', stay_type: 'hostel', modes: ['walk', 'bus', 'auto', 'express_auto'], train_class: '2S', outbound: '12015', return: '12986', day_start: '08:00', day_end: '21:30', description: 'One traveller, tight budget, happy to walk and take buses.' },
  { id: 'family', label: 'Family Weekend', emoji: '👨‍👩‍👧', travelers: 4, budget: 32000, days: 2, interests: ['history', 'culture', 'food', 'shopping'], pace: 'relaxed', stay_type: 'haveli', modes: ['walk', 'cab'], train_class: 'CC', outbound: '12015', return: '12016', day_start: '09:00', day_end: '20:30', description: 'Two adults, two kids. Comfort first, AC cabs, no rushed days.' },
  { id: 'solo', label: 'Solo Photographer', emoji: '📷', travelers: 1, budget: 14000, days: 2, interests: ['photography', 'history', 'nature'], pace: 'balanced', stay_type: 'boutique', modes: ['walk', 'auto', 'express_auto', 'cab'], train_class: 'CC', outbound: '12015', return: '12016', day_start: '07:30', day_end: '21:00', description: 'Chasing golden hour, sunsets and quiet corners.' },
]

export const DEFAULT_WEIGHTS: Record<string, number> = {
  interest: 1.2, // how much interest match matters
  flagship: 1.0, // must-see pull
  budget: 0.6, // penalty for expensive stops relative to remaining budget
  travel: 0.9, // penalty per hour of travel to reach the stop
  urgency: 0.5, // bonus for stops that close soon
  crowd: 0.4, // penalty for arriving at crowd peak
}

export type Catalog = {
  attractions: AttractionData[]
  stays: typeof STAYS
  trains: typeof TRAINS
  personas: typeof PERSONAS
  corridors: Record<string, number>
  weights: Record<string, number>
  tag_affinity: Record<string, Record<string, number>>
}
