from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user, hash_password, require_owner
from database import get_db
from models.db_models import StaffUser
from models.schemas import CreateStaffRequest, StaffRef, StaffUserOut

router = APIRouter(prefix="/staff", tags=["staff"])


@router.get("", response_model=list[StaffUserOut])
def list_staff(db: Session = Depends(get_db), _owner: StaffUser = Depends(require_owner)):
    users = db.query(StaffUser).order_by(StaffUser.created_at).all()
    return [StaffUserOut.model_validate(u, from_attributes=True) for u in users]


@router.get("/directory", response_model=list[StaffRef])
def staff_directory(db: Session = Depends(get_db), _user: StaffUser = Depends(get_current_user)):
    """Names of active staff, for assigning complaints. Available to every
    logged-in user; the full account list above stays owner-only."""
    users = db.query(StaffUser).filter(StaffUser.is_active.is_(True)).order_by(StaffUser.name).all()
    return [StaffRef(id=u.id, name=u.name) for u in users]


@router.post("", response_model=StaffUserOut, status_code=201)
def create_staff(
    request: CreateStaffRequest,
    db: Session = Depends(get_db),
    _owner: StaffUser = Depends(require_owner),
):
    if db.query(StaffUser).filter(StaffUser.username == request.username).first():
        raise HTTPException(status_code=409, detail="Username already exists")
    user = StaffUser(
        name=request.name,
        username=request.username,
        password_hash=hash_password(request.password),
        role=request.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return StaffUserOut.model_validate(user, from_attributes=True)


@router.patch("/{staff_id}/deactivate", response_model=StaffUserOut)
def deactivate_staff(
    staff_id: int,
    db: Session = Depends(get_db),
    owner: StaffUser = Depends(require_owner),
):
    user = db.get(StaffUser, staff_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Staff user not found")
    if user.id == owner.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    user.is_active = False
    db.commit()
    db.refresh(user)
    return StaffUserOut.model_validate(user, from_attributes=True)
