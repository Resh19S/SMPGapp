"""Explicit nulls and junk bodies on edit endpoints: always a clear 4xx, never a 409 from
the database or a 500."""

import pytest

from conftest import add_bed, move_in


@pytest.fixture
def lead(client, owner):
    return client.post("/leads", json={"name": "Priya", "phone": "9876543210"}, headers=owner).json()


@pytest.mark.parametrize("field", ["name", "phone", "source", "status", "notes"])
def test_lead_required_fields_cannot_be_nulled(client, owner, lead, field):
    assert client.patch(f"/leads/{lead['id']}", json={field: None}, headers=owner).status_code == 422


def test_lead_follow_up_can_be_cleared(client, owner, lead):
    client.patch(f"/leads/{lead['id']}", json={"followUpDate": "2026-09-20"}, headers=owner)
    res = client.patch(f"/leads/{lead['id']}", json={"followUpDate": None}, headers=owner)
    assert res.status_code == 200 and res.json()["followUpDate"] is None


@pytest.mark.parametrize("field", ["status", "priority"])
def test_complaint_required_fields_cannot_be_nulled(client, owner, field):
    c = client.post("/complaints", json={"title": "Leak"}, headers=owner).json()
    assert client.patch(f"/complaints/{c['id']}", json={field: None}, headers=owner).status_code == 422


def test_complaint_can_be_unassigned(client, owner):
    c = client.post("/complaints", json={"title": "Leak"}, headers=owner).json()
    res = client.patch(f"/complaints/{c['id']}", json={"assignedToId": None}, headers=owner)
    assert res.status_code == 200 and res.json()["assignedTo"] is None


@pytest.mark.parametrize("field", ["roomNumber", "bedLabel", "rentAmount"])
def test_bed_fields_cannot_be_nulled(client, owner, prop, field):
    bed = add_bed(client, owner, prop["id"])
    res = client.patch(f"/beds/{bed['id']}", json={field: None}, headers=owner)
    assert res.status_code in (200, 422)  # ignored or refused — never stored as null
    assert client.get("/beds", headers=owner).json()[0][field] is not None


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/leads"),
        ("post", "/tenants"),
        ("post", "/complaints"),
        ("post", "/expenses"),
        ("post", "/beds"),
        ("post", "/staff"),
    ],
)
@pytest.mark.parametrize("body", [None, [], "text", {"unexpected": True}])
def test_junk_bodies_are_422(client, owner, prop, method, path, body):
    kwargs = {"headers": owner}
    if body is None:
        kwargs["content"] = b"{not json"
        kwargs["headers"] = {**owner, "Content-Type": "application/json"}
    else:
        kwargs["json"] = body
    assert getattr(client, method)(path, **kwargs).status_code == 422


def test_missing_ids_are_404_everywhere(client, owner, prop):
    for method, path, body in [
        ("get", "/tenants/999", None),
        ("patch", "/leads/999", {"notes": "x"}),
        ("patch", "/beds/999", {"rentAmount": 100}),
        ("patch", "/complaints/999", {"status": "open"}),
        ("post", "/tenants/999/notice", {"noticeDate": "2026-09-01", "plannedMoveOutDate": "2026-09-30"}),
        ("post", "/tenants/999/renewals", {"newExpiry": "2027-09-01", "newRent": 100, "effectiveFrom": "2026-10"}),
        ("post", "/move-outs/999/settle", {"refundPaidDate": "2026-09-01"}),
        ("delete", "/expenses/999", None),
    ]:
        kwargs = {"headers": owner}
        if body is not None:
            kwargs["json"] = body
        assert getattr(client, method)(path, **kwargs).status_code == 404, path


def test_document_of_another_tenant_is_404(client, owner, prop):
    a = move_in(client, owner, add_bed(client, owner, prop["id"], label="A")["id"])
    b = move_in(client, owner, add_bed(client, owner, prop["id"], label="B")["id"], name="B", phone="9822011299")
    other_doc = b["documents"][0]["id"]
    res = client.post(f"/tenants/{a['id']}/documents/{other_doc}/upload", json={"fileName": "x.pdf"}, headers=owner)
    assert res.status_code == 404
