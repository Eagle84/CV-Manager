import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { apiClient } from "./lib/api.ts";
import { ApplicationsPage } from "./pages/ApplicationsPage.tsx";
import { CompanyOverviewPage } from "./pages/CompanyOverviewPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";

const links = [
  { to: "/dashboard", label: "Dashboard", hint: "Pipeline at a glance" },
  { to: "/applications", label: "Applications", hint: "Review and update status" },
  { to: "/settings", label: "Settings", hint: "Gmail, schedule, operations" },
];

function App() {
  const [auth, setAuth] = useState<{ connected: boolean; email: string | null }>({
    connected: false,
    email: null,
  });
  const [statusCheckDegraded, setStatusCheckDegraded] = useState(false);

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      try {
        const status = await apiClient.getAuthStatus();
        if (active) {
          setAuth(status);
          setStatusCheckDegraded(false);
        }
      } catch {
        // Keep the last known auth status on transient failures.
        if (active) setStatusCheckDegraded(true);
      }
    };

    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 15000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">CV Manager</p>
          <h1>CV Application Tracker</h1>
          <p className="subtitle">Track job emails, manage pipeline status, and keep follow-ups on time.</p>
          <p className={`connection-status ${auth.connected ? "connected" : "disconnected"}`}>
            Gmail: {auth.connected ? auth.email : "Not connected"}
            {statusCheckDegraded ? " | status check retrying..." : ""}
          </p>
        </div>
        <nav>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              <span>{link.label}</span>
              <small>{link.hint}</small>
            </NavLink>
          ))}
        </nav>
      </header>

      <main>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/companies/:companyDomain" element={<CompanyOverviewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
