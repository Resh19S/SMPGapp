import calendar
import datetime
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

import audit
import clock
from auth import get_current_user
from database import get_db, insert_ignoring_conflicts
from models.db_models import Payment, PaymentTransaction, StaffUser, Tenant
from models.schemas import (
    DailyCollection,
    PaymentTransactionOut,
    ReceiptOut,
    RecordPaymentRequest,
    RentRecordOut,
    RentSummaryOut,
)
from serializers import outstanding_amount, payment_status, rent_for_period, serialize_payment, serialize_transaction

router = APIRouter(prefix="/payments", tags=["payments"])

PeriodQuery = Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]

# Next month's rent row appears this many days before it falls due, so rent
# paid in advance (1 October's rent handed over on 29 September) can be recorded.
ADVANCE_BILLING_DAYS = 10


def _month_due_date(year: int, month: int, rent_due_day: int) -> datetime.date:
    last_day = calendar.monthrange(year, month)[1]
    return datetime.date(year, month, min(rent_due_day, last_day))


def _add_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def ensure_payments_up_to_date(db: Session, today: datetime.date | None = None, commit: bool = True) -> None:
    """Generate missing monthly payment records for every tenant, from their
    move-in month through the current month — plus next month once its due
    date is within ADVANCE_BILLING_DAYS, unless they're leaving before then.
    Rent Tracker is a computed view over Tenant + this payment log, never a
    hand-maintained record.

    Safe under concurrency: rows are inserted with ON CONFLICT DO NOTHING on
    (tenant_id, period_month), so two requests generating the same month at
    the same moment produce one row, not two and not an error."""
    today = today or clock.today()
    existing = set(db.execute(select(Payment.tenant_id, Payment.period_month)).all())
    tenants = db.query(Tenant).options(selectinload(Tenant.renewals), selectinload(Tenant.notice)).all()
    rows = []

    def due_date_for(tenant: Tenant, year: int, month: int) -> datetime.date:
        due = _month_due_date(year, month, tenant.rent_due_day)
        # The first month's rent can't fall due before the resident has moved in.
        if (year, month) == (tenant.move_in_date.year, tenant.move_in_date.month):
            due = max(due, tenant.move_in_date)
        return due

    def add_row(tenant: Tenant, year: int, month: int, due: datetime.date) -> None:
        period = f"{year:04d}-{month:02d}"
        if (tenant.id, period) not in existing:
            rows.append(
                dict(
                    tenant_id=tenant.id,
                    period_month=period,
                    due_date=due,
                    amount_due=rent_for_period(tenant, period),
                    amount_paid=0,
                    paid_date=None,
                )
            )

    for tenant in tenants:
        end_date = min(tenant.move_out_date or today, today)
        year, month = tenant.move_in_date.year, tenant.move_in_date.month
        while (year, month) <= (end_date.year, end_date.month):
            add_row(tenant, year, month, due_date_for(tenant, year, month))
            year, month = _add_month(year, month)

        # Advance billing for next month.
        if tenant.move_out_date is None:
            ny, nm = _add_month(today.year, today.month)
            if (ny, nm) >= (tenant.move_in_date.year, tenant.move_in_date.month):
                due = due_date_for(tenant, ny, nm)
                leaving_first = tenant.notice is not None and tenant.notice.planned_move_out_date < due
                if (due - today).days <= ADVANCE_BILLING_DAYS and not leaving_first:
                    add_row(tenant, ny, nm, due)
    if rows:
        db.execute(insert_ignoring_conflicts(Payment.__table__, ["tenant_id", "period_month"]), rows)
    if commit:
        db.commit()
    else:
        db.flush()
        db.expire_all()  # rows inserted via Core — reload relationships that now have new payments


class PaymentRejected(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code, self.detail = status_code, detail


def add_payment(
    db: Session,
    payment_id: int,
    amount: float,
    paid_date: datetime.date,
    method: str,
    note: str = "",
    user: StaffUser | None = None,
    client_ref: str | None = None,
) -> Payment:
    """Record money against a month, atomically.

    The balance check and the increment happen in ONE conditional UPDATE, so
    two staff recording the last ₹9,500 at the same moment can't both
    succeed — the second finds no balance left. Caller commits."""
    result = db.execute(
        update(Payment)
        .where(Payment.id == payment_id, Payment.amount_due - Payment.amount_paid >= amount - 0.001)
        .values(amount_paid=Payment.amount_paid + amount)
    )
    if result.rowcount == 0:
        payment = db.get(Payment, payment_id)
        if payment is None:
            raise PaymentRejected(404, "Payment record not found")
        remaining = payment.amount_due - payment.amount_paid
        if remaining <= 0:
            raise PaymentRejected(409, "This month is already fully paid")
        raise PaymentRejected(400, f"Amount is more than the ₹{remaining:,.0f} still owed for this month")

    db.add(
        PaymentTransaction(
            payment_id=payment_id,
            amount=amount,
            paid_date=paid_date,
            method=method,
            note=note,
            client_ref=client_ref,
            recorded_by_id=user.id if user else None,
        )
    )
    db.execute(
        update(Payment)
        .where(Payment.id == payment_id, Payment.paid_date.is_(None), Payment.amount_paid >= Payment.amount_due)
        .values(paid_date=paid_date)
    )
    db.flush()
    payment = db.get(Payment, payment_id)
    db.refresh(payment)
    audit.record(
        db, user, "payment.recorded", "payment", payment_id,
        f"{payment.tenant.name} · {payment.period_month}: ₹{amount:,.2f} via {method} on {audit.d(paid_date)}",
    )
    return payment


@router.get("", response_model=list[RentRecordOut])
def list_payments(
    periodMonth: PeriodQuery = None,
    status: Annotated[str | None, Query(pattern=r"^(paid|due|overdue)$")] = None,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    today = clock.today()
    ensure_payments_up_to_date(db, today)

    query = db.query(Payment).options(
        selectinload(Payment.tenant).selectinload(Tenant.bed), selectinload(Payment.transactions)
    )
    if periodMonth is not None:
        query = query.filter(Payment.period_month == periodMonth)
    payments = query.order_by(Payment.due_date.desc(), Payment.id).all()

    records = [serialize_payment(p, today) for p in payments]
    if status is not None:
        records = [r for r in records if r.status == status]
    return records


@router.get("/summary", response_model=RentSummaryOut)
def rent_summary(
    periodMonth: PeriodQuery = None,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    today = clock.today()
    ensure_payments_up_to_date(db, today)

    query = db.query(Payment).options(selectinload(Payment.transactions))
    if periodMonth is not None:
        query = query.filter(Payment.period_month == periodMonth)
    payments = query.all()

    statuses = [(p, payment_status(p, today)) for p in payments]
    overdue = [p for p, s in statuses if s == "overdue"]

    daily: list[DailyCollection] = []
    if periodMonth is not None:
        by_day: dict[datetime.date, float] = defaultdict(float)
        for p in payments:
            for tx in p.transactions:
                by_day[tx.paid_date] += tx.amount
        daily = [DailyCollection(date=d, amount=a) for d, a in sorted(by_day.items())]

    deposits_held = sum(t.deposit_amount for t in db.query(Tenant).filter(Tenant.move_out_date.is_(None)).all())

    return RentSummaryOut(
        periodMonth=periodMonth,
        billed=sum(p.amount_due for p in payments),
        collected=sum(min(p.amount_paid, p.amount_due) for p in payments),
        outstanding=sum(max(p.amount_due - p.amount_paid, 0) for p in payments),
        dueCount=sum(1 for _, s in statuses if s == "due"),
        overdueCount=len(overdue),
        overdueAmount=sum(p.amount_due - p.amount_paid for p in overdue),
        depositsHeld=deposits_held,
        dailyCollections=daily,
    )


@router.get("/transactions", response_model=list[PaymentTransactionOut])
def list_transactions(
    periodMonth: PeriodQuery = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    query = db.query(PaymentTransaction).join(Payment)
    if periodMonth is not None:
        query = query.filter(Payment.period_month == periodMonth)
    txs = query.order_by(PaymentTransaction.paid_date.desc(), PaymentTransaction.id.desc()).limit(limit).all()
    return [serialize_transaction(tx) for tx in txs]


@router.get("/transactions/{transaction_id}", response_model=ReceiptOut)
def get_receipt(
    transaction_id: int,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    """Everything a printable rent receipt needs for one payment."""
    tx = db.get(PaymentTransaction, transaction_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    payment = tx.payment
    paid_so_far = sum(t.amount for t in payment.transactions if t.id <= tx.id)
    prop = payment.tenant.bed.property
    recorder = db.get(StaffUser, tx.recorded_by_id) if tx.recorded_by_id else None
    return ReceiptOut(
        **serialize_transaction(tx).model_dump(),
        propertyName=prop.name,
        propertyAddress=prop.address,
        monthRent=payment.amount_due,
        paidSoFar=paid_so_far,
        balance=max(payment.amount_due - paid_so_far, 0),
        receivedBy=recorder.name if recorder else None,
    )


@router.post("/{payment_id}/transactions", response_model=RentRecordOut, status_code=201)
def record_payment(
    payment_id: int,
    request: RecordPaymentRequest,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", max_length=64)] = None,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    today = clock.today()
    if request.paidDate > today:
        raise HTTPException(status_code=400, detail="Payment date can't be in the future")

    # A retry of a request we already processed gets the original answer.
    if idempotency_key:
        prior = db.query(PaymentTransaction).filter(PaymentTransaction.client_ref == idempotency_key).first()
        if prior is not None:
            if prior.payment_id != payment_id:
                raise HTTPException(status_code=409, detail="Idempotency key was already used for a different payment")
            return serialize_payment(prior.payment, today)

    try:
        payment = add_payment(
            db, payment_id, request.amount, request.paidDate, request.method, request.note, user, idempotency_key
        )
        db.commit()
    except PaymentRejected as e:
        db.rollback()
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except IntegrityError:
        # Same idempotency key raced in from a parallel retry — it won; return its result.
        db.rollback()
        prior = db.query(PaymentTransaction).filter(PaymentTransaction.client_ref == idempotency_key).first()
        if prior is None:
            raise
        return serialize_payment(prior.payment, today)
    return serialize_payment(payment, today)
