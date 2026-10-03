import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";
import { ApiError } from "../../api/client";
import type { ManualPaymentMethod, RentRecord } from "../../types/contract";
import { inr, newIdempotencyKey, todayISO } from "../../lib/format";

const METHODS: { value: ManualPaymentMethod; label: string }[] = [
  { value: "upi", label: "UPI" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

export function RecordPaymentModal({
  record,
  onClose,
  onSubmit,
}: {
  record: RentRecord;
  onClose: () => void;
  onSubmit: (data: { amount: number; paidDate: string; method: ManualPaymentMethod; note: string }, idempotencyKey: string) => Promise<void>;
}) {
  const remaining = record.amountDue - record.amountPaid;
  const [amount, setAmount] = useState(String(remaining));
  const [paidDate, setPaidDate] = useState(todayISO);
  const [method, setMethod] = useState<ManualPaymentMethod>("upi");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One key per opened form: retries and double-clicks of this submit are recorded once.
  const [idempotencyKey] = useState(newIdempotencyKey);

  const value = Number(amount);
  const isPartial = value > 0 && value < remaining;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value || value <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (value > remaining) {
      setError(`Only ${inr(remaining)} is left to pay for this month.`);
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({ amount: value, paidDate, method, note: note.trim() }, idempotencyKey);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the payment. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Record rent — ${record.tenantName}`} onClose={onClose} width={400}>
      <form onSubmit={handleSubmit}>
        {error && <div className={formStyles.error}>{error}</div>}
        <p className={formStyles.hint} style={{ marginBottom: "var(--space-3)" }}>
          {record.periodMonth} · Room {record.roomNumber}/{record.bedLabel} · Rent {inr(record.amountDue)}
          {record.amountPaid > 0 && ` · ${inr(record.amountPaid)} already paid`}
        </p>
        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="paid-amount">Amount received (₹)</label>
            <input id="paid-amount" type="number" min="1" max={remaining} className={formStyles.input} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="paid-date">Date received</label>
            <input id="paid-date" type="date" className={formStyles.input} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} required />
          </div>
        </div>
        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="paid-method">Paid by</label>
            <select id="paid-method" className={formStyles.select} value={method} onChange={(e) => setMethod(e.target.value as ManualPaymentMethod)}>
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="paid-note">Note (optional)</label>
            <input id="paid-note" className={formStyles.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. UPI ref" />
          </div>
        </div>
        {isPartial && (
          <p className={formStyles.hint}>Part payment — {inr(remaining - value)} will still be owed for this month.</p>
        )}
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.buttonPrimary} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : isPartial ? "Record part payment" : "Mark as paid"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
