import { useEffect, useState } from "react";
import { createStaff, deactivateStaff, listStaff } from "../api/client";
import { ApiError } from "../api/client";
import type { StaffRole, StaffUser } from "../types/contract";
import { StatusBadge } from "../components/common/StatusBadge";
import formStyles from "../components/common/Form.module.css";
import tableStyles from "../components/common/Table.module.css";
import pageStyles from "./PageLayout.module.css";

export function StaffPage() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function load() {
    listStaff().then(setStaff).catch(() => setError("Could not load staff accounts."));
  }

  useEffect(load, []);

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !username.trim() || password.length < 6) {
      setError("Name and username are required; password must be at least 6 characters.");
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await createStaff({ name: name.trim(), username: username.trim(), password, role });
      setStaff((prev) => [...prev, created]);
      setName("");
      setUsername("");
      setPassword("");
      setRole("staff");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the account. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeactivate(member: StaffUser) {
    if (!window.confirm(`Deactivate ${member.name}? They will be signed out and can't log in again.`)) return;
    setError(null);
    try {
      const updated = await deactivateStaff(member.id);
      setStaff((prev) => prev.map((s) => (s.id === member.id ? updated : s)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not deactivate the account. Please try again.");
    }
  }

  return (
    <div>
      <h1 className={pageStyles.title}>Staff Access</h1>
      <p className={pageStyles.subtitle}>Owner-only. Give front-desk staff their own login instead of sharing yours.</p>

      <div className={tableStyles.tableWrap} style={{ marginTop: "var(--space-5)", marginBottom: "var(--space-6)" }}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td className={tableStyles.name}>{s.name}</td>
                <td className={tableStyles.mono}>{s.username}</td>
                <td>{s.role}</td>
                <td><StatusBadge tone={s.isActive ? "occupied" : "lost"} label={s.isActive ? "active" : "deactivated"} /></td>
                <td>
                  {s.isActive && s.role !== "owner" && (
                    <button className={tableStyles.actionButton} onClick={() => handleDeactivate(s)}>
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className={pageStyles.title} style={{ fontSize: "var(--text-lg)" }}>Add staff account</h2>
      <div style={{ maxWidth: 360, marginTop: "var(--space-3)" }}>
        {error && <div className={formStyles.error}>{error}</div>}
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="staff-name">Name</label>
          <input id="staff-name" className={formStyles.input} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="staff-username">Username</label>
          <input id="staff-username" className={formStyles.input} value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="staff-password">Password</label>
          <input id="staff-password" type="password" className={formStyles.input} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="staff-role">Role</label>
          <select id="staff-role" className={formStyles.select} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <button className={formStyles.buttonPrimary} onClick={handleCreate} disabled={isSubmitting}>
          {isSubmitting ? "Creating…" : "Create account"}
        </button>
      </div>
    </div>
  );
}
