import { useState, type FormEvent } from "react";
import { ApiError, changePassword } from "../../api/client";
import { useAuthStore } from "../../store/authStore";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    if (next !== confirm) return setError("The new passwords don't match.");
    setIsSubmitting(true);
    try {
      const res = await changePassword(current, next);
      setAuth(res.token, res.user); // this session continues; others are signed out
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the password. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Change password" onClose={onClose} width={380}>
      {done ? (
        <>
          <p className={formStyles.hint} style={{ fontSize: "var(--text-sm)" }}>
            Password changed. Any other device signed in to this account has been signed out.
          </p>
          <div className={formStyles.actions}>
            <button className={formStyles.buttonPrimary} onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && <div className={formStyles.error}>{error}</div>}
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="pw-current">Current password</label>
            <input id="pw-current" type="password" autoComplete="current-password" className={formStyles.input} value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus required />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="pw-new">New password (8+ characters)</label>
            <input id="pw-new" type="password" autoComplete="new-password" className={formStyles.input} value={next} onChange={(e) => setNext(e.target.value)} required />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="pw-confirm">Repeat new password</label>
            <input id="pw-confirm" type="password" autoComplete="new-password" className={formStyles.input} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          <div className={formStyles.actions}>
            <button type="button" className={formStyles.buttonSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={formStyles.buttonPrimary} disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Change password"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
