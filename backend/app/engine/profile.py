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
    }
    for key in ("travelers", "budget", "days", "interests", "pace", "stay_id", "train_class", "outbound", "return",
                "start_date"):
        if key in o:
            profile[key] = o[key]
    if "home_label" in o:
        profile["home"]["label"] = o["home_label"]
    profile["days"] = max(2, min(3, int(profile["days"])))
    profile["travelers"] = max(1, min(8, int(profile["travelers"])))
    profile["budget"] = max(1000, int(profile["budget"]))
    return profile
