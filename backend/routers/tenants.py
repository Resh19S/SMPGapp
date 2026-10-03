from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import audit
import clock
from auth import get_current_user
from database import get_db
from models.db_models import AgreementRenewal, Bed, MoveOutNotice, Payment, StaffUser, Tenant, TenantDocument
from models.schemas import (
    CreateTenantRequest,
    GiveNoticeRequest,
    RenewAgreementRequest,
    TenantOut,
    UploadDocumentRequest,
)
from serializers import rent_for_period, serialize_tenant

router = APIRouter(prefix="/tenants", tags=["tenants"])

DEFAULT_DOCUMENTS = [
    ("id-proof", "ID Proof"),
    ("agreement", "Rental Agreement"),
]


def _get_tenant(db: Session, tenant_id: int) -> Tenant:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


@router.get("", response_model=list[TenantOut])
def list_tenants(
    includeMovedOut: bool = False,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    query = db.query(Tenant)
    if not includeMovedOut:
        query = query.filter(Tenant.move_out_date.is_(None))
    tenants = query.order_by(Tenant.move_in_date.desc()).all()
    return [serialize_tenant(t) for t in tenants]


@router.get("/{tenant_id}", response_model=TenantOut)
def get_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    return serialize_tenant(_get_tenant(db, tenant_id))


@router.post("", response_model=TenantOut, status_code=201)
def create_tenant(
    request: CreateTenantRequest,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    bed = db.get(Bed, request.bedId)
    if bed is None:
        raise HTTPException(status_code=404, detail="Bed not found")
    if any(t.is_active for t in bed.tenants):
        raise HTTPException(status_code=409, detail="Bed is already occupied")

    tenant = Tenant(
        name=request.name,
        phone=request.phone,
        bed_id=request.bedId,
        move_in_date=request.moveInDate,
        rent_due_day=request.rentDueDay,
        rent_amount=request.rentAmount if request.rentAmount is not None else bed.rent_amount,
        deposit_amount=request.depositAmount,
        agreement_expiry=request.agreementExpiry,
    )
    db.add(tenant)
    try:
        db.flush()
    except IntegrityError:
        # Someone else moved a resident into this bed between our check and our insert.
        db.rollback()
        raise HTTPException(status_code=409, detail="Bed is already occupied")

    for doc_type, label in DEFAULT_DOCUMENTS:
        db.add(TenantDocument(tenant_id=tenant.id, doc_type=doc_type, label=label))
    audit.record(db, user, "tenant.moved_in", "tenant", tenant.id, f"bed {bed.room_number}/{bed.bed_label}")

    db.commit()
    db.refresh(tenant)
    return serialize_tenant(tenant)


@router.post("/{tenant_id}/notice", response_model=TenantOut, status_code=201)
def give_notice(
    tenant_id: int,
    request: GiveNoticeRequest,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    """Start the move-out process. The tenant stays active (bed occupied, rent
    accruing) until the notice is settled from Operations."""
    tenant = _get_tenant(db, tenant_id)
    if not tenant.is_active:
        raise HTTPException(status_code=400, detail="Tenant has already moved out")
    if tenant.notice is not None:
        raise HTTPException(status_code=409, detail="This tenant has already given notice")
    if request.noticeDate > clock.today():
        raise HTTPException(status_code=400, detail="Notice date can't be in the future")
    if request.plannedMoveOutDate < tenant.move_in_date:
        raise HTTPException(status_code=400, detail="Move-out date cannot precede move-in date")
    if request.plannedMoveOutDate < request.noticeDate:
        raise HTTPException(status_code=400, detail="Move-out date cannot precede the notice date")
    db.add(
        MoveOutNotice(
            tenant_id=tenant.id,
            notice_date=request.noticeDate,
            planned_move_out_date=request.plannedMoveOutDate,
        )
    )
    audit.record(db, user, "tenant.notice", "tenant", tenant.id, f"leaving {request.plannedMoveOutDate}")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This tenant has already given notice")
    db.refresh(tenant)
    return serialize_tenant(tenant)


@router.post("/{tenant_id}/renewals", response_model=TenantOut, status_code=201)
def renew_agreement(
    tenant_id: int,
    request: RenewAgreementRequest,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    """Extend a resident's agreement and (optionally) change their rent from a
    given month. Months already billed at the old rent are re-priced only if
    nothing has been paid against them yet."""
    tenant = _get_tenant(db, tenant_id)
    if not tenant.is_active:
        raise HTTPException(status_code=400, detail="Tenant has already moved out")
    if tenant.notice is not None and tenant.notice.status != "settled":
        raise HTTPException(status_code=409, detail="This tenant has given notice — cancel the move-out before renewing")
    old_expiry = tenant.agreement_expiry
    if request.newExpiry <= old_expiry:
        raise HTTPException(status_code=400, detail="New end date must be after the current agreement end")
    if request.effectiveFrom < clock.current_period():
        raise HTTPException(status_code=400, detail="New rent can't start in a past month")
    if request.effectiveFrom > request.newExpiry.strftime("%Y-%m"):
        raise HTTPException(status_code=400, detail="New rent must start before the renewed agreement ends")

    # Optimistic concurrency: only apply if nobody renewed this agreement since we read it.
    result = db.execute(
        update(Tenant)
        .where(Tenant.id == tenant.id, Tenant.agreement_expiry == old_expiry)
        .values(agreement_expiry=request.newExpiry)
    )
    if result.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=409, detail="This agreement was just changed by someone else — refresh and try again")

    previous_rent = rent_for_period(tenant, request.effectiveFrom)
    db.add(
        AgreementRenewal(
            tenant_id=tenant.id,
            previous_expiry=old_expiry,
            new_expiry=request.newExpiry,
            previous_rent=previous_rent,
            new_rent=request.newRent,
            effective_period=request.effectiveFrom,
            renewed_by_id=user.id,
        )
    )
    db.execute(
        update(Payment)
        .where(
            Payment.tenant_id == tenant.id,
            Payment.period_month >= request.effectiveFrom,
            Payment.amount_paid == 0,
        )
        .values(amount_due=request.newRent)
    )
    db.add(
        TenantDocument(
            tenant_id=tenant.id,
            doc_type="agreement",
            label=f"Renewal agreement (to {request.newExpiry.strftime('%d/%m/%Y')})",
        )
    )
    audit.record(
        db,
        user,
        "tenant.renewed",
        "tenant",
        tenant.id,
        f"to {request.newExpiry}; rent ₹{previous_rent:,.0f} → ₹{request.newRent:,.0f} from {request.effectiveFrom}",
    )
    db.commit()
    db.refresh(tenant)
    return serialize_tenant(tenant)


@router.post("/{tenant_id}/documents/{document_id}/upload", response_model=TenantOut)
def upload_document(
    tenant_id: int,
    document_id: int,
    request: UploadDocumentRequest,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    tenant = _get_tenant(db, tenant_id)
    doc = db.get(TenantDocument, document_id)
    if doc is None or doc.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.file_name = request.fileName
    doc.uploaded_at = clock.utcnow()
    db.commit()
    db.refresh(tenant)
    return serialize_tenant(tenant)
