import type { Complaint, ComplaintStatus, StaffRef } from "../../types/contract";
import { StatusBadge, type BadgeTone } from "../common/StatusBadge";
import { hoursSince } from "../../lib/format";
import { CATEGORY_LABEL } from "./ComplaintFormModal";
import styles from "../common/Table.module.css";

const STATUS_TONE: Record<ComplaintStatus, BadgeTone> = { open: "new", "in-progress": "due", resolved: "paid" };
const STATUS_OPTIONS: ComplaintStatus[] = ["open", "in-progress", "resolved"];

function age(hours: number): string {
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function ComplaintTable({
  complaints,
  staff,
  savingIds,
  onUpdate,
}: {
  complaints: Complaint[];
  staff: StaffRef[];
  savingIds: Set<number>;
  onUpdate: (id: number, data: { status?: ComplaintStatus; assignedToId?: number | null }) => void;
}) {
  if (complaints.length === 0) {
    return <p className={styles.empty}>No open complaints. Nice.</p>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Complaint</th>
            <th>Room</th>
            <th>Type</th>
            <th>Open for</th>
            <th>Assigned to</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {complaints.map((c) => {
            const openHours = c.resolvedAt ? null : hoursSince(c.createdAt);
            return (
              <tr key={c.id}>
                <td>
                  <div className={styles.statusCell}>
                    {c.priority === "urgent" && <StatusBadge tone="overdue" label="urgent" />}
                    <span className={styles.name}>{c.title}</span>
                  </div>
                  {c.description && <div className={styles.notes} style={{ maxWidth: 300, fontSize: "var(--text-xs)" }}>{c.description}</div>}
                </td>
                <td className={styles.mono}>{c.roomNumber || "—"}</td>
                <td>{CATEGORY_LABEL[c.category]}</td>
                <td className={styles.mono}>{openHours === null ? "closed" : age(openHours)}</td>
                <td>
                  <select
                    className={styles.statusSelect}
                    value={c.assignedTo?.id ?? ""}
                    onChange={(e) => onUpdate(c.id, { assignedToId: e.target.value ? Number(e.target.value) : null })}
                    disabled={savingIds.has(c.id)}
                    aria-label={`Assign ${c.title}`}
                  >
                    <option value="">Unassigned</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className={styles.statusCell}>
                    <StatusBadge tone={STATUS_TONE[c.status]} label={c.status} />
                    <select
                      className={styles.statusSelect}
                      value={c.status}
                      onChange={(e) => onUpdate(c.id, { status: e.target.value as ComplaintStatus })}
                      disabled={savingIds.has(c.id)}
                      aria-label={`Change status for ${c.title}`}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
