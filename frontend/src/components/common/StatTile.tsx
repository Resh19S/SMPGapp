import styles from "./StatTile.module.css";

export function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className={styles.tile}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
      {sub && <div className={styles.sub}>{sub}</div>}
    </div>
  );
}
