import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { useAuthStore } from "./store/authStore";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LeadsPage } from "./pages/LeadsPage";
import { PropertiesPage } from "./pages/PropertiesPage";
import { TenantsPage } from "./pages/TenantsPage";
import { RentTrackerPage } from "./pages/RentTrackerPage";
import { StaffPage } from "./pages/StaffPage";
import { OperationsPage } from "./pages/OperationsPage";
import { ProfitLossPage } from "./pages/ProfitLossPage";
import { ReceiptPage } from "./pages/ReceiptPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireOwner({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== "owner") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/receipts/:id"
          element={
            <RequireAuth>
              <ReceiptPage />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/properties" element={<PropertiesPage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="/rent" element={<RentTrackerPage />} />
          <Route path="/operations" element={<OperationsPage />} />
          <Route
            path="/profit-loss"
            element={
              <RequireOwner>
                <ProfitLossPage />
              </RequireOwner>
            }
          />
          <Route
            path="/staff"
            element={
              <RequireOwner>
                <StaffPage />
              </RequireOwner>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
