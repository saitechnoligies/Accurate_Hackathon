"""One-click demo identities (mirrors frontend engine/users.ts on the frontend-only branch)."""

DEFAULT_PREFS = {
    "interests": ["history", "culture", "food"],
    "pace": "balanced",
    "diet": "any",
    "mobility": "normal",
    "avoid_heat": False,
    "day_start": "09:00",
    "day_end": "20:30",
}

DEMO_USERS = [
    {"id": "priya", "name": "Priya", "emoji": "👩🏽", "color": "#2347d8",
     "prefs": {**DEFAULT_PREFS, "interests": ["history", "culture", "food"], "diet": "veg"}},
    {"id": "rohit", "name": "Rohit", "emoji": "👨🏽", "color": "#e0287d",
     "prefs": {**DEFAULT_PREFS, "interests": ["photography", "food", "nature"], "pace": "packed",
               "day_start": "07:30", "day_end": "21:30"}},
    {"id": "ananya", "name": "Ananya", "emoji": "👧🏽", "color": "#15935b",
     "prefs": {**DEFAULT_PREFS, "interests": ["shopping", "culture", "art"], "pace": "relaxed", "diet": "jain",
               "avoid_heat": True}},
    {"id": "kabir", "name": "Kabir", "emoji": "🧔🏽", "color": "#c77700",
     "prefs": {**DEFAULT_PREFS, "interests": ["history", "spiritual"], "pace": "relaxed", "diet": "veg",
               "mobility": "limited"}},
]
