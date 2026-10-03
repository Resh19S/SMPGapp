import { useCallback, useEffect, useState } from "react";
import { listActivity, staffDirectory } from "../api/client";
import type { ActivityArea, ActivityEntry, StaffRef } from "../types/contract";
import { StatusBadge, type BadgeTone } from "../components/common/StatusBadge";
import { useLatestRequest } from "../lib/useLatestRequest";
import { downloadCsv } from "../lib/csv";
import tableStyles from "../components/common/Table.module.css";
import pageStyles from "./PageLayout.module.css";
import styles from "./ActivityPage.module.css";

const AREAS: { value: ActivityArea | "all"; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "auth", label: "Sign-ins" },
  { value: "payment", label: "Rent" },
  { value: "tenant", label: "Residents" },
  { value: "lead", label: "Leads" },
  { value: "bed", label: "Rooms" },
  { value: "complaint", label: "Complaints" },
  { value: "moveout", label: "Move-outs" },
  { value: "expense", label: "Expenses" },
  { value: "staff", label: "Staff" },
];

// Plain-language names for each logged action.
const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.password_changed": "Changed own password",
  "payment.recorded": "Recorded rent",
  "tenant.moved_in": "Moved in resident",
  "tenant.updated": "Edited resident",
  "tenant.notice": "Recorded notice",
  "tenant.renewed": "Renewed agreement",
  "tenants.imported": "Imported residents",
  "document.uploaded": "Uploaded document",
  "lead.created": "Added lead",
  "lead.status": "Changed lead status",
  "lead.updated": "Edited lead",
  "property.created": "Created property",
  "bed.created": "Added bed",
  "beds.bulk_added": "Added rooms",
  "bed.updated": "Changed bed",
  "complaint.created": "Logged complaint",
  "complaint.updated": "Updated complaint",
  "moveout.date_changed": "Changed move-out date",
  "moveout.inspection": "Scheduled inspection",
  "moveout.deduction_added": "Added deduction",
  "moveout.deduction_removed": "Removed deduction",
  "moveout.settled": "Settled move-out",
  "expense.added": "Logged expense",
  "expense.deleted": "Deleted expense",
  "staff.created": "Created staff login",
  "staff.deactivated": "Deactivated staff",
  "staff.password_reset": "Reset staff password",
};

const TONE: Partial<Record<string, BadgeTone>> = {
  "auth.login_failed": "overdue",
  "staff.deactivated": "overdue",
  "expense.deleted": "overdue",
  "moveout.deduction_removed": "overdue",
  "payment.recorded": "paid",
  "moveout.settled": "paid",
};

const PAGE = 100;
const REFRESH_MS = 30_000;

/** Backend timestamps are naive UTC → show local DD/MM/YYYY HH:MM. */
function when(at: string): string {
  const d = new Date(at.endsWith("Z") ? at : `${at}Z`);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Owner-only: every change and sign-in, newest first, refreshing itself. */
export function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [area, setArea] = useState<ActivityArea | "all">("all");
  const [userId, setUserId] = useState<number | "">("");
  const [staff, setStaff] = useState<StaffRef[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const beginLoad = useLatestRequest();

  const filters = useCallback(
    () => ({ area: area === "all" ? undefined : area, userId: userId === "" ? undefined : userId }),
    [area, userId]
  );

  const load = useCallback(() => {
    const isLatest = beginLoad();
    listActivity({ ...filters(), limit: PAGE })
      .then((data) => {
        if (!isLatest()) return;
        setEntries(data);
        setHasMore(data.length === PAGE);
        setLastChecked(new Date());
        setError(null);
      })
      .catch(() => isLatest() && setError("Could not load activity."));
  }, [beginLoad, filters]);

  useEffect(() => {
    staffDirectory().then(setStaff).catch(() => {});
  }, []);

  // Load on filter change, then keep refreshing while the page is open and visible.
  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  function loadOlder() {
    const oldest = entries[entries.length - 1];
    if (!oldest) return;
    listActivity({ ...filters(), beforeId: oldest.id, limit: PAGE })
      .then((older) => {
        setEntries((prev) => [...prev, ...older]);
        setHasMore(older.length === PAGE);
      })
      .catch(() => setError("Could not load older activity."));
  }

  function exportCsv() {
    downloadCsv(
      "activity",
      ["When", "Who", "What", "Details"],
      entries.map((e) => [when(e.at), e.userName ?? "—", ACTION_LABEL[e.action] ?? e.action, e.detail])
    );
  }

  return (
    <div>
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>Activity</h1>
          <p className={pageStyles.subtitle}>
            Owner only. Every change and sign-in, with who did it and when. Entries can't be edited or deleted.
          </p>
        </div>
        <div className={pageStyles.headerActions}>
          <button className={pageStyles.secondaryAction} onClick={exportCsv} disabled={entries.length === 0}>
            Export to Excel
          </button>
          <button className={pageStyles.secondaryAction} onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      <div className={pageStyles.filterBar}>
        {AREAS.map((a) => (
          <button
            key={a.value}
            className={`${pageStyles.chip} ${area === a.value ? pageStyles.chipActive : ""}`}
            aria-pressed={area === a.value}
            onClick={() => setArea(a.value)}
          >
            {a.label}
          </button>
        ))}
        <select
          className={styles.select}
          value={userId}
          onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : "")}
          aria-label="Person"
        >
          <option value="">Everyone</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {error && <p className={pageStyles.error}>{error}</p>}
      {lastChecked && (
        <p className={styles.checked}>
          Updates every 30 seconds · last checked {lastChecked.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </p>
      )}

      {entries.length === 0 ? (
        <p className={tableStyles.empty}>Nothing recorded for this filter yet.</p>
      ) : (
        <div className={tableStyles.tableWrap}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className={`${tableStyles.mono} ${tableStyles.nowrap}`}>{when(e.at)}</td>
                  <td className={tableStyles.nowrap}>{e.userName ?? <span className={styles.unknown}>unknown</span>}</td>
                  <td className={tableStyles.nowrap}>
                    {TONE[e.action] ? (
                      <StatusBadge tone={TONE[e.action]!} label={ACTION_LABEL[e.action] ?? e.action} />
                    ) : (
                      ACTION_LABEL[e.action] ?? e.action
                    )}
                  </td>
                  <td className={styles.detail}>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <button className={`${pageStyles.secondaryAction} ${styles.more}`} onClick={loadOlder}>
          Load older
        </button>
      )}
    </div>
  );
}
