import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { fetchNavCounts } from "../../api/client";
import type { NavCounts } from "../../types/contract";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { useAuthStore } from "../../store/authStore";
import { propertyInitials, usePropertyStore } from "../../store/propertyStore";
import { GlobalSearch } from "./GlobalSearch";
import { ChangePasswordModal } from "./ChangePasswordModal";
import styles from "./AppShell.module.css";

type BadgeKey = keyof NavCounts;

const NAV_ITEMS: { to: string; label: string; end?: boolean; badge?: BadgeKey; badgeTitle?: string; ownerOnly?: boolean }[] = [
  { to: "/", label: "Day Book", end: true, badge: "openItems", badgeTitle: "open items today" },
  { to: "/leads", label: "Leads" },
  { to: "/properties", label: "Rooms & Beds" },
  { to: "/tenants", label: "Tenants", badge: "renewalsDue", badgeTitle: "agreements to renew" },
  { to: "/rent", label: "Rent Tracker", badge: "overdueResidents", badgeTitle: "residents behind on rent" },
  { to: "/operations", label: "Operations", badge: "urgentComplaints", badgeTitle: "urgent complaints" },
  { to: "/profit-loss", label: "Profit & Loss", ownerOnly: true },
  { to: "/activity", label: "Activity", ownerOnly: true },
  { to: "/staff", label: "Staff Access", ownerOnly: true },
];

export function AppShell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const property = usePropertyStore((s) => s.property);
  const loadProperty = usePropertyStore((s) => s.load);
  const location = useLocation();
  const [counts, setCounts] = useState<NavCounts | null>(null);
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);

  useEffect(() => {
    loadProperty();
  }, [loadProperty]);

  // Refresh the badges whenever the user moves between pages.
  useEffect(() => {
    let cancelled = false;
    fetchNavCounts()
      .then((c) => !cancelled && setCounts(c))
      .catch(() => {
        /* badges are a nicety; pages show their own errors */
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>{propertyInitials(property?.name)}</span>
          <span className={styles.brandName}>{property?.name ?? " "}</span>
        </div>
        <nav className={styles.nav}>
          {NAV_ITEMS.filter((item) => !item.ownerOnly || user?.role === "owner").map((item) => {
            const count = item.badge && counts ? counts[item.badge] : 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
              >
                <span>{item.label}</span>
                {count > 0 && (
                  <span className={styles.badge} title={`${count} ${item.badgeTitle}`} aria-label={`${count} ${item.badgeTitle}`}>
                    {count}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <span className={styles.dateLabel}>
            {new Date().toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
          </span>
          <GlobalSearch />
          <div className={styles.userBlock}>
            <span className={styles.userName}>{user?.name}</span>
            <span className={styles.userRole}>{user?.role === "owner" ? "Owner" : "Staff"}</span>
            <button className={styles.topButton} onClick={() => setIsPasswordOpen(true)}>
              Password
            </button>
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
      {isPasswordOpen && <ChangePasswordModal onClose={() => setIsPasswordOpen(false)} />}
    </div>
  );
}
