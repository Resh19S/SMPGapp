"""Owner-only view of the audit log: who did what, when."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from auth import require_owner
from database import get_db
from models.db_models import AuditEvent, StaffUser
from models.schemas import ActivityEntry

router = APIRouter(tags=["activity"])

# action prefix → area shown in the UI filter
AREAS = {
    "auth": "auth",
    "payment": "payment",
    "tenant": "tenant",
    "tenants": "tenant",
    "document": "tenant",
    "lead": "lead",
    "bed": "bed",
    "beds": "bed",
    "property": "bed",
    "complaint": "complaint",
    "moveout": "moveout",
    "expense": "expense",
    "staff": "staff",
}


def area_of(action: str) -> str:
    return AREAS.get(action.split(".", 1)[0], "other")


@router.get("/activity", response_model=list[ActivityEntry])
def list_activity(
    area: Annotated[
        Literal["auth", "payment", "tenant", "lead", "bed", "complaint", "moveout", "expense", "staff"] | None, Query()
    ] = None,
    userId: int | None = None,
    beforeId: int | None = None,  # pagination: entries older than this id
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: Session = Depends(get_db),
    _owner: StaffUser = Depends(require_owner),
):
    query = db.query(AuditEvent)
    if area is not None:
        prefixes = [p for p, a in AREAS.items() if a == area]
        query = query.filter(or_(*[AuditEvent.action.like(f"{p}.%") for p in prefixes]))
    if userId is not None:
        query = query.filter(AuditEvent.user_id == userId)
    if beforeId is not None:
        # Page by time (ties broken by id), so history reads newest → oldest.
        anchor = db.get(AuditEvent, beforeId)
        if anchor is not None:
            query = query.filter(
                or_(AuditEvent.at < anchor.at, and_(AuditEvent.at == anchor.at, AuditEvent.id < anchor.id))
            )
    events = query.order_by(AuditEvent.at.desc(), AuditEvent.id.desc()).limit(limit).all()
    names = {u.id: u.name for u in db.query(StaffUser).all()}
    return [
        ActivityEntry(
            id=e.id,
            at=e.at,
            userName=names.get(e.user_id) if e.user_id else None,
            action=e.action,
            area=area_of(e.action),
            detail=e.detail,
        )
        for e in events
    ]
