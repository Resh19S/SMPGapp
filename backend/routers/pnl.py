"""Monthly profit & loss — owner only.

Cash basis: income is money that actually arrived (or was kept from a
deposit) in the month, not rent that was merely billed. Deposits received
are not income — they're owed back — until move-out settlement turns part of
one into recovered rent or kept charges.
"""

import calendar
import datetime
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import audit
import clock
from auth import require_owner
from database import get_db
from models.db_models import Expense, MoveOutNotice, Payment, PaymentTransaction, Property, StaffUser
from models.schemas import CreateExpenseRequest, ExpenseOut, PnlLine, PnlMonth, PnlOut

router = APIRouter(tags=["profit-and-loss"])

PeriodQuery = Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]

EXPENSE_LABELS = {
    "lease": "Building lease",
    "electricity": "Electricity",
    "water": "Water",
    "internet": "Internet",
    "salaries": "Staff salaries",
    "food": "Food & groceries",
    "cleaning": "Cleaning & supplies",
    "maintenance": "Repairs & maintenance",
    "taxes": "Taxes & fees",
    "other": "Other",
}


def _month_bounds(period: str) -> tuple[datetime.date, datetime.date]:
    year, month = map(int, period.split("-"))
    return datetime.date(year, month, 1), datetime.date(year, month, calendar.monthrange(year, month)[1])


def _shift_period(period: str, months: int) -> str:
    year, month = map(int, period.split("-"))
    index = year * 12 + (month - 1) + months
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def _income_lines(db: Session, period: str) -> list[PnlLine]:
    start, end = _month_bounds(period)
    txs = db.query(PaymentTransaction).filter(PaymentTransaction.paid_date.between(start, end)).all()
    rent = sum(t.amount for t in txs if t.method != "deposit")
    from_deposits = sum(t.amount for t in txs if t.method == "deposit")

    # Charges kept at move-out: whatever of the deposit wasn't refunded or used for rent.
    kept = 0.0
    for n in (
        db.query(MoveOutNotice)
        .filter(MoveOutNotice.status == "settled", MoveOutNotice.refund_paid_date.between(start, end))
        .all()
    ):
        rent_recovered = sum(
            tx.amount for p in n.tenant.payments for tx in p.transactions if tx.method == "deposit"
        )
        kept += max(n.tenant.deposit_amount - rent_recovered - (n.refund_amount or 0), 0)

    lines = [PnlLine(key="rent", label="Rent received", amount=rent)]
    if from_deposits:
        lines.append(PnlLine(key="rent-from-deposits", label="Rent recovered from deposits", amount=from_deposits))
    if kept:
        lines.append(PnlLine(key="kept-charges", label="Damage charges kept from deposits", amount=kept))
    return lines


def _expense_lines(db: Session, period: str) -> list[PnlLine]:
    start, end = _month_bounds(period)
    by_category: dict[str, float] = defaultdict(float)
    for e in db.query(Expense).filter(Expense.spent_on.between(start, end)).all():
        by_category[e.category] += e.amount
    lines = [PnlLine(key=c, label=EXPENSE_LABELS[c], amount=a) for c, a in by_category.items()]
    return sorted(lines, key=lambda l: -l.amount)


def _month_totals(db: Session, period: str) -> PnlMonth:
    income = sum(l.amount for l in _income_lines(db, period))
    expenses = sum(l.amount for l in _expense_lines(db, period))
    return PnlMonth(periodMonth=period, income=income, expenses=expenses, net=income - expenses)


@router.get("/reports/pnl", response_model=PnlOut)
def profit_and_loss(
    periodMonth: PeriodQuery = None,
    db: Session = Depends(get_db),
    _owner: StaffUser = Depends(require_owner),
):
    period = periodMonth or clock.current_period()
    income = _income_lines(db, period)
    expenses = _expense_lines(db, period)
    income_total = sum(l.amount for l in income)
    expense_total = sum(l.amount for l in expenses)

    billed_payments = db.query(Payment).filter(Payment.period_month == period).all()
    billed = sum(p.amount_due for p in billed_payments)
    collected_for_period = sum(min(p.amount_paid, p.amount_due) for p in billed_payments)

    trend = [_month_totals(db, _shift_period(period, -i)) for i in range(5, -1, -1)]
    return PnlOut(
        periodMonth=period,
        incomeLines=income,
        incomeTotal=income_total,
        expenseLines=expenses,
        expenseTotal=expense_total,
        net=income_total - expense_total,
        marginPct=round((income_total - expense_total) / income_total * 100, 1) if income_total else None,
        rentBilled=billed,
        collectionRatePct=round(collected_for_period / billed * 100, 1) if billed else None,
        previous=trend[-2],
        trend=trend,
    )


def _serialize_expense(e: Expense) -> ExpenseOut:
    return ExpenseOut(
        id=e.id, spentOn=e.spent_on, category=e.category, description=e.description, paidTo=e.paid_to, amount=e.amount
    )


@router.get("/expenses", response_model=list[ExpenseOut])
def list_expenses(
    periodMonth: PeriodQuery = None,
    db: Session = Depends(get_db),
    _owner: StaffUser = Depends(require_owner),
):
    start, end = _month_bounds(periodMonth or clock.current_period())
    expenses = (
        db.query(Expense)
        .filter(Expense.spent_on.between(start, end))
        .order_by(Expense.spent_on.desc(), Expense.id.desc())
        .all()
    )
    return [_serialize_expense(e) for e in expenses]


@router.post("/expenses", response_model=ExpenseOut, status_code=201)
def create_expense(
    request: CreateExpenseRequest,
    db: Session = Depends(get_db),
    owner: StaffUser = Depends(require_owner),
):
    if request.spentOn > clock.today():
        raise HTTPException(status_code=400, detail="Expense date can't be in the future")
    prop = db.query(Property).order_by(Property.id).first()
    if prop is None:
        raise HTTPException(status_code=400, detail="Set up your property before logging expenses")
    expense = Expense(
        property_id=prop.id,
        spent_on=request.spentOn,
        category=request.category,
        description=request.description,
        paid_to=request.paidTo,
        amount=request.amount,
        created_by_id=owner.id,
    )
    db.add(expense)
    db.flush()
    audit.record(db, owner, "expense.added", "expense", expense.id, f"₹{request.amount:,.2f} {request.category}")
    db.commit()
    db.refresh(expense)
    return _serialize_expense(expense)


@router.delete("/expenses/{expense_id}", status_code=204)
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    owner: StaffUser = Depends(require_owner),
):
    expense = db.get(Expense, expense_id)
    if expense is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    audit.record(
        db, owner, "expense.deleted", "expense", expense.id, f"₹{expense.amount:,.2f} {expense.category} on {expense.spent_on}"
    )
    db.delete(expense)
    db.commit()
