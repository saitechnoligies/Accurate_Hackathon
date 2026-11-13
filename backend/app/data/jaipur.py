"""Mock dataset for the Jaipur demo.

Coordinates are real (approximate); timings, prices and train schedules are
illustrative mock values for the hackathon demo. Times are "HH:MM" strings.
"""

CITY = {
    "id": "jaipur",
    "name": "Jaipur",
    "center": [26.9124, 75.8073],
    "station": {"id": "JP", "name": "Jaipur Junction", "lat": 26.9196, "lng": 75.7878, "zone": "station"},
    "cloakroom": {"name": "Jaipur Jn cloakroom", "fee": 30, "minutes": 15},
}

ORIGIN = {
    "id": "delhi",
    "name": "New Delhi",
    "station": {"id": "NDLS", "name": "New Delhi Railway Station", "lat": 28.6431, "lng": 77.2197},
}

# zone -> used for hill physics, congestion and learned corridor buffers
ZONES = {
    "station": {"label": "Station area", "hill": False, "congested": False},
    "old_city": {"label": "Old City (Pink City)", "hill": False, "congested": True},
    "amber_hill": {"label": "Amber hills", "hill": True, "congested": False},
    "nahargarh_hill": {"label": "Nahargarh ridge", "hill": True, "congested": False},
    "central": {"label": "Central Jaipur", "hill": False, "congested": False},
    "south": {"label": "South Jaipur", "hill": False, "congested": False},
    "east": {"label": "East Jaipur", "hill": False, "congested": False},
    "outskirts": {"label": "Tonk Road outskirts", "hill": False, "congested": False},
}

# Attractions. kind: visit | meal. indoor: True if shaded/indoor (heat & rain safe)
ATTRACTIONS = [
    {"id": "amber_fort", "name": "Amber Fort", "lat": 26.9855, "lng": 75.8513, "zone": "amber_hill",
     "open": "08:00", "close": "17:30", "duration": 120, "fee": 100, "tags": ["history", "photography", "culture"],
     "indoor": False, "flagship": True, "crowd_peak": ["10:00", "13:00"], "kind": "visit",
     "blurb": "Hilltop Rajput fort with the Sheesh Mahal mirror palace."},
    {"id": "city_palace", "name": "City Palace", "lat": 26.9258, "lng": 75.8237, "zone": "old_city",
     "open": "09:30", "close": "17:00", "duration": 90, "fee": 200, "tags": ["history", "culture"],
     "indoor": True, "flagship": True, "crowd_peak": ["11:00", "14:00"], "kind": "visit",
     "blurb": "Royal residence with museums and the Pritam Niwas courtyard."},
    {"id": "hawa_mahal", "name": "Hawa Mahal", "lat": 26.9239, "lng": 75.8267, "zone": "old_city",
     "open": "09:00", "close": "17:00", "duration": 45, "fee": 50, "tags": ["history", "photography"],
     "indoor": False, "flagship": True, "crowd_peak": ["10:00", "12:00"], "kind": "visit",
     "blurb": "The 953-window Palace of Winds."},
    {"id": "jantar_mantar", "name": "Jantar Mantar", "lat": 26.9248, "lng": 75.8246, "zone": "old_city",
     "open": "09:00", "close": "16:30", "duration": 60, "fee": 50, "tags": ["history", "science"],
     "indoor": False, "flagship": False, "crowd_peak": ["11:00", "13:00"], "kind": "visit",
     "blurb": "UNESCO astronomical observatory with a giant sundial."},
    {"id": "nahargarh_fort", "name": "Nahargarh Fort", "lat": 26.9373, "lng": 75.8155, "zone": "nahargarh_hill",
     "open": "10:00", "close": "18:30", "duration": 90, "fee": 50, "tags": ["history", "photography", "nature"],
     "indoor": False, "flagship": False, "crowd_peak": ["16:30", "18:00"], "kind": "visit",
     "blurb": "Ridge-top fort with the best sunset view over the city."},
    {"id": "jaigarh_fort", "name": "Jaigarh Fort", "lat": 26.9851, "lng": 75.8456, "zone": "amber_hill",
     "open": "09:00", "close": "16:30", "duration": 75, "fee": 100, "tags": ["history"],
     "indoor": False, "flagship": False, "crowd_peak": ["11:00", "13:00"], "kind": "visit",
     "blurb": "Home of Jaivana, once the world's largest cannon on wheels."},
    {"id": "albert_hall", "name": "Albert Hall Museum", "lat": 26.9116, "lng": 75.8195, "zone": "central",
     "open": "09:00", "close": "22:00", "duration": 75, "fee": 40, "tags": ["history", "culture", "science"],
     "indoor": True, "flagship": False, "crowd_peak": ["12:00", "15:00"], "kind": "visit",
     "blurb": "Indo-Saracenic museum, lit up beautifully at night."},
    {"id": "jal_mahal", "name": "Jal Mahal Viewpoint", "lat": 26.9535, "lng": 75.8462, "zone": "amber_hill",
     "open": "06:00", "close": "21:00", "duration": 30, "fee": 0, "tags": ["photography", "nature"],
     "indoor": False, "flagship": True, "crowd_peak": ["17:30", "19:00"], "kind": "visit",
     "blurb": "Water palace floating on Man Sagar lake."},
    {"id": "bapu_bazaar", "name": "Bapu Bazaar", "lat": 26.9161, "lng": 75.8193, "zone": "old_city",
     "open": "10:30", "close": "21:00", "duration": 60, "fee": 0, "tags": ["shopping", "culture"],
     "indoor": False, "flagship": False, "crowd_peak": ["18:00", "20:00"], "kind": "visit",
     "blurb": "Textiles, mojaris and block prints."},
    {"id": "patrika_gate", "name": "Patrika Gate", "lat": 26.8417, "lng": 75.8008, "zone": "south",
     "open": "08:00", "close": "20:00", "duration": 40, "fee": 0, "tags": ["photography", "culture"],
     "indoor": False, "flagship": False, "crowd_peak": ["17:00", "19:00"], "kind": "visit",
     "blurb": "Hand-painted gateway, a photographer's favourite."},
    {"id": "birla_mandir", "name": "Birla Mandir", "lat": 26.8921, "lng": 75.8155, "zone": "central",
     "open": "08:00", "close": "20:00", "duration": 40, "fee": 0, "tags": ["spiritual", "culture"],
     "indoor": True, "flagship": False, "crowd_peak": ["18:00", "19:30"], "kind": "visit",
     "blurb": "White marble temple at the foot of Moti Dungri."},
    {"id": "galtaji", "name": "Galtaji (Monkey Temple)", "lat": 26.9172, "lng": 75.8578, "zone": "east",
     "open": "06:00", "close": "20:00", "duration": 60, "fee": 0, "tags": ["spiritual", "nature", "photography"],
     "indoor": False, "flagship": False, "crowd_peak": ["17:00", "18:30"], "kind": "visit",
     "blurb": "Temple complex with natural springs in a mountain pass."},
    {"id": "sisodia_garden", "name": "Sisodia Rani Garden", "lat": 26.8915, "lng": 75.8811, "zone": "east",
     "open": "08:00", "close": "18:00", "duration": 45, "fee": 30, "tags": ["nature", "photography"],
     "indoor": False, "flagship": False, "crowd_peak": ["16:00", "17:30"], "kind": "visit",
     "blurb": "Terraced Mughal-style garden with murals."},
    {"id": "jkk", "name": "Jawahar Kala Kendra", "lat": 26.8992, "lng": 75.8095, "zone": "central",
     "open": "10:00", "close": "20:00", "duration": 60, "fee": 0, "tags": ["culture", "art"],
     "indoor": True, "flagship": False, "crowd_peak": ["17:00", "19:00"], "kind": "visit",
     "blurb": "Arts centre designed by Charles Correa; cool and shaded."},
    {"id": "chokhi_dhani", "name": "Chokhi Dhani Village", "lat": 26.7684, "lng": 75.8350, "zone": "outskirts",
     "open": "17:30", "close": "23:00", "duration": 150, "fee": 900, "tags": ["culture", "food"],
     "indoor": False, "flagship": False, "crowd_peak": ["19:30", "21:00"], "kind": "visit",
     "blurb": "Rajasthani village experience with folk dance and thali dinner."},
    # meals / chai stops
    {"id": "lmb", "name": "Laxmi Misthan Bhandar (LMB)", "lat": 26.9230, "lng": 75.8270, "zone": "old_city",
     "open": "08:00", "close": "23:00", "duration": 50, "fee": 350, "tags": ["food"],
     "indoor": True, "flagship": False, "crowd_peak": ["13:00", "14:00"], "kind": "meal",
     "blurb": "Classic Rajasthani thali and ghewar since 1727."},
    {"id": "rawat", "name": "Rawat Mishthan Bhandar", "lat": 26.9205, "lng": 75.7905, "zone": "station",
     "open": "06:00", "close": "22:00", "duration": 35, "fee": 120, "tags": ["food"],
     "indoor": True, "flagship": False, "crowd_peak": ["17:00", "19:00"], "kind": "meal",
     "blurb": "Famous pyaaz kachori, a short walk from the station."},
    {"id": "tapri", "name": "Tapri Central (chai)", "lat": 26.9056, "lng": 75.8086, "zone": "central",
     "open": "08:00", "close": "23:00", "duration": 40, "fee": 250, "tags": ["food"],
     "indoor": True, "flagship": False, "crowd_peak": ["17:00", "20:00"], "kind": "meal",
     "blurb": "Rooftop chai and snacks overlooking Central Park."},
    {"id": "amber_cafe", "name": "Amber Hills Dhaba", "lat": 26.9830, "lng": 75.8520, "zone": "amber_hill",
     "open": "09:00", "close": "18:00", "duration": 40, "fee": 220, "tags": ["food"],
     "indoor": True, "flagship": False, "crowd_peak": ["13:00", "14:00"], "kind": "meal",
     "blurb": "Dal-baati-churma at the foot of Amber Fort."},
]

STAYS = [
    {"id": "pink_pod_hostel", "name": "Pink Pod Backpacker Hostel", "type": "hostel", "lat": 26.9165, "lng": 75.8030,
     "zone": "central", "price_per_night": 650, "per": "bed", "checkin": "12:00", "checkout": "10:00",
     "for": ["student"], "perks": ["Bunk bed", "Locker", "Rooftop cafe"]},
    {"id": "kesar_boutique", "name": "Kesar Boutique Hotel", "type": "boutique", "lat": 26.9080, "lng": 75.8010,
     "zone": "central", "price_per_night": 3200, "per": "room", "checkin": "12:00", "checkout": "11:00",
     "for": ["solo"], "perks": ["AC room", "Breakfast", "Photo-walk desk"]},
    {"id": "haveli_rang", "name": "Haveli Rang Mahal (heritage)", "type": "haveli", "lat": 26.9270, "lng": 75.8160,
     "zone": "old_city", "price_per_night": 6500, "per": "room", "checkin": "12:00", "checkout": "11:00",
     "for": ["family"], "perks": ["Family suite", "Courtyard dinner", "Kids' puppet show"]},
]

TRAINS = [
    {"id": "12015", "name": "Ajmer Shatabdi", "from": "NDLS", "to": "JP", "dep": "06:10", "arr": "10:35",
     "classes": {"CC": 865, "2S": 260}, "direction": "outbound"},
    {"id": "12985", "name": "Jaipur Double Decker", "from": "NDLS", "to": "JP", "dep": "07:30", "arr": "12:05",
     "classes": {"CC": 790, "2S": 240}, "direction": "outbound"},
    {"id": "12016", "name": "Ajmer Shatabdi", "from": "JP", "to": "NDLS", "dep": "17:45", "arr": "22:40",
     "classes": {"CC": 865, "2S": 260}, "direction": "return"},
    {"id": "12986", "name": "Jaipur Double Decker", "from": "JP", "to": "NDLS", "dep": "19:00", "arr": "23:35",
     "classes": {"CC": 790, "2S": 240}, "direction": "return"},
]

# Local transport modes. speed in km/h on flat roads, fare = base + per_km * km (per vehicle unless per_person)
MODES = {
    "walk": {"label": "Walk", "speed": 4.5, "base": 0, "per_km": 0, "wait": 0, "capacity": 99, "ac": False, "max_km": 1.2},
    "bus": {"label": "City bus", "speed": 14, "base": 15, "per_km": 0, "wait": 12, "capacity": 99, "ac": False,
            "per_person": True},
    "auto": {"label": "Auto-rickshaw", "speed": 20, "base": 30, "per_km": 14, "wait": 5, "capacity": 3, "ac": False},
    "express_auto": {"label": "Express auto (app, priority)", "speed": 23, "base": 50, "per_km": 17, "wait": 3,
                     "capacity": 3, "ac": False},
    "cab": {"label": "AC cab", "speed": 22, "base": 60, "per_km": 18, "wait": 6, "capacity": 4, "ac": True},
}

# Initial learned delay buffers (minutes) between zone pairs. Keys are sorted "a|b".
CORRIDOR_BUFFERS = {
    "old_city|station": 8,
    "amber_hill|old_city": 12,
    "amber_hill|central": 10,
    "amber_hill|station": 14,
    "nahargarh_hill|old_city": 10,
    "central|old_city": 6,
    "central|station": 5,
    "old_city|old_city": 4,
    "outskirts|central": 12,
    "outskirts|old_city": 15,
    "east|old_city": 7,
}
DEFAULT_BUFFER = 6

# Home addresses for the door-to-door legs (all in Delhi for the demo)
HOMES = {
    "student": {"label": "PG near North Campus, Delhi", "lat": 28.6880, "lng": 77.2090, "to_station_km": 9},
    "family": {"label": "Home in Dwarka, Delhi", "lat": 28.5921, "lng": 77.0460, "to_station_km": 22},
    "solo": {"label": "Apartment in Saket, Delhi", "lat": 28.5245, "lng": 77.2066, "to_station_km": 16},
}

PERSONAS = [
    {"id": "student", "label": "Student Backpacker", "emoji": "🎒", "travelers": 1, "budget": 6500, "days": 2,
     "interests": ["photography", "food", "history"], "pace": "packed", "stay_type": "hostel",
     "modes": ["walk", "bus", "auto", "express_auto"], "train_class": "2S", "outbound": "12015", "return": "12986",
     "day_start": "08:00", "day_end": "21:30",
     "description": "One traveller, tight budget, happy to walk and take buses."},
    {"id": "family", "label": "Family Weekend", "emoji": "👨‍👩‍👧", "travelers": 4, "budget": 32000, "days": 2,
     "interests": ["history", "culture", "food", "shopping"], "pace": "relaxed", "stay_type": "haveli",
     "modes": ["walk", "cab"], "train_class": "CC", "outbound": "12015", "return": "12016",
     "day_start": "09:00", "day_end": "20:30",
     "description": "Two adults, two kids. Comfort first, AC cabs, no rushed days."},
    {"id": "solo", "label": "Solo Photographer", "emoji": "📷", "travelers": 1, "budget": 14000, "days": 2,
     "interests": ["photography", "history", "nature"], "pace": "balanced", "stay_type": "boutique",
     "modes": ["walk", "auto", "express_auto", "cab"], "train_class": "CC", "outbound": "12015", "return": "12016",
     "day_start": "07:30", "day_end": "21:00",
     "description": "Chasing golden hour, sunsets and quiet corners."},
]

DEFAULT_WEIGHTS = {
    "interest": 1.2,     # how much interest match matters
    "flagship": 1.0,     # must-see pull
    "budget": 0.6,       # penalty for expensive stops relative to remaining budget
    "travel": 0.9,       # penalty per hour of travel to reach the stop
    "urgency": 0.5,      # bonus for stops that close soon
    "crowd": 0.4,        # penalty for arriving at crowd peak
}
