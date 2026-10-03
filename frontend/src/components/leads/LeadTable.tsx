import type { Lead, LeadStatus } from "../../types/contract";
import { StatusBadge } from "../common/StatusBadge";
import { formatDate } from "../../lib/format";
import styles from "../common/Table.module.css";

const STATUS_OPTIONS: LeadStatus[] = ["new", "visited", "booked", "lost"];
const SOURCE_LABEL: Record<Lead["source"], string> = {
  broker: "Broker",
  whatsapp: "WhatsApp",
  google: "Google",
  "walk-in": "Walk-in",
  other: "Other",
};

export function LeadTable({
  leads,
  savingIds,
  onStatusChange,
}: {
  leads: Lead[];
  savingIds: Set<number>;
  onStatusChange: (leadId: number, status: LeadStatus) => void;
}) {
  if (leads.length === 0) {
    return <p className={styles.empty}>No leads here yet. Add one to start tracking follow-ups.</p>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Source</th>
            <th>Status</th>
            <th>Follow-up</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id}>
              <td className={styles.name}>{lead.name}</td>
              <td className={styles.mono}>{lead.phone}</td>
              <td>{SOURCE_LABEL[lead.source]}</td>
              <td>
                <div className={styles.statusCell}>
                  <StatusBadge tone={lead.status} label={lead.status} />
                  <select
                    className={styles.statusSelect}
                    value={lead.status}
                    onChange={(e) => onStatusChange(lead.id, e.target.value as LeadStatus)}
                    disabled={savingIds.has(lead.id)}
                    aria-label={`Change status for ${lead.name}`}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </td>
              <td className={styles.mono}>{formatDate(lead.followUpDate)}</td>
              <td className={styles.notes}>{lead.notes || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
