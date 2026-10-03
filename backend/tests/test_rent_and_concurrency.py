"""Rent generation, payments, and the ticket-booking failure modes: two
requests racing for the same bed, the same month, or the same balance."""

import datetime
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

import clock
from conftest import add_bed, move_in, payments_for
from main import app
from models.db_models import Payment, PaymentTransaction, Tenant
from routers.payments import ensure_payments_up_to_date


def run_concurrently(*calls):
    """Start every call at the same instant (barrier) and collect results in order."""
    barrier = threading.Barrier(len(calls))
    results = [None] * len(calls)

    def worker(i, fn):
        barrier.wait()
        results[i] = fn()

    threads = [threading.Thread(target=worker, args=(i, fn)) for i, fn in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


# ---- Rent generation ----

def test_months_generated_from_move_in_to_today(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])  # moved in 10/07, due on the 5th
    records = payments_for(client, owner, tenant["id"])
    assert [r["periodMonth"] for r in records] == ["2026-07", "2026-08", "2026-09"]
    # First month can't fall due before move-in: 5 July -> 10 July.
    assert records[0]["dueDate"] == "2026-07-10"
    assert {r["status"] for r in records} == {"overdue"}


def test_due_day_31_clamps_to_short_months(client, owner, prop, monkeypatch):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"], moveInDate="2026-01-31", rentDueDay=31, agreementExpiry="2027-01-30")
    feb = next(r for r in payments_for(client, owner, tenant["id"]) if r["periodMonth"] == "2026-02")
    assert feb["dueDate"] == "2026-02-28"


def test_future_move_in_reserves_bed_without_billing(client, owner, prop):
    bed = add_bed(client, owner, prop["id"])
    tenant = move_in(client, owner, bed["id"], moveInDate="2026-10-03", agreementExpiry="2027-10-02")
    assert payments_for(client, owner, tenant["id"]) == []
    assert client.get("/beds", headers=owner).json()[0]["rentState"] == "reserved"


def test_generation_is_idempotent(client, owner, prop, db):
    move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    ensure_payments_up_to_date(db)
    ensure_payments_up_to_date(db)
    assert db.query(Payment).count() == 3


def test_database_refuses_duplicate_month(client, owner, prop, db):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    client.get("/payments", headers=owner)
    db.add(Payment(tenant_id=tenant["id"], period_month="2026-09", due_date=datetime.date(2026, 9, 5), amount_due=1, amount_paid=0))
    with pytest.raises(IntegrityError):
        db.commit()


def test_concurrent_reads_never_duplicate_months(client, owner, prop, db):
    for label in "ABC":
        move_in(client, owner, add_bed(client, owner, prop["id"], label=label)["id"], name=f"T {label}", phone=f"98220112{ord(label)}")
    results = run_concurrently(*[lambda: TestClient(app).get("/dashboard", headers=owner).status_code for _ in range(6)])
    assert results == [200] * 6
    assert db.query(Payment).count() == 9  # 3 tenants x 3 months, no duplicates


def test_bed_rent_change_does_not_reprice_current_resident(client, owner, prop):
    bed = add_bed(client, owner, prop["id"])
    tenant = move_in(client, owner, bed["id"])
    client.patch(f"/beds/{bed['id']}", json={"rentAmount": 12000}, headers=owner)
    assert client.get(f"/tenants/{tenant['id']}", headers=owner).json()["rentAmount"] == 9500


def test_negotiated_rent_overrides_listed_rent(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"], rentAmount=9000)
    assert {r["amountDue"] for r in payments_for(client, owner, tenant["id"])} == {9000}


# ---- Payments ----

def test_part_payments_accumulate(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    sep = payments_for(client, owner, tenant["id"])[-1]
    r1 = client.post(f"/payments/{sep['id']}/transactions", json={"amount": 4000, "paidDate": "2026-09-10"}, headers=owner).json()
    assert (r1["amountPaid"], r1["status"], r1["paidDate"]) == (4000, "overdue", None)
    r2 = client.post(f"/payments/{sep['id']}/transactions", json={"amount": 5500, "paidDate": "2026-09-12"}, headers=owner).json()
    assert (r2["amountPaid"], r2["status"], r2["paidDate"]) == (9500, "paid", "2026-09-12")


def test_overpayment_and_paying_a_paid_month_are_refused(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    sep = payments_for(client, owner, tenant["id"])[-1]
    assert client.post(f"/payments/{sep['id']}/transactions", json={"amount": 9501, "paidDate": "2026-09-10"}, headers=owner).status_code == 400
    assert client.post(f"/payments/{sep['id']}/transactions", json={"amount": 9500, "paidDate": "2026-09-10"}, headers=owner).status_code == 201
    assert client.post(f"/payments/{sep['id']}/transactions", json={"amount": 1, "paidDate": "2026-09-10"}, headers=owner).status_code == 409


@pytest.mark.parametrize("amount", [0, -5, 100.001])
def test_bad_payment_amounts(client, owner, prop, amount):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    sep = payments_for(client, owner, tenant["id"])[-1]
    assert client.post(f"/payments/{sep['id']}/transactions", json={"amount": amount, "paidDate": "2026-09-10"}, headers=owner).status_code == 422


def test_future_dated_payment_refused(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    sep = payments_for(client, owner, tenant["id"])[-1]
    assert client.post(f"/payments/{sep['id']}/transactions", json={"amount": 100, "paidDate": "2026-09-16"}, headers=owner).status_code == 400


def test_payment_on_missing_record_is_404(client, owner):
    assert client.post("/payments/999/transactions", json={"amount": 100, "paidDate": "2026-09-10"}, headers=owner).status_code == 404


def test_idempotent_retry_records_once(client, owner, prop, db):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    sep = payments_for(client, owner, tenant["id"])[-1]
    headers = {**owner, "Idempotency-Key": "modal-123"}
    first = client.post(f"/payments/{sep['id']}/transactions", json={"amount": 3000, "paidDate": "2026-09-10"}, headers=headers)
    retry = client.post(f"/payments/{sep['id']}/transactions", json={"amount": 3000, "paidDate": "2026-09-10"}, headers=headers)
    assert first.status_code == 201 and retry.status_code == 201
    assert retry.json()["amountPaid"] == 3000
    assert db.query(PaymentTransaction).count() == 1


def test_idempotency_key_cannot_be_reused_for_another_payment(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    aug, sep = payments_for(client, owner, tenant["id"])[1:]
    headers = {**owner, "Idempotency-Key": "k1"}
    client.post(f"/payments/{aug['id']}/transactions", json={"amount": 100, "paidDate": "2026-09-10"}, headers=headers)
    assert client.post(f"/payments/{sep['id']}/transactions", json={"amount": 100, "paidDate": "2026-09-10"}, headers=headers).status_code == 409


def test_two_staff_paying_the_last_balance_at_once(client, owner, prop, db):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    sep = payments_for(client, owner, tenant["id"])[-1]

    def pay():
        return TestClient(app).post(f"/payments/{sep['id']}/transactions", json={"amount": 9500, "paidDate": "2026-09-10"}, headers=owner).status_code

    assert sorted(run_concurrently(pay, pay)) == [201, 409]
    db.expire_all()
    assert db.get(Payment, sep["id"]).amount_paid == 9500  # never 19,000


def test_double_click_with_same_key_at_once(client, owner, prop, db):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"])
    sep = payments_for(client, owner, tenant["id"])[-1]
    headers = {**owner, "Idempotency-Key": "same-click"}

    def pay():
        return TestClient(app).post(f"/payments/{sep['id']}/transactions", json={"amount": 2000, "paidDate": "2026-09-10"}, headers=headers).status_code

    assert run_concurrently(pay, pay) == [201, 201]
    db.expire_all()
    assert db.get(Payment, sep["id"]).amount_paid == 2000
    assert db.query(PaymentTransaction).count() == 1


# ---- Double booking ----

def test_database_refuses_two_active_tenants_on_one_bed(client, owner, prop, db):
    bed = add_bed(client, owner, prop["id"])
    move_in(client, owner, bed["id"])
    db.add(Tenant(name="X", phone="9822011220", bed_id=bed["id"], move_in_date=datetime.date(2026, 9, 1), rent_due_day=1, rent_amount=1, deposit_amount=0, agreement_expiry=datetime.date(2027, 1, 1)))
    with pytest.raises(IntegrityError):
        db.commit()


def test_two_staff_booking_the_same_bed_at_once(client, owner, prop, db):
    bed = add_bed(client, owner, prop["id"])

    def book(n):
        body = {"name": f"Guest {n}", "phone": f"982201122{n}", "bedId": bed["id"], "moveInDate": "2026-09-15", "rentDueDay": 1, "depositAmount": 0, "agreementExpiry": "2027-09-14"}
        return lambda: TestClient(app).post("/tenants", json=body, headers=owner).status_code

    assert sorted(run_concurrently(book(1), book(2))) == [201, 409]
    assert db.query(Tenant).filter(Tenant.bed_id == bed["id"]).count() == 1


def test_bed_reusable_after_move_out(client, owner, prop):
    bed = add_bed(client, owner, prop["id"])
    tenant = move_in(client, owner, bed["id"], moveInDate="2026-03-01", agreementExpiry="2027-02-28")
    client.post(f"/tenants/{tenant['id']}/notice", json={"noticeDate": "2026-08-15", "plannedMoveOutDate": "2026-09-14"}, headers=owner)
    notice = client.get("/move-outs", headers=owner).json()[0]
    assert client.post(f"/move-outs/{notice['id']}/settle", json={"refundPaidDate": "2026-09-15"}, headers=owner).status_code == 200
    move_in(client, owner, bed["id"], name="Next Resident", phone="9822099999", moveInDate="2026-09-15", agreementExpiry="2027-09-14")


# ---- Timezone ----

def test_clock_uses_india_time():
    import datetime as dt

    assert str(clock.APP_TZ) == "Asia/Kolkata"
    # 20:00 UTC on the 30th is already the 1st in India.
    utc = dt.datetime(2026, 9, 30, 20, 0, tzinfo=dt.UTC)
    assert utc.astimezone(clock.APP_TZ).date() == dt.date(2026, 10, 1)


# ---- Advance billing ----

def test_next_month_billed_in_advance_near_due_date(client, owner, prop, monkeypatch):
    import datetime as dt

    bed = add_bed(client, owner, prop["id"])
    tenant = move_in(client, owner, bed["id"], rentDueDay=1)
    for p in payments_for(client, owner, tenant["id"]):
        client.post(f"/payments/{p['id']}/transactions", json={"amount": p["amountDue"], "paidDate": "2026-09-01"}, headers=owner)
    monkeypatch.setattr(clock, "today", lambda: dt.date(2026, 9, 25))
    months = payments_for(client, owner, tenant["id"])
    assert months[-1]["periodMonth"] == "2026-10" and months[-1]["status"] == "due"
    # A resident paying October early can now be recorded...
    oct_ = months[-1]
    assert client.post(f"/payments/{oct_['id']}/transactions", json={"amount": 9500, "paidDate": "2026-09-25"}, headers=owner).status_code == 201
    # ...and the unpaid-October case doesn't repaint a paid-up bed as "due".
    assert client.get("/beds", headers=owner).json()[0]["rentState"] == "paid"


def test_no_advance_bill_when_leaving_before_it_falls_due(client, owner, prop, monkeypatch):
    import datetime as dt

    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"], rentDueDay=1)
    client.post(f"/tenants/{tenant['id']}/notice", json={"noticeDate": "2026-09-01", "plannedMoveOutDate": "2026-09-28"}, headers=owner)
    monkeypatch.setattr(clock, "today", lambda: dt.date(2026, 9, 25))
    assert payments_for(client, owner, tenant["id"])[-1]["periodMonth"] == "2026-09"


def test_no_advance_bill_far_from_due_date(client, owner, prop):
    tenant = move_in(client, owner, add_bed(client, owner, prop["id"])["id"], rentDueDay=1)  # today = 15/09, Oct 1 is 16 days out
    assert payments_for(client, owner, tenant["id"])[-1]["periodMonth"] == "2026-09"
