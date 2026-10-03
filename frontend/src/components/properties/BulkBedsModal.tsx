import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";
import { ApiError } from "../../api/client";
import { inr } from "../../lib/format";

/** "301-308" → 301…308 ; "G1, G2, 101" → as written. */
export function parseRooms(input: string): string[] | null {
  const parts = input.split(",").map((p) => p.trim()).filter(Boolean);
  const rooms: string[] = [];
  for (const part of parts) {
    const range = part.match(/^(\d+)\s*[-–to]+\s*(\d+)$/i);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      if (to < from || to - from > 59) return null;
      for (let n = from; n <= to; n++) rooms.push(String(n));
    } else {
      rooms.push(part);
    }
  }
  return rooms.length ? rooms : null;
}

export function BulkBedsModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: { roomNumbers: string[]; bedLabels: string[]; rentAmount: number }) => Promise<void>;
}) {
  const [rooms, setRooms] = useState("");
  const [labels, setLabels] = useState("A, B, C");
  const [rent, setRent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const roomList = parseRooms(rooms);
  const labelList = labels.split(",").map((l) => l.trim()).filter(Boolean);
  const total = (roomList?.length ?? 0) * labelList.length;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const rentValue = Number(rent);
    if (!roomList) return setError("Enter rooms like 301-308, or 101, 102, 105 (up to 60 rooms).");
    if (labelList.length === 0) return setError("Enter at least one bed label, e.g. A, B, C.");
    if (!rentValue || rentValue <= 0) return setError("Enter the rent per bed.");
    setIsSubmitting(true);
    try {
      await onSubmit({ roomNumbers: roomList, bedLabels: labelList, rentAmount: rentValue });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the rooms. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Add rooms" onClose={onClose} width={440}>
      <form onSubmit={handleSubmit}>
        {error && <div className={formStyles.error}>{error}</div>}
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="bulk-rooms">Rooms</label>
          <input id="bulk-rooms" className={formStyles.input} value={rooms} onChange={(e) => setRooms(e.target.value)} placeholder="e.g. 401-408  or  101, 102, 105" autoFocus required />
          <span className={formStyles.hint}>Floor is worked out from the room number (401 → floor 4).</span>
        </div>
        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="bulk-labels">Beds in each room</label>
            <input id="bulk-labels" className={formStyles.input} value={labels} onChange={(e) => setLabels(e.target.value)} required />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="bulk-rent">Rent per bed (₹/month)</label>
            <input id="bulk-rent" type="number" min="1" className={formStyles.input} value={rent} onChange={(e) => setRent(e.target.value)} required />
          </div>
        </div>
        {total > 0 && (
          <p className={formStyles.hint}>
            Creates <strong>{total} beds</strong> in {roomList!.length} room{roomList!.length > 1 ? "s" : ""}
            {roomList!.length <= 8 ? ` (${roomList!.join(", ")})` : ` (${roomList![0]} … ${roomList![roomList!.length - 1]})`}
            {Number(rent) > 0 ? ` — ${inr(total * Number(rent))}/month when full.` : "."}
          </p>
        )}
        <div className={formStyles.actions}>
          <button type="button" className={formStyles.buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={formStyles.buttonPrimary} disabled={isSubmitting || total === 0}>
            {isSubmitting ? "Adding…" : total > 0 ? `Add ${total} beds` : "Add beds"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
