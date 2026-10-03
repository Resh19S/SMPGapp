import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";
import type { LeadSource } from "../../types/contract";
import { ApiError } from "../../api/client";

const SOURCES: { value: LeadSource; label: string }[] = [
  { value: "broker", label: "Broker" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "google", label: "Google" },
  { value: "walk-in", label: "Walk-in" },
  { value: "other", label: "Other" },
];

export function LeadFormModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: { name: string; phone: string; source: LeadSource; followUpDate: string | null; notes: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<LeadSource>("whatsapp");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !phone.trim()) {
      setError("Name and phone are required.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), phone: phone.trim(), source, followUpDate: followUpDate || null, notes: notes.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the lead. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Add lead" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <div className={formStyles.error}>{error}</div>}

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="lead-name">Name</label>
          <input id="lead-name" className={formStyles.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="lead-phone">Phone</label>
          <input id="lead-phone" className={formStyles.input} value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="lead-source">Source</label>
            <select id="lead-source" className={formStyles.select} value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="lead-followup">Follow-up date</label>
            <input id="lead-followup" type="date" className={formStyles.input} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
          </div>
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="lead-notes">Notes</label>
          <textarea id="lead-notes" className={formStyles.textarea} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className={formStyles.actions}>
          <button type="button" className={formStyles.buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.buttonPrimary} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Add lead"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
