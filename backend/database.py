import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./pg_rental.db")
# Hosted Postgres (Neon, Render, Supabase) hands out postgres:// or
# postgresql:// URLs; SQLAlchemy needs the driver named (psycopg 3).
for _prefix in ("postgres://", "postgresql://"):
    if DATABASE_URL.startswith(_prefix):
        DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len(_prefix):]

connect_args = {"check_same_thread": False, "timeout": 15} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

if engine.dialect.name == "sqlite":

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")  # SQLite ignores FKs unless asked
        cursor.execute("PRAGMA journal_mode=WAL")  # readers don't block the writer
        cursor.close()


class Base(DeclarativeBase):
    pass


def insert_ignoring_conflicts(table, conflict_columns: list[str]):
    """INSERT ... ON CONFLICT DO NOTHING for the running database (SQLite in
    dev, PostgreSQL in production) — both dialects share this API."""
    if engine.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    return insert(table).on_conflict_do_nothing(index_elements=conflict_columns)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
