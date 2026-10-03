import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";
import { ApiError } from "../../api/client";

export function BedFormModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: { roomNumber: string; bedLabel: string; rentAmount: number }) => Promise<void>;
}) {
  const [roomNumber, setRoomNumber] = useState("");
  const [bedLabel, setBedLabel] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const rent = Number(rentAmount);
    if (!roomNumber.trim() || !bedLabel.trim() || !rent || rent <= 0) {
      setError("Room number, bed label, and a positive rent amount are required.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({ roomNumber: roomNumber.trim(), bedLabel: bedLabel.trim(), rentAmount: rent });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the bed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Add bed" onClose={onClose} width={380}>
      <form onSubmit={handleSubmit}>
        {error && <div className={formStyles.error}>{error}</div>}
        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="bed-room">Room number</label>
            <input id="bed-room" className={formStyles.input} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="e.g. 203" autoFocus required />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="bed-label">Bed label</label>
            <input id="bed-label" className={formStyles.input} value={bedLabel} onChange={(e) => setBedLabel(e.target.value)} placeholder="e.g. A" required />
          </div>
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="bed-rent">Rent per month (₹)</label>
          <input id="bed-rent" type="number" min="1" className={formStyles.input} value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} required />
        </div>
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.buttonPrimary} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Add bed"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
