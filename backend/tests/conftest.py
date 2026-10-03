import datetime
import os
import tempfile

# Point the app at a throwaway database BEFORE anything imports `database`.
_tmpdir = tempfile.mkdtemp(prefix="pg-rental-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmpdir}/test.db"
os.environ["APP_ENV"] = "test"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import clock  # noqa: E402
from auth import hash_password  # noqa: E402
from database import Base, SessionLocal, engine  # noqa: E402
from main import app  # noqa: E402
from models.db_models import StaffUser  # noqa: E402
from routers.auth import reset_login_throttle  # noqa: E402

# Every test runs on this "today", so date-dependent rules are deterministic.
TODAY = datetime.date(2026, 9, 15)


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(clock, "today", lambda: TODAY)
    reset_login_throttle()
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


def make_user(username: str, role: str = "staff", password: str = "secret123", active: bool = True) -> StaffUser:
    with SessionLocal() as s:
        user = StaffUser(name=username.title(), username=username, password_hash=hash_password(password), role=role, is_active=active)
        s.add(user)
        s.commit()
        s.refresh(user)
        return user


def login(client: TestClient, username: str, password: str = "secret123") -> dict:
    res = client.post("/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


@pytest.fixture
def owner(client):
    make_user("owner", role="owner")
    return login(client, "owner")


@pytest.fixture
def staff(client):
    make_user("frontdesk", role="staff")
    return login(client, "frontdesk")


@pytest.fixture
def prop(client, owner):
    res = client.post("/properties", json={"name": "Test PG", "address": "Pune"}, headers=owner)
    assert res.status_code == 201
    return res.json()


def add_bed(client, headers, prop_id, room="101", label="A", rent=9500) -> dict:
    res = client.post("/beds", json={"propertyId": prop_id, "roomNumber": room, "bedLabel": label, "rentAmount": rent}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def move_in(client, headers, bed_id, **overrides) -> dict:
    body = {
        "name": "Rohan Deshmukh",
        "phone": "9822011223",
        "bedId": bed_id,
        "moveInDate": "2026-07-10",
        "rentDueDay": 5,
        "depositAmount": 9500,
        "agreementExpiry": "2027-07-09",
    }
    body.update(overrides)
    res = client.post("/tenants", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def payments_for(client, headers, tenant_id) -> list[dict]:
    res = client.get("/payments", headers=headers)
    assert res.status_code == 200
    return sorted((p for p in res.json() if p["tenantId"] == tenant_id), key=lambda p: p["periodMonth"])
