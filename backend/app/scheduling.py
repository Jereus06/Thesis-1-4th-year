"""Daily local-time forecast slots and durable retry decisions; no calendar-day backfill."""

from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo


def daily_schedule_slot(now: datetime, timezone: str, local_time: str) -> tuple[date, date]:
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("Forecast scheduling requires a timezone-aware clock")
    local_now = now.astimezone(ZoneInfo(timezone))
    scheduled_time = time.fromisoformat(local_time)
    slot = local_now.date()
    if local_now.time().replace(tzinfo=None) < scheduled_time:
        slot -= timedelta(days=1)
    return slot, slot - timedelta(days=1)


def schedule_attempt(runs: list[dict[str, Any]], slot: date, now: datetime) -> int | None:
    """Permit one completed run or at most three failed attempts for the latest due slot."""
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("Forecast scheduling requires a timezone-aware clock")
    if any(run["status"] in {"queued", "running"} for run in runs):
        return None
    matching = [
        run for run in runs
        if run.get("configuration", {}).get("requestedFrom") == "daily_schedule"
        and run.get("configuration", {}).get("scheduledFor") == slot.isoformat()
    ]
    if any(run["status"] == "completed" for run in matching):
        return None
    attempts = max(
        [len(matching)] + [
            value for run in matching
            if isinstance(value := run["configuration"].get("scheduleAttempt"), int)
            and not isinstance(value, bool)
        ]
    )
    if attempts >= 3:
        return None
    if matching:
        timestamps = [
            run.get("completed_at") or run.get("started_at") or run.get("created_at")
            for run in matching
        ]
        if any(value is None for value in timestamps):
            return None
        if now - max(timestamps) < timedelta(minutes=30):
            return None
    return attempts + 1
