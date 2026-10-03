import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from auth import create_access_token, get_current_user, verify_password
from database import get_db
from models.db_models import StaffUser
from models.schemas import LoginRequest, LoginResponse, StaffUserOut

router = APIRouter(prefix="/auth", tags=["auth"])

# Brute-force brake: 5 wrong passwords in 15 minutes locks that username (and,
# separately, that client address) until the window passes. In-process memory
# is enough for one server; with several app servers this moves to Redis.
MAX_FAILURES = 5
WINDOW_SECONDS = 15 * 60
_failures: dict[str, deque[float]] = defaultdict(deque)


def _recent_failures(key: str, now: float) -> deque[float]:
    attempts = _failures[key]
    while attempts and now - attempts[0] > WINDOW_SECONDS:
        attempts.popleft()
    return attempts


def reset_login_throttle() -> None:
    _failures.clear()


@router.post("/login", response_model=LoginResponse)
def login(request: LoginRequest, http: Request, db: Session = Depends(get_db)):
    now = time.monotonic()
    keys = [f"user:{request.username.lower()}", f"ip:{http.client.host if http.client else 'unknown'}"]
    if any(len(_recent_failures(k, now)) >= MAX_FAILURES for k in keys):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")

    user = db.query(StaffUser).filter(StaffUser.username == request.username.lower()).first()
    if user is None or not user.is_active or not verify_password(request.password, user.password_hash):
        for k in keys:
            _failures[k].append(now)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    _failures.pop(keys[0], None)
    token = create_access_token(user)
    return LoginResponse(token=token, user=StaffUserOut.model_validate(user, from_attributes=True))


@router.get("/me", response_model=StaffUserOut)
def me(current_user: StaffUser = Depends(get_current_user)):
    return StaffUserOut.model_validate(current_user, from_attributes=True)
