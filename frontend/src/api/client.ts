import { useAuthStore } from "../store/authStore";
import type {
  ActivityArea,
  ActivityEntry,
  Bed,
  BedStatus,
  Complaint,
  ComplaintCategory,
  ComplaintPriority,
  ComplaintStatus,
  DashboardSummary,
  Expense,
  ExpenseCategory,
  Lead,
  LeadSource,
  LeadStatus,
  LoginResponse,
  NavCounts,
  Receipt,
  SearchResult,
  TenantImportResult,
  TenantImportRow,
  ManualPaymentMethod,
  MoveOutNotice,
  PaymentTransaction,
  ProfitAndLoss,
  Property,
  UpdatePropertyRequest,
  RentRecord,
  RentSummary,
  StaffRef,
  StaffRole,
  StaffUser,
  Tenant,
} from "../types/contract";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

function getToken(): string | null {
  return sessionStorage.getItem("token");
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401 && path !== "/auth/login") {
    // Session expired or the account was deactivated: go back to sign-in
    // instead of leaving every page stuck on "Could not load…".
    useAuthStore.getState().logout();
    window.location.assign("/login?expired=1");
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      // FastAPI validation errors arrive as a list of {loc, msg}; show the messages.
      detail = Array.isArray(body.detail)
        ? body.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, "")).join("; ")
        : body.detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export { ApiError };

// ---- Auth ----

export function login(username: string, password: string): Promise<LoginResponse> {
  return request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function fetchMe(): Promise<StaffUser> {
  return request("/auth/me");
}

/** Returns a fresh token: other sessions of this account are signed out. */
export function changePassword(currentPassword: string, newPassword: string): Promise<LoginResponse> {
  return request("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
}

// ---- Staff (owner only) ----

export function listStaff(): Promise<StaffUser[]> {
  return request("/staff");
}

export function createStaff(data: { name: string; username: string; password: string; role: StaffRole }): Promise<StaffUser> {
  return request("/staff", { method: "POST", body: JSON.stringify(data) });
}

export function deactivateStaff(staffId: number): Promise<StaffUser> {
  return request(`/staff/${staffId}/deactivate`, { method: "PATCH" });
}

export function resetStaffPassword(staffId: number, newPassword: string): Promise<StaffUser> {
  return request(`/staff/${staffId}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) });
}

/** Active staff names for assigning work — available to every role. */
export function staffDirectory(): Promise<StaffRef[]> {
  return request("/staff/directory");
}

// ---- Properties & beds ----

export function listProperties(): Promise<Property[]> {
  return request("/properties");
}

export function createProperty(data: { name: string; address: string }): Promise<Property> {
  return request("/properties", { method: "POST", body: JSON.stringify(data) });
}

export function updateProperty(id: number, data: UpdatePropertyRequest): Promise<Property> {
  return request(`/properties/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function listBeds(propertyId?: number): Promise<Bed[]> {
  const qs = propertyId ? `?propertyId=${propertyId}` : "";
  return request(`/beds${qs}`);
}

export function createBed(data: { propertyId: number; roomNumber: string; bedLabel: string; rentAmount: number }): Promise<Bed> {
  return request("/beds", { method: "POST", body: JSON.stringify(data) });
}

export function createBedsBulk(data: {
  propertyId: number;
  floor: number | null;
  roomNumbers: string[];
  bedLabels: string[];
  rentAmount: number;
}): Promise<Bed[]> {
  return request("/beds/bulk", { method: "POST", body: JSON.stringify(data) });
}

export function updateBed(bedId: number, data: Partial<{ roomNumber: string; bedLabel: string; rentAmount: number }>): Promise<Bed> {
  return request(`/beds/${bedId}`, { method: "PATCH", body: JSON.stringify(data) });
}

// ---- Leads ----

export function listLeads(includeArchived = false): Promise<Lead[]> {
  return request(`/leads?includeArchived=${includeArchived}`);
}

export function createLead(data: { name: string; phone: string; source: LeadSource; followUpDate: string | null; notes: string }): Promise<Lead> {
  return request("/leads", { method: "POST", body: JSON.stringify(data) });
}

export function updateLead(
  leadId: number,
  data: Partial<{ name: string; phone: string; source: LeadSource; status: LeadStatus; followUpDate: string | null; notes: string }>
): Promise<Lead> {
  return request(`/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(data) });
}

// ---- Tenants ----

export function listTenants(includeMovedOut = false): Promise<Tenant[]> {
  return request(`/tenants?includeMovedOut=${includeMovedOut}`);
}

export function getTenant(tenantId: number): Promise<Tenant> {
  return request(`/tenants/${tenantId}`);
}

export function createTenant(data: {
  name: string;
  phone: string;
  bedId: number;
  moveInDate: string;
  rentDueDay: number;
  rentAmount: number;
  depositAmount: number;
  agreementExpiry: string;
}): Promise<Tenant> {
  return request("/tenants", { method: "POST", body: JSON.stringify(data) });
}

export function giveNotice(tenantId: number, noticeDate: string, plannedMoveOutDate: string): Promise<Tenant> {
  return request(`/tenants/${tenantId}/notice`, {
    method: "POST",
    body: JSON.stringify({ noticeDate, plannedMoveOutDate }),
  });
}

/** Contact details only — rent and deposit change through renewal/settlement. */
export function updateTenant(tenantId: number, data: Partial<{ name: string; phone: string }>): Promise<Tenant> {
  return request(`/tenants/${tenantId}`, { method: "PATCH", body: JSON.stringify(data) });
}

/** dryRun=true checks every row and writes nothing. */
export function importTenants(rows: TenantImportRow[], dryRun: boolean): Promise<TenantImportResult> {
  return request(`/tenants/import?dryRun=${dryRun}`, { method: "POST", body: JSON.stringify({ rows }) });
}

export function renewAgreement(
  tenantId: number,
  data: { newExpiry: string; newRent: number; effectiveFrom: string }
): Promise<Tenant> {
  return request(`/tenants/${tenantId}/renewals`, { method: "POST", body: JSON.stringify(data) });
}

export function uploadTenantDocument(tenantId: number, documentId: number, fileName: string): Promise<Tenant> {
  return request(`/tenants/${tenantId}/documents/${documentId}/upload`, {
    method: "POST",
    body: JSON.stringify({ fileName }),
  });
}

// ---- Rent tracker ----

export function listPayments(filters: { periodMonth?: string; status?: string } = {}): Promise<RentRecord[]> {
  const params = new URLSearchParams();
  if (filters.periodMonth) params.set("periodMonth", filters.periodMonth);
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  return request(`/payments${qs ? `?${qs}` : ""}`);
}

/** `idempotencyKey` is generated once per payment form: a double-click or a
 * network retry resends the same key and the server records the money once. */
export function recordPayment(
  paymentId: number,
  data: { amount: number; paidDate: string; method: ManualPaymentMethod; note: string },
  idempotencyKey: string
): Promise<RentRecord> {
  return request(`/payments/${paymentId}/transactions`, {
    method: "POST",
    body: JSON.stringify(data),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function fetchReceipt(transactionId: number): Promise<Receipt> {
  return request(`/payments/transactions/${transactionId}`);
}

export function fetchRentSummary(periodMonth: string | null): Promise<RentSummary> {
  return request(`/payments/summary${periodMonth ? `?periodMonth=${periodMonth}` : ""}`);
}

export function listTransactions(filters: { periodMonth?: string; limit?: number } = {}): Promise<PaymentTransaction[]> {
  const params = new URLSearchParams();
  if (filters.periodMonth) params.set("periodMonth", filters.periodMonth);
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return request(`/payments/transactions${qs ? `?${qs}` : ""}`);
}

// ---- Operations: complaints ----

export function listComplaints(includeResolved = false): Promise<Complaint[]> {
  return request(`/complaints?includeResolved=${includeResolved}`);
}

export function createComplaint(data: {
  title: string;
  description: string;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  roomNumber: string;
  assignedToId: number | null;
}): Promise<Complaint> {
  return request("/complaints", { method: "POST", body: JSON.stringify(data) });
}

export function updateComplaint(
  complaintId: number,
  data: Partial<{ status: ComplaintStatus; priority: ComplaintPriority; assignedToId: number | null }>
): Promise<Complaint> {
  return request(`/complaints/${complaintId}`, { method: "PATCH", body: JSON.stringify(data) });
}

// ---- Operations: move-outs ----

export function listMoveOuts(includeSettled = false): Promise<MoveOutNotice[]> {
  return request(`/move-outs?includeSettled=${includeSettled}`);
}

export function updateMoveOutDate(noticeId: number, plannedMoveOutDate: string): Promise<MoveOutNotice> {
  return request(`/move-outs/${noticeId}`, { method: "PATCH", body: JSON.stringify({ plannedMoveOutDate }) });
}

export function scheduleInspection(noticeId: number, inspectionDate: string): Promise<MoveOutNotice> {
  return request(`/move-outs/${noticeId}/inspection`, { method: "POST", body: JSON.stringify({ inspectionDate }) });
}

export function addDeduction(noticeId: number, label: string, amount: number): Promise<MoveOutNotice> {
  return request(`/move-outs/${noticeId}/deductions`, { method: "POST", body: JSON.stringify({ label, amount }) });
}

export function removeDeduction(noticeId: number, deductionId: number): Promise<MoveOutNotice> {
  return request(`/move-outs/${noticeId}/deductions/${deductionId}`, { method: "DELETE" });
}

export function settleMoveOut(noticeId: number, refundPaidDate: string): Promise<MoveOutNotice> {
  return request(`/move-outs/${noticeId}/settle`, { method: "POST", body: JSON.stringify({ refundPaidDate }) });
}

// ---- Dashboard ----

export function fetchDashboard(): Promise<DashboardSummary> {
  return request("/dashboard");
}

export function fetchNavCounts(): Promise<NavCounts> {
  return request("/dashboard/counts");
}

export function search(q: string): Promise<SearchResult[]> {
  return request(`/search?q=${encodeURIComponent(q)}`);
}

// ---- Profit & loss (owner only) ----

export function fetchProfitAndLoss(periodMonth: string): Promise<ProfitAndLoss> {
  return request(`/reports/pnl?periodMonth=${periodMonth}`);
}

export function listExpenses(periodMonth: string): Promise<Expense[]> {
  return request(`/expenses?periodMonth=${periodMonth}`);
}

export function createExpense(data: {
  spentOn: string;
  category: ExpenseCategory;
  description: string;
  paidTo: string;
  amount: number;
}): Promise<Expense> {
  return request("/expenses", { method: "POST", body: JSON.stringify(data) });
}

export function deleteExpense(expenseId: number): Promise<void> {
  return request(`/expenses/${expenseId}`, { method: "DELETE" });
}

// ---- Activity (owner only) ----

export function listActivity(filters: { area?: ActivityArea; userId?: number; beforeId?: number; limit?: number } = {}): Promise<ActivityEntry[]> {
  const params = new URLSearchParams();
  if (filters.area) params.set("area", filters.area);
  if (filters.userId) params.set("userId", String(filters.userId));
  if (filters.beforeId) params.set("beforeId", String(filters.beforeId));
  params.set("limit", String(filters.limit ?? 100));
  return request(`/activity?${params}`);
}

export type { BedStatus };
