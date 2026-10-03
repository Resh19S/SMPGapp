import datetime
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import clock
from auth import get_current_user
from database import get_db
from models.db_models import Bed, Complaint, Lead, MoveOutNotice, Payment, StaffUser, Tenant
from models.schemas import (
    AgeingBucket,
    DashboardSummaryOut,
    DecisionItem,
    FollowUpEntry,
    MoveEntry,
    UpcomingEvent,
)
from routers.payments import ensure_payments_up_to_date
from serializers import outstanding_amount, payment_status, serialize_bed

router = APIRouter(tags=["dashboard"])

DECISION_QUEUE_LIMIT = 8
UPCOMING_LIMIT = 12


def _inr(amount: float) -> str:
    """₹ with Indian digit grouping (1,23,456)."""
    n = int(round(amount))
    s = str(n)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups) + "," + tail
    return f"₹{s}"


def _room(tenant: Tenant) -> str:
    return f"{tenant.bed.room_number}/{tenant.bed.bed_label}"


def _day_word(date: datetime.date, today: datetime.date) -> str:
    delta = (date - today).days
    if delta == 0:
        return "today"
    if delta == 1:
        return "tomorrow"
    if delta < 0:
        return f"{-delta}d ago"
    return date.strftime("%d/%m")


def _decision_queue(db: Session, today: datetime.date, overdue: list[Payment]) -> list[DecisionItem]:
    items: list[DecisionItem] = []
    now = clock.utcnow()

    # Rent: residents over a month behind get their own line; everyone else
    # late rolls up into one line so a busy month doesn't bury everything else.
    by_tenant: dict[int, list[Payment]] = defaultdict(list)
    for p in overdue:
        # Leavers mid-notice are handled by the move-out item; once settled, any
        # rent the deposit didn't cover is a plain debt again.
        notice = p.tenant.notice
        if notice is None or notice.status == "settled":
            by_tenant[p.tenant_id].append(p)
    recent_late: list[tuple[Tenant, float]] = []
    for payments in by_tenant.values():
        tenant = payments[0].tenant
        owed = sum(outstanding_amount(p) for p in payments)
        days = (today - min(p.due_date for p in payments)).days
        if days <= 30:
            recent_late.append((tenant, owed))
            continue
        months = len(payments)
        items.append(
            DecisionItem(
                kind="rent",
                title=f"{_inr(owed)} overdue — {tenant.name}",
                detail=f"Room {_room(tenant)} · {days} days late"
                + (f" · {months} months unpaid" if months > 1 else ""),
                amountAtRisk=owed,
                tier=1,
                link="/rent",
            )
        )
    if recent_late:
        recent_late.sort(key=lambda x: -x[1])
        total = sum(owed for _, owed in recent_late)
        rooms = ", ".join(t.bed.room_number for t, _ in recent_late[:4])
        items.append(
            DecisionItem(
                kind="rent",
                title=f"{len(recent_late)} resident{'s' if len(recent_late) > 1 else ''} late on rent — {_inr(total)} in all",
                detail=f"Rooms {rooms}" + (" and more" if len(recent_late) > 4 else "") + " · under 30 days late",
                amountAtRisk=total,
                tier=2,
                link="/rent",
            )
        )

    # Complaints: urgent ones always surface; normal ones only if nobody has picked them up in 2 days.
    for c in db.query(Complaint).filter(Complaint.status != "resolved").all():
        hours = int((now - c.created_at).total_seconds() // 3600)
        who = f"Assigned to {c.assigned_to.name}" if c.assigned_to else "Unassigned"
        if c.priority == "urgent":
            tier = 1 if hours >= 24 or c.assigned_to is None else 2
        elif c.assigned_to is None and hours >= 48:
            tier = 3
        else:
            continue
        items.append(
            DecisionItem(
                kind="complaint",
                title=c.title + (f" · room {c.room_number}" if c.room_number else ""),
                detail=f"{who} · open {hours}h",
                amountAtRisk=0,
                tier=tier,
                link="/operations",
            )
        )

    # Move-outs: settlement is due, or the exit is close and nobody's booked the inspection.
    for n in db.query(MoveOutNotice).filter(MoveOutNotice.status != "settled").all():
        days_to_exit = (n.planned_move_out_date - today).days
        deposit = n.tenant.deposit_amount
        if days_to_exit <= 0:
            items.append(
                DecisionItem(
                    kind="move-out",
                    title=f"Settle {n.tenant.name}'s deposit",
                    detail=f"Moved out {_day_word(n.planned_move_out_date, today)} · {_inr(deposit)} deposit held",
                    amountAtRisk=deposit,
                    tier=1,
                    link="/operations",
                )
            )
        elif n.inspection_date is None and days_to_exit <= 3:
            items.append(
                DecisionItem(
                    kind="move-out",
                    title=f"{n.tenant.name} leaves {_day_word(n.planned_move_out_date, today)} — no inspection booked",
                    detail=f"Room {_room(n.tenant)} · {_inr(deposit)} deposit held",
                    amountAtRisk=deposit,
                    tier=2,
                    link="/operations",
                )
            )
        elif n.inspection_date is not None and 0 <= (n.inspection_date - today).days <= 1:
            items.append(
                DecisionItem(
                    kind="move-out",
                    title=f"{n.tenant.name}'s exit inspection is {_day_word(n.inspection_date, today)}",
                    detail=f"Room {_room(n.tenant)} · {_inr(deposit)} deposit held",
                    amountAtRisk=deposit,
                    tier=2,
                    link="/operations",
                )
            )

    active = db.query(Tenant).filter(Tenant.move_out_date.is_(None)).all()

    # Agreements: a lapsed or lapsing agreement with no notice means a renewal conversation.
    for t in active:
        if t.notice is not None:
            continue
        days_left = (t.agreement_expiry - today).days
        if days_left <= 30:
            items.append(
                DecisionItem(
                    kind="agreement",
                    title=f"{t.name}'s agreement "
                    + ("expired" if days_left < 0 else f"expires in {days_left} days"),
                    detail=f"Room {_room(t)} · renew or collect notice",
                    amountAtRisk=t.bed.rent_amount,
                    tier=2 if days_left < 0 else 3,
                    link="/tenants?filter=renewals",
                )
            )

    # Documents and leads: roll up into one line each — they're chores, not emergencies.
    missing_id = [t for t in active if any(d.doc_type == "id-proof" and not d.file_name for d in t.documents)]
    if missing_id:
        names = ", ".join(t.name.split()[0] for t in missing_id[:3])
        items.append(
            DecisionItem(
                kind="documents",
                title=f"{len(missing_id)} resident{'s' if len(missing_id) > 1 else ''} missing ID proof",
                detail=names + (" and others" if len(missing_id) > 3 else ""),
                amountAtRisk=0,
                tier=3,
                link="/tenants",
            )
        )

    leads_due = (
        db.query(Lead)
        .filter(Lead.follow_up_date.is_not(None), Lead.follow_up_date <= today, Lead.status.in_(["new", "visited"]))
        .all()
    )
    if leads_due:
        names = ", ".join(l.name.split()[0] for l in leads_due[:3])
        items.append(
            DecisionItem(
                kind="lead",
                title=f"{len(leads_due)} lead follow-up{'s' if len(leads_due) > 1 else ''} due",
                detail=names + (" and others" if len(leads_due) > 3 else ""),
                amountAtRisk=0,
                tier=3,
                link="/leads",
            )
        )

    items.sort(key=lambda i: (i.tier, -i.amountAtRisk))
    return items[:DECISION_QUEUE_LIMIT]


def _next_seven_days(db: Session, today: datetime.date) -> list[UpcomingEvent]:
    end = today + datetime.timedelta(days=7)
    events: list[UpcomingEvent] = []

    for t in db.query(Tenant).filter(Tenant.move_in_date > today, Tenant.move_in_date <= end).all():
        events.append(UpcomingEvent(date=t.move_in_date, kind="move-in", title=f"{t.name} moves in", detail=f"Room {_room(t)}"))

    for n in db.query(MoveOutNotice).filter(MoveOutNotice.status != "settled").all():
        if today <= n.planned_move_out_date <= end:
            events.append(
                UpcomingEvent(
                    date=n.planned_move_out_date,
                    kind="move-out",
                    title=f"{n.tenant.name} moves out",
                    detail=f"Room {_room(n.tenant)} · {_inr(n.tenant.deposit_amount)} deposit held",
                )
            )
        if n.inspection_date and today <= n.inspection_date <= end:
            events.append(
                UpcomingEvent(date=n.inspection_date, kind="inspection", title=f"Exit inspection — {n.tenant.name}", detail=f"Room {_room(n.tenant)}")
            )

    for t in db.query(Tenant).filter(
        Tenant.move_out_date.is_(None), Tenant.agreement_expiry >= today, Tenant.agreement_expiry <= end
    ).all():
        events.append(UpcomingEvent(date=t.agreement_expiry, kind="agreement-expiry", title=f"{t.name}'s agreement ends", detail=f"Room {_room(t)}"))

    for l in db.query(Lead).filter(
        Lead.follow_up_date > today, Lead.follow_up_date <= end, Lead.status.in_(["new", "visited"])
    ).all():
        events.append(UpcomingEvent(date=l.follow_up_date, kind="follow-up", title=f"Follow up with {l.name}", detail=l.phone))

    events.sort(key=lambda e: e.date)
    return events[:UPCOMING_LIMIT]


@router.get("/dashboard", response_model=DashboardSummaryOut)
def get_dashboard(db: Session = Depends(get_db), _user: StaffUser = Depends(get_current_user)):
    today = clock.today()
    ensure_payments_up_to_date(db, today)

    beds = [serialize_bed(b, today) for b in db.query(Bed).all()]
    total_beds = len(beds)
    occupied_beds = sum(1 for b in beds if b.status == "occupied")

    tenants = db.query(Tenant).all()
    move_ins_today = [
        MoveEntry(tenantId=t.id, name=t.name, roomNumber=t.bed.room_number, bedLabel=t.bed.bed_label)
        for t in tenants
        if t.move_in_date == today
    ]
    move_outs_today = [
        MoveEntry(tenantId=t.id, name=t.name, roomNumber=t.bed.room_number, bedLabel=t.bed.bed_label)
        for t in tenants
        if t.move_out_date == today or (t.notice and t.notice.status != "settled" and t.notice.planned_move_out_date == today)
    ]

    leads_due = db.query(Lead).filter(Lead.follow_up_date == today, Lead.status != "lost").all()
    follow_ups_today = [FollowUpEntry(leadId=l.id, name=l.name, phone=l.phone) for l in leads_due]

    payments = db.query(Payment).all()
    overdue = [p for p in payments if payment_status(p, today) == "overdue"]

    this_month = today.strftime("%Y-%m")
    month_payments = [p for p in payments if p.period_month == this_month]

    buckets = [("0–7 days", 0, 7), ("8–30 days", 8, 30), ("31+ days", 31, 10**6)]
    ageing = []
    for label, lo, hi in buckets:
        in_bucket = [p for p in overdue if lo <= (today - p.due_date).days <= hi]
        ageing.append(
            AgeingBucket(label=label, amount=sum(outstanding_amount(p) for p in in_bucket), count=len(in_bucket))
        )

    open_complaints = db.query(Complaint).filter(Complaint.status != "resolved").all()
    urgent = [c for c in open_complaints if c.priority == "urgent"]
    oldest_urgent_hours = (
        int((clock.utcnow() - min(c.created_at for c in urgent)).total_seconds() // 3600) if urgent else None
    )

    return DashboardSummaryOut(
        totalBeds=total_beds,
        occupiedBeds=occupied_beds,
        vacantBeds=total_beds - occupied_beds,
        occupancyPct=round(occupied_beds / total_beds * 100, 1) if total_beds else 0,
        billedThisMonth=sum(p.amount_due for p in month_payments),
        collectedThisMonth=sum(min(p.amount_paid, p.amount_due) for p in month_payments),
        overdueAmount=sum(outstanding_amount(p) for p in overdue),
        overdueResidents=len({p.tenant_id for p in overdue}),
        openComplaints=len(open_complaints),
        urgentComplaints=len(urgent),
        oldestUrgentHours=oldest_urgent_hours,
        duesAgeing=ageing,
        decisionQueue=_decision_queue(db, today, overdue),
        nextSevenDays=_next_seven_days(db, today),
        moveInsToday=move_ins_today,
        moveOutsToday=move_outs_today,
        followUpsToday=follow_ups_today,
        rentOverdueCount=len(overdue),
    )
