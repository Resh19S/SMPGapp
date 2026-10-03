"""Move-out settlement, agreement renewals, and profit & loss."""

import pytest
from fastapi.testclient import TestClient

import clock
from conftest import add_bed, move_in, payments_for
from main import app
from test_rent_and_concurrency import run_concurrently


def give_notice(client, headers, tenant_id, notice="2026-08-20", leaving="2026-09-15"):
    res = client.post(f"/tenants/{tenant_id}/notice", json={"noticeDate": notice, "plannedMoveOutDate": leaving}, headers=headers)
    assert res.status_code == 201, res.text
    return client.get("/move-outs", headers=headers).json()[0]


# ---- Move-outs ----

def test_notice_rules(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    url = f"/tenants/{tenant['id']}/notice"
    assert client.post(url, json={"noticeDate": "2026-09-20", "plannedMoveOutDate": "2026-10-20"}, headers=owner).status_code == 400  # future notice
    assert client.post(url, json={"noticeDate": "2026-09-10", "plannedMoveOutDate": "2026-09-01"}, headers=owner).status_code == 400  # leaves before notice
    assert client.post(url, json={"noticeDate": "2026-09-10", "plannedMoveOutDate": "2026-10-10"}, headers=owner).status_code == 201
    assert client.post(url, json={"noticeDate": "2026-09-10", "plannedMoveOutDate": "2026-10-10"}, headers=owner).status_code == 409


def test_cannot_settle_early(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    notice = give_notice(client, owner, tenant["id"], leaving="2026-09-20")
    assert client.post(f"/move-outs/{notice['id']}/settle", json={"refundPaidDate": "2026-09-15"}, headers=owner).status_code == 400


def test_deposit_covers_oldest_rent_first_and_rest_stays_owed(client, owner, prop):
    bed = add_bed(client, owner, prop["id"])
    tenant = move_in(client, owner, bed["id"])  # owes Jul, Aug, Sep = 28,500; deposit 9,500
    notice = give_notice(client, owner, tenant["id"])
    assert notice["unpaidRent"] == 28500 and notice["expectedRefund"] == 0
    settled = client.post(f"/move-outs/{notice['id']}/settle", json={"refundPaidDate": "2026-09-15"}, headers=owner).json()
    assert settled["status"] == "settled" and settled["refundAmount"] == 0
    months = payments_for(client, owner, tenant["id"])
    assert [m["status"] for m in months] == ["paid", "overdue", "overdue"]  # July covered by deposit
    assert client.get("/beds", headers=owner).json()[0]["status"] == "vacant"
    # The remaining debt surfaces on the dashboard once settled.
    queue = client.get("/dashboard", headers=owner).json()["decisionQueue"]
    assert any(item["kind"] == "rent" for item in queue)


def test_refund_is_deposit_minus_rent_minus_deductions_never_negative(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"], moveInDate="2026-09-01", rentDueDay=1, depositAmount=20000, agreementExpiry="2027-08-31")
    sep = payments_for(client, owner, tenant["id"])[0]
    client.post(f"/payments/{sep['id']}/transactions", json={"amount": 9500, "paidDate": "2026-09-01"}, headers=owner)
    notice = give_notice(client, owner, tenant["id"], notice="2026-09-10", leaving="2026-09-15")
    after = client.post(f"/move-outs/{notice['id']}/deductions", json={"label": "Broken chair", "amount": 1500}, headers=owner).json()
    assert after["expectedRefund"] == 18500
    after = client.post(f"/move-outs/{notice['id']}/deductions", json={"label": "Repaint", "amount": 50000}, headers=owner).json()
    assert after["expectedRefund"] == 0


def test_settled_move_out_is_frozen(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    notice = give_notice(client, owner, tenant["id"])
    client.post(f"/move-outs/{notice['id']}/settle", json={"refundPaidDate": "2026-09-15"}, headers=owner)
    assert client.post(f"/move-outs/{notice['id']}/settle", json={"refundPaidDate": "2026-09-15"}, headers=owner).status_code == 400
    assert client.post(f"/move-outs/{notice['id']}/deductions", json={"label": "X", "amount": 10}, headers=owner).status_code == 400


def test_double_settle_at_once_applies_deposit_once(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    notice = give_notice(client, owner, tenant["id"])

    def settle():
        return TestClient(app).post(f"/move-outs/{notice['id']}/settle", json={"refundPaidDate": "2026-09-15"}, headers=owner).status_code

    assert sorted(run_concurrently(settle, settle)) == [200, 400]
    deposit_txs = [t for t in client.get("/payments/transactions", headers=owner).json() if t["method"] == "deposit"]
    assert sum(t["amount"] for t in deposit_txs) == 9500


def test_future_refund_date_refused(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    notice = give_notice(client, owner, tenant["id"])
    assert client.post(f"/move-outs/{notice['id']}/settle", json={"refundPaidDate": "2026-09-30"}, headers=owner).status_code == 400


# ---- Renewals ----

def renew(client, headers, tenant_id, **body):
    payload = {"newExpiry": "2028-07-09", "newRent": 10000, "effectiveFrom": "2026-10"}
    payload.update(body)
    return client.post(f"/tenants/{tenant_id}/renewals", json=payload, headers=headers)


def test_renewal_extends_agreement_and_schedules_new_rent(client, owner, prop, monkeypatch):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    res = renew(client, owner, tenant["id"])
    assert res.status_code == 201
    body = res.json()
    assert body["agreementExpiry"] == "2028-07-09"
    assert body["rentAmount"] == 9500  # still September
    assert (body["upcomingRent"], body["upcomingRentFrom"]) == (10000, "2026-10")
    assert body["renewals"][0]["previousRent"] == 9500
    assert any(d["label"].startswith("Renewal agreement") for d in body["documents"])

    # When October arrives, it's billed at the new rent; September stays as it was.
    import datetime

    monkeypatch.setattr(clock, "today", lambda: datetime.date(2026, 10, 2))
    months = {r["periodMonth"]: r["amountDue"] for r in payments_for(client, owner, tenant["id"])}
    assert months["2026-09"] == 9500 and months["2026-10"] == 10000


def test_renewal_reprices_unpaid_current_month_but_not_partly_paid(client, owner, prop):
    bed_a, bed_b = add_bed(client, owner, prop["id"], label="A"), add_bed(client, owner, prop["id"], label="B")
    unpaid = move_in(client, owner, bed_a["id"])
    partly = move_in(client, owner, bed_b["id"], name="Other", phone="9822011299")
    sep_partly = payments_for(client, owner, partly["id"])[-1]
    client.post(f"/payments/{sep_partly['id']}/transactions", json={"amount": 1000, "paidDate": "2026-09-10"}, headers=owner)
    renew(client, owner, unpaid["id"], effectiveFrom="2026-09")
    renew(client, owner, partly["id"], effectiveFrom="2026-09")
    assert payments_for(client, owner, unpaid["id"])[-1]["amountDue"] == 10000
    assert payments_for(client, owner, partly["id"])[-1]["amountDue"] == 9500


@pytest.mark.parametrize(
    "body,status",
    [
        ({"newExpiry": "2027-07-09"}, 400),  # not later than current end
        ({"effectiveFrom": "2026-08"}, 400),  # backdated rent
        ({"effectiveFrom": "2028-08"}, 400),  # starts after the new end
        ({"newRent": 0}, 422),
        ({"effectiveFrom": "2026-13"}, 422),
    ],
)
def test_renewal_rules(client, owner, prop, body, status):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    assert renew(client, owner, tenant["id"], **body).status_code == status


def test_no_renewal_while_leaving(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    give_notice(client, owner, tenant["id"], leaving="2026-10-15")
    assert renew(client, owner, tenant["id"]).status_code == 409


def test_two_renewals_at_once_only_one_applies(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])

    def go():
        return renew(TestClient(app), owner, tenant["id"]).status_code

    results = sorted(run_concurrently(go, go))
    assert results[0] == 201 and results[1] in (400, 409)
    assert len(client.get(f"/tenants/{tenant['id']}", headers=owner).json()["renewals"]) == 1


# ---- Profit & loss ----

def add_expense(client, headers, **body):
    payload = {"spentOn": "2026-09-05", "category": "electricity", "amount": 40000}
    payload.update(body)
    return client.post("/expenses", json=payload, headers=headers)


def test_pnl_is_cash_basis(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    aug, sep = payments_for(client, owner, tenant["id"])[1:]
    # August's rent paid in September counts as September income.
    client.post(f"/payments/{aug['id']}/transactions", json={"amount": 9500, "paidDate": "2026-09-02"}, headers=owner)
    client.post(f"/payments/{sep['id']}/transactions", json={"amount": 4000, "paidDate": "2026-09-10"}, headers=owner)
    add_expense(client, owner, amount=5000)
    add_expense(client, owner, category="water", amount=1500)
    pnl = client.get("/reports/pnl?periodMonth=2026-09", headers=owner).json()
    assert pnl["incomeTotal"] == 13500
    assert pnl["expenseTotal"] == 6500
    assert pnl["net"] == 7000
    assert pnl["marginPct"] == pytest.approx(51.9, abs=0.1)
    assert [l["key"] for l in pnl["expenseLines"]] == ["electricity", "water"]  # largest first
    assert pnl["rentBilled"] == 9500 and pnl["collectionRatePct"] == pytest.approx(42.1, abs=0.1)
    assert len(pnl["trend"]) == 6 and pnl["trend"][-1]["periodMonth"] == "2026-09"
    assert pnl["previous"]["periodMonth"] == "2026-08"


def test_pnl_counts_deposit_recovery_and_kept_charges(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"], moveInDate="2026-09-01", rentDueDay=1, depositAmount=20000, agreementExpiry="2027-08-31")
    notice = give_notice(client, owner, tenant["id"], notice="2026-09-05", leaving="2026-09-15")
    client.post(f"/move-outs/{notice['id']}/deductions", json={"label": "Mattress", "amount": 2000}, headers=owner)
    client.post(f"/move-outs/{notice['id']}/settle", json={"refundPaidDate": "2026-09-15"}, headers=owner)
    lines = {l["key"]: l["amount"] for l in client.get("/reports/pnl", headers=owner).json()["incomeLines"]}
    assert lines == {"rent": 0, "rent-from-deposits": 9500, "kept-charges": 2000}


def test_empty_month_has_no_margin(client, owner, prop):
    pnl = client.get("/reports/pnl?periodMonth=2026-01", headers=owner).json()
    assert pnl["incomeTotal"] == 0 and pnl["marginPct"] is None and pnl["collectionRatePct"] is None


def test_expense_rules(client, owner, prop):
    assert add_expense(client, owner, spentOn="2026-09-16").status_code == 400  # future
    assert add_expense(client, owner, amount=0).status_code == 422
    assert add_expense(client, owner, category="party").status_code == 422
    created = add_expense(client, owner).json()
    assert [e["id"] for e in client.get("/expenses?periodMonth=2026-09", headers=owner).json()] == [created["id"]]
    assert client.delete(f"/expenses/{created['id']}", headers=owner).status_code == 204
    assert client.delete(f"/expenses/{created['id']}", headers=owner).status_code == 404


def test_expense_needs_a_property(client, owner):
    assert add_expense(client, owner).status_code == 400
