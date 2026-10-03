import { useEffect, useState } from "react";
import { ApiError, createLead, listLeads, updateLead } from "../api/client";
import { useLatestRequest } from "../lib/useLatestRequest";
import type { Lead, LeadStatus } from "../types/contract";
import { LeadTable } from "../components/leads/LeadTable";
import { LeadFormModal } from "../components/leads/LeadFormModal";
import pageStyles from "./PageLayout.module.css";

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const beginLoad = useLatestRequest();

  function load(includeArchived: boolean) {
    const isLatest = beginLoad();
    setIsLoading(true);
    listLeads(includeArchived)
      .then((data) => {
        if (!isLatest()) return; // toggled again while this was loading
        setLeads(data);
        setError(null);
      })
      .catch(() => isLatest() && setError("Could not load leads."))
      .finally(() => isLatest() && setIsLoading(false));
  }

  useEffect(() => {
    load(showArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  async function handleCreate(data: Parameters<typeof createLead>[0]) {
    const lead = await createLead(data);
    setLeads((prev) => [lead, ...prev]);
  }

  async function handleStatusChange(leadId: number, status: LeadStatus) {
    setSavingIds((prev) => new Set(prev).add(leadId));
    try {
      const updated = await updateLead(leadId, { status });
      setError(null);
      setLeads((prev) => {
        const next = prev.map((l) => (l.id === leadId ? updated : l));
        // Archiving a lead as "lost" removes it from the active view immediately.
        return showArchived ? next : next.filter((l) => l.status !== "lost");
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the lead. Please try again.");
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
  }

  return (
    <div>
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>Leads</h1>
          <p className={pageStyles.subtitle}>Track enquiries from broker, WhatsApp, and Google through to booking.</p>
        </div>
        <button className={pageStyles.primaryAction} onClick={() => setIsModalOpen(true)}>
          + Add lead
        </button>
      </div>

      <label className={pageStyles.toggle}>
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived (lost) leads
      </label>

      {error && <p className={pageStyles.error}>{error}</p>}
      {isLoading ? <p className={pageStyles.loading}>Loading leads…</p> : <LeadTable leads={leads} savingIds={savingIds} onStatusChange={handleStatusChange} />}

      {isModalOpen && <LeadFormModal onClose={() => setIsModalOpen(false)} onSubmit={handleCreate} />}
    </div>
  );
}
