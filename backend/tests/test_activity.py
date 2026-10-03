"""The activity log records every change and every sign-in, and only the owner can read it."""

from conftest import add_bed, login, make_user, move_in, payments_for


def actions(client, owner, **params):
    res = client.get("/activity", params=params, headers=owner)
    assert res.status_code == 200, res.text
    return [e["action"] for e in res.json()]


def test_sign_ins_and_failures_are_logged(client):
    make_user("owner", role="owner")
    client.post("/auth/login", json={"username": "owner", "password": "wrong"})
    client.post("/auth/login", json={"username": "ghost", "password": "x"})
    owner = login(client, "owner")
    entries = client.get("/activity?area=auth", headers=owner).json()
    assert [e["action"] for e in entries] == ["auth.login", "auth.login_failed", "auth.login_failed"]
    assert entries[1]["detail"].startswith("username 'ghost'") and entries[1]["userName"] is None
    assert entries[2]["userName"] == "Owner"  # failed attempt on a real account names it


def test_full_pipeline_is_traceable(client, owner, prop):
    """Lead → move in → bed rent change → renewal → payment → complaint → expense: each leaves a trail."""
    lead = client.post("/leads", json={"name": "Priya Sharma", "phone": "9876543210", "source": "whatsapp"}, headers=owner).json()
    client.patch(f"/leads/{lead['id']}", json={"status": "visited"}, headers=owner)
    bed = add_bed(client, owner, prop["id"])
    tenant = move_in(client, owner, bed["id"], name="Priya Sharma", phone="9876543210")
    client.patch(f"/beds/{bed['id']}", json={"rentAmount": 10000}, headers=owner)
    client.post(f"/tenants/{tenant['id']}/renewals", json={"newExpiry": "2028-07-09", "newRent": 10000, "effectiveFrom": "2026-10"}, headers=owner)
    sep = payments_for(client, owner, tenant["id"])[-1]
    client.post(f"/payments/{sep['id']}/transactions", json={"amount": 2000, "paidDate": "2026-09-10"}, headers=owner)
    c = client.post("/complaints", json={"title": "Leak", "priority": "urgent"}, headers=owner).json()
    client.patch(f"/complaints/{c['id']}", json={"status": "resolved"}, headers=owner)
    client.post("/expenses", json={"spentOn": "2026-09-05", "category": "water", "amount": 500}, headers=owner)

    log = actions(client, owner)
    for expected in [
        "lead.created", "lead.status", "bed.created", "tenant.moved_in", "bed.updated",
        "tenant.renewed", "payment.recorded", "complaint.created", "complaint.updated", "expense.added",
    ]:
        assert expected in log, expected
    rent_change = next(e for e in client.get("/activity?area=bed", headers=owner).json() if e["action"] == "bed.updated")
    assert "₹9,500 → ₹10,000" in rent_change["detail"]


def test_filters_and_paging(client, owner, staff, prop):
    add_bed(client, owner, prop["id"], "101", "A")
    add_bed(client, staff, prop["id"], "101", "B")
    staff_id = client.get("/auth/me", headers=staff).json()["id"]
    by_staff = client.get(f"/activity?userId={staff_id}", headers=owner).json()
    assert {e["userName"] for e in by_staff} == {"Frontdesk"}
    first_page = client.get("/activity?limit=2", headers=owner).json()
    older = client.get(f"/activity?limit=50&beforeId={first_page[-1]['id']}", headers=owner).json()
    assert {e["id"] for e in older}.isdisjoint({e["id"] for e in first_page})
    all_entries = first_page + older
    assert [e["at"] for e in all_entries] == sorted((e["at"] for e in all_entries), reverse=True)


def test_only_owner_reads_activity(client, owner, staff):
    assert client.get("/activity", headers=staff).status_code == 403
    assert client.get("/activity?area=nonsense", headers=owner).status_code == 422
