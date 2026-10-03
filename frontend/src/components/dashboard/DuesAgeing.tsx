import type { DashboardSummary } from "../../types/contract";
import { inr } from "../../lib/format";
import styles from "./DuesAgeing.module.css";

const AGE_COLORS = ["var(--color-age-1)", "var(--color-age-2)", "var(--color-age-3)"];

/** Overdue rent by how long it's been owed. Every value is labelled at the bar
 * tip, so nothing is hidden behind hover. */
export function DuesAgeing({ buckets }: { buckets: DashboardSummary["duesAgeing"] }) {
  const max = Math.max(...buckets.map((b) => b.amount), 1);
  const total = buckets.reduce((sum, b) => sum + b.amount, 0);

  if (total === 0) return <p className={styles.empty}>Nothing overdue. Every resident is paid up.</p>;

  return (
    <ul className={styles.rows} aria-label="Overdue rent by age">
      {buckets.map((b, i) => (
        <li key={b.label} className={styles.row}>
          <span className={styles.label}>{b.label}</span>
          <span className={styles.track}>
            {b.amount > 0 && (
              <span className={styles.bar} style={{ width: `${(b.amount / max) * 100}%`, background: AGE_COLORS[i] }} />
            )}
          </span>
          <span className={styles.value}>
            {inr(b.amount)}
            <span className={styles.count}>{b.count === 1 ? "1 payment" : `${b.count} payments`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
