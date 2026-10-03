from sqlalchemy.orm import Session

from models.db_models import AuditEvent, StaffUser


def record(db: Session, user: StaffUser | None, action: str, entity: str, entity_id: int | None, detail: str = "") -> None:
    """Add an audit row to the current transaction — it commits (or rolls
    back) together with the change it describes."""
    db.add(AuditEvent(user_id=user.id if user else None, action=action, entity=entity, entity_id=entity_id, detail=detail[:500]))
