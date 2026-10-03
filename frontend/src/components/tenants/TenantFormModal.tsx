import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";
import { ApiError, listBeds } from "../../api/client";
import type { Bed } from "../../types/contract";

export function TenantFormModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    phone: string;
    bedId: number;
    moveInDate: string;
    rentDueDay: number;
    rentAmount: number;
    depositAmount: number;
    agreementExpiry: string;
  }) => Promise<void>;
}) {
  const [vacantBeds, setVacantBeds] = useState<Bed[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [bedId, setBedId] = useState<number | "">("");
  const [moveInDate, setMoveInDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rentDueDay, setRentDueDay] = useState("1");
  const [depositAmount, setDepositAmount] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [agreementExpiry, setAgreementExpiry] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    listBeds().then((beds) => setVacantBeds(beds.filter((b) => b.status === "vacant")));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const deposit = Number(depositAmount);
    const rent = Number(rentAmount);
    const dueDay = Number(rentDueDay);
    if (!name.trim() || !phone.trim() || !bedId || depositAmount === "" || deposit < 0 || !rent || rent <= 0 || dueDay < 1 || dueDay > 31) {
      setError("Fill in every field with a valid value, including a bed to assign.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        phone: phone.trim(),
        bedId: Number(bedId),
        moveInDate,
        rentDueDay: dueDay,
        rentAmount: rent,
        depositAmount: deposit,
        agreementExpiry,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the tenant. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Move in a tenant" onClose={onClose} width={480}>
      <form onSubmit={handleSubmit}>
        {error && <div className={formStyles.error}>{error}</div>}

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="tenant-name">Name</label>
            <input id="tenant-name" className={formStyles.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="tenant-phone">Phone</label>
            <input id="tenant-phone" className={formStyles.input} value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="tenant-bed">Assign bed</label>
          <select id="tenant-bed" className={formStyles.select} value={bedId} onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : "";
              setBedId(id);
              // Pre-fill the listed rent; staff can change it if a different rent was agreed.
              const bed = vacantBeds.find((b) => b.id === id);
              if (bed) {
                setRentAmount(String(bed.rentAmount));
                if (depositAmount === "") setDepositAmount(String(bed.rentAmount));
              }
            }} required>
            <option value="">
              {vacantBeds.length === 0 ? "No vacant beds available" : "Select a vacant bed"}
            </option>
            {vacantBeds.map((b) => (
              <option key={b.id} value={b.id}>
                Room {b.roomNumber}, Bed {b.bedLabel} — ₹{b.rentAmount.toLocaleString("en-IN")}/mo
              </option>
            ))}
          </select>
        </div>

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="tenant-movein">Move-in date</label>
            <input id="tenant-movein" type="date" className={formStyles.input} value={moveInDate} onChange={(e) => setMoveInDate(e.target.value)} required />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="tenant-dueday">Rent due day (1–31)</label>
            <input id="tenant-dueday" type="number" min="1" max="31" className={formStyles.input} value={rentDueDay} onChange={(e) => setRentDueDay(e.target.value)} required />
          </div>
        </div>

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="tenant-rent">Agreed rent (₹/month)</label>
            <input id="tenant-rent" type="number" min="1" className={formStyles.input} value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} required />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="tenant-deposit">Deposit (₹)</label>
            <input id="tenant-deposit" type="number" min="0" className={formStyles.input} value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} required />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="tenant-agreement">Agreement expiry</label>
            <input id="tenant-agreement" type="date" className={formStyles.input} value={agreementExpiry} onChange={(e) => setAgreementExpiry(e.target.value)} required />
          </div>
        </div>

        <div className={formStyles.actions}>
          <button type="button" className={formStyles.buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.buttonPrimary} disabled={isSubmitting || vacantBeds.length === 0}>
            {isSubmitting ? "Saving…" : "Move in"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
