import datetime
import re
from typing import Annotated, Literal, Optional

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field, StringConstraints, model_validator

StaffRole = Literal["owner", "staff"]
BedStatus = Literal["vacant", "occupied"]
LeadSource = Literal["broker", "whatsapp", "google", "walk-in", "other"]
LeadStatus = Literal["new", "visited", "booked", "lost"]
DocumentType = Literal["id-proof", "agreement", "photo", "other"]
PaymentStatus = Literal["paid", "due", "overdue"]
BedRentState = Literal["vacant", "reserved", "paid", "due", "due-today", "late"]
ManualPaymentMethod = Literal["cash", "upi", "bank", "other"]
PaymentMethod = Literal["cash", "upi", "bank", "other", "deposit"]  # "deposit" = recovered at move-out
ComplaintCategory = Literal["plumbing", "electrical", "cleaning", "internet", "furniture", "other"]
ComplaintPriority = Literal["normal", "urgent"]
ComplaintStatus = Literal["open", "in-progress", "resolved"]
NoticeStatus = Literal["notice", "inspection-scheduled", "settled"]
ExpenseCategory = Literal[
    "lease", "electricity", "water", "internet", "salaries", "food", "cleaning", "maintenance", "taxes", "other"
]


# ---- Shared field types: validation lives here so every endpoint gets it ----

def _normalize_phone(value: str) -> str:
    """Accept '98220 11223', '+91-9822011223', '919822011223'; store 9822011223."""
    digits = re.sub(r"[\s\-()]", "", value)
    digits = re.sub(r"^(\+91|91|0)(?=\d{10}$)", "", digits)
    if not re.fullmatch(r"[6-9]\d{9}", digits):
        raise ValueError("Enter a 10-digit Indian mobile number")
    return digits


def _two_decimals(value: float) -> float:
    if round(value, 2) != value:
        raise ValueError("Amounts can have at most 2 decimal places")
    return value


def _sane_date(value: datetime.date) -> datetime.date:
    if not datetime.date(2000, 1, 1) <= value <= datetime.date(2100, 12, 31):
        raise ValueError("Date is out of range")
    return value


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ShortLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
Phone = Annotated[str, AfterValidator(_normalize_phone)]
Money = Annotated[float, Field(gt=0, le=10_00_000), AfterValidator(_two_decimals)]  # ≤ ₹10 lakh per entry
Rent = Annotated[float, Field(gt=0, le=5_00_000), AfterValidator(_two_decimals)]
Deposit = Annotated[float, Field(ge=0, le=10_00_000), AfterValidator(_two_decimals)]
Period = Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]  # YYYY-MM
Day = Annotated[datetime.date, AfterValidator(_sane_date)]


def _reject_explicit_nulls(model: BaseModel, fields: tuple[str, ...]) -> None:
    """PATCH bodies: leaving a field out means "don't change it"; sending it as
    null would try to blank a required column — refuse that up front."""
    for name in fields:
        if name in model.model_fields_set and getattr(model, name) is None:
            raise ValueError(f"{name} can't be empty")


# ---- Auth ----

class LoginRequest(BaseModel):
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    password: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class StaffUserOut(BaseModel):
    id: int
    name: str
    username: str
    role: StaffRole
    isActive: bool = Field(validation_alias="is_active")

    model_config = {"populate_by_name": True}


class LoginResponse(BaseModel):
    token: str
    user: StaffUserOut


class CreateStaffRequest(BaseModel):
    name: Name
    username: Annotated[
        str,
        BeforeValidator(lambda v: v.strip().lower() if isinstance(v, str) else v),
        StringConstraints(pattern=r"^[a-z0-9._-]{3,40}$"),
    ]
    password: Annotated[str, StringConstraints(min_length=6, max_length=200)]
    role: StaffRole = "staff"


# ---- Properties & beds ----

class PropertyOut(BaseModel):
    id: int
    name: str
    address: str


class CreatePropertyRequest(BaseModel):
    name: Name
    address: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] = ""


class BedTenantRef(BaseModel):
    id: int
    name: str


class BedOut(BaseModel):
    id: int
    propertyId: int
    floor: int
    roomNumber: str
    bedLabel: str
    rentAmount: float  # listed rent for the next resident
    status: BedStatus
    currentTenant: Optional[BedTenantRef] = None
    # Money state of the bed right now — what the Rooms & Beds grid colours by.
    rentState: BedRentState
    daysLate: Optional[int] = None
    outstanding: float = 0


class CreateBedRequest(BaseModel):
    propertyId: int
    floor: Optional[Annotated[int, Field(ge=0, le=200)]] = None  # derived from room number (e.g. 203 -> 2) when omitted
    roomNumber: ShortLabel
    bedLabel: ShortLabel
    rentAmount: Rent


class UpdateBedRequest(BaseModel):
    roomNumber: Optional[ShortLabel] = None
    bedLabel: Optional[ShortLabel] = None
    rentAmount: Optional[Rent] = None

    @model_validator(mode="after")
    def _no_nulls(self):
        _reject_explicit_nulls(self, ("roomNumber", "bedLabel", "rentAmount"))
        return self


# ---- Leads ----

class LeadOut(BaseModel):
    id: int
    name: str
    phone: str
    source: LeadSource
    status: LeadStatus
    followUpDate: Optional[datetime.date]
    notes: str
    createdAt: datetime.datetime


class CreateLeadRequest(BaseModel):
    name: Name
    phone: Phone
    source: LeadSource = "other"
    followUpDate: Optional[Day] = None
    notes: Text = ""


class UpdateLeadRequest(BaseModel):
    name: Optional[Name] = None
    phone: Optional[Phone] = None
    source: Optional[LeadSource] = None
    status: Optional[LeadStatus] = None
    followUpDate: Optional[Day] = None  # null clears the follow-up
    notes: Optional[Text] = None

    @model_validator(mode="after")
    def _no_nulls(self):
        _reject_explicit_nulls(self, ("name", "phone", "source", "status", "notes"))
        return self


# ---- Tenants ----

class TenantDocumentOut(BaseModel):
    id: int
    docType: DocumentType
    label: str
    fileName: Optional[str]
    uploadedAt: Optional[datetime.datetime]


class TenantNoticeRef(BaseModel):
    id: int
    plannedMoveOutDate: datetime.date
    status: NoticeStatus


class RenewalOut(BaseModel):
    id: int
    renewedAt: datetime.datetime
    previousExpiry: datetime.date
    newExpiry: datetime.date
    previousRent: float
    newRent: float
    effectivePeriod: str  # YYYY-MM the new rent starts


class TenantOut(BaseModel):
    id: int
    name: str
    phone: str
    bedId: int
    roomNumber: str
    bedLabel: str
    moveInDate: datetime.date
    moveOutDate: Optional[datetime.date]
    rentDueDay: int
    rentAmount: float  # rent for the current month (after any renewals)
    upcomingRent: Optional[float]  # a renewal's new rent that hasn't started yet
    upcomingRentFrom: Optional[str]  # YYYY-MM it starts
    depositAmount: float
    agreementExpiry: datetime.date
    documents: list[TenantDocumentOut]
    isActive: bool
    notice: Optional[TenantNoticeRef] = None
    renewals: list[RenewalOut]


class CreateTenantRequest(BaseModel):
    name: Name
    phone: Phone
    bedId: int
    moveInDate: Day
    rentDueDay: int = Field(ge=1, le=31)
    rentAmount: Optional[Rent] = None  # defaults to the bed's listed rent
    depositAmount: Deposit
    agreementExpiry: Day

    @model_validator(mode="after")
    def _agreement_after_move_in(self):
        if self.agreementExpiry <= self.moveInDate:
            raise ValueError("Agreement must end after the move-in date")
        return self


class GiveNoticeRequest(BaseModel):
    noticeDate: Day
    plannedMoveOutDate: Day


class RenewAgreementRequest(BaseModel):
    newExpiry: Day
    newRent: Rent
    effectiveFrom: Period  # first month the new rent applies


class UploadDocumentRequest(BaseModel):
    fileName: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


# ---- Rent tracker ----

class RentRecordOut(BaseModel):
    id: int
    tenantId: int
    tenantName: str
    roomNumber: str
    bedLabel: str
    periodMonth: str
    dueDate: datetime.date
    amountDue: float
    amountPaid: float
    paidDate: Optional[datetime.date]
    status: PaymentStatus


class RecordPaymentRequest(BaseModel):
    amount: Money
    paidDate: Day
    method: ManualPaymentMethod = "cash"
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] = ""


class PaymentTransactionOut(BaseModel):
    id: int
    paymentId: int
    tenantId: int
    tenantName: str
    roomNumber: str
    bedLabel: str
    periodMonth: str
    amount: float
    paidDate: datetime.date
    method: PaymentMethod
    note: str


class DailyCollection(BaseModel):
    date: datetime.date
    amount: float


class RentSummaryOut(BaseModel):
    periodMonth: Optional[str]  # None = all months
    billed: float
    collected: float
    outstanding: float
    dueCount: int
    overdueCount: int
    overdueAmount: float
    depositsHeld: float
    dailyCollections: list[DailyCollection]  # only for a single month, else empty


# ---- Dashboard ----

class MoveEntry(BaseModel):
    tenantId: int
    name: str
    roomNumber: str
    bedLabel: str


class FollowUpEntry(BaseModel):
    leadId: int
    name: str
    phone: str


class AgeingBucket(BaseModel):
    label: str  # "0–7 days" | "8–30 days" | "31+ days"
    amount: float
    count: int


DecisionKind = Literal["rent", "complaint", "move-out", "agreement", "lead", "documents"]


class DecisionItem(BaseModel):
    kind: DecisionKind
    title: str
    detail: str
    amountAtRisk: float
    tier: int  # 1 = act now, 2 = today, 3 = this week
    link: str  # frontend route to act on it


UpcomingKind = Literal["move-in", "move-out", "inspection", "agreement-expiry", "follow-up"]


class UpcomingEvent(BaseModel):
    date: datetime.date
    kind: UpcomingKind
    title: str
    detail: str


class DashboardSummaryOut(BaseModel):
    totalBeds: int
    occupiedBeds: int
    vacantBeds: int
    occupancyPct: float
    billedThisMonth: float
    collectedThisMonth: float
    overdueAmount: float
    overdueResidents: int
    openComplaints: int
    urgentComplaints: int
    oldestUrgentHours: Optional[int]
    duesAgeing: list[AgeingBucket]
    decisionQueue: list[DecisionItem]
    nextSevenDays: list[UpcomingEvent]
    moveInsToday: list[MoveEntry]
    moveOutsToday: list[MoveEntry]
    followUpsToday: list[FollowUpEntry]
    rentOverdueCount: int


# ---- Operations: complaints ----

class StaffRef(BaseModel):
    id: int
    name: str


class ComplaintOut(BaseModel):
    id: int
    title: str
    description: str
    category: ComplaintCategory
    priority: ComplaintPriority
    status: ComplaintStatus
    roomNumber: str
    tenant: Optional[BedTenantRef]
    assignedTo: Optional[StaffRef]
    createdAt: datetime.datetime
    resolvedAt: Optional[datetime.datetime]


class CreateComplaintRequest(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    description: Text = ""
    category: ComplaintCategory = "other"
    priority: ComplaintPriority = "normal"
    roomNumber: Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)] = ""
    tenantId: Optional[int] = None
    assignedToId: Optional[int] = None


class UpdateComplaintRequest(BaseModel):
    status: Optional[ComplaintStatus] = None
    priority: Optional[ComplaintPriority] = None
    assignedToId: Optional[int] = None  # null unassigns

    @model_validator(mode="after")
    def _no_nulls(self):
        _reject_explicit_nulls(self, ("status", "priority"))
        return self


# ---- Operations: move-outs ----

class DeductionOut(BaseModel):
    id: int
    label: str
    amount: float


class MoveOutNoticeOut(BaseModel):
    id: int
    tenantId: int
    tenantName: str
    roomNumber: str
    bedLabel: str
    noticeDate: datetime.date
    plannedMoveOutDate: datetime.date
    inspectionDate: Optional[datetime.date]
    status: NoticeStatus
    depositHeld: float
    unpaidRent: float  # outstanding rent, deducted from the deposit automatically
    deductions: list[DeductionOut]
    expectedRefund: float  # deposit - unpaid rent - deductions, floored at 0
    refundAmount: Optional[float]
    refundPaidDate: Optional[datetime.date]


class UpdateNoticeRequest(BaseModel):
    plannedMoveOutDate: Optional[Day] = None

    @model_validator(mode="after")
    def _no_nulls(self):
        _reject_explicit_nulls(self, ("plannedMoveOutDate",))
        return self


class ScheduleInspectionRequest(BaseModel):
    inspectionDate: Day


class AddDeductionRequest(BaseModel):
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    amount: Money


class SettleRequest(BaseModel):
    refundPaidDate: Day


# ---- Profit & loss (owner only) ----

class ExpenseOut(BaseModel):
    id: int
    spentOn: datetime.date
    category: ExpenseCategory
    description: str
    paidTo: str
    amount: float


class CreateExpenseRequest(BaseModel):
    spentOn: Day
    category: ExpenseCategory
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] = ""
    paidTo: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] = ""
    amount: Money


class PnlLine(BaseModel):
    key: str
    label: str
    amount: float


class PnlMonth(BaseModel):
    periodMonth: str
    income: float
    expenses: float
    net: float


class PnlOut(BaseModel):
    periodMonth: str
    incomeLines: list[PnlLine]
    incomeTotal: float
    expenseLines: list[PnlLine]  # one per category with spend, largest first
    expenseTotal: float
    net: float
    marginPct: Optional[float]  # None when there's no income
    rentBilled: float
    collectionRatePct: Optional[float]
    previous: Optional[PnlMonth]
    trend: list[PnlMonth]  # last 6 months ending at periodMonth, oldest first
