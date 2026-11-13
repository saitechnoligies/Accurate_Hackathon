"""MongoDB access. Uses Atlas from MONGO_URI; falls back to an in-memory
database so the demo still runs offline."""
from __future__ import annotations

import logging
import os
from pathlib import Path

import certifi
from dotenv import load_dotenv

from .data import jaipur

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
log = logging.getLogger("delayproof.db")

_client = None
_db = None
db_mode = "unknown"


async def connect():
    global _client, _db, db_mode
    uri = os.getenv("MONGO_URI", "")
    name = os.getenv("MONGO_DB", "delayproof")
    use_memory = os.getenv("USE_MEMORY_DB", "0") == "1" or not uri
    if not use_memory:
        try:
            from motor.motor_asyncio import AsyncIOMotorClient

            _client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=8000, tlsCAFile=certifi.where())
            await _client.admin.command("ping")
            _db = _client[name]
            db_mode = "atlas"
            log.info("Connected to MongoDB Atlas (db=%s)", name)
        except Exception as exc:  # pragma: no cover - network dependent
            log.warning("Atlas unavailable (%s); falling back to in-memory DB", exc)
            use_memory = True
    if use_memory:
        from mongomock_motor import AsyncMongoMockClient

        _client = AsyncMongoMockClient()
        _db = _client[name]
        db_mode = "memory"
    await seed()


def db():
    if _db is None:
        raise RuntimeError("DB not connected")
    return _db


async def seed(force: bool = False):
    """Seed static catalog data. Learned state (corridors, weights) is kept unless force."""
    d = db()
    catalog = {
        "attractions": jaipur.ATTRACTIONS,
        "stays": jaipur.STAYS,
        "trains": jaipur.TRAINS,
        "personas": jaipur.PERSONAS,
    }
    for coll, docs in catalog.items():
        await d[coll].delete_many({})
        await d[coll].insert_many([{**doc, "_id": doc["id"]} for doc in docs])

    if force or await d.corridors.count_documents({}) == 0:
        await d.corridors.delete_many({})
        await d.corridors.insert_many(
            [{"_id": k, "buffer": float(v), "initial": float(v), "samples": 0} for k, v in jaipur.CORRIDOR_BUFFERS.items()]
        )
    if force or await d.model.count_documents({"_id": "weights"}) == 0:
        await d.model.replace_one(
            {"_id": "weights"},
            {"_id": "weights", "weights": dict(jaipur.DEFAULT_WEIGHTS), "tag_affinity": {}, "updates": 0},
            upsert=True,
        )
    if force:
        await d.feedback.delete_many({})


async def load_catalog() -> dict:
    """Everything the engine needs, as plain dicts."""
    d = db()
    attractions = [_clean(x) async for x in d.attractions.find({})]
    stays = [_clean(x) async for x in d.stays.find({})]
    trains = [_clean(x) async for x in d.trains.find({})]
    personas = [_clean(x) async for x in d.personas.find({})]
    corridors = {x["_id"]: x["buffer"] async for x in d.corridors.find({})}
    model = await d.model.find_one({"_id": "weights"}) or {}
    return {
        "attractions": attractions,
        "stays": stays,
        "trains": trains,
        "personas": personas,
        "corridors": corridors,
        "weights": model.get("weights", dict(jaipur.DEFAULT_WEIGHTS)),
        "tag_affinity": model.get("tag_affinity", {}),
    }


def _clean(doc: dict) -> dict:
    doc = dict(doc)
    doc.pop("_id", None)
    return doc
