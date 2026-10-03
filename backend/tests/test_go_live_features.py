"""Go-live features: passwords, bulk setup, tenant import, receipts, search,
vacancy, sidebar counts, and the first-owner setup command."""

import pytest

from conftest import add_bed, login, make_user, move_in, payments_for
import manage


# ---- Passwords ----

def test_change_password_signs_out_other_sessions(client, owner):
    other_session = login(client, "owner")
    res = client.post("/auth/change-password", json={"currentPassword": "secret123", "newPassword": "brand-new-pass"}, headers=owner)
    assert res.status_code == 200
    fresh = {"Authorization": f"Bearer {res.json()['token']}"}
    assert client.get("/auth/me", headers=fresh).status_code == 200
    assert client.get("/auth/me", headers=other_session).status_code == 401
    assert client.get("/auth/me", headers=owner).status_code == 401
    assert client.post("/auth/login", json={"username": "owner", "password": "brand-new-pass"}).status_code == 200
    assert client.post("/auth/login", json={"username": "owner", "password": "secret123"}).status_code == 401


@pytest.mark.parametrize(
    "body,status",
    [
        ({"currentPassword": "wrong", "newPassword": "brand-new-pass"}, 400),
        ({"currentPassword": "secret123", "newPassword": "secret123"}, 400),
        ({"currentPassword": "secret123", "newPassword": "short"}, 422),
    ],
)
def test_change_password_rules(client, owner, body, status):
    assert client.post("/auth/change-password", json=body, headers=owner).status_code == status


def test_owner_resets_staff_password(client, owner, staff):
    staff_id = next(s["id"] for s in client.get("/staff", headers=owner).json() if s["username"] == "frontdesk")
    assert client.post(f"/staff/{staff_id}/reset-password", json={"newPassword": "temporary-123"}, headers=owner).status_code == 200
    assert client.get("/auth/me", headers=staff).status_code == 401  # old session ended
    assert client.post("/auth/login", json={"username": "frontdesk", "password": "temporary-123"}).status_code == 200


def test_reset_password_rules(client, owner, staff):
    me = client.get("/auth/me", headers=owner).json()
    assert client.post(f"/staff/{me['id']}/reset-password", json={"newPassword": "whatever-123"}, headers=owner).status_code == 400
    staff_me = client.get("/auth/me", headers=staff).json()
    assert client.post(f"/staff/{staff_me['id']}/reset-password", json={"newPassword": "whatever-123"}, headers=staff).status_code == 403
    assert client.post("/staff/999/reset-password", json={"newPassword": "whatever-123"}, headers=owner).status_code == 404


# ---- Bulk beds ----

def test_bulk_beds_creates_every_room_bed_pair(client, owner, prop):
    res = client.post("/beds/bulk", json={"propertyId": prop["id"], "roomNumbers": ["301", "302", "303"], "bedLabels": ["A", "B", "C"], "rentAmount": 12000}, headers=owner)
    assert res.status_code == 201
    beds = res.json()
    assert len(beds) == 9 and {b["floor"] for b in beds} == {3}


def test_bulk_beds_is_all_or_nothing_on_clash(client, owner, prop):
    add_bed(client, owner, prop["id"], "302", "B")
    res = client.post("/beds/bulk", json={"propertyId": prop["id"], "roomNumbers": ["301", "302"], "bedLabels": ["A", "B"], "rentAmount": 9000}, headers=owner)
    assert res.status_code == 409 and "302/B" in res.json()["detail"]
    assert len(client.get("/beds", headers=owner).json()) == 1


@pytest.mark.parametrize(
    "body",
    [
        {"roomNumbers": ["301", "301"], "bedLabels": ["A"]},
        {"roomNumbers": ["301"], "bedLabels": ["A", "A"]},
        {"roomNumbers": [], "bedLabels": ["A"]},
        {"roomNumbers": [str(i) for i in range(100, 170)], "bedLabels": ["A"]},
    ],
)
def test_bulk_beds_rejects_bad_input(client, owner, prop, body):
    assert client.post("/beds/bulk", json={"propertyId": prop["id"], "rentAmount": 9000, **body}, headers=owner).status_code == 422


# ---- Tenant import ----

def row(**overrides):
    base = {"name": "Imported Person", "phone": "9822033445", "roomNumber": "101", "bedLabel": "A", "moveInDate": "2026-06-01", "rentDueDay": 5, "depositAmount": 9500, "agreementExpiry": "2027-05-31"}
    base.update(overrides)
    return base


def test_import_dry_run_reports_every_problem_with_row_numbers(client, owner, prop):
    add_bed(client, owner, prop["id"], "101", "A")
    add_bed(client, owner, prop["id"], "101", "B")
    occupied = add_bed(client, owner, prop["id"], "102", "A")
    move_in(client, owner, occupied["id"])
    rows = [
        row(),
        row(name="Bad Phone", phone="123", bedLabel="B"),
        row(name="No Bed", roomNumber="999"),
        row(name="Taken", roomNumber="102"),
        row(name="Twice", phone="9822033446"),  # same bed as row 1
        row(name="Backwards", bedLabel="B", agreementExpiry="2026-01-01"),
    ]
    result = client.post("/tenants/import?dryRun=true", json={"rows": rows}, headers=owner).json()
    assert result["ok"] is False and result["created"] == 0
    by_row = {e["row"]: e["message"] for e in result["errors"]}
    assert set(by_row) == {2, 3, 4, 5, 6}
    assert "Phone" in by_row[2] and "999" in by_row[3] and "occupied" in by_row[4] and "row 1" in by_row[5] and "Agreement" in by_row[6]
    assert len(client.get("/tenants", headers=owner).json()) == 1  # nothing written


def test_import_creates_all_or_none(client, owner, prop):
    add_bed(client, owner, prop["id"], "101", "A")
    add_bed(client, owner, prop["id"], "101", "B")
    bad = client.post("/tenants/import?dryRun=false", json={"rows": [row(), row(name="X", phone="1", bedLabel="B")]}, headers=owner).json()
    assert bad["ok"] is False and client.get("/tenants", headers=owner).json() == []
    good = client.post("/tenants/import?dryRun=false", json={"rows": [row(), row(name="Second", phone="9822033447", bedLabel="b")]}, headers=owner).json()
    assert good == {"ok": True, "dryRun": False, "created": 2, "errors": []}
    tenants = client.get("/tenants", headers=owner).json()
    assert len(tenants) == 2 and all(len(t["documents"]) == 2 for t in tenants)


def test_import_needs_property_choice_when_several(client, owner, prop):
    client.post("/properties", json={"name": "Second PG"}, headers=owner)
    assert client.post("/tenants/import", json={"rows": [row()]}, headers=owner).status_code == 400


# ---- Receipts ----

def test_receipt_shows_running_balance(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    sep = payments_for(client, owner, tenant["id"])[-1]
    client.post(f"/payments/{sep['id']}/transactions", json={"amount": 4000, "paidDate": "2026-09-10", "method": "upi"}, headers=owner)
    client.post(f"/payments/{sep['id']}/transactions", json={"amount": 2000, "paidDate": "2026-09-12"}, headers=owner)
    txs = sorted(client.get("/payments/transactions", headers=owner).json(), key=lambda t: t["id"])
    first = client.get(f"/payments/transactions/{txs[0]['id']}", headers=owner).json()
    second = client.get(f"/payments/transactions/{txs[1]['id']}", headers=owner).json()
    assert (first["paidSoFar"], first["balance"]) == (4000, 5500)
    assert (second["paidSoFar"], second["balance"]) == (6000, 3500)
    assert first["receiptNumber"].startswith("R") and first["propertyName"] == "Test PG" and first["receivedBy"] == "Owner"
    assert first["tenantPhone"] == "9822011223"
    assert client.get("/payments/transactions/999", headers=owner).status_code == 404


# ---- Search ----

def test_search_finds_residents_rooms_and_leads(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"], "204", "A")["id"], name="Arjun Patil")
    client.post("/leads", json={"name": "Arjun Lead", "phone": "9876500000"}, headers=owner)
    kinds = {r["kind"] for r in client.get("/search?q=arjun", headers=owner).json()}
    assert kinds == {"tenant", "lead"}
    by_phone = client.get("/search?q=98220112", headers=owner).json()
    assert by_phone[0]["link"] == f"/tenants?open={tenant['id']}"
    rooms = [r for r in client.get("/search?q=204", headers=owner).json() if r["kind"] == "room"]
    assert rooms[0]["title"] == "Room 204" and rooms[0]["subtitle"] == "1 beds · 0 vacant"


def test_search_hides_moved_out_and_lost(client, owner, prop):
    lead = client.post("/leads", json={"name": "Gone Lead", "phone": "9876500001"}, headers=owner).json()
    client.patch(f"/leads/{lead['id']}", json={"status": "lost"}, headers=owner)
    assert client.get("/search?q=Gone", headers=owner).json() == []
    assert client.get("/search?q=", headers=owner).status_code == 422


# ---- Vacancy & counts ----

def test_vacant_since_and_vacancy_cost(client, owner, prop):
    bed = add_bed(client, owner, prop["id"], "101", "A", rent=9500)
    add_bed(client, owner, prop["id"], "101", "B", rent=8000)
    tenant = move_in(client, owner, bed["id"])
    client.post(f"/tenants/{tenant['id']}/notice", json={"noticeDate": "2026-09-01", "plannedMoveOutDate": "2026-09-10"}, headers=owner)
    notice = client.get("/move-outs", headers=owner).json()[0]
    client.post(f"/move-outs/{notice['id']}/settle", json={"refundPaidDate": "2026-09-15"}, headers=owner)
    beds = {b["bedLabel"]: b for b in client.get("/beds", headers=owner).json()}
    assert beds["A"]["vacantSince"] == "2026-09-10" and beds["B"]["vacantSince"] is None
    assert client.get("/dashboard", headers=owner).json()["vacantRentPerMonth"] == 17500


def test_nav_counts(client, owner, prop):
    move_in(client, owner, add_bed(client, owner, prop["id"])["id"], agreementExpiry="2026-10-01")
    client.post("/complaints", json={"title": "Leak", "priority": "urgent"}, headers=owner)
    counts = client.get("/dashboard/counts", headers=owner).json()
    assert counts["overdueResidents"] == 1 and counts["urgentComplaints"] == 1 and counts["renewalsDue"] == 1
    assert counts["openItems"] == len(client.get("/dashboard", headers=owner).json()["decisionQueue"])


# ---- First-owner setup ----

def test_create_owner_once(client):
    manage.create_owner("Sakshi Mishra", "Sakshi", "very-secret-1")
    assert client.post("/auth/login", json={"username": "sakshi", "password": "very-secret-1"}).status_code == 200
    with pytest.raises(manage.SetupError):
        manage.create_owner("Someone Else", "other", "very-secret-2")


def test_create_owner_rejects_short_password():
    with pytest.raises((manage.SetupError, ValueError)):
        manage.create_owner("A", "aaa", "short")


# ---- Editing contact details ----

def test_edit_tenant_name_and_phone(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    res = client.patch(f"/tenants/{tenant['id']}", json={"name": "Rohan D. Deshmukh", "phone": "+91 98220 99999"}, headers=owner)
    assert res.status_code == 200
    assert (res.json()["name"], res.json()["phone"]) == ("Rohan D. Deshmukh", "9822099999")
    assert client.patch(f"/tenants/{tenant['id']}", json={"phone": "123"}, headers=owner).status_code == 422
    assert client.patch(f"/tenants/{tenant['id']}", json={"name": None}, headers=owner).status_code == 422
    assert client.patch(f"/tenants/{tenant['id']}", json={"rentAmount": 1}, headers=owner).json()["rentAmount"] == 9500  # ignored
    assert client.patch("/tenants/999", json={"name": "X"}, headers=owner).status_code == 404
