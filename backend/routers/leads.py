from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import audit
from auth import get_current_user
from database import get_db
from models.db_models import Lead, StaffUser
from models.schemas import CreateLeadRequest, LeadOut, UpdateLeadRequest
from serializers import serialize_lead

router = APIRouter(prefix="/leads", tags=["leads"])


@router.get("", response_model=list[LeadOut])
def list_leads(
    includeArchived: bool = False,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    query = db.query(Lead)
    if not includeArchived:
        query = query.filter(Lead.status != "lost")
    leads = query.order_by(Lead.created_at.desc()).all()
    return [serialize_lead(l) for l in leads]


@router.post("", response_model=LeadOut, status_code=201)
def create_lead(
    request: CreateLeadRequest,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    lead = Lead(
        name=request.name,
        phone=request.phone,
        source=request.source,
        follow_up_date=request.followUpDate,
        notes=request.notes,
        status="new",
    )
    db.add(lead)
    db.flush()
    audit.record(db, user, "lead.created", "lead", lead.id, f"{lead.name} via {lead.source}")
    db.commit()
    db.refresh(lead)
    return serialize_lead(lead)


@router.patch("/{lead_id}", response_model=LeadOut)
def update_lead(
    lead_id: int,
    request: UpdateLeadRequest,
    db: Session = Depends(get_db),
    user: StaffUser = Depends(get_current_user),
):
    lead = db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    data = request.model_dump(exclude_unset=True)
    if "status" in data and data["status"] != lead.status:
        audit.record(db, user, "lead.status", "lead", lead.id, f"{lead.name}: {lead.status} → {data['status']}")
    elif data:
        audit.record(db, user, "lead.updated", "lead", lead.id, f"{lead.name}: {', '.join(sorted(data))}")
    if "name" in data:
        lead.name = data["name"]
    if "phone" in data:
        lead.phone = data["phone"]
    if "source" in data:
        lead.source = data["source"]
    if "status" in data:
        lead.status = data["status"]
    if "followUpDate" in data:
        lead.follow_up_date = data["followUpDate"]
    if "notes" in data:
        lead.notes = data["notes"]
    db.commit()
    db.refresh(lead)
    return serialize_lead(lead)
