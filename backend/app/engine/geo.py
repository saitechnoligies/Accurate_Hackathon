"""Time helpers and the local travel model (hill physics + congestion + learned buffers)."""
from __future__ import annotations

import math

from ..data.jaipur import DEFAULT_BUFFER, MODES, ZONES

ROAD_FACTOR = 1.3          # straight line -> road distance
HILL_MULT = 1.35           # winding ghat roads up to Amber / Nahargarh
CONGESTION_MULT = 1.2      # narrow Old City lanes


def t2m(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def m2t(m: float) -> str:
    m = int(round(m))
    day_shift = m // 1440
    m %= 1440
    s = f"{m // 60:02d}:{m % 60:02d}"
    return s + (" (+1)" if day_shift else "")


def haversine_km(a: dict, b: dict) -> float:
    r = 6371.0
    lat1, lng1, lat2, lng2 = map(math.radians, [a["lat"], a["lng"], b["lat"], b["lng"]])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def corridor_key(z1: str, z2: str) -> str:
    return "|".join(sorted([z1, z2]))


def round5(x: float) -> int:
    return int(5 * round(x / 5))


def travel(a: dict, b: dict, mode: str, travelers: int, corridors: dict) -> dict | None:
    """Travel estimate between two located places (dicts with lat, lng, zone)."""
    spec = MODES[mode]
    km = haversine_km(a, b) * ROAD_FACTOR
    za, zb = a.get("zone", "central"), b.get("zone", "central")
    hill = ZONES.get(za, {}).get("hill") or ZONES.get(zb, {}).get("hill")
    hill_climb = hill and za != zb
    congested = ZONES.get(za, {}).get("congested") or ZONES.get(zb, {}).get("congested")

    if mode == "walk":
        if km > spec["max_km"] or hill_climb:
            return None
        minutes = km / spec["speed"] * 60
        return {"mode": mode, "km": round(km, 2), "minutes": max(3, round(minutes)), "base_minutes": round(minutes),
                "buffer": 0, "cost": 0, "hill": False, "congested": False}

    if km < 0.4:  # don't take a vehicle for a few hundred metres
        return None

    mult = 1.0
    if hill_climb:
        mult *= HILL_MULT
    if congested:
        mult *= CONGESTION_MULT
    base = km / spec["speed"] * 60 * mult
    buffer = corridors.get(corridor_key(za, zb), DEFAULT_BUFFER)
    minutes = spec["wait"] + base + buffer

    if spec.get("per_person"):
        cost = spec["base"] * travelers
    else:
        vehicles = math.ceil(travelers / spec["capacity"])
        cost = vehicles * (spec["base"] + spec["per_km"] * km)
    return {"mode": mode, "km": round(km, 2), "minutes": round(minutes), "base_minutes": round(spec["wait"] + base),
            "buffer": round(buffer, 1), "cost": round5(cost), "hill": bool(hill_climb), "congested": bool(congested)}
