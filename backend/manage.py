"""Production setup commands. On a live server, use this instead of seed.py
(which loads demo data and must never run against real data).

    .venv/bin/python manage.py create-owner --name "Sakshi Mishra" --username sakshi
    .venv/bin/python manage.py create-property --name "Sunrise PG" --address "14 MG Road, Pune"

Passwords are typed at a hidden prompt, never passed on the command line
(where they'd end up in shell history).
"""

import argparse
import getpass
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sunrise PG setup")
    sub = parser.add_subparsers(dest="command", required=True)
    owner = sub.add_parser("create-owner", help="create the first owner login")
    owner.add_argument("--name", required=True)
    owner.add_argument("--username", required=True)
    prop = sub.add_parser("create-property", help="add the building")
    prop.add_argument("--name", required=True)
    prop.add_argument("--address", default="")
    args = parser.parse_args(argv)

    Base.metadata.create_all(bind=engine)  # no-op on an existing schema
    try:
        if args.command == "create-owner":
            password = getpass.getpass("New owner password (min 8 chars): ")
            if password != getpass.getpass("Repeat password: "):
                raise SetupError("Passwords don't match")
            user = create_owner(args.name, args.username, password)
            print(f"Owner '{user.username}' created. Sign in at the app's login page.")
        elif args.command == "create-property":
            p = create_property(args.name, args.address)
            print(f"Property '{p.name}' created (id {p.id}). Add rooms from Rooms & Beds → Add rooms.")
    except SetupError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
