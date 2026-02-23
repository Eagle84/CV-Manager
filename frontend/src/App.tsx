import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { apiClient } from "./lib/api.ts";
import { ApplicationsPage } from "./pages/ApplicationsPage.tsx";
import { CompanyOverviewPage } from "./pages/CompanyOverviewPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { CVsPage } from "./pages/CVsPage.tsx";
import { JobMatcherPage } from "./pages/JobMatcherPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { LoginSuccessPage } from "./pages/LoginSuccessPage.tsx";
import { getSessionToken } from "./lib/api.ts";

const links = [
  { to: "/dashboard", label: "Dashboard", hint: "Pipeline at a glance" },
  { to: "/applications", label: "Applications", hint: "Review and update status" },
  { to: "/cvs", label: "My CVs", hint: "Upload and scan resumes" },
  { to: "/matcher", label: "Job Matcher", hint: "Analyze job portal URLs" },
  { to: "/settings", label: "Settings", hint: "Gmail, schedule, operations" },
];

function App() {
  const [auth, setAuth] = useState<{ connected: boolean; email: string | null }>({
    connected: false,
    email: null,
  });
  const [statusCheckDegraded, setStatusCheckDegraded] = useState(false);
  const [tokenSnapshot, setTokenSnapshot] = useState<string | null>(getSessionToken());

  useEffect(() => {
    const handleStorage = () => setTokenSnapshot(getSessionToken());
    window.addEventListener("storage", handleStorage);
    const tInt = setInterval(() => {
      const current = getSessionToken();
      if (current !== tokenSnapshot) setTokenSnapshot(current);
    }, 100); // Check every 100ms instead of 1s
    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(tInt);
    };
  }, [tokenSnapshot]);

  const token = getSessionToken();

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      if (!token && window.location.pathname !== "/login" && window.location.pathname !== "/login-success") {
        return;
      }

      try {
        const status = await apiClient.getAuthStatus();
        if (active) {
          setAuth(status);
          setStatusCheckDegraded(false);
        }
      } catch {
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
  }, [token]);

  const isAuthPage = window.location.pathname === "/login" || window.location.pathname === "/login-success";

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login-success" element={<LoginSuccessPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="header-content">
          <div className="header-info">
            <p className="eyebrow">CV Manager</p>
            <h1>CV Application Tracker</h1>
            <p className="subtitle">Track job emails, manage pipeline status, and keep follow-ups on time.</p>
            <p className={`connection-status ${auth.connected ? "connected" : "disconnected"}`}>
              Gmail: {auth.connected ? auth.email : "Not connected"}
              {statusCheckDegraded ? " | status check retrying..." : ""}
            </p>
          </div>
          <button className="btn-secondary signout-btn" onClick={() => apiClient.logout()}>
            Sign Out
          </button>
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
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login-success" element={<LoginSuccessPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/companies/:companyDomain" element={<CompanyOverviewPage />} />
          <Route path="/cvs" element={<CVsPage />} />
          <Route path="/matcher" element={<JobMatcherPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      <footer style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid var(--stroke)', textAlign: 'center', opacity: 0.7 }}>
        <p style={{ margin: 0, fontSize: '0.9rem' }}>
          Created by <strong>Igal Boguslavsky</strong> | <a href="mailto:igal.bogu@gmail.com" style={{ color: 'inherit', textDecoration: 'none' }}>igal.bogu@gmail.com</a>
        </p>
        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', margin: '0 0.75rem' }}>Privacy Policy</a>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', margin: '0 0.75rem' }}>Terms of Service</a>
        </div>
      </footer>
    </div>
  );
}

export default App;
