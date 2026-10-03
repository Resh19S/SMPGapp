import datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

import clock
from database import Base

# Invariants that must hold even when two requests race each other are
# enforced by the database (unique constraints / partial unique indexes),
# not by "check then insert" in Python — the same way a ticketing system
# stops two buyers getting one seat. Routers still check first so users get
# a friendly message, and treat an IntegrityError as the race they lost.


class StaffUser(Base):
    __tablename__ = "staff_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="staff")  # owner | staff
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Bumped on password change/reset or deactivation; tokens carry the value
    # they were issued with, so bumping it signs the user out everywhere.
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=clock.utcnow)


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str] = mapped_column(String(255), default="")

    beds: Mapped[list["Bed"]] = relationship(back_populates="property", cascade="all, delete-orphan")


class Bed(Base):
    __tablename__ = "beds"
    __table_args__ = (UniqueConstraint("property_id", "room_number", "bed_label", name="uq_bed_label"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id"))
    room_number: Mapped[str] = mapped_column(String(20))
    bed_label: Mapped[str] = mapped_column(String(20))
    floor: Mapped[int] = mapped_column(Integer, default=0)
    # Listed rent for the NEXT resident. A current resident's rent lives on
    # Tenant.rent_amount (+ renewals), so editing this never re-prices them.
    rent_amount: Mapped[float] = mapped_column(Float)

    property: Mapped["Property"] = relationship(back_populates="beds")
    tenants: Mapped[list["Tenant"]] = relationship(back_populates="bed")


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(String(20), default="other")
    status: Mapped[str] = mapped_column(String(20), default="new")  # new|visited|booked|lost
    follow_up_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=clock.utcnow)


class Tenant(Base):
    __tablename__ = "tenants"
    __table_args__ = (
        # One current resident per bed — the "no double-booked seat" rule.
        Index(
            "uq_one_active_tenant_per_bed",
            "bed_id",
            unique=True,
            sqlite_where=text("move_out_date IS NULL"),
            postgresql_where=text("move_out_date IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(20))
    bed_id: Mapped[int] = mapped_column(ForeignKey("beds.id"))
    move_in_date: Mapped[datetime.date] = mapped_column(Date)
    move_out_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    rent_due_day: Mapped[int] = mapped_column(Integer, default=1)
    rent_amount: Mapped[float] = mapped_column(Float)  # rent agreed at move-in
    deposit_amount: Mapped[float] = mapped_column(Float, default=0)
    agreement_expiry: Mapped[datetime.date] = mapped_column(Date)

    bed: Mapped["Bed"] = relationship(back_populates="tenants")
    documents: Mapped[list["TenantDocument"]] = relationship(
        back_populates="tenant", cascade="all, delete-orphan"
    )
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="tenant", cascade="all, delete-orphan"
    )
    notice: Mapped["MoveOutNotice | None"] = relationship(
        back_populates="tenant", cascade="all, delete-orphan", uselist=False
    )
    renewals: Mapped[list["AgreementRenewal"]] = relationship(
        back_populates="tenant", cascade="all, delete-orphan", order_by="AgreementRenewal.id"
    )

    @property
    def is_active(self) -> bool:
        return self.move_out_date is None


class AgreementRenewal(Base):
    """One renewal of a resident's agreement: new end date, and the rent that
    applies from `effective_period` onwards. Rent for any month is the latest
    renewal effective on or before it, else Tenant.rent_amount."""

    __tablename__ = "agreement_renewals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    previous_expiry: Mapped[datetime.date] = mapped_column(Date)
    new_expiry: Mapped[datetime.date] = mapped_column(Date)
    previous_rent: Mapped[float] = mapped_column(Float)
    new_rent: Mapped[float] = mapped_column(Float)
    effective_period: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    renewed_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=clock.utcnow)
    renewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("staff_users.id"), nullable=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="renewals")


class TenantDocument(Base):
    __tablename__ = "tenant_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    doc_type: Mapped[str] = mapped_column(String(20))  # id-proof|agreement|photo|other
    label: Mapped[str] = mapped_column(String(120))
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    uploaded_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="documents")


class Payment(Base):
    __tablename__ = "payments"
    # Generated lazily on reads; two concurrent reads must not both create a month.
    __table_args__ = (UniqueConstraint("tenant_id", "period_month", name="uq_payment_tenant_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    period_month: Mapped[str] = mapped_column(String(7), index=True)  # YYYY-MM
    due_date: Mapped[datetime.date] = mapped_column(Date)
    amount_due: Mapped[float] = mapped_column(Float)
    amount_paid: Mapped[float] = mapped_column(Float, default=0)
    paid_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="payments")
    transactions: Mapped[list["PaymentTransaction"]] = relationship(
        back_populates="payment", cascade="all, delete-orphan", order_by="PaymentTransaction.paid_date"
    )


class PaymentTransaction(Base):
    """One actual receipt of money against a monthly Payment. Payment.amount_paid
    is the running sum of these, so partial payments accumulate instead of
    overwriting each other."""

    __tablename__ = "payment_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payment_id: Mapped[int] = mapped_column(ForeignKey("payments.id"), index=True)
    amount: Mapped[float] = mapped_column(Float)
    paid_date: Mapped[datetime.date] = mapped_column(Date, index=True)
    method: Mapped[str] = mapped_column(String(20), default="cash")  # cash|upi|bank|other|deposit
    note: Mapped[str] = mapped_column(String(255), default="")
    # Idempotency key from the client: a retried/double-clicked submit carries
    # the same key and is answered from the first attempt instead of paying twice.
    client_ref: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    recorded_by_id: Mapped[int | None] = mapped_column(ForeignKey("staff_users.id"), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=clock.utcnow)

    payment: Mapped["Payment"] = relationship(back_populates="transactions")


class Expense(Base):
    """Money going out, for the monthly profit & loss."""

    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id"), index=True)
    spent_on: Mapped[datetime.date] = mapped_column(Date, index=True)
    category: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(String(255), default="")
    paid_to: Mapped[str] = mapped_column(String(120), default="")
    amount: Mapped[float] = mapped_column(Float)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("staff_users.id"), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=clock.utcnow)


class Complaint(Base):
    __tablename__ = "complaints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(String(1000), default="")
    category: Mapped[str] = mapped_column(String(20), default="other")  # plumbing|electrical|cleaning|internet|furniture|other
    priority: Mapped[str] = mapped_column(String(10), default="normal")  # normal|urgent
    status: Mapped[str] = mapped_column(String(20), default="open")  # open|in-progress|resolved
    room_number: Mapped[str] = mapped_column(String(20), default="")
    tenant_id: Mapped[int | None] = mapped_column(ForeignKey("tenants.id"), nullable=True)
    assigned_to_id: Mapped[int | None] = mapped_column(ForeignKey("staff_users.id"), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=clock.utcnow)
    resolved_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)

    tenant: Mapped["Tenant | None"] = relationship()
    assigned_to: Mapped["StaffUser | None"] = relationship()


class MoveOutNotice(Base):
    """Move-out is a process, not a single click: notice -> inspection ->
    deductions -> settled. Tenant.move_out_date is only set on settlement, so
    the bed stays occupied (and rent keeps accruing) until the resident leaves."""

    __tablename__ = "move_out_notices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), unique=True)
    notice_date: Mapped[datetime.date] = mapped_column(Date)
    planned_move_out_date: Mapped[datetime.date] = mapped_column(Date)
    inspection_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="notice")  # notice|inspection-scheduled|settled
    refund_paid_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    refund_amount: Mapped[float | None] = mapped_column(Float, nullable=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="notice")
    deductions: Mapped[list["SettlementDeduction"]] = relationship(
        back_populates="notice", cascade="all, delete-orphan"
    )


class SettlementDeduction(Base):
    __tablename__ = "settlement_deductions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    notice_id: Mapped[int] = mapped_column(ForeignKey("move_out_notices.id"))
    label: Mapped[str] = mapped_column(String(160))
    amount: Mapped[float] = mapped_column(Float)

    notice: Mapped["MoveOutNotice"] = relationship(back_populates="deductions")


class AuditEvent(Base):
    """Append-only record of who did what with money and residents. Never
    updated or deleted by the app — it's the answer to "who marked this paid?"."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime.datetime] = mapped_column(DateTime, default=clock.utcnow, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("staff_users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(40))  # e.g. payment.recorded, moveout.settled
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detail: Mapped[str] = mapped_column(String(500), default="")
