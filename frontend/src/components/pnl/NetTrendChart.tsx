import { useState } from "react";
import type { PnlMonth } from "../../types/contract";
import { inr, inrCompact, monthLabel } from "../../lib/format";
import styles from "./NetTrendChart.module.css";

const HEIGHT = 180;
const PAD = { top: 22, bottom: 26 };
const BAR = 24;

/** Net profit per month — one series, zero baseline. Loss months drop below
 * the line in rust and are labelled with a minus sign, so colour is never the
 * only cue. Each column is its own hover/focus target. */
export function NetTrendChart({ months, selected, onSelect }: { months: PnlMonth[]; selected: string; onSelect: (period: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...months.map((m) => Math.abs(m.net)), 1);
  const hasLoss = months.some((m) => m.net < 0);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  // Baseline sits at the bottom unless there's a loss month to show below it.
  const zeroY = hasLoss ? PAD.top + innerH / 2 : PAD.top + innerH;
  const scale = (hasLoss ? innerH / 2 : innerH) / max;
  const active = months.find((m) => m.periodMonth === hover);

  return (
    <div className={styles.wrap}>
      <div className={styles.columns} style={{ height: HEIGHT }}>
        <div className={styles.baseline} style={{ top: zeroY }} />
        {months.map((m) => {
          const h = Math.max(Math.abs(m.net) * scale, 2);
          const isLoss = m.net < 0;
          const isSelected = m.periodMonth === selected;
          return (
            <button
              key={m.periodMonth}
              className={`${styles.slot} ${isSelected ? styles.selected : ""}`}
              onPointerEnter={() => setHover(m.periodMonth)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(m.periodMonth)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect(m.periodMonth)}
              aria-label={`${monthLabel(m.periodMonth)}: net ${m.net < 0 ? "loss" : "profit"} ${inr(Math.abs(m.net))}. Show this month.`}
              aria-pressed={isSelected}
            >
              <span
                className={`${styles.bar} ${isLoss ? styles.loss : styles.profit}`}
                style={{ width: BAR, height: h, top: isLoss ? zeroY : zeroY - h }}
              />
              <span className={styles.value} style={{ top: isLoss ? zeroY + h + 4 : zeroY - h - 16 }}>
                {isLoss ? "−" : ""}
                {inrCompact(Math.abs(m.net))}
              </span>
              <span className={styles.month}>{monthLabel(m.periodMonth).slice(0, 3)}</span>
            </button>
          );
        })}
      </div>

      {active && (
        <div className={styles.tooltip} role="status">
          <div className={styles.tipTitle}>{monthLabel(active.periodMonth)}</div>
          <div><strong>{inr(active.net)}</strong> net</div>
          <div className={styles.tipSub}>{inr(active.income)} in · {inr(active.expenses)} out</div>
        </div>
      )}

      <details className={styles.tableView}>
        <summary>View as table</summary>
        <table>
          <thead>
            <tr><th>Month</th><th>Income</th><th>Expenses</th><th>Net</th></tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.periodMonth}>
                <td>{monthLabel(m.periodMonth)}</td>
                <td>{inr(m.income)}</td>
                <td>{inr(m.expenses)}</td>
                <td>{inr(m.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
