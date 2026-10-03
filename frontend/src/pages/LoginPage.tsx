import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { ApiError, login } from "../api/client";
import { useAuthStore } from "../store/authStore";
import styles from "./LoginPage.module.css";

export function LoginPage() {
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(
    searchParams.get("expired") ? "Your session has expired. Please sign in again." : null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (token) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await login(username.trim(), password);
      setAuth(res.token, res.user);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Incorrect username or password." : "Could not reach the server. Is the backend running?");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.stamp}>PG</div>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>Rooms, rent and residents in one ledger.</p>

        <form onSubmit={handleSubmit}>
          {error && <div className={styles.error}>{error}</div>}
          <label className={styles.label} htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            required
          />
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button className={styles.submit} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Only when explicitly turned on for a local demo — never on a live server. */}
        {import.meta.env.VITE_SHOW_DEMO_LOGINS === "true" && (
          <p className={styles.hint}>Demo accounts — owner / owner123 · staff / staff123</p>
        )}
      </div>
    </div>
  );
}
