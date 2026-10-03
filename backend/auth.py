import datetime
import os

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from database import get_db
from models.db_models import StaffUser

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-do-not-use-in-real-deployment")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))

_bearer = HTTPBearer()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(user: StaffUser) -> str:
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "tv": user.token_version,
        "exp": datetime.datetime.now(datetime.UTC) + datetime.timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> StaffUser:
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user = db.get(StaffUser, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or deactivated")
    if payload.get("tv", 0) != user.token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session ended — please sign in again")
    return user


def require_owner(user: StaffUser = Depends(get_current_user)) -> StaffUser:
    if user.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner access required")
    return user
