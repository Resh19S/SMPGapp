import type { Lead, LeadStatus } from "../../types/contract";
import { StatusBadge } from "../common/StatusBadge";
import { formatDate } from "../../lib/format";
import { whatsappLink } from "../../lib/whatsapp";
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
  highlightId,
  onStatusChange,
  onMoveIn,
}: {
  leads: Lead[];
  savingIds: Set<number>;
  highlightId: number | null;
  onMoveIn: (lead: Lead) => void;
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
            <th></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} id={`lead-${lead.id}`} className={lead.id === highlightId ? styles.rowFocus : undefined}>
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
              <td>
                <div className={styles.rowActions}>
                  <a
                    className={styles.actionButton}
                    href={whatsappLink(lead.phone, `Hi ${lead.name.split(" ")[0]}, following up on your enquiry about a room with us. `)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp
                  </a>
                  {lead.status !== "lost" && (
                    <button className={styles.actionButton} onClick={() => onMoveIn(lead)} title="Create a resident from this enquiry">
                      Move in
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
