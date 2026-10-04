import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { RentSummary } from "../../types/contract";
import { formatDate, inr, inrCompact, todayISO } from "../../lib/format";
import styles from "./CollectionChart.module.css";

const HEIGHT = 200;
const PAD = { top: 16, right: 64, bottom: 24, left: 52 };

interface Point {
  day: number;
  date: string;
  received: number; // that day
  cumulative: number;
}

/** Rent collected so far this month (one series, cumulative), against the
 * amount billed as a reference line on the same ₹ axis. */
export function CollectionChart({ summary }: { summary: RentSummary }) {
  return summary.periodMonth ? <MonthChart summary={summary} period={summary.periodMonth} /> : null;
}

function MonthChart({ summary, period }: { summary: RentSummary; period: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = useMemo<Point[]>(() => {
    const [y, m] = period.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const today = todayISO();
    const byDate = new Map(summary.dailyCollections.map((d) => [d.date, d.amount]));
    const out: Point[] = [];
    let running = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${period}-${String(day).padStart(2, "0")}`;
      if (date > today) break; // don't draw the future as flat
      const received = byDate.get(date) ?? 0;
      running += received;
      out.push({ day, date, received, cumulative: running });
    }
    // Payments made in advance (dated before the 1st) still count toward this month.
    const early = summary.dailyCollections.filter((d) => d.date < `${period}-01`).reduce((s, d) => s + d.amount, 0);
    return out.map((p) => ({ ...p, cumulative: p.cumulative + early, received: p.day === 1 ? p.received + early : p.received }));
  }, [summary, period]);

  if (points.length === 0) {
    return <p className={styles.empty}>This month hasn't started yet.</p>;
  }

  const [y, m] = period.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const yMax = Math.max(summary.billed, points[points.length - 1].cumulative, 1) * 1.05;
  const x = (day: number) => PAD.left + ((day - 1) / Math.max(daysInMonth - 1, 1)) * innerW;
  const yScale = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${yScale(p.cumulative).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const areaPath = `${linePath} L${x(last.day).toFixed(1)},${yScale(0)} L${x(1)},${yScale(0)} Z`;
  // Rounded to ₹1k; deduped because with no rent billed yet they all round to 0.
  const yTicks = [...new Set([0, yMax / 2, yMax].map((v) => Math.round(v / 1000) * 1000))];
  const xTicks = [1, 8, 15, 22, daysInMonth];
  const hover = hoverIdx !== null ? points[hoverIdx] : null;

  function handlePointer(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const day = Math.round(((px - PAD.left) / innerW) * (daysInMonth - 1)) + 1;
    setHoverIdx(Math.min(Math.max(day, 1), points.length) - 1);
  }

  function handleKey(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key === "ArrowRight") setHoverIdx((i) => Math.min((i ?? -1) + 1, points.length - 1));
    else if (e.key === "ArrowLeft") setHoverIdx((i) => Math.max((i ?? points.length) - 1, 0));
    else return;
    e.preventDefault();
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <svg
        width={width}
        height={HEIGHT}
        className={styles.svg}
        role="img"
        aria-label={`Collected ${inr(last.cumulative)} of ${inr(summary.billed)} billed by ${formatDate(last.date)}. Use arrow keys to read day by day.`}
        tabIndex={0}
        onPointerMove={handlePointer}
        onPointerLeave={() => setHoverIdx(null)}
        onKeyDown={handleKey}
        onBlur={() => setHoverIdx(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yScale(v)} y2={yScale(v)} className={styles.grid} />
            <text x={PAD.left - 8} y={yScale(v)} className={styles.axisLabel} textAnchor="end" dominantBaseline="middle">
              {inrCompact(v)}
            </text>
          </g>
        ))}
        {xTicks.map((d) => (
          <text key={d} x={x(d)} y={HEIGHT - 6} className={styles.axisLabel} textAnchor="middle">
            {d}
          </text>
        ))}

        <line x1={PAD.left} x2={width - PAD.right} y1={yScale(summary.billed)} y2={yScale(summary.billed)} className={styles.reference} />
        <text x={width - PAD.right + 6} y={yScale(summary.billed)} className={styles.refLabel} dominantBaseline="middle">
          Billed
        </text>

        <path d={areaPath} className={styles.area} />
        <path d={linePath} className={styles.line} />
        <circle cx={x(last.day)} cy={yScale(last.cumulative)} r={4} className={styles.endDot} />
        <text x={x(last.day) + 8} y={yScale(last.cumulative) + 14} className={styles.endLabel}>
          {inrCompact(last.cumulative)}
        </text>

        {hover && (
          <g>
            <line x1={x(hover.day)} x2={x(hover.day)} y1={PAD.top} y2={yScale(0)} className={styles.crosshair} />
            <circle cx={x(hover.day)} cy={yScale(hover.cumulative)} r={4} className={styles.endDot} />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className={styles.tooltip}
          style={{ left: Math.min(x(hover.day) + 12, width - 180), top: PAD.top }}
          role="status"
        >
          <div className={styles.tipDate}>{formatDate(hover.date)}</div>
          <div className={styles.tipRow}>
            <span className={styles.tipKey} />
            <strong>{inr(hover.cumulative)}</strong> collected so far
          </div>
          <div className={styles.tipSub}>{hover.received > 0 ? `${inr(hover.received)} received this day` : "Nothing received this day"}</div>
        </div>
      )}

      <details className={styles.tableView}>
        <summary>View as table</summary>
        <table>
          <thead>
            <tr><th>Date</th><th>Received</th><th>Collected so far</th></tr>
          </thead>
          <tbody>
            {points.filter((p) => p.received > 0).map((p) => (
              <tr key={p.date}>
                <td>{formatDate(p.date)}</td>
                <td>{inr(p.received)}</td>
                <td>{inr(p.cumulative)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
