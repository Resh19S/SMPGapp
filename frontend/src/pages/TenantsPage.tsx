import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createTenant, getTenant, giveNotice, listTenants, renewAgreement, uploadTenantDocument } from "../api/client";
import { ImportTenantsModal } from "../components/tenants/ImportTenantsModal";
import { downloadCsv } from "../lib/csv";
import { formatDate } from "../lib/format";
import type { Tenant } from "../types/contract";
import { TenantTable, needsRenewal } from "../components/tenants/TenantTable";
import { useLatestRequest } from "../lib/useLatestRequest";
import { TenantFormModal } from "../components/tenants/TenantFormModal";
import { TenantDetailModal } from "../components/tenants/TenantDetailModal";
import pageStyles from "./PageLayout.module.css";

export function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [includeMovedOut, setIncludeMovedOut] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // ?filter=renewals comes from the dashboard's agreement items.
  const [searchParams, setSearchParams] = useSearchParams();
  const renewalsOnly = searchParams.get("filter") === "renewals";
  const openId = Number(searchParams.get("open")) || null; // from search
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const renewalsDue = tenants.filter(needsRenewal).length;
  const visible = renewalsOnly ? tenants.filter(needsRenewal) : tenants;

  const beginLoad = useLatestRequest();

  function load(withMovedOut: boolean) {
    const isLatest = beginLoad();
    setIsLoading(true);
    listTenants(withMovedOut)
      .then((data) => {
        if (!isLatest()) return; // toggled again while this was loading
        setTenants(data);
        setError(null);
      })
      .catch(() => isLatest() && setError("Could not load tenants."))
      .finally(() => isLatest() && setIsLoading(false));
  }

  useEffect(() => {
    load(includeMovedOut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeMovedOut]);

  async function handleCreate(data: Parameters<typeof createTenant>[0]) {
    const tenant = await createTenant(data);
    setTenants((prev) => [tenant, ...prev]);
  }

  // Arriving from search (?open=12): open that resident's details.
  useEffect(() => {
    if (!openId) return;
    getTenant(openId)
      .then(setSelectedTenant)
      .catch(() => setError("Could not open that resident."));
  }, [openId]);

  function closeDetails() {
    setSelectedTenant(null);
    if (openId) {
      searchParams.delete("open");
      setSearchParams(searchParams, { replace: true });
    }
  }

  function exportCsv() {
    downloadCsv(
      "tenants",
      ["Name", "Phone", "Room", "Bed", "Move-in date", "Rent", "Rent due day", "Deposit", "Agreement ends", "Status"],
      visible.map((t) => [
        t.name,
        t.phone,
        t.roomNumber,
        t.bedLabel,
        formatDate(t.moveInDate),
        t.rentAmount,
        t.rentDueDay,
        t.depositAmount,
        formatDate(t.agreementExpiry),
        !t.isActive ? "moved out" : t.notice ? `leaving ${formatDate(t.notice.plannedMoveOutDate)}` : "active",
      ])
    );
  }

  async function handleRenew(data: { newExpiry: string; newRent: number; effectiveFrom: string }) {
    if (!selectedTenant) return;
    const updated = await renewAgreement(selectedTenant.id, data);
    setSelectedTenant(updated);
    setTenants((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function handleUploadDocument(documentId: number, fileName: string) {
    if (!selectedTenant) return;
    const updated = await uploadTenantDocument(selectedTenant.id, documentId, fileName);
    setSelectedTenant(updated);
    setTenants((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function handleGiveNotice(noticeDate: string, plannedMoveOutDate: string) {
    if (!selectedTenant) return;
    const updated = await giveNotice(selectedTenant.id, noticeDate, plannedMoveOutDate);
    setSelectedTenant(updated);
    setTenants((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  return (
    <div>
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>Tenants</h1>
          <p className={pageStyles.subtitle}>Documents, deposits, and agreement dates for everyone currently living in.</p>
        </div>
        <div className={pageStyles.headerActions}>
          <button className={pageStyles.secondaryAction} onClick={exportCsv} disabled={visible.length === 0}>
            Export to Excel
          </button>
          <button className={pageStyles.secondaryAction} onClick={() => setIsImportOpen(true)}>
            Import from Excel
          </button>
          <button className={pageStyles.primaryAction} onClick={() => setIsFormOpen(true)}>
            + Move in tenant
          </button>
        </div>
      </div>
      {notice && (
        <p className={pageStyles.success} role="status">
          {notice}
          <button className={pageStyles.dismiss} onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </p>
      )}

      <div className={pageStyles.filterBar}>
        <button
          className={`${pageStyles.chip} ${!renewalsOnly ? pageStyles.chipActive : ""}`}
          aria-pressed={!renewalsOnly}
          onClick={() => setSearchParams({})}
        >
          Everyone <span className={pageStyles.chipCount}>{tenants.length}</span>
        </button>
        <button
          className={`${pageStyles.chip} ${renewalsOnly ? pageStyles.chipActive : ""}`}
          aria-pressed={renewalsOnly}
          onClick={() => setSearchParams({ filter: "renewals" })}
        >
          Renewals due <span className={pageStyles.chipCount}>{renewalsDue}</span>
        </button>
        <label className={pageStyles.toggle} style={{ marginBottom: 0 }}>
          <input type="checkbox" checked={includeMovedOut} onChange={(e) => setIncludeMovedOut(e.target.checked)} />
          Show moved-out tenants
        </label>
      </div>

      {error && <p className={pageStyles.error}>{error}</p>}
      {isLoading ? (
        <p className={pageStyles.loading}>Loading tenants…</p>
      ) : (
        <TenantTable tenants={visible} onSelect={setSelectedTenant} />
      )}

      {isImportOpen && (
        <ImportTenantsModal
          onClose={() => setIsImportOpen(false)}
          onImported={(count) => {
            setNotice(`${count} tenant${count === 1 ? "" : "s"} imported.`);
            load(includeMovedOut);
          }}
        />
      )}
      {isFormOpen && <TenantFormModal onClose={() => setIsFormOpen(false)} onSubmit={handleCreate} />}
      {selectedTenant && (
        <TenantDetailModal
          tenant={selectedTenant}
          onClose={closeDetails}
          onUploadDocument={handleUploadDocument}
          onGiveNotice={handleGiveNotice}
          onRenew={handleRenew}
        />
      )}
    </div>
  );
}
