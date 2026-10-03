import { useState } from "react";
import { ApiError } from "../../api/client";
import type { MoveOutNotice } from "../../types/contract";
import { StatusBadge } from "../common/StatusBadge";
import { formatDate, inr, relativeDay, todayISO } from "../../lib/format";
import formStyles from "../common/Form.module.css";
import styles from "./MoveOutCard.module.css";

export interface MoveOutActions {
  changeDate: (id: number, date: string) => Promise<void>;
  scheduleInspection: (id: number, date: string) => Promise<void>;
  addDeduction: (id: number, label: string, amount: number) => Promise<void>;
  removeDeduction: (id: number, deductionId: number) => Promise<void>;
  settle: (id: number, refundDate: string) => Promise<void>;
}

const STEPS = ["Notice given", "Inspection", "Settled"] as const;

/** One resident's exit, notice to refund. The settlement is laid out as a
 * ledger sum so owner and resident see the same number the same way. */
export function MoveOutCard({ notice, actions }: { notice: MoveOutNotice; actions: MoveOutActions }) {
  const today = todayISO();
  const [inspectionDate, setInspectionDate] = useState(notice.inspectionDate ?? today);
  const [moveOutDate, setMoveOutDate] = useState(notice.plannedMoveOutDate);
  const [deductionLabel, setDeductionLabel] = useState("");
  const [deductionAmount, setDeductionAmount] = useState("");
  const [refundDate, setRefundDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const settled = notice.status === "settled";
  const stepIndex = settled ? 2 : notice.status === "inspection-scheduled" ? 1 : 0;
  const canSettle = notice.plannedMoveOutDate <= today;

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div>
          <h3 className={styles.name}>{notice.tenantName}</h3>
          <p className={styles.meta}>
            Room {notice.roomNumber}/{notice.bedLabel} · notice given {formatDate(notice.noticeDate)}
          </p>
        </div>
        <div className={styles.leaving}>
          <span className={styles.leavingLabel}>{settled ? "Moved out" : "Leaving"}</span>
          <span className={styles.leavingDate}>{settled ? formatDate(notice.plannedMoveOutDate) : relativeDay(notice.plannedMoveOutDate)}</span>
        </div>
      </header>

      <ol className={styles.steps} aria-label="Move-out progress">
        {STEPS.map((step, i) => (
          <li key={step} className={i <= stepIndex ? styles.stepDone : styles.step} aria-current={i === stepIndex ? "step" : undefined}>
            {step}
            {i === 1 && notice.inspectionDate && <span className={styles.stepDate}>{formatDate(notice.inspectionDate)}</span>}
          </li>
        ))}
      </ol>

      {error && <div className={formStyles.error}>{error}</div>}

      <dl className={styles.ledger}>
        <div className={styles.ledgerRow}>
          <dt>Deposit held</dt>
          <dd>{inr(notice.depositHeld)}</dd>
        </div>
        {notice.unpaidRent > 0 && (
          <div className={styles.ledgerRow}>
            <dt>Unpaid rent</dt>
            <dd>− {inr(notice.unpaidRent)}</dd>
          </div>
        )}
        {notice.deductions.map((d) => (
          <div key={d.id} className={styles.ledgerRow}>
            <dt>
              {d.label}
              {!settled && (
                <button
                  className={styles.remove}
                  onClick={() => run(() => actions.removeDeduction(notice.id, d.id))}
                  aria-label={`Remove deduction ${d.label}`}
                  disabled={busy}
                >
                  ×
                </button>
              )}
            </dt>
            <dd>− {inr(d.amount)}</dd>
          </div>
        ))}
        <div className={`${styles.ledgerRow} ${styles.ledgerTotal}`}>
          <dt>{settled ? "Refunded" : "Refund due"}</dt>
          <dd>{inr(settled ? notice.refundAmount ?? 0 : notice.expectedRefund)}</dd>
        </div>
      </dl>
      {settled && notice.refundPaidDate && (
        <p className={styles.settledNote}>
          <StatusBadge tone="paid" label="settled" /> Refund paid {formatDate(notice.refundPaidDate)}
        </p>
      )}

      {!settled && (
        <div className={styles.actions}>
          <div className={styles.actionRow}>
            <label className={formStyles.label} htmlFor={`insp-${notice.id}`}>Inspection</label>
            <input id={`insp-${notice.id}`} type="date" className={formStyles.input} value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
            <button className={formStyles.buttonSecondary} disabled={busy} onClick={() => run(() => actions.scheduleInspection(notice.id, inspectionDate))}>
              {notice.inspectionDate ? "Reschedule" : "Schedule"}
            </button>
          </div>

          <form
            className={styles.actionRow}
            onSubmit={(e) => {
              e.preventDefault();
              const amount = Number(deductionAmount);
              if (!deductionLabel.trim() || !amount || amount <= 0) {
                setError("A deduction needs a reason and an amount.");
                return;
              }
              run(async () => {
                await actions.addDeduction(notice.id, deductionLabel.trim(), amount);
                setDeductionLabel("");
                setDeductionAmount("");
              });
            }}
          >
            <label className={formStyles.label} htmlFor={`ded-${notice.id}`}>Deduction</label>
            <input id={`ded-${notice.id}`} className={formStyles.input} placeholder="e.g. Broken chair" value={deductionLabel} onChange={(e) => setDeductionLabel(e.target.value)} />
            <input type="number" min="1" className={`${formStyles.input} ${styles.amount}`} placeholder="₹" aria-label="Deduction amount" value={deductionAmount} onChange={(e) => setDeductionAmount(e.target.value)} />
            <button type="submit" className={formStyles.buttonSecondary} disabled={busy}>Add</button>
          </form>

          <div className={styles.actionRow}>
            <label className={formStyles.label} htmlFor={`mo-${notice.id}`}>Move-out date</label>
            <input id={`mo-${notice.id}`} type="date" className={formStyles.input} value={moveOutDate} onChange={(e) => setMoveOutDate(e.target.value)} />
            <button
              className={formStyles.buttonSecondary}
              disabled={busy || moveOutDate === notice.plannedMoveOutDate}
              onClick={() => run(() => actions.changeDate(notice.id, moveOutDate))}
            >
              Change
            </button>
          </div>

          <div className={`${styles.actionRow} ${styles.settleRow}`}>
            <label className={formStyles.label} htmlFor={`ref-${notice.id}`}>Refund paid on</label>
            <input id={`ref-${notice.id}`} type="date" className={formStyles.input} value={refundDate} onChange={(e) => setRefundDate(e.target.value)} disabled={!canSettle} />
            <button className={formStyles.buttonPrimary} disabled={busy || !canSettle} onClick={() => run(() => actions.settle(notice.id, refundDate))}>
              Settle &amp; free bed
            </button>
          </div>
          {!canSettle && (
            <p className={formStyles.hint}>Settlement opens on the move-out date. Leaving early? Change the date first.</p>
          )}
        </div>
      )}
    </article>
  );
}
