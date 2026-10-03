"""The one place the backend asks "what day is it?".

Servers run in UTC, but rent falls due on Indian calendar days — between
00:00 and 05:30 IST a naive date.today() on a UTC box is still yesterday,
which would mark rent due "today" as not-yet-due (or overdue a day late).
Every business date goes through clock.today(); tests monkeypatch it.
"""

import datetime
import os
from zoneinfo import ZoneInfo

APP_TZ = ZoneInfo(os.getenv("APP_TIMEZONE", "Asia/Kolkata"))


def now() -> datetime.datetime:
    return datetime.datetime.now(APP_TZ)


def today() -> datetime.date:
    return now().date()


def utcnow() -> datetime.datetime:
    """Naive UTC timestamp, the storage format for created_at-style columns."""
    return datetime.datetime.now(datetime.UTC).replace(tzinfo=None)


def current_period() -> str:
    return today().strftime("%Y-%m")
