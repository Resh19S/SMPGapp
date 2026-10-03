import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { useAuthStore } from "../../store/authStore";
import styles from "./AppShell.module.css";

const NAV_ITEMS = [
  { to: "/", label: "Day Book", end: true },
  { to: "/leads", label: "Leads" },
  { to: "/properties", label: "Rooms & Beds" },
  { to: "/tenants", label: "Tenants" },
  { to: "/rent", label: "Rent Tracker" },
  { to: "/operations", label: "Operations" },
];

export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>SPG</span>
          <span className={styles.brandName}>Sunrise PG</span>
        </div>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
          {user?.role === "owner" && (
            <NavLink
              to="/profit-loss"
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
            >
              Profit &amp; Loss
            </NavLink>
          )}
          {user?.role === "owner" && (
            <NavLink
              to="/staff"
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
            >
              Staff Access
            </NavLink>
          )}
        </nav>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <span className={styles.dateLabel}>
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
          </span>
          <div className={styles.userBlock}>
            <span className={styles.userName}>{user?.name}</span>
            <span className={styles.userRole}>{user?.role === "owner" ? "Owner" : "Staff"}</span>
            <button className={styles.logoutButton} onClick={logout}>
              Log out
            </button>
          </div>
        </header>
        <main className={styles.content}>
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
