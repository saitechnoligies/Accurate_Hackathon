"""DelayProof Trip API."""
from __future__ import annotations

import base64
import binascii
import functools
import json
import logging
import random
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import db as dbmod
from .data import jaipur
from .data.users import DEFAULT_PREFS
from .engine import learning, llm
from .engine.agent import Tools, run_agent
from .engine.geo import corridor_key
from .engine.profile import make_profile, prefs_to_profile
from .engine.replan import build_view
from .engine.scheduler import normalize_disruptions

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("delayproof")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await dbmod.connect()
    yield


app = FastAPI(title="DelayProof Trip API", version="2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return uuid.uuid4().hex[:10]


def invite_code() -> str:
    return "".join(random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))


def D():
    return dbmod.db()


# --------------------------------------------------------------------------- live updates (WebSocket)
class Hub:
    """Pushes {type, trip_id} events to every connected browser; clients refetch what they show."""

    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def emit(self, *events: dict):
        dead = []
        for ws in list(self.clients):
            for e in events:
                try:
                    await ws.send_text(json.dumps(e))
                except Exception:  # noqa: BLE001 - client went away
                    dead.append(ws)
                    break
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()


@app.websocket("/api/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    hub.clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive pings from the client
    except WebSocketDisconnect:
        hub.clients.discard(ws)


async def changed(trip_id: str, *extra: str):
    await hub.emit({"type": "trip", "trip_id": trip_id}, {"type": "messages", "trip_id": trip_id}, {"type": "trips"},
                   *({"type": e, "trip_id": trip_id} for e in extra))


# --------------------------------------------------------------------------- models
class TripCreate(BaseModel):
    persona_id: Literal["student", "family", "solo"] = "family"
    user_id: str = "priya"
    title: str | None = None
    use_prefs: bool = True
    travelers: int | None = Field(None, ge=1, le=8)
    budget: int | None = Field(None, ge=1000, le=500000)
    days: int | None = Field(None, ge=2, le=3)
    interests: list[str] | None = None
    pace: Literal["relaxed", "balanced", "packed"] | None = None
    diet: Literal["any", "veg", "jain"] | None = None
    mobility: Literal["normal", "limited"] | None = None
    avoid_heat: bool | None = None
    start_date: str | None = None
    home_label: str | None = None


class DisruptionUpdate(BaseModel):
    user_id: str | None = None
    train_delay_min: int | None = Field(None, ge=0, le=600)
    return_delay_min: int | None = Field(None, ge=0, le=300)
    weather: Literal["clear", "heat", "rain"] | None = None
    crowd: list[str] | None = None
    late_start: dict[str, int] | None = None


class UserReq(BaseModel):
    user_id: str | None = None


class StopReq(BaseModel):
    attraction_id: str
    user_id: str | None = None


class FeedbackReq(BaseModel):
    attraction_id: str
    action: Literal["kept", "skipped"]
    user_id: str | None = None


class RideLogReq(BaseModel):
    from_zone: str
    to_zone: str
    planned_min: float = Field(gt=0)
    actual_min: float = Field(gt=0)
    buffer_used: float | None = None


class WeightsReq(BaseModel):
    weights: dict[str, float]


class SimulateReq(BaseModel):
    persona_id: Literal["student", "family", "solo"] = "family"
    n: int = Field(400, ge=50, le=3000)
    apply: bool = False
    seed: int = 7


class NameReq(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class PrefsReq(BaseModel):
    prefs: dict[str, Any]
    user_id: str | None = None


class SettingsReq(BaseModel):
    ai_brain: Literal["offline", "llm"] = "offline"
    llm_key: str | None = None


class ModeReq(BaseModel):
    on: bool
    user_id: str


class MemberReq(BaseModel):
    user_id: str
    by: str


class JoinReq(BaseModel):
    code: str
    user_id: str


class ImportReq(BaseModel):
    payload: str
    user_id: str


class SendReq(BaseModel):
    user_id: str
    text: str = Field(min_length=1, max_length=2000)


class PollReq(BaseModel):
    user_id: str
    question: str
    options: list[dict]
    action: dict | None = None


class VoteReq(BaseModel):
    user_id: str
    option_id: str


class AgentReq(BaseModel):
    text: str
    user_id: str
    trip_id: str | None = None
    state: dict = Field(default_factory=lambda: {"slots": {}})


class TicketReq(BaseModel):
    user_id: str
    title: str
    kind: Literal["train", "hotel", "entry", "custom"] = "custom"
    subtitle: str | None = None
    code: str | None = None
    day: int | None = None
    item_id: str | None = None
    file: str | None = None
    file_name: str | None = None


class MemoryReq(BaseModel):
    user_id: str
    day: int
    stop: str
    item_id: str | None = None
    caption: str = ""
    photo: str | None = None


class JournalReq(BaseModel):
    user_id: str
    day: int
    text: str
    mood: str = "😊"
    shared: bool = False


# --------------------------------------------------------------------------- helpers
async def get_trip(trip_id: str) -> dict:
    trip = await D().trips.find_one({"_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    trip.setdefault("members", [{"user_id": trip.get("owner_id", "priya"), "role": "owner", "joined_at": now()}])
    trip.setdefault("owner_id", trip["members"][0]["user_id"])
    trip.setdefault("title", f"{trip['profile']['persona_label']} · Jaipur")
    trip.setdefault("mode_on", False)
    trip.setdefault("invite_code", "")
    return trip


async def user_name(uid: str | None) -> str:
    if not uid:
        return "DelayProof"
    u = await D().users.find_one({"_id": uid})
    return u["name"] if u else "Someone"


async def trip_view(trip: dict, message: str | None = None, catalog: dict | None = None) -> dict:
    catalog = catalog or await dbmod.load_catalog()
    view = build_view(catalog, trip["profile"], trip.get("disruptions"))
    return {"trip_id": trip["_id"], "title": trip.get("title"), "owner_id": trip.get("owner_id"),
            "members": trip.get("members", []), "mode_on": trip.get("mode_on", False),
            "invite_code": trip.get("invite_code"), "profile": trip["profile"], "feedback": trip.get("feedback", {}),
            "message": message, **view}


def summary(t: dict) -> dict:
    p = t["profile"]
    return {"trip_id": t["_id"], "title": t.get("title") or p["persona_label"], "persona_label": p["persona_label"],
            "start_date": p["start_date"], "days": p["days"], "travelers": p["travelers"],
            "owner_id": t.get("owner_id"), "members": t.get("members", []), "mode_on": t.get("mode_on", False),
            "budget": p["budget"], "updated_at": t.get("updated_at", now())}


async def save_trip(trip: dict, **fields):
    fields["updated_at"] = now()
    await D().trips.update_one({"_id": trip["_id"]}, {"$set": fields})
    trip.update(fields)


async def post(trip_id: str, user_id: str, kind: str, text: str, **extra) -> dict:
    msg = {"_id": new_id(), "trip_id": trip_id, "user_id": user_id, "kind": kind, "text": text, "at": now(), **extra}
    await D().messages.insert_one(msg)
    return msg


async def system(trip_id: str, text: str):
    await post(trip_id, "system", "system", text)


async def announce(trip: dict, uid: str | None, what: str):
    """Every plan change is announced in the group thread with the engine's own explanation."""
    v = build_view(await dbmod.load_catalog(), trip["profile"], trip.get("disruptions"))
    first = next((c for c in v["changes"] if c["kind"] in ("moved", "dropped", "added")), None)
    detail = ""
    if v["banner"]["active"]:
        detail = f" {v['banner']['headline']}."
        if first:
            detail += f" {first['name']}: {first['kind']}" + (f" to Day {first['to_day']} {first['to']}" if first["kind"] == "moved" else "") + "."
    await system(trip["_id"], f"🛡️ {await user_name(uid)} {what}.{detail}")


def clean(doc: dict) -> dict:
    d = dict(doc)
    d["id"] = d.pop("_id")
    return d


def describe_patch(p: dict) -> str:
    out = []
    if p.get("train_delay_min") is not None:
        out.append(f"the train running {p['train_delay_min']} min late" if p["train_delay_min"] else "the train on time")
    if p.get("return_delay_min") is not None:
        out.append(f"the return train {p['return_delay_min']} min late" if p["return_delay_min"] else "the return train on time")
    if p.get("weather"):
        out.append({"clear": "clear weather", "heat": "42°C heat", "rain": "rain"}[p["weather"]])
    if p.get("crowd") is not None:
        out.append("a crowd surge" if p["crowd"] else "crowds cleared")
    if p.get("late_start") is not None:
        out.append("a late start")
    return ", ".join(out) or "a change"


# --- trip mutations shared by the REST routes, polls and the assistant
async def mut_disrupt(trip_id: str, patch: dict, uid: str | None, label: str | None = None) -> dict:
    trip = await get_trip(trip_id)
    d = normalize_disruptions(trip.get("disruptions"))
    for k, v in patch.items():
        if v is not None:
            d[k] = v
    d = normalize_disruptions(d)
    await save_trip(trip, disruptions=d)
    await announce(trip, uid, f"reported {label or describe_patch(patch)}")
    await changed(trip_id)
    return trip


async def mut_swap(trip_id: str, attraction_id: str, uid: str | None) -> tuple[dict, str]:
    trip = await get_trip(trip_id)
    view = await trip_view(trip)
    it = next((i for day in view["days"] for i in day["items"]
               if i.get("attraction_id") == attraction_id and i["type"] == "visit"), None)
    if not it or not it.get("plan_b"):
        raise ValueError("No Plan B available for this stop")
    d = normalize_disruptions(trip.get("disruptions"))
    d["swaps"][attraction_id] = it["plan_b"]["id"]
    d["swap_days"][it["plan_b"]["id"]] = it["day"]
    await save_trip(trip, disruptions=d)
    await system(trip_id, f"🔁 {await user_name(uid)} swapped {it['title']} for {it['plan_b']['name']}.")
    await changed(trip_id)
    return trip, f"Swapped {it['title']} for {it['plan_b']['name']} ({it['plan_b']['reason']})."


def attraction(aid: str) -> dict | None:
    return next((a for a in jaipur.ATTRACTIONS if a["id"] == aid), None)


async def mut_skip(trip_id: str, aid: str, uid: str | None) -> dict:
    trip = await get_trip(trip_id)
    d = normalize_disruptions(trip.get("disruptions"))
    if aid not in d["skipped"]:
        d["skipped"].append(aid)
    d["pins"] = [x for x in d["pins"] if x != aid]
    await save_trip(trip, disruptions=d)
    await system(trip_id, f"✕ {await user_name(uid)} skipped {(attraction(aid) or {}).get('name', aid)}; plan re-arranged.")
    await changed(trip_id)
    return trip


async def mut_pin(trip_id: str, aid: str, uid: str | None) -> dict:
    trip = await get_trip(trip_id)
    d = normalize_disruptions(trip.get("disruptions"))
    if aid not in d["pins"]:
        d["pins"].append(aid)
    d["skipped"] = [x for x in d["skipped"] if x != aid]
    await save_trip(trip, disruptions=d)
    await system(trip_id, f"📌 {await user_name(uid)} added {(attraction(aid) or {}).get('name', aid)} to the plan.")
    await changed(trip_id)
    return trip


async def mut_reset(trip_id: str, uid: str | None) -> dict:
    trip = await get_trip(trip_id)
    await save_trip(trip, disruptions=normalize_disruptions({}), feedback={})
    await system(trip_id, f"↺ {await user_name(uid)} reset the plan to the original package.")
    await changed(trip_id)
    return trip


async def new_trip(uid: str, opts: dict, title: str | None) -> dict:
    catalog = await dbmod.load_catalog()
    profile = make_profile(catalog, opts["persona_id"], opts)
    trip = {"_id": new_id(), "title": title or f"{profile['persona_label']} · Jaipur", "owner_id": uid,
            "members": [{"user_id": uid, "role": "owner", "joined_at": now()}], "mode_on": False,
            "invite_code": invite_code(), "profile": profile, "disruptions": normalize_disruptions({}),
            "feedback": {}, "ride_logs": [], "created_at": now(), "updated_at": now()}
    await D().trips.insert_one(trip)
    await system(trip["_id"], f"✨ {await user_name(uid)} created \"{trip['title']}\". Invite friends with code {trip['invite_code']}.")
    await hub.emit({"type": "trips"})
    return trip


def run(coro_fn):
    """Turn engine ValueErrors into HTTP 400s."""
    @functools.wraps(coro_fn)
    async def wrapper(*a, **kw):
        try:
            return await coro_fn(*a, **kw)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
    return wrapper


# --------------------------------------------------------------------------- meta, users, settings
@app.get("/api/health")
async def health():
    return {"ok": True, "db": dbmod.db_mode, "ai_brain": llm.brain()}


@app.get("/api/meta")
async def meta():
    catalog = await dbmod.load_catalog()
    return {"city": jaipur.CITY, "origin": jaipur.ORIGIN, "personas": catalog["personas"], "stays": catalog["stays"],
            "trains": catalog["trains"], "attractions": catalog["attractions"], "zones": jaipur.ZONES,
            "modes": jaipur.MODES, "homes": jaipur.HOMES,
            "interests": sorted({t for a in catalog["attractions"] for t in a["tags"]}), "db": dbmod.db_mode}


@app.get("/api/users")
async def users():
    return [clean(u) for u in await D().users.find({}).to_list(200)]


@app.post("/api/users")
async def create_user(req: NameReq):
    base = re.sub(r"[^a-z0-9]+", "-", req.name.lower()).strip("-") or new_id()
    uid = base if not await D().users.find_one({"_id": base}) else f"{base}-{new_id()[:4]}"
    colors = ["#2347d8", "#e0287d", "#15935b", "#c77700", "#7a3fd6", "#0f8aa8"]
    n = await D().users.count_documents({})
    doc = {"_id": uid, "name": req.name, "emoji": "🙂", "color": colors[n % len(colors)], "prefs": dict(DEFAULT_PREFS)}
    await D().users.insert_one(doc)
    await hub.emit({"type": "trips"})
    return clean(doc)


@app.put("/api/users/{uid}/prefs")
async def save_prefs(uid: str, req: PrefsReq):
    u = await D().users.find_one({"_id": uid})
    if not u:
        raise HTTPException(404, "Unknown user")
    await D().users.update_one({"_id": uid}, {"$set": {"prefs": req.prefs}})
    return clean({**u, "prefs": req.prefs})


@app.get("/api/settings")
async def get_settings():
    s = await D().settings.find_one({"_id": "ai"}) or {}
    return {"ai_brain": s.get("ai_brain", "offline"), "has_key": llm.has_key(), "active": llm.brain()}


@app.put("/api/settings")
async def put_settings(req: SettingsReq):
    # the key itself is never accepted from the browser on the server build: it lives in backend/.env
    await D().settings.update_one({"_id": "ai"}, {"$set": {"ai_brain": req.ai_brain}}, upsert=True)
    return await get_settings()


# --------------------------------------------------------------------------- trips
@app.get("/api/users/{uid}/trips")
async def list_trips(uid: str):
    docs = await D().trips.find({"members.user_id": uid}).to_list(200)
    return [summary(t) for t in sorted(docs, key=lambda t: t.get("updated_at", ""), reverse=True)]


@app.post("/api/trips")
async def create_trip(req: TripCreate):
    opts = req.model_dump(exclude={"user_id", "title", "use_prefs"})
    if req.use_prefs:
        u = await D().users.find_one({"_id": req.user_id})
        if u:
            p = u.get("prefs", {})
            for k in ("diet", "mobility", "avoid_heat"):
                if opts.get(k) is None and p.get(k) is not None:
                    opts[k] = p[k]
    try:
        trip = await new_trip(req.user_id, opts, req.title)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return await trip_view(trip)


@app.get("/api/trips/{trip_id}")
async def read_trip(trip_id: str):
    return await trip_view(await get_trip(trip_id))


@app.delete("/api/trips/{trip_id}")
async def delete_trip(trip_id: str, user_id: str):
    trip = await get_trip(trip_id)
    if trip["owner_id"] == user_id:
        await D().trips.delete_one({"_id": trip_id})
        for coll in ("messages", "packing", "expenses", "tickets", "memories", "journal"):
            await D()[coll].delete_many({"trip_id": trip_id})
    else:
        await save_trip(trip, members=[m for m in trip["members"] if m["user_id"] != user_id])
    await hub.emit({"type": "trips"})
    return True


@app.post("/api/trips/{trip_id}/disruptions")
async def set_disruptions(trip_id: str, req: DisruptionUpdate):
    patch = req.model_dump(exclude_none=True, exclude={"user_id"})
    return await trip_view(await mut_disrupt(trip_id, patch, req.user_id))


@app.post("/api/trips/{trip_id}/reset")
async def reset_trip(trip_id: str, req: UserReq | None = None):
    trip = await mut_reset(trip_id, req.user_id if req else None)
    return await trip_view(trip, "Plan reset to the original package.")


@app.post("/api/trips/{trip_id}/swap")
@run
async def swap(trip_id: str, req: StopReq):
    trip, msg = await mut_swap(trip_id, req.attraction_id, req.user_id)
    return await trip_view(trip, msg)


@app.post("/api/trips/{trip_id}/pin")
async def pin(trip_id: str, req: StopReq):
    return await trip_view(await mut_pin(trip_id, req.attraction_id, req.user_id))


@app.post("/api/trips/{trip_id}/prefs")
async def apply_prefs(trip_id: str, req: PrefsReq):
    trip = await get_trip(trip_id)
    profile = dict(trip["profile"])
    prefs_to_profile(profile, req.prefs)
    await save_trip(trip, profile=profile)
    p = req.prefs
    bits = [x for x in [f"{p.get('diet')} meals" if p.get("diet") not in (None, "any") else "",
                        "limited mobility" if p.get("mobility") == "limited" else "",
                        "no midday heat" if p.get("avoid_heat") else "", f"{p['pace']} pace" if p.get("pace") else ""] if x]
    await announce(trip, req.user_id, f"applied preferences ({', '.join(bits) or 'interests & hours'})")
    await changed(trip_id)
    return await trip_view(trip, "Preferences applied: the plan was rebuilt around them.")


@app.post("/api/trips/{trip_id}/mode")
async def set_mode(trip_id: str, req: ModeReq):
    trip = await get_trip(trip_id)
    await save_trip(trip, mode_on=req.on)
    name = await user_name(req.user_id)
    await system(trip_id, f"🧭 {name} turned on Trip mode. Live guidance is active." if req.on else f"⏸ {name} turned off Trip mode.")
    await changed(trip_id)
    return await trip_view(trip)


@app.post("/api/trips/{trip_id}/feedback")
async def feedback(trip_id: str, req: FeedbackReq):
    trip = await get_trip(trip_id)
    a = attraction(req.attraction_id)
    if not a:
        raise HTTPException(404, "Unknown attraction")
    profile = trip["profile"]
    model = await D().model.find_one({"_id": "weights"})
    weights = model["weights"]
    aff_all = model.get("tag_affinity", {})
    aff = aff_all.get(profile["persona_id"], {})
    before = dict(weights)
    x = learning.features(a, profile["interests"], profile["travelers"])
    p = learning.update(weights, aff, x, req.action == "kept")
    aff_all[profile["persona_id"]] = aff
    await D().model.update_one({"_id": "weights"}, {"$set": {"weights": weights, "tag_affinity": aff_all},
                                                     "$inc": {"updates": 1}})
    await D().feedback.insert_one({"trip_id": trip_id, "persona_id": profile["persona_id"], "attraction_id": a["id"],
                                   "action": req.action, "predicted": round(p, 3), "synthetic": False, "at": now()})
    fb = {**trip.get("feedback", {}), a["id"]: req.action}
    d = normalize_disruptions(trip.get("disruptions"))
    if req.action == "skipped" and a["id"] not in d["skipped"]:
        d["skipped"].append(a["id"])
    await save_trip(trip, feedback=fb, disruptions=d)
    if req.action == "skipped":
        await system(trip_id, f"✕ {await user_name(req.user_id)} skipped {a['name']}; plan re-arranged.")
    await changed(trip_id)
    delta = {k: round(weights[k] - before[k], 4) for k in ("interest", "flagship", "budget", "travel")}
    msg = (f"Marked {a['name']} as {req.action}. Model predicted keep-probability {p:.0%}; weights nudged "
           + ", ".join(f"{k} {'+' if v >= 0 else ''}{v}" for k, v in delta.items() if v) + ".")
    if req.action == "skipped":
        msg += " Re-planned without it."
    view = await trip_view(trip, msg)
    view["learning_delta"] = delta
    return view


@app.post("/api/trips/{trip_id}/ride-log")
async def ride_log(trip_id: str, req: RideLogReq):
    await get_trip(trip_id)
    key = corridor_key(req.from_zone, req.to_zone)
    doc = await D().corridors.find_one({"_id": key}) or {"_id": key, "buffer": 6.0, "initial": 6.0, "samples": 0}
    buffer_used = req.buffer_used if req.buffer_used is not None else doc["buffer"]
    new = learning.update_corridor(doc["buffer"], req.planned_min - buffer_used, req.actual_min)
    await D().corridors.update_one({"_id": key}, {"$set": {"buffer": new, "initial": doc.get("initial", 6.0)},
                                                  "$inc": {"samples": 1}}, upsert=True)
    await D().trips.update_one({"_id": trip_id}, {"$push": {"ride_logs": {**req.model_dump(), "at": now()}}})
    await changed(trip_id)
    return await trip_view(await get_trip(trip_id),
                           f"Logged ride on {key.replace('|', ' ↔ ')}: buffer {doc['buffer']:.1f} → {new:.1f} min "
                           f"(you took {req.actual_min:.0f} min vs {req.planned_min:.0f} planned).")


# --------------------------------------------------------------------------- members & sharing
@app.post("/api/trips/{trip_id}/members")
async def add_member(trip_id: str, req: MemberReq):
    trip = await get_trip(trip_id)
    if not any(m["user_id"] == req.user_id for m in trip["members"]):
        await save_trip(trip, members=[*trip["members"], {"user_id": req.user_id, "role": "editor", "joined_at": now()}])
        await system(trip_id, f"👋 {await user_name(req.by)} added {await user_name(req.user_id)} to the trip.")
    await changed(trip_id)
    return await trip_view(trip)


@app.delete("/api/trips/{trip_id}/members/{uid}")
async def remove_member(trip_id: str, uid: str, by: str):
    trip = await get_trip(trip_id)
    if uid == trip["owner_id"]:
        raise HTTPException(400, "The owner cannot be removed")
    await save_trip(trip, members=[m for m in trip["members"] if m["user_id"] != uid])
    await system(trip_id, f"{await user_name(by)} removed {await user_name(uid)}.")
    await changed(trip_id)
    return await trip_view(trip)


@app.post("/api/join")
async def join(req: JoinReq):
    trip = await D().trips.find_one({"invite_code": req.code.strip().upper()})
    if not trip:
        raise HTTPException(404, f"No trip with invite code {req.code}")
    trip = await get_trip(trip["_id"])
    if not any(m["user_id"] == req.user_id for m in trip["members"]):
        await save_trip(trip, members=[*trip["members"], {"user_id": req.user_id, "role": "editor", "joined_at": now()}])
        await system(trip["_id"], f"👋 {await user_name(req.user_id)} joined with the invite code.")
    await changed(trip["_id"])
    return await trip_view(trip)


@app.post("/api/trips/import")
async def import_trip(req: ImportReq):
    try:
        raw = base64.urlsafe_b64decode(req.payload + "=" * (-len(req.payload) % 4)).decode("utf-8")
        p = json.loads(raw)
    except (binascii.Error, ValueError, UnicodeDecodeError) as e:
        raise HTTPException(400, "That share link is damaged") from e
    trip = await new_trip(req.user_id, {"persona_id": p["profile"]["persona_id"]}, f"{p['title']} (shared copy)")
    await save_trip(trip, profile=p["profile"], disruptions=normalize_disruptions(p.get("disruptions")))
    return await trip_view(trip)


# --------------------------------------------------------------------------- group chat & polls
async def thread(trip_id: str) -> list[dict]:
    return [clean(m) for m in await D().messages.find({"trip_id": trip_id}).sort("at", 1).to_list(1000)]


@app.get("/api/trips/{trip_id}/messages")
async def messages(trip_id: str):
    return await thread(trip_id)


@app.post("/api/trips/{trip_id}/messages")
async def send(trip_id: str, req: SendReq):
    await get_trip(trip_id)
    await post(trip_id, req.user_id, "text", req.text)
    if re.match(r"^\s*@(ai|assistant|delayproof)\b", req.text, re.I):
        q = re.sub(r"^\s*@\w+\s*", "", req.text)
        r = await run_agent(q, {"slots": {}}, await agent_tools(req.user_id, trip_id))
        await post(trip_id, "agent", "agent", r["reply"], cards=r["cards"])
    await changed(trip_id)
    return await thread(trip_id)


@app.post("/api/trips/{trip_id}/polls")
async def create_poll(trip_id: str, req: PollReq):
    await get_trip(trip_id)
    await post(trip_id, req.user_id, "poll", req.question,
               poll={"question": req.question, "options": req.options, "action": req.action, "votes": {}})
    await changed(trip_id)
    return await thread(trip_id)


@app.post("/api/trips/{trip_id}/messages/{mid}/vote")
async def vote(trip_id: str, mid: str, req: VoteReq):
    trip = await get_trip(trip_id)
    m = await D().messages.find_one({"_id": mid, "trip_id": trip_id})
    if not m or not m.get("poll"):
        raise HTTPException(404, "Poll not found")
    poll = m["poll"]
    if poll.get("closed"):
        raise HTTPException(400, "This poll is closed")
    poll["votes"][req.user_id] = req.option_id
    counts: dict[str, int] = {}
    for v in poll["votes"].values():
        counts[v] = counts.get(v, 0) + 1
    need = len(trip["members"]) // 2 + 1
    winner = next((o for o, n in counts.items() if n >= need), None)
    if winner or len(poll["votes"]) >= len(trip["members"]):
        win = winner or max(counts.items(), key=lambda kv: kv[1])[0]
        label = next((o["label"] for o in poll["options"] if o["id"] == win), win)
        poll["closed"], poll["result"] = True, label
        await D().messages.update_one({"_id": mid}, {"$set": {"poll": poll}})
        action = poll.get("action") or {}
        if action.get("type") == "swap" and win == "yes":
            try:
                await mut_swap(trip_id, action["attraction_id"], None)
                await system(trip_id, f"🗳️ The group voted yes: switched to {action['alt_name']}.")
            except ValueError as e:
                await system(trip_id, f"🗳️ Voted yes, but {str(e).lower()}.")
        else:
            await system(trip_id, f"🗳️ Poll closed: \"{poll['question']}\" → {label}.")
    else:
        await D().messages.update_one({"_id": mid}, {"$set": {"poll": poll}})
    await changed(trip_id)
    return await thread(trip_id)


# --------------------------------------------------------------------------- AI assistant
async def agent_tools(uid: str, trip_id: str | None) -> Tools:
    catalog = await dbmod.load_catalog()
    u = await D().users.find_one({"_id": uid}) or {}
    trip_doc = await get_trip(trip_id) if trip_id else None
    trip = await trip_view(trip_doc, catalog=catalog) if trip_doc else None

    def preview(c: dict):
        profile = make_profile(catalog, c["persona_id"], c)
        return profile, build_view(catalog, profile, {})

    async def create(c: dict, title: str):
        return await trip_view(await new_trip(uid, c, title))

    async def disrupt(patch: dict, label: str):
        return await trip_view(await mut_disrupt(trip_id, patch, uid, label))

    async def skip(aid: str):
        return await trip_view(await mut_skip(trip_id, aid, uid))

    async def pin_(aid: str):
        return await trip_view(await mut_pin(trip_id, aid, uid))

    async def swap_(aid: str):
        t, msg = await mut_swap(trip_id, aid, uid)
        return await trip_view(t, msg)

    async def reset_():
        return await trip_view(await mut_reset(trip_id, uid))

    return Tools(catalog=catalog, trip=trip, prefs=u.get("prefs", DEFAULT_PREFS), preview=preview, create_trip=create,
                 disrupt=disrupt, skip=skip, pin=pin_, swap=swap_, reset=reset_)


@app.post("/api/agent")
async def agent(req: AgentReq):
    return await run_agent(req.text, req.state, await agent_tools(req.user_id, req.trip_id))


# --------------------------------------------------------------------------- files, wallet, memories, journal
MAX_FILE = 4_000_000


async def store_file(data_url: str) -> str:
    if len(data_url) > MAX_FILE * 1.4:
        raise HTTPException(413, "Files up to about 4 MB please")
    if not data_url.startswith("data:"):
        raise HTTPException(400, "Expected a data URL")
    fid = new_id()
    await D().files.insert_one({"_id": fid, "data": data_url, "at": now()})
    return fid


@app.get("/api/files/{fid}")
async def get_file(fid: str):
    f = await D().files.find_one({"_id": fid})
    if not f:
        raise HTTPException(404, "File not found")
    head, b64 = f["data"].split(",", 1)
    mime = head[5:].split(";")[0] or "application/octet-stream"
    return Response(base64.b64decode(b64), media_type=mime, headers={"Cache-Control": "private, max-age=86400"})


def with_file(doc: dict, field: str) -> dict:
    d = clean(doc)
    fid = d.pop("file_id", None)
    d[field] = f"/api/files/{fid}" if fid else None
    return d


@app.get("/api/trips/{trip_id}/tickets")
async def tickets(trip_id: str):
    return [with_file(t, "file") for t in await D().tickets.find({"trip_id": trip_id}).sort("at", 1).to_list(500)]


@app.post("/api/trips/{trip_id}/tickets")
async def add_ticket(trip_id: str, req: TicketReq):
    await get_trip(trip_id)
    doc = {"_id": new_id(), "trip_id": trip_id, "title": req.title, "kind": req.kind, "subtitle": req.subtitle,
           "code": req.code, "day": req.day, "item_id": req.item_id, "file_name": req.file_name,
           "added_by": req.user_id, "at": now()}
    if req.file:
        doc["file_id"] = await store_file(req.file)
    await D().tickets.insert_one(doc)
    await system(trip_id, f"🎫 {await user_name(req.user_id)} added a ticket: {req.title}.")
    await changed(trip_id, "tickets")
    return True


@app.delete("/api/trips/{trip_id}/tickets/{tid}")
async def delete_ticket(trip_id: str, tid: str):
    t = await D().tickets.find_one({"_id": tid, "trip_id": trip_id})
    if t and t.get("file_id"):
        await D().files.delete_one({"_id": t["file_id"]})
    await D().tickets.delete_one({"_id": tid})
    await hub.emit({"type": "tickets", "trip_id": trip_id})
    return True


@app.get("/api/trips/{trip_id}/memories")
async def memories(trip_id: str):
    return [with_file(m, "photo") for m in await D().memories.find({"trip_id": trip_id}).sort("at", 1).to_list(1000)]


@app.post("/api/trips/{trip_id}/memories")
async def add_memory(trip_id: str, req: MemoryReq):
    await get_trip(trip_id)
    doc = {"_id": new_id(), "trip_id": trip_id, "user_id": req.user_id, "day": req.day, "stop": req.stop,
           "item_id": req.item_id, "caption": req.caption, "at": now()}
    if req.photo:
        doc["file_id"] = await store_file(req.photo)
    await D().memories.insert_one(doc)
    cap = f": \"{req.caption}\"" if req.caption else ""
    await system(trip_id, f"📸 {await user_name(req.user_id)} saved a memory at {req.stop}{cap}.")
    await changed(trip_id, "memories")
    return True


@app.delete("/api/trips/{trip_id}/memories/{mid}")
async def delete_memory(trip_id: str, mid: str):
    m = await D().memories.find_one({"_id": mid, "trip_id": trip_id})
    if m and m.get("file_id"):
        await D().files.delete_one({"_id": m["file_id"]})
    await D().memories.delete_one({"_id": mid})
    await hub.emit({"type": "memories", "trip_id": trip_id})
    return True


@app.get("/api/trips/{trip_id}/journal")
async def journal(trip_id: str, user_id: str):
    docs = await D().journal.find({"trip_id": trip_id, "$or": [{"user_id": user_id}, {"shared": True}]}).to_list(500)
    out = []
    for j in sorted(docs, key=lambda j: (j["day"], j["user_id"])):
        j = dict(j)
        j.pop("_id", None)
        out.append(j)
    return out


@app.put("/api/trips/{trip_id}/journal")
async def save_journal(trip_id: str, req: JournalReq):
    rec = {"trip_id": trip_id, "day": req.day, "user_id": req.user_id, "text": req.text, "mood": req.mood,
           "shared": req.shared, "updated_at": now()}
    await D().journal.update_one({"_id": f"{trip_id}|{req.day}|{req.user_id}"}, {"$set": rec}, upsert=True)
    await hub.emit({"type": "journal", "trip_id": trip_id})
    return rec


# --------------------------------------------------------------------------- packing (shared by the group)
class PackItemIn(BaseModel):
    text: str = Field(min_length=1, max_length=80)
    category: str = "Other"
    why: str | None = None


class PackingReq(BaseModel):
    user_id: str
    items: list[PackItemIn]


class PackPatch(BaseModel):
    done_by: str | None = None
    assignee: str | None = None
    fields: list[str] = Field(default_factory=list)


async def packing_list(trip_id: str) -> list[dict]:
    return [clean(p) for p in await D().packing.find({"trip_id": trip_id}).sort("at", 1).to_list(500)]


@app.get("/api/trips/{trip_id}/packing")
async def packing(trip_id: str):
    return await packing_list(trip_id)


@app.post("/api/trips/{trip_id}/packing")
async def add_packing(trip_id: str, req: PackingReq):
    await get_trip(trip_id)
    have = {p["text"].lower() for p in await packing_list(trip_id)}
    fresh = [i for i in req.items if i.text.strip() and i.text.strip().lower() not in have]
    if fresh:
        await D().packing.insert_many([{"_id": new_id(), "trip_id": trip_id, "text": i.text.strip(), "category": i.category or "Other",
                                        "why": i.why, "added_by": req.user_id, "at": now()} for i in fresh])
    if len(fresh) > 1:
        await system(trip_id, f"🧳 {await user_name(req.user_id)} added {len(fresh)} items to the packing list.")
        await hub.emit({"type": "messages", "trip_id": trip_id})
    await hub.emit({"type": "packing", "trip_id": trip_id})
    return await packing_list(trip_id)


@app.patch("/api/trips/{trip_id}/packing/{item_id}")
async def update_packing(trip_id: str, item_id: str, req: PackPatch):
    fields = {k: getattr(req, k) for k in ("done_by", "assignee") if k in req.fields}
    if fields:
        r = await D().packing.update_one({"_id": item_id, "trip_id": trip_id}, {"$set": fields})
        if not r.matched_count:
            raise HTTPException(404, "Item not found")
    await hub.emit({"type": "packing", "trip_id": trip_id})
    return await packing_list(trip_id)


@app.delete("/api/trips/{trip_id}/packing/{item_id}")
async def delete_packing(trip_id: str, item_id: str):
    await D().packing.delete_one({"_id": item_id, "trip_id": trip_id})
    await hub.emit({"type": "packing", "trip_id": trip_id})
    return await packing_list(trip_id)


# --------------------------------------------------------------------------- expenses & settle-up
class ExpenseReq(BaseModel):
    user_id: str
    title: str = Field(min_length=1, max_length=60)
    amount: float = Field(gt=0, le=1_000_000)
    paid_by: str
    split: list[str] = Field(default_factory=list)
    day: int = 1
    category: Literal["package", "extra"] = "extra"


async def expense_list(trip_id: str) -> list[dict]:
    return [clean(e) for e in await D().expenses.find({"trip_id": trip_id}).sort("at", 1).to_list(1000)]


@app.get("/api/trips/{trip_id}/expenses")
async def expenses(trip_id: str):
    return await expense_list(trip_id)


@app.post("/api/trips/{trip_id}/expenses")
async def add_expense(trip_id: str, req: ExpenseReq):
    trip = await get_trip(trip_id)
    split = req.split or [m["user_id"] for m in trip["members"]]
    await D().expenses.insert_one({"_id": new_id(), "trip_id": trip_id, "title": req.title, "amount": req.amount,
                                   "paid_by": req.paid_by, "split": split, "day": req.day, "category": req.category, "at": now()})
    if req.category == "extra":
        logged = f", logged by {await user_name(req.user_id)}" if req.user_id != req.paid_by else ""
        await system(trip_id, f"💸 {await user_name(req.paid_by)} paid ₹{round(req.amount):,} for {req.title} "
                              f"(split {len(split)} way{'s' if len(split) > 1 else ''}){logged}.")
        await hub.emit({"type": "messages", "trip_id": trip_id})
    await hub.emit({"type": "expenses", "trip_id": trip_id})
    return await expense_list(trip_id)


@app.post("/api/trips/{trip_id}/expenses/package")
async def add_package_expenses(trip_id: str, req: UserReq):
    trip = await get_trip(trip_id)
    view = await trip_view(trip)
    members = [m["user_id"] for m in trip["members"]]
    await D().expenses.delete_many({"trip_id": trip_id, "category": "package"})
    docs = [{"_id": new_id(), "trip_id": trip_id, "title": ln["label"], "amount": ln["amount"], "paid_by": req.user_id,
             "split": members, "day": 1, "category": "package", "at": now()} for ln in view["receipt"]["lines"] if ln["amount"] > 0]
    if docs:
        await D().expenses.insert_many(docs)
    await system(trip_id, f"🧾 {await user_name(req.user_id)} paid the package (₹{view['receipt']['total']:,}); "
                          f"it is now split across {len(members)} members.")
    await hub.emit({"type": "expenses", "trip_id": trip_id}, {"type": "messages", "trip_id": trip_id})
    return await expense_list(trip_id)


@app.delete("/api/trips/{trip_id}/expenses/{eid}")
async def delete_expense(trip_id: str, eid: str):
    await D().expenses.delete_one({"_id": eid, "trip_id": trip_id})
    await hub.emit({"type": "expenses", "trip_id": trip_id})
    return await expense_list(trip_id)


# --------------------------------------------------------------------------- live calendar feed
CAL_TYPES = {"home", "train", "checkin", "cloakroom", "visit", "meal", "checkout", "arrive_home"}


def _ics_dt(day: str, mins: int) -> str:
    d = datetime.fromisoformat(day) + timedelta(minutes=mins)
    return d.strftime("%Y%m%dT%H%M%S")


def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


@app.get("/api/trips/{trip_id}/calendar.ics")
async def calendar(trip_id: str):
    """Subscribable calendar: it is rebuilt from the live plan on every refresh, so re-plans reach the phone."""
    view = await trip_view(await get_trip(trip_id))
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DelayProof Trip//EN", "CALSCALE:GREGORIAN",
             f"X-WR-CALNAME:{_esc(view['title'] or 'DelayProof trip')}", "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
             "X-PUBLISHED-TTL:PT15M"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    for d in view["days"]:
        for it in d["items"]:
            if it["type"] not in CAL_TYPES:
                continue
            end = max(it["end_min"], it["start_min"] + (15 if it["type"] in ("home", "arrive_home") else 0))
            prefix = "🏠 " if it["type"] == "home" else "🚆 " if it["type"] == "train" else ""
            desc = "\n".join(x for x in [it.get("subtitle"), it.get("blurb"), *it["notes"]] if x)
            lines += ["BEGIN:VEVENT", f"UID:{trip_id}-{it['id']}@delayproof", f"DTSTAMP:{stamp}",
                      f"DTSTART:{_ics_dt(d['date'], it['start_min'])}", f"DTEND:{_ics_dt(d['date'], end)}",
                      f"SUMMARY:{_esc(prefix + it['title'])}", f"DESCRIPTION:{_esc(desc)}"]
            if it["type"] in ("home", "train"):
                lines += ["BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", f"DESCRIPTION:{_esc(it['title'])} in 30 min",
                          "END:VALARM"]
            lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return Response("\r\n".join(lines), media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": f'inline; filename="delayproof-{trip_id}.ics"'})


# --------------------------------------------------------------------------- learning / judge drawer
@app.get("/api/learning")
async def learning_state():
    model = await D().model.find_one({"_id": "weights"})
    corridors = [{"corridor": x["_id"], "buffer": x["buffer"], "initial": x.get("initial", x["buffer"]),
                  "samples": x.get("samples", 0)} async for x in D().corridors.find({})]
    real = await D().feedback.count_documents({"synthetic": False})
    synthetic = await D().feedback.count_documents({"synthetic": True})
    return {"weights": model["weights"], "defaults": jaipur.DEFAULT_WEIGHTS, "tag_affinity": model.get("tag_affinity", {}),
            "updates": model.get("updates", 0), "corridors": sorted(corridors, key=lambda c: c["corridor"]),
            "feedback": {"real": real, "synthetic": synthetic}, "db": dbmod.db_mode}


@app.put("/api/learning/weights")
async def set_weights(req: WeightsReq):
    model = await D().model.find_one({"_id": "weights"})
    weights = model["weights"]
    for k, v in req.weights.items():
        if k in weights:
            weights[k] = max(0.0, min(3.0, float(v)))
    await D().model.update_one({"_id": "weights"}, {"$set": {"weights": weights}})
    return await learning_state()


@app.post("/api/learning/simulate")
async def simulate(req: SimulateReq):
    catalog = await dbmod.load_catalog()
    persona = next(p for p in catalog["personas"] if p["id"] == req.persona_id)
    result = learning.simulate(catalog, persona, n=req.n, seed=req.seed)
    events = result.pop("events")
    if req.apply:
        model = await D().model.find_one({"_id": "weights"})
        weights = {**model["weights"], **result["weights_after"]}
        aff_all = model.get("tag_affinity", {})
        aff_all[req.persona_id] = result["tag_affinity_after"]
        await D().model.update_one({"_id": "weights"}, {"$set": {"weights": weights, "tag_affinity": aff_all},
                                                         "$inc": {"updates": len(events)}})
        for key, buf in result["corridors"]["learned"].items():
            await D().corridors.update_one({"_id": key}, {"$set": {"buffer": buf}, "$inc": {"samples": 1},
                                                          "$setOnInsert": {"initial": 6.0}}, upsert=True)
        await D().feedback.insert_many([{"persona_id": req.persona_id, "attraction_id": e["attraction_id"],
                                         "action": "kept" if e["kept"] else "skipped", "synthetic": True, "at": now()}
                                        for e in events])
    result["applied"] = req.apply
    return result


@app.post("/api/learning/reset")
async def reset_learning():
    await dbmod.seed(force=True)
    return await learning_state()

