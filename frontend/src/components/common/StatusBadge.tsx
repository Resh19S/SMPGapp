import styles from "./StatusBadge.module.css";

export type BadgeTone =
  | "new"
  | "visited"
  | "booked"
  | "lost"
  | "vacant"
  | "occupied"
  | "paid"
  | "due"
  | "overdue";

/** The app's one signature element: every status, everywhere (lead stage, bed
 * occupancy, rent state), renders as the same rotated ink-stamp badge. */
export function StatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{label}</span>;
}
