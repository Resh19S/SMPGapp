import { useState, type FormEvent } from "react";
import { ApiError, resetStaffPassword } from "../../api/client";
import type { StaffUser } from "../../types/contract";
import { Modal } from "../common/Modal";
import formStyles from "../common/Form.module.css";

export function ResetPasswordModal({ member, onClose }: { member: StaffUser; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    setIsSubmitting(true);
    setError(null);
    try {
      await resetStaffPassword(member.id, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset the password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Reset password — ${member.name}`} onClose={onClose} width={380}>
      {done ? (
        <>
          <p className={formStyles.hint} style={{ fontSize: "var(--text-sm)" }}>
            Done. Tell {member.name.split(" ")[0]} the new password in person — they've been signed out everywhere and can
            change it from <strong>Password</strong> after signing in.
          </p>
          <div className={formStyles.actions}>
            <button className={formStyles.buttonPrimary} onClick={onClose}>Close</button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && <div className={formStyles.error}>{error}</div>}
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="reset-pw">New password for {member.username}</label>
            <input id="reset-pw" type="text" autoComplete="off" className={formStyles.input} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
            <span className={formStyles.hint}>Shown as you type so you can read it out. 8+ characters.</span>
          </div>
          <div className={formStyles.actions}>
            <button type="button" className={formStyles.buttonSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={formStyles.buttonPrimary} disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Set password"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
