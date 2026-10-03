import { useEffect, useState } from "react";
import {
  addDeduction,
  createComplaint,
  listComplaints,
  listMoveOuts,
  removeDeduction,
  scheduleInspection,
  settleMoveOut,
  staffDirectory,
  updateComplaint,
  updateMoveOutDate,
} from "../api/client";
import type { Complaint, MoveOutNotice, StaffRef } from "../types/contract";
import { ApiError } from "../api/client";
import { useLatestRequest } from "../lib/useLatestRequest";
import { ComplaintTable } from "../components/operations/ComplaintTable";
import { ComplaintFormModal } from "../components/operations/ComplaintFormModal";
import { MoveOutCard, type MoveOutActions } from "../components/operations/MoveOutCard";
import pageStyles from "./PageLayout.module.css";
import styles from "./OperationsPage.module.css";

export function OperationsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [notices, setNotices] = useState<MoveOutNotice[]>([]);
  const [staff, setStaff] = useState<StaffRef[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const beginComplaintsLoad = useLatestRequest();
  const beginMoveOutsLoad = useLatestRequest();

  useEffect(() => {
    staffDirectory().then(setStaff).catch(() => setError("Could not load staff list."));
  }, []);

  // Each toggle's list ignores answers for a previous toggle state.
  useEffect(() => {
    const isLatest = beginComplaintsLoad();
    listComplaints(showResolved)
      .then((data) => isLatest() && setComplaints(data))
      .catch(() => isLatest() && setError("Could not load complaints."));
  }, [showResolved, beginComplaintsLoad]);

  useEffect(() => {
    const isLatest = beginMoveOutsLoad();
    listMoveOuts(showSettled)
      .then((data) => isLatest() && setNotices(data))
      .catch(() => isLatest() && setError("Could not load move-outs."));
  }, [showSettled, beginMoveOutsLoad]);

  async function handleCreate(data: Parameters<typeof createComplaint>[0]) {
    const created = await createComplaint(data);
    setComplaints((prev) => [created, ...prev]);
  }

  async function handleUpdate(id: number, data: Parameters<typeof updateComplaint>[1]) {
    setSavingIds((prev) => new Set(prev).add(id));
    try {
      const updated = await updateComplaint(id, data);
      setError(null);
      setComplaints((prev) =>
        prev
          .map((c) => (c.id === id ? updated : c))
          .filter((c) => showResolved || c.status !== "resolved")
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the complaint.");
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function replaceNotice(updated: MoveOutNotice) {
    setNotices((prev) =>
      prev.map((n) => (n.id === updated.id ? updated : n)).filter((n) => showSettled || n.status !== "settled")
    );
  }

  const moveOutActions: MoveOutActions = {
    changeDate: async (id, date) => replaceNotice(await updateMoveOutDate(id, date)),
    scheduleInspection: async (id, date) => replaceNotice(await scheduleInspection(id, date)),
    addDeduction: async (id, label, amount) => replaceNotice(await addDeduction(id, label, amount)),
    removeDeduction: async (id, deductionId) => replaceNotice(await removeDeduction(id, deductionId)),
    settle: async (id, date) => replaceNotice(await settleMoveOut(id, date)),
  };

  const urgentCount = complaints.filter((c) => c.priority === "urgent" && c.status !== "resolved").length;

  return (
    <div>
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>Operations</h1>
          <p className={pageStyles.subtitle}>Complaints and move-outs — every one logged, assigned and tracked to closure.</p>
        </div>
        <button className={pageStyles.primaryAction} onClick={() => setIsFormOpen(true)}>
          + Log complaint
        </button>
      </div>

      {error && <p className={pageStyles.error}>{error}</p>}

      <section>
        <div className={styles.sectionHeader}>
          <h2 className={pageStyles.sectionTitle}>
            Complaints
            {urgentCount > 0 && <span className={styles.urgentNote}>{urgentCount} urgent</span>}
          </h2>
          <label className={pageStyles.toggle}>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
        </div>
        <ComplaintTable complaints={complaints} staff={staff} savingIds={savingIds} onUpdate={handleUpdate} />
      </section>

      <section className={pageStyles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={pageStyles.sectionTitle}>Move-outs</h2>
          <label className={pageStyles.toggle}>
            <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} />
            Show settled
          </label>
        </div>
        {notices.length === 0 ? (
          <p className={pageStyles.muted}>
            Nobody is leaving. Record a notice from a resident's page in Tenants when someone tells you they're moving out.
          </p>
        ) : (
          <div className={styles.moveOuts}>
            {notices.map((n) => (
              <MoveOutCard key={n.id} notice={n} actions={moveOutActions} />
            ))}
          </div>
        )}
      </section>

      {isFormOpen && <ComplaintFormModal staff={staff} onClose={() => setIsFormOpen(false)} onSubmit={handleCreate} />}
    </div>
  );
}
