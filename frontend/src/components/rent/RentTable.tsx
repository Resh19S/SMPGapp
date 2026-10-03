import { Link } from "react-router-dom";
import type { RentRecord } from "../../types/contract";
import { StatusBadge } from "../common/StatusBadge";
import { formatDate, inr, monthLabel } from "../../lib/format";
import { rentReminderText, whatsappLink } from "../../lib/whatsapp";
import styles from "../common/Table.module.css";

export function RentTable({
  records,
  propertyName,
  showMonth,
  onRecordPayment,
}: {
  records: RentRecord[];
  propertyName: string;
  showMonth: boolean; // only when listing several months

  onRecordPayment: (record: RentRecord) => void;
}) {
  if (records.length === 0) {
    return <p className={styles.empty}>No rent records for this filter.</p>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Tenant</th>
            {showMonth && <th>Month</th>}
            <th>Due</th>
            <th>Rent</th>
            <th>Paid</th>
            <th>Balance</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const balance = r.amountDue - r.amountPaid;
            return (
              <tr key={r.id}>
                <td className={styles.name}>
                  {r.tenantName}
                  <span className={styles.sub}>Room {r.roomNumber}/{r.bedLabel}</span>
                </td>
                {showMonth && <td className={styles.nowrap}>{monthLabel(r.periodMonth)}</td>}
                <td className={styles.mono}>{formatDate(r.dueDate)}</td>
                <td className={styles.mono}>{inr(r.amountDue)}</td>
                <td className={styles.mono}>
                  {r.amountPaid > 0 ? inr(r.amountPaid) : "—"}
                  {r.paidDate && <span className={styles.sub}>on {formatDate(r.paidDate)}</span>}
                </td>
                <td className={styles.mono}>{balance > 0 ? inr(balance) : "—"}</td>
                <td><StatusBadge tone={r.status} label={r.status} /></td>
                <td>
                  <div className={styles.rowActions}>
                    {r.status !== "paid" && (
                      <>
                        <button className={styles.actionButton} onClick={() => onRecordPayment(r)}>
                          Record payment
                        </button>
                        <a
                          className={styles.actionButton}
                          href={whatsappLink(r.tenantPhone, rentReminderText(r, propertyName))}
                          target="_blank"
                          rel="noreferrer"
                          title="Opens WhatsApp with a reminder typed in — you press Send"
                        >
                          Remind
                        </a>
                      </>
                    )}
                    {r.latestTransactionId !== null && (
                      <Link className={styles.actionButton} to={`/receipts/${r.latestTransactionId}`}>
                        Receipt
                      </Link>
                    )}
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
