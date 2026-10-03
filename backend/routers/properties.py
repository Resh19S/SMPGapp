from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import clock

from auth import get_current_user
from database import get_db
from models.db_models import Bed, Property, StaffUser
from models.schemas import (
    BedOut,
    CreateBedRequest,
    CreatePropertyRequest,
    PropertyOut,
    UpdateBedRequest,
)
from routers.payments import ensure_payments_up_to_date
from serializers import serialize_bed

router = APIRouter(tags=["properties"])


def floor_from_room(room_number: str) -> int:
    """'203' -> 2, '1204' -> 12, 'G1' -> 0. Used when a bed is added without an explicit floor."""
    digits = room_number.strip()
    return int(digits[:-2]) if digits.isdigit() and len(digits) >= 3 else 0


@router.get("/properties", response_model=list[PropertyOut])
def list_properties(db: Session = Depends(get_db), _user: StaffUser = Depends(get_current_user)):
    return db.query(Property).order_by(Property.id).all()


@router.post("/properties", response_model=PropertyOut, status_code=201)
def create_property(
    request: CreatePropertyRequest,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    prop = Property(name=request.name, address=request.address)
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return prop


@router.get("/beds", response_model=list[BedOut])
def list_beds(
    propertyId: int | None = None,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    today = clock.today()
    ensure_payments_up_to_date(db, today)
    query = db.query(Bed)
    if propertyId is not None:
        query = query.filter(Bed.property_id == propertyId)
    beds = query.order_by(Bed.floor, Bed.room_number, Bed.bed_label).all()
    return [serialize_bed(b, today) for b in beds]


@router.post("/beds", response_model=BedOut, status_code=201)
def create_bed(
    request: CreateBedRequest,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    if db.get(Property, request.propertyId) is None:
        raise HTTPException(status_code=404, detail="Property not found")
    bed = Bed(
        property_id=request.propertyId,
        floor=request.floor if request.floor is not None else floor_from_room(request.roomNumber),
        room_number=request.roomNumber,
        bed_label=request.bedLabel,
        rent_amount=request.rentAmount,
    )
    db.add(bed)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Room {request.roomNumber} already has a bed {request.bedLabel}")
    db.refresh(bed)
    return serialize_bed(bed, clock.today())


@router.patch("/beds/{bed_id}", response_model=BedOut)
def update_bed(
    bed_id: int,
    request: UpdateBedRequest,
    db: Session = Depends(get_db),
    _user: StaffUser = Depends(get_current_user),
):
    bed = db.get(Bed, bed_id)
    if bed is None:
        raise HTTPException(status_code=404, detail="Bed not found")
    if request.roomNumber is not None:
        bed.room_number = request.roomNumber
    if request.bedLabel is not None:
        bed.bed_label = request.bedLabel
    if request.rentAmount is not None:
        bed.rent_amount = request.rentAmount
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Another bed in that room already has this label")
    db.refresh(bed)
    return serialize_bed(bed, clock.today())
