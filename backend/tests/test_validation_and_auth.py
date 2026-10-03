"""Bad input and access control: the API refuses what the UI might let through."""

import pytest

from conftest import add_bed, login, make_user, move_in


# ---- Auth & roles ----

def test_wrong_password_is_401(client):
    make_user("owner", role="owner")
    assert client.post("/auth/login", json={"username": "owner", "password": "nope"}).status_code == 401


def test_login_is_case_insensitive_on_username(client):
    make_user("owner", role="owner")
    assert client.post("/auth/login", json={"username": "OWNER", "password": "secret123"}).status_code == 200


def test_brute_force_locks_out_even_the_right_password(client):
    make_user("owner", role="owner")
    for _ in range(5):
        client.post("/auth/login", json={"username": "owner", "password": "guess"})
    res = client.post("/auth/login", json={"username": "owner", "password": "secret123"})
    assert res.status_code == 429


def test_deactivated_user_token_stops_working(client, owner):
    make_user("temp")
    temp = login(client, "temp")
    staff_id = next(s["id"] for s in client.get("/staff", headers=owner).json() if s["username"] == "temp")
    client.patch(f"/staff/{staff_id}/deactivate", headers=owner)
    assert client.get("/dashboard", headers=temp).status_code == 401


def test_no_token_is_rejected(client):
    assert client.get("/dashboard").status_code in (401, 403)
    assert client.post("/leads", json={"name": "X", "phone": "9876543210"}).status_code in (401, 403)


def test_garbage_token_is_rejected(client):
    assert client.get("/dashboard", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401


def test_staff_cannot_reach_owner_only_endpoints(client, owner, staff):
    assert client.get("/staff", headers=staff).status_code == 403
    assert client.post("/staff", json={"name": "X", "username": "xyz", "password": "secret123"}, headers=staff).status_code == 403
    assert client.get("/reports/pnl", headers=staff).status_code == 403
    assert client.post("/expenses", json={"spentOn": "2026-09-01", "category": "water", "amount": 100}, headers=staff).status_code == 403
    # ...but can list names to assign complaints.
    assert client.get("/staff/directory", headers=staff).status_code == 200


def test_owner_cannot_deactivate_self(client, owner):
    me = client.get("/auth/me", headers=owner).json()
    assert client.patch(f"/staff/{me['id']}/deactivate", headers=owner).status_code == 400


def test_duplicate_username_is_409(client, owner):
    body = {"name": "A", "username": "desk", "password": "secret123"}
    assert client.post("/staff", json=body, headers=owner).status_code == 201
    assert client.post("/staff", json={**body, "username": "DESK"}, headers=owner).status_code == 409


@pytest.mark.parametrize("username", ["ab", "has space", "semi;colon", "x" * 41])
def test_bad_usernames_rejected(client, owner, username):
    res = client.post("/staff", json={"name": "A", "username": username, "password": "secret123"}, headers=owner)
    assert res.status_code == 422


# ---- Beds ----

def test_duplicate_bed_in_same_room_is_409(client, owner, prop):
    add_bed(client, owner, prop["id"], "101", "A")
    res = client.post("/beds", json={"propertyId": prop["id"], "roomNumber": "101", "bedLabel": "A", "rentAmount": 9000}, headers=owner)
    assert res.status_code == 409


@pytest.mark.parametrize("rent", [0, -100, 9500.555, 6_00_000])
def test_bad_rent_rejected(client, owner, prop, rent):
    res = client.post("/beds", json={"propertyId": prop["id"], "roomNumber": "101", "bedLabel": "A", "rentAmount": rent}, headers=owner)
    assert res.status_code == 422


def test_floor_is_derived_from_room_number(client, owner, prop):
    assert add_bed(client, owner, prop["id"], "203", "A")["floor"] == 2
    assert add_bed(client, owner, prop["id"], "1204", "A")["floor"] == 12
    assert add_bed(client, owner, prop["id"], "G1", "A")["floor"] == 0


def test_blank_room_or_label_rejected(client, owner, prop):
    res = client.post("/beds", json={"propertyId": prop["id"], "roomNumber": "   ", "bedLabel": "A", "rentAmount": 9000}, headers=owner)
    assert res.status_code == 422


# ---- Tenants & leads input ----

@pytest.mark.parametrize("phone", ["abc", "12345", "5822011223", "98220112233", ""])
def test_bad_phone_numbers_rejected(client, owner, prop, phone):
    bed = add_bed(client, owner, prop["id"])
    body = {"name": "A", "phone": phone, "bedId": bed["id"], "moveInDate": "2026-09-01", "rentDueDay": 1, "depositAmount": 0, "agreementExpiry": "2027-08-31"}
    assert client.post("/tenants", json=body, headers=owner).status_code == 422


@pytest.mark.parametrize("phone", ["+91 98220 11223", "919822011223", "98220-11223", "09822011223"])
def test_phone_formats_are_normalised(client, owner, prop, phone):
    bed = add_bed(client, owner, prop["id"])
    tenant = move_in(client, owner, bed["id"], phone=phone)
    assert tenant["phone"] == "9822011223"


def test_blank_name_rejected(client, owner, prop):
    bed = add_bed(client, owner, prop["id"])
    body = {"name": "   ", "phone": "9822011223", "bedId": bed["id"], "moveInDate": "2026-09-01", "rentDueDay": 1, "depositAmount": 0, "agreementExpiry": "2027-08-31"}
    assert client.post("/tenants", json=body, headers=owner).status_code == 422


def test_agreement_must_end_after_move_in(client, owner, prop):
    bed = add_bed(client, owner, prop["id"])
    body = {"name": "A", "phone": "9822011223", "bedId": bed["id"], "moveInDate": "2026-09-01", "rentDueDay": 1, "depositAmount": 0, "agreementExpiry": "2026-08-01"}
    assert client.post("/tenants", json=body, headers=owner).status_code == 422


@pytest.mark.parametrize("day", [0, 32])
def test_rent_due_day_out_of_range(client, owner, prop, day):
    bed = add_bed(client, owner, prop["id"])
    body = {"name": "A", "phone": "9822011223", "bedId": bed["id"], "moveInDate": "2026-09-01", "rentDueDay": day, "depositAmount": 0, "agreementExpiry": "2027-08-31"}
    assert client.post("/tenants", json=body, headers=owner).status_code == 422


def test_absurd_dates_rejected(client, owner, prop):
    bed = add_bed(client, owner, prop["id"])
    body = {"name": "A", "phone": "9822011223", "bedId": bed["id"], "moveInDate": "1990-01-01", "rentDueDay": 1, "depositAmount": 0, "agreementExpiry": "2027-08-31"}
    assert client.post("/tenants", json=body, headers=owner).status_code == 422


def test_move_into_missing_bed_is_404(client, owner, prop):
    body = {"name": "A", "phone": "9822011223", "bedId": 999, "moveInDate": "2026-09-01", "rentDueDay": 1, "depositAmount": 0, "agreementExpiry": "2027-08-31"}
    assert client.post("/tenants", json=body, headers=owner).status_code == 404


def test_move_into_occupied_bed_is_409(client, owner, prop):
    bed = add_bed(client, owner, prop["id"])
    move_in(client, owner, bed["id"])
    body = {"name": "B", "phone": "9822011224", "bedId": bed["id"], "moveInDate": "2026-09-01", "rentDueDay": 1, "depositAmount": 0, "agreementExpiry": "2027-08-31"}
    assert client.post("/tenants", json=body, headers=owner).status_code == 409


def test_lost_leads_are_archived_not_listed(client, owner):
    lead = client.post("/leads", json={"name": "Priya", "phone": "9876543210"}, headers=owner).json()
    client.patch(f"/leads/{lead['id']}", json={"status": "lost"}, headers=owner)
    assert client.get("/leads", headers=owner).json() == []
    assert len(client.get("/leads?includeArchived=true", headers=owner).json()) == 1


@pytest.mark.parametrize("path", ["/payments?periodMonth=2026-13", "/payments?periodMonth=Sept", "/payments/summary?periodMonth=2026-9", "/payments/transactions?limit=0"])
def test_bad_query_params_are_422(client, owner, path):
    assert client.get(path, headers=owner).status_code == 422


def test_dashboard_on_an_empty_database(client, owner):
    res = client.get("/dashboard", headers=owner)
    assert res.status_code == 200
    body = res.json()
    assert body["totalBeds"] == 0 and body["occupancyPct"] == 0 and body["decisionQueue"] == []
