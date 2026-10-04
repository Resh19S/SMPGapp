import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";
import { ApiError } from "../../api/client";
import type { Property } from "../../types/contract";

export function EditPropertyModal({
  property,
  onClose,
  onSubmit,
}: {
  property: Property;
  onClose: () => void;
  onSubmit: (data: { name: string; address: string }) => Promise<void>;
}) {
  const [name, setName] = useState(property.name);
  const [address, setAddress] = useState(property.address);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the property a name.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), address: address.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Property details" onClose={onClose} width={400}>
      <form onSubmit={handleSubmit}>
        {error && <div className={formStyles.error}>{error}</div>}
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="edit-prop-name">Property name</label>
          <input id="edit-prop-name" className={formStyles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus required />
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="edit-prop-address">Address</label>
          <input id="edit-prop-address" className={formStyles.input} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={255} />
        </div>
        <p className={formStyles.hint}>Shown in the sidebar and on rent receipts.</p>
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.buttonPrimary} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
