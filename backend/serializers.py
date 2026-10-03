import datetime

import clock
from models.db_models import Bed, Complaint, Lead, MoveOutNotice, Payment, PaymentTransaction, Tenant
from models.schemas import (
    BedOut,
    BedTenantRef,
    ComplaintOut,
    DeductionOut,
    LeadOut,
    MoveOutNoticeOut,
    PaymentTransactionOut,
    RenewalOut,
    RentRecordOut,
    StaffRef,
    TenantDocumentOut,
    TenantNoticeRef,
    TenantOut,
)


def rent_for_period(tenant: Tenant, period: str) -> float:
    """The rent a tenant owes for a YYYY-MM month: the latest renewal that
    has taken effect by then, else the rent agreed at move-in."""
    effective = [r for r in tenant.renewals if r.effective_period <= period]
    if effective:
        return max(effective, key=lambda r: (r.effective_period, r.id)).new_rent
    return tenant.rent_amount


def outstanding_amount(payment: Payment) -> float:
    return max(payment.amount_due - payment.amount_paid, 0)


def serialize_bed(bed: Bed, today: datetime.date) -> BedOut:
    active_tenant = next((t for t in bed.tenants if t.is_active), None)
    rent_state, days_late, outstanding = "vacant", None, 0.0

    if active_tenant is not None:
        if active_tenant.move_in_date > today:
            rent_state = "reserved"
        else:
            # Next month's advance-billed row doesn't make a paid-up bed look "due".
            this_period = today.strftime("%Y-%m")
            unpaid = [p for p in active_tenant.payments if outstanding_amount(p) > 0 and p.period_month <= this_period]
            late = [p for p in unpaid if p.due_date < today]
            due_now = [p for p in unpaid if p.due_date <= today]
            outstanding = sum(outstanding_amount(p) for p in due_now)
            if late:
                rent_state = "late"
                days_late = (today - min(p.due_date for p in late)).days
            elif due_now:
                rent_state = "due-today"
            elif unpaid:
                rent_state = "due"
            else:
                rent_state = "paid"

    return BedOut(
        id=bed.id,
        propertyId=bed.property_id,
        floor=bed.floor,
        roomNumber=bed.room_number,
        bedLabel=bed.bed_label,
        rentAmount=bed.rent_amount,
        status="occupied" if active_tenant else "vacant",
        currentTenant=BedTenantRef(id=active_tenant.id, name=active_tenant.name) if active_tenant else None,
        rentState=rent_state,
        daysLate=days_late,
        outstanding=outstanding,
    )


def serialize_lead(lead: Lead) -> LeadOut:
    return LeadOut(
        id=lead.id,
        name=lead.name,
        phone=lead.phone,
        source=lead.source,
        status=lead.status,
        followUpDate=lead.follow_up_date,
        notes=lead.notes,
        createdAt=lead.created_at,
    )


def serialize_tenant(tenant: Tenant) -> TenantOut:
    notice = tenant.notice
    period = clock.current_period()
    upcoming = sorted((r for r in tenant.renewals if r.effective_period > period), key=lambda r: (r.effective_period, r.id))
    return TenantOut(
        id=tenant.id,
        name=tenant.name,
        phone=tenant.phone,
        bedId=tenant.bed_id,
        roomNumber=tenant.bed.room_number,
        bedLabel=tenant.bed.bed_label,
        moveInDate=tenant.move_in_date,
        moveOutDate=tenant.move_out_date,
        rentDueDay=tenant.rent_due_day,
        rentAmount=rent_for_period(tenant, period),
        upcomingRent=upcoming[-1].new_rent if upcoming else None,
        upcomingRentFrom=upcoming[-1].effective_period if upcoming else None,
        depositAmount=tenant.deposit_amount,
        agreementExpiry=tenant.agreement_expiry,
        documents=[
            TenantDocumentOut(
                id=d.id,
                docType=d.doc_type,
                label=d.label,
                fileName=d.file_name,
                uploadedAt=d.uploaded_at,
            )
            for d in tenant.documents
        ],
        isActive=tenant.is_active,
        notice=TenantNoticeRef(id=notice.id, plannedMoveOutDate=notice.planned_move_out_date, status=notice.status)
        if notice
        else None,
        renewals=[
            RenewalOut(
                id=r.id,
                renewedAt=r.renewed_at,
                previousExpiry=r.previous_expiry,
                newExpiry=r.new_expiry,
                previousRent=r.previous_rent,
                newRent=r.new_rent,
                effectivePeriod=r.effective_period,
            )
            for r in reversed(tenant.renewals)
        ],
    )


def payment_status(payment: Payment, today: datetime.date) -> str:
    if payment.amount_paid >= payment.amount_due:
        return "paid"
    if payment.due_date < today:
        return "overdue"
    return "due"


def serialize_payment(payment: Payment, today: datetime.date) -> RentRecordOut:
    return RentRecordOut(
        id=payment.id,
        tenantId=payment.tenant_id,
        tenantName=payment.tenant.name,
        roomNumber=payment.tenant.bed.room_number,
        bedLabel=payment.tenant.bed.bed_label,
        periodMonth=payment.period_month,
        dueDate=payment.due_date,
        amountDue=payment.amount_due,
        amountPaid=payment.amount_paid,
        paidDate=payment.paid_date,
        status=payment_status(payment, today),
    )


def serialize_transaction(tx: PaymentTransaction) -> PaymentTransactionOut:
    tenant = tx.payment.tenant
    return PaymentTransactionOut(
        id=tx.id,
        paymentId=tx.payment_id,
        tenantId=tenant.id,
        tenantName=tenant.name,
        roomNumber=tenant.bed.room_number,
        bedLabel=tenant.bed.bed_label,
        periodMonth=tx.payment.period_month,
        amount=tx.amount,
        paidDate=tx.paid_date,
        method=tx.method,
        note=tx.note,
    )


def serialize_complaint(complaint: Complaint) -> ComplaintOut:
    return ComplaintOut(
        id=complaint.id,
        title=complaint.title,
        description=complaint.description,
        category=complaint.category,
        priority=complaint.priority,
        status=complaint.status,
        roomNumber=complaint.room_number,
        tenant=BedTenantRef(id=complaint.tenant.id, name=complaint.tenant.name) if complaint.tenant else None,
        assignedTo=StaffRef(id=complaint.assigned_to.id, name=complaint.assigned_to.name)
        if complaint.assigned_to
        else None,
        createdAt=complaint.created_at,
        resolvedAt=complaint.resolved_at,
    )


def notice_unpaid_rent(notice: MoveOutNotice) -> float:
    # At move-out, every generated month is owed, whether or not its due date has passed.
    return sum(outstanding_amount(p) for p in notice.tenant.payments)


def notice_expected_refund(notice: MoveOutNotice) -> float:
    deductions = sum(d.amount for d in notice.deductions)
    return max(notice.tenant.deposit_amount - notice_unpaid_rent(notice) - deductions, 0)


def serialize_notice(notice: MoveOutNotice) -> MoveOutNoticeOut:
    tenant = notice.tenant
    return MoveOutNoticeOut(
        id=notice.id,
        tenantId=tenant.id,
        tenantName=tenant.name,
        roomNumber=tenant.bed.room_number,
        bedLabel=tenant.bed.bed_label,
        noticeDate=notice.notice_date,
        plannedMoveOutDate=notice.planned_move_out_date,
        inspectionDate=notice.inspection_date,
        status=notice.status,
        depositHeld=tenant.deposit_amount,
        unpaidRent=notice_unpaid_rent(notice),
        deductions=[DeductionOut(id=d.id, label=d.label, amount=d.amount) for d in notice.deductions],
        expectedRefund=notice_expected_refund(notice),
        refundAmount=notice.refund_amount,
        refundPaidDate=notice.refund_paid_date,
    )
