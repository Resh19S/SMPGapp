import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from auth import JWT_SECRET
from database import Base, engine
from routers import auth, dashboard, leads, operations, payments, pnl, properties, search, staff, tenants

logger = logging.getLogger("pg_rental")

APP_ENV = os.getenv("APP_ENV", "development")
DEV_SECRET = "dev-secret-do-not-use-in-real-deployment"

if APP_ENV == "production":
    if JWT_SECRET == DEV_SECRET or len(JWT_SECRET) < 32:
        raise RuntimeError("APP_ENV=production needs a JWT_SECRET of at least 32 random characters.")
elif JWT_SECRET == DEV_SECRET:
    logger.warning(
        "JWT_SECRET is unset — using the insecure development default. "
        "Set a real secret in .env before deploying anywhere reachable off this machine."
    )

# Dev convenience only: production schema changes go through migrations (see docs/ARCHITECTURE.md).
if APP_ENV != "production":
    Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="PG Rental Management API",
    description="Property manager backend: beds, leads, tenants, rent tracking.",
    version="0.2.0",
)

allowed_origins = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)


@app.exception_handler(IntegrityError)
async def integrity_conflict(_request: Request, exc: IntegrityError):
    """Safety net: a uniqueness rule the router didn't pre-check (usually two
    requests racing) becomes a 409 the UI can explain, never a 500."""
    logger.warning("Integrity conflict: %s", exc.orig)
    return JSONResponse(status_code=409, content={"detail": "This clashes with a change someone just made — refresh and try again."})


app.include_router(auth.router)
app.include_router(staff.router)
app.include_router(properties.router)
app.include_router(leads.router)
app.include_router(tenants.router)
app.include_router(payments.router)
app.include_router(operations.router)
app.include_router(pnl.router)
app.include_router(search.router)
app.include_router(dashboard.router)


@app.get("/health")
def health():
    return {"status": "ok"}
