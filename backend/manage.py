"""Production setup commands. On a live server, use this instead of seed.py
(which loads demo data and must never run against real data).

    .venv/bin/python manage.py create-owner --name "Sakshi Mishra" --username sakshi
    .venv/bin/python manage.py create-property --name "Sunrise PG" --address "14 MG Road, Pune"
    .venv/bin/python manage.py init      # server start: tables + owner from env, never demo data

Passwords are typed at a hidden prompt, never passed on the command line
(where they'd end up in shell history).
"""

import argparse
import getpass
import os
import sys

from auth import hash_password
from database import Base, SessionLocal, engine
from models.db_models import Property, StaffUser
from models.schemas import CreatePropertyRequest, CreateStaffRequest


class SetupError(Exception):
    pass


def create_owner(name: str, username: str, password: str) -> StaffUser:
    """First owner account. Refuses if an owner already exists — further
    accounts are created from the Staff Access page."""
    data = CreateStaffRequest(name=name, username=username, password=password, role="owner")
    if len(password) < 8:
        raise SetupError("Password must be at least 8 characters")
    with SessionLocal() as db:
        if db.query(StaffUser).filter(StaffUser.role == "owner").first():
            raise SetupError("An owner account already exists — add more people from Staff Access in the app")
        if db.query(StaffUser).filter(StaffUser.username == data.username).first():
            raise SetupError(f"Username '{data.username}' is taken")
        user = StaffUser(name=data.name, username=data.username, password_hash=hash_password(password), role="owner")
        db.add(user)
        db.commit()
        db.refresh(user)
        return user


def create_property(name: str, address: str) -> Property:
    data = CreatePropertyRequest(name=name, address=address)
    with SessionLocal() as db:
        prop = Property(name=data.name, address=data.address)
        db.add(prop)
        db.commit()
        db.refresh(prop)
        return prop


def init_from_env() -> str:
    """Idempotent server start-up for real use (Render's start command).

    Creates missing tables; creates the first owner from OWNER_USERNAME /
    OWNER_PASSWORD / OWNER_NAME if no owner exists yet; creates the property
    from PROPERTY_NAME / PROPERTY_ADDRESS if none exists and a name is given.
    Never touches existing data and never adds demo data."""
    Base.metadata.create_all(bind=engine)
    notes = []
    with SessionLocal() as db:
        has_owner = db.query(StaffUser).filter(StaffUser.role == "owner").first() is not None
        has_property = db.query(Property).first() is not None
    if not has_owner:
        password = os.getenv("OWNER_PASSWORD")
        if not password:
            raise SetupError("No owner account yet: set OWNER_PASSWORD (8+ characters) on the server")
        user = create_owner(os.getenv("OWNER_NAME", "Owner"), os.getenv("OWNER_USERNAME", "owner"), password)
        notes.append(f"created owner '{user.username}'")
    if not has_property and os.getenv("PROPERTY_NAME"):
        prop = create_property(os.environ["PROPERTY_NAME"], os.getenv("PROPERTY_ADDRESS", ""))
        notes.append(f"created property '{prop.name}'")
    return "; ".join(notes) or "already set up — nothing changed"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sunrise PG setup")
    sub = parser.add_subparsers(dest="command", required=True)
    owner = sub.add_parser("create-owner", help="create the first owner login")
    owner.add_argument("--name", required=True)
    owner.add_argument("--username", required=True)
    prop = sub.add_parser("create-property", help="add the building")
    prop.add_argument("--name", required=True)
    prop.add_argument("--address", default="")
    sub.add_parser("init", help="server start-up: tables + first owner from env (no demo data)")
    args = parser.parse_args(argv)

    Base.metadata.create_all(bind=engine)  # no-op on an existing schema
    try:
        if args.command == "create-owner":
            password = getpass.getpass("New owner password (min 8 chars): ")
            if password != getpass.getpass("Repeat password: "):
                raise SetupError("Passwords don't match")
            user = create_owner(args.name, args.username, password)
            print(f"Owner '{user.username}' created. Sign in at the app's login page.")
        elif args.command == "init":
            print(f"Setup: {init_from_env()}")
        elif args.command == "create-property":
            p = create_property(args.name, args.address)
            print(f"Property '{p.name}' created (id {p.id}). Add rooms from Rooms & Beds → Add rooms.")
    except SetupError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
