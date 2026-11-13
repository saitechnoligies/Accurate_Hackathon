from __future__ import annotations

from datetime import date, timedelta

from ..data.jaipur import HOMES


def make_profile(catalog: dict, persona_id: str, overrides: dict | None = None) -> dict:
    persona = next((p for p in catalog["personas"] if p["id"] == persona_id), None)
    if persona is None:
        raise ValueError(f"Unknown persona {persona_id}")
    o = {k: v for k, v in (overrides or {}).items() if v is not None}
    stay = next((s for s in catalog["stays"] if s["type"] == persona["stay_type"]), catalog["stays"][0])
    profile = {
        "persona_id": persona_id,
        "persona_label": persona["label"],
        "travelers": persona["travelers"],
        "budget": persona["budget"],
        "days": persona["days"],
        "interests": list(persona["interests"]),
        "pace": persona["pace"],
        "stay_id": stay["id"],
        "modes": list(persona["modes"]),
        "train_class": persona["train_class"],
        "outbound": persona["outbound"],
        "return": persona["return"],
        "day_start": persona["day_start"],
        "day_end": persona["day_end"],
        "home": dict(HOMES[persona_id]),
        "start_date": (date.today() + timedelta(days=7)).isoformat(),
        "diet": "any",
        "mobility": "normal",
        "avoid_heat": False,
    }
    for key in ("travelers", "budget", "days", "interests", "pace", "stay_id", "train_class", "outbound", "return",
                "start_date", "diet", "mobility", "avoid_heat", "day_start", "day_end"):
        if key in o:
            profile[key] = o[key]
    if "home_label" in o:
        profile["home"]["label"] = o["home_label"]
    profile["days"] = max(2, min(3, int(profile["days"])))
    profile["travelers"] = max(1, min(8, int(profile["travelers"])))
    profile["budget"] = max(1000, int(profile["budget"]))
    if profile["pace"] not in ("relaxed", "balanced", "packed"):
        profile["pace"] = persona["pace"]
    if profile["mobility"] == "limited" and "cab" not in profile["modes"]:
        profile["modes"].append("cab")
    return profile


def prefs_to_profile(profile: dict, p: dict) -> None:
    """Apply a user's saved preferences to an existing trip profile (re-plans it)."""
    if p.get("interests"):
        profile["interests"] = list(p["interests"])
    for k in ("pace", "diet", "mobility", "day_start", "day_end"):
        if p.get(k):
            profile[k] = p[k]
    if p.get("avoid_heat") is not None:
        profile["avoid_heat"] = bool(p["avoid_heat"])
    if profile.get("mobility") == "limited" and "cab" not in profile["modes"]:
        profile["modes"] = [*profile["modes"], "cab"]
