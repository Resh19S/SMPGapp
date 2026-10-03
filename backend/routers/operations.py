from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

import audit
import clock
from auth import get_current_user
from database import get_db
from models.db_models import (
    Complaint,
    MoveOutNotice,
    SettlementDeduction,
    StaffUser,
    Tenant,
)
from models.schemas import (
    AddDeductionRequest,
    ComplaintOut,
    CreateComplaintRequest,
    MoveOutNoticeOut,
    ScheduleInspectionRequest,
    SettleRequest,
    UpdateComplaintRequest,
    UpdateNoticeRequest,
)
from routers.payments import add_payment, ensure_payments_up_to_date
from serializers import notice_expected_refund, outstanding_amount, serialize_complaint, serialize_notice

router = APIRouter(tags=["operations"])


# ---- Complaints ----

def _active_staff(db: Session, staff_id: int | None) -> StaffUser | None:
    if staff_id is None:
        return None
    staff = db.get(StaffUser, staff_id)
    if staff is None or not staff.is_active:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return staff


@router.get("/complaints", response_model=list[ComplaintOut])
def list_complaints(
    includeResolved: bool = False,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    query = db.query(Complaint)
    if not includeResolved:
        query = query.filter(Complaint.status != "resolved")
    complaints = query.order_by(Complaint.created_at.desc()).all()
    # Urgent first, then oldest first within a priority — the one that's waited longest gets done next.
    complaints.sort(key=lambda c: (c.status == "resolved", c.priority != "urgent", c.created_at))
    return [serialize_complaint(c) for c in complaints]


@router.post("/complaints", response_model=ComplaintOut, status_code=201)
def create_complaint(
    request: CreateComplaintRequest,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    room_number = request.roomNumber.strip()
    if request.tenantId is not None:
        tenant = db.get(Tenant, request.tenantId)
        if tenant is None:
            raise HTTPException(status_code=404, detail="Tenant not found")
        room_number = room_number or tenant.bed.room_number
    complaint = Complaint(
        title=request.title.strip(),
        description=request.description.strip(),
        category=request.category,
        priority=request.priority,
        room_number=room_number,
        tenant_id=request.tenantId,
        assigned_to_id=_active_staff(db, request.assignedToId).id if request.assignedToId else None,
    )
    db.add(complaint)
    db.flush()
    audit.record(
        db, user, "complaint.created", "complaint", complaint.id,
        f"{complaint.title}{' · room ' + complaint.room_number if complaint.room_number else ''} ({complaint.priority})",
    )
    db.commit()
    db.refresh(complaint)
    return serialize_complaint(complaint)


@router.patch("/complaints/{complaint_id}", response_model=ComplaintOut)
def update_complaint(
    complaint_id: int,
    request: UpdateComplaintRequest,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    complaint = db.get(Complaint, complaint_id)
    if complaint is None:
        raise HTTPException(status_code=404, detail="Complaint not found")
    data = request.model_dump(exclude_unset=True)
    changes = []
    if "status" in data and data["status"] != complaint.status:
        changes.append(f"status {complaint.status} → {data['status']}")
    if "priority" in data and data["priority"] != complaint.priority:
        changes.append(f"priority {complaint.priority} → {data['priority']}")
    if "assignedToId" in data and data["assignedToId"] != complaint.assigned_to_id:
        changes.append("assignment changed")
    if changes:
        audit.record(db, user, "complaint.updated", "complaint", complaint.id, f"{complaint.title}: " + "; ".join(changes))
    if "status" in data:
        complaint.status = data["status"]
        complaint.resolved_at = clock.utcnow() if data["status"] == "resolved" else None
    if "priority" in data:
        complaint.priority = data["priority"]
    if "assignedToId" in data:
        staff = _active_staff(db, data["assignedToId"])
        complaint.assigned_to_id = staff.id if staff else None
    db.commit()
    db.refresh(complaint)
    return serialize_complaint(complaint)


# ---- Move-outs ----

def _open_notice(db: Session, notice_id: int) -> MoveOutNotice:
    notice = db.get(MoveOutNotice, notice_id)
    if notice is None:
        raise HTTPException(status_code=404, detail="Move-out notice not found")
    if notice.status == "settled":
        raise HTTPException(status_code=400, detail="This move-out is already settled")
    return notice


@router.get("/move-outs", response_model=list[MoveOutNoticeOut])
def list_move_outs(
    includeSettled: bool = False,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    ensure_payments_up_to_date(db)
    query = db.query(MoveOutNotice)
    if not includeSettled:
        query = query.filter(MoveOutNotice.status != "settled")
    notices = query.order_by(MoveOutNotice.planned_move_out_date).all()
    return [serialize_notice(n) for n in notices]


@router.patch("/move-outs/{notice_id}", response_model=MoveOutNoticeOut)
def update_move_out(
    notice_id: int,
    request: UpdateNoticeRequest,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    notice = _open_notice(db, notice_id)
    if request.plannedMoveOutDate is not None:
        if request.plannedMoveOutDate < notice.tenant.move_in_date:
            raise HTTPException(status_code=400, detail="Move-out date cannot precede move-in date")
        audit.record(
            db, user, "moveout.date_changed", "move_out_notice", notice.id,
            f"{notice.tenant.name}: {audit.d(notice.planned_move_out_date)} → {audit.d(request.plannedMoveOutDate)}",
        )
        notice.planned_move_out_date = request.plannedMoveOutDate
    db.commit()
    db.refresh(notice)
    return serialize_notice(notice)


@router.post("/move-outs/{notice_id}/inspection", response_model=MoveOutNoticeOut)
def schedule_inspection(
    notice_id: int,
    request: ScheduleInspectionRequest,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    notice = _open_notice(db, notice_id)
    audit.record(db, user, "moveout.inspection", "move_out_notice", notice.id, f"{notice.tenant.name}: inspection {audit.d(request.inspectionDate)}")
    notice.inspection_date = request.inspectionDate
    notice.status = "inspection-scheduled"
    db.commit()
    db.refresh(notice)
    return serialize_notice(notice)


@router.post("/move-outs/{notice_id}/deductions", response_model=MoveOutNoticeOut, status_code=201)
def add_deduction(
    notice_id: int,
    request: AddDeductionRequest,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    notice = _open_notice(db, notice_id)
    notice.deductions.append(SettlementDeduction(label=request.label.strip(), amount=request.amount))
    audit.record(db, user, "moveout.deduction_added", "move_out_notice", notice.id, f"{notice.tenant.name}: {request.label.strip()} ₹{request.amount:,.2f}")
    db.commit()
    db.refresh(notice)
    return serialize_notice(notice)


@router.delete("/move-outs/{notice_id}/deductions/{deduction_id}", response_model=MoveOutNoticeOut)
def remove_deduction(
    notice_id: int,
    deduction_id: int,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    notice = _open_notice(db, notice_id)
    deduction = db.get(SettlementDeduction, deduction_id)
    if deduction is None or deduction.notice_id != notice.id:
        raise HTTPException(status_code=404, detail="Deduction not found")
    audit.record(db, user, "moveout.deduction_removed", "move_out_notice", notice.id, f"{notice.tenant.name}: {deduction.label} ₹{deduction.amount:,.2f}")
    db.delete(deduction)
    db.commit()
    db.refresh(notice)
    return serialize_notice(notice)


@router.post("/move-outs/{notice_id}/settle", response_model=MoveOutNoticeOut)
def settle_move_out(
    notice_id: int,
    request: SettleRequest,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    """Close the move-out: the resident leaves on the planned date, unpaid rent
    is recovered from the deposit (oldest month first), and the rest is refunded
    minus deductions."""
    notice = _open_notice(db, notice_id)
    today = clock.today()
    if notice.planned_move_out_date > today:
        raise HTTPException(
            status_code=400,
            detail="Can't settle before the move-out date. Change the move-out date if the resident is leaving early.",
        )
    if request.refundPaidDate > today:
        raise HTTPException(status_code=400, detail="Refund date can't be in the future")

    # Claim the settlement atomically: a double-click or a second staff member
    # settling at the same moment finds the status already changed and stops,
    # so the deposit is never applied twice.
    claimed = db.execute(
        update(MoveOutNotice)
        .where(MoveOutNotice.id == notice.id, MoveOutNotice.status != "settled")
        .values(status="settled")
    )
    if claimed.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=400, detail="This move-out is already settled")

    tenant = notice.tenant
    tenant.move_out_date = notice.planned_move_out_date
    db.flush()
    # Bill every month through the move-out date, inside this same transaction.
    ensure_payments_up_to_date(db, today, commit=False)
    db.refresh(notice)

    refund = notice_expected_refund(notice)
    available = tenant.deposit_amount
    for payment in sorted(tenant.payments, key=lambda p: p.due_date):
        owed = outstanding_amount(payment)
        if owed <= 0 or available <= 0:
            continue
        amount = min(owed, available)
        add_payment(
            db, payment.id, amount, request.refundPaidDate, "deposit", "Recovered from deposit at move-out", user
        )
        available -= amount

    notice.refund_amount = refund
    notice.refund_paid_date = request.refundPaidDate
    audit.record(db, user, "moveout.settled", "move_out_notice", notice.id, f"refund ₹{refund:,.2f}")
    db.commit()
    db.refresh(notice)
    return serialize_notice(notice)
