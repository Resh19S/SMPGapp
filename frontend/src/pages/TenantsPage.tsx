import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createTenant, giveNotice, listTenants, renewAgreement, uploadTenantDocument } from "../api/client";
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
        <button className={pageStyles.primaryAction} onClick={() => setIsFormOpen(true)}>
          + Move in tenant
        </button>
      </div>

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

      {isFormOpen && <TenantFormModal onClose={() => setIsFormOpen(false)} onSubmit={handleCreate} />}
      {selectedTenant && (
        <TenantDetailModal
          tenant={selectedTenant}
          onClose={() => setSelectedTenant(null)}
          onUploadDocument={handleUploadDocument}
          onGiveNotice={handleGiveNotice}
          onRenew={handleRenew}
        />
      )}
    </div>
  );
}
