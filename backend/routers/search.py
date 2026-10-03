from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models.db_models import Bed, Lead, StaffUser, Tenant
from models.schemas import SearchResult

router = APIRouter(tags=["search"])

LIMIT_PER_KIND = 6


@router.get("/search", response_model=list[SearchResult])
def search(
    q: Annotated[str, Query(min_length=1, max_length=60)],
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    """Topbar search: residents (name, phone, room), rooms, and open leads."""
    term = q.strip()
    if not term:
        return []
    like = f"%{term}%"
    results: list[SearchResult] = []

    tenants = (
        db.query(Tenant)
        .join(Bed)
        .filter(Tenant.move_out_date.is_(None))
        .filter(or_(Tenant.name.ilike(like), Tenant.phone.like(like), Bed.room_number.like(f"{term}%")))
        .order_by(Tenant.name)
        .limit(LIMIT_PER_KIND)
        .all()
    )
    for t in tenants:
        results.append(
            SearchResult(
                kind="tenant",
                id=t.id,
                title=t.name,
                subtitle=f"Room {t.bed.room_number}/{t.bed.bed_label} · {t.phone}",
                link=f"/tenants?open={t.id}",
            )
        )

    rooms = sorted({b.room_number for b in db.query(Bed).filter(Bed.room_number.like(f"{term}%")).limit(50)})
    for room in rooms[:LIMIT_PER_KIND]:
        beds = db.query(Bed).filter(Bed.room_number == room).all()
        free = sum(1 for b in beds if not any(t.is_active for t in b.tenants))
        results.append(
            SearchResult(
                kind="room",
                id=beds[0].id,
                title=f"Room {room}",
                subtitle=f"{len(beds)} beds · {free} vacant",
                link=f"/properties?room={room}",
            )
        )

    leads = (
        db.query(Lead)
        .filter(Lead.status != "lost")
        .filter(or_(Lead.name.ilike(like), Lead.phone.like(like)))
        .order_by(Lead.created_at.desc())
        .limit(LIMIT_PER_KIND)
        .all()
    )
    for lead in leads:
        results.append(
            SearchResult(kind="lead", id=lead.id, title=lead.name, subtitle=f"Enquiry · {lead.status} · {lead.phone}", link=f"/leads?highlight={lead.id}")
        )
    return results
