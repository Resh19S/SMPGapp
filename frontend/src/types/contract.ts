// Fixed API contract between backend/ and frontend/.
// Mirrored by frontend/src/types/contract.ts (TS) and backend/models/schemas.py (Pydantic).
// If a field needs to change here, it must change in both places in the same commit.

export type StaffRole = "owner" | "staff";

export interface StaffUser {
  id: number;
  name: string;
  username: string;
  role: StaffRole;
  isActive: boolean;
}

export interface LoginResponse {
  token: string;
  user: StaffUser;
}

// ---- Properties & beds ----

export interface Property {
  id: number;
  name: string;
  address: string;
}

export type BedStatus = "vacant" | "occupied";
// Money state of a bed right now — "reserved" = tenant booked but not moved in yet.
export type BedRentState = "vacant" | "reserved" | "paid" | "due" | "due-today" | "late";

export interface Bed {
  id: number;
  propertyId: number;
  floor: number;
  roomNumber: string;
  bedLabel: string;
  rentAmount: number; // listed rent for the NEXT resident; current resident's rent is Tenant.rentAmount
  status: BedStatus;
  currentTenant: { id: number; name: string } | null;
  rentState: BedRentState;
  daysLate: number | null;
  outstanding: number; // rent due today or earlier and still unpaid
}

// ---- Leads ----

export type LeadSource = "broker" | "whatsapp" | "google" | "walk-in" | "other";
export type LeadStatus = "new" | "visited" | "booked" | "lost";

export interface Lead {
  id: number;
  name: string;
  phone: string;
  source: LeadSource;
  status: LeadStatus;
  followUpDate: string | null; // YYYY-MM-DD
  notes: string;
  createdAt: string; // ISO date
}

// ---- Tenants ----

export type DocumentType = "id-proof" | "agreement" | "photo" | "other";

export interface TenantDocument {
  id: number;
  docType: DocumentType;
  label: string;
  fileName: string | null; // null = not uploaded yet (mock upload only)
  uploadedAt: string | null;
}

export interface Tenant {
  id: number;
  name: string;
  phone: string;
  bedId: number;
  roomNumber: string;
  bedLabel: string;
  moveInDate: string; // YYYY-MM-DD
  moveOutDate: string | null;
  rentDueDay: number; // 1-31, day of month rent is due
  rentAmount: number; // rent for the current month, after any renewals
  upcomingRent: number | null; // a renewal's new rent that hasn't started yet
  upcomingRentFrom: string | null; // YYYY-MM it starts
  depositAmount: number;
  agreementExpiry: string; // YYYY-MM-DD
  documents: TenantDocument[];
  isActive: boolean;
  notice: { id: number; plannedMoveOutDate: string; status: NoticeStatus } | null;
  renewals: AgreementRenewal[]; // newest first
}

export interface AgreementRenewal {
  id: number;
  renewedAt: string;
  previousExpiry: string;
  newExpiry: string;
  previousRent: number;
  newRent: number;
  effectivePeriod: string; // YYYY-MM the new rent starts
}

// ---- Rent tracker (computed from Tenant + Payment log, not hand-maintained) ----

export type PaymentStatus = "paid" | "due" | "overdue";

export interface RentRecord {
  id: number;
  tenantId: number;
  tenantName: string;
  roomNumber: string;
  bedLabel: string;
  periodMonth: string; // YYYY-MM
  dueDate: string; // YYYY-MM-DD, derived from tenant.rentDueDay
  amountDue: number;
  amountPaid: number;
  paidDate: string | null; // date the month became fully paid
  status: PaymentStatus;
}

export type ManualPaymentMethod = "cash" | "upi" | "bank" | "other";
export type PaymentMethod = ManualPaymentMethod | "deposit"; // "deposit" = recovered at move-out

export interface PaymentTransaction {
  id: number;
  paymentId: number;
  tenantId: number;
  tenantName: string;
  roomNumber: string;
  bedLabel: string;
  periodMonth: string;
  amount: number;
  paidDate: string;
  method: PaymentMethod;
  note: string;
}

export interface RentSummary {
  periodMonth: string | null; // null = all months
  billed: number;
  collected: number;
  outstanding: number;
  dueCount: number;
  overdueCount: number;
  overdueAmount: number;
  depositsHeld: number;
  dailyCollections: { date: string; amount: number }[]; // single month only
}

// ---- Dashboard ----

export type DecisionKind = "rent" | "complaint" | "move-out" | "agreement" | "lead" | "documents";

export interface DecisionItem {
  kind: DecisionKind;
  title: string;
  detail: string;
  amountAtRisk: number;
  tier: 1 | 2 | 3; // 1 = act now, 2 = today, 3 = this week
  link: string; // frontend route
}

export type UpcomingKind = "move-in" | "move-out" | "inspection" | "agreement-expiry" | "follow-up";

export interface DashboardSummary {
  totalBeds: number;
  occupiedBeds: number;
  vacantBeds: number;
  occupancyPct: number;
  billedThisMonth: number;
  collectedThisMonth: number;
  overdueAmount: number;
  overdueResidents: number;
  openComplaints: number;
  urgentComplaints: number;
  oldestUrgentHours: number | null;
  duesAgeing: { label: string; amount: number; count: number }[];
  decisionQueue: DecisionItem[];
  nextSevenDays: { date: string; kind: UpcomingKind; title: string; detail: string }[];
  moveInsToday: { tenantId: number; name: string; roomNumber: string; bedLabel: string }[];
  moveOutsToday: { tenantId: number; name: string; roomNumber: string; bedLabel: string }[];
  followUpsToday: { leadId: number; name: string; phone: string }[];
  rentOverdueCount: number;
}

// ---- Operations: complaints ----

export type ComplaintCategory = "plumbing" | "electrical" | "cleaning" | "internet" | "furniture" | "other";
export type ComplaintPriority = "normal" | "urgent";
export type ComplaintStatus = "open" | "in-progress" | "resolved";

export interface StaffRef {
  id: number;
  name: string;
}

export interface Complaint {
  id: number;
  title: string;
  description: string;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  roomNumber: string;
  tenant: { id: number; name: string } | null;
  assignedTo: StaffRef | null;
  createdAt: string;
  resolvedAt: string | null;
}

// ---- Operations: move-outs (notice -> inspection -> deductions -> settled) ----

export type NoticeStatus = "notice" | "inspection-scheduled" | "settled";

export interface MoveOutNotice {
  id: number;
  tenantId: number;
  tenantName: string;
  roomNumber: string;
  bedLabel: string;
  noticeDate: string;
  plannedMoveOutDate: string;
  inspectionDate: string | null;
  status: NoticeStatus;
  depositHeld: number;
  unpaidRent: number; // recovered from the deposit automatically on settlement
  deductions: { id: number; label: string; amount: number }[];
  expectedRefund: number; // deposit - unpaid rent - deductions, floored at 0
  refundAmount: number | null;
  refundPaidDate: string | null;
}

// ---- Profit & loss (owner only) ----

export type ExpenseCategory =
  | "lease"
  | "electricity"
  | "water"
  | "internet"
  | "salaries"
  | "food"
  | "cleaning"
  | "maintenance"
  | "taxes"
  | "other";

export interface Expense {
  id: number;
  spentOn: string;
  category: ExpenseCategory;
  description: string;
  paidTo: string;
  amount: number;
}

export interface PnlLine {
  key: string;
  label: string;
  amount: number;
}

export interface PnlMonth {
  periodMonth: string;
  income: number;
  expenses: number;
  net: number;
}

// Cash basis: income = money received (or kept from deposits) in the month.
export interface ProfitAndLoss {
  periodMonth: string;
  incomeLines: PnlLine[];
  incomeTotal: number;
  expenseLines: PnlLine[]; // largest first
  expenseTotal: number;
  net: number;
  marginPct: number | null; // null when there's no income
  rentBilled: number;
  collectionRatePct: number | null;
  previous: PnlMonth | null;
  trend: PnlMonth[]; // last 6 months, oldest first
}
