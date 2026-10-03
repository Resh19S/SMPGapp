import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";
import type { ComplaintCategory, ComplaintPriority, StaffRef } from "../../types/contract";

export const CATEGORY_LABEL: Record<ComplaintCategory, string> = {
  plumbing: "Plumbing",
  electrical: "Electrical",
  cleaning: "Cleaning",
  internet: "Wi-Fi / internet",
  furniture: "Furniture",
  other: "Other",
};

export function ComplaintFormModal({
  staff,
  onClose,
  onSubmit,
}: {
  staff: StaffRef[];
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description: string;
    category: ComplaintCategory;
    priority: ComplaintPriority;
    roomNumber: string;
    assignedToId: number | null;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ComplaintCategory>("plumbing");
  const [priority, setPriority] = useState<ComplaintPriority>("normal");
  const [roomNumber, setRoomNumber] = useState("");
  const [assignedToId, setAssignedToId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Say what the problem is.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
        roomNumber: roomNumber.trim(),
        assignedToId: assignedToId === "" ? null : assignedToId,
      });
      onClose();
    } catch {
      setError("Could not save the complaint. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Log a complaint" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <div className={formStyles.error}>{error}</div>}
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="c-title">What's wrong</label>
          <input id="c-title" className={formStyles.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Geyser not heating" autoFocus required />
        </div>
        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="c-room">Room</label>
            <input id="c-room" className={formStyles.input} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="e.g. 304" />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="c-category">Type</label>
            <select id="c-category" className={formStyles.select} value={category} onChange={(e) => setCategory(e.target.value as ComplaintCategory)}>
              {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="c-priority">Priority</label>
            <select id="c-priority" className={formStyles.select} value={priority} onChange={(e) => setPriority(e.target.value as ComplaintPriority)}>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent — affects living</option>
            </select>
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="c-assign">Assign to</label>
            <select id="c-assign" className={formStyles.select} value={assignedToId} onChange={(e) => setAssignedToId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Nobody yet</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="c-desc">Details (optional)</label>
          <textarea id="c-desc" className={formStyles.textarea} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.buttonPrimary} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Log complaint"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
