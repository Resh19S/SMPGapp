import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";
import type { Bed } from "../../types/contract";
import { inr } from "../../lib/format";
import { RENT_STATE_LABEL } from "./BedGrid";

export function EditRentModal({
  bed,
  onClose,
  onSubmit,
}: {
  bed: Bed;
  onClose: () => void;
  onSubmit: (rentAmount: number) => Promise<void>;
}) {
  const [rentAmount, setRentAmount] = useState(String(bed.rentAmount));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const rent = Number(rentAmount);
    if (!rent || rent <= 0) {
      setError("Enter a positive rent amount.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit(rent);
      onClose();
    } catch {
      setError("Could not update rent. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Room ${bed.roomNumber}, Bed ${bed.bedLabel}`} onClose={onClose} width={340}>
      <form onSubmit={handleSubmit}>
        {error && <div className={formStyles.error}>{error}</div>}
        <p className={formStyles.hint} style={{ marginBottom: "var(--space-3)" }}>
          {bed.currentTenant ? `${bed.currentTenant.name} · ` : ""}
          {bed.rentState === "late" ? `${bed.daysLate} days late` : RENT_STATE_LABEL[bed.rentState]}
          {bed.outstanding > 0 ? ` · ${inr(bed.outstanding)} outstanding` : ""}
        </p>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="edit-rent">Listed rent for the next resident (₹/month)</label>
          <input id="edit-rent" type="number" min="1" className={formStyles.input} value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} autoFocus required />
        </div>
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.buttonPrimary} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save rent"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
